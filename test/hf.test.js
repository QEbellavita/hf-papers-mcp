'use strict';

// Offline tests for the native port of paper_manager.py. These lock in the
// behaviors the Python side had, so the port can't silently drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const hf = require('../src/hf.js');

// ------------------------------------------------------------------
// cleanArxivId
// ------------------------------------------------------------------

test('cleanArxivId accepts modern ids, with and without version', () => {
  assert.equal(hf.cleanArxivId('2301.12345'), '2301.12345');
  assert.equal(hf.cleanArxivId('1706.03762v5'), '1706.03762v5');
});

test('cleanArxivId strips prefixes, URLs and .pdf', () => {
  assert.equal(hf.cleanArxivId('arXiv:2301.12345'), '2301.12345');
  assert.equal(hf.cleanArxivId('https://arxiv.org/abs/2301.12345'), '2301.12345');
  assert.equal(hf.cleanArxivId('https://arxiv.org/pdf/2301.12345.pdf'), '2301.12345');
  assert.equal(hf.cleanArxivId('  2301.12345  '), '2301.12345');
});

test('cleanArxivId accepts legacy category ids', () => {
  assert.equal(hf.cleanArxivId('cs/0701001'), 'cs/0701001');
  assert.equal(hf.cleanArxivId('hep-th/9901001v2'), 'hep-th/9901001v2');
});

test('cleanArxivId rejects garbage', () => {
  for (const bad of ['', 'not-an-id', '12345', '2301.123', 'rm -rf /', '2301.12345; ls']) {
    assert.throws(() => hf.cleanArxivId(bad), /Invalid arXiv ID/);
  }
});

// ------------------------------------------------------------------
// sanitizeText
// ------------------------------------------------------------------

test('sanitizeText strips control chars and defuses markdown injection', () => {
  assert.equal(hf.sanitizeText('a\x00b\x1fc'), 'abc');
  assert.equal(hf.sanitizeText('a   b\t\tc'), 'a b c');
  assert.equal(hf.sanitizeText('x\n\n\n\n\ny'), 'x\n\ny');
  assert.ok(!hf.sanitizeText('evil ``` fence').includes('```'));
  assert.ok(hf.sanitizeText('---\nfrontmatter').startsWith('\\---'));
});

// ------------------------------------------------------------------
// parseArxivAtom
// ------------------------------------------------------------------

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: search_query=&amp;id_list=1706.03762</title>
  <entry>
    <title>Attention Is All You Need</title>
    <summary>  The dominant sequence transduction models are based on complex
recurrent or convolutional neural networks.
</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <author><name>Niki Parmar</name></author>
  </entry>
</feed>`;

test('parseArxivAtom skips the feed title and extracts paper fields', () => {
  const info = hf.parseArxivAtom(ATOM_FIXTURE, '1706.03762');
  assert.equal(info.title, 'Attention Is All You Need');
  assert.deepEqual(info.authors, ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar']);
  assert.match(info.abstract, /^The dominant sequence transduction/);
  assert.equal(info.arxiv_url, 'https://arxiv.org/abs/1706.03762');
  assert.equal(info.pdf_url, 'https://arxiv.org/pdf/1706.03762.pdf');
});

test('parseArxivAtom decodes XML entities', () => {
  const xml = '<feed><title>feed</title><entry><title>P &amp; NP &lt;draft&gt;</title></entry></feed>';
  assert.equal(hf.parseArxivAtom(xml, '2301.12345').title, 'P & NP <draft>');
});

test('parseArxivAtom on an empty feed returns nulls, not throws', () => {
  const info = hf.parseArxivAtom('<feed><title>feed</title></feed>', '2301.99999');
  assert.equal(info.title, null);
  assert.equal(info.abstract, null);
  assert.deepEqual(info.authors, []);
});

// ------------------------------------------------------------------
// formatCitation
// ------------------------------------------------------------------

const INFO = {
  arxiv_id: '1706.03762',
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
};

test('bibtex citation has key, escaped fields, and derived year', () => {
  const cite = hf.formatCitation(INFO, 'bibtex');
  assert.match(cite, /^@article\{arxiv1706_03762,/);
  assert.match(cite, /title=\{Attention Is All You Need\}/);
  assert.match(cite, /author=\{Ashish Vaswani and Noam Shazeer\}/);
  assert.match(cite, /year=\{2017\}/);
});

test('bibtex escapes braces in titles', () => {
  const cite = hf.formatCitation({ ...INFO, title: 'On {X} sets' }, 'bibtex');
  assert.match(cite, /title=\{On \\\{X\\\} sets\}/);
});

test('apa joins two authors with an ampersand', () => {
  const cite = hf.formatCitation(INFO, 'apa');
  assert.equal(cite, 'Ashish Vaswani, & Noam Shazeer (2017). Attention Is All You Need. arXiv preprint arXiv:1706.03762.');
});

test('apa elides beyond seven authors', () => {
  const many = { ...INFO, authors: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] };
  assert.match(hf.formatCitation(many, 'apa'), /^A, B, C, D, E, F, \.\.\. H /);
});

test('mla uses et al. beyond two authors', () => {
  const three = { ...INFO, authors: ['A One', 'B Two', 'C Three'] };
  assert.match(hf.formatCitation(three, 'mla'), /^A One, et al\. /);
});

test('year derivation: pre-2050 is 20xx, later is 19xx, legacy ids work', () => {
  assert.match(hf.formatCitation({ ...INFO, arxiv_id: '9901.12345' }, 'bibtex'), /year=\{1999\}/);
  assert.match(hf.formatCitation({ ...INFO, arxiv_id: 'cs/0701001' }, 'bibtex'), /year=\{2007\}/);
});

test('unknown format returns guidance, not a throw', () => {
  assert.match(hf.formatCitation(INFO, 'chicago'), /not supported/);
});

// ------------------------------------------------------------------
// result mappers
// ------------------------------------------------------------------

test('mapSearchEntry unwraps nested paper, truncates summary and authors', () => {
  const entry = {
    paper: {
      id: '2301.12345',
      title: 'T',
      upvotes: 7,
      summary: 'x'.repeat(300),
      authors: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `A${n}` })),
    },
  };
  const mapped = hf.mapSearchEntry(entry);
  assert.equal(mapped.arxiv_id, '2301.12345');
  assert.equal(mapped.upvotes, 7);
  assert.equal(mapped.summary.length, 200);
  assert.equal(mapped.authors.length, 5);
  assert.equal(mapped.url, 'https://huggingface.co/papers/2301.12345');
});

test('mapDailyEntry pulls entry-level fields and defaults', () => {
  const mapped = hf.mapDailyEntry({
    title: 'Outer title',
    numComments: 3,
    submittedBy: { name: 'someone' },
    paper: { id: '2301.12345', upvotes: 0 },
  });
  assert.equal(mapped.title, 'Outer title');
  assert.equal(mapped.num_comments, 3);
  assert.equal(mapped.submitted_by, 'someone');
  assert.equal(mapped.upvotes, 0);
});

// ------------------------------------------------------------------
// error contracts (no network needed — invalid input short-circuits)
// ------------------------------------------------------------------

test('checkPaper with an invalid id resolves { exists: false, error }', async () => {
  const res = await hf.checkPaper('nope');
  assert.equal(res.exists, false);
  assert.match(res.error, /Invalid arXiv ID/);
});

test('indexPaper with an invalid id resolves { status: "error" }', async () => {
  const res = await hf.indexPaper('nope');
  assert.equal(res.status, 'error');
});

test('dailyPapers with a malformed date resolves [ { error } ] like the CLI did', async () => {
  const res = await hf.dailyPapers('07/22/2026');
  assert.ok(Array.isArray(res));
  assert.match(res[0].error, /Invalid date format/);
});

test('dailyPapers rejects calendar-invalid dates, not just malformed ones', async () => {
  for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-01-32']) {
    const res = await hf.dailyPapers(bad);
    assert.match(res[0].error, /Invalid date format/, `${bad} should be rejected`);
  }
});

test('generateCitation with an invalid id resolves an Error string', async () => {
  assert.match(await hf.generateCitation('nope'), /^Error:/);
});
