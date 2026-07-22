'use strict';

const hf = require('./hf.js');

// Handlers resolve to { error } instead of rejecting, matching the contract of
// the old Python-subprocess bridge: callers always get JSON, never an MCP-level
// exception, for expected failures (network down, bad id, API error).
async function safely(op) {
  try {
    return await op();
  } catch (err) {
    return { error: err.message };
  }
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
        handler: (args) => safely(() => hf.searchPapers(args.query, args.limit || 10)),
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
        handler: (args) => safely(() => hf.dailyPapers(args.date, args.limit || 15)),
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
        handler: (args) => safely(() => hf.getArxivInfo(args.arxiv_id)),
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
        handler: (args) => safely(async () => ({
          result: await hf.generateCitation(args.arxiv_id, args.format || 'bibtex'),
        })),
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
        handler: (args) => safely(() => hf.checkPaper(args.arxiv_id)),
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
        handler: (args) => safely(() => hf.indexPaper(args.arxiv_id)),
      },
    ];
  },

  resources(engines) {
    return [];
  },
};
