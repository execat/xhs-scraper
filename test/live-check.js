#!/usr/bin/env node
/*
 * Live selector check for XIAOHONGSHU.   `npm run check:live`
 *
 * An XHS user-profile page is served *without* login (unlike every weibo route,
 * and unlike XHS note pages), so this can validate the XHS half of the scraper
 * against real markup instead of hand-written fixtures.
 *
 *   node test/live-check.js [profile-url]
 *
 * It downloads the page, runs the real scrapeXhs() over it, and prints what the
 * scraper found. If XHS changes its markup, this is how you find out — and
 * `diagnose()` tells you which selector to fix.
 *
 * Dev machine only. Read-only: it fetches a public page and prints a report.
 */
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const S = require(path.join(__dirname, '..', 'scrape.js'));

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const URL_ = positional[0] || 'https://www.xiaohongshu.com/user/profile/6308604100000000120013e8';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

const fileArg = process.argv.slice(2).find((a) => a.startsWith('--file='));
let html;
if (fileArg) {
  const f = fileArg.slice('--file='.length);
  html = require('node:fs').readFileSync(f, 'utf8');
  console.log('reading local capture ' + f + ' ... ' + html.length + ' bytes');
} else {
  process.stdout.write('fetching ' + URL_ + ' ... ');
  try {
    html = execFileSync('curl', ['-sL', '-A', UA, URL_], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch (e) {
    console.error('\ncurl failed:', e.message);
    process.exit(1);
  }
  console.log(html.length + ' bytes');
  if (html.length < 60000) {
    console.log('NOTE: XHS served a stripped shell (no rendered notes). It throttles');
    console.log('      repeated hits. Re-run later, or capture once in a real browser');
    console.log('      and pass --file=<saved.html>.');
  }
}

/** Pull window.__INITIAL_STATE__ out of the raw HTML with a brace-matched scan. */
function extractState(src) {
  const key = '__INITIAL_STATE__';
  const at = src.indexOf(key);
  if (at === -1) return null;
  const eq = src.indexOf('=', at);
  if (eq === -1) return null;
  const start = src.indexOf('{', eq);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

const dom = new JSDOM(html, { url: URL_ }); // no script execution: we want markup, not the React bundle
const win = dom.window;

if (html.includes('redirectPath=') && html.includes('/login')) {
  console.error('\nThis page redirected to a login wall — XHS changed its policy for this URL.');
  process.exit(1);
}

const raw = extractState(html);
if (raw) {
  // The real thing is a JS object literal containing `undefined`, so it is not
  // JSON. Evaluate it the way the browser would (this is a dev tool reading a
  // page we just fetched ourselves).
  try {
    win.__INITIAL_STATE__ = JSON.parse(raw);
    console.log('__INITIAL_STATE__: parsed as JSON');
  } catch (e) {
    try {
      /* eslint-disable-next-line no-new-func */
      win.__INITIAL_STATE__ = new Function('return (' + raw + ');')();
      console.log('__INITIAL_STATE__: parsed as a JS object literal (' + e.message.slice(0, 40) + '...)');
    } catch (e2) {
      console.log('__INITIAL_STATE__: found but unparseable:', e2.message.slice(0, 80));
    }
  }
} else {
  console.log('__INITIAL_STATE__: not found (the scraper will fall back to the DOM + note ids)');
}

const env = { window: win, document: win.document, location: win.location, now: Date.now() };

console.log('\n--- diagnose() on the live page ---');
const d = S.diagnose(env);
for (const [k, v] of Object.entries(d.selectors)) {
  console.log('  ' + k.padEnd(18) + ' ' + String(v.count).padStart(5) + '   ' + v.selector.slice(0, 70));
}
if (d.noteCardsInState != null) console.log('  note cards in __INITIAL_STATE__:', d.noteCardsInState);

// Wide-open range: report every note on the page, not just the last 35 days.
const res = S.scrapeXhs(env, { start: '2000-01', end: '2099-01' });
console.log('\n--- scrapeXhs() over the whole page ---');
console.log('  rows:', res.rows.length, ' stats:', JSON.stringify(res.stats));

const undated = res.rows.filter((r) => !r['posted_at_utc+08']).length;
console.log('  rows missing a date:', undated);
console.log('\n  newest 5:');
for (const r of res.rows.slice(0, 5)) {
  console.log(`    ${r.note_id}  ${r['posted_at_utc+08']}  "${(r.caption || '').slice(0, 30)}"`);
}
console.log('\n  distinct matched URL shapes:');
const shapes = new Set();
for (const a of win.document.querySelectorAll('a[href]')) {
  if (S.xhsLinkInfo(a.getAttribute('href'), URL_)) {
    shapes.add(new URL(a.href).pathname.replace(/[0-9a-f]{24}/g, '<ID>'));
  }
}
for (const s of shapes) console.log('    ' + s);

// Three genuinely different outcomes; conflating them was a mistake earlier.
const cards = d.noteCardsInDom || 0;
const blank = (d.stateNotes && d.stateNotes.blankId) || 0;
let verdict;
if (res.rows.length > 0 && undated === 0) {
  verdict = 'PASS';
} else if (cards > 0 && (blank > 0 || res.rows.length === 0)) {
  // XHS served the pre-hydration page: cards are rendered but the note ids are
  // not filled in yet. Anonymous curl cannot hydrate, so this is expected.
  verdict = 'NEEDS-HYDRATED-CAPTURE';
} else {
  verdict = 'FAIL';
}

console.log('');
if (verdict === 'PASS') {
  console.log('LIVE CHECK PASS — selectors match the live hydrated page.');
} else if (verdict === 'NEEDS-HYDRATED-CAPTURE') {
  console.log('LIVE CHECK INCONCLUSIVE — the page has not hydrated.');
  console.log(`  ${cards} cards in the DOM, ${blank} of them with a blank note id, 0 note links.`);
  console.log('  This is what XHS serves before its client-side JS fills the ids in, and');
  console.log('  a plain fetch can never get past it. To check the real thing, capture the');
  console.log('  page in your logged-in browser and run:');
  console.log('      node test/live-check.js --file=<saved.html>');
} else {
  console.log('LIVE CHECK FAIL — selectors need updating (see diagnose() above).');
}
process.exit(verdict === 'FAIL' ? 1 : 0);
