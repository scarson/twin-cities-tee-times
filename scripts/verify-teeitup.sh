#!/usr/bin/env bash
# ABOUTME: Verify TeeItUp facility IDs by calling the Kenna backend.
# ABOUTME: Usage: bash scripts/verify-teeitup.sh <alias> <facilityId> [<alias> <facilityId> ...]
set -euo pipefail

DATE="${DATE:-2026-04-25}"
API="https://phx-api-be-east-1b.kenna.io"

# Parse pairs of alias + facilityId
while [ "$#" -ge 2 ]; do
  ALIAS="$1"; FID="$2"; shift 2
  url="$API/v2/tee-times?date=$DATE&facilityIds=$FID"
  body=$(curl -sS --max-time 12 --compressed \
    -H "x-be-alias: $ALIAS" \
    -H "Accept: application/json" \
    -H "Accept-Language: en-US,en;q=0.9" \
    "$url" || echo '{"curl_err":1}')
  summary=$(echo "$body" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  try{ const j=JSON.parse(d);
    if(j.curl_err) return console.log('ERR curl');
    if(j.error) return console.log('ERR '+JSON.stringify(j).slice(0,120));
    if(Array.isArray(j)) return console.log('OK array len='+j.length);
    if(Array.isArray(j.teeTimes)) return console.log('OK teeTimes='+j.teeTimes.length);
    if(Array.isArray(j.data)) return console.log('OK data len='+j.data.length);
    console.log('UNKNOWN '+JSON.stringify(j).slice(0,140));
  } catch(e){ console.log('HTTP_ERR: '+d.slice(0,120)); }
});")
  printf "%-40s facility=%-8s  %s\n" "$ALIAS" "$FID" "$summary"
  sleep 0.3
done
