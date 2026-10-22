# xhs-weibo-scraper

A single JavaScript file you paste into the browser DevTools **Console** to turn an open
Xiaohongshu / RedNote or Weibo profile page into a CSV of that account's posts.

It implements `PLAN.md` in this folder. **Both paths are verified against live, logged-in
accounts** — see [What was verified](#what-was-verified) for the raw evidence.

**The point of the design:** the machine you scrape from needs *nothing* — no Node, no
npm, no extension, no userscript manager, no admin rights. Just the browser's console and
a logged-in session. That is deliberate: this is built for a restricted corporate laptop.

---

## The 30-second version

1. Log in to the site, then open the account page (`weibo.com/<uid>` or
   `xiaohongshu.com/user/profile/<uid>`, or the `rednote.com` equivalents).
2. Open DevTools → **Console** (`Cmd/Ctrl+Shift+J`). The first time, Chrome/Edge makes
   you type `allow pasting` and press Enter — their self-XSS guard, not a problem here.
3. Paste the whole contents of **`scrape.js`**, press Enter.

You get the CSV printed in the console, copied to your clipboard, and available as
`__xwsCsv`.

On Weibo it reads the site's own JSON feed. On XHS it reads the rendered cards. Neither
needs you to scroll.

**Only care about one site?** Use `scrape-weibo.generated.js` or
`scrape-xhs.generated.js` instead — same behaviour, one site each, no auto-detection. They
are built from `scrape.js` by `npm run build`. See
[One file per site](#one-file-per-site-optional). Every flag is documented in
`USAGE.md`.

---

## Usage

```js
scrape()                                      // auto-detect site, last 35 days (default)
scrape({ start: '2026-01', end: '2026-09' })  // whole months, UTC+8 boundaries
scrape({ start: '2026-01-15', end: '2026-03-02' })
scrape({ days: 7 })                           // rolling window instead
scrape({ mode: 'dom' })                       // Weibo: read the page instead of the feed
scrape({ longText: false })                   // Weibo: skip the extra full-text requests
scrape({ feature: 1 })                        // Weibo: 1 = 原创 only, 0 = everything
scrape({ includeUndated: true })              // keep posts whose date can't be parsed
scrape({ site: 'weibo' })                     // force the site if detection fails

diagnose()          // which selectors matched, whether ids are populated, sample HTML
copy(__xwsCsv)      // re-copy the last CSV
saveCsv(__xwsCsv)   // download it as a .csv (UTF-8 BOM, Excel-safe)
$_                  // the last result: $_.rows, $_.csv, $_.stats, $_.mode
```

`start` / `end` accept `YYYY-MM`, `YYYY-MM-DD`, `YYYY-MM-DD HH:MM`, or an ISO string.
A bare date or month is interpreted in **UTC+8**, because that is what both sites
display. Omit one end and it stays open (`{ start: '2026-01' }` = January onward).

**Why 35 days by default:** `PLAN.md` says so, and it is comfortably more than a month,
so a monthly run never falls into a gap.

---

## How each site is read, and why

They are read in completely different ways, because the sites are completely different.

### Weibo — the JSON feed (default)

```
GET /ajax/statuses/mymblog?uid=<uid>&page=<n>&feature=<0|1>    20 posts/page
GET /ajax/statuses/longtext?id=<mid>                           full text of long posts
```

Same-origin, authenticated by the tab's own cookies. This is the **only** source that can
produce `PLAN.md`'s output, and in fact it is where your sample rows came from:

| | JSON feed | Rendered page |
|---|---|---|
| timestamp | `Wed Sep 30 16:54:39 +0800 2026` — **seconds** | `title="2026-09-30 16:54"` — minutes only |
| long posts | full text via the longtext endpoint | **truncated**, behind a `展开` ("expand") link |
| reposts | nested `retweeted_status` with author/id/time | must be inferred from markup |

The rendered page therefore cannot reproduce your sample (`16:54:39`, three full
paragraphs). The feed also removes the need to scroll: it pages through the whole
timeline and stops once it is older than your window.

`{ mode: 'dom' }` forces page-reading instead. That path still works, but gives
minute-precision times and possibly-clipped text, so it is a fallback — it is what runs
automatically if the feed is unavailable (e.g. not logged in).

Why not scrape the DOM as the primary? Beyond fidelity, Weibo's markup is now a `woo-*`
component system with **hashed CSS-module class names** (`_contentItem_med4d_29`,
`_main_118ye_2`). Those hashes change on every deploy, so selectors against them rot.
The API is both better data and a more stable target.

### XHS / RedNote — the rendered cards

No extra requests: it reads the note cards on the page. Note URLs come in three shapes and
XHS **user ids are themselves 24-hex**, so the parser only accepts unambiguous ones —
`/explore/<id>`, `/discovery/item/<id>`, `/user/profile/<uid>/<id>` — rather than grabbing
"any 24-hex path segment" (which would return the author's uid as a note id).

**Post dates come from the note id itself.** XHS note ids are MongoDB ObjectIds, so the
first 4 bytes *are* the creation timestamp — verified against `PLAN.md`'s ids to the
second (`6abccdd5…` → `2026-09-30 16:52:37+08`). This is not a convenience: a live capture
showed **zero dates rendered anywhere in the XHS DOM**, so the id (or the page's embedded
state) is the only route. Falls back to `__INITIAL_STATE__.noteCard.time`, then the DOM.

**XHS needs the page to have finished loading.** XHS serves the card list in its
server-rendered HTML with every `noteCard.noteId` set to `""`, and only fills the ids in
after the client hydrates. Scraping too early therefore looks *complete* — real covers,
real titles — while yielding nothing. That case now produces an explicit warning rather
than an empty CSV:

```
[xhs-weibo-scraper] found 30 note cards but 0 note links. XHS puts the note id in the
link only after the page has finished loading — wait for the cards to settle …
```

`scrape({ autoLoad: true })` scrolls until no new cards appear, if you want it to pull in
more than what is rendered.

---

## One file per site (optional)

`scrape.js` does both sites and auto-detects from the hostname. If you would rather not
carry the other site's code around, there is one build per site:

| file | paste it on | reads | extra globals |
|---|---|---|---|
| `scrape.js` | either | Weibo feed / XHS cards, auto-detected | `xhsWeiboScraper` |
| `scrape-weibo.generated.js` | `weibo.com/<uid>` | the JSON feed, DOM fallback | `weiboScraper` |
| `scrape-xhs.generated.js` | `xiaohongshu.com` / `rednote.com` profile | the rendered cards | `xhsScraper` |

The two `*.generated.js` files are **build output**, produced by `npm run build`
(`tools/build-split.js`) from `scrape.js` — the single source of truth. Do not edit them by
hand: fix `scrape.js` (logic, selectors, everything) or the per-site template in
`tools/build-split.js` (header, wrapper, `COLS`/`SEL` subset, `run()`, `diagnose()`), then
rebuild.

How the build works, briefly: `scrape.js`'s factory body is a flat list of top-level
declarations, so a site build is *shared declarations + that site's declarations*. Every
substantive block — selectors, date parsing, the Weibo feed paging, the XHS card resolution
— is copied **verbatim** out of `scrape.js`, which is what stops the split files drifting in
logic. A handful of asserted string edits cover the places where a shared block mentions the
other site (the console tag, `COLS.weibo`, the Weibo timestamp selector inside `extractMs`,
the `parseWeiboTimeText` name). `npm test` fails if the checked-in generated files are stale
relative to `scrape.js`, and `npm run build` fails if `scrape.js` grows a top-level
declaration the splitter has not been told about.

The console entry points are identical in all three (`scrape()`, `diagnose()`, `saveCsv()`,
`copy(__xwsCsv)`, `__xwsCsv`), so the usage examples carry over unchanged — see `USAGE.md`
for every flag. Only `weiboApiScrape()` is Weibo-only, and `site` is meaningless in the site
builds.

Behaviour differences are only the ones that follow from the split:

* The site builds never auto-detect: they always treat the page as their site and warn if
  the hostname is not theirs.
* `scrape-xhs.generated.js` never tries a feed (XHS has no JSON path here) and its
  `diagnose()` only reports card/anchor/state counts; the Weibo one reports feed selectors.
* Console tags are `[weibo-scraper]` / `[xhs-scraper]`, and `saveCsv()` defaults to
  `weibo-posts-*.csv` / `xhs-posts-*.csv`.
* The XHS build carries no Weibo identifiers at all (asserted in the test suite), including
  the renamed `parseRelativeTimeText`.

Both are covered by `npm test` (`test/split.test.js`) against the same golden rows as
`scrape.js`, plus build-freshness and "no other site leaked in" assertions, and by
`npm run test:browser` on a real headless Chrome origin.

---

## Output format

Both formats are byte-for-byte the ones in `PLAN.md`; the test suite asserts this for
both the DOM path and the Weibo API path.

### Weibo

```
no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content
1,https://weibo.com/7435186337/RkvSCaGly,"近日，受台风""白海豚""影响，…",2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,
```

* `posted_at_utc+08` is Beijing time (what the site shows); `posted_at_utc` is the same
  instant in UTC. Both `YYYY-MM-DD HH:MM:SS`.
* `is_repost` is `no` / `yes`; the four `original_*` columns are filled for reposts.
* `original_posted_at` uses the same `+08` format as `posted_at_utc+08`.
* Content keeps paragraph breaks, escapes `"` per RFC 4180, and preserves `t.cn`
  shortlinks.

### XHS

```
no,note_id,posted_at_utc+08,posted_at_utc,caption,link,link_alt,link_as_scraped
1,6abccdd5000000001800471b,2026-09-30 16:52:37,2026-09-30 08:52:37,"近日，…火龙",https://www.xiaohongshu.com/explore/…?xsec_token=…%3D&xsec_source=pc_user,https://www.rednote.com/discovery/item/…,https://www.rednote.com/user/profile/…/6abccdd5000000001800471b?xsec_token=…=&xsec_source=pc_user
```

* `link` — canonical `xiaohongshu.com/explore/…`, `xsec_token` percent-encoded.
* `link_alt` — the same note as a `rednote.com/discovery/item/…` URL.
* `link_as_scraped` — the raw `href` as the page had it, page's own scheme, token *not*
  re-encoded (`=` stays `=`).
* **`xsec_token` rotates.** It is a per-fetch access token, so `link`, `link_alt` and
  `link_as_scraped` legitimately differ between runs. `note_id`, the timestamps and the
  caption are stable — key off `note_id`, not the URL.
* `caption` is the note title as rendered on the card, which XHS may clip; pass
  `{ preferStateTitle: true }` to prefer the full title from the embedded state.

Rows are sorted newest-first and renumbered, matching `PLAN.md`'s samples.

---

## What was verified

### Verified against live logged-in accounts (2026-10-10)

**Weibo, uid 7435186337 (`@寻美象山`).** The feed returned, for a `2026-09-30` window:

```
1,https://weibo.com/7435186337/RkvSCaGly,"近日，受台风""白海豚""影响，…http://t.cn/AXWaR9da",2026-09-30 16:54:39,2026-09-30 08:54:39,no,,,,
2,https://weibo.com/7435186337/RkvMvj9eJ,"…http://t.cn/AXWaQoLH",2026-09-30 16:39:36,2026-09-30 08:39:36,no,,,,
```

That is `PLAN.md`'s two sample rows character for character — same `mblogid`s, same
seconds, same quote doubling, same full three paragraphs. Two `isLongText` posts were
completed via the longtext endpoint (`longTextFetched: 2`); the feed reports
`total: 757`. A `2026-09-29` window returned 51 rows including reposts, with
`original_author: 象山发布`, a resolved `original_link`, and the original's own content.

**XHS via the hydrated `rednote.com` profile.** 36 of 36 cards parsed, 36 anchors
de-duplicated, and row 1 was `PLAN.md`'s row 1: note id `6abccdd5000000001800471b`,
`2026-09-30 16:52:37`, the same clipped caption, and a `link_as_scraped` of the exact
`rednote.com/user/profile/…/<noteid>?xsec_token=…&xsec_source=pc_user` shape.
`fromState: 0` confirms the dates came from the ObjectID decode, not the page state.

### Verified mechanically

* `npm test` — 37 tests: 26 for `scrape.js`, 11 for the generated builds
  (`test/split.test.js`). Golden CSV comparisons against `PLAN.md`'s rows for **both** the
  DOM path and the Weibo API path, per file; date parsing; range boundaries incl. leap
  February; repost mapping; long-text completion; de-duplication; the pre-hydration warning;
  the browser-vs-CommonJS wrapper branch; build freshness; and "the XHS build contains no
  Weibo identifiers, and vice versa".
* `npm run test:browser` — 22 checks running **each of the three files** in real headless
  Chrome 154 from a real `weibo.com` / `www.xiaohongshu.com` origin, exercising the
  paste-and-auto-run path (the Weibo split also gets its feed-404 → DOM fallback).
* `npm run check:live` — re-runs the XHS scraper against the live page, so a redesign is
  one command to detect.

### Verified negatives worth knowing

* **Both sites now require a session.** Measured: `weibo.com/<uid>` → passport redirect;
  `weibo.cn/<uid>` → passport signin; `m.weibo.cn/u/<uid>` → visitor.passport;
  `/ajax/statuses/mymblog` → HTTP 403; the public hot feed also redirects to signin.
  XHS serves a profile page anonymously but strips the note ids (above), and note pages
  (`/explore/<id>`) fail with *当前笔记暂时无法浏览*.
* **XHS shows no dates in the DOM** (0 timestamp elements across 30 live cards), and
  ships 30 blank `noteCard.noteId` values pre-hydration.

### Still not verified

* The Weibo **DOM** path's fidelity on the modern markup — it finds the right containers
  and post links, but content/time extraction there has not been checked field-by-field
  against expected output, because the API path makes it moot. Treat `mode:'dom'` as the
  fallback it is.
* Long unattended runs: throttling behaviour over dozens of pages, and `autoLoad` on a
  very long XHS timeline.

---

## Locked-down laptop checklist

* **"allow pasting"** — Chrome/Edge block pasting into the console until you type
  `allow pasting` (or `enable pasting` on some builds). Once per profile.
* **DevTools disabled by policy** — if `Cmd+Shift+J` does nothing, this cannot run; there
  is no workaround. Check first.
* **Clipboard blocked** — if the "CSV copied to clipboard" line does not appear, use
  `copy(__xwsCsv)`, `saveCsv()`, or right-click the logged string → *Copy string contents*.
* **Downloads blocked** — `saveCsv()` uses a blob download, which some DLP setups block;
  the console and clipboard routes still work.
* **Huge CSV** — the console collapses very long strings, but *Copy string contents* still
  returns all of it. Prefer `copy()`.
* **Browser** — verified on Chrome 154; plain ES2017-era syntax, so any Chrome/Edge from
  ~2020 on will run it. No build step.

A better "deploy" than pasting every time: **Sources → Snippets → New snippet** in
DevTools. Paste `scrape.js` once, `Cmd+S`, and it lives in the browser profile; afterwards
it is select-and-`Cmd+Enter`. Nothing installed, no policy change.

---

## Files

```
scrape.js                 the deliverable — paste this into the console (both sites)
scrape-weibo.generated.js build output: Weibo-only — paste on weibo.com (do not edit)
scrape-xhs.generated.js   build output: XHS/RedNote-only — paste on a profile (do not edit)
USAGE.md                  every flag, entry point, stat and troubleshooting step
README.md                 this file
package.json              dev-only (jsdom); NOT needed on the machine you scrape from
test/scrape.test.js       26 tests, incl. golden CSV vs PLAN.md for both paths
test/split.test.js        11 tests on the generated builds: same golden rows, the
                          browser-vs-CommonJS wrapper branch, build freshness, and
                          "no other site leaked in"
test/fixtures/            representative Weibo / XHS pages, incl. a live-captured
                          pre-hydration XHS page
test/browser-check.sh     npm run test:browser — real headless Chrome end-to-end,
                          all three files
test/live-check.js        npm run check:live — run the scraper over the LIVE XHS page
test/make-harness.js      dev helper: fixture + a scraper file -> runnable page
tools/build-split.js      npm run build — scrape.js -> the two generated files
tools/cdp.js              drive a debug-enabled Chrome (no npm deps); see below
tools/probe.js            naming-agnostic feed probe, run inside a page to find
                          a site's real post markup after a redesign
```

## Debugging against a live logged-in page

When a site changes its markup, guessing is expensive — drive a real browser instead.
`tools/cdp.js` talks to Chrome over the DevTools Protocol using Node's built-in
WebSocket (no dependencies), and `tools/probe.js` finds the feed *structurally* — the
repeated ancestor containing both a link and a timestamp — so hashed, per-deploy class
names (`_contentItem_med4d_29`) don't matter.

```sh
# Chrome refuses --remote-debugging-port on the DEFAULT profile (136+ hardening), so
# point --user-data-dir at a copy of the profile's Local State + Default/Cookies:
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --user-data-dir=/tmp/cprof --remote-debugging-port=9222 \
  "https://weibo.com/<uid>" &

node tools/cdp.js list                                   # open tabs
node tools/cdp.js eval "weibo.com" tools/probe.js        # what is the real markup?
node tools/cdp.js eval "weibo.com" scrape.js             # inject the scraper
node tools/cdp.js eval "weibo.com" <(echo 'scrape({})')  # run it
```

## Development

```sh
npm install            # jsdom, dev machine only
npm run build          # scrape.js -> scrape-weibo.generated.js + scrape-xhs.generated.js
npm run build:check    # are the checked-in generated files up to date? (exit 1 if not)
npm test               # 37 tests: scrape.js + both generated builds + build invariants
npm run test:browser   # needs Chrome at /Applications/Google Chrome.app, or set $CHROME
npm run check:live     # fetches a live XHS profile page and reports what matched
node test/live-check.js --file=saved.html   # same, against a capture you made yourself
```

Notes for anyone re-running these:

* Run a single build by hand against a fixture:
  `node test/make-harness.js weibo-profile /tmp/w.html scrape-weibo.generated.js` — the
  optional 4th argument picks the scraper file (default `scrape.js`), then serve the page
  and open it.
* Editing the generated files directly is a dead end: `npm test` fails on stale output.
  Change `scrape.js` for logic, or the per-site template in `tools/build-split.js` for the
  header/wrapper/`COLS`/`SEL`/`run()`/`diagnose()`, then `npm run build`.
* `tools/build-split.js` exits non-zero listing the name of any top-level declaration in
  `scrape.js` it does not recognise — that is the guard against a new block silently
  missing from a site build. Add it to `BLOCKS` (`both` / `weibo` / `xhs` / `template` /
  `drop`).

* `test/browser-check.sh`: this Chrome build does not exit after `--dump-dom` (it lingers
  on background network retries), so the script polls for a complete document and then
  kills the process rather than waiting for exit.
* `check:live` needs a page that still has its notes rendered. XHS throttles repeated hits
  and will start serving a stripped shell (~36 KB instead of ~250 KB); when that happens,
  capture the page in your browser and pass `--file=`.
* To drive a *logged-in* Chrome for debugging, `--remote-debugging-port` is refused on the
  default profile (Chrome 136+ hardening). Launch with a `--user-data-dir` pointing at a
  copy of the profile's `Local State` + `Default/Cookies` instead.

## Known limitations

* **XHS needs the page to have finished loading** — the note id appears in a card's link
  only after hydration; you now get an explicit warning instead of an empty CSV.
* **XHS `xsec_token` rotates**, so URL columns differ between runs. Key off `note_id`.
* **Weibo `maxPages` defaults to 60** (1200 posts). A `stopReason` of `maxPages` in
  `stats` means the window may not have been fully covered — raise it.
* Only the **first level** of a repost chain is reported.
* A post whose date cannot be parsed is skipped (counted in `stats.undated`) unless you
  pass `includeUndated: true`. Pinned Weibo posts often carry no timestamp.
* Weibo `feature: 1` is 原创 only; `feature: 0` (the default) includes reposts.
