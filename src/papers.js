'use strict';

const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'paper_manager.py');
// A warm `uv run` already takes ~12.5s; the first (cold) call also resolves the
// PEP 723 dependency set, which can take far longer. The old 15s budget timed
// out on cold starts and silently degraded to a depless python3 — so allow real
// headroom here.
const TIMEOUT_MS = 60_000;

/**
 * Shell out to paper_manager.py and return parsed JSON.
 * Prefers `uv run` (auto-resolves PEP 723 deps). Falls back to `python3` ONLY
 * when uv is genuinely absent — a uv timeout or runtime failure is surfaced
 * rather than masked, because python3 here lacks huggingface_hub and would
 * return misleading/empty data.
 *
 * IMPORTANT: --json must come BEFORE the subcommand (argparse global flag).
 */
function runPaperManager(args) {
  return new Promise((resolve) => {
    const tryRun = (cmd, cmdArgs) => {
      execFile(cmd, cmdArgs, {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err && cmd === 'uv' && err.code === 'ENOENT') {
          // uv binary not installed — fall back to python3
          tryRun('python3', [SCRIPT, '--json', ...args]);
          return;
        }
        if (err) {
          // Surface real failures (timeout, runtime error) instead of degrading.
          const reason = err.killed ? `timed out after ${TIMEOUT_MS}ms` : err.message;
          resolve({ error: reason, stderr: stderr?.trim() || '' });
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          // Output wasn't JSON — return raw text (e.g., citation command)
          resolve({ result: stdout.trim() });
        }
      });
    };
    // Try uv first (auto-resolves PEP 723 dependencies), then python3
    tryRun('uv', ['run', SCRIPT, '--json', ...args]);
  });
}

module.exports = {
  name: 'papers',

  // No engine dependencies — this is a standalone dev tool
  requires: [],

  tools(engines) {
    return [
      {
        def: {
          name: 'hf_papers_search',
          description: 'Search Hugging Face papers by keyword. Use to find research relevant to current engine work.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (e.g., "speculative decoding")' },
              limit: { type: 'number', description: 'Max results to return', default: 10 },
            },
            required: ['query'],
          },
        },
        handler: async (args) => {
          return runPaperManager(['search', '--query', args.query, '--limit', String(args.limit || 10)]);
        },
      },
      {
        def: {
          name: 'hf_papers_daily',
          description: 'Fetch daily curated papers from Hugging Face. Check what is trending in AI research.',
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
              limit: { type: 'number', description: 'Max papers to return', default: 15 },
            },
          },
        },
        handler: async (args) => {
          const cmdArgs = ['daily', '--limit', String(args.limit || 15)];
          if (args.date) cmdArgs.push('--date', args.date);
          return runPaperManager(cmdArgs);
        },
      },
      {
        def: {
          name: 'hf_papers_info',
          description: 'Get full metadata for a paper from Hugging Face — title, authors, abstract, URLs.',
          inputSchema: {
            type: 'object',
            properties: {
              arxiv_id: { type: 'string', description: 'arXiv paper ID (e.g., "2301.12345")' },
            },
            required: ['arxiv_id'],
          },
        },
        handler: async (args) => {
          return runPaperManager(['info', '--arxiv-id', args.arxiv_id]);
        },
      },
      {
        def: {
          name: 'hf_papers_citation',
          description: 'Generate a citation for a paper. Returns raw text in BibTeX, APA, or MLA format as { result: "..." }.',
          inputSchema: {
            type: 'object',
            properties: {
              arxiv_id: { type: 'string', description: 'arXiv paper ID' },
              format: { type: 'string', description: 'Citation format', default: 'bibtex', enum: ['bibtex', 'apa', 'mla'] },
            },
            required: ['arxiv_id'],
          },
        },
        handler: async (args) => {
          return runPaperManager(['citation', '--arxiv-id', args.arxiv_id, '--format', args.format || 'bibtex']);
        },
      },
      {
        def: {
          name: 'hf_papers_check',
          description: 'Check if a paper is indexed on Hugging Face and get its metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              arxiv_id: { type: 'string', description: 'arXiv paper ID' },
            },
            required: ['arxiv_id'],
          },
        },
        handler: async (args) => {
          return runPaperManager(['check', '--arxiv-id', args.arxiv_id]);
        },
      },
      {
        def: {
          name: 'hf_papers_index',
          description: 'Trigger indexing of a paper on Hugging Face from arXiv.',
          inputSchema: {
            type: 'object',
            properties: {
              arxiv_id: { type: 'string', description: 'arXiv paper ID' },
            },
            required: ['arxiv_id'],
          },
        },
        handler: async (args) => {
          return runPaperManager(['index', '--arxiv-id', args.arxiv_id]);
        },
      },
    ];
  },

  resources(engines) {
    return [];
  },
};
