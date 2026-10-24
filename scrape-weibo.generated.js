/*!
 * scrape-weibo.generated.js — Weibo-only build of scrape.js.
 *
 * GENERATED FILE — do not edit. Run `npm run build` to regenerate; edit
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
 *   - Keeps only posts inside a date range. Default = the current month (UTC+8).
 *   - Prints the CSV in the console and puts it on the clipboard.
 *   - It never logs in for you and never handles credentials.
 *
 * QUICK USE (in the console, on weibo.com/<uid>):
 *
 *   scrape()                                      // this month, post URLs only
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
 */

(function (root, factory) {
  'use strict';
  var api = factory();

  function env() {
    return {
      window: root,
      document: root.document,
      location: root.location,
      now: Date.now(),
    };
  }

  // Browser / DevTools-console first. `module` is checked second on purpose:
  // some pages define a global `module`, and we must still bootstrap there.
  if (root && typeof root.document !== 'undefined' && typeof root.window !== 'undefined') {
    root.weiboScraper = api;
    root.scrape = function (opts) { return api.run(env(), opts); };
    root.diagnose = function () { return api.diagnose(env()); };
    root.saveCsv = function (csv, name) { return api.saveCsv(root.document, csv, name); };
    root.weiboApiScrape = function (opts) { return api.runWeiboApi(env(), opts); };

    // Pasting only defines the API — nothing is scraped until you call scrape().
    console.log('[weibo-scraper] ready. scrape() = post URLs for this month; ' +
      'scrape({ moreInfo: true }) = the full table; ' +
      'scrape({ fields: [...] }) = pick columns.');
    return null; // nothing scraped yet
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api; // Node: for the dev-machine test suite only
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAG = '[weibo-scraper]';

  var CFG = {
    tzHours: 8, // Asia/Shanghai and Asia/Singapore are both UTC+8
  };

  var MINUTE = 60000;

  var HOUR = 3600000;

  var DAY = 86400000;

  var COLS = ['no', 'link', 'content', 'posted_at_utc+08', 'posted_at_utc', 'is_repost',
    'original_posted_at', 'original_author', 'original_link', 'original_content'];
  // The default output: one post URL per line (scrape({ moreInfo: true }) widens it).
  var LINKS_COLS = ['link'];

  // ---------------------------------------------------------------- selectors
  // Layered fallbacks: weibo rewrites its class names every few years, so each
  // field is a preference-ordered list. `diagnose()` reports which hit.
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
  };

  var WEIBO_ANCHOR_RE = /^https?:\/\/(?:www\.|m\.)?weibo\.(?:com|cn)\/(?:u\/)?(\d{5,})\/([0-9A-Za-z]{6,24})(?:[/?#]|$)/;

  // Path words that look like an id but are not one.
  var WEIBO_PATH_WORDS = new Set(['profile', 'follow', 'fans', 'info', 'album', 'photo',
    'video', 'tv', 'set', 'at', 'groups', 'like', 'mylike', 'comment', 'repost', 'tag',
    'search', 'hot', 'weibo', 'status', 'statuses', 'ttarticle', 'media', 'detail', 'home']);

  // Strings weibo injects into the text node that are UI, not content.
  var JUNK_TEXTS = ['展开全文', '收起全文', '展开', '收起', '全文'];

  var SHORTLINK_TEXT_RE = /^(网页链接|Web link|链接)$/;

  var MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  function union(list) { return list.join(', '); }

  // The trailing 'a[href]' is the catch-all that actually does the work: PLAN.md
  // asks for "all the links on the current webpage", so we scan every anchor and
  // filter by URL shape. The prefixed entries are kept so the scan still works if
  // the catch-all is ever narrowed.
  var WEIBO_ANCHOR_SEL = union(SEL.weiboItem.map(function (s) { return s + ' a[href]'; }).concat(['a[href]']));

  var WEIBO_ITEM_SEL = union(SEL.weiboItem);

  var WEIBO_TEXT_SEL = union(SEL.weiboText);

  var WEIBO_FROM_SEL = union(SEL.weiboFrom);

  var WEIBO_ORIG_SEL = union(SEL.weiboOrig);

  // -------------------------------------------------------------- small utils
  function firstOf(scope, sels) {
    if (!scope) return null;
    for (var i = 0; i < sels.length; i++) {
      var el = scope.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  /** First element matching `sel` inside `scope` that is not inside `exclude`. */
  function firstOutside(scope, sel, exclude) {
    if (!scope) return null;
    var els = scope.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      if (!exclude || !exclude.contains(els[i])) return els[i];
    }
    return null;
  }

  function absUrl(href, base) {
    if (!href) return null;
    try { return new URL(href, base || 'https://weibo.com/').href; } catch (e) { return null; }
  }

  function normText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) { return line.replace(/[ \t]+/g, ' ').trim(); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * textContent, but faithful to how the post reads:
   *  - <br> becomes a newline (weibo separates paragraphs with <br>)
   *  - <img alt="[微笑]"> becomes its alt text
   *  - <a>网页链接</a> pointing at a t.cn shortlink becomes the shortlink URL
   *  - UI-only anchors ("展开全文", "收起") are dropped
   */
  function textOf(el, opts) {
    if (!el) return '';
    opts = opts || {};
    var doc = el.ownerDocument;
    var clone = el.cloneNode(true);
    var i, nodes;

    if (opts.stripUi !== false) {
      nodes = clone.querySelectorAll('a, span, em, i');
      for (i = 0; i < nodes.length; i++) {
        if (JUNK_TEXTS.indexOf(normText(nodes[i].textContent)) !== -1) {
          nodes[i].parentNode.removeChild(nodes[i]);
        }
      }
    }
    if (opts.shortLinks !== false) {
      nodes = clone.querySelectorAll('a[href]');
      for (i = 0; i < nodes.length; i++) {
        var href = nodes[i].getAttribute('href') || '';
        if (SHORTLINK_TEXT_RE.test(normText(nodes[i].textContent)) && /^https?:\/\/t\.cn\//.test(absUrl(href, 'https://weibo.com/') || href)) {
          nodes[i].textContent = absUrl(href, 'https://weibo.com/') || href;
        }
      }
    }
    if (opts.imgAlt !== false) {
      nodes = clone.querySelectorAll('img[alt]');
      for (i = 0; i < nodes.length; i++) {
        var alt = nodes[i].getAttribute('alt') || '';
        nodes[i].parentNode.replaceChild(doc.createTextNode(alt), nodes[i]);
      }
    }
    nodes = clone.querySelectorAll('br');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].parentNode.replaceChild(doc.createTextNode('\n'), nodes[i]);
    }
    return normText(clone.textContent);
  }

  // ------------------------------------------------------------------- time
  function utcNaive(y, mo, d, h, mi, s, ms, tz) {
    return Date.UTC(y, mo - 1, d, h, mi, s, ms || 0) - tz * HOUR;
  }

  function startOfDay(ms, tz) {
    var shifted = new Date(ms + tz * HOUR);
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - tz * HOUR;
  }

  function pad(n, w) {
    n = String(n);
    while (n.length < (w || 2)) n = '0' + n;
    return n;
  }

  function fmt(ms, tz) {
    if (ms == null || !isFinite(ms)) return '';
    var d = new Date(ms + tz * HOUR);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }

  function fmtUtc8(ms) { return fmt(ms, CFG.tzHours); }

  function fmtUtc(ms) { return fmt(ms, 0); }

  /** "2026-09-30 16:54:39" | "2026-09-30 16:54" | "2026-09-30T16:54:39+08:00" */
  function parseAbsoluteDatetime(s, tz) {
    var m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(normText(s));
    if (!m) return null;
    var off = m[8];
    if (off) {
      var sign = off.charAt(0) === '-' ? -1 : 1;
      var oh = off === 'Z' ? 0 : parseInt(off.slice(1, 3), 10);
      var om = off === 'Z' ? 0 : parseInt(off.slice(-2), 10);
      var shifted = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0, +(m[7] || 0));
      return shifted - sign * (oh * 60 + om) * MINUTE;
    }
    return utcNaive(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +(m[7] || 0), tz);
  }

  /** Weibo's own JSON format: "Wed Sep 30 16:54:39 +0800 2026" */
  function parseWeiboCreatedAt(s, tz) {
    var m = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})\s+(\d{4})$/.exec(normText(s));
    if (!m) return null;
    var sign = m[6] === '-' ? -1 : 1;
    var offMin = sign * (+m[7] * 60 + +m[8]);
    return Date.UTC(+m[9], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5]) - offMin * MINUTE;
  }

  /** Weibo's relative/abbreviated display strings: "20分钟前", "昨天 10:30", "09-30". */
  function parseWeiboTimeText(s, nowMs, tz) {
    var t = normText(s);
    if (!t) return null;
    if (/^刚刚/.test(t)) return nowMs;
    var m;
    if ((m = /^(\d+)\s*秒前/.exec(t))) return nowMs - (+m[1]) * 1000;
    if ((m = /^(\d+)\s*分钟前/.exec(t))) return nowMs - (+m[1]) * MINUTE;
    if ((m = /^(\d+)\s*小时前/.exec(t))) return nowMs - (+m[1]) * HOUR;
    if ((m = /^(\d+)\s*天前/.exec(t))) return nowMs - (+m[1]) * DAY;
    var today = startOfDay(nowMs, tz);
    var year = new Date(today).getUTCFullYear();
    if ((m = /^今天\s*(\d{1,2}):(\d{2})/.exec(t))) return today + (+m[1]) * HOUR + (+m[2]) * MINUTE;
    if ((m = /^昨天\s*(\d{1,2}):(\d{2})/.exec(t))) return today + (+m[1]) * HOUR + (+m[2]) * MINUTE - DAY;
    if ((m = /^前天\s*(\d{1,2}):(\d{2})/.exec(t))) return today + (+m[1]) * HOUR + (+m[2]) * MINUTE - 2 * DAY;
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(t))) return today + (+m[1]) * HOUR + (+m[2]) * MINUTE;
    if (/^今天/.test(t)) return today;
    if (/^昨天/.test(t)) return today - DAY;
    if ((m = /^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t))) {
      var v = utcNaive(year, +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), 0, 0, tz);
      return v > nowMs + DAY ? utcNaive(year - 1, +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), 0, 0, tz) : v;
    }
    if ((m = /^(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?/.exec(t))) {
      var w = utcNaive(year, +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), 0, 0, tz);
      return w > nowMs + DAY ? utcNaive(year - 1, +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), 0, 0, tz) : w;
    }
    return parseAbsoluteDatetime(t, tz);
  }

  function msFromElement(el, nowMs, tz) {
    var raw = el.getAttribute('date') || el.getAttribute('data-date') || el.getAttribute('data-time');
    if (raw && /^\d{9,13}$/.test(normText(raw))) {
      var n = +normText(raw);
      return n < 1e12 ? n * 1000 : n; // seconds vs milliseconds
    }
    var dt = el.getAttribute('datetime');
    if (dt) { var a = parseAbsoluteDatetime(dt, tz); if (a != null) return a; }
    var title = el.getAttribute('title');
    if (title) { var b = parseAbsoluteDatetime(title, tz) || parseWeiboTimeText(title, nowMs, tz); if (b != null) return b; }
    var txt = normText(el.textContent).replace(/来自.*$/s, '').trim();
    if (txt && txt.length <= 24) {
      var c = parseWeiboTimeText(txt, nowMs, tz);
      if (c != null) return c;
    }
    return null;
  }

  function extractMs(scope, excludeBox, nowMs, tz) {
    if (!scope) return null;
    var sels = ['a[date]', '[date]', 'time[datetime]', '[datetime]',
      WEIBO_FROM_SEL + ' a[title]', 'a[title]', WEIBO_FROM_SEL];
    for (var s = 0; s < sels.length; s++) {
      var els = scope.querySelectorAll(sels[s]);
      for (var i = 0; i < els.length; i++) {
        if (excludeBox && excludeBox.contains(els[i])) continue;
        var ms = msFromElement(els[i], nowMs, tz);
        if (ms != null) return ms;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ date range
  function parseBoundary(v, edge, tz) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    var s = normText(v);
    var m;
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) {
      var y = +m[1], mo = +m[2];
      if (edge === 'start') return utcNaive(y, mo, 1, 0, 0, 0, 0, tz);
      var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      return utcNaive(y, mo, last, 23, 59, 59, 999, tz);
    }
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
      return edge === 'start'
        ? utcNaive(+m[1], +m[2], +m[3], 0, 0, 0, 0, tz)
        : utcNaive(+m[1], +m[2], +m[3], 23, 59, 59, 999, tz);
    }
    var exact = parseAbsoluteDatetime(s, tz);
    if (exact != null) return exact;
    throw new Error(TAG + ': cannot parse date "' + v + '" (use 2026-09, 2026-09-30 or 2026-09-30 16:00)');
  }

  /** The 'YYYY-MM' that an instant falls in, in the site's timezone. */
  function monthOf(ms, tz) {
    var d = new Date(ms + tz * HOUR);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }

  /** Validate `{ month: '2026-07' }` and normalise it to 'YYYY-MM'. */
  function parseMonth(v) {
    var m = /^(\d{4})-(\d{1,2})$/.exec(normText(v));
    if (!m || +m[2] < 1 || +m[2] > 12) {
      throw new Error(TAG + ': cannot parse month "' + v + '" (use 2026-07)');
    }
    return m[1] + '-' + pad(+m[2]);
  }

  function parseRange(opts, nowMs) {
    opts = opts || {};
    var tz = CFG.tzHours;
    // `month` is the whole-month shorthand — it sets both boundaries, so asking
    // for a month *and* a start/end/days is a contradiction, not a preference.
    if (opts.month != null) {
      if (opts.start != null || opts.end != null || opts.days != null) {
        throw new Error(TAG + ': month "' + opts.month
          + '" already sets start and end — drop start/end/days');
      }
      var mon = parseMonth(opts.month);
      return {
        startMs: parseBoundary(mon, 'start', tz),
        endMs: parseBoundary(mon, 'end', tz),
        tz: tz, explicit: true, month: mon,
      };
    }
    var explicit = opts.start != null || opts.end != null;
    var startMs, endMs;
    if (!explicit && opts.days == null) {
      // Default window: the current month in UTC+8 — exactly { month: <now> }.
      var cur = monthOf(nowMs, tz);
      return {
        startMs: parseBoundary(cur, 'start', tz),
        endMs: parseBoundary(cur, 'end', tz),
        tz: tz, explicit: false, month: cur,
      };
    }
    if (!explicit) {
      endMs = nowMs;
      startMs = nowMs - +opts.days * DAY;
    } else {
      startMs = parseBoundary(opts.start, 'start', tz);
      endMs = parseBoundary(opts.end, 'end', tz);
      if (startMs == null) startMs = -Infinity;
      if (endMs == null) endMs = nowMs;
    }
    return { startMs: startMs, endMs: endMs, tz: tz, explicit: explicit };
  }

  function weiboLinkInfo(href, base) {
    var abs = absUrl(href, base);
    if (!abs) return null;
    var m = WEIBO_ANCHOR_RE.exec(abs);
    if (!m) return null;
    var uid = m[1], mblogid = m[2];
    if (WEIBO_PATH_WORDS.has(mblogid.toLowerCase()) && !/[A-Z]/.test(mblogid)) return null;
    // A real mblogid is either an all-digit legacy mid or base62 with an
    // uppercase letter ("RkvSCaGly"). This rejects /profile, /fans, /follow...
    var allDigits = /^\d+$/.test(mblogid);
    var modern = /[A-Z]/.test(mblogid) && /^[0-9A-Za-z]{6,16}$/.test(mblogid);
    if (!allDigits && !modern) return null;
    return {
      uid: uid,
      mblogid: mblogid,
      canonical: 'https://weibo.com/' + uid + '/' + mblogid,
      raw: abs,
    };
  }

  // ------------------------------------------------------------------- csv
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(cols, rows) {
    var out = [cols.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], line = [];
      for (var c = 0; c < cols.length; c++) line.push(csvCell(r[cols[c]]));
      out.push(line.join(','));
    }
    return out.join('\n');
  }

  /** The allowed `fields:` headings for a site — the full table's columns. */
  function fieldNames(site) {
    return COLS;
  }

  /**
   * Resolve `opts.fields` (array or comma-separated string) to a column list.
   *
   * Throws on a heading the site does not have, and the message lists every
   * allowed heading: a typo must fail loudly, not silently emit the wrong CSV
   * (same rule as an unparseable `start`/`end`).
   */
  function resolveFields(site, opts) {
    if (!opts || opts.fields == null) return null;
    var want = typeof opts.fields === 'string' ? opts.fields.split(',') : opts.fields;
    var allowed = fieldNames(site), picked = [], bad = [];
    for (var i = 0; i < want.length; i++) {
      var name = String(want[i] == null ? '' : want[i]).trim();
      if (!name) continue;
      if (allowed.indexOf(name) === -1) bad.push(name);
      else if (picked.indexOf(name) === -1) picked.push(name);
    }
    if (bad.length) {
      throw new Error(TAG + ' unknown heading(s): ' + bad.join(', ')
        + '. Allowed headings on ' + site + ': ' + allowed.join(', ') + '.');
    }
    if (!picked.length) {
      throw new Error(TAG + ' fields: [] selects no columns. '
        + 'Allowed headings on ' + site + ': ' + allowed.join(', ') + '.');
    }
    return picked;
  }

  /** The column list for this run: `fields` wins, then moreInfo, then the URLs. */
  function columnsFor(site, opts) {
    var picked = resolveFields(site, opts);
    if (picked) return picked;
    return opts && opts.moreInfo ? COLS : LINKS_COLS;
  }

  function linkList(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) if (rows[i].link) out.push(rows[i].link);
    return out;
  }

  /** Attach the output shape (csv / links) and stash the console handles. */
  function finish(env, res, site, opts) {
    res.moreInfo = !!(opts && opts.moreInfo);
    res.fields = columnsFor(site, opts);
    res.csv = toCsv(res.fields, res.rows);
    res.links = linkList(res.rows);
    try {
      if (env.window) { env.window.__xwsCsv = res.csv; env.window.__xwsResult = res; }
    } catch (e) { /* ignore */ }
    return res;
  }

  // ----------------------------------------------------------------- weibo
  /**
   * Locate the nested "original post" block of a repost.
   *
   * A candidate is any link inside the item pointing at a *different* post id.
   * The box must:
   *   - be a strict descendant of the item, and
   *   - NOT contain the item's own timestamp anchor.
   * Without the second condition, climbing to "the smallest ancestor holding
   * text" lands on the whole post, and then every unrelated link in the footer
   * (转发/评论/引用的另一条微博) looks like a repost original.
   */
  function findWeiboOriginal(item, ownAnchor, ownMblogid, base) {
    var anchors = item.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      if (anchor === ownAnchor) continue;
      var info = weiboLinkInfo(anchor.getAttribute('href'), base);
      if (!info || info.mblogid === ownMblogid) continue;

      var box = anchor.closest(WEIBO_ORIG_SEL);
      if (!box || box === item || !item.contains(box)) {
        box = null;
        var b = anchor.parentElement;
        while (b && b !== item) {
          if (firstOf(b, SEL.weiboText)) { box = b; break; }
          b = b.parentElement;
        }
      }
      if (!box || box === item || !item.contains(box)) continue;
      if (ownAnchor && box.contains(ownAnchor)) continue;

      return {
        anchor: anchor,
        info: info,
        box: box,
        deeper: findWeiboOriginal(box, anchor, info.mblogid, base),
      };
    }
    return null;
  }

  function weiboAuthor(scope, info, base) {
    if (!scope) return '';
    if (info && info.uid) {
      var re = new RegExp('/(?:u/)?' + info.uid + '(?:[/?#]|$)');
      var as = scope.querySelectorAll('a[href]');
      for (var i = 0; i < as.length; i++) {
        if (!re.test(as[i].getAttribute('href') || '')) continue;
        var nick = as[i].getAttribute('nick-name');
        if (nick) return normText(nick);
        var t = normText(as[i].textContent);
        if (t && t.length <= 60) return t;
      }
    }
    var el = firstOf(scope, ['.WB_info a', 'a[nick-name]', '[nick-name]', '.name', 'a.W_f14']);
    return el ? normText(el.getAttribute('nick-name') || el.textContent) : '';
  }

  function extractWeiboRow(item, anchor, info, nowMs, base) {
    var tz = CFG.tzHours;
    var orig = findWeiboOriginal(item, anchor, info.mblogid, base);
    var origBox = orig ? orig.box : firstOf(item, SEL.weiboOrig);
    var deeperBox = orig && orig.deeper ? orig.deeper.box : null;
    var ownMs = extractMs(item, origBox, nowMs, tz);

    var content = textOf(firstOutside(item, WEIBO_TEXT_SEL, origBox), {});
    var originalContent = origBox ? textOf(firstOutside(origBox, WEIBO_TEXT_SEL, deeperBox), {}) : '';
    var originalAuthor = origBox ? weiboAuthor(origBox, orig ? orig.info : null, base) : '';
    var originalLink = orig && orig.info ? orig.info.canonical : '';
    var origMs = origBox ? extractMs(origBox, deeperBox, nowMs, tz) : null;

    return {
      link: info.canonical,
      content: content,
      'posted_at_utc+08': fmtUtc8(ownMs),
      posted_at_utc: fmtUtc(ownMs),
      is_repost: origBox ? 'yes' : 'no',
      original_posted_at: origMs == null ? '' : fmtUtc8(origMs),
      original_author: originalAuthor,
      original_link: originalLink,
      original_content: originalContent,
      __ms: ownMs,
      __mblogid: info.mblogid,
    };
  }

  function scrapeWeibo(env, opts) {
    opts = opts || {};
    var doc = env.document;
    var nowMs = env.now == null ? Date.now() : env.now;
    var range = parseRange(opts, nowMs);
    var base = (env.location && env.location.href) || 'https://weibo.com/';
    var anchors = doc.querySelectorAll(WEIBO_ANCHOR_SEL);
    var stats = { anchors: anchors.length, claimed: 0, duplicate: 0, noContainer: 0, undated: 0, outOfRange: 0 };
    var seen = new Set();
    var claimed = [];
    var rows = [];

    for (var i = 0; i < anchors.length; i++) {
      var info = weiboLinkInfo(anchors[i].getAttribute('href'), base);
      if (!info) continue;
      if (seen.has(info.mblogid)) { stats.duplicate++; continue; }
      var item = anchors[i].closest(WEIBO_ITEM_SEL);
      if (!item) { stats.noContainer++; continue; }
      // First-come wins in document order, so a repost's nested original post
      // can never be emitted as a row of its own.
      var taken = false;
      for (var c = 0; c < claimed.length; c++) {
        if (claimed[c] === item || claimed[c].contains(item)) { taken = true; break; }
      }
      if (taken) { stats.duplicate++; continue; }
      claimed.push(item);
      seen.add(info.mblogid);
      stats.claimed++;

      var row = extractWeiboRow(item, anchors[i], info, nowMs, base);
      if (row.__ms == null) {
        stats.undated++;
        if (!opts.includeUndated) continue;
      } else if (row.__ms < range.startMs || row.__ms > range.endMs) {
        stats.outOfRange++;
        continue;
      }
      rows.push(row);
    }

    rows.sort(function (a, b) { return (b.__ms || 0) - (a.__ms || 0); });
    for (var n = 0; n < rows.length; n++) rows[n].no = n + 1;
    return { rows: rows, stats: stats, range: range };
  }

  function printResult(env, res, site) {
    var tag = TAG;
    // Say which columns were emitted: the default (one URL), an explicit
    // selection, or the full table.
    var shape = res.moreInfo ? ''
      : res.fields.length === 1 && res.fields[0] === 'link' ? ' [links only]'
        : ' [fields: ' + res.fields.join(', ') + ']';
    console.log('%c' + tag + ' ' + site + shape + ' — ' +
      res.rows.length + ' rows in range ' +
      fmtUtc8(res.range.startMs) + ' .. ' + fmtUtc8(res.range.endMs) + ' (UTC+8)',
      'color:#2b8a3e;font-weight:bold');
    console.log(res.csv);
    var s = res.stats;
    var notes = [];
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) notes.push(k + '=' + s[k]);
    console.log(tag + ' stats: ' + notes.join(' '));
    if (res.warning) {
      console.warn('%c' + tag + ' ' + res.warning, 'color:#c92a2a;font-weight:bold');
    }

    var copied = false;
    try {
      if (typeof copy === 'function') { copy(res.csv); copied = true; }
    } catch (e) { /* clipboard blocked */ }
    if (copied) {
      console.log(tag + ' CSV copied to clipboard.');
    } else {
      console.log(tag + ' copy() unavailable — use copy(__xwsCsv) or saveCsv().');
    }
    try {
      var nav = env.window && env.window.navigator;
      if (!copied && nav && nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(res.csv).then(function () {
          console.log(tag + ' CSV copied to clipboard (async API).');
        }, function () { /* blocked by policy — silent */ });
      }
    } catch (e) { /* ignore */ }
    return res;
  }

  // ---------------------------------------------------------- optional: auto
  /**
   * Scroll the page until no new posts appear. Off by default: PLAN.md says
   * "do not try to load additional posts as of now", so this is opt-in via
   * scrape({ autoLoad: true }). Unverified against the live sites.
   */
  function autoLoad(env, opts) {
    opts = opts || {};
    var doc = env.document, win = env.window;
    var waitMs = opts.waitMs == null ? 1500 : opts.waitMs;
    var maxScrolls = opts.maxScrolls == null ? 80 : opts.maxScrolls;
    var maxIdle = opts.maxIdle == null ? 4 : opts.maxIdle;
    var sel = WEIBO_ANCHOR_SEL;
    var idle = 0, steps = 0;
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var scroll = function () {
      var h = Math.max(doc.documentElement ? doc.documentElement.scrollHeight : 0,
        doc.body ? doc.body.scrollHeight : 0);
      if (win && win.scrollTo) win.scrollTo(0, h);
      return h;
    };
    var step = function () {
      if (steps >= maxScrolls || idle >= maxIdle) return Promise.resolve(steps);
      steps++;
      var before = doc.querySelectorAll(sel).length;
      scroll();
      return sleep(waitMs).then(function () {
        var after = doc.querySelectorAll(sel).length;
        idle = after > before ? 0 : idle + 1;
        console.log(TAG + ' autoLoad: posts=' + after + ' idle=' + idle);
        return step();
      });
    };
    return step();
  }

  // ------------------------------------- Weibo: JSON feed (the authoritative one)
  /**
   * Weibo's own profile feed as JSON, authenticated by the tab's cookies:
   *
   *   GET /ajax/statuses/mymblog?uid=<uid>&page=<n>&feature=<0|1>   20 items/page
   *   GET /ajax/statuses/longtext?id=<mid>                          full long text
   *
   * Verified against a live logged-in session (2026-10-10). This is the source
   * PLAN.md's sample rows came from, and it is strictly better than the DOM:
   *
   *   - JSON `created_at` has SECONDS ("Wed Sep 30 16:54:39 +0800 2026"); the
   *     rendered page shows minutes only (title="2026-09-30 16:54").
   *   - JSON `text_raw` is the plain text; long posts come back clipped and are
   *     completed via the longtext endpoint, whereas the DOM truncates them
   *     behind a 展开 link.
   *   - Reposts arrive as a nested `retweeted_status` with its own author, id
   *     and timestamp, instead of having to be inferred from markup.
   */
  function htmlToText(s) {
    if (s == null) return '';
    return normText(String(s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&'));
  }

  function jsonFetch(env, url) {
    var doFetch = (env.window && env.window.fetch) || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return Promise.reject(new Error('fetch is unavailable in this context'));
    return doFetch(url, { credentials: 'include', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; });
  }

  function weiboUidFrom(env, opts) {
    if (opts.uid) return String(opts.uid);
    var p = (env.location && env.location.pathname) || '';
    var m = /^\/u\/(\d{5,})/.exec(p) || /^\/(\d{5,})/.exec(p);
    return m ? m[1] : null;
  }

  function mblogLongText(env, mid) {
    if (!mid) return Promise.resolve(null);
    return jsonFetch(env, '/ajax/statuses/longtext?id=' + encodeURIComponent(mid))
      .then(function (j) {
        var d = j && j.data;
        if (!d) return null;
        var t = d.longTextContent_raw != null ? d.longTextContent_raw : d.longTextContent;
        if (t == null) return null;
        // longTextContent is HTML-escaped; longTextContent_raw is plain.
        return String(t).indexOf('<') === -1 ? normText(t) : htmlToText(t);
      })
      .catch(function () { return null; });
  }

  /** Map one JSON mblog (or retweeted_status consumer) onto our row shape. */
  function apiRow(m) {
    var rt = m.retweeted_status || null;
    var uid = (m.user && m.user.idstr) || '';
    var rtu = rt && rt.user ? (rt.user.idstr || '') : '';
    return {
      link: 'https://weibo.com/' + uid + '/' + m.mblogid,
      is_repost: rt ? 'yes' : 'no',
      original_author: rt && rt.user ? (rt.user.screen_name || '') : '',
      original_link: rt ? 'https://weibo.com/' + rtu + '/' + rt.mblogid : '',
      __mblogid: m.mblogid,
      __ms: parseWeiboCreatedAt(m.created_at, CFG.tzHours),
      __text: m.text_raw != null ? String(m.text_raw) : htmlToText(m.text),
      __isLongText: !!m.isLongText,
      __mid: m.mid,
      __origMs: rt ? parseWeiboCreatedAt(rt.created_at, CFG.tzHours) : null,
      __origText: rt ? (rt.text_raw != null ? String(rt.text_raw) : htmlToText(rt.text)) : '',
      __origIsLongText: rt ? !!rt.isLongText : false,
      __origMid: rt ? rt.mid : null,
    };
  }

  /** Complete any clipped long posts, in small batches to stay polite. */
  function resolveLongTexts(env, rows, stats, opts) {
    if (opts && opts.longText === false) return Promise.resolve();
    var i = 0;
    var step = function () {
      if (i >= rows.length) return Promise.resolve();
      var batch = rows.slice(i, i + 4);
      i += 4;
      return Promise.all(batch.map(function (r) {
        var jobs = [];
        if (r.__isLongText) {
          jobs.push(mblogLongText(env, r.__mid).then(function (t) {
            if (t) { r.__text = t; stats.longTextFetched++; }
          }));
        }
        if (r.__origIsLongText) {
          jobs.push(mblogLongText(env, r.__origMid).then(function (t) {
            if (t) { r.__origText = t; stats.longTextFetched++; }
          }));
        }
        return Promise.all(jobs);
      })).then(step);
    };
    return step();
  }

  // ------------------------------------------- optional: Weibo JSON API mode
  /**
   * Page the JSON feed and print the CSV. Prefer this over the DOM scraper on
   * weibo.com: same columns, but exact seconds and untruncated text.
   */
  function runWeiboApi(env, opts) {
    opts = opts || {};
    resolveFields('weibo', opts); // a bad heading fails before any request
    var nowMs = env.now == null ? Date.now() : env.now;
    var range = parseRange(opts, nowMs);
    var uid = weiboUidFrom(env, opts);
    if (!uid) {
      console.warn(TAG + ' weiboApiScrape: pass { uid: "<weibo numeric uid>" }');
      return Promise.resolve(null);
    }
    var feature = opts.feature == null ? 0 : opts.feature;
    var maxPages = opts.maxPages == null ? 60 : opts.maxPages;
    var rows = [];
    var seenIds = new Set();
    var stats = { pages: 0, items: 0, reposts: 0, longTextFetched: 0, duplicateItems: 0,
      undated: 0, outOfRange: 0, stopReason: 'maxPages' };

    var onePage = function (page) {
      var url = '/ajax/statuses/mymblog?uid=' + encodeURIComponent(uid) +
        '&page=' + page + '&feature=' + feature;
      return jsonFetch(env, url)
        .then(function (j) {
          var list = j && j.data ? (j.data.list || []) : [];
          if (!list.length) { stats.stopReason = 'empty'; return false; }
          stats.pages = page;
          var oldest = null;
          var newOnPage = 0;
          for (var i = 0; i < list.length; i++) {
            var m = list[i];
            // Guard against the feed repeating itself, which would otherwise spin
            // until maxPages.
            if (seenIds.has(m.mblogid)) { stats.duplicateItems++; continue; }
            seenIds.add(m.mblogid);
            newOnPage++;
            stats.items++;
            var row = apiRow(m);
            if (row.__ms == null) { stats.undated++; continue; }
            if (oldest == null || row.__ms < oldest) oldest = row.__ms;
            if (row.__ms > range.endMs) continue;                  // newer than the window
            if (row.__ms < range.startMs) { stats.outOfRange++; continue; }
            if (row.is_repost === 'yes') stats.reposts++;
            rows.push(row);
          }
          if (newOnPage === 0) { stats.stopReason = 'repeatedPage'; return false; }
          // Stop once the whole page is older than the window.
          if (oldest != null && oldest < range.startMs) { stats.stopReason = 'reachedStart'; return false; }
          return true;
        });
    };

    var loop = function (page) {
      if (page > maxPages) return Promise.resolve();
      return onePage(page).then(function (more) { return more ? loop(page + 1) : null; });
    };

    return loop(1)
      .then(function () { return resolveLongTexts(env, rows, stats, opts); })
      .then(function () {
        rows.sort(function (a, b) { return (b.__ms || 0) - (a.__ms || 0); });
        var out = rows.map(function (r, idx) {
          return {
            no: idx + 1,
            link: r.link,
            content: normText(r.__text),
            'posted_at_utc+08': fmtUtc8(r.__ms),
            posted_at_utc: fmtUtc(r.__ms),
            is_repost: r.is_repost,
            original_posted_at: r.__origMs == null ? '' : fmtUtc8(r.__origMs),
            original_author: r.original_author,
            original_link: r.original_link,
            original_content: normText(r.__origText),
          };
        });
        var res = { rows: out, stats: stats, range: range, site: 'weibo', mode: 'api' };
        return printResult(env, finish(env, res, 'weibo', opts), 'weibo');
      });
  }

  function saveCsv(doc, csv, name) {
    var d = new Date();
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    var filename = name || ('weibo-posts-' + stamp + '.csv');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    (doc.body || doc.documentElement).appendChild(a);
    a.click();
    setTimeout(function () { a.parentNode && a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 0);
    console.log(TAG + ' saved ' + filename);
    return filename;
  }

  function run(env, opts) {
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
  }

  // -------------------------------------------------------------- diagnose
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
  }

  return {
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
  };
});
