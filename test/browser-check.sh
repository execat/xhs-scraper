#!/usr/bin/env bash
#
# Dev-only end-to-end check: run scrape.js in a real Chrome (headless) against
# the fixtures, on a real weibo.com / xiaohongshu.com origin, and assert what the
# console prints when you paste the file and then call scrape() yourself.
#
# Pasting no longer scrapes anything, so the harness runs the two calls
# explicitly: the default (post URLs) and scrape({ moreInfo: true }) (the full
# CSV that PLAN.md specifies).
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

BOTH='window.__links = scrape({ month: "2026-09" }); '
BOTH+='window.__picked = scrape({ month: "2026-09", fields: ["link", "posted_at_utc+08"] }); '
BOTH+='window.__full = scrape({ month: "2026-09", moreInfo: true }); '
# The unknown-heading path must print the whole menu: catch and log it.
BOTH+='try { scrape({ fields: ["nope"] }); } catch (e) { console.log(e.message); }'
node make-harness.js weibo-profile "$TMP/weibo.html" scrape.js "$BOTH" >/dev/null
node make-harness.js xhs-profile "$TMP/xhs.html" scrape.js "$BOTH" >/dev/null

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
# The default run is links-only: one bare URL per row, no other columns.
check 'ready. scrape() = post URLs' "$TMP/weibo.txt" 'paste-time hint printed (nothing scraped yet)'
check 'link,posted_at_utc+08' "$TMP/weibo.txt" 'fields: header is exactly the selection'
check 'Allowed headings on weibo: no, link, content' "$TMP/weibo.txt" 'fields: an unknown heading lists every allowed heading'
check 'weibo [links only] — 3 rows in range 2026-09-01 00:00:00 .. 2026-09-30 23:59:59' "$TMP/weibo.txt" 'month:2026-09 resolves to the whole of September'
checkre '^https://weibo\.com/7435186337/RkvSCaGly([^,]|$)' "$TMP/weibo.txt" 'default run: row 1 is a bare URL'
checkre '^https://weibo\.com/7435186337/RkAcbd123([^,]|$)' "$TMP/weibo.txt" 'default run: the repost is a bare URL'
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
# Default run: links only. No commas on the line proves the single column.
check 'ready. scrape() = post URLs' "$TMP/xhs.txt" 'paste-time hint printed (nothing scraped yet)'
check 'link,posted_at_utc+08' "$TMP/xhs.txt" 'fields: header is exactly the selection'
check 'Allowed headings on xhs: no, note_id' "$TMP/xhs.txt" 'fields: an unknown heading lists every allowed heading'
check 'xhs [links only] — 2 rows in range 2026-09-01 00:00:00 .. 2026-09-30 23:59:59' "$TMP/xhs.txt" 'month:2026-09 resolves to the whole of September'
checkre '^https://www\.xiaohongshu\.com/explore/6abccdd5000000001800471b\?xsec_token=[^,]*$' "$TMP/xhs.txt" 'default run: one canonical URL per row'
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
node make-harness.js weibo-profile "$TMP/weibo-split.html" scrape-weibo.generated.js "$BOTH" >/dev/null
node make-harness.js xhs-profile "$TMP/xhs-split.html" scrape-xhs.generated.js "$BOTH" >/dev/null

echo "== real Chrome: scrape-weibo.generated.js =="
run_page "http://weibo.com/weibo-split.html" "$TMP/weibo-split.dom" "$TMP/p3"
norm "$TMP/weibo-split.dom" "$TMP/weibo-split.txt"
check 'ready. scrape() = post URLs' "$TMP/weibo-split.txt" 'weibo split: paste-time hint printed'
check 'link,posted_at_utc+08' "$TMP/weibo-split.txt" 'weibo split: fields header'
check 'Allowed headings on weibo: no, link, content' "$TMP/weibo-split.txt" 'weibo split: unknown heading lists the menu'
check 'weibo [links only] — 3 rows in range' "$TMP/weibo-split.txt" 'weibo split: default run is URLs only'
checkre '^https://weibo\.com/7435186337/RkvSCaGly([^,]|$)' "$TMP/weibo-split.txt" 'weibo split: default run row is a bare URL'
check 'no,link,content,posted_at_utc+08,posted_at_utc,is_repost,original_posted_at,original_author,original_link,original_content' "$TMP/weibo-split.txt" 'weibo split: header printed'
check '受台风""白海豚""影响' "$TMP/weibo-split.txt" 'weibo split: row 1 with PLAN.md quote-doubling'
check '2026-09-30 16:30:00,2026-09-30 08:30:00,yes,2026-09-30 14:33:20,浙江发布,https://weibo.com/1987654321/RkA000111' "$TMP/weibo-split.txt" 'weibo split: repost row with original_* filled in'
check 'weibo — 3 rows in range' "$TMP/weibo-split.txt" 'weibo split: summary line (feed 404 -> DOM fallback)'
check 'undated=1' "$TMP/weibo-split.txt" 'weibo split: the pinned post was skipped'

echo "== real Chrome: scrape-xhs.generated.js =="
run_page "http://www.xiaohongshu.com/xhs-split.html" "$TMP/xhs-split.dom" "$TMP/p4"
norm "$TMP/xhs-split.dom" "$TMP/xhs-split.txt"
check 'ready. scrape() = post URLs' "$TMP/xhs-split.txt" 'xhs split: paste-time hint printed'
check 'link,posted_at_utc+08' "$TMP/xhs-split.txt" 'xhs split: fields header'
check 'Allowed headings on xhs: no, note_id' "$TMP/xhs-split.txt" 'xhs split: unknown heading lists the menu'
check 'xhs [links only] — 2 rows in range' "$TMP/xhs-split.txt" 'xhs split: default run is URLs only'
checkre '^https://www\.xiaohongshu\.com/explore/6abccdd5000000001800471b\?xsec_token=[^,]*$' "$TMP/xhs-split.txt" 'xhs split: default run is one canonical URL per row'
check 'no,note_id,posted_at_utc+08,posted_at_utc,caption,link,link_alt,link_as_scraped' "$TMP/xhs-split.txt" 'xhs split: header printed'
check '1,6abccdd5000000001800471b,2026-09-30 16:52:37,2026-09-30 08:52:37' "$TMP/xhs-split.txt" 'xhs split: row 1 note_id + timestamps'
check 'xhs — 2 rows in range' "$TMP/xhs-split.txt" 'xhs split: summary line'

echo
if [ "$FAILED" -eq 0 ]; then echo "browser check: ALL PASS"; else echo "browser check: FAILURES"; fi
exit "$FAILED"
