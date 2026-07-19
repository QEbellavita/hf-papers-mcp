<p align="center">
  <img src="./assets/header.svg" alt="hf-papers-mcp — Hugging Face Papers, inside your assistant" width="100%">
</p>

An MCP server that lets your assistant read Hugging Face Papers — search them, pull the
daily curated list, fetch metadata, and generate citations.

Ask *"what shipped on speculative decoding this week?"* and get real papers with upvote
counts and abstracts, instead of whatever was in the model's training data.

## Install

Clone it, then point your MCP client (Claude Desktop, Claude Code, or any MCP host) at
`server.js`:

```bash
git clone https://github.com/QEbellavita/hf-papers-mcp
```

```json
{
  "mcpServers": {
    "hf-papers": {
      "command": "node",
      "args": ["/absolute/path/to/hf-papers-mcp/server.js"]
    }
  }
}
```

Not on npm — use the clone above rather than `npx hf-papers-mcp`.

**Requires [uv](https://github.com/astral-sh/uv).** The Python side declares its
dependencies inline (PEP 723), so `uv run` resolves them on first call — no virtualenv to
create or `pip install` to remember. Without uv it falls back to bare `python3`, which
lacks `huggingface_hub` and will return degraded results rather than pretending
everything is fine.

No API key needed for reads. Set `HF_TOKEN` only if you want `link` or `claim`.

## Tools

| Tool | What it does |
|---|---|
| `hf_papers_search` | Search papers by keyword |
| `hf_papers_daily` | The daily curated list, optionally for a past date |
| `hf_papers_info` | Full metadata for an arXiv ID — title, authors, abstract, URLs |
| `hf_papers_citation` | BibTeX, APA or MLA |
| `hf_papers_check` | Whether a paper is indexed on HF |
| `hf_papers_index` | Trigger indexing of an arXiv paper on HF |

## Example

```
> what were the top papers on Hugging Face yesterday?

  [1] Domino: Decoupling Causal Modeling from Autoregressive Drafting
      in Speculative Decoding
      arXiv: 2605.29707  |  Upvotes: 152
```

## Bulk digests

Pull a date range in one go:

```bash
node bin/daily.js 2026-07-01 2026-07-14
```

Writes JSON keyed by date to `/tmp/`, and records the window in
`.hf_papers_last_run.json` so a bare `node bin/daily.js` picks up where the last run
finished.

## Tests

```bash
npm test                      # hermetic — no network
HF_PAPERS_E2E=1 npm test      # adds live API tests
```

The default suite is offline and covers tool definitions plus a real MCP handshake over
stdio. The live tests hit the Hugging Face API and assert that responses come back as
parsed JSON — a regression guard, because diagnostics written to stdout used to corrupt
the JSON stream and silently degrade structured responses into raw strings.

## Notes

Everything runs as a fresh subprocess per call — no daemon, no cached state, nothing
persisted beyond the optional `bin/daily.js` run marker. Diagnostics go to stderr, since
stdout is the MCP transport and anything else written there breaks the protocol.

## Licence

MIT — see [LICENSE](LICENSE).
