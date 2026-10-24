#!/usr/bin/env bash
#
# Dev-only end-to-end check: run scrape.js in a real Chrome (headless) against
# the fixtures, on a real weibo.com / xiaohongshu.com origin, and assert that the
# auto-run-on-load path prints the CSV that PLAN.md specifies.
#
# This is the closest thing to "paste it in the console" that can be automated.
# It is NOT part of the deliverable: the machine you scrape from needs nothing
# but its browser.
#
set -uo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  echo "SKIP: Chrome not found at $CHROME (set CHROME=/path/to/chrome)"; exit 0
fi

PORT=8137
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null' EXIT

node make-harness.js weibo-profile "$TMP/weibo.html" scrape.js 'window.__full = scrape({ linksOnly: false });' >/dev/null
node make-harness.js xhs-profile "$TMP/xhs.html" scrape.js 'window.__full = scrape({ linksOnly: false });' >/dev/null

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$TMP" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/weibo.html" -o /dev/null && break
  sleep 0.25
done

run_page() { # url outfile profile
  # NOTE: this Chrome build does not exit after --dump-dom (it sits on
  # background network retries), so poll for a complete document and kill it.
  rm -f "$2"
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --disable-extensions --disable-background-networking --disable-component-update \
    --disable-sync --no-pings --disable-breakpad --metrics-recording-only \
    --user-data-dir="$3" \
    --host-resolver-rules="MAP weibo.com 127.0.0.1:$PORT, MAP www.xiaohongshu.com 127.0.0.1:$PORT" \
    --virtual-time-budget=6000 --dump-dom "$1" > "$2" 2>/dev/null &
  local pid=$! i=0
  while [ "$i" -lt 45 ]; do
    grep -q '</html>' "$2" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 1; i=$((i + 1))
  done
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  return 0
}

FAILED=0
check() { # <needle> <file> <label>
  if grep -qF -- "$1" "$2"; then
    printf '  PASS  %s\n' "$3"
  else
    printf '  FAIL  %s\n' "$3"; FAILED=1
  fi
}

checkre() { # <extended-regex> <file> <label>
  if grep -qE -- "$1" "$2"; then
    printf '  PASS  %s\n' "$3"
  else
    printf '  FAIL  %s\n' "$3"; FAILED=1
  fi
}

# --dump-dom serialises the scraped string as HTML, so undo the entity escaping
# before asserting on the CSV text.
norm() { sed -e 's/&amp;/\&/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e "s/&#39;/'/g" "$1" > "$2"; }

echo "== real Chrome: weibo =="
run_page "http://weibo.com/weibo.html" "$TMP/weibo.dom" "$TMP/p1"
norm "$TMP/weibo.dom" "$TMP/weibo.txt"
# The paste-time auto-run is links-only: one bare URL per row, no other columns.
check 'weibo [links only] — 3 rows in range' "$TMP/weibo.txt" 'auto-run summary says links only'
checkre '^https://weibo\.com/7435186337/RkvSCaGly([^,]|$)' "$TMP/weibo.txt" 'auto-run: row 1 is a bare URL'
checkre '^https://weibo\.com/7435186337/RkAcbd123([^,]|$)' "$TMP/weibo.txt" 'auto-run: the repost is a bare URL too'
# Then the explicit full-table run, on the same page.
check 'no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content' "$TMP/weibo.txt" 'weibo header printed'
check '受台风""白海豚""影响' "$TMP/weibo.txt" 'row 1 printed with PLAN.md quote-doubling'
check '2026-09-30 16:54:39,2026-09-30 08:54:39,no' "$TMP/weibo.txt" 'row 1 timestamps'
check '2026-09-30 16:30:00,2026-09-30 08:30:00,yes,2026-09-30 14:33:20,浙江发布,https://weibo.com/1987654321/RkA000111' "$TMP/weibo.txt" 'repost row with original_* filled in'
check 'weibo — 3 rows in range' "$TMP/weibo.txt" 'summary line: 3 in-range rows (proves hostname detection ran)'
check 'outOfRange=1' "$TMP/weibo.txt" 'the June post was filtered out'
check 'undated=1' "$TMP/weibo.txt" 'the pinned post was skipped'
grep -o '^1,https://weibo.com/7435186337/RkvSCaGly,.\{0,40\}' "$TMP/weibo.txt" | head -1 | sed 's/^/  csv> /'

echo "== real Chrome: xhs =="
run_page "http://www.xiaohongshu.com/xhs.html" "$TMP/xhs.dom" "$TMP/p2"
norm "$TMP/xhs.dom" "$TMP/xhs.txt"
# Auto-run: links only. No commas on the line proves the single column.
check 'xhs [links only] — 2 rows in range' "$TMP/xhs.txt" 'auto-run summary says links only'
checkre '^https://www\.xiaohongshu\.com/explore/6abccdd5000000001800471b\?xsec_token=[^,]*$' "$TMP/xhs.txt" 'auto-run: one canonical URL per row'
check 'no,note_id,posted_at_utc+08,posted_at_utc,caption,link,link_alt,link_as_scraped' "$TMP/xhs.txt" 'xhs header printed'
check '1,6abccdd5000000001800471b,2026-09-30 16:52:37,2026-09-30 08:52:37' "$TMP/xhs.txt" 'row 1 note_id + timestamps'
check 'https://www.xiaohongshu.com/explore/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw%3D&xsec_source=pc_user' "$TMP/xhs.txt" 'link (%3D encoded, as in PLAN.md)'
check 'https://www.rednote.com/discovery/item/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw%3D&xsec_source=pc_user' "$TMP/xhs.txt" 'link_alt (%3D encoded, as in PLAN.md)'
# NOTE: link_as_scraped is deliberately "whatever the page gave us", so it
# keeps the page's own scheme. The harness is served over http://, hence the
# scheme-agnostic match here; `link` and `link_alt` are always canonical https.
check '//www.xiaohongshu.com/explore/6abccdd5000000001800471b?xsec_token=ABsN9_jNWzAPdKD4L_jsZRaBrf2ZuwpAU4IpZL7WFYnVw=&xsec_source=pc_user' "$TMP/xhs.txt" 'link_as_scraped (raw as scraped, token NOT re-encoded as %3D)'
check '2,6abb588c000000001400032d,2026-09-29 14:19:56,2026-09-29 06:19:56,寻美象山 寻美宁波 寻美浙江' "$TMP/xhs.txt" 'row 2'
check 'xhs — 2 rows in range' "$TMP/xhs.txt" 'summary line: 2 in-range rows'
grep -o '^1,6abccdd5000000001800471b,[^<]*' "$TMP/xhs.txt" | head -1 | sed 's/^/  csv> /'

# --- the split builds -------------------------------------------------------
# Same fixtures, same assertions, but each site's own file. The weibo split has
# no feed to talk to on the harness origin (404), so this also exercises its
# API -> DOM fallback in a real browser.
node make-harness.js weibo-profile "$TMP/weibo-split.html" scrape-weibo.generated.js 'window.__full = scrape({ linksOnly: false });' >/dev/null
node make-harness.js xhs-profile "$TMP/xhs-split.html" scrape-xhs.generated.js 'window.__full = scrape({ linksOnly: false });' >/dev/null

echo "== real Chrome: scrape-weibo.generated.js =="
run_page "http://weibo.com/weibo-split.html" "$TMP/weibo-split.dom" "$TMP/p3"
norm "$TMP/weibo-split.dom" "$TMP/weibo-split.txt"
check 'weibo [links only] — 3 rows in range' "$TMP/weibo-split.txt" 'weibo split: auto-run is links only'
checkre '^https://weibo\.com/7435186337/RkvSCaGly([^,]|$)' "$TMP/weibo-split.txt" 'weibo split: auto-run row is a bare URL'
check 'no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content' "$TMP/weibo-split.txt" 'weibo split: header printed'
check '受台风""白海豚""影响' "$TMP/weibo-split.txt" 'weibo split: row 1 with PLAN.md quote-doubling'
check '2026-09-30 16:30:00,2026-09-30 08:30:00,yes,2026-09-30 14:33:20,浙江发布,https://weibo.com/1987654321/RkA000111' "$TMP/weibo-split.txt" 'weibo split: repost row with original_* filled in'
check 'weibo — 3 rows in range' "$TMP/weibo-split.txt" 'weibo split: summary line (feed 404 -> DOM fallback)'
check 'undated=1' "$TMP/weibo-split.txt" 'weibo split: the pinned post was skipped'

echo "== real Chrome: scrape-xhs.generated.js =="
run_page "http://www.xiaohongshu.com/xhs-split.html" "$TMP/xhs-split.dom" "$TMP/p4"
norm "$TMP/xhs-split.dom" "$TMP/xhs-split.txt"
check 'xhs [links only] — 2 rows in range' "$TMP/xhs-split.txt" 'xhs split: auto-run is links only'
checkre '^https://www\.xiaohongshu\.com/explore/6abccdd5000000001800471b\?xsec_token=[^,]*$' "$TMP/xhs-split.txt" 'xhs split: auto-run is one canonical URL per row'
check 'no,note_id,posted_at_utc+08,posted_at_utc,caption,link,link_alt,link_as_scraped' "$TMP/xhs-split.txt" 'xhs split: header printed'
check '1,6abccdd5000000001800471b,2026-09-30 16:52:37,2026-09-30 08:52:37' "$TMP/xhs-split.txt" 'xhs split: row 1 note_id + timestamps'
check 'xhs — 2 rows in range' "$TMP/xhs-split.txt" 'xhs split: summary line'

echo
if [ "$FAILED" -eq 0 ]; then echo "browser check: ALL PASS"; else echo "browser check: FAILURES"; fi
exit "$FAILED"
