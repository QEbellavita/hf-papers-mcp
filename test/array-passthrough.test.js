'use strict';

// Regression: search/daily return JSON arrays. An earlier version spread the
// parsed value into an object literal, which turns [a,b] into {0:a,1:b} — so
// every list-returning tool handed the caller an index-keyed map instead of a
// list, and only the live integration test caught it. These run offline by
// stubbing global fetch (the subprocess bridge these originally stubbed via
// execFile was ported to native Node), so the shape is checked without
// touching the HF API.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const PAPERS = [
  { paper: { id: '2605.29707', title: 'Domino', upvotes: 152, summary: 's', authors: [] } },
  { paper: { id: '2602.06036', title: 'DFlash', upvotes: 89, summary: 's', authors: [] } },
];

const ATOM = `<feed><title>feed</title><entry><title>One Paper</title>
<summary>An abstract.</summary><author><name>A</name></author></entry></feed>`;

// hf.js resolves global fetch at call time, so stubbing here covers every
// handler call below. node:test gives each file its own process — safe.
global.fetch = async (url) => {
  const target = String(url);
  if (target.includes('export.arxiv.org')) {
    return { ok: true, status: 200, text: async () => ATOM };
  }
  return { ok: true, status: 200, json: async () => PAPERS };
};

const papers = require('../src/papers.js');
const handlerFor = (name) => papers.tools({}).find((t) => t.def.name === name).handler;

test('hf_papers_search preserves the array instead of index-keying it', async () => {
  const result = await handlerFor('hf_papers_search')({ query: 'speculative decoding', limit: 2 });
  assert.ok(Array.isArray(result), 'expected an array, got ' + JSON.stringify(result));
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Domino');
});

test('hf_papers_daily preserves the array', async () => {
  const result = await handlerFor('hf_papers_daily')({});
  assert.ok(Array.isArray(result), 'expected an array, got ' + JSON.stringify(result));
  assert.equal(result.length, 2);
});

test('an array result survives JSON round-trip as an array', async () => {
  // server.js JSON.stringifies the handler result, so this is what a client sees.
  const result = await handlerFor('hf_papers_search')({ query: 'x' });
  assert.ok(Array.isArray(JSON.parse(JSON.stringify(result))));
});

test('object results are still returned as objects', async () => {
  const result = await handlerFor('hf_papers_info')({ arxiv_id: '2605.29707' });
  assert.equal(Array.isArray(result), false);
  assert.equal(result.title, 'One Paper');
});

test('citation still comes back as raw text in a { result } wrapper', async () => {
  const result = await handlerFor('hf_papers_citation')({ arxiv_id: '2605.29707' });
  assert.equal(Array.isArray(result), false);
  assert.match(result.result, /@article/);
});

test('a fetch failure resolves { error }, never a rejection', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  try {
    const result = await handlerFor('hf_papers_search')({ query: 'x' });
    assert.match(result.error, /network down/);
  } finally {
    global.fetch = original;
  }
});
