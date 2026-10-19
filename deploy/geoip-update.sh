#!/usr/bin/env bash
# Monthly refresh of the DB-IP "IP to City Lite" database that locates sign-in addresses
# (F01B rule 7, ADR 0032; CC BY 4.0, credited on the signed-in devices screen). Installed by
# provision.sh as /usr/local/bin/vertexhub-geoip-update and run by the vertexhub crontab.
#
# Downloads the current month's MMDB (the previous month's while the new one is not out yet) to a
# temporary file next to the target, checks that it opens and answers a lookup, then moves it into
# place. The API reloads it within an hour. A failure leaves the current file untouched.
set -euo pipefail

SITE_DIR=/srv/hub.vertexmedia.pro
TARGET=${1:-$SITE_DIR/shared/geoip/dbip-city-lite.mmdb}
RELEASE=$SITE_DIR/current

dir=$(dirname "$TARGET")
mkdir -p "$dir"
tmp=$(mktemp "$dir/.dbip-city-lite.XXXXXX")
trap 'rm -f "$tmp" "$tmp.gz"' EXIT

downloaded=
for month in "$(date -u +%Y-%m)" "$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y-%m)"; do
  if curl -fsSL --retry 3 --max-time 600 -o "$tmp.gz" \
    "https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz"; then
    downloaded=$month
    break
  fi
done
[ -n "$downloaded" ] || { echo "geoip: download failed" >&2; exit 1; }
gunzip -c "$tmp.gz" >"$tmp"

# The same reader the API uses, from the deployed release.
node -e '
  const { Reader } = require(require.resolve("mmdb-lib", { paths: [process.argv[2] + "/apps/api"] }));
  const reader = new Reader(require("node:fs").readFileSync(process.argv[1]));
  if (!reader.get("8.8.8.8")?.country?.iso_code) throw new Error("lookup failed");
' "$tmp" "$RELEASE"

chmod 640 "$tmp"
mv -f "$tmp" "$TARGET"
echo "geoip: DB-IP City Lite $downloaded installed at $TARGET"
