import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class BlogToolTest(unittest.TestCase):
    def run_tool(self, root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "scripts/blog_tool.py", *arguments],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_new_blog_is_registered_and_only_content_is_editable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            sandbox = Path(temporary_directory) / "site"
            shutil.copytree(
                ROOT,
                sandbox,
                ignore=shutil.ignore_patterns(".git", "__pycache__"),
            )
            config = json.loads((sandbox / "blog-config.json").read_text(encoding="utf-8"))
            slug = config["slug_prefix"] + "ci-contract-test"
            created = self.run_tool(
                sandbox,
                "new",
                "--slug",
                slug,
                "--title",
                "CI contract test",
                "--description",
                "A disposable page used to verify the blog authoring contract.",
                "--date",
                "2026-08-18",
                "--read-time",
                "4 min read",
            )
            self.assertEqual(created.returncode, 0, created.stderr)

            draft_check = self.run_tool(sandbox, "check")
            self.assertNotEqual(draft_check.returncode, 0)
            self.assertIn("replace the draft content block", draft_check.stderr)

            page_path = sandbox / f"{slug}.html"
            page = page_path.read_text(encoding="utf-8")
            page = re.sub(r"(?m)^\s*<!-- BLOG_DRAFT:.*?-->\n", "", page)
            page_path.write_text(page, encoding="utf-8", newline="\n")

            final_check = self.run_tool(sandbox, "check")
            self.assertEqual(final_check.returncode, 0, final_check.stderr)
            self.assertIn(f'{slug}.html', (sandbox / "index.html").read_text(encoding="utf-8"))
            self.assertIn(f'{slug}.html', (sandbox / "sitemap.xml").read_text(encoding="utf-8"))

            page_path.write_text(
                page.replace('<nav class="site-nav"', '<nav data-test="changed" class="site-nav"', 1),
                encoding="utf-8",
                newline="\n",
            )
            shell_check = self.run_tool(sandbox, "check")
            self.assertNotEqual(shell_check.returncode, 0)
            self.assertIn("site shell changed", shell_check.stderr)


if __name__ == "__main__":
    unittest.main()
