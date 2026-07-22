'use strict';

// Regression: search/daily/index return JSON arrays. An earlier version spread
// the parsed value into an object literal, which turns [a,b] into {0:a,1:b} —
// so every list-returning tool handed the caller an index-keyed map instead of
// a list, and only the live integration test caught it. These run offline by
// stubbing execFile, so the shape is checked without touching the HF API.

const cp = require('child_process');

const PAPERS = [
  { arxiv_id: '2605.29707', title: 'Domino', upvotes: 152 },
  { arxiv_id: '2602.06036', title: 'DFlash', upvotes: 89 },
];

// Must be stubbed before src/papers.js is required — it destructures execFile
// at module load, so reassigning cp.execFile afterwards has no effect. Install
// one stub that defers to a swappable responder. node:test gives each file its
// own process, so mutating the module here is safe.
let lastCmd = null;
let respond = () => JSON.stringify(PAPERS);
cp.execFile = (cmd, args, opts, cb) => {
  lastCmd = cmd;
  process.nextTick(() => cb(null, respond(), ''));
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('object results are still returned as objects', async (t) => {
  respond = () => JSON.stringify({ title: 'One Paper', authors: ['A'] });
  t.after(() => { respond = () => JSON.stringify(PAPERS); });
  const result = await handlerFor('hf_papers_info')({ arxiv_id: '2605.29707' });
  assert.equal(Array.isArray(result), false);
  assert.equal(result.title, 'One Paper');
});

test('non-JSON output still comes back as raw text', async (t) => {
  respond = () => '@article{doe2026, title={A Citation}}';
  t.after(() => { respond = () => JSON.stringify(PAPERS); });
  const result = await handlerFor('hf_papers_citation')({ arxiv_id: '2605.29707' });
  assert.equal(Array.isArray(result), false);
  assert.match(result.result, /@article/);
});

test('prefers uv, not a bare python3 fallback, when uv succeeds', async () => {
  lastCmd = null;
  await handlerFor('hf_papers_search')({ query: 'x' });
  assert.equal(lastCmd, 'uv');
});
