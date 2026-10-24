# USAGE — every flag, both sites

This is the reference for actually running the scraper. For *why* it is built this way
(and what has been verified against live accounts), see `README.md`.

Everything here runs in the browser's DevTools console. No install, no Node, no extension.

---

## 1. Which file do I paste?

| file | paste it on | covers |
|---|---|---|
| `scrape.js` | either site | both, auto-detected from the hostname |
| `scrape-weibo.generated.js` | `weibo.com/<uid>` | Weibo only — JSON feed, DOM fallback |
| `scrape-xhs.generated.js` | `xiaohongshu.com/user/profile/<uid>` or `rednote.com` | XHS only — rendered cards |

The two `*.generated.js` files are **built from `scrape.js`** (`npm run build`) — don't edit
them. All three expose the same console API, so everything below applies to whichever you
paste; the per-flag tables note where a flag is site-specific.

---

## 2. Quick start

1. Log in, then open the account page you want: `weibo.com/<uid>` or
   `xiaohongshu.com/user/profile/<uid>`.
2. Open DevTools → **Console** (`Cmd/Ctrl+Shift+J`).
3. Paste the whole file, press Enter. That only defines the API and prints a one-line
   ready hint — nothing is scraped yet.

Chrome/Edge block the first paste with a self-XSS warning — type `allow pasting` and press
Enter, then paste. (Once per browser profile.)

Then run the call you want:

```js
scrape()                                         // last month, one post URL per line
scrape({ month: '2026-07' })                     // a whole calendar month
scrape({ month: '2026-07', fields: ['link', 'posted_at_utc+08'] })
scrape({ month: '2026-07', moreInfo: true })     // the full table
```

Each run prints the CSV, copies it to the clipboard, and replaces `$_` / `__xwsCsv`.

Better than pasting every time: DevTools → **Sources → Snippets → New snippet**, paste once,
`Cmd+S`, then it is select-and-`Cmd+Enter` forever. Nothing is installed.

---

## 3. `scrape(options)` — all options

All are optional. `scrape()` with no arguments = **the previous calendar month** (UTC+8), whole
feed/card list, as a one-column CSV of post URLs. `{ moreInfo: true }` gives the full table
and `{ fields: [...] }` gives exactly the columns you ask for.

| option | type / default | site | what it does |
|---|---|---|---|
| `month` | `'YYYY-MM'` string — the previous month (UTC+8) | both | The whole-month shorthand: sets `start` to the 1st 00:00:00.000 and `end` to that month's last day 23:59:59.999. Same as `{start: '<month>', end: '<month>'}`; combining it with `start`/`end`/`days` throws. `'2026-7'` is normalised to `'2026-07'`. |
| `start` | string, ms, `Date` — unset | both | Start of the window. `'2026-07'`, `'2026-07-01'`, `'2026-07-01 09:30'`, or ISO. A bare date/month is read in **UTC+8**; a month means the 1st, 00:00:00.000. |
| `end` | string, ms, `Date` — unset | both | End of the window. A bare month means the **last day** of that month, 23:59:59.999 (leap-February aware). Unset = "up to now". |
| `days` | number — unset | both | Rolling window ending now. Ignored as soon as `start` or `end` is given, and useless with `month`. |
| `includeUndated` | boolean — `false` | both | Keep posts whose date can't be parsed instead of dropping them. Weibo pinned posts typically have no timestamp, so they appear here. |
| `site` | `'weibo'` \| `'xhs'` — auto | `scrape.js` only | Force the site when hostname detection fails (e.g. a proxied origin). The site builds don't need it. |
| `mode` | `'dom'` — API otherwise | Weibo | `'dom'` reads the rendered page instead of the JSON feed. Slower fidelity: minute-precision times, long posts truncated behind 展开. |
| `uid` | string — from the URL | Weibo | Numeric account id. Only needed when the tab's URL is not a profile (`/u/<uid>` or `/<uid>` is parsed automatically). |
| `feature` | `0` \| `1` — `0` | Weibo (feed) | `0` = everything including reposts; `1` = 原创 only. Only affects what the feed returns, so it also changes which posts exist at all. |
| `maxPages` | number — `60` | Weibo (feed) | Page cap, 20 posts per page = 1200 posts. Raise it for very chatty accounts and check `stats.stopReason`. |
| `longText` | boolean — `true` | Weibo (feed) | Fetch the full body of `isLongText` posts via `/ajax/statuses/longtext`. `false` skips those requests and keeps the clipped `text_raw`. |
| `autoLoad` | boolean — `false` | XHS, Weibo `mode:'dom'` | Scroll to the bottom repeatedly until no new cards/posts appear, then scrape. No effect on the Weibo feed path (it pages server-side). |
| `waitMs` | number — `1500` | with `autoLoad` | Pause after each scroll, waiting for cards to render. |
| `maxScrolls` | number — `80` | with `autoLoad` | Hard cap on scrolls. |
| `maxIdle` | number — `4` | with `autoLoad` | Give up after this many scrolls in a row add nothing. |
| `enrich` | boolean — `true` | XHS | Read the page's embedded `__INITIAL_STATE__` for titles, tokens and state timestamps. `false` = DOM only. |
| `preferStateTitle` | boolean — `false` | XHS | Prefer the full title from the page state over the (often clipped) rendered caption. |
| `moreInfo` | boolean — `false` | both | Emit the full table (all columns below) instead of the default one-column URL list. |
| `fields` | array of headings, or a comma-separated string — unset | both | Emit exactly these columns, in the order given: `scrape({ fields: ['link', 'posted_at_utc+08'] })` → `link,posted_at_utc+08`. Allowed headings are the full table's columns for the site; an unknown one throws and the message lists them all (see below). Beats `moreInfo`. |

Only the *output* narrows with `moreInfo`/`fields`: `$_.rows` always carries every field.
The emitted columns are returned as `$_.fields`, and the URLs as `$_.links`.

Allowed `fields` headings, per site (the full table's columns):

```
weibo  no, link, content, posted_at_utc+08, posted_at_utc, is_repost,
       original_posted_at, original_author, original_link, original_content
xhs    no, note_id, posted_at_utc+08, posted_at_utc, caption, link, link_alt,
       link_as_scraped
```

A heading the site does not have throws — with the whole list in the message — and it
throws *before* any request is made, so a typo costs nothing:

```
xhs-weibo-scraper / [weibo-scraper] / [xhs-scraper]: unknown heading(s): posted_at.
Allowed headings on weibo: no, link, content, posted_at_utc+08, posted_at_utc,
is_repost, original_posted_at, original_author, original_link, original_content.
```

Anything unparseable in `start`/`end` throws rather than silently widening the window:

```
xhs-weibo-scraper / [weibo-scraper] / [xhs-scraper]: cannot parse date "july"
(use 2026-09, 2026-09-30 or 2026-09-30 16:00)
```

### Windows you are likely to want

```js
scrape()                                       // last month (the default)
scrape({ month: '2026-07' })                   // all of July (1st 00:00 → 31st 23:59:59.999, UTC+8)
scrape({ month: '2026-07', fields: ['link', 'posted_at_utc+08'] })
scrape({ start: '2026-07-15', end: '2026-07-15' })  // one day
scrape({ days: 7 })                            // the last week
scrape({ start: '2026-01' })                   // January 1st onward, up to now
scrape({ end: '2026-06' })                     // everything up to the end of June
```

A month boundary is snapped, not guessed: `{ month: '2026-07' }` — and the identical
`{start:'2026-07', end:'2026-07'}` — resolves to `2026-07-01 00:00:00 … 2026-07-31
23:59:59` in UTC+8 (`2026-06-30 16:00:00 … 2026-07-31 15:59:59` in UTC). The resolved
window is always printed with the result, along with the month it came from.

---

## 4. Site-specific recipes

```js
// Weibo: original posts only (no reposts)
scrape({ start: '2026-07', end: '2026-07', feature: 1 })

// Weibo: a big account — make sure the page cap is not the thing that stopped you
scrape({ start: '2026-01', end: '2026-07', maxPages: 200 })
// then look at $_.stats.stopReason

// Weibo: fastest possible run, no extra requests for long posts
scrape({ start: '2026-07', end: '2026-07', longText: false })

// Weibo: read what the page shows, not the feed (fallback / comparison)
scrape({ start: '2026-07', end: '2026-07', mode: 'dom' })

// Weibo: the tab is not on the profile URL
scrape({ uid: '7435186337', start: '2026-07', end: '2026-07' })

// XHS: pull in everything scrollable first, then keep July
scrape({ start: '2026-07', end: '2026-07', autoLoad: true })

// XHS: full titles instead of the clipped card caption
scrape({ start: '2026-07', end: '2026-07', preferStateTitle: true })

// Either site: keep the undated leftovers (Weibo pinned posts)
scrape({ start: '2026-07', end: '2026-07', includeUndated: true })

// Either site: one month, straight up
scrape({ month: '2026-07' })

// Either site: just links + dates — this is the "truncated CSV" case
scrape({ start: '2026-07', end: '2026-07', fields: ['link', 'posted_at_utc+08'] })
// -> header is exactly `link,posted_at_utc+08`; $_.fields echoes the selection

// Either site: the full table
scrape({ start: '2026-07', end: '2026-07', moreInfo: true })
```

---

## 5. Console entry points

| call | what you get |
|---|---|
| `scrape(opts)` | runs it, prints the CSV, copies it, returns the result object (a Promise of it on the Weibo feed path) |
| `$_` | the last result — **a Promise on the Weibo feed path** (the feed is fetched async), the result object otherwise. `await $_` if unsure |
| `$_.rows` | array of row objects, newest first |
| `$_.csv` | the CSV string |
| `$_.links` | array of post URLs — one per row, whatever the output shape |
| `$_.fields` | the column headings that were emitted (`['link']` by default) |
| `$_.moreInfo` | `true` when the full table was emitted |
| `$_.stats` | the counters in §6 |
| `$_.range` | the resolved `{startMs, endMs, tz}` window |
| `$_.mode` | `'api'` on the Weibo feed path; absent when the page was read instead |
| `__xwsCsv` | the last CSV string, stashed on `window` |
| `__xwsResult` | the last result object |
| `copy(__xwsCsv)` | re-copy the CSV (DevTools `copy()` — the reliable clipboard route) |
| `saveCsv(__xwsCsv)` | download it as a `.csv` (UTF-8 BOM, Excel-safe) |
| `saveCsv(__xwsCsv, 'july.csv')` | same, with your filename |
| `diagnose()` | per-selector match counts + a sample of the first item; see §7 |
| `weiboApiScrape(opts)` | Weibo builds only: the feed path alone, no DOM fallback |

`saveCsv()` with **no arguments** writes the string `"undefined"` into the file — pass
`__xwsCsv` (or the result's `csv`) explicitly.

Namespace handles, if you want to call into the module directly:
`xhsWeiboScraper` (`scrape.js`), `weiboScraper`, `xhsScraper`.

---

## 6. Reading `stats`

Weibo feed path (`mode: 'api'`, the default there):

| counter | meaning |
|---|---|
| `pages` | feed pages fetched |
| `items` | raw feed items seen |
| `reposts` | rows kept that are reposts |
| `longTextFetched` | long posts completed via the longtext endpoint |
| `duplicateItems` | repeat items de-duplicated |
| `undated` | items whose `created_at` did not parse (skipped unless `includeUndated`) |
| `outOfRange` | items outside the window (normal — the feed pages past it) |
| `stopReason` | **why it stopped**: `reachedStart` (walked past your start — complete), `empty` (feed exhausted), `repeatedPage` (feed re-served a page), `maxPages` (**hit the cap — the window may be incomplete, raise `maxPages`**) |

Reading paths (Weibo `mode:'dom'` and XHS):

| counter | meaning |
|---|---|
| `anchors` | candidate anchors on the page |
| `claimed` (Weibo) / `seen` (XHS) | records resolved |
| `duplicate` | extra anchors folded into an existing record |
| `noContainer` (Weibo) | anchors with no item container found |
| `undated` | records with no obtainable date |
| `outOfRange` | records outside the window |
| `fromState` (XHS) | dates recovered from page state / DOM instead of the note id |

XHS results also carry `cardCount` (cards in the DOM) and, when something is wrong, a
`warning` string that is also printed in red.

---

## 7. When it comes back empty or wrong

**Run `diagnose()` first.** It reports, per selector, how many matches there were plus a
2 KB sample of the first item — that is the difference between "the site changed" and "you
are on the wrong page".

| symptom | cause | fix |
|---|---|---|
| nothing happens on paste; console warns about pasting | Chrome/Edge self-XSS guard | type `allow pasting`, Enter, paste again |
| `Not on a recognised … page` | not a profile page (`scrape.js` guessing) | `scrape({ site: 'weibo' })` or open the profile |
| Weibo: 0 rows, then a fallback warning | feed unavailable (logged out, endpoint changed) or window empty | check `$_.stats`; try `mode:'dom'`; make sure you are logged in |
| Weibo: feed request 403 | not logged in, or `/ajax` blocked | log in in that tab and re-run |
| Weibo: times look minute-precision, text ends mid-sentence | the DOM path ran (`$_.mode` is absent) | that is the fallback; the feed is the accurate source |
| XHS: `found N note cards but 0 note links` | page not hydrated yet | wait a second / scroll a little, re-run `scrape()` |
| XHS: 0 rows, 0 cards | wrong page or markup moved | `diagnose()` |
| CSV prints but clipboard line is missing | clipboard blocked by policy | `copy(__xwsCsv)`, or right-click the logged string → *Copy string contents* |
| `saveCsv` does nothing | blob downloads blocked by DLP | use the clipboard routes above |
| DevTools never opens | disabled by policy | no workaround; this cannot run there |
| `cannot parse date …` | typo in `start`/`end` | use `2026-07`, `2026-07-01`, or `2026-07-01 09:30` |
| `unknown heading(s): …` | `fields` names a column this site does not have | the message lists every allowed heading — copy from it. `moreInfo: true` gets the full table |
| "the generated split files are stale" (dev only) | `scrape.js` changed | `npm run build` |

Timezone note: both sites display UTC+8 and every date flag is interpreted in UTC+8. Two
timestamp columns are emitted — `posted_at_utc+08` (what the site shows) and
`posted_at_utc` (the same instant in UTC) — so downstream tooling never has to guess.

---

## 8. Building and testing (dev machine only)

None of this is needed to *use* the scraper.

```sh
npm install            # jsdom, dev only
npm run build          # scrape.js -> scrape-weibo.generated.js + scrape-xhs.generated.js
npm run build:check    # verify the checked-in split files match scrape.js
npm test               # 37 tests: scrape.js + both split builds + build invariants
npm run test:browser   # all three files in real headless Chrome
npm run check:live     # re-run the XHS scraper against the live page
```

`npm run build` fails, on purpose, if `scrape.js` grows a top-level declaration the splitter
has not been told about — add it to `BLOCKS` in `tools/build-split.js` (`both`, `weibo`,
`xhs`, `template` or `drop`). `npm test` fails if the generated files were not rebuilt.

Publishing a release: push a `v*` tag — `.github/workflows/release.yml` re-checks all of the
above and attaches the three files to the release. Steps and download URLs are in
`README.md` → Releasing.
