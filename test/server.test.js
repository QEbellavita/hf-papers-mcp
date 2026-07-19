'use strict';

// Drives the real server over a real stdio transport. The unit tests check the
// tool definitions in isolation; this checks that the server actually speaks
// MCP and advertises them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('server completes an MCP handshake and lists six tools', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'server.js')],
    cwd: ROOT,
  });

  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 6);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'hf_papers_check',
      'hf_papers_citation',
      'hf_papers_daily',
      'hf_papers_index',
      'hf_papers_info',
      'hf_papers_search',
    ]);
    for (const t of tools) {
      assert.ok(t.inputSchema, `${t.name} advertises no inputSchema`);
    }
  } finally {
    await client.close();
  }
});

test('unknown tool returns an error rather than crashing the server', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'server.js')],
    cwd: ROOT,
  });
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const res = await client.callTool({ name: 'hf_papers_nonexistent', arguments: {} });
    assert.ok(res.isError, 'expected isError on an unknown tool');
    // Server must still be alive afterwards.
    const { tools } = await client.listTools();
    assert.equal(tools.length, 6);
  } finally {
    await client.close();
  }
});
