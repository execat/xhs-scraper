'use strict';
/*
 * Tests for the two split builds: scrape-weibo.generated.js and
 * scrape-xhs.generated.js (produced by `npm run build` from scrape.js).
 *
 * scope: prove the split did not change behaviour. The oracles here are the
 * same ones test/scrape.test.js uses (PLAN.md's sample rows), asserted
 * byte-for-byte against each split file independently — not against scrape.js,
 * which is a separate deliverable.
 *
 * Plus the three things only a generated/split file can get wrong:
 *   - the browser-vs-CommonJS branch in the wrapper (per file);
 *   - the build being stale relative to scrape.js;
 *   - the other site's code leaking into a site build.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const W = require('../scrape-weibo.generated.js');
const X = require('../scrape-xhs.generated.js');

const ROOT = path.join(__dirname, '..');
const WEIBO_BUILD = 'scrape-weibo.generated.js';
const XHS_BUILD = 'scrape-xhs.generated.js';

const NOW = Date.parse('2026-10-05T00:00:00Z');
// Every fixture post is from September 2026, so default-window calls pin the month.
const SEPT = { month: '2026-09' };
const WEIBO_URL = 'https://weibo.com/7435186337';
const XHS_URL = 'https://www.xiaohongshu.com/user/profile/6308604100000000120013e8';

function envOf(dom) {
  return {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    now: NOW,
  };
}

function domEnv(file, url) {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  return { dom, env: envOf(dom) };
}

function assertCsv(actual, expected, label) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  assert.equal(a.length, e.length, `${label}: line count ${a.length} != ${e.length}`);
  for (let i = 0; i < e.length; i++) assert.equal(a[i], e[i], `${label}: line ${i + 1} differs`);
}

// Independent RFC4180 escalation — the oracles must not be self-confirming.
function q(s) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const P1 = '近日，受台风"白海豚"影响，象山县新联会会员、茅洋乡新联会会长史英子的象山里火龙果庄园的线下采摘及外销渠道受阻，基地约5000斤火龙果集中成熟，大量鲜果面临滞销积压。';
const P2 = '台风过境后，象山县新联会积极开展受灾会员走访慰问工作，深入火龙果庄园实地查看灾情，细致询问果园损失与销售难题。了解会员的迫切诉求后，县新联会迅速开展"象新力•助梦计划"爱心助农公益活动，号召广大会员伸出援手，通过以购代扶的方式助力史英子渡过难关。认购活动一经发出便得到热烈响应，广大会员主动接龙下单、踊跃采购。短短48小时内，共有29位会员参与采购，累计认购火龙果396箱，总量达1980斤，及时缓解了果园销售压力，为会员解决了燃眉之急。';
const P3A = '本次爱心助农公益行动既是助农帮扶，更是县新联会心系会员、暖心互助的生动缩影，充分彰显新阶层群体守望相助的温情。下一步，县新联会将持续擦亮"象新力•助梦计划"品牌，常态化倾听会员诉求、对接帮扶资源，全方位为会员排忧解难，为乡村产业振兴汇聚更强新阶层力量。#寻美象山##象新力##象新力助梦计划 ##寻美浙江##寻美宁波# http://t.cn/AXWaR9da';
const P3B = '本次爱心助农公益行动既是助农帮扶，更是县新联会心系会员、暖心互助的生动缩影，充分彰显新阶层群体守望相助的温情。下一步，县新联会将持续擦亮"象新力•助梦计划"品牌，常态化倾听会员诉求、对接帮扶资源，全方位为会员排忧解难，为乡村产业振兴汇聚更强新阶层力量。#寻美象山 #象新力 #象新力助梦计划 http://t.cn/AXWaQoLH';
const RAW1 = `${P1}\n${P2}\n${P3A}`;
const RAW2 = `${P1}\n${P2}\n${P3B}`;
const RAW_ORIG = '【助农】象山火龙果爱心认购活动圆满结束，48小时认购1980斤。感谢每一位伸出援手的朋友。';

const WEIBO_HEADER = 'no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content';

// ------------------------------------------------------------------- weibo

test('split weibo: golden CSV matches PLAN.md sample rows byte for byte', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const res = W.scrapeWeibo(env, SEPT);
  const csv = W.toCsv(W.COLS, res.rows);

  const expected = [
    WEIBO_HEADER,
    '1,https://weibo.com/7435186337/RkvSCaGly,' + q(RAW1) + ',2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,',
    '2,https://weibo.com/7435186337/RkvMvj9eJ,' + q(RAW2) + ',2026-09-30 16:39:36,2026-09-30 08:39:36,no,,,,',
    '3,https://weibo.com/7435186337/RkAcbd123,' + q('转发微博') + ',2026-09-30 16:30:00,2026-09-30 08:30:00,yes,2026-09-30 14:33:20,浙江发布,https://weibo.com/1987654321/RkA000111,' + q(RAW_ORIG),
  ].join('\n');
  assertCsv(csv, expected, 'split weibo golden');

  assert.equal(res.rows.length, 3);
  assert.equal(res.stats.outOfRange, 1, 'the June post is filtered out');
  assert.equal(res.stats.undated, 1, 'the pinned post has no parseable date');
});

test('split weibo: API mode reproduces PLAN.md rows byte for byte', async () => {
  const json = (o) => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });
  const post = (created_at, mblogid) => ({
    created_at, mblogid, mid: 'mid-' + mblogid, text_raw: 'clipped…',
    isLongText: true, user: { idstr: '7435186337', screen_name: '寻美象山' },
  });
  const fakeFetch = (url) => {
    if (url.startsWith('/ajax/statuses/longtext')) {
      return json({ data: { longTextContent_raw: /mid-RkvSCaGly/.test(url) ? RAW1 : RAW2 } });
    }
    if (/page=1&/.test(url)) {
      return json({ data: { list: [post('Wed Sep 30 16:54:39 +0800 2026', 'RkvSCaGly'),
        post('Wed Sep 30 16:39:36 +0800 2026', 'RkvMvj9eJ')] } });
    }
    return json({ data: { list: [] } });
  };

  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = await W.runWeiboApi(
      { window: { fetch: fakeFetch, navigator: {} }, location: { pathname: '/u/7435186337' }, now: NOW },
      { uid: '7435186337', start: '2026-09-30', end: '2026-09-30', moreInfo: true },
    );
  } finally {
    console.log = realLog;
  }

  const expected = [
    WEIBO_HEADER,
    '1,https://weibo.com/7435186337/RkvSCaGly,' + q(RAW1) + ',2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,',
    '2,https://weibo.com/7435186337/RkvMvj9eJ,' + q(RAW2) + ',2026-09-30 16:39:36,2026-09-30 08:39:36,no,,,,',
  ].join('\n');
  assertCsv(res.csv, expected, 'split weibo api golden');
  assert.equal(res.stats.longTextFetched, 2);
  assert.equal(res.stats.stopReason, 'empty');
  assert.equal(res.mode, 'api');
});

test('split weibo: falls back to the page when the feed is unavailable', async () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const realLog = console.log, realWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  let res;
  try {
    res = await W.run(Object.assign({}, env, { window: Object.assign({}, env.window, { fetch: undefined }) }), SEPT);
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  assert.equal(res.site, 'weibo');
  assert.equal(res.mode, undefined, 'DOM path was used');
  assert.equal(res.rows.length, 3);
});

// --------------------------------------------------------------------- xhs

test('split xhs: golden CSV matches PLAN.md sample rows byte for byte', () => {
  const { env } = domEnv('xhs-profile.html', XHS_URL);
  const res = X.scrapeXhs(env, SEPT);
  const csv = X.toCsv(X.COLS, res.rows);

  const N1 = '6abccdd5000000001800471b';
  const T1 = 'ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw';
  const N2 = '6abb588c000000001400032d';
  const T2 = 'ABncDfNU27MaDlTJyzr0Q2Bi-lmBfRn9QC-FZv7tW0-eo';
  const CAP1 = '近日，受台风"白海豚"影响，象山县新联会会员、茅洋乡新联会会长史英子的象山里火龙';

  const expected = [
    'no,note_id,posted_at_utc+08,posted_at_utc,caption,link,link_alt,link_as_scraped',
    `1,${N1},2026-09-30 16:52:37,2026-09-30 08:52:37,${q(CAP1)},` +
      `https://www.xiaohongshu.com/explore/${N1}?xsec_token=${T1}%3D&xsec_source=pc_user,` +
      `https://www.rednote.com/discovery/item/${N1}?xsec_token=${T1}%3D&xsec_source=pc_user,` +
      `https://www.xiaohongshu.com/explore/${N1}?xsec_token=${T1}=&xsec_source=pc_user`,
    `2,${N2},2026-09-29 14:19:56,2026-09-29 06:19:56,寻美象山 寻美宁波 寻美浙江,` +
      `https://www.xiaohongshu.com/explore/${N2}?xsec_token=${T2}%3D&xsec_source=pc_user,` +
      `https://www.rednote.com/discovery/item/${N2}?xsec_token=${T2}%3D&xsec_source=pc_user,` +
      `https://www.xiaohongshu.com/explore/${N2}?xsec_token=${T2}=&xsec_source=pc_user`,
  ].join('\n');

  assertCsv(csv, expected, 'split xhs golden');
  assert.equal(res.rows.length, 2);
  assert.equal(res.stats.outOfRange, 1, 'the June note is filtered out');
  assert.equal(res.stats.duplicate, 3, 'cover+title anchors collapse to one row per note');
});

test('split xhs: warns on a pre-hydration page instead of returning a silent empty CSV', () => {
  const { env } = domEnv('xhs-profile-prehydration.html', XHS_URL);
  const res = X.scrapeXhs(env, SEPT);
  assert.equal(res.rows.length, 0);
  assert.ok(res.cardCount > 0, 'the cards are there');
  assert.match(String(res.warning), /0 note links/);
});

test('split xhs: note id encodes the post timestamp', () => {
  assert.equal(X.fmtUtc8(X.objectIdToMs('6abccdd5000000001800471b', NOW)), '2026-09-30 16:52:37');
});

// ------------------------------------------------------- wrapper bootstrap
// The trap these guards exist for: some pages define a global `module`, so a
// wrapper that tests `module` before `window` silently does nothing when pasted
// into a console. Both split files must bootstrap the browser branch.
for (const file of [WEIBO_BUILD, XHS_BUILD]) {
  test(`split ${file}: bootstraps in the browser even when a global \`module\` exists`, () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'weibo-profile.html'), 'utf8');
    const vc = new VirtualConsole(); // swallow the load-time "ready" hint
    const dom = new JSDOM(html, { url: WEIBO_URL, runScripts: 'outside-only', virtualConsole: vc });
    const w = dom.window;
    w.console = { log() {}, warn() {}, error() {} };
    w.module = { exports: {} }; // <-- the trap

    w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    assert.equal(typeof w.scrape, 'function', 'scrape() must exist');
    assert.equal(typeof w.diagnose, 'function', 'diagnose() must exist');
    assert.equal(typeof w.saveCsv, 'function', 'saveCsv() must exist');
    assert.ok(w[file === WEIBO_BUILD ? 'weiboScraper' : 'xhsScraper'], 'namespace handle');
    for (const k of Object.keys(w.module.exports)) assert.fail(`took the CommonJS branch (${k})`);
  });
}

// ---------------------------------------------------------------- paste
// Pasting defines the API and runs nothing. Only a real eval of the browser
// branch can check that, so this mirrors the paste.
test('paste: loading a file only defines the API, and scrape() defaults to URLs', async () => {
  const cases = [
    ['scrape.js', 'xhs-profile.html', XHS_URL], // the XHS path is synchronous
    [XHS_BUILD, 'xhs-profile.html', XHS_URL],
    [WEIBO_BUILD, 'weibo-profile.html', WEIBO_URL],
  ];
  for (const [file, fixture, url] of cases) {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8');
    const vc = new VirtualConsole();
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: vc });
    const w = dom.window;
    w.console = { log() {}, warn() {}, error() {} };
    w.fetch = () => Promise.reject(new Error('no feed in this test'));

    w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    // 1. nothing ran: no CSV, no result, nothing on the clipboard path
    assert.equal(typeof w.scrape, 'function', `${file}: scrape() must exist`);
    assert.equal(w.__xwsCsv, undefined, `${file}: loading must not scrape`);
    assert.equal(w.__xwsResult, undefined, `${file}: loading must not scrape`);

    // 2. the default run is one URL per line
    const res = await w.scrape(SEPT);
    const csv = String(res && res.csv);
    assert.equal(csv.split('\n')[0], 'link', `${file}: the default CSV is one column`);
    assert.ok(csv.split('\n').length > 1, `${file}: and it has rows`);
    assert.equal(res.moreInfo, false, `${file}: moreInfo is off by default`);
    assert.deepEqual(res.links, res.rows.map((r) => r.link), `${file}: $_.links`);

    // 3. and the full table is still one flag away (a promise on the weibo feed path)
    const full = await w.scrape({ month: '2026-09', moreInfo: true });
    assert.match(String(full.csv).split('\n')[0], /^no,/, `${file}: moreInfo restores the table`);
  }
});

// --------------------------------------------------------- field selection
// The generated files go through the build edits, so exercising `fields` here is
// what proves those edits kept working (COLS is one array per site in them).
test('split builds: fields: [...] picks columns and validates against that site', () => {
  const realLog = console.log;
  console.log = () => {};
  try {
    const { env } = domEnv('xhs-profile.html', XHS_URL);
    const x = X.run(env, { month: '2026-09', fields: ['note_id', 'link'] });
    assert.equal(x.csv.split('\n')[0], 'note_id,link');
    assert.deepEqual(x.fields, ['note_id', 'link']);
    assert.match(x.csv.split('\n')[1], /^6abccdd5000000001800471b,https:\/\/www\.xiaohongshu\.com/);
    assert.throws(() => X.run(env, { fields: ['content'] }), /Allowed headings on xhs: no, note_id/);

    const w = domEnv('weibo-profile.html', WEIBO_URL);
    const res = W.run(w.env, { month: '2026-09', mode: 'dom', fields: ['link', 'is_repost'] });
    assert.equal(res.csv.split('\n')[0], 'link,is_repost');
    assert.throws(() => W.run(w.env, { mode: 'dom', fields: ['note_id'] }),
      /Allowed headings on weibo: no, link, content/);
  } finally {
    console.log = realLog;
  }
});

// ---------------------------------------------------------------- build rules

test('build: the checked-in split files are up to date with scrape.js', () => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-split.js'), '--check'], { stdio: 'pipe' });
  } catch (e) {
    assert.fail(
      'the generated split files are stale (or the build failed):\n' +
      String(e.stdout || '') + String(e.stderr || '') + '\nrun: npm run build',
    );
  }
});

test('build: neither site build carries the other site', () => {
  const weibo = fs.readFileSync(path.join(ROOT, WEIBO_BUILD), 'utf8');
  const xhs = fs.readFileSync(path.join(ROOT, XHS_BUILD), 'utf8');

  // No identifiers, selectors or literals from the other site.
  for (const needle of ['XHS_', 'xhs', 'xiaohongshu', 'noteId', 'scrapeXhs']) {
    assert.ok(!weibo.includes(needle), `weibo build must not mention "${needle}"`);
  }
  for (const needle of ['WEIBO_', 'weibo', 'weiboItem', 'mblogid', 'scrapeWeibo']) {
    assert.ok(!xhs.includes(needle), `xhs build must not mention "${needle}"`);
  }
});

test('build: each site build wraps a single IIFE and does not auto-run', () => {
  for (const file of [WEIBO_BUILD, XHS_BUILD]) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, /^\/\*![\s\S]*GENERATED FILE/, `${file}: generated header banner`);
    assert.ok(!/out = root\.scrape\(/.test(src), `${file}: must not scrape on load`);
    assert.match(src, /ready\. scrape\(\) = post URLs/, `${file}: prints the paste-time hint`);
    assert.equal(src.trimEnd().slice(-3), '});', `${file}: closes the UMD call`);
  }
});
