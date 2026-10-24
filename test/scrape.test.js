'use strict';
/*
 * Dev-machine test suite.  `npm test`
 *
 * The deliverable (scrape.js) has zero runtime dependencies; this suite needs
 * jsdom, which is a devDependency only.  Nothing here runs on the locked-down
 * machine you actually scrape from.
 *
 * The golden tests assert byte-for-byte equality with the sample rows in
 * PLAN.md, so the CSV contract is pinned to the spec rather than to my taste.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const S = require('../scrape.js');

const NOW = Date.parse('2026-10-05T00:00:00Z'); // fixed "now" for deterministic ranges
// Every fixture post is from September 2026, so default-window calls pin the month.
const SEPT = { month: '2026-09' };
const WEIBO_URL = 'https://weibo.com/7435186337';
const XHS_URL = 'https://www.xiaohongshu.com/user/profile/6308604100000000120013e8';

function loadFixture(file, url) {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
  return new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
}

function envOf(dom) {
  return {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    now: NOW,
  };
}

function domEnv(file, url) {
  const dom = loadFixture(file, url);
  return { dom, env: envOf(dom) };
}

/** Compare CSVs line by line so a failure names the offending row. */
function assertCsv(actual, expected, label) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  assert.equal(a.length, e.length, `${label}: line count ${a.length} != ${e.length}`);
  for (let i = 0; i < e.length; i++) {
    assert.equal(a[i], e[i], `${label}: line ${i + 1} differs`);
  }
}

// The raw post text, transcribed from PLAN.md with the CSV quote-doubling
// removed.  Independent of scrape.js — this is the oracle.
const P1 = '近日，受台风"白海豚"影响，象山县新联会会员、茅洋乡新联会会长史英子的象山里火龙果庄园的线下采摘及外销渠道受阻，基地约5000斤火龙果集中成熟，大量鲜果面临滞销积压。';
const P2 = '台风过境后，象山县新联会积极开展受灾会员走访慰问工作，深入火龙果庄园实地查看灾情，细致询问果园损失与销售难题。了解会员的迫切诉求后，县新联会迅速开展"象新力•助梦计划"爱心助农公益活动，号召广大会员伸出援手，通过以购代扶的方式助力史英子渡过难关。认购活动一经发出便得到热烈响应，广大会员主动接龙下单、踊跃采购。短短48小时内，共有29位会员参与采购，累计认购火龙果396箱，总量达1980斤，及时缓解了果园销售压力，为会员解决了燃眉之急。';
const P3A = '本次爱心助农公益行动既是助农帮扶，更是县新联会心系会员、暖心互助的生动缩影，充分彰显新阶层群体守望相助的温情。下一步，县新联会将持续擦亮"象新力•助梦计划"品牌，常态化倾听会员诉求、对接帮扶资源，全方位为会员排忧解难，为乡村产业振兴汇聚更强新阶层力量。#寻美象山##象新力##象新力助梦计划 ##寻美浙江##寻美宁波# http://t.cn/AXWaR9da';
const P3B = '本次爱心助农公益行动既是助农帮扶，更是县新联会心系会员、暖心互助的生动缩影，充分彰显新阶层群体守望相助的温情。下一步，县新联会将持续擦亮"象新力•助梦计划"品牌，常态化倾听会员诉求、对接帮扶资源，全方位为会员排忧解难，为乡村产业振兴汇聚更强新阶层力量。#寻美象山 #象新力 #象新力助梦计划 http://t.cn/AXWaQoLH';

const RAW1 = `${P1}\n${P2}\n${P3A}`;
const RAW2 = `${P1}\n${P2}\n${P3B}`;
const RAW_ORIG = '【助农】象山火龙果爱心认购活动圆满结束，48小时认购1980斤。感谢每一位伸出援手的朋友。';

// An independent RFC4180 escalation, so the escaping is not self-confirmed.
function q(s) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_W_BASE = [
  '2,https://weibo.com/7435186337/RkvMvj9eJ,' + q(RAW2) + ',2026-09-30 16:39:36,2026-09-30 08:39:36,no,,,,',
  '3,https://weibo.com/7435186337/RkAcbd123,' + q('转发微博') + ',2026-09-30 16:30:00,2026-09-30 08:30:00,yes,2026-09-30 14:33:20,浙江发布,https://weibo.com/1987654321/RkA000111,' + q(RAW_ORIG),
].join('\n');

// ---------------------------------------------------------------------- weibo

test('weibo: golden CSV matches PLAN.md sample rows byte for byte', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const res = S.scrapeWeibo(env, SEPT);

  const expected = [
    'no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content',
    '1,https://weibo.com/7435186337/RkvSCaGly,' + q(RAW1) + ',2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,',
    CSV_W_BASE,
  ].join('\n');

  const csv = S.toCsv(S.COLS.weibo, res.rows);
  assertCsv(csv, expected, 'weibo golden');

  // PLAN.md's row 1 literally contains doubled quotes: prove we emit the same.
  assert.ok(csv.includes('受台风""白海豚""影响'), 'inner quotes must be doubled, as in PLAN.md');
  assert.ok(csv.includes('""象新力•助梦计划""'), 'inner quotes must be doubled, as in PLAN.md');
  // ...and that a full-width comma is not treated as a delimiter.
  assert.ok(!csv.includes('"转发微博"'), 'a field with no , " or newline must not be quoted');

  assert.equal(res.rows.length, 3, 'only in-range posts');
  assert.equal(res.stats.outOfRange, 1, 'the June post is filtered out');
  assert.equal(res.stats.undated, 1, 'the pinned post has no parseable date');
  assert.ok(res.stats.duplicate >= 1, 'the repost /转发 /评论 anchors are de-duplicated');
  assert.equal(res.stats.noContainer, 0);
});

test('weibo: the nested original of a repost is never emitted as its own row', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const res = S.scrapeWeibo(env, SEPT);
  const links = res.rows.map((r) => r.link);
  assert.ok(!links.includes('https://weibo.com/1987654321/RkA000111'), 'original must not be a row');
  const repost = res.rows.find((r) => r.link.endsWith('RkAcbd123'));
  assert.equal(repost.is_repost, 'yes');
  assert.equal(repost.original_author, '浙江发布');
  assert.equal(repost.original_link, 'https://weibo.com/1987654321/RkA000111');
});

test('weibo: navigation anchors are not mistaken for posts', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const res = S.scrapeWeibo(env, SEPT);
  for (const r of res.rows) {
    assert.match(r.link, /^https:\/\/weibo\.com\/\d+\/[0-9A-Za-z]+$/, `bad link ${r.link}`);
  }
  assert.ok(!res.rows.some((r) => /\/(profile|follow|fans)$/.test(r.link)));
});

test('weibo: explicit month range narrows the window', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const all = S.scrapeWeibo(env, { start: '2026-01', end: '2026-12' });
  assert.equal(all.rows.length, 4, 'whole-year range picks up the June post too');
  const sept = S.scrapeWeibo(env, { start: '2026-09', end: '2026-09' });
  assert.equal(sept.rows.length, 3);
  const aug = S.scrapeWeibo(env, { start: '2026-08', end: '2026-08' });
  assert.equal(aug.rows.length, 0);
});

// ------------------------------------------------------------------------ xhs

test('xhs: golden CSV matches PLAN.md sample rows byte for byte', () => {
  const { env } = domEnv('xhs-profile.html', XHS_URL);
  const res = S.scrapeXhs(env, SEPT);
  const csv = S.toCsv(S.COLS.xhs, res.rows);

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

  assertCsv(csv, expected, 'xhs golden');
  assert.equal(res.rows.length, 2);
  assert.equal(res.stats.outOfRange, 1, 'the June note is filtered out');
  assert.equal(res.stats.duplicate, 3, 'cover+title anchors collapse to one row per note');
});

test('xhs: same note id on the rednote.com URL shape yields the same note_id', () => {
  const { dom } = domEnv('xhs-profile.html', XHS_URL);
  const a = dom.window.document.createElement('a');
  a.setAttribute('href', 'https://www.rednote.com/user/profile/6308604100000000120013e8/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw=&xsec_source=pc_user');
  const info = S.xhsLinkInfo(a.getAttribute('href'), XHS_URL);
  assert.equal(info.noteId, '6abccdd5000000001800471b');
  assert.equal(info.xsecToken, 'ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw=');
  assert.equal(info.xsecSource, 'pc_user');
});

test('xhs: the page author anchor is not treated as a note', () => {
  const { dom } = domEnv('xhs-profile.html', XHS_URL);
  const href = dom.window.document.querySelector('a.author').getAttribute('href');
  assert.equal(S.xhsLinkInfo(href, XHS_URL), null);
});

test('xhs: warns clearly on a real pre-hydration page instead of returning a silent empty CSV', () => {
  // Mirrors a real anonymous capture (see the fixture header). Cards exist, the
  // state is populated, but no link carries a note id and every noteCard.noteId
  // is "". The dangerous outcome here is silence, so that is what we assert on.
  const { env, dom } = domEnv('xhs-profile-prehydration.html', XHS_URL);
  const res = S.scrapeXhs(env, SEPT);
  assert.equal(res.rows.length, 0);
  assert.equal(res.cardCount, 2, 'the cards are found');
  assert.match(res.warning || '', /note cards but 0 note links/);
  assert.match(res.warning || '', /diagnose\(\)/);

  const realLog = console.warn;
  let warned = '';
  console.warn = (msg) => { warned += String(msg); };
  try {
    S.run(env, SEPT);
  } finally {
    console.warn = realLog;
  }
  assert.match(warned, /note cards but 0 note links/, 'the warning reaches the console');

  // diagnose() distinguishes "not hydrated yet" from "markup changed".
  const d = S.diagnose(env);
  assert.equal(d.noteCardsInDom, 2);
  assert.equal(d.noteCardsInState, 0, 'no usable note cards in the state');
  assert.deepEqual(d.stateNotes, { noteCards: 2, blankId: 2, filledId: 0 });
  assert.equal(d.selectors['xhs.cards'].count, 2);
});

test('xhs: recovers the note id from data-note-id when the href carries none', () => {
  // The live capture shows section.note-item with a data-note-id attribute that
  // XHS fills in client-side, and card hrefs of the form
  // /user/profile/<uid>/?xsec_token=…&xsec_source=pc_user (no id). This is that
  // shape, hydrated.
  const html = '<!doctype html><html><head></head><body><div class="feeds-container">'
    + '<section class="note-item" data-note-id="6abccdd5000000001800471b" data-index="0">'
    + '<a style="display:none;" href="/explore/"></a>'
    + '<a class="cover mask" href="/user/profile/6308604100000000120013e8/?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw=&amp;xsec_source=pc_user">'
    + '<img src="c1.jpg" alt=""></a>'
    + '<a class="title" href="/user/profile/6308604100000000120013e8/?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw=&amp;xsec_source=pc_user">'
    + '<span>标题一</span></a></section>'
    + '</div></body></html>';
  const dom = new JSDOM(html, { url: XHS_URL });
  const res = S.scrapeXhs(envOf(dom), SEPT);

  assert.equal(res.rows.length, 1, 'the card yields exactly one row');
  assert.equal(res.rows[0].note_id, '6abccdd5000000001800471b');
  assert.equal(res.rows[0]['posted_at_utc+08'], '2026-09-30 16:52:37', 'date derived from the id');
  assert.equal(res.rows[0].caption, '标题一');
  assert.equal(res.rows[0].link,
    'https://www.xiaohongshu.com/explore/6abccdd5000000001800471b'
    + '?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw%3D&xsec_source=pc_user');
  assert.equal(res.warning, null, 'a hydrated page must not warn');
});

test('xhs: inspectStateNotes reports ids once they are populated', () => {
  const { env } = domEnv('xhs-profile.html', XHS_URL);
  const info = S.inspectStateNotes(env.window.__INITIAL_STATE__);
  assert.deepEqual(info, { noteCards: 2, blankId: 0, filledId: 2 });
  assert.equal(Object.keys(S.collectNoteCards(env.window.__INITIAL_STATE__)).length, 2);
});

// --------------------------------------------------------------- identifiers

test('xhs: note id encodes the post timestamp (ObjectId -> ms)', () => {
  assert.equal(S.objectIdToMs('6abccdd5000000001800471b', NOW), Date.parse('2026-09-30T08:52:37Z'));
  assert.equal(S.objectIdToMs('6abb588c000000001400032d', NOW), Date.parse('2026-09-29T06:19:56Z'));
  assert.equal(S.objectIdToMs('nope', NOW), null);
  // 2015-era id is plausible; a nonsense future id is rejected so we fall back.
  assert.notEqual(S.objectIdToMs('550000000000000000000000', NOW), null);
  assert.equal(S.objectIdToMs('ffffffff0000000000000000', NOW), null);
});

test('weibo: link parsing accepts posts and rejects navigation', () => {
  const ok = S.weiboLinkInfo('//weibo.com/7435186337/RkvSCaGly?refer_flag=1005055013_', 'https://weibo.com/');
  assert.equal(ok.uid, '7435186337');
  assert.equal(ok.mblogid, 'RkvSCaGly');
  assert.equal(ok.canonical, 'https://weibo.com/7435186337/RkvSCaGly');

  assert.equal(S.weiboLinkInfo('//weibo.com/u/7435186337', 'https://weibo.com/'), null);
  assert.equal(S.weiboLinkInfo('//weibo.com/7435186337/profile', 'https://weibo.com/'), null);
  assert.equal(S.weiboLinkInfo('//weibo.com/7435186337/follow', 'https://weibo.com/'), null);
  assert.equal(S.weiboLinkInfo('//weibo.com/7435186337/fans', 'https://weibo.com/'), null);
  assert.equal(S.weiboLinkInfo('javascript:;', 'https://weibo.com/'), null);
  assert.equal(S.weiboLinkInfo('//weibo.com/7435186337', 'https://weibo.com/'), null);

  // legacy all-digit mid
  const legacy = S.weiboLinkInfo('//weibo.com/1234567890/4000000000000000', 'https://weibo.com/');
  assert.equal(legacy.mblogid, '4000000000000000');
});

// -------------------------------------------------------------------- timing

test('timing: absolute, weibo-JSON and relative formats all resolve', () => {
  assert.equal(S.parseAbsoluteDatetime('2026-09-30 16:54:39', 8), Date.parse('2026-09-30T08:54:39Z'));
  assert.equal(S.parseAbsoluteDatetime('2026-09-30 16:54', 8), Date.parse('2026-09-30T08:54:00Z'));
  assert.equal(S.parseAbsoluteDatetime('2026-09-30T16:54:39+08:00', 8), Date.parse('2026-09-30T08:54:39Z'));
  assert.equal(S.parseAbsoluteDatetime('2026-09-30T08:54:39Z', 8), Date.parse('2026-09-30T08:54:39Z'));
  assert.equal(S.parseAbsoluteDatetime('not a date', 8), null);

  assert.equal(
    S.parseWeiboCreatedAt('Wed Sep 30 16:54:39 +0800 2026', 8),
    Date.parse('2026-09-30T08:54:39Z'),
  );
  assert.equal(S.parseWeiboCreatedAt('garbage', 8), null);

  assert.equal(S.parseWeiboTimeText('20分钟前', NOW, 8), NOW - 20 * 60000);
  assert.equal(S.parseWeiboTimeText('3小时前', NOW, 8), NOW - 3 * 3600000);
  assert.equal(S.parseWeiboTimeText('刚刚', NOW, 8), NOW);
  // NOW is 2026-10-05 08:00 in UTC+8, so "today" is the 5th.
  assert.equal(S.parseWeiboTimeText('今天 10:30', NOW, 8), Date.parse('2026-10-05T10:30:00+08:00'));
  assert.equal(S.parseWeiboTimeText('昨天 10:30', NOW, 8), Date.parse('2026-10-04T10:30:00+08:00'));
  assert.equal(S.parseWeiboTimeText('09-30', NOW, 8), Date.parse('2026-09-30T00:00:00+08:00'));
  assert.equal(S.parseWeiboTimeText('9月30日', NOW, 8), Date.parse('2026-09-30T00:00:00+08:00'));
  // "01-05" is in the future relative to NOW, so it means last year.
  assert.equal(S.parseWeiboTimeText('01-05', NOW, 8), Date.parse('2026-01-05T00:00:00+08:00'));
  assert.equal(S.parseWeiboTimeText('置顶', NOW, 8), null);
});

test('timing: date attributes, titles and relative text are all read', () => {
  const dom = new JSDOM('<a id="a" date="1790758479">x</a><a id="b" title="2026-09-30 16:54:39">x</a>'
    + '<a id="c" href="//weibo.com/1/RkvSCaGly" title="2026-09-30 16:54:39">x</a>'
    + '<time id="d" datetime="2026-09-30T08:54:39Z">x</time><span id="e">20分钟前</span>'
    + '<div id="f">置顶 来自 微博 weibo.com</div>', { url: WEIBO_URL });
  const d = dom.window.document;
  const want = Date.parse('2026-09-30T08:54:39Z');
  assert.equal(S.msFromElement(d.getElementById('a'), NOW, 8), want);
  assert.equal(S.msFromElement(d.getElementById('b'), NOW, 8), want);
  assert.equal(S.msFromElement(d.getElementById('c'), NOW, 8), want);
  assert.equal(S.msFromElement(d.getElementById('d'), NOW, 8), want);
  assert.equal(S.msFromElement(d.getElementById('e'), NOW, 8), NOW - 20 * 60000);
  assert.equal(S.msFromElement(d.getElementById('f'), NOW, 8), null);
});

test('timing: the default window is the current month, and month: sets both ends', () => {
  // NOW is 2026-10-05T00:00:00Z = 08:00 on the 5th in UTC+8, so "this month" is October.
  const dflt = S.parseRange({}, NOW);
  assert.equal(S.fmtUtc8(dflt.startMs), '2026-10-01 00:00:00');
  assert.equal(S.fmtUtc8(dflt.endMs), '2026-10-31 23:59:59');
  assert.equal(dflt.month, '2026-10', 'the resolved month is reported back');
  assert.equal(dflt.explicit, false);

  // A month boundary that straddles the UTC+8 date line still snaps correctly.
  const edge = Date.parse('2026-09-30T16:30:00Z'); // 2026-10-01 00:30 in UTC+8
  assert.equal(S.fmtUtc8(S.parseRange({}, edge).startMs), '2026-10-01 00:00:00');

  // { month } is exactly { start: <month>, end: <month> }
  const jul = S.parseRange({ month: '2026-07' }, NOW);
  assert.equal(S.fmtUtc8(jul.startMs), '2026-07-01 00:00:00');
  assert.equal(S.fmtUtc8(jul.endMs), '2026-07-31 23:59:59');
  assert.equal(jul.month, '2026-07');
  assert.equal(jul.explicit, true);
  const same = S.parseRange({ start: '2026-07', end: '2026-07' }, NOW);
  assert.deepEqual([jul.startMs, jul.endMs], [same.startMs, same.endMs]);

  // 'YYYY-M' is accepted and normalised
  assert.equal(S.parseRange({ month: '2026-7' }, NOW).month, '2026-07');

  const feb = S.parseRange({ start: '2026-02', end: '2026-02' }, NOW);
  assert.equal(S.fmtUtc8(feb.endMs), '2026-02-28 23:59:59', 'leap-year aware month end');
  assert.equal(S.fmtUtc8(S.parseRange({ month: '2028-02' }, NOW).endMs), '2028-02-29 23:59:59');

  const open = S.parseRange({ start: '2026-01' }, NOW);
  assert.equal(open.endMs, NOW, 'a lone start means "up to now"');

  const days = S.parseRange({ days: 7 }, NOW);
  assert.equal(days.startMs, NOW - 7 * 86400000, 'days still means a rolling window');

  assert.throws(() => S.parseRange({ start: 'yesterday' }, NOW), /cannot parse date/);
  assert.throws(() => S.parseRange({ month: 'july' }, NOW), /cannot parse month "july"/);
  assert.throws(() => S.parseRange({ month: '2026-13' }, NOW), /cannot parse month/);
  // month sets both ends, so combining it with a boundary is a contradiction
  assert.throws(() => S.parseRange({ month: '2026-07', start: '2026-01' }, NOW), /already sets start and end/);
  assert.throws(() => S.parseRange({ month: '2026-07', days: 7 }, NOW), /already sets start and end/);
});

// ---------------------------------------------------------------- text / csv

test('csv: escaping, and the header names are exactly PLAN.md\'s', () => {
  assert.equal(S.csvCell('plain'), 'plain');
  assert.equal(S.csvCell('a,b'), '"a,b"');
  assert.equal(S.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(S.csvCell('two\nlines'), '"two\nlines"');
  assert.equal(S.csvCell(''), '');
  assert.equal(S.csvCell(null), '');
  assert.equal(S.csvCell('全角，逗号'), '全角，逗号', 'a full-width comma is not a delimiter');
  assert.deepEqual(S.COLS.weibo, ['no', 'link', 'content', 'posted_at_utc+08', 'posted_at_utc',
    'is_repost', 'original_posted_at', 'original_author', 'original_link', 'original_content']);
  assert.deepEqual(S.COLS.xhs, ['no', 'note_id', 'posted_at_utc+08', 'posted_at_utc', 'caption',
    'link', 'link_alt', 'link_as_scraped']);
});

test('text: <br> becomes a newline, emoji alt and t.cn shortlinks survive', () => {
  const dom = new JSDOM('<div id="t" class="WB_text">line one<br/>line two<img alt="[微笑]"/>'
    + 'end <a href="http://t.cn/AXWaR9da">网页链接</a> <a href="javascript:;">展开全文</a></div>',
  { url: WEIBO_URL });
  const el = dom.window.document.getElementById('t');
  assert.equal(S.textOf(el, {}), 'line one\nline two[微笑]end http://t.cn/AXWaR9da');
});

test('text: whitespace is normalised but paragraph breaks survive', () => {
  assert.equal(S.normText('  a  \n\n\n\n b \u00a0c '), 'a\n\nb c');
  assert.equal(S.normText('​zero\u200bwidth'), 'zerowidth');
});

test('text: the fallback selector chain finds content when .WB_text is absent', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body>'
    + '<article><div class="WB_from"><a href="//weibo.com/7435186337/RkvSCaGly" date="1790758479">x</a></div>'
    + '<p node-type="feed_list_content">现代版 weibo 的正文容器</p></article>'
    + '</body></html>', { url: WEIBO_URL });
  const res = S.scrapeWeibo(envOf(dom), SEPT);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].content, '现代版 weibo 的正文容器');
  assert.equal(res.rows[0]['posted_at_utc+08'], '2026-09-30 16:54:39');
});

test('weibo: an unrelated post link inside an item is not read as a repost original', () => {
  // Regression: some feed themes put links to *other* posts inside an item
  // (cards, quotes, action links). Climbing from such a link to "the smallest
  // ancestor holding text" lands on the whole post, which used to make the item
  // look like a repost, blank its content and hide its own timestamp.
  const dom = new JSDOM('<!doctype html><html><head></head><body>'
    + '<div action-type="feed_list_item" class="WB_feed_type">'
    + '<div class="WB_detail">'
    + '<div class="WB_info"><a nick-name="甲" href="//weibo.com/u/7435186337">甲</a></div>'
    + '<div class="WB_from"><a href="//weibo.com/7435186337/RkvSCaGly" date="1790758479">x</a></div>'
    + '<div class="WB_text">正文</div>'
    + '<div class="WB_feed_handle"><a href="//weibo.com/9999999999/RkOther99">查看原微博</a></div>'
    + '</div></div></body></html>', { url: WEIBO_URL });
  const res = S.scrapeWeibo(envOf(dom), SEPT);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].is_repost, 'no', 'must not invent a repost original');
  assert.equal(res.rows[0].content, '正文');
  assert.equal(res.rows[0]['posted_at_utc+08'], '2026-09-30 16:54:39');
});

// ---------------------------------------------------------- run / autoload

test('run: auto-detects the site, prints, and exposes __xwsCsv', () => {
  const { dom, env } = domEnv('weibo-profile.html', WEIBO_URL);
  const realLog = console.log;
  console.log = () => {};
  try {
    assert.equal(S.detectSite(dom.window.location), 'weibo');
    // mode:'dom' keeps this test offline and synchronous; the API-default path
    // is covered separately.
    const res = S.run(env, { month: '2026-09', mode: 'dom', moreInfo: true });
    assert.equal(res.site, 'weibo');
    assert.equal(res.rows.length, 3);
    assert.equal(dom.window.__xwsCsv, res.csv);
    assert.ok(res.csv.startsWith('no,link,content,'));
  } finally {
    console.log = realLog;
  }
});

test('run: detectSite covers xhs, rednote and weibo.cn', () => {
  assert.equal(S.detectSite({ hostname: 'www.xiaohongshu.com' }), 'xhs');
  assert.equal(S.detectSite({ hostname: 'www.rednote.com' }), 'xhs');
  assert.equal(S.detectSite({ hostname: 'weibo.com' }), 'weibo');
  assert.equal(S.detectSite({ hostname: 'm.weibo.cn' }), 'weibo');
  assert.equal(S.detectSite({ hostname: 'example.com' }), null);
});

test('autoLoad: scrolls until the item count stops growing', async () => {
  const { dom, env } = domEnv('weibo-profile.html', WEIBO_URL);
  const doc = dom.window.document;
  const feed = doc.querySelector('.WB_feed');
  let scrolls = 0;
  dom.window.scrollTo = () => {
    scrolls++;
    if (scrolls <= 2) {
      // pretend the next page of the timeline rendered
      const item = doc.querySelector('.WB_feed_type').cloneNode(true);
      item.setAttribute('mid', 'extra' + scrolls);
      const id = 'RkExtra' + scrolls + 'X';
      // a real feed item's 转发/评论 links point at its *own* post id
      for (const an of item.querySelectorAll('a[href]')) {
        const href = an.getAttribute('href');
        if (href && href.includes('RkvSCaGly')) an.setAttribute('href', href.replace('RkvSCaGly', id));
      }
      item.querySelector('.WB_from a').setAttribute('date', String(1790759000 + scrolls));
      item.querySelector('.WB_text').textContent = '自动加载的第' + scrolls + '条';
      feed.appendChild(item);
    }
  };
  const realLog = console.log;
  console.log = () => {};
  let done;
  try {
    done = await S.autoLoad(env, { waitMs: 1, maxIdle: 2, maxScrolls: 10 });
  } finally {
    console.log = realLog;
  }
  assert.ok(done >= 3, `expected at least 3 scroll steps, got ${done}`);
  const res = S.scrapeWeibo(env, SEPT);
  assert.equal(res.rows.length, 5, 'two auto-loaded items joined the three in range');
  assert.equal(res.rows[0].link, 'https://weibo.com/7435186337/RkExtra2X', 'newest first');
  assert.equal(res.rows[0].is_repost, 'no');
});

// ------------------------------------------------------------- weibo API mode

test('weibo API mode: reproduces PLAN.md rows byte for byte', async () => {
  // Mirrors exactly what the live feed returns (verified 2026-10-10): seconds in
  // created_at, a clipped text_raw for isLongText posts, and the full text from
  // the longtext endpoint.
  const json = (o) => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });
  const post = (created_at, mblogid, extra) => Object.assign({
    created_at, mblogid, mid: 'mid-' + mblogid, text_raw: 'clipped…',
    isLongText: true, user: { idstr: '7435186337', screen_name: '寻美象山' },
  }, extra || {});

  const fakeFetch = (url) => {
    if (url.startsWith('/ajax/statuses/longtext')) {
      const full = /mid-RkvSCaGly/.test(url) ? RAW1 : RAW2;
      return json({ data: { longTextContent_raw: full } });
    }
    if (/page=1&/.test(url)) {
      return json({
        data: {
          list: [
            post('Wed Sep 30 16:54:39 +0800 2026', 'RkvSCaGly'),
            post('Wed Sep 30 16:39:36 +0800 2026', 'RkvMvj9eJ'),
          ],
        },
      });
    }
    return json({ data: { list: [] } }); // end of feed
  };

  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = await S.runWeiboApi(
      { window: { fetch: fakeFetch, navigator: {} }, location: { pathname: '/u/7435186337' }, now: NOW },
      { uid: '7435186337', start: '2026-09-30', end: '2026-09-30', moreInfo: true },
    );
  } finally {
    console.log = realLog;
  }

  const expected = [
    'no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content',
    '1,https://weibo.com/7435186337/RkvSCaGly,' + q(RAW1) + ',2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,',
    '2,https://weibo.com/7435186337/RkvMvj9eJ,' + q(RAW2) + ',2026-09-30 16:39:36,2026-09-30 08:39:36,no,,,,',
  ].join('\n');
  assertCsv(res.csv, expected, 'weibo api golden');
  assert.equal(res.stats.longTextFetched, 2, 'both clipped posts were completed');
  assert.equal(res.stats.stopReason, 'empty');
});

test('weibo API mode: pages until the window is passed, and maps reposts', async () => {
  const json = (o) => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });
  const urls = [];
  const fakeFetch = (url) => {
    urls.push(url);
    if (url.startsWith('/ajax/statuses/longtext')) return json({ data: {} });
    if (/page=1\b/.test(url)) {
      return json({
        data: {
          list: [
            { created_at: 'Wed Sep 30 16:30:00 +0800 2026', mblogid: 'RkAcbd123', mid: 'm1',
              text_raw: '转发微博', user: { idstr: '7435186337', screen_name: '寻美象山' },
              retweeted_status: {
                created_at: 'Wed Sep 30 14:33:20 +0800 2026',
                mblogid: 'RkA000111',
                mid: 'm2',
                text_raw: RAW_ORIG,
                user: { idstr: '1987654321', screen_name: '浙江发布' },
              } },
          ],
        },
      });
    }
    // page 2 is entirely older than the window -> stop
    return json({ data: { list: [{ created_at: 'Mon Jun 15 10:00:00 +0800 2026', mblogid: 'Rm2pQ7xYz', text_raw: '太旧了', user: { idstr: '1', screen_name: 'x' } }] } });
  };

  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = await S.runWeiboApi(
      { window: { fetch: fakeFetch, navigator: {} }, location: { pathname: '/u/7435186337' }, now: NOW },
      { uid: '7435186337', month: '2026-09' },
    );
  } finally {
    console.log = realLog;
  }

  assert.equal(urls.filter((u) => u.includes('mymblog')).length, 2, 'stops once past the window');
  assert.equal(res.stats.stopReason, 'reachedStart');
  assert.equal(res.rows.length, 1);
  assert.equal(res.stats.reposts, 1);

  const r = res.rows[0];
  assert.equal(r.link, 'https://weibo.com/7435186337/RkAcbd123');
  assert.equal(r.is_repost, 'yes');
  assert.equal(r.original_author, '浙江发布');
  assert.equal(r.original_link, 'https://weibo.com/1987654321/RkA000111');
  assert.equal(r.original_posted_at, '2026-09-30 14:33:20');
  assert.equal(r.original_content, RAW_ORIG);
});

test('run: on weibo.com it prefers the JSON feed and falls back to the page', async () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);

  // (a) feed unavailable -> falls back to reading the rendered page
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  let res;
  try {
    res = await S.run(Object.assign({}, env, { window: Object.assign({}, env.window, { fetch: undefined }) }), { site: 'weibo', month: '2026-09' });
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  assert.equal(res.site, 'weibo');
  assert.equal(res.mode, undefined, 'the DOM path was used');
  assert.equal(res.rows.length, 3);

  // (b) explicit opt-out
  const dom = S.run(env, { site: 'weibo', mode: 'dom', month: '2026-09' });
  assert.equal(dom.rows.length, 3);
  assert.equal(dom.mode, undefined);
});

// ------------------------------------------------------------ default output
// The default is one URL per line; `{ moreInfo: true }` is the full table.

test('default output: the CSV is just the link column on the reading path', () => {
  const { dom, env } = domEnv('weibo-profile.html', WEIBO_URL);
  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = S.run(env, { month: '2026-09', mode: 'dom' });
  } finally {
    console.log = realLog;
  }
  assert.equal(res.moreInfo, false);
  assert.equal(res.csv.split('\n')[0], 'link', 'header is the single link column');
  assert.equal(res.csv.split('\n').length, res.rows.length + 1, 'one line per post');
  assert.deepEqual(res.links, res.rows.map((r) => r.link));
  assert.equal(res.links[0], 'https://weibo.com/7435186337/RkvSCaGly');
  // the rows themselves are untouched — nothing is lost by narrowing the output
  assert.ok(res.rows[0].content.length > 0);
  assert.equal(res.rows[0]['posted_at_utc+08'], '2026-09-30 16:54:39');
  assert.equal(dom.window.__xwsCsv, res.csv);
  assert.equal(dom.window.__xwsResult.links.length, res.rows.length);
});

test('moreInfo: true restores the full table on the reading path', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = S.run(env, { month: '2026-09', mode: 'dom', moreInfo: true });
  } finally {
    console.log = realLog;
  }
  assert.equal(res.moreInfo, true);
  assert.ok(res.csv.startsWith('no,link,content,posted_at_utc+08'));
  assert.equal(res.rows[0].content.length > 0, true);
  assert.deepEqual(res.links, res.rows.map((r) => r.link), '$_.links works either way');
});

test('default output: XHS emits one canonical URL per note', () => {
  const { env } = domEnv('xhs-profile.html', XHS_URL);
  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = S.run(env, SEPT);
  } finally {
    console.log = realLog;
  }
  const N1 = '6abccdd5000000001800471b';
  assert.equal(res.rows.length, 2);
  assert.equal(res.csv.split('\n')[0], 'link');
  assert.ok(res.links[0].startsWith('https://www.xiaohongshu.com/explore/' + N1 + '?xsec_token='),
    'the canonical link, token intact — not link_alt or link_as_scraped');
  assert.ok(!res.csv.includes('rednote.com'), 'the alt link is not in the CSV');
  assert.ok(!res.csv.includes('note_id'), 'no other columns');
});

test('default output: the weibo JSON feed path emits one URL per line', async () => {
  const json = (o) => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });
  const fakeFetch = (url) => {
    if (url.startsWith('/ajax/statuses/longtext')) return json({ data: {} });
    if (/page=1\b/.test(url)) {
      return json({
        data: {
          list: [
            { created_at: 'Wed Sep 30 16:54:39 +0800 2026', mblogid: 'RkvSCaGly', mid: 'm1',
              text_raw: '正文', user: { idstr: '7435186337', screen_name: '寻美象山' } },
            { created_at: 'Wed Sep 30 16:39:36 +0800 2026', mblogid: 'RkvMvj9eJ', mid: 'm2',
              text_raw: '正文2', user: { idstr: '7435186337', screen_name: '寻美象山' } },
          ],
        },
      });
    }
    return json({ data: { list: [] } });
  };
  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = await S.runWeiboApi(
      { window: { fetch: fakeFetch, navigator: {} }, location: { pathname: '/u/7435186337' }, now: NOW },
      { uid: '7435186337', start: '2026-09-30', end: '2026-09-30' },
    );
  } finally {
    console.log = realLog;
  }
  assert.equal(res.mode, 'api', 'still the feed path');
  assert.equal(res.csv, [
    'link',
    'https://weibo.com/7435186337/RkvSCaGly',
    'https://weibo.com/7435186337/RkvMvj9eJ',
  ].join('\n'));
  assert.deepEqual(res.links, res.rows.map((r) => r.link));
  assert.equal(res.rows[0].is_repost, 'no', 'rows keep the full shape');
});

// ------------------------------------------------------------ field selection
// `fields: [...]` picks the columns, in the order given.

test('fields: an explicit selection decides which columns are emitted', () => {
  const { dom, env } = domEnv('weibo-profile.html', WEIBO_URL);
  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = S.run(env, { month: '2026-09', mode: 'dom', fields: ['posted_at_utc+08', 'link'] });
  } finally {
    console.log = realLog;
  }
  const lines = res.csv.split('\n');
  assert.equal(lines[0], 'posted_at_utc+08,link', 'header is exactly the selection, in order');
  assert.equal(lines.length, res.rows.length + 1, 'one line per row');
  assert.equal(lines[1], '2026-09-30 16:54:39,https://weibo.com/7435186337/RkvSCaGly');
  assert.deepEqual(res.fields, ['posted_at_utc+08', 'link']);
  // still only an output change
  assert.equal(res.rows[0].content.length > 0, true, 'rows keep every field');
  assert.equal(dom.window.__xwsCsv, res.csv);
});

test('fields: a comma-separated string works, duplicates collapse', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  const realLog = console.log;
  console.log = () => {};
  let res;
  try {
    res = S.run(env, { month: '2026-09', mode: 'dom', fields: 'content, link ,content' });
  } finally {
    console.log = realLog;
  }
  assert.equal(res.csv.split('\n')[0], 'content,link');
});

test('fields: the selection wins over moreInfo', () => {
  const { env } = domEnv('xhs-profile.html', XHS_URL);
  const realLog = console.log;
  console.log = () => {};
  let picked, full;
  try {
    picked = S.run(env, { month: '2026-09', fields: ['note_id', 'link'], moreInfo: true });
    full = S.run(env, { month: '2026-09', moreInfo: true });
  } finally {
    console.log = realLog;
  }
  assert.equal(picked.csv.split('\n')[0], 'note_id,link', 'fields wins');
  assert.ok(full.csv.startsWith('no,note_id,posted_at_utc+08'), 'moreInfo gives the table');
  assert.equal(picked.rows.length, full.rows.length);
});

test('fields: an unknown heading throws and lists every allowed heading', () => {
  const { env } = domEnv('weibo-profile.html', WEIBO_URL);
  assert.throws(
    () => S.run(env, { mode: 'dom', fields: ['link', 'posted_at'] }),
    (e) => {
      assert.match(e.message, /unknown heading\(s\): posted_at/);
      // the whole menu, so the next attempt is a copy-paste
      for (const col of ['no', 'link', 'content', 'posted_at_utc+08', 'posted_at_utc',
        'is_repost', 'original_posted_at', 'original_author', 'original_link',
        'original_content']) {
        assert.ok(e.message.includes(col), `message must list ${col}`);
      }
      return true;
    },
  );
  // the site's own headings, not the other site's
  assert.throws(() => S.run(env, { mode: 'dom', fields: ['note_id'] }), /Allowed headings on weibo/);
  assert.throws(() => S.run(env, { mode: 'dom', fields: [] }), /Allowed headings on weibo/);
});

test('fields: a bad heading fails before any request is made', () => {
  let calls = 0;
  const env = {
    window: { fetch: () => { calls++; return Promise.reject(new Error('nope')); }, navigator: {} },
    location: { pathname: '/u/7435186337' },
    now: NOW,
  };
  assert.throws(() => S.runWeiboApi(env, { uid: '7435186337', fields: ['nope'] }), /unknown heading/);
  assert.equal(calls, 0, 'the feed must not be touched');
});

