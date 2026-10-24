/*!
 * scrape-xhs.generated.js — Xiaohongshu / RedNote-only build of scrape.js.
 *
 * GENERATED FILE — do not edit. Run `npm run build` to regenerate; edit
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
    root.xhsScraper = api;
    root.scrape = function (opts) { return api.run(env(), opts); };
    root.diagnose = function () { return api.diagnose(env()); };
    root.saveCsv = function (csv, name) { return api.saveCsv(root.document, csv, name); };

    // Pasting only defines the API — nothing is scraped until you call scrape().
    console.log('[xhs-scraper] ready. scrape() = post URLs for last month; ' +
      'scrape({ moreInfo: true }) = the full table; ' +
      'scrape({ fields: [...] }) = pick columns.');
    return null; // nothing scraped yet
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api; // Node: for the dev-machine test suite only
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAG = '[xhs-scraper]';

  var CFG = {
    tzHours: 8, // Asia/Shanghai and Asia/Singapore are both UTC+8
  };

  var MINUTE = 60000;

  var HOUR = 3600000;

  var DAY = 86400000;

  var COLS = ['no', 'note_id', 'posted_at_utc+08', 'posted_at_utc', 'caption', 'link',
    'link_alt', 'link_as_scraped'];
  // The default output: one post URL per line (scrape({ moreInfo: true }) widens it).
  var LINKS_COLS = ['link'];

  // ---------------------------------------------------------------- selectors
  // Layered fallbacks: XHS rewrites its class names every few years, so each
  // field is a preference-ordered list. `diagnose()` reports which hit.
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
  };

  var OBJID_RE = /^[0-9a-f]{24}$/;

  // Strings the site injects into the text node that are UI, not content.
  var JUNK_TEXTS = ['展开全文', '收起全文', '展开', '收起', '全文'];

  var SHORTLINK_TEXT_RE = /^(网页链接|Web link|链接)$/;

  function union(list) { return list.join(', '); }

  var XHS_ANCHOR_SEL = union(SEL.xhsAnchor);

  var XHS_ITEM_SEL = union(SEL.xhsItem);

  var XHS_CARD_SEL = union(SEL.xhsCard);

  var XHS_TITLE_SEL = union(SEL.xhsTitle);

  // -------------------------------------------------------------- small utils
  function firstOf(scope, sels) {
    if (!scope) return null;
    for (var i = 0; i < sels.length; i++) {
      var el = scope.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  function absUrl(href, base) {
    if (!href) return null;
    try { return new URL(href, base || 'https://www.xiaohongshu.com/').href; } catch (e) { return null; }
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
   *  - <br> becomes a newline (the site separates paragraphs with <br>)
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
        if (SHORTLINK_TEXT_RE.test(normText(nodes[i].textContent)) && /^https?:\/\/t\.cn\//.test(absUrl(href, 'https://www.xiaohongshu.com/') || href)) {
          nodes[i].textContent = absUrl(href, 'https://www.xiaohongshu.com/') || href;
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

  /** Relative/abbreviated display strings: "20分钟前", "昨天 10:30", "09-30". */
  function parseRelativeTimeText(s, nowMs, tz) {
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
    if (title) { var b = parseAbsoluteDatetime(title, tz) || parseRelativeTimeText(title, nowMs, tz); if (b != null) return b; }
    var txt = normText(el.textContent).replace(/来自.*$/s, '').trim();
    if (txt && txt.length <= 24) {
      var c = parseRelativeTimeText(txt, nowMs, tz);
      if (c != null) return c;
    }
    return null;
  }

  function extractMs(scope, excludeBox, nowMs, tz) {
    if (!scope) return null;
    var sels = ['a[date]', '[date]', 'time[datetime]', '[datetime]', 'a[title]'];
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

  /** The 'YYYY-MM' immediately before `mon` ('2026-01' -> '2025-12'). */
  function prevMonth(mon) {
    var y = +String(mon).slice(0, 4), m = +String(mon).slice(5, 7) - 1;
    if (m < 1) { m = 12; y -= 1; }
    return y + '-' + pad(m);
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
      // Default window: the *previous* calendar month in UTC+8, so a monthly run
      // after the month has closed is just `scrape()`. On any day of October —
      // the 1st or the 31st — the default is September; ask for October with
      // { month: '2026-10' }, or run it in November.
      var cur = prevMonth(monthOf(nowMs, tz));
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

  // ------------------------------------------------------------- identifiers
  /**
   * XHS note ids are MongoDB ObjectIds: the first 4 bytes are the creation
   * timestamp in seconds. Verified against PLAN.md's sample rows.
   */
  function objectIdToMs(noteId, nowMs) {
    if (!OBJID_RE.test(String(noteId || ''))) return null;
    var secs = parseInt(String(noteId).slice(0, 8), 16);
    var ms = secs * 1000;
    // XHS launched in 2013; reject anything outside a plausible window.
    if (ms < Date.UTC(2013, 0, 1) || ms > (nowMs || Date.now()) + 400 * DAY) return null;
    return ms;
  }

  /**
   * XHS note URLs come in several shapes and XHS *user ids* are themselves
   * 24-hex, so anchoring on "any 24-hex path segment" would happily return the
   * author's uid as the note id. Only accept explicit, unambiguous shapes:
   *
   *   /explore/<noteId>                    /discovery/item/<noteId>
   *   /user/profile/<uid>/<noteId>
   */
  function xhsLinkInfo(href, base) {
    var abs = absUrl(href, base);
    if (!abs) return null;
    var u;
    try { u = new URL(abs); } catch (e) { return null; }
    if (!/(^|\.)(xiaohongshu\.com|rednote\.com)$/.test(u.hostname)) return null;

    var segs = u.pathname.split('/').filter(Boolean);
    var noteId = null;
    for (var i = 0; i < segs.length && !noteId; i++) {
      if ((segs[i] === 'explore' || segs[i] === 'item') && OBJID_RE.test(segs[i + 1] || '')) {
        noteId = segs[i + 1];
      } else if (segs[i] === 'profile' && OBJID_RE.test(segs[i + 1] || '') && OBJID_RE.test(segs[i + 2] || '')) {
        noteId = segs[i + 2];
      }
    }
    if (!noteId) return null;

    var token = null, source = null;
    try {
      token = u.searchParams.get('xsec_token');
      source = u.searchParams.get('xsec_source');
    } catch (e) { /* older browsers */ }
    return { noteId: noteId, xsecToken: token, xsecSource: source, raw: abs };
  }

  function querySuffix(token, source) {
    var q = '';
    if (token) q += 'xsec_token=' + encodeURIComponent(token);
    if (source) q += (q ? '&' : '') + 'xsec_source=' + encodeURIComponent(source);
    return q ? '?' + q : '';
  }

  function xhsCanonicalLink(info) {
    return 'https://www.xiaohongshu.com/explore/' + info.noteId + querySuffix(info.xsecToken, info.xsecSource);
  }

  function xhsAltLink(info) {
    return 'https://www.rednote.com/discovery/item/' + info.noteId + querySuffix(info.xsecToken, info.xsecSource);
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

  // -------------------------------------------------------- XHS page state
  /**
   * Summarise the note cards inside XHS's embedded state.
   *
   * IMPORTANT, verified against a real capture on 2026-10-10: XHS's
   * server-rendered profile page ships `noteCard.noteId` as an EMPTY STRING for
   * every card (the ids are filled in client-side after hydration), while
   * `time`, `xsecToken` and `displayTitle` are populated. So "0 note cards"
   * here on an anonymous fetch is expected, and is a useful signal: it tells us
   * whether the page we are looking at has been hydrated yet.
   */
  function inspectStateNotes(state) {
    var out = { noteCards: 0, blankId: 0, filledId: 0 };
    if (!state || typeof state !== 'object') return out;
    var seen = new Set();
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 12) return;
      if (seen.has(o)) return;
      seen.add(o);
      if (o.noteCard && typeof o.noteCard === 'object') {
        out.noteCards++;
        var id = o.noteCard.noteId;
        if (typeof id === 'string' && OBJID_RE.test(id)) out.filledId++;
        else out.blankId++;
      }
      if (Array.isArray(o)) {
        for (var i = 0; i < o.length; i++) walk(o[i], depth + 1);
        return;
      }
      for (var k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k) && o[k] && typeof o[k] === 'object') walk(o[k], depth + 1);
      }
    })(state, 0);
    return out;
  }

  /**
   * XHS embeds a big __INITIAL_STATE__ JSON blob. We do not depend on its exact
   * shape: walk it and pick up anything that looks like a note card.
   */
  function collectNoteCards(state) {
    var out = {};
    if (!state || typeof state !== 'object') return out;
    // A Set, not an array: XHS's state blob is large and indexOf would make this
    // quadratic. Also guards against the blob ever becoming cyclic.
    var seenNodes = new Set();
    var count = 0;
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 12 || count > 40000) return;
      if (seenNodes.has(o)) return;
      seenNodes.add(o);
      count++;
      if (typeof o.noteId === 'string' && OBJID_RE.test(o.noteId)) {
        var rec = out[o.noteId] || (out[o.noteId] = {});
        var title = o.displayTitle != null ? o.displayTitle : o.title;
        if (title != null && rec.title == null) rec.title = normText(title);
        if (o.time != null && rec.timeMs == null) {
          var n = Number(o.time);
          if (isFinite(n) && n > 0) rec.timeMs = n < 1e12 ? n * 1000 : n;
        }
        if (o.xsecToken && !rec.token) rec.token = o.xsecToken;
      }
      if (Array.isArray(o)) {
        for (var i = 0; i < o.length; i++) walk(o[i], depth + 1);
        return;
      }
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        var v = o[k];
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    })(state, 0);
    return out;
  }

  function pageState(env) {
    try {
      if (env.window && env.window.__INITIAL_STATE__) return env.window.__INITIAL_STATE__;
    } catch (e) { /* ignore */ }
    return null;
  }

  // ------------------------------------------------------------------- xhs
  /**
   * Note id from the card element itself.
   *
   * Observed in a live capture: XHS renders `<section class="note-item"
   * data-note-id="">` — its own component fills that attribute client-side, so
   * on a hydrated page it is a second source for the id, independent of the
   * href shape.
   */
  function cardNoteId(el) {
    if (!el || !el.getAttribute) return null;
    var v = el.getAttribute('data-note-id') || el.getAttribute('data-noteid');
    if (typeof v === 'string' && OBJID_RE.test(v)) return v;
    if (el.querySelector) {
      var inner = el.querySelector('[data-note-id]');
      if (inner) {
        var iv = inner.getAttribute('data-note-id');
        if (typeof iv === 'string' && OBJID_RE.test(iv)) return iv;
      }
    }
    return null;
  }

  function xhsTokenFromHref(href, base) {
    var abs = absUrl(href, base);
    if (!abs) return { token: null, source: null };
    try {
      var u = new URL(abs);
      return { token: u.searchParams.get('xsec_token'), source: u.searchParams.get('xsec_source') };
    } catch (e) {
      return { token: null, source: null };
    }
  }

  function scrapeXhs(env, opts) {
    opts = opts || {};
    var doc = env.document;
    var nowMs = env.now == null ? Date.now() : env.now;
    var range = parseRange(opts, nowMs);
    var base = (env.location && env.location.href) || 'https://www.xiaohongshu.com/';
    var cards = opts.enrich === false ? {} : collectNoteCards(pageState(env));
    var anchors = doc.querySelectorAll(XHS_ANCHOR_SEL);
    var stats = { anchors: anchors.length, seen: 0, duplicate: 0, undated: 0, outOfRange: 0, fromState: 0 };
    var rows = [];

    // Pass 1: resolve one entry per note. A card carries several anchors (a hidden
    // "explore" link, the cover, the title) and they do not all carry the note id
    // or the xsec_token, so merge them instead of letting the first one win.
    var byId = Object.create(null);
    var found = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var info = xhsLinkInfo(a.getAttribute('href'), base);
      var item = a.closest(XHS_ITEM_SEL);
      if (!info) {
        // The href may carry no note id before the page has hydrated
        // (/user/profile/<uid>/?xsec_token=…). Fall back to data-note-id on the
        // card, and take the token from whatever query the href does carry.
        var attrId = cardNoteId(item);
        if (!attrId) continue;
        var t = xhsTokenFromHref(a.getAttribute('href'), base);
        info = { noteId: attrId, xsecToken: t.token, xsecSource: t.source, raw: absUrl(a.getAttribute('href'), base) };
      }
      var rec = byId[info.noteId];
      if (rec) {
        stats.duplicate++;
        if (!rec.info.xsecToken && info.xsecToken) {
          rec.info.xsecToken = info.xsecToken;
          rec.info.xsecSource = info.xsecSource || rec.info.xsecSource;
          rec.info.raw = info.raw;
        }
        if (!rec.item && item) rec.item = item;
        continue;
      }
      stats.seen++;
      rec = { info: info, item: item, anchor: a };
      byId[info.noteId] = rec;
      found.push(rec);
    }

    // Pass 2: one row per note.
    for (var f = 0; f < found.length; f++) {
      var note = found[f];
      var card = cards[note.info.noteId] || null;
      var ms = objectIdToMs(note.info.noteId, nowMs);
      if (ms == null && card && card.timeMs != null) { ms = card.timeMs; stats.fromState++; }
      if (ms == null) {
        var domMs = extractMs(note.item || note.anchor, null, nowMs, CFG.tzHours);
        if (domMs != null) { ms = domMs; stats.fromState++; }
      }

      var caption = '';
      if (note.item) {
        var titleEl = firstOf(note.item, SEL.xhsTitle) || note.item.querySelector('img[alt]');
        if (titleEl) {
          caption = titleEl.tagName === 'IMG'
            ? normText(titleEl.getAttribute('alt'))
            : textOf(titleEl, { stripUi: false, imgAlt: false, shortLinks: false });
        }
      }
      if (opts.preferStateTitle && card && card.title) caption = card.title;
      if (!caption && card && card.title) caption = card.title;

      // Prefer whatever token the DOM gave us; fall back to the embedded state.
      var tok = note.info.xsecToken || (card && card.token) || null;
      var linkInfo = { noteId: note.info.noteId, xsecToken: tok, xsecSource: note.info.xsecSource };

      if (ms == null) {
        stats.undated++;
        if (!opts.includeUndated) continue;
      } else if (ms < range.startMs || ms > range.endMs) {
        stats.outOfRange++;
        continue;
      }

      rows.push({
        note_id: note.info.noteId,
        'posted_at_utc+08': fmtUtc8(ms),
        posted_at_utc: fmtUtc(ms),
        caption: caption,
        link: xhsCanonicalLink(linkInfo),
        link_alt: xhsAltLink(linkInfo),
        link_as_scraped: note.info.raw,
        __ms: ms,
      });
    }

    rows.sort(function (a, b) { return (b.__ms || 0) - (a.__ms || 0); });
    for (var n = 0; n < rows.length; n++) rows[n].no = n + 1;

    // A page full of note cards that yields no note links has a specific cause,
    // and silently returning an empty CSV hides it. Verified against a real
    // capture: XHS serves `noteCard.noteId` as "" in the server-rendered HTML
    // and only fills the ids in after the client hydrates, so scraping a page
    // that has not finished loading looks exactly like this.
    var cardCount = doc.querySelectorAll(XHS_CARD_SEL).length;
    var warning = null;
    if (rows.length === 0 && stats.seen === 0 && cardCount > 0) {
      warning = 'found ' + cardCount + ' note cards but 0 note links. XHS puts the '
        + 'note id in the link only after the page has finished loading — wait for '
        + 'the cards to settle (or scroll a little) and re-run scrape(). If it stays '
        + 'empty, run diagnose(): the note URL shape has probably changed.';
    }
    return { rows: rows, stats: stats, range: range, cardCount: cardCount, warning: warning };
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
    var sel = XHS_ANCHOR_SEL;
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

  function saveCsv(doc, csv, name) {
    var d = new Date();
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    var filename = name || ('xhs-posts-' + stamp + '.csv');
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
  }

  // -------------------------------------------------------------- diagnose
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
  }

  return {
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
  };
});
