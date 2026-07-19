'use strict';

const path = require('path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// This script lives in <repo>/bin/, so the repo root is one level up.
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');

function dateRange(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Track the last completed run so subsequent invocations auto-pick up where they left off.
const STATE_PATH = path.join(ROOT, '.hf_papers_last_run.json');

function readLastRun() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return null; }
}

function writeLastRun(state) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n'); } catch (e) {
    process.stderr.write(`warn: could not write ${STATE_PATH}: ${e.message}\n`);
  }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUTC(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const today = todayUTC();
  const last = readLastRun();
  // Defaults: start = day after last run's end (or 30 days ago if no state), end = today.
  const defaultStart = last && last.end ? addDaysUTC(last.end, 1) : addDaysUTC(today, -30);
  const start = process.argv[2] || defaultStart;
  const end = process.argv[3] || today;
  const dates = dateRange(start, end);
  process.stderr.write(`window: ${start} -> ${end} (${dates.length} days)\n`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: ROOT,
    env: { ...process.env },
  });

  const client = new Client({ name: 'hf-papers-weekly-runner', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);

  const byDay = {};
  for (const date of dates) {
    process.stderr.write(`fetching ${date}...\n`);
    try {
      const result = await client.callTool({
        name: 'hf_papers_daily',
        arguments: { date, limit: 15 },
      });
      try { byDay[date] = JSON.parse(result.content[0].text); }
      catch { byDay[date] = result; }
    } catch (e) {
      byDay[date] = { error: e.message };
    }
  }

  const outPath = `/tmp/hf_papers_${start}_to_${end}.json`;
  fs.writeFileSync(outPath, JSON.stringify(byDay, null, 2));
  process.stderr.write(`wrote ${outPath}\n`);
  console.log(outPath);
  writeLastRun({ start, end, completed_at: new Date().toISOString(), output: outPath });
  await client.close();
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
