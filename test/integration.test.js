'use strict';

// Live tests against the Hugging Face API. Skipped unless HF_PAPERS_E2E=1 so
// the default suite stays hermetic and offline.
//
//   HF_PAPERS_E2E=1 npm test
//
// The regression these lock in: paper_manager.py used to write diagnostics
// ("Warning: No HF_TOKEN found...") to stdout, which corrupted the JSON stream.
// papers.js then failed to parse and silently degraded to {result: "<raw text>"},
// so callers got a string where they expected structured data. Diagnostics now
// go to stderr.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = process.env.HF_PAPERS_E2E === '1';

async function connect() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'server.js')],
    cwd: ROOT,
  });
  const client = new Client({ name: 'integration', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

test('hf_papers_info returns parsed JSON, not a stdout-polluted string',
  { skip: LIVE ? false : 'set HF_PAPERS_E2E=1 to run live API tests' },
  async () => {
    const client = await connect();
    try {
      const res = await client.callTool({
        name: 'hf_papers_info',
        arguments: { arxiv_id: '1706.03762' },
      });
      const parsed = JSON.parse(res.content[0].text);

      // The regression: a wrapped {result: "..."} string means stdout was polluted.
      assert.equal(typeof parsed.result, 'undefined',
        'response was wrapped in {result}, so something wrote to stdout again');
      assert.equal(parsed.arxiv_id, '1706.03762');
      assert.equal(parsed.title, 'Attention Is All You Need');
      assert.ok(Array.isArray(parsed.authors) && parsed.authors.length > 0);
    } finally {
      await client.close();
    }
  });

test('hf_papers_search returns a parsed array',
  { skip: LIVE ? false : 'set HF_PAPERS_E2E=1 to run live API tests' },
  async () => {
    const client = await connect();
    try {
      const res = await client.callTool({
        name: 'hf_papers_search',
        arguments: { query: 'speculative decoding', limit: 3 },
      });
      const parsed = JSON.parse(res.content[0].text);
      assert.ok(Array.isArray(parsed), 'expected an array of papers');
      assert.ok(parsed.length > 0, 'expected at least one result');
      assert.ok(parsed[0].title, 'first result has no title');
    } finally {
      await client.close();
    }
  });

test('hf_papers_citation is intentionally raw text, not JSON',
  { skip: LIVE ? false : 'set HF_PAPERS_E2E=1 to run live API tests' },
  async () => {
    const client = await connect();
    try {
      const res = await client.callTool({
        name: 'hf_papers_citation',
        arguments: { arxiv_id: '1706.03762', format: 'bibtex' },
      });
      const parsed = JSON.parse(res.content[0].text);
      // BibTeX is not JSON, so the {result: "..."} wrapper is correct here.
      assert.equal(typeof parsed.result, 'string');
      assert.match(parsed.result, /@article|@misc/);
    } finally {
      await client.close();
    }
  });
