<p align="center">
  <img src="./assets/header.svg" alt="hf-papers-mcp — Hugging Face Papers, inside your assistant" width="100%">
</p>

<p align="center"><a href="https://github.com/QEbellavita/hf-papers-mcp/actions/workflows/test.yml"><img src="https://github.com/QEbellavita/hf-papers-mcp/actions/workflows/test.yml/badge.svg" alt="tests"></a></p>

An MCP server that lets your assistant read Hugging Face Papers — search them, pull the
daily curated list, fetch metadata, and generate citations.

Ask *"what shipped on speculative decoding this week?"* and get real papers with upvote
counts and abstracts, instead of whatever was in the model's training data.

![Demo: daily papers, keyword search, and BibTeX citation over MCP](assets/demo.gif)

*(Recorded with [vhs](https://github.com/charmbracelet/vhs) via `vhs demo.tape` — the
session runs `bin/demo.js`, a real MCP client against the live API.)*

## Install

Point your MCP client (Claude Desktop, Claude Code, or any MCP host) at it:

```json
{
  "mcpServers": {
    "hf-papers": {
      "command": "npx",
      "args": ["-y", "hf-papers-mcp"]
    }
  }
}
```

Or from source: `git clone https://github.com/QEbellavita/hf-papers-mcp` and point
`command: node, args: [/absolute/path/to/hf-papers-mcp/server.js]` at the checkout.

Pure Node (>= 18), one dependency (`@modelcontextprotocol/sdk`), no Python. No API key
needed — everything is a public read. If `HF_TOKEN` is set (or you're logged in via
`hf auth login`), it's sent along, which helps with rate limits.

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

Every call is a direct HTTPS request to the public Hugging Face / arXiv APIs — no
daemon, no cached state, nothing persisted beyond the optional `bin/daily.js` run
marker. Diagnostics go to stderr, since stdout is the MCP transport and anything else
written there breaks the protocol.

Earlier versions shelled out to a Python sidecar (`scripts/paper_manager.py` via `uv`);
v1.1.0 ported the six exposed operations to native Node, so cold-start latency dropped
from ~12s to nothing and the uv/Python requirement is gone.

## Citing

If this server is useful in your research workflow, cite it via the repo's
[CITATION.cff](CITATION.cff) (GitHub's "Cite this repository" button), or the
Zenodo DOI once archived.

## Licence

MIT — see [LICENSE](LICENSE).
