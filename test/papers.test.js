'use strict';

// Ported from Jest to node:test so the repo has no test-framework dependency.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const papers = require('../src/papers.js');

const EXPECTED = [
  'hf_papers_search',
  'hf_papers_daily',
  'hf_papers_info',
  'hf_papers_citation',
  'hf_papers_check',
  'hf_papers_index',
];

test('exports the expected domain shape', () => {
  assert.equal(papers.name, 'papers');
  assert.deepEqual(papers.requires, []);
  assert.equal(typeof papers.tools, 'function');
  assert.equal(typeof papers.resources, 'function');
});

test('registers six tools', () => {
  assert.equal(papers.tools({}).length, 6);
});

test('every tool has a def and a handler', () => {
  for (const tool of papers.tools({})) {
    assert.ok(tool.def, 'tool.def missing');
    assert.match(tool.def.name, /^hf_papers_/);
    assert.equal(typeof tool.def.description, 'string');
    assert.ok(tool.def.description.length > 10, 'description too short to be useful');
    assert.ok(tool.def.inputSchema, 'inputSchema missing');
    assert.equal(typeof tool.handler, 'function');
  }
});

test('tool names match the expected set, in order', () => {
  assert.deepEqual(papers.tools({}).map((t) => t.def.name), EXPECTED);
});

test('resources is empty — this domain exposes tools only', () => {
  assert.deepEqual(papers.resources({}), []);
});

test('takes no engine dependencies, so it runs standalone', () => {
  // The whole premise of extracting this into its own repo.
  assert.deepEqual(papers.requires, []);
  assert.doesNotThrow(() => papers.tools({}));
});
