#!/usr/bin/env node
/*
 * Dev-only build: split scrape.js into one file per site.
 *
 *   node tools/build-split.js            # write scrape-weibo.generated.js, scrape-xhs.generated.js
 *   node tools/build-split.js --check    # verify the checked-in files are up to date
 *
 * Design, in one paragraph: scrape.js is the single source of truth. Its factory
 * body is a flat list of top-level declarations (two-space indent), each with its
 * own doc comment, so a site build is "the shared declarations + that site's
 * declarations", plus a small per-site template for the parts that genuinely
 * differ: the header, the UMD bootstrap, COLS, the SEL subset, run(), diagnose()
 * and the export map. Everything substantive — selectors, parsers, the Weibo API
 * paging, the XHS card resolution — is copied verbatim out of scrape.js, so the
 * split files cannot drift from it in logic. A handful of documented string edits
 * handle the few places where a shared block mentions the other site.
 *
 * This is NOT needed to use the scraper. It runs on the dev machine only; the
 * outputs are zero-dependency files you paste into a console.
 *
 * If scrape.js grows a new top-level declaration, this build FAILS with the name
 * it did not recognise. That is deliberate: assign the new block to both/weibo/
 * xhs in BLOCKS below, or the split files would silently miss it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'scrape.js');
const FACTORY_OPEN = "function () {\n  'use strict';\n";

// ---------------------------------------------------------------- site config
const SITES = {
  weibo: {
    tag: '[weibo-scraper]',
    out: 'scrape-weibo.generated.js',
    ns: 'weiboScraper',
    extraGlobals: ['weiboApiScrape'],
    csvPrefix: 'weibo-posts-',
    cols: String.raw`  var COLS = ['no', 'link', 'content', 'posted_at_utc+08', 'posted_at_utc', 'is_repost',
    'original_posted_at', 'original_author', 'original_link', 'original_content'];
  // The default output: one post URL per line (scrape({ moreInfo: true }) widens it).
  var LINKS_COLS = ['link'];`,
    sel: String.raw`  // ---------------------------------------------------------------- selectors
  // Layered fallbacks: weibo rewrites its class names every few years, so each
  // field is a preference-ordered list. ` + '`diagnose()`' + String.raw` reports which hit.
  var SEL = {
    // A top-level feed item container.
    weiboItem: [
      '[action-type="feed_list_item"]',
      '.WB_feed_type',
      'div[mid]',
      'article',
      '.card-wrap',
      '[class*="Feed_wrap"]',
    ],
    weiboText: [
      '.WB_text',
      '[node-type="feed_list_content"]',
      '.detail_wbtext_4CRf9',
      'p.woo',
    ],
    // The timestamp area.
    weiboFrom: ['.WB_from', '[class*="from_"]', '[class*="from"]'],
    // The nested "original post" box of a repost.
    weiboOrig: [
      '.WB_feed_expand',
      '.WB_expand',
      '[node-type="feed_list_forwardContent"]',
    ],
  };`,
    header: String.raw`/*!
 * scrape-weibo.generated.js — Weibo-only build of scrape.js.
 *
 * GENERATED FILE — do not edit. Run ` + '`npm run build`' + String.raw` to regenerate; edit
 * scrape.js (the single source of truth) or tools/build-split.js instead.
 *
 * ZERO dependencies. No Node, no npm, no extension, no userscript manager.
 * Copy this whole file, paste it into the browser DevTools Console while you are
 * sitting on a weibo.com/<uid> profile page, press Enter.
 *
 * WHAT IT DOES
 *   - Pages Weibo's own JSON feed (/ajax/statuses/mymblog) using the tab's own
 *     session: second-precision timestamps, untruncated long posts, reposts as
 *     a nested retweeted_status.
 *   - Falls back to reading the rendered page if the feed is unavailable
 *     (not logged in, endpoint changed) or returns nothing for the window.
 *   - Keeps only posts inside a date range. Default = the previous month (UTC+8).
 *   - Prints the CSV in the console and puts it on the clipboard.
 *   - It never logs in for you and never handles credentials.
 *
 * QUICK USE (in the console, on weibo.com/<uid>):
 *
 *   scrape()                                      // last month, post URLs only
 *   scrape({ month: '2026-07' })                  // one whole month
 *   scrape({ moreInfo: true })                    // the full table instead
 *   scrape({ start: '2026-07', end: '2026-07' })  // whole months (UTC+8 boundaries)
 *   scrape({ days: 7 })                           // rolling window instead
 *   scrape({ mode: 'dom' })                       // read the page, not the feed
 *   scrape({ feature: 1 })                        // 原创 only; 0 = everything (default)
 *   scrape({ uid: '7435186337' })                 // when the uid is not in the URL
 *   scrape({ maxPages: 200 })                     // if stats.stopReason = 'maxPages'
 *   diagnose()                                    // which DOM hooks actually matched
 *   copy(__xwsCsv) / saveCsv()
 *
 * Full flag reference: USAGE.md. Share of the source file: Weibo only.
 */`,
    wrapperGlobals: String.raw`    root.weiboScraper = api;
    root.scrape = function (opts) { return api.run(env(), opts); };
    root.diagnose = function () { return api.diagnose(env()); };
    root.saveCsv = function (csv, name) { return api.saveCsv(root.document, csv, name); };
    root.weiboApiScrape = function (opts) { return api.runWeiboApi(env(), opts); };`,
    run: String.raw`  function run(env, opts) {
    opts = opts || {};
    var host = (env.location && env.location.hostname) || '';
    if (host && !/(^|\.)weibo\.(com|cn)$/.test(host)) {
      console.warn(TAG + ' this is not a weibo.com page (' + host + '). The JSON feed is ' +
        'same-origin only — open the profile on weibo.com. Continuing anyway.');
    }

    var exec = function () {
      var res = scrapeWeibo(env, opts);
      res.site = 'weibo';
      return printResult(env, finish(env, res, 'weibo', opts), 'weibo');
    };

    // The JSON feed is the real source of truth: the rendered page carries
    // minute-precision times and truncates long posts, while the feed carries
    // seconds and the full text (see runWeiboApi).
    if (opts.mode !== 'dom') {
      return runWeiboApi(env, opts).then(function (res) {
        if (res && res.rows && res.rows.length) return res;
        if (res) {
          console.warn(TAG + ' the JSON feed returned no rows for this window — ' +
            'falling back to reading the rendered page. Use { mode: "dom" } to always ' +
            'read the page, or check the range.');
        }
        return exec();
      }, function (err) {
        console.warn(TAG + ' JSON feed failed (' + err.message +
          ') — falling back to reading the rendered page.');
        return exec();
      });
    }

    if (opts.autoLoad) {
      return autoLoad(env, opts).then(function (scrolled) {
        var res = exec();
        res.autoLoaded = scrolled;
        return res;
      });
    }
    return exec();
  }`,
    diagnose: String.raw`  // -------------------------------------------------------------- diagnose
  function diagnose(env) {
    var doc = env.document;
    var out = { site: 'weibo', href: env.location && env.location.href, selectors: {}, samples: {} };
    var report = function (name, sel) {
      try {
        out.selectors[name] = { selector: sel, count: doc.querySelectorAll(sel).length };
      } catch (e) {
        out.selectors[name] = { selector: sel, error: String(e) };
      }
    };
    var dump = function (name, el) {
      if (el) out.samples[name] = (el.outerHTML || '').slice(0, 2000);
    };
    report('weibo.anchors', WEIBO_ANCHOR_SEL);
    report('weibo.items', WEIBO_ITEM_SEL);
    report('weibo.text', WEIBO_TEXT_SEL);
    report('weibo.from', WEIBO_FROM_SEL);
    report('weibo.original', WEIBO_ORIG_SEL);
    report('weibo.a[date]', 'a[date]');
    dump('firstItem', doc.querySelector(WEIBO_ITEM_SEL));
    console.log(TAG + ' diagnose:', out);
    return out;
  }`,
    epilogue: String.raw`  return {
    CFG: CFG, COLS: COLS, SEL: SEL,
    run: run, scrapeWeibo: scrapeWeibo,
    runWeiboApi: runWeiboApi, autoLoad: autoLoad, saveCsv: saveCsv, diagnose: diagnose,
    // exported for tests
    normText: normText, textOf: textOf, csvCell: csvCell, toCsv: toCsv,
    fmtUtc8: fmtUtc8, fmtUtc: fmtUtc,
    parseRange: parseRange, parseBoundary: parseBoundary,
    parseAbsoluteDatetime: parseAbsoluteDatetime, parseWeiboCreatedAt: parseWeiboCreatedAt,
    parseWeiboTimeText: parseWeiboTimeText, msFromElement: msFromElement,
    weiboLinkInfo: weiboLinkInfo,
    _sel: {
      WEIBO_ANCHOR_SEL: WEIBO_ANCHOR_SEL, WEIBO_ITEM_SEL: WEIBO_ITEM_SEL,
      WEIBO_TEXT_SEL: WEIBO_TEXT_SEL, WEIBO_FROM_SEL: WEIBO_FROM_SEL,
    },
  };`,
  },
  xhs: {
    tag: '[xhs-scraper]',
    out: 'scrape-xhs.generated.js',
    ns: 'xhsScraper',
    extraGlobals: [],
    csvPrefix: 'xhs-posts-',
    cols: String.raw`  var COLS = ['no', 'note_id', 'posted_at_utc+08', 'posted_at_utc', 'caption', 'link',
    'link_alt', 'link_as_scraped'];
  // The default output: one post URL per line (scrape({ moreInfo: true }) widens it).
  var LINKS_COLS = ['link'];`,
    sel: String.raw`  // ---------------------------------------------------------------- selectors
  // Layered fallbacks: XHS rewrites its class names every few years, so each
  // field is a preference-ordered list. ` + '`diagnose()`' + String.raw` reports which hit.
  var SEL = {
    // An anchor that points at a note.
    xhsAnchor: [
      'a[href*="/explore/"]',
      'a[href*="/discovery/item/"]',
      'a[href*="/user/profile/"][href*="xsec_token"]',
    ],
    // The note card.
    xhsItem: ['section.note-item', 'section', '.note-item', '[class*="noteItem"]', 'li'],
    // A note card specifically (no generic <section>/<li> fallbacks), used to
    // count cards when deciding whether an empty result is a warning.
    xhsCard: ['section.note-item', '.note-item', '[class*="noteItem"]'],
    // The caption / title.
    xhsTitle: ['a.title', '.title', '[class*="title"]'],
  };`,
    header: String.raw`/*!
 * scrape-xhs.generated.js — Xiaohongshu / RedNote-only build of scrape.js.
 *
 * GENERATED FILE — do not edit. Run ` + '`npm run build`' + String.raw` to regenerate; edit
 * scrape.js (the single source of truth) or tools/build-split.js instead.
 *
 * ZERO dependencies. No Node, no npm, no extension, no userscript manager.
 * Copy this whole file, paste it into the browser DevTools Console while you are
 * sitting on a xiaohongshu.com/user/profile/<uid> (or rednote.com) page, press
 * Enter.
 *
 * WHAT IT DOES
 *   - Reads the note cards already rendered on the profile page. No extra
 *     requests: it never touches an API endpoint.
 *   - Post dates come from the note id, because XHS renders no dates in the DOM
 *     at all: note ids are MongoDB ObjectIds whose first 4 bytes are the
 *     creation timestamp. Falls back to the embedded page state, then the DOM.
 *   - Keeps only notes inside a date range. Default = the previous month (UTC+8).
 *   - Prints the CSV in the console and puts it on the clipboard.
 *
 * QUICK USE (in the console, on the profile page, AFTER it has finished loading):
 *
 *   scrape()                                      // last month, post URLs only
 *   scrape({ month: '2026-07' })                  // one whole month
 *   scrape({ moreInfo: true })                    // the full table instead
 *   scrape({ start: '2026-07', end: '2026-07' })  // whole months (UTC+8 boundaries)
 *   scrape({ days: 7 })                           // rolling window instead
 *   scrape({ autoLoad: true })                    // scroll to load more cards first
 *   scrape({ preferStateTitle: true })            // full title from page state
 *   diagnose()                                    // cards in DOM vs ids populated
 *   copy(__xwsCsv) / saveCsv()
 *
 * THE FAILURE MODE TO KNOW ABOUT
 *   XHS ships the card list in server-rendered HTML with every note id set to
 *   "" and only fills them in after hydration, so scraping too early looks
 *   complete (real covers, real titles) but yields nothing. That case warns
 *   loudly instead of returning a silent empty CSV. Waiting a moment and
 *   re-running fixes it.
 *
 * Full flag reference: USAGE.md. Share of the source file: XHS only.
 */`,
    wrapperGlobals: String.raw`    root.xhsScraper = api;
    root.scrape = function (opts) { return api.run(env(), opts); };
    root.diagnose = function () { return api.diagnose(env()); };
    root.saveCsv = function (csv, name) { return api.saveCsv(root.document, csv, name); };`,
    run: String.raw`  function run(env, opts) {
    opts = opts || {};
    var host = (env.location && env.location.hostname) || '';
    if (host && !/(^|\.)(xiaohongshu|rednote)\.com$/.test(host)) {
      console.warn(TAG + ' this is not a xiaohongshu.com / rednote.com page (' + host +
        '). Open the profile page first. Continuing anyway.');
    }

    var exec = function () {
      var res = scrapeXhs(env, opts);
      res.site = 'xhs';
      return printResult(env, finish(env, res, 'xhs', opts), 'xhs');
    };

    if (opts.autoLoad) {
      return autoLoad(env, opts).then(function (scrolled) {
        var res = exec();
        res.autoLoaded = scrolled;
        return res;
      });
    }
    return exec();
  }`,
    diagnose: String.raw`  // -------------------------------------------------------------- diagnose
  function diagnose(env) {
    var doc = env.document;
    var out = { site: 'xhs', href: env.location && env.location.href, selectors: {}, samples: {} };
    var report = function (name, sel) {
      try {
        out.selectors[name] = { selector: sel, count: doc.querySelectorAll(sel).length };
      } catch (e) {
        out.selectors[name] = { selector: sel, error: String(e) };
      }
    };
    var dump = function (name, el) {
      if (el) out.samples[name] = (el.outerHTML || '').slice(0, 2000);
    };
    report('xhs.anchors', XHS_ANCHOR_SEL);
    report('xhs.items', XHS_ITEM_SEL);
    report('xhs.cards', XHS_CARD_SEL);
    report('xhs.titles', XHS_TITLE_SEL);
    dump('firstItem', doc.querySelector(XHS_CARD_SEL));

    var st = pageState(env);
    out.hasInitialState = !!st;
    out.noteCardsInDom = doc.querySelectorAll(XHS_CARD_SEL).length;
    // Cards in the DOM with blank ids => not hydrated yet; no cards and no state
    // => the markup moved. This is the whole point of the diagnosis.
    if (st) {
      out.noteCardsInState = Object.keys(collectNoteCards(st)).length;
      out.stateNotes = inspectStateNotes(st);
    }

    console.log(TAG + ' diagnose:', out);
    return out;
  }`,
    epilogue: String.raw`  return {
    CFG: CFG, COLS: COLS, SEL: SEL,
    run: run, scrapeXhs: scrapeXhs, autoLoad: autoLoad,
    saveCsv: saveCsv, diagnose: diagnose,
    // exported for tests
    normText: normText, textOf: textOf, csvCell: csvCell, toCsv: toCsv,
    fmtUtc8: fmtUtc8, fmtUtc: fmtUtc,
    objectIdToMs: objectIdToMs, parseRange: parseRange, parseBoundary: parseBoundary,
    parseAbsoluteDatetime: parseAbsoluteDatetime, parseRelativeTimeText: parseRelativeTimeText,
    msFromElement: msFromElement, xhsLinkInfo: xhsLinkInfo,
    xhsCanonicalLink: xhsCanonicalLink, xhsAltLink: xhsAltLink,
    collectNoteCards: collectNoteCards, inspectStateNotes: inspectStateNotes,
    cardNoteId: cardNoteId, xhsTokenFromHref: xhsTokenFromHref,
    _sel: {
      XHS_ANCHOR_SEL: XHS_ANCHOR_SEL, XHS_ITEM_SEL: XHS_ITEM_SEL,
      XHS_CARD_SEL: XHS_CARD_SEL, XHS_TITLE_SEL: XHS_TITLE_SEL,
    },
  };`,
  },
};

// -------------------------------------------------------------- block manifest
// Every top-level declaration in scrape.js must appear here. `template` means the
// build supplies a per-site version instead of copying the block; `drop` means
// the block is dead code in the combined file and no build needs it.
const BLOCKS = {
  CFG: 'both',
  MINUTE: 'both',
  HOUR: 'both',
  DAY: 'both',
  COLS: 'template',
  SEL: 'template',
  WEIBO_ANCHOR_RE: 'weibo',
  WEIBO_PATH_WORDS: 'weibo',
  XHS_NOTE_ID_RE: 'drop', // declared but never used in scrape.js
  OBJID_RE: 'xhs',
  JUNK_TEXTS: 'both',
  SHORTLINK_TEXT_RE: 'both',
  MONTHS: 'weibo',
  union: 'both',
  WEIBO_ANCHOR_SEL: 'weibo',
  WEIBO_ITEM_SEL: 'weibo',
  WEIBO_TEXT_SEL: 'weibo',
  WEIBO_FROM_SEL: 'weibo',
  WEIBO_ORIG_SEL: 'weibo',
  XHS_ANCHOR_SEL: 'xhs',
  XHS_ITEM_SEL: 'xhs',
  XHS_CARD_SEL: 'xhs',
  XHS_TITLE_SEL: 'xhs',
  firstOf: 'both',
  firstOutside: 'weibo',
  absUrl: 'both',
  normText: 'both',
  textOf: 'both',
  utcNaive: 'both',
  startOfDay: 'both',
  pad: 'both',
  fmt: 'both',
  fmtUtc8: 'both',
  fmtUtc: 'both',
  parseAbsoluteDatetime: 'both',
  parseWeiboCreatedAt: 'weibo',
  parseWeiboTimeText: 'both', // renamed in the xhs build, see EDITS
  msFromElement: 'both',
  extractMs: 'both', // xhs build drops the Weibo timestamp selector, see EDITS
  parseBoundary: 'both',
  monthOf: 'both',
  prevMonth: 'both',
  parseMonth: 'both',
  parseRange: 'both',
  objectIdToMs: 'xhs',
  weiboLinkInfo: 'weibo',
  xhsLinkInfo: 'xhs',
  querySuffix: 'xhs',
  xhsCanonicalLink: 'xhs',
  xhsAltLink: 'xhs',
  csvCell: 'both',
  toCsv: 'both',
  fieldNames: 'both', // returns the per-site full table; the split builds have one array
  resolveFields: 'both',
  columnsFor: 'both', // same: COLS[site] in the combined file, COLS when split
  linkList: 'both',
  finish: 'both',
  inspectStateNotes: 'xhs',
  collectNoteCards: 'xhs',
  pageState: 'xhs',
  findWeiboOriginal: 'weibo',
  weiboAuthor: 'weibo',
  extractWeiboRow: 'weibo',
  scrapeWeibo: 'weibo',
  cardNoteId: 'xhs',
  xhsTokenFromHref: 'xhs',
  scrapeXhs: 'xhs',
  detectSite: 'template', // run() knows its site, so detection is not needed
  printResult: 'both',
  run: 'template',
  autoLoad: 'both', // one line edited per site, see EDITS
  htmlToText: 'weibo',
  jsonFetch: 'weibo',
  weiboUidFrom: 'weibo',
  mblogLongText: 'weibo',
  apiRow: 'weibo',
  resolveLongTexts: 'weibo',
  runWeiboApi: 'weibo',
  saveCsv: 'both', // filename prefix edited per site, see EDITS
  diagnose: 'template',
};

// String edits applied to extracted blocks. Each one exists because a shared
// block mentions the other site; they are asserted, so a scrape.js rewrite that
// invalidates one fails the build instead of silently producing wrong output.
const EDITS = {
  both: [
    // The console tag lives inside longer strings too ("[xhs-weibo-scraper] saved …",
    // "xhs-weibo-scraper: cannot parse date …"), so this is a text splice to a
    // variable, then two tidy-ups for the degenerate cases it produces. Order
    // matters: the two literal shapes first, then the tidy-ups.
    { replaceAll: { from: '[xhs-weibo-scraper]', to: "' + TAG + '" } },
    { replaceAll: { from: 'xhs-weibo-scraper:', to: "' + TAG + ':" } },
    { replaceAll: { from: "'' + TAG + ''", to: 'TAG' } },
    { replaceAll: { from: "'' + TAG + ", to: 'TAG + ' } },
  ],
  weibo: [
    // COLS is a per-site array in this build, not the {weibo, xhs, links} map,
    // so the site lookups in fieldNames()/columnsFor() cannot survive verbatim.
    {
      block: 'fieldNames',
      from: '    return COLS[site] || [];',
      to: '    return COLS;',
    },
    {
      block: 'columnsFor',
      from: '    return opts && opts.moreInfo ? COLS[site] : COLS.links;',
      to: '    return opts && opts.moreInfo ? COLS : LINKS_COLS;',
    },
    {
      block: 'autoLoad',
      from: [
        '    var site = opts.site || detectSite(env.location);',
        '    var sel = site === \'xhs\' ? XHS_ANCHOR_SEL : WEIBO_ANCHOR_SEL;',
      ].join('\n'),
      to: '    var sel = WEIBO_ANCHOR_SEL;',
    },
    {
      block: 'saveCsv',
      from: "var filename = name || ('posts-' + stamp + '.csv');",
      to: "var filename = name || ('weibo-posts-' + stamp + '.csv');",
    },
  ],
  xhs: [
    // Same COLS reshape as the Weibo build: one array, plus LINKS_COLS.
    {
      block: 'fieldNames',
      from: '    return COLS[site] || [];',
      to: '    return COLS;',
    },
    {
      block: 'columnsFor',
      from: '    return opts && opts.moreInfo ? COLS[site] : COLS.links;',
      to: '    return opts && opts.moreInfo ? COLS : LINKS_COLS;',
    },
    // The XHS build has no Weibo in it, so no Weibo-shaped names either.
    { rename: { parseWeiboTimeText: 'parseRelativeTimeText' } },
    {
      block: 'extractMs',
      from: [
        "    var sels = ['a[date]', '[date]', 'time[datetime]', '[datetime]',",
        "      WEIBO_FROM_SEL + ' a[title]', 'a[title]', WEIBO_FROM_SEL];",
      ].join('\n'),
      to: "    var sels = ['a[date]', '[date]', 'time[datetime]', '[datetime]', 'a[title]'];",
    },
    {
      block: 'autoLoad',
      from: [
        '    var site = opts.site || detectSite(env.location);',
        '    var sel = site === \'xhs\' ? XHS_ANCHOR_SEL : WEIBO_ANCHOR_SEL;',
      ].join('\n'),
      to: '    var sel = XHS_ANCHOR_SEL;',
    },
    {
      block: 'saveCsv',
      from: "var filename = name || ('posts-' + stamp + '.csv');",
      to: "var filename = name || ('xhs-posts-' + stamp + '.csv');",
    },
    // absUrl()/textOf() default to a weibo.com base for relative hrefs. On XHS
    // every call site passes an explicit base, but leaving weibo.com in an
    // XHS-only file is just confusing.
    { block: ['absUrl', 'textOf'], replaceAll: { from: 'https://weibo.com/', to: 'https://www.xiaohongshu.com/' } },
    // Comment-only cleanups, so the file does not read like a Weibo scraper.
    { block: 'JUNK_TEXTS', from: '// Strings weibo injects', to: '// Strings the site injects' },
    { block: 'textOf', replaceAll: { from: '(weibo separates paragraphs with', to: '(the site separates paragraphs with' } },
    { block: 'parseWeiboTimeText', from: "/** Weibo's relative/abbreviated display strings:", to: '/** Relative/abbreviated display strings:' },
  ],
};

// ------------------------------------------------------------------- extraction
function parseSource(src) {
  const bodyStart = src.indexOf(FACTORY_OPEN);
  if (bodyStart === -1) throw new Error('cannot find the factory body in scrape.js');
  const bodyFrom = bodyStart + FACTORY_OPEN.length;
  const epilogueAt = src.indexOf('\n  return {', bodyFrom);
  if (epilogueAt === -1) throw new Error('cannot find the factory return object in scrape.js');
  const decls = src.slice(bodyFrom, epilogueAt);

  const lines = decls.split('\n');
  const declRe = /^ {2}(?:function\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*))\s*[=(]/;
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = declRe.exec(lines[i]);
    if (!m) continue;
    let s = i;
    while (s > 0 && /^ {2,}(?:\/\/|\/\*|\*)/.test(lines[s - 1])) s--; // take the doc comment
    starts.push({ name: m[1] || m[2], start: s });
  }

  const blocks = new Map();
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1].start : lines.length;
    const text = lines.slice(starts[k].start, end).join('\n').replace(/\s+$/, '');
    if (blocks.has(starts[k].name)) throw new Error('duplicate top-level declaration: ' + starts[k].name);
    blocks.set(starts[k].name, text);
  }
  return { blocks, order: starts.map((s) => s.name) };
}

/**
 * Apply one edit to one block. Edits scoped to a block must match — a scrape.js
 * rewrite that invalidates one has to fail the build, not silently emit the
 * other site's code. Global edits (no `block`) apply wherever they match; that
 * residual is asserted on the assembled output instead (see buildSite).
 */
function applyEdit(text, e, where) {
  if (e.rename) {
    for (const [from, to] of Object.entries(e.rename)) {
      text = text.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
    }
  }
  const pairs = [];
  if (e.replaceAll) pairs.push(e.replaceAll);
  if (e.from != null) pairs.push({ from: e.from, to: e.to });
  for (const p of pairs) {
    const had = text.includes(p.from);
    if (!had && e.block != null) throw new Error(`edit for ${where} did not match:\n${p.from}`);
    if (had) text = text.split(p.from).join(p.to);
  }
  return text;
}

function applyEdits(name, text, edits, site) {
  let out = text;
  for (const e of edits) {
    if (e.block != null && ![].concat(e.block).includes(name)) continue;
    out = applyEdit(out, e, site + '/' + name);
  }
  return out;
}

function buildSite(site, parsed) {
  const cfg = SITES[site];
  const parts = [];
  parts.push(cfg.header);
  parts.push('');
  parts.push('(function (root, factory) {');
  parts.push("  'use strict';");
  parts.push('  var api = factory();');
  parts.push('');
  parts.push('  function env() {');
  parts.push('    return {');
  parts.push('      window: root,');
  parts.push('      document: root.document,');
  parts.push('      location: root.location,');
  parts.push('      now: Date.now(),');
  parts.push('    };');
  parts.push('  }');
  parts.push('');
  parts.push('  // Browser / DevTools-console first. `module` is checked second on purpose:');
  parts.push('  // some pages define a global `module`, and we must still bootstrap there.');
  parts.push("  if (root && typeof root.document !== 'undefined' && typeof root.window !== 'undefined') {");
  parts.push(cfg.wrapperGlobals);
  parts.push('');
  parts.push('    // Pasting only defines the API — nothing is scraped until you call scrape().');
  parts.push("    console.log('" + cfg.tag + " ready. scrape() = post URLs for last month; ' +");
  parts.push("      'scrape({ moreInfo: true }) = the full table; ' +");
  parts.push("      'scrape({ fields: [...] }) = pick columns.');");
  parts.push('    return null; // nothing scraped yet');
  parts.push('  }');
  parts.push('');
  parts.push("  if (typeof module === 'object' && module && module.exports) {");
  parts.push('    module.exports = api; // Node: for the dev-machine test suite only');
  parts.push('  }');
  parts.push("})(typeof globalThis !== 'undefined' ? globalThis : this, function () {");
  parts.push("  'use strict';");
  parts.push('');
  parts.push("  var TAG = '" + cfg.tag + "';");
  parts.push('');

  // Templates standing in for a scrape.js block.
  const blockTemplates = { COLS: cfg.cols, SEL: cfg.sel };

  for (const name of parsed.order) {
    const where = BLOCKS[name];
    if (where === 'drop') continue;
    if (where === 'template') {
      // Emitted in source order (COLS, SEL); the rest live at the end (run, diagnose).
      const body = blockTemplates[name];
      if (body) { parts.push(body); parts.push(''); }
      continue;
    }
    if (where !== 'both' && where !== site) continue;
    parts.push(applyEdits(name, parsed.blocks.get(name), EDITS.both.concat(EDITS[site]), site));
    parts.push('');
  }

  parts.push(cfg.run);
  parts.push('');
  parts.push(cfg.diagnose);
  parts.push('');
  parts.push(cfg.epilogue);
  parts.push('});');
  parts.push('');
  const assembled = parts.join('\n');
  // Belt and braces: the global tag edits are opportunistic, so assert the
  // residual rather than trusting them.
  if (assembled.includes('xhs-weibo-scraper')) {
    throw new Error(site + ': build still contains the combined-file console tag');
  }
  return assembled;
}

// ----------------------------------------------------------------------- main
function main() {
  const check = process.argv.includes('--check');
  const parsed = parseSource(fs.readFileSync(SOURCE, 'utf8'));

  const unknown = parsed.order.filter((n) => !Object.prototype.hasOwnProperty.call(BLOCKS, n));
  if (unknown.length) {
    throw new Error(
      'scrape.js has top-level declaration(s) this build does not know about:\n  ' + unknown.join('\n  ') +
      '\nAdd them to BLOCKS in tools/build-split.js (both / weibo / xhs / template / drop).',
    );
  }
  const stale = Object.keys(BLOCKS).filter((n) => !parsed.order.includes(n));
  if (stale.length) {
    throw new Error(
      'tools/build-split.js lists block(s) that no longer exist in scrape.js:\n  ' + stale.join('\n  '),
    );
  }

  let bad = 0;
  for (const site of Object.keys(SITES)) {
    const cfg = SITES[site];
    const out = buildSite(site, parsed);
    const target = path.join(ROOT, cfg.out);

    // Cheap syntax gate: a broken build must never land on disk.
    const tmp = path.join(require('os').tmpdir(), 'split-build-' + process.pid + '-' + site + '.js');
    fs.writeFileSync(tmp, out);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } finally {
      fs.unlinkSync(tmp);
    }

    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      if (current !== out) {
        console.error(`STALE  ${cfg.out} — run: npm run build`);
        bad++;
      } else {
        console.log(`ok     ${cfg.out} (${out.split('\n').length} lines)`);
      }
      continue;
    }

    fs.writeFileSync(target, out);
    console.log(`wrote  ${cfg.out} (${out.split('\n').length} lines, ${Buffer.byteLength(out)} bytes)`);
  }

  if (check && bad) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('build-split: ' + e.message);
    process.exit(1);
  }
}

module.exports = { parseSource, buildSite, BLOCKS, SITES };
