#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "huggingface_hub",
#     "pyyaml",
#     "requests",
#     "markdown>=3.5.0",
#     "python-dotenv",
# ]
# ///
"""
Paper Manager for Hugging Face Hub
Manages paper indexing, linking, authorship, search, daily papers, and article creation.

API Endpoints used:
  GET /api/papers/{arxiv_id}         - Single paper metadata
  GET /api/papers/search?q=          - Search papers
  GET /api/daily_papers?date=        - Daily curated papers
"""

import argparse
import os
import sys
import re
import json
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, date

try:
    from huggingface_hub import HfApi, hf_hub_download, get_token
    import yaml
    import requests
    import markdown as md_lib
    from dotenv import load_dotenv
except ImportError as e:
    print(f"Error: Missing required dependency: {e}", file=sys.stderr)
    print("Tip: run this script with `uv run scripts/paper_manager.py ...`.", file=sys.stderr)
    sys.exit(1)

# Load environment variables
load_dotenv()

HF_API_BASE = "https://huggingface.co/api"


class PaperManager:
    """Manages paper publishing operations on Hugging Face Hub."""

    def __init__(self, hf_token: Optional[str] = None):
        """Initialize Paper Manager with HF token."""
        self.token = hf_token or os.getenv("HF_TOKEN") or get_token()
        if not self.token:
            print("Warning: No HF_TOKEN found. Some operations will fail.", file=sys.stderr)
        self.api = HfApi(token=self.token)
        self.session = requests.Session()
        if self.token:
            self.session.headers["Authorization"] = f"Bearer {self.token}"

    # ------------------------------------------------------------------
    # Paper lookup
    # ------------------------------------------------------------------

    def get_paper(self, arxiv_id: str) -> Dict[str, Any]:
        """
        Fetch full paper metadata from Hugging Face.

        Args:
            arxiv_id: arXiv identifier (e.g., "2301.12345")

        Returns:
            dict: Paper metadata or error
        """
        arxiv_id = self._clean_arxiv_id(arxiv_id)
        url = f"{HF_API_BASE}/papers/{arxiv_id}"
        resp = self.session.get(url, timeout=15)
        if resp.status_code == 404:
            return {"error": "not_found", "message": f"Paper {arxiv_id} not indexed on HF"}
        resp.raise_for_status()
        return resp.json()

    def index_paper(self, arxiv_id: str) -> Dict[str, Any]:
        """
        Index a paper on Hugging Face from arXiv.
        Visiting the paper URL triggers indexing.

        Args:
            arxiv_id: arXiv identifier

        Returns:
            dict: Status information
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"status": "error", "message": str(e)}

        paper_url = f"https://huggingface.co/papers/{arxiv_id}"

        try:
            # GET the paper page — HF indexes on first visit
            response = self.session.get(paper_url, timeout=15)
            if response.status_code == 200:
                print(f"Paper indexed at {paper_url}", file=sys.stderr)
                return {"status": "indexed", "url": paper_url, "arxiv_id": arxiv_id}
            else:
                print(f"Paper not found. Visit {paper_url} to trigger indexing.", file=sys.stderr)
                return {"status": "not_indexed", "url": paper_url, "action": "visit_url"}
        except requests.RequestException as e:
            return {"status": "error", "message": str(e)}

    def check_paper(self, arxiv_id: str) -> Dict[str, Any]:
        """
        Check if a paper exists on Hugging Face and return its metadata.

        Args:
            arxiv_id: arXiv identifier

        Returns:
            dict: Paper status and metadata
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"exists": False, "error": str(e)}

        data = self.get_paper(arxiv_id)
        if "error" in data:
            return {
                "exists": False,
                "arxiv_id": arxiv_id,
                "index_url": f"https://huggingface.co/papers/{arxiv_id}",
                "message": f"Visit the URL to index this paper",
            }

        return {
            "exists": True,
            "arxiv_id": arxiv_id,
            "title": data.get("title"),
            "upvotes": data.get("upvotes", 0),
            "authors": [a.get("name") for a in data.get("authors", [])],
            "url": f"https://huggingface.co/papers/{arxiv_id}",
            "arxiv_url": f"https://arxiv.org/abs/{arxiv_id}",
        }

    # ------------------------------------------------------------------
    # Search & daily papers
    # ------------------------------------------------------------------

    def search_papers(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Search papers on Hugging Face.

        Args:
            query: Search query string
            limit: Max results to return

        Returns:
            list: Matching papers
        """
        url = f"{HF_API_BASE}/papers/search"
        resp = self.session.get(url, params={"q": query}, timeout=15)
        resp.raise_for_status()
        papers = resp.json()

        results = []
        for entry in papers[:limit]:
            paper = entry.get("paper", entry)
            results.append({
                "arxiv_id": paper.get("id"),
                "title": paper.get("title"),
                "upvotes": paper.get("upvotes", 0),
                "summary": (paper.get("ai_summary") or paper.get("summary", ""))[:200],
                "authors": [a.get("name") for a in paper.get("authors", [])][:5],
                "url": f"https://huggingface.co/papers/{paper.get('id')}",
            })

        return results

    def daily_papers(self, date_str: Optional[str] = None, limit: int = 30) -> List[Dict[str, Any]]:
        """
        Fetch daily curated papers from Hugging Face.

        Args:
            date_str: Date in YYYY-MM-DD format (defaults to today)
            limit: Max results to return

        Returns:
            list: Daily papers
        """
        params = {}
        if date_str:
            # Validate date format
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                return [{"error": f"Invalid date format: {date_str}. Use YYYY-MM-DD"}]
            params["date"] = date_str

        url = f"{HF_API_BASE}/daily_papers"
        resp = self.session.get(url, params=params, timeout=15)
        resp.raise_for_status()
        papers = resp.json()

        results = []
        for entry in papers[:limit]:
            paper = entry.get("paper", entry)
            results.append({
                "arxiv_id": paper.get("id"),
                "title": paper.get("title") or entry.get("title"),
                "upvotes": paper.get("upvotes", 0),
                "summary": (paper.get("ai_summary") or paper.get("summary", ""))[:200],
                "num_comments": entry.get("numComments", 0),
                "submitted_by": (entry.get("submittedBy") or {}).get("name"),
                "url": f"https://huggingface.co/papers/{paper.get('id')}",
            })

        return results

    # ------------------------------------------------------------------
    # Linking papers to repos
    # ------------------------------------------------------------------

    def link_paper_to_repo(
        self,
        repo_id: str,
        arxiv_id: str,
        repo_type: str = "model",
        citation: Optional[str] = None,
        create_pr: bool = False,
    ) -> Dict[str, Any]:
        """
        Link a paper to a model/dataset/space repository by updating its README.

        Args:
            repo_id: Repository identifier (e.g., "username/repo-name")
            arxiv_id: arXiv identifier
            repo_type: Type of repository ("model", "dataset", or "space")
            citation: Optional full citation text
            create_pr: Create a PR instead of direct commit

        Returns:
            dict: Operation status
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"status": "error", "message": str(e)}

        print(f"Linking paper {arxiv_id} to {repo_type} {repo_id}...", file=sys.stderr)

        try:
            readme_path = hf_hub_download(
                repo_id=repo_id,
                filename="README.md",
                repo_type=repo_type,
                token=self.token,
            )
            with open(readme_path, "r", encoding="utf-8") as f:
                content = f.read()

            updated_content = self._add_paper_to_readme(content, arxiv_id, citation)
            commit_message = f"Add paper reference: arXiv:{arxiv_id}"

            self.api.upload_file(
                path_or_fileobj=updated_content.encode("utf-8"),
                path_in_repo="README.md",
                repo_id=repo_id,
                repo_type=repo_type,
                commit_message=commit_message,
                create_pr=create_pr,
                token=self.token,
            )

            paper_url = f"https://huggingface.co/papers/{arxiv_id}"
            repo_prefix = {"model": "", "dataset": "datasets/", "space": "spaces/"}
            repo_url = f"https://huggingface.co/{repo_prefix.get(repo_type, '')}{repo_id}"

            print(f"Linked paper to repository", file=sys.stderr)
            print(f"  Paper: {paper_url}", file=sys.stderr)
            print(f"  Repo:  {repo_url}", file=sys.stderr)

            return {
                "status": "success",
                "paper_url": paper_url,
                "repo_url": repo_url,
                "arxiv_id": arxiv_id,
                "pr_created": create_pr,
            }

        except Exception as e:
            return {"status": "error", "message": str(e)}

    def _add_paper_to_readme(
        self,
        content: str,
        arxiv_id: str,
        citation: Optional[str] = None,
    ) -> str:
        """Add paper reference to README content."""
        arxiv_url = f"https://arxiv.org/abs/{arxiv_id}"
        hf_paper_url = f"https://huggingface.co/papers/{arxiv_id}"

        yaml_pattern = r"^---\s*\n(.*?)\n---\s*\n"
        match = re.match(yaml_pattern, content, re.DOTALL)

        if match:
            if arxiv_id in content:
                print(f"Paper {arxiv_id} already referenced in README", file=sys.stderr)
                return content
            yaml_end = match.end()
            before = content[:yaml_end]
            after = content[yaml_end:]
        else:
            before = "---\n---\n\n"
            after = content

        paper_section = "\n<!-- paper-manager:start -->\n"
        paper_section += "## Paper\n\n"
        paper_section += "This work is based on research presented in:\n\n"
        paper_section += f"**[View on arXiv]({arxiv_url})** | "
        paper_section += f"**[View on Hugging Face]({hf_paper_url})**\n\n"

        if citation:
            safe_citation = self._sanitize_text(citation)
            paper_section += f"### Citation\n\n```bibtex\n{safe_citation}\n```\n\n"

        paper_section += "<!-- paper-manager:end -->\n"

        return before + paper_section + after

    # ------------------------------------------------------------------
    # Authorship
    # ------------------------------------------------------------------

    def claim_authorship(self, arxiv_id: str, email: Optional[str] = None) -> Dict[str, Any]:
        """
        Guide the user through claiming authorship on a paper.
        Authorship claims require manual verification via the HF web UI.

        Args:
            arxiv_id: arXiv identifier
            email: Author's institutional email

        Returns:
            dict: Instructions for claiming authorship
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"status": "error", "message": str(e)}

        paper_data = self.get_paper(arxiv_id)
        if "error" in paper_data:
            return {
                "status": "error",
                "message": f"Paper {arxiv_id} not found on HF. Index it first.",
            }

        authors = [a.get("name") for a in paper_data.get("authors", [])]
        claimed = [
            a.get("name")
            for a in paper_data.get("authors", [])
            if a.get("status") == "claimed_verified"
        ]

        paper_url = f"https://huggingface.co/papers/{arxiv_id}"

        return {
            "status": "manual_action_required",
            "paper_url": paper_url,
            "authors": authors,
            "already_claimed": claimed,
            "instructions": [
                f"1. Navigate to {paper_url}",
                "2. Find your name in the author list",
                "3. Click your name and select 'Claim authorship'",
                "4. Verify with your institutional email" + (f" ({email})" if email else ""),
                "5. Wait for admin team verification",
            ],
        }

    def check_authorship(self, arxiv_id: str) -> Dict[str, Any]:
        """
        Check authorship claim status for a paper.

        Args:
            arxiv_id: arXiv identifier

        Returns:
            dict: Authorship status for all authors
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"error": str(e)}

        paper_data = self.get_paper(arxiv_id)
        if "error" in paper_data:
            return {"error": f"Paper {arxiv_id} not found"}

        authors_status = []
        for author in paper_data.get("authors", []):
            entry = {
                "name": author.get("name"),
                "status": author.get("status", "unclaimed"),
                "hidden": author.get("hidden", False),
            }
            user = author.get("user")
            if user:
                entry["hf_username"] = user.get("user") or user.get("name")
            authors_status.append(entry)

        return {
            "arxiv_id": arxiv_id,
            "title": paper_data.get("title"),
            "authors": authors_status,
        }

    # ------------------------------------------------------------------
    # Paper visibility (user profile)
    # ------------------------------------------------------------------

    def list_my_papers(self) -> Dict[str, Any]:
        """
        List papers associated with the authenticated user.
        Uses the HF API to find the user's profile and their papers.

        Returns:
            dict: User's papers or error
        """
        if not self.token:
            return {"error": "HF_TOKEN required to list your papers"}

        try:
            user_info = self.api.whoami()
            username = user_info.get("name")
            if not username:
                return {"error": "Could not determine username from token"}

            # Search for papers by this user across daily papers
            # The HF API doesn't have a direct "my papers" endpoint,
            # so we search and filter by author
            url = f"{HF_API_BASE}/papers/search"
            resp = self.session.get(url, params={"q": username}, timeout=15)
            resp.raise_for_status()
            all_papers = resp.json()

            my_papers = []
            for entry in all_papers:
                paper = entry.get("paper", entry)
                authors = paper.get("authors", [])
                # Check if user is an author (by HF username or name match)
                is_author = any(
                    (a.get("user", {}) or {}).get("user") == username
                    or (a.get("user", {}) or {}).get("name") == username
                    for a in authors
                )
                if is_author:
                    my_papers.append({
                        "arxiv_id": paper.get("id"),
                        "title": paper.get("title"),
                        "upvotes": paper.get("upvotes", 0),
                        "published": paper.get("publishedAt"),
                        "url": f"https://huggingface.co/papers/{paper.get('id')}",
                    })

            return {
                "username": username,
                "papers_found": len(my_papers),
                "papers": my_papers,
                "note": "This searches by username. For complete list, visit your HF profile settings.",
            }

        except Exception as e:
            return {"error": str(e)}

    def toggle_visibility(self, arxiv_id: str, show: bool = True) -> Dict[str, Any]:
        """
        Guide the user through toggling paper visibility on their profile.
        This requires manual action via the HF web UI.

        Args:
            arxiv_id: arXiv identifier
            show: Whether to show (True) or hide (False) on profile

        Returns:
            dict: Instructions
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"status": "error", "message": str(e)}

        action = "show" if show else "hide"
        return {
            "status": "manual_action_required",
            "arxiv_id": arxiv_id,
            "action": action,
            "instructions": [
                "1. Navigate to https://huggingface.co/settings/papers",
                f"2. Find paper {arxiv_id} in your claimed papers list",
                f"3. Toggle 'Show on profile' to {'on' if show else 'off'}",
            ],
        }

    # ------------------------------------------------------------------
    # arXiv metadata
    # ------------------------------------------------------------------

    def get_arxiv_info(self, arxiv_id: str) -> Dict[str, Any]:
        """
        Fetch paper information from arXiv API.

        Args:
            arxiv_id: arXiv identifier

        Returns:
            dict: Paper metadata
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return {"error": str(e)}

        api_url = f"https://export.arxiv.org/api/query?id_list={arxiv_id}"

        try:
            response = requests.get(api_url, timeout=15)
            response.raise_for_status()
            content = response.text

            title_match = re.search(r"<title>(.*?)</title>", content, re.DOTALL)
            authors_matches = re.findall(r"<name>(.*?)</name>", content)
            summary_match = re.search(r"<summary>(.*?)</summary>", content, re.DOTALL)

            # First <title> is the feed title, skip it
            all_titles = re.findall(r"<title>(.*?)</title>", content, re.DOTALL)
            raw_title = all_titles[1].strip() if len(all_titles) > 1 else None
            raw_authors = authors_matches if authors_matches else []
            raw_abstract = summary_match.group(1).strip() if summary_match else None

            return {
                "arxiv_id": arxiv_id,
                "title": self._sanitize_text(raw_title) if raw_title else None,
                "authors": [self._sanitize_text(a) for a in raw_authors],
                "abstract": self._sanitize_text(raw_abstract) if raw_abstract else None,
                "arxiv_url": f"https://arxiv.org/abs/{arxiv_id}",
                "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
            }
        except Exception as e:
            return {"error": str(e)}

    def generate_citation(self, arxiv_id: str, fmt: str = "bibtex") -> str:
        """
        Generate citation for a paper.

        Args:
            arxiv_id: arXiv identifier
            fmt: Citation format ("bibtex", "apa", "mla")

        Returns:
            str: Formatted citation
        """
        try:
            arxiv_id = self._clean_arxiv_id(arxiv_id)
        except ValueError as e:
            return f"Error: {e}"

        info = self.get_arxiv_info(arxiv_id)
        if "error" in info:
            return f"Error fetching paper info: {info['error']}"

        authors = info.get("authors", ["Unknown"])
        title = info.get("title", "Untitled")
        year_prefix = arxiv_id.split(".")[0][:2]
        year = f"20{year_prefix}" if int(year_prefix) < 50 else f"19{year_prefix}"

        if fmt == "bibtex":
            key = f"arxiv{arxiv_id.replace('.', '_')}"
            safe_title = title.replace("{", r"\{").replace("}", r"\}")
            safe_authors = " and ".join(authors).replace("{", r"\{").replace("}", r"\}")
            return (
                f"@article{{{key},\n"
                f"  title={{{safe_title}}},\n"
                f"  author={{{safe_authors}}},\n"
                f"  journal={{arXiv preprint arXiv:{arxiv_id}}},\n"
                f"  year={{{year}}}\n"
                f"}}"
            )

        if fmt == "apa":
            if len(authors) > 7:
                author_str = ", ".join(authors[:6]) + ", ... " + authors[-1]
            else:
                author_str = ", ".join(authors[:-1]) + ", & " + authors[-1] if len(authors) > 1 else authors[0]
            return f"{author_str} ({year}). {title}. arXiv preprint arXiv:{arxiv_id}."

        if fmt == "mla":
            if len(authors) > 2:
                author_str = authors[0] + ", et al."
            elif len(authors) == 2:
                author_str = authors[0] + ", and " + authors[1]
            else:
                author_str = authors[0]
            return f'{author_str}. "{title}." arXiv preprint arXiv:{arxiv_id} ({year}).'

        return f"Format '{fmt}' not supported. Use bibtex, apa, or mla."

    # ------------------------------------------------------------------
    # Article creation & conversion
    # ------------------------------------------------------------------

    def create_research_article(
        self,
        template: str,
        title: str,
        output: str,
        authors: Optional[str] = None,
        abstract: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a research article from template.

        Args:
            template: Template name ("standard", "modern", "arxiv", "ml-report")
            title: Paper title
            output: Output filename
            authors: Comma-separated author names
            abstract: Abstract text

        Returns:
            dict: Creation status
        """
        template_dir = Path(__file__).parent.parent / "templates"
        template_file = template_dir / f"{template}.md"

        if not template_file.exists():
            available = [f.stem for f in template_dir.glob("*.md")]
            return {
                "status": "error",
                "message": f"Template '{template}' not found. Available: {available}",
            }

        with open(template_file, "r", encoding="utf-8") as f:
            template_content = f.read()

        date_str = datetime.now().strftime("%Y-%m-%d")
        authors_val = authors if authors else "Your Name"
        abstract_val = abstract if abstract else "Abstract to be written..."

        safe_title_body = self._sanitize_text(title)
        safe_authors_body = self._sanitize_text(authors_val)
        safe_abstract_body = self._sanitize_text(abstract_val)

        fm_pattern = r"^(---\s*\n)(.*?\n)(---\s*\n)"
        fm_match = re.match(fm_pattern, template_content, re.DOTALL)

        if fm_match:
            fm_open = fm_match.group(1)
            fm_body = fm_match.group(2)
            fm_close = fm_match.group(3)
            body = template_content[fm_match.end():]

            fm_body = fm_body.replace("{{TITLE}}", self._escape_yaml_value(title))
            fm_body = fm_body.replace("{{AUTHORS}}", self._escape_yaml_value(authors_val))
            fm_body = fm_body.replace("{{DATE}}", date_str)

            body = body.replace("{{TITLE}}", safe_title_body)
            body = body.replace("{{AUTHORS}}", safe_authors_body)
            body = body.replace("{{ABSTRACT}}", safe_abstract_body)
            body = body.replace("{{DATE}}", date_str)

            content = fm_open + fm_body + fm_close + body
        else:
            content = template_content
            content = content.replace("{{TITLE}}", safe_title_body)
            content = content.replace("{{DATE}}", date_str)
            content = content.replace("{{AUTHORS}}", safe_authors_body)
            content = content.replace("{{ABSTRACT}}", safe_abstract_body)

        with open(output, "w", encoding="utf-8") as f:
            f.write(content)

        print(f"Research article created at {output}", file=sys.stderr)
        return {"status": "success", "output": output, "template": template}

    def convert_to_html(
        self,
        input_path: str,
        output_path: str,
        style: str = "modern",
    ) -> Dict[str, Any]:
        """
        Convert a markdown research article to styled HTML.

        Args:
            input_path: Path to input markdown file
            output_path: Path for output HTML file
            style: Style theme ("modern" or "classic")

        Returns:
            dict: Conversion status
        """
        input_file = Path(input_path)
        if not input_file.exists():
            return {"status": "error", "message": f"Input file not found: {input_path}"}

        with open(input_file, "r", encoding="utf-8") as f:
            content = f.read()

        # Strip YAML frontmatter but extract metadata
        metadata = {}
        fm_pattern = r"^---\s*\n(.*?)\n---\s*\n"
        fm_match = re.match(fm_pattern, content, re.DOTALL)
        if fm_match:
            try:
                metadata = yaml.safe_load(fm_match.group(1)) or {}
            except yaml.YAMLError:
                pass
            content = content[fm_match.end():]

        # Convert markdown to HTML
        html_body = md_lib.markdown(
            content,
            extensions=["tables", "fenced_code", "toc", "attr_list"],
        )

        title = metadata.get("title", "Research Article")
        authors = metadata.get("authors", "")
        paper_date = metadata.get("date", "")

        if style == "modern":
            css = MODERN_CSS
        else:
            css = CLASSIC_CSS

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{self._escape_html(str(title))}</title>
    <style>{css}</style>
</head>
<body>
    <article class="paper">
        <header class="paper-header">
            <h1>{self._escape_html(str(title))}</h1>
            <div class="authors">{self._escape_html(str(authors))}</div>
            <div class="date">{self._escape_html(str(paper_date))}</div>
        </header>
        <div class="content">
            {html_body}
        </div>
    </article>
</body>
</html>"""

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(html)

        print(f"HTML article created at {output_path}", file=sys.stderr)
        return {"status": "success", "output": output_path, "style": style}

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def validate_repo_papers(self, repo_id: str, repo_type: str = "model") -> Dict[str, Any]:
        """
        Validate all paper references in a repository's README.

        Args:
            repo_id: Repository identifier
            repo_type: Type of repository

        Returns:
            dict: Validation results
        """
        try:
            readme_path = hf_hub_download(
                repo_id=repo_id,
                filename="README.md",
                repo_type=repo_type,
                token=self.token,
            )
            with open(readme_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            return {"status": "error", "message": str(e)}

        # Find all arXiv references
        arxiv_ids = set()
        # Match arxiv.org URLs
        arxiv_ids.update(re.findall(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", content))
        # Match arxiv: tags
        arxiv_ids.update(re.findall(r"arxiv:(\d{4}\.\d{4,5})", content, re.IGNORECASE))

        if not arxiv_ids:
            return {
                "status": "ok",
                "repo_id": repo_id,
                "papers_found": 0,
                "message": "No arXiv references found in README",
            }

        results = []
        for aid in sorted(arxiv_ids):
            paper_data = self.get_paper(aid)
            indexed = "error" not in paper_data
            results.append({
                "arxiv_id": aid,
                "indexed_on_hf": indexed,
                "title": paper_data.get("title") if indexed else None,
                "url": f"https://huggingface.co/papers/{aid}",
            })

        all_valid = all(r["indexed_on_hf"] for r in results)
        return {
            "status": "ok" if all_valid else "warnings",
            "repo_id": repo_id,
            "papers_found": len(results),
            "all_indexed": all_valid,
            "papers": results,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    _ARXIV_ID_MODERN = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")
    _ARXIV_ID_LEGACY = re.compile(r"^[a-zA-Z\-]+/\d{7}(v\d+)?$")

    @staticmethod
    def _clean_arxiv_id(arxiv_id: str) -> str:
        """Clean, normalize, and validate arXiv ID."""
        arxiv_id = arxiv_id.strip()
        arxiv_id = re.sub(r"^(arxiv:|arXiv:)", "", arxiv_id, flags=re.IGNORECASE)
        arxiv_id = re.sub(r"https?://arxiv\.org/(abs|pdf)/", "", arxiv_id)
        arxiv_id = arxiv_id.replace(".pdf", "")

        if not (
            PaperManager._ARXIV_ID_MODERN.match(arxiv_id)
            or PaperManager._ARXIV_ID_LEGACY.match(arxiv_id)
        ):
            raise ValueError(
                f"Invalid arXiv ID: {arxiv_id!r}. "
                "Expected format: YYMM.NNNNN[vN] or category/YYMMNNN[vN]"
            )
        return arxiv_id

    @staticmethod
    def _escape_yaml_value(value: str) -> str:
        """Escape a string for safe use as a YAML scalar value."""
        value = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{value}"'

    @staticmethod
    def _sanitize_text(text: str) -> str:
        """Sanitize untrusted text for safe inclusion in Markdown/YAML output."""
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
        text = re.sub(r"[^\S\n]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = text.replace("```", r"\`\`\`")
        text = re.sub(r"^---", r"\\---", text, flags=re.MULTILINE)
        return text.strip()

    @staticmethod
    def _escape_html(text: str) -> str:
        """Escape text for safe HTML embedding."""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#x27;")
        )


# ------------------------------------------------------------------
# CSS themes for HTML conversion
# ------------------------------------------------------------------

MODERN_CSS = """
    :root {
        --primary: #2563eb;
        --bg: #ffffff;
        --text: #1e293b;
        --text-secondary: #64748b;
        --border: #e2e8f0;
        --code-bg: #f1f5f9;
        --accent-bg: #f8fafc;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        line-height: 1.8;
        color: var(--text);
        background: var(--bg);
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem 1.5rem;
    }
    .paper-header {
        text-align: center;
        margin-bottom: 3rem;
        padding-bottom: 2rem;
        border-bottom: 2px solid var(--border);
    }
    .paper-header h1 { font-size: 2rem; line-height: 1.3; margin-bottom: 1rem; }
    .authors { font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
    .date { color: var(--text-secondary); font-size: 0.9rem; }
    h2 { font-size: 1.5rem; margin: 2.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
    h3 { font-size: 1.2rem; margin: 1.5rem 0 0.75rem; }
    p { margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
    th, td { padding: 0.75rem 1rem; border: 1px solid var(--border); text-align: left; }
    th { background: var(--accent-bg); font-weight: 600; }
    pre { background: var(--code-bg); padding: 1.25rem; border-radius: 8px; overflow-x: auto; margin: 1.5rem 0; }
    code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9em; }
    blockquote { border-left: 4px solid var(--primary); padding: 0.75rem 1rem; margin: 1.5rem 0; background: var(--accent-bg); }
    ul, ol { margin: 0.75rem 0 0.75rem 1.5rem; }
    li { margin-bottom: 0.4rem; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    img { max-width: 100%; border-radius: 8px; }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .key-insight, .insight { background: #eff6ff; border-left: 4px solid var(--primary); padding: 1rem 1.25rem; margin: 1.5rem 0; border-radius: 0 8px 8px 0; }
    .limitations { background: #fef2f2; border-left: 4px solid #ef4444; padding: 1rem 1.25rem; margin: 1.5rem 0; border-radius: 0 8px 8px 0; }
    .conclusion { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 1rem 1.25rem; margin: 1.5rem 0; border-radius: 0 8px 8px 0; }
    .abstract { background: var(--accent-bg); padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; }
"""

CLASSIC_CSS = """
    body {
        font-family: 'Times New Roman', 'Computer Modern', Georgia, serif;
        line-height: 1.6;
        color: #333;
        max-width: 700px;
        margin: 0 auto;
        padding: 2rem 1.5rem;
    }
    .paper-header { text-align: center; margin-bottom: 2rem; }
    .paper-header h1 { font-size: 1.8rem; margin-bottom: 0.75rem; }
    .authors { font-size: 1rem; margin-bottom: 0.5rem; }
    .date { font-size: 0.9rem; color: #666; }
    h2 { font-size: 1.3rem; margin: 2rem 0 0.75rem; }
    h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    p { margin-bottom: 0.75rem; text-align: justify; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: 0.5rem; border: 1px solid #ccc; text-align: left; }
    th { background: #f5f5f5; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; margin: 1rem 0; font-size: 0.85rem; }
    code { font-family: 'Courier New', monospace; font-size: 0.9em; }
    blockquote { border-left: 3px solid #999; padding-left: 1rem; margin: 1rem 0; color: #555; }
    ul, ol { margin: 0.5rem 0 0.5rem 1.5rem; }
    hr { border: none; border-top: 1px solid #ccc; margin: 1.5rem 0; }
    a { color: #1a0dab; }
"""


# ------------------------------------------------------------------
# CLI
# ------------------------------------------------------------------


def _print_json(data):
    """Pretty-print JSON to stdout."""
    print(json.dumps(data, indent=2, default=str))


def _print_papers_table(papers: List[Dict], show_summary: bool = False):
    """Print papers in a human-readable table."""
    if not papers:
        print("No papers found.")
        return

    for i, p in enumerate(papers, 1):
        print(f"\n{'='*70}")
        print(f"  [{i}] {p.get('title', 'Untitled')}")
        print(f"      arXiv: {p.get('arxiv_id', 'N/A')}  |  Upvotes: {p.get('upvotes', 0)}")
        authors = p.get("authors")
        if authors:
            display = ", ".join(authors[:4])
            if len(authors) > 4:
                display += f" + {len(authors) - 4} more"
            print(f"      Authors: {display}")
        submitted_by = p.get("submitted_by")
        if submitted_by:
            print(f"      Submitted by: {submitted_by}")
        if show_summary and p.get("summary"):
            print(f"      {p['summary']}")
        print(f"      {p.get('url', '')}")
    print(f"\n{'='*70}")
    print(f"  Total: {len(papers)} papers")


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Paper Manager for Hugging Face Hub",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s daily                           # Today's papers
  %(prog)s daily --date 2026-03-20         # Papers from a specific date
  %(prog)s search --query "attention"      # Search papers
  %(prog)s check --arxiv-id 2301.12345     # Check if paper is indexed
  %(prog)s info --arxiv-id 2301.12345      # Get arXiv metadata
  %(prog)s citation --arxiv-id 2301.12345  # Generate BibTeX citation
  %(prog)s link --repo-id user/model --arxiv-id 2301.12345
  %(prog)s create --template modern --title "My Paper" --output paper.md
  %(prog)s convert --input paper.md --output paper.html
  %(prog)s validate --repo-id user/model
""",
    )
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of formatted text")

    sub = parser.add_subparsers(dest="command", help="Command to execute")

    # --- daily ---
    p_daily = sub.add_parser("daily", help="Fetch daily curated papers")
    p_daily.add_argument("--date", help="Date in YYYY-MM-DD format (default: today)")
    p_daily.add_argument("--limit", type=int, default=30, help="Max papers to show")

    # --- search ---
    p_search = sub.add_parser("search", help="Search papers on Hugging Face")
    p_search.add_argument("--query", "-q", required=True, help="Search query")
    p_search.add_argument("--limit", type=int, default=20, help="Max results")

    # --- index ---
    p_index = sub.add_parser("index", help="Index a paper from arXiv on HF")
    p_index.add_argument("--arxiv-id", required=True, help="arXiv paper ID")

    # --- check ---
    p_check = sub.add_parser("check", help="Check if paper exists on HF")
    p_check.add_argument("--arxiv-id", required=True, help="arXiv paper ID")

    # --- info ---
    p_info = sub.add_parser("info", help="Get paper metadata from arXiv")
    p_info.add_argument("--arxiv-id", required=True, help="arXiv paper ID")
    p_info.add_argument("--format", default="text", choices=["json", "text"])

    # --- citation ---
    p_cite = sub.add_parser("citation", help="Generate citation")
    p_cite.add_argument("--arxiv-id", required=True, help="arXiv paper ID")
    p_cite.add_argument("--format", default="bibtex", choices=["bibtex", "apa", "mla"])

    # --- link ---
    p_link = sub.add_parser("link", help="Link paper to a HF repository")
    p_link.add_argument("--repo-id", required=True, help="Repository ID (user/repo)")
    p_link.add_argument("--repo-type", default="model", choices=["model", "dataset", "space"])
    p_link.add_argument("--arxiv-id", help="Single arXiv ID")
    p_link.add_argument("--arxiv-ids", help="Comma-separated arXiv IDs")
    p_link.add_argument("--citation", help="Full citation text")
    p_link.add_argument("--create-pr", action="store_true", help="Create PR instead of direct commit")

    # --- claim ---
    p_claim = sub.add_parser("claim", help="Claim authorship on a paper")
    p_claim.add_argument("--arxiv-id", required=True, help="arXiv paper ID")
    p_claim.add_argument("--email", help="Your institutional email")

    # --- check-authorship ---
    p_authorship = sub.add_parser("check-authorship", help="Check authorship status")
    p_authorship.add_argument("--arxiv-id", required=True, help="arXiv paper ID")

    # --- list-my-papers ---
    sub.add_parser("list-my-papers", help="List your claimed papers")

    # --- toggle-visibility ---
    p_vis = sub.add_parser("toggle-visibility", help="Toggle paper visibility on profile")
    p_vis.add_argument("--arxiv-id", required=True, help="arXiv paper ID")
    p_vis.add_argument("--show", required=True, choices=["true", "false"], help="Show on profile")

    # --- create ---
    p_create = sub.add_parser("create", help="Create research article from template")
    p_create.add_argument("--template", required=True, help="Template: standard, modern, arxiv, ml-report")
    p_create.add_argument("--title", required=True, help="Paper title")
    p_create.add_argument("--output", required=True, help="Output filename")
    p_create.add_argument("--authors", help="Comma-separated author names")
    p_create.add_argument("--abstract", help="Abstract text")

    # --- convert ---
    p_convert = sub.add_parser("convert", help="Convert markdown article to HTML")
    p_convert.add_argument("--input", required=True, help="Input markdown file")
    p_convert.add_argument("--output", required=True, help="Output HTML file")
    p_convert.add_argument("--style", default="modern", choices=["modern", "classic"])

    # --- validate ---
    p_validate = sub.add_parser("validate", help="Validate paper links in a repository")
    p_validate.add_argument("--repo-id", required=True, help="Repository ID")
    p_validate.add_argument("--repo-type", default="model", choices=["model", "dataset", "space"])

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    use_json = args.json
    manager = PaperManager()

    # --- Execute commands ---

    if args.command == "daily":
        papers = manager.daily_papers(date_str=args.date, limit=args.limit)
        if use_json:
            _print_json(papers)
        else:
            label = args.date or "today"
            print(f"\nDaily Papers ({label}):")
            _print_papers_table(papers, show_summary=True)

    elif args.command == "search":
        papers = manager.search_papers(args.query, limit=args.limit)
        if use_json:
            _print_json(papers)
        else:
            print(f"\nSearch results for: \"{args.query}\"")
            _print_papers_table(papers, show_summary=True)

    elif args.command == "index":
        result = manager.index_paper(args.arxiv_id)
        _print_json(result)

    elif args.command == "check":
        result = manager.check_paper(args.arxiv_id)
        _print_json(result)

    elif args.command == "info":
        result = manager.get_arxiv_info(args.arxiv_id)
        if args.format == "json" or use_json:
            _print_json(result)
        else:
            if "error" in result:
                print(f"Error: {result['error']}")
            else:
                print(f"\nTitle:   {result.get('title')}")
                print(f"Authors: {', '.join(result.get('authors', []))}")
                print(f"arXiv:   {result.get('arxiv_url')}")
                print(f"PDF:     {result.get('pdf_url')}")
                abstract = result.get("abstract")
                if abstract:
                    print(f"\nAbstract:\n{abstract}")

    elif args.command == "citation":
        citation = manager.generate_citation(args.arxiv_id, args.format)
        print(citation)

    elif args.command == "link":
        arxiv_ids = []
        if args.arxiv_id:
            arxiv_ids.append(args.arxiv_id)
        if args.arxiv_ids:
            arxiv_ids.extend([i.strip() for i in args.arxiv_ids.split(",")])
        if not arxiv_ids:
            print("Error: Must provide --arxiv-id or --arxiv-ids")
            sys.exit(1)
        for aid in arxiv_ids:
            result = manager.link_paper_to_repo(
                repo_id=args.repo_id,
                arxiv_id=aid,
                repo_type=args.repo_type,
                citation=args.citation,
                create_pr=args.create_pr,
            )
            _print_json(result)

    elif args.command == "claim":
        result = manager.claim_authorship(args.arxiv_id, email=args.email)
        _print_json(result)

    elif args.command == "check-authorship":
        result = manager.check_authorship(args.arxiv_id)
        if use_json:
            _print_json(result)
        else:
            if "error" in result:
                print(f"Error: {result['error']}")
            else:
                print(f"\nAuthorship Status: {result.get('title')}")
                print(f"arXiv: {result.get('arxiv_id')}\n")
                for a in result.get("authors", []):
                    status_icon = {
                        "claimed_verified": "[verified]",
                        "claimed": "[pending]",
                        "unclaimed": "[unclaimed]",
                    }.get(a["status"], f"[{a['status']}]")
                    username = a.get("hf_username", "")
                    username_str = f" (@{username})" if username else ""
                    print(f"  {status_icon} {a['name']}{username_str}")

    elif args.command == "list-my-papers":
        result = manager.list_my_papers()
        if use_json:
            _print_json(result)
        else:
            if "error" in result:
                print(f"Error: {result['error']}")
            else:
                print(f"\nPapers for @{result.get('username')} ({result.get('papers_found')} found):")
                for p in result.get("papers", []):
                    print(f"  - [{p['arxiv_id']}] {p['title']} (upvotes: {p['upvotes']})")
                    print(f"    {p['url']}")
                if result.get("note"):
                    print(f"\nNote: {result['note']}")

    elif args.command == "toggle-visibility":
        result = manager.toggle_visibility(args.arxiv_id, show=(args.show == "true"))
        _print_json(result)

    elif args.command == "create":
        result = manager.create_research_article(
            template=args.template,
            title=args.title,
            output=args.output,
            authors=args.authors,
            abstract=args.abstract,
        )
        _print_json(result)

    elif args.command == "convert":
        result = manager.convert_to_html(
            input_path=args.input,
            output_path=args.output,
            style=args.style,
        )
        _print_json(result)

    elif args.command == "validate":
        result = manager.validate_repo_papers(args.repo_id, repo_type=args.repo_type)
        if use_json:
            _print_json(result)
        else:
            if "error" in result.get("status", ""):
                print(f"Error: {result.get('message')}")
            else:
                print(f"\nValidation: {result['repo_id']} ({result['papers_found']} papers)")
                for p in result.get("papers", []):
                    icon = "[ok]" if p["indexed_on_hf"] else "[NOT INDEXED]"
                    title = p.get("title") or ""
                    print(f"  {icon} {p['arxiv_id']} {title}")
                if result.get("all_indexed"):
                    print("\nAll papers are indexed on Hugging Face.")
                else:
                    print("\nSome papers are not indexed. Visit their URLs to trigger indexing.")


if __name__ == "__main__":
    main()
