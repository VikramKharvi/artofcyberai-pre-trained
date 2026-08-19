#!/usr/bin/env python3
"""Scaffold and validate standalone research blogs without changing the site shell."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "blog-config.json"
TEMPLATE_PATH = ROOT / "templates" / "blog-page.html"
INDEX_PATH = ROOT / "index.html"
SITEMAP_PATH = ROOT / "sitemap.xml"
SITE_CHAT_PATH = ROOT / "site-chat.js"
CNAME_PATH = ROOT / "CNAME"

CONTENT_START = "<!-- BLOG_CONTENT_START -->"
CONTENT_END = "<!-- BLOG_CONTENT_END -->"
NOTES_START = "<!-- BLOG_NOTES_START -->"
NOTES_END = "<!-- BLOG_NOTES_END -->"
META_RE = re.compile(
    r'<script id="blog-meta" type="application/json">(.*?)</script>', re.DOTALL
)
PLACEHOLDER_RE = re.compile(r"{{([A-Z0-9_]+)}}")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def normalize(text: str) -> str:
    return text.replace("\r\n", "\n")


def load_config() -> dict[str, str]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    required = {
        "domain",
        "site_name",
        "section",
        "slug_prefix",
        "back_label",
        "active_nav",
        "cover_label",
        "footer_kicker",
        "footer_heading",
    }
    missing = sorted(required - config.keys())
    if missing:
        raise ValueError(f"Missing blog-config.json keys: {', '.join(missing)}")
    config["domain"] = config["domain"].rstrip("/")
    parsed = urlparse(config["domain"])
    if parsed.scheme != "https" or not parsed.hostname or parsed.path:
        raise ValueError("domain must be an HTTPS origin without a path")
    if config["active_nav"] not in {"pre", "post", "inference"}:
        raise ValueError("active_nav must be pre, post, or inference")
    return config


def validate_meta(meta: dict[str, str], config: dict[str, str]) -> None:
    required = {"slug", "title", "description", "date", "read_time"}
    missing = sorted(required - meta.keys())
    if missing:
        raise ValueError(f"Blog metadata is missing: {', '.join(missing)}")
    if not SLUG_RE.fullmatch(meta["slug"]):
        raise ValueError("slug must contain lowercase words separated by hyphens")
    if not meta["slug"].startswith(config["slug_prefix"]):
        raise ValueError(f"slug must start with {config['slug_prefix']}")
    datetime.strptime(meta["date"], "%Y-%m-%d")
    if not re.fullmatch(r"[1-9][0-9]* min read", meta["read_time"]):
        raise ValueError('read_time must look like "6 min read"')
    for key in ("title", "description"):
        if not meta[key].strip() or any(token in meta[key] for token in ("<", ">")):
            raise ValueError(f"{key} must be non-empty plain text")


def display_date(iso_date: str) -> str:
    parsed = datetime.strptime(iso_date, "%Y-%m-%d")
    return f"{parsed.day} {parsed.strftime('%b %Y')}"


def json_for_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )


def replace_placeholders(template: str, values: dict[str, str]) -> str:
    missing = sorted(set(PLACEHOLDER_RE.findall(template)) - values.keys())
    if missing:
        raise ValueError(f"Template placeholders have no value: {', '.join(missing)}")
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    leftovers = sorted(set(PLACEHOLDER_RE.findall(rendered)))
    if leftovers:
        raise ValueError(f"Unresolved template placeholders: {', '.join(leftovers)}")
    return rendered


def render_page(meta: dict[str, str], content: str, config: dict[str, str]) -> str:
    validate_meta(meta, config)
    canonical = f"{config['domain']}/{meta['slug']}.html"
    structured_data = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "@id": canonical + "#article",
        "url": canonical,
        "headline": meta["title"],
        "description": meta["description"],
        "inLanguage": "en",
        "image": ["https://artofcyberai.com/og-image.png"],
        "datePublished": meta["date"],
        "dateModified": meta["date"],
        "author": {
            "@type": "Person",
            "name": "Vikram Kharvi",
            "url": "https://artofcyberai.com/",
        },
        "publisher": {
            "@type": "Person",
            "name": "Vikram Kharvi",
            "url": "https://artofcyberai.com/",
        },
        "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
        "isPartOf": {
            "@type": "Blog",
            "@id": config["domain"] + "/#blog",
            "name": config["site_name"],
            "url": config["domain"] + "/",
        },
    }
    escaped = {key: html.escape(str(value), quote=True) for key, value in meta.items()}
    current = ' aria-current="page"'
    values = {
        "META_JSON": json_for_script(meta),
        "JSON_LD": json_for_script(structured_data),
        "CANONICAL": html.escape(canonical, quote=True),
        "SITE_NAME": html.escape(config["site_name"], quote=True),
        "SECTION": html.escape(config["section"]),
        "TITLE": escaped["title"],
        "DESCRIPTION": escaped["description"],
        "DATE_ISO": escaped["date"],
        "DATE_DISPLAY": html.escape(display_date(meta["date"])),
        "READ_TIME": escaped["read_time"],
        "PAGE_TITLE": html.escape(
            f"{config['section']} research: {meta['title']} - Vikram Kharvi"
        ),
        "BACK_LABEL": html.escape(config["back_label"]),
        "COVER_LABEL": html.escape(config["cover_label"]),
        "FOOTER_KICKER": html.escape(config["footer_kicker"]),
        "FOOTER_HEADING": html.escape(config["footer_heading"]),
        "ACTIVE_PRE": current if config["active_nav"] == "pre" else "",
        "ACTIVE_POST": current if config["active_nav"] == "post" else "",
        "ACTIVE_INFERENCE": current if config["active_nav"] == "inference" else "",
        "BLOG_CONTENT": content.strip("\r\n"),
    }
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    return replace_placeholders(template, values).rstrip() + "\n"


def extract_page(path: Path) -> tuple[dict[str, str], str, str]:
    source = normalize(path.read_text(encoding="utf-8"))
    meta_match = META_RE.search(source)
    if not meta_match:
        raise ValueError(f"{path.name}: missing blog-meta JSON")
    if source.count(CONTENT_START) != 1 or source.count(CONTENT_END) != 1:
        raise ValueError(f"{path.name}: content markers must appear exactly once")
    start = source.index(CONTENT_START) + len(CONTENT_START)
    end = source.index(CONTENT_END, start)
    meta = json.loads(meta_match.group(1))
    return meta, source[start:end].strip("\n"), source


def managed_pages() -> list[tuple[Path, dict[str, str], str, str]]:
    pages = []
    for path in sorted(ROOT.glob("*.html")):
        source = normalize(path.read_text(encoding="utf-8"))
        if 'id="blog-meta"' not in source:
            continue
        meta, content, source = extract_page(path)
        pages.append((path, meta, content, source))
    return pages


def render_notes(pages: list[tuple[Path, dict[str, str], str, str]]) -> str:
    if not pages:
        return ""
    ordered = sorted(pages, key=lambda item: (item[1]["date"], item[1]["slug"]), reverse=True)
    cards = []
    for _, meta, _, _ in ordered:
        cards.append(
            '      <li class="title-item is-published reveal" data-managed-blog="{slug}"><a href="{slug}.html"><div class="issue-number">+</div><div class="issue-copy"><div class="issue-meta"><span>Research note · {date}</span><span>{read_time}</span></div><h3>{title}</h3><p>{description}</p></div><span class="issue-action">Read <b>&nearr;</b></span></a></li>'.format(
                slug=html.escape(meta["slug"], quote=True),
                date=html.escape(display_date(meta["date"])),
                read_time=html.escape(meta["read_time"]),
                title=html.escape(meta["title"]),
                description=html.escape(meta["description"]),
            )
        )
    return "\n".join(
        [
            '<section class="title-board tech-board" aria-labelledby="research-notes-title">',
            '  <div class="title-board-heading reveal">',
            '    <div><p class="section-index">New research</p><h2 id="research-notes-title">Latest research notes</h2></div>',
            '    <p>Standalone technical blogs that extend the core research map.</p>',
            '  </div>',
            '  <ol class="title-list tech-title-list">',
            *cards,
            '  </ol>',
            '</section>',
        ]
    )


def replace_notes_region(source: str, rendered_notes: str) -> str:
    if source.count(NOTES_START) != 1 or source.count(NOTES_END) != 1:
        raise ValueError("index.html must contain exactly one pair of blog-note markers")
    start = source.index(NOTES_START) + len(NOTES_START)
    end = source.index(NOTES_END, start)
    middle = "\n" + rendered_notes.rstrip() + "\n" if rendered_notes else "\n"
    return source[:start] + middle + source[end:]


def sitemap_urls() -> set[str]:
    root = ET.fromstring(SITEMAP_PATH.read_text(encoding="utf-8"))
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    return {
        node.text.strip()
        for node in root.findall("sm:url/sm:loc", namespace)
        if node.text
    }


def sync_sitemap(pages: list[tuple[Path, dict[str, str], str, str]]) -> None:
    source = normalize(SITEMAP_PATH.read_text(encoding="utf-8"))
    urls = sitemap_urls()
    additions = []
    config = load_config()
    for _, meta, _, _ in pages:
        url = f"{config['domain']}/{meta['slug']}.html"
        if url not in urls:
            additions.append(
                f"  <url><loc>{html.escape(url)}</loc><lastmod>{meta['date']}</lastmod></url>"
            )
    if additions:
        source = source.replace("</urlset>", "\n".join(additions) + "\n</urlset>")
        SITEMAP_PATH.write_text(source, encoding="utf-8", newline="\n")


def sync() -> None:
    config = load_config()
    pages = managed_pages()
    for path, meta, content, _ in pages:
        path.write_text(render_page(meta, content, config), encoding="utf-8", newline="\n")
    index_source = normalize(INDEX_PATH.read_text(encoding="utf-8"))
    INDEX_PATH.write_text(
        replace_notes_region(index_source, render_notes(pages)),
        encoding="utf-8",
        newline="\n",
    )
    sync_sitemap(pages)


def check() -> None:
    config = load_config()
    expected_host = urlparse(config["domain"]).hostname
    if CNAME_PATH.read_text(encoding="utf-8").strip() != expected_host:
        raise ValueError("CNAME does not match blog-config.json")

    index_source = normalize(INDEX_PATH.read_text(encoding="utf-8"))
    pages = managed_pages()
    expected_index = replace_notes_region(index_source, render_notes(pages))
    if expected_index != index_source:
        raise ValueError("index.html research-note block is stale; run blog_tool.py sync")

    urls = sitemap_urls()
    for url in urls:
        parsed = urlparse(url)
        if parsed.hostname != expected_host or not parsed.path.endswith(".html"):
            continue
        local_path = ROOT / parsed.path.lstrip("/")
        if not local_path.is_file():
            raise ValueError(f"sitemap URL has no local page: {url}")

    for path, meta, content, source in pages:
        validate_meta(meta, config)
        if path.name != meta["slug"] + ".html":
            raise ValueError(f"{path.name}: filename and metadata slug differ")
        if "BLOG_DRAFT" in content:
            raise ValueError(f"{path.name}: replace the draft content block before committing")
        expected_page = normalize(render_page(meta, content, config))
        if expected_page != source:
            raise ValueError(f"{path.name}: site shell changed; run blog_tool.py sync")
        canonical = f"{config['domain']}/{meta['slug']}.html"
        if canonical not in urls:
            raise ValueError(f"{path.name}: missing from sitemap.xml")

    chat_source = SITE_CHAT_PATH.read_text(encoding="utf-8")
    required_sitemaps = {
        "https://pre-trained.artofcyberai.com/sitemap.xml",
        "https://trainrl.com/sitemap.xml",
        "https://inference.artofcyberai.com/sitemap.xml",
    }
    if "const SITEMAP_URLS" not in chat_source or not required_sitemaps.issubset(
        {url for url in required_sitemaps if url in chat_source}
    ):
        raise ValueError("site-chat.js must discover all three canonical sitemaps")

    print(
        f"PASS: {config['site_name']} blog contract; "
        f"{len(pages)} managed research note(s), {len(urls)} sitemap URL(s)."
    )


def draft_content(title: str) -> str:
    return f'''    <!-- BLOG_DRAFT: replace everything in this content block before committing -->
    <section class="article-section reveal" id="overview">
      <aside><span>01</span><p>The question</p></aside>
      <div>
        <h2>{html.escape(title)}</h2>
        <p>State the technical problem, explain the mechanism, separate evidence from opinion, and cover tradeoffs and failure modes.</p>
      </div>
    </section>'''


def new_blog(args: argparse.Namespace) -> None:
    config = load_config()
    meta = {
        "slug": args.slug,
        "title": args.title,
        "description": args.description,
        "date": args.date,
        "read_time": args.read_time,
    }
    validate_meta(meta, config)
    path = ROOT / f"{meta['slug']}.html"
    if path.exists():
        raise ValueError(f"{path.name} already exists")
    path.write_text(
        render_page(meta, draft_content(meta["title"]), config),
        encoding="utf-8",
        newline="\n",
    )
    sync()
    print(f"Created {path.name} and registered it in index.html and sitemap.xml.")
    print(f"Edit only the block between {CONTENT_START} and {CONTENT_END}.")
    print("CI will reject the BLOG_DRAFT marker until the draft block is replaced.")


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    subcommands = command.add_subparsers(dest="command", required=True)
    new = subcommands.add_parser("new", help="create and register a new research blog")
    new.add_argument("--slug", required=True)
    new.add_argument("--title", required=True)
    new.add_argument("--description", required=True)
    new.add_argument("--date", default=date.today().isoformat())
    new.add_argument("--read-time", default="5 min read")
    subcommands.add_parser("sync", help="restore managed shells and generated indexes")
    subcommands.add_parser("check", help="validate the blog content contract")
    return command


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "new":
            new_blog(args)
        elif args.command == "sync":
            sync()
            check()
        else:
            check()
    except (ValueError, OSError, ET.ParseError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
