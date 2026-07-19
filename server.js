#!/usr/bin/env node
'use strict';

// Standalone MCP server exposing the Hugging Face papers tools over stdio.
//
// The tool definitions live in src/papers.js, which shells out to
// scripts/paper_manager.py. Nothing here holds state: every call is a fresh
// subprocess against the public Hugging Face API.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const papers = require('./src/papers.js');

// The domain signature takes an `engines` bag in its original host; this tool
// declares `requires: []`, so an empty object is the whole contract.
const tools = papers.tools({});
const byName = new Map(tools.map((t) => [t.def.name, t]));

const server = new Server(
  { name: 'hf-papers-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => t.def),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = byName.get(request.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
    };
  }
  try {
    const result = await tool.handler(request.params.arguments || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `${request.params.name} failed: ${err.message}` }],
    };
  }
});

async function main() {
  // stdout is the MCP transport — anything written there that is not a protocol
  // message corrupts the stream. Keep diagnostics on stderr.
  await server.connect(new StdioServerTransport());
  process.stderr.write(`hf-papers-mcp ready — ${tools.length} tools\n`);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
