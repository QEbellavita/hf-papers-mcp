'use strict';

// Native port of scripts/paper_manager.py — the six operations the MCP server
// exposes, reimplemented on global fetch (node >= 18) so the server has no
// Python/uv dependency and no per-call subprocess.
//
// Contract notes preserved from the Python side:
//  - daily() with a bad date returns [ { error } ] (an array), matching the CLI.
//  - check() with a bad arXiv id returns { exists: false, error }.
//  - citation() returns a raw string; the tool handler wraps it as { result }.
//  - Text pulled from arXiv/HF is sanitized before it can reach Markdown/YAML.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HF_API_BASE = 'https://huggingface.co/api';
const TIMEOUT_MS = 15_000;

const ARXIV_ID_MODERN = /^\d{4}\.\d{4,5}(v\d+)?$/;
const ARXIV_ID_LEGACY = /^[a-zA-Z-]+\/\d{7}(v\d+)?$/;

// ------------------------------------------------------------------
// Pure helpers (unit-tested offline)
// ------------------------------------------------------------------

function cleanArxivId(raw) {
  let id = String(raw ?? '').trim();
  id = id.replace(/^arxiv:/i, '');
  id = id.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, '');
  id = id.replace(/\.pdf$/, '');
  if (!ARXIV_ID_MODERN.test(id) && !ARXIV_ID_LEGACY.test(id)) {
    throw new Error(
      `Invalid arXiv ID: ${JSON.stringify(String(raw))}. ` +
      'Expected format: YYMM.NNNNN[vN] or category/YYMMNNN[vN]'
    );
  }
  return id;
}

function sanitizeText(text) {
  let out = String(text);
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  out = out.replace(/[^\S\n]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/```/g, '\\`\\`\\`');
  out = out.replace(/^---/gm, '\\---');
  return out.trim();
}

function decodeXmlEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// arXiv's Atom feed is flat and small; targeted regexes match the Python port's
// approach and avoid an XML-parser dependency.
function parseArxivAtom(xml, arxivId) {
  // First <title> is the feed's own title — the paper title is the second.
  const titles = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1]);
  const authors = [...xml.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1]);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(xml);

  const rawTitle = titles.length > 1 ? titles[1].trim() : null;
  const rawAbstract = summary ? summary[1].trim() : null;

  return {
    arxiv_id: arxivId,
    title: rawTitle ? sanitizeText(decodeXmlEntities(rawTitle)) : null,
    authors: authors.map((a) => sanitizeText(decodeXmlEntities(a))),
    abstract: rawAbstract ? sanitizeText(decodeXmlEntities(rawAbstract)) : null,
    arxiv_url: `https://arxiv.org/abs/${arxivId}`,
    pdf_url: `https://arxiv.org/pdf/${arxivId}.pdf`,
  };
}

function arxivYear(arxivId) {
  // Modern ids embed YYMM; legacy ids (cs/0701001) embed YY after the slash.
  const numeric = arxivId.includes('/') ? arxivId.split('/')[1] : arxivId;
  const yy = parseInt(numeric.slice(0, 2), 10);
  if (Number.isNaN(yy)) return null;
  return yy < 50 ? `20${String(yy).padStart(2, '0')}` : `19${yy}`;
}

function formatCitation(info, fmt = 'bibtex') {
  const authors = info.authors && info.authors.length ? info.authors : ['Unknown'];
  const title = info.title || 'Untitled';
  const arxivId = info.arxiv_id;
  const year = arxivYear(arxivId) || 'n.d.';

  if (fmt === 'bibtex') {
    const key = `arxiv${arxivId.replace(/[./]/g, '_')}`;
    const escape = (s) => s.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    return (
      `@article{${key},\n` +
      `  title={${escape(title)}},\n` +
      `  author={${escape(authors.join(' and '))}},\n` +
      `  journal={arXiv preprint arXiv:${arxivId}},\n` +
      `  year={${year}}\n` +
      `}`
    );
  }

  if (fmt === 'apa') {
    let authorStr;
    if (authors.length > 7) {
      authorStr = `${authors.slice(0, 6).join(', ')}, ... ${authors[authors.length - 1]}`;
    } else if (authors.length > 1) {
      authorStr = `${authors.slice(0, -1).join(', ')}, & ${authors[authors.length - 1]}`;
    } else {
      authorStr = authors[0];
    }
    return `${authorStr} (${year}). ${title}. arXiv preprint arXiv:${arxivId}.`;
  }

  if (fmt === 'mla') {
    let authorStr;
    if (authors.length > 2) authorStr = `${authors[0]}, et al.`;
    else if (authors.length === 2) authorStr = `${authors[0]}, and ${authors[1]}`;
    else authorStr = authors[0];
    // The Python port appended "." unconditionally, yielding "et al.." — don't.
    const sep = authorStr.endsWith('.') ? '' : '.';
    return `${authorStr}${sep} "${title}." arXiv preprint arXiv:${arxivId} (${year}).`;
  }

  return `Format '${fmt}' not supported. Use bibtex, apa, or mla.`;
}

function mapSearchEntry(entry) {
  const paper = entry.paper || entry;
  return {
    arxiv_id: paper.id,
    title: paper.title,
    upvotes: paper.upvotes || 0,
    summary: String(paper.ai_summary || paper.summary || '').slice(0, 200),
    authors: (paper.authors || []).map((a) => a.name).slice(0, 5),
    url: `https://huggingface.co/papers/${paper.id}`,
  };
}

function mapDailyEntry(entry) {
  const paper = entry.paper || entry;
  return {
    arxiv_id: paper.id,
    title: paper.title || entry.title,
    upvotes: paper.upvotes || 0,
    summary: String(paper.ai_summary || paper.summary || '').slice(0, 200),
    num_comments: entry.numComments || 0,
    submitted_by: (entry.submittedBy || {}).name ?? null,
    url: `https://huggingface.co/papers/${paper.id}`,
  };
}

// ------------------------------------------------------------------
// Auth + fetch
// ------------------------------------------------------------------

function readToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  // Same fallback huggingface_hub's get_token() uses.
  const candidates = [
    process.env.HF_TOKEN_PATH,
    path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'token'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const token = fs.readFileSync(file, 'utf8').trim();
      if (token) return token;
    } catch { /* not logged in — reads work anonymously */ }
  }
  return null;
}

async function fetchJson(url, params) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
  }
  const headers = {};
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(target, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return resp;
}

// ------------------------------------------------------------------
// Operations (one per MCP tool)
// ------------------------------------------------------------------

async function getPaper(arxivId) {
  const resp = await fetchJson(`${HF_API_BASE}/papers/${arxivId}`);
  if (resp.status === 404) {
    return { error: 'not_found', message: `Paper ${arxivId} not indexed on HF` };
  }
  if (!resp.ok) throw new Error(`HF API ${resp.status} for papers/${arxivId}`);
  return resp.json();
}

async function searchPapers(query, limit = 20) {
  const resp = await fetchJson(`${HF_API_BASE}/papers/search`, { q: query });
  if (!resp.ok) throw new Error(`HF API ${resp.status} for papers/search`);
  const papers = await resp.json();
  return papers.slice(0, limit).map(mapSearchEntry);
}

async function dailyPapers(dateStr, limit = 30) {
  const params = {};
  if (dateStr) {
    // Round-trip check: Date rolls calendar-invalid dates (2026-02-30) over
    // instead of rejecting them, unlike Python's strptime.
    const parsed = new Date(`${dateStr}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== dateStr
    ) {
      return [{ error: `Invalid date format: ${dateStr}. Use YYYY-MM-DD` }];
    }
    params.date = dateStr;
  }
  const resp = await fetchJson(`${HF_API_BASE}/daily_papers`, params);
  if (!resp.ok) throw new Error(`HF API ${resp.status} for daily_papers`);
  const papers = await resp.json();
  return papers.slice(0, limit).map(mapDailyEntry);
}

async function checkPaper(rawId) {
  let arxivId;
  try {
    arxivId = cleanArxivId(rawId);
  } catch (err) {
    return { exists: false, error: err.message };
  }
  const data = await getPaper(arxivId);
  if (data.error) {
    return {
      exists: false,
      arxiv_id: arxivId,
      index_url: `https://huggingface.co/papers/${arxivId}`,
      message: 'Visit the URL to index this paper',
    };
  }
  return {
    exists: true,
    arxiv_id: arxivId,
    title: data.title,
    upvotes: data.upvotes || 0,
    authors: (data.authors || []).map((a) => a.name),
    url: `https://huggingface.co/papers/${arxivId}`,
    arxiv_url: `https://arxiv.org/abs/${arxivId}`,
  };
}

async function indexPaper(rawId) {
  let arxivId;
  try {
    arxivId = cleanArxivId(rawId);
  } catch (err) {
    return { status: 'error', message: err.message };
  }
  const paperUrl = `https://huggingface.co/papers/${arxivId}`;
  try {
    // GET the paper page — HF indexes on first visit.
    const resp = await fetch(paperUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (resp.ok) return { status: 'indexed', url: paperUrl, arxiv_id: arxivId };
    return { status: 'not_indexed', url: paperUrl, action: 'visit_url' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function getArxivInfo(rawId) {
  let arxivId;
  try {
    arxivId = cleanArxivId(rawId);
  } catch (err) {
    return { error: err.message };
  }
  try {
    const resp = await fetch(
      `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!resp.ok) throw new Error(`arXiv API ${resp.status}`);
    return parseArxivAtom(await resp.text(), arxivId);
  } catch (err) {
    return { error: err.message };
  }
}

async function generateCitation(rawId, fmt = 'bibtex') {
  let arxivId;
  try {
    arxivId = cleanArxivId(rawId);
  } catch (err) {
    return `Error: ${err.message}`;
  }
  const info = await getArxivInfo(arxivId);
  if (info.error) return `Error fetching paper info: ${info.error}`;
  return formatCitation(info, fmt);
}

module.exports = {
  // operations
  searchPapers,
  dailyPapers,
  checkPaper,
  indexPaper,
  getArxivInfo,
  generateCitation,
  // pure helpers, exported for tests
  cleanArxivId,
  sanitizeText,
  parseArxivAtom,
  formatCitation,
  mapSearchEntry,
  mapDailyEntry,
};
