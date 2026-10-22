/*!
 * xhs-weibo-scraper — paste-into-DevTools-console scraper for
 * Xiaohongshu / RedNote and Weibo *profile* pages.
 *
 * ZERO dependencies. No Node, no npm, no extension, no userscript manager.
 * Copy this whole file, paste it into the browser DevTools Console while you
 * are sitting on the (already scrolled) profile page, press Enter.
 *
 *   Web UI nothing to install. That is the point: corp laptops.
 *
 * WHAT IT DOES
 *   - Reads the account's posts and keeps only those inside a date range.
 *     Default range = the last 35 days. Override with { start, end } or { days }.
 *   - On weibo.com it uses the site's own JSON feed (same-origin, your existing
 *     session), because that is the only source with second-precision times and
 *     untruncated text. Pass { mode: 'dom' } to read the rendered page instead.
 *     On XHS it reads the rendered cards — no extra requests.
 *   - Prints the result as CSV in the console, and puts it on the clipboard.
 *   - It never logs in for you and never handles credentials.
 *
 * QUICK USE (in the console, on the profile page):
 *
 *   scrape()                                      // auto-detect site, last 35 days
 *   scrape({ start: '2026-01', end: '2026-09' })  // whole months (UTC+8 boundaries)
 *   scrape({ days: 7 })                           // rolling window
 *   scrape({ mode: 'dom' })                       // force reading the page (Weibo)
 *   scrape({ autoLoad: true })                    // XHS: scroll to load more first
 *   diagnose()                                    // which DOM hooks actually matched
 *   copy(__xwsCsv)                                // re-copy the last CSV
 *   saveCsv()                                     // download it as a .csv
 *
 * Both paths are verified against live logged-in accounts; see README.md.
 *
 * OUTPUT
 *   console.log(csv)  -> the CSV, exactly as in PLAN.md
 *   copy(csv)         -> clipboard (Chrome/Edge DevTools command-line API)
 *   $_                -> the last result object, e.g. $_.rows.length, $_.csv
 *   __xwsCsv          -> the last CSV string
 *
 * Run `npm test` in this folder to exercise the pure core (dev machine only —
 * Node is NOT needed on the machine you scrape from).
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
    root.xhsWeiboScraper = api;
    root.scrape = function (opts) { return api.run(env(), opts); };
    root.diagnose = function () { return api.diagnose(env()); };
    root.saveCsv = function (csv, name) { return api.saveCsv(root.document, csv, name); };
    root.weiboApiScrape = function (opts) { return api.runWeiboApi(env(), opts); };

    var out = null;
    try {
      out = root.scrape({}); // auto-run with defaults, as PLAN.md asks
    } catch (e) {
      console.error('[xhs-weibo-scraper] auto-run failed:', e);
    }
    return out; // becomes `$_` in the DevTools console
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api; // Node: for `npm test` only
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CFG = {
    tzHours: 8, // Asia/Shanghai and Asia/Singapore are both UTC+8
    defaultDays: 35,
  };

  var MINUTE = 60000;
  var HOUR = 3600000;
  var DAY = 86400000;

  var COLS = {
    weibo: ['no', 'link', 'content', 'posted_at_utc+08', 'posted_at_utc', 'is_repost',
      'original_posted_at', 'original_author', 'original_link', 'original_content'],
    xhs: ['no', 'note_id', 'posted_at_utc+08', 'posted_at_utc', 'caption', 'link',
      'link_alt', 'link_as_scraped'],
  };

  // ---------------------------------------------------------------- selectors
  // Layered fallbacks: weibo/xhs rewrite their class names every few years, so
  // each field is a preference-ordered list. `diagnose()` reports which hit.
  var SEL = {
    // Weibo: a top-level feed item container.
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
    // Weibo: the timestamp area.
    weiboFrom: ['.WB_from', '[class*="from_"]', '[class*="from"]'],
    // Weibo: the nested "original post" box of a repost.
    weiboOrig: [
      '.WB_feed_expand',
      '.WB_expand',
      '[node-type="feed_list_forwardContent"]',
    ],
    // XHS: an anchor that points at a note.
    xhsAnchor: [
      'a[href*="/explore/"]',
      'a[href*="/discovery/item/"]',
      'a[href*="/user/profile/"][href*="xsec_token"]',
    ],
    // XHS: the note card.
    xhsItem: ['section.note-item', 'section', '.note-item', '[class*="noteItem"]', 'li'],
    // XHS: a note card specifically (no generic <section>/<li> fallbacks), used
    // to count cards when deciding whether an empty result is a warning.
    xhsCard: ['section.note-item', '.note-item', '[class*="noteItem"]'],
    // XHS: the caption / title.
    xhsTitle: ['a.title', '.title', '[class*="title"]'],
  };

  var WEIBO_ANCHOR_RE = /^https?:\/\/(?:www\.|m\.)?weibo\.(?:com|cn)\/(?:u\/)?(\d{5,})\/([0-9A-Za-z]{6,24})(?:[/?#]|$)/;
  // Path words that look like an id but are not one.
  var WEIBO_PATH_WORDS = new Set(['profile', 'follow', 'fans', 'info', 'album', 'photo',
    'video', 'tv', 'set', 'at', 'groups', 'like', 'mylike', 'comment', 'repost', 'tag',
    'search', 'hot', 'weibo', 'status', 'statuses', 'ttarticle', 'media', 'detail', 'home']);

  var XHS_NOTE_ID_RE = /[0-9a-f]{24}/;
  var OBJID_RE = /^[0-9a-f]{24}$/;

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
    throw new Error('xhs-weibo-scraper: cannot parse date "' + v + '" (use 2026-09, 2026-09-30 or 2026-09-30 16:00)');
  }

  function parseRange(opts, nowMs) {
    opts = opts || {};
    var tz = CFG.tzHours;
    var explicit = opts.start != null || opts.end != null;
    var startMs, endMs;
    if (!explicit) {
      var days = opts.days == null ? CFG.defaultDays : +opts.days;
      endMs = nowMs;
      startMs = nowMs - days * DAY;
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

  // -------------------------------------------------------------- reporting
  function detectSite(loc) {
    var h = (loc && loc.hostname) || '';
    if (/(^|\.)(xiaohongshu|rednote)\.com$/.test(h)) return 'xhs';
    if (/(^|\.)weibo\.(com|cn)$/.test(h)) return 'weibo';
    return null;
  }

  function printResult(env, res, site) {
    var tag = '[xhs-weibo-scraper]';
    console.log('%c' + tag + ' ' + site + ' — ' + res.rows.length + ' rows in range ' +
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

  function run(env, opts) {
    opts = opts || {};
    var site = opts.site || detectSite(env.location);
    if (!site) {
      console.warn('[xhs-weibo-scraper] Not on a recognised XHS/RedNote or Weibo page. ' +
        'Pass { site: "weibo" } or { site: "xhs" } to force it.');
      return null;
    }
    var exec = function () {
      var res = site === 'xhs' ? scrapeXhs(env, opts) : scrapeWeibo(env, opts);
      res.site = site;
      res.csv = toCsv(COLS[site], res.rows);
      try {
        if (env.window) { env.window.__xwsCsv = res.csv; env.window.__xwsResult = res; }
      } catch (e) { /* ignore */ }
      return printResult(env, res, site);
    };

    // On weibo.com the JSON feed is the real source of truth: the rendered page
    // carries minute-precision times and truncates long posts, while the feed
    // carries seconds and the full text (see runWeiboApi). Fall back to reading
    // the page if the feed is unavailable or empty.
    if (site === 'weibo' && opts.mode !== 'dom') {
      return runWeiboApi(env, opts).then(function (res) {
        if (res && res.rows && res.rows.length) return res;
        if (res) {
          console.warn('[xhs-weibo-scraper] the JSON feed returned no rows for this '
            + 'window — falling back to reading the rendered page. Use '
            + '{ mode: "dom" } to always read the page, or check the range.');
        }
        return exec();
      }, function (err) {
        console.warn('[xhs-weibo-scraper] JSON feed failed (' + err.message
          + ') — falling back to reading the rendered page.');
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
    var site = opts.site || detectSite(env.location);
    var sel = site === 'xhs' ? XHS_ANCHOR_SEL : WEIBO_ANCHOR_SEL;
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
        console.log('[xhs-weibo-scraper] autoLoad: posts=' + after + ' idle=' + idle);
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
    var nowMs = env.now == null ? Date.now() : env.now;
    var range = parseRange(opts, nowMs);
    var uid = weiboUidFrom(env, opts);
    if (!uid) {
      console.warn('[xhs-weibo-scraper] weiboApiScrape: pass { uid: "<weibo numeric uid>" }');
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
        res.csv = toCsv(COLS.weibo, out);
        try {
          if (env.window) { env.window.__xwsCsv = res.csv; env.window.__xwsResult = res; }
        } catch (e) { /* ignore */ }
        return printResult(env, res, 'weibo');
      });
  }

  function saveCsv(doc, csv, name) {
    var d = new Date();
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    var filename = name || ('posts-' + stamp + '.csv');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    (doc.body || doc.documentElement).appendChild(a);
    a.click();
    setTimeout(function () { a.parentNode && a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 0);
    console.log('[xhs-weibo-scraper] saved ' + filename);
    return filename;
  }

  // -------------------------------------------------------------- diagnose
  function diagnose(env) {
    var doc = env.document;
    var site = detectSite(env.location);
    var out = { site: site, href: env.location && env.location.href, selectors: {}, samples: {} };
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
    if (site === 'weibo') {
      report('weibo.anchors', WEIBO_ANCHOR_SEL);
      report('weibo.items', WEIBO_ITEM_SEL);
      report('weibo.text', WEIBO_TEXT_SEL);
      report('weibo.from', WEIBO_FROM_SEL);
      report('weibo.original', WEIBO_ORIG_SEL);
      report('weibo.a[date]', 'a[date]');
      dump('firstItem', doc.querySelector(WEIBO_ITEM_SEL));
    } else if (site === 'xhs') {
      report('xhs.anchors', XHS_ANCHOR_SEL);
      report('xhs.items', XHS_ITEM_SEL);
      report('xhs.cards', XHS_CARD_SEL);
      report('xhs.titles', XHS_TITLE_SEL);
      dump('firstItem', doc.querySelector(XHS_CARD_SEL));
      var st = pageState(env);
      out.hasInitialState = !!st;
      out.noteCardsInDom = doc.querySelectorAll(XHS_CARD_SEL).length;
      if (st) {
        out.noteCardsInState = Object.keys(collectNoteCards(st)).length;
        // Distinguishes "XHS has not hydrated yet" from "markup changed".
        out.stateNotes = inspectStateNotes(st);
      }
    }
    console.log('[xhs-weibo-scraper] diagnose:', out);
    return out;
  }

  return {
    CFG: CFG, COLS: COLS, SEL: SEL,
    run: run, scrapeWeibo: scrapeWeibo, scrapeXhs: scrapeXhs,
    runWeiboApi: runWeiboApi, autoLoad: autoLoad, saveCsv: saveCsv, diagnose: diagnose,
    detectSite: detectSite,
    // exported for tests
    normText: normText, textOf: textOf, csvCell: csvCell, toCsv: toCsv,
    fmtUtc8: fmtUtc8, fmtUtc: fmtUtc,
    objectIdToMs: objectIdToMs, parseRange: parseRange, parseBoundary: parseBoundary,
    parseAbsoluteDatetime: parseAbsoluteDatetime, parseWeiboCreatedAt: parseWeiboCreatedAt,
    parseWeiboTimeText: parseWeiboTimeText, msFromElement: msFromElement,
    weiboLinkInfo: weiboLinkInfo, xhsLinkInfo: xhsLinkInfo,
    xhsCanonicalLink: xhsCanonicalLink, xhsAltLink: xhsAltLink,
    collectNoteCards: collectNoteCards, inspectStateNotes: inspectStateNotes,
    cardNoteId: cardNoteId, xhsTokenFromHref: xhsTokenFromHref,
    _sel: {
      WEIBO_ANCHOR_SEL: WEIBO_ANCHOR_SEL, WEIBO_ITEM_SEL: WEIBO_ITEM_SEL,
      WEIBO_TEXT_SEL: WEIBO_TEXT_SEL, XHS_ANCHOR_SEL: XHS_ANCHOR_SEL,
    },
  };
});
