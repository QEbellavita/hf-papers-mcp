#!/usr/bin/env node
'use strict';

// Minimal example MCP client: spawns the server over stdio, calls three tools,
// pretty-prints the results. Used to record the README demo GIF, and useful as
// a smoke test / starting point for writing your own client.

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.resolve(__dirname, '..');
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

async function call(client, name, args) {
  console.log(`\n${cyan('▸')} ${bold(name)} ${dim(JSON.stringify(args))}`);
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'server.js')],
    cwd: ROOT,
  });
  const client = new Client({ name: 'demo', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`${bold('hf-papers-mcp')} ${dim('—')} ${tools.length} tools: ${dim(tools.map((t) => t.name.replace('hf_papers_', '')).join(', '))}`);

  const daily = await call(client, 'hf_papers_daily', { limit: 3 });
  for (const p of daily) {
    console.log(`  ${yellow(`▲ ${String(p.upvotes).padStart(3)}`)}  ${p.title}`);
    console.log(`         ${dim(p.url)}`);
  }

  const found = await call(client, 'hf_papers_search', { query: 'speculative decoding', limit: 3 });
  for (const p of found) {
    console.log(`  ${yellow(`▲ ${String(p.upvotes).padStart(3)}`)}  ${p.title}`);
  }

  const cite = await call(client, 'hf_papers_citation', { arxiv_id: '1706.03762', format: 'bibtex' });
  console.log(cite.result.split('\n').map((l) => `  ${l}`).join('\n'));

  await client.close();
})().catch((err) => {
  console.error('demo failed:', err.message);
  process.exit(1);
});
