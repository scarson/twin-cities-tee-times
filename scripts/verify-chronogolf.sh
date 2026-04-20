#!/usr/bin/env bash
# ABOUTME: Verify Chronogolf course UUIDs via curl (avoids Node's undici TLS fingerprint 403).
# ABOUTME: Input: scripts/.chrono-discovery.json. Output: per-course status + tee time count.
set -euo pipefail
DATA="${1:-scripts/.chrono-discovery.json}"
DATE="${2:-2026-04-25}"

node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$DATA','utf8'));
for (const r of data) {
  if (r.error) { console.log('SKIP|' + r.slug + '|err=' + r.error); continue; }
  for (const c of r.courses) {
    console.log('TEST|' + r.slug + '|' + c.name + '|' + c.holes + '|' + JSON.stringify(c.bookableHoles) + '|' + c.uuid);
  }
}
" | while IFS='|' read -r tag slug name holes bookable uuid; do
  if [ "$tag" = "SKIP" ]; then
    echo "SKIP  $slug — $name"
    continue
  fi
  url="https://www.chronogolf.com/marketplace/v2/teetimes?start_date=$DATE&course_ids=$uuid&holes=9,18&start_time=00:00&page=1"
  body=$(curl -sS --max-time 12 --compressed -H "Accept: application/json" "$url" || echo '{"curl_error":1}')
  count=$(echo "$body" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const j=JSON.parse(d); if(j.curl_error) return console.log('ERR'); console.log('status='+j.status+',tt='+(j.teetimes?.length??'?'));}catch(e){console.log('HTTP_ERR:'+d.slice(0,80));}});")
  printf "%-4s  %-42s  %-26s  [%sh, bookable=%s]  %s\n" "OK" "$slug" "$name" "$holes" "$bookable" "$count"
  sleep 0.4
done
