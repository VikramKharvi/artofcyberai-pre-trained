# Adding a research blog

The scaffold owns the page shell, navigation, metadata, footer, landing-page card, sitemap entry, and assistant discovery. You write only the marked content block.

## 1. Create and register the page

Run this from the repository root, using the slug prefix required by `blog-config.json`:

```bash
python scripts/blog_tool.py new \
  --slug tech-example-topic \
  --title "Example topic" \
  --description "One precise sentence describing the technical question." \
  --read-time "6 min read"
```

The command creates the HTML page and updates `index.html` and `sitemap.xml`.

## 2. Edit one block

In the new HTML file, replace everything between:

```html
<!-- BLOG_CONTENT_START -->
<!-- BLOG_CONTENT_END -->
```

Use the existing `article-section`, table, equation, code, figure, and list classes. Do not edit the generated head, navigation, hero, closing section, footer, or scripts.

## 3. Validate before pushing

```bash
python scripts/blog_tool.py check
```

The GitHub Actions workflow runs the same check on every pull request and every push to `main`. It fails when the generated shell changes, the draft marker remains, the landing-page block is stale, a sitemap URL has no file, or assistant discovery is not connected to all three lifecycle sitemaps.

If the shared template or metadata was intentionally changed, restore every managed shell and generated landing block with:

```bash
python scripts/blog_tool.py sync
```

For enforcement before merge, make the `Blog content contract / validate` status check required in the repository's `main` branch protection settings.
