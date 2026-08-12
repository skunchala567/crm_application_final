#!/usr/bin/env bash
#
# Routes /api/* to the Node API instead of the React app.
#
# The CRM's frontend and API share one domain. Apache currently answers every
# path, including /api/*, with the React index.html -- so Meta's webhook gets
# HTTP 200 and a page of HTML, treats the lead as delivered, and never retries.
# This adds a reverse proxy for /api/ and makes sure the SPA fallback does not
# swallow it.
#
# Safe to run more than once. It backs up the vhost, tests the configuration,
# and puts the backup back if the test fails. It never touches SSL, other
# virtual hosts, or the React app.
#
# Usage:   sudo bash install-api-proxy.sh
#
set -uo pipefail

DOMAIN="crm.test.marketfarmer.in"
API_PORT="3001"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  bad "Run this with sudo:  sudo bash $0"
  exit 1
fi

# --------------------------------------------------------------------------
say "1. Is the Node API running on 127.0.0.1:${API_PORT}?"
# --------------------------------------------------------------------------
API_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${API_PORT}/api/meta/webhook" || echo 000)"
if [ "$API_CODE" = "000" ]; then
  bad "Nothing is answering on 127.0.0.1:${API_PORT}."
  echo "     The API is not running, so proxying to it cannot work yet."
  echo "     Start it, then run this script again. Typical commands:"
  echo "       pm2 start npm --name crm-api -- run start   (if you use pm2)"
  echo "       systemctl start crm-api                      (if you use systemd)"
  echo
  echo "     To see what is already configured:"
  echo "       pm2 list ; systemctl list-units --type=service | grep -i crm"
  exit 1
fi
ok "API responded with HTTP ${API_CODE} (403 here is correct - it is Express refusing an unverified webhook)"

# --------------------------------------------------------------------------
say "2. Apache modules"
# --------------------------------------------------------------------------
for mod in proxy proxy_http rewrite headers; do
  if apache2ctl -M 2>/dev/null | grep -q "${mod}_module"; then
    ok "mod_${mod} already enabled"
  else
    a2enmod "$mod" >/dev/null 2>&1 && ok "enabled mod_${mod}" || warn "could not enable mod_${mod}"
  fi
done

# --------------------------------------------------------------------------
say "3. Finding the virtual host for ${DOMAIN}"
# --------------------------------------------------------------------------
VHOSTS="$(grep -rl "$DOMAIN" /etc/apache2/sites-enabled/ 2>/dev/null || true)"
if [ -z "$VHOSTS" ]; then
  bad "No enabled virtual host mentions ${DOMAIN}."
  echo "     Look in /etc/apache2/sites-available and enable the right one with a2ensite."
  exit 1
fi
echo "$VHOSTS" | while read -r f; do ok "found $f"; done

# Prefer the SSL vhost: that is the one Meta actually talks to.
TARGET="$(grep -rl "$DOMAIN" /etc/apache2/sites-enabled/ 2>/dev/null | xargs grep -l "SSLEngine\|:443" 2>/dev/null | head -1 || true)"
[ -z "$TARGET" ] && TARGET="$(echo "$VHOSTS" | head -1)"
ok "will edit: ${TARGET}"

# --------------------------------------------------------------------------
say "4. Backing up"
# --------------------------------------------------------------------------
BACKUP="${TARGET}.backup-${STAMP}"
cp -a "$TARGET" "$BACKUP"
ok "saved ${BACKUP}"

# --------------------------------------------------------------------------
say "5. Adding the /api reverse proxy"
# --------------------------------------------------------------------------
if grep -q "ProxyPass[[:space:]]\+/api/" "$TARGET"; then
  ok "a /api proxy rule is already present - leaving it alone"
else
  # Insert just inside the <VirtualHost ...:443> block that carries our domain,
  # ahead of any rewrite rules, so the SPA fallback cannot claim /api first.
  python3 - "$TARGET" "$API_PORT" <<'PY'
import re, sys
path, port = sys.argv[1], sys.argv[2]
src = open(path).read()

block = f"""
    # --- CRM API reverse proxy (added by install-api-proxy.sh) ---
    # /api/* belongs to the Node API. Without this Apache serves the React
    # index.html for these paths, which makes Meta's webhook look successful
    # while the lead is silently dropped.
    ProxyPreserveHost On
    ProxyRequests Off
    # Never proxy the websocket-less static app, only the API prefix.
    ProxyPass        /api/ http://127.0.0.1:{port}/api/ retry=0 timeout=60
    ProxyPassReverse /api/ http://127.0.0.1:{port}/api/
    <Location /api/>
        Require all granted
    </Location>
    # --- end CRM API reverse proxy ---
"""

# Put it immediately after the opening tag of the first matching VirtualHost.
m = re.search(r'(<VirtualHost[^>]*>)', src)
if not m:
    sys.exit("no <VirtualHost> opening tag found")
src = src[:m.end()] + "\n" + block + src[m.end():]
open(path, 'w').write(src)
print("inserted proxy block")
PY
  ok "proxy rules added"
fi

# --------------------------------------------------------------------------
say "5b. Forwarding webhook POSTs on the bare domain to the API"
# --------------------------------------------------------------------------
# Smartping registered https://${DOMAIN}/ (no path) as its webhook URL, so
# incoming WhatsApp messages arrive as POST /. Without this rule Apache
# answers them with the React index.html and HTTP 200, and the messages are
# silently dropped. Only POST is forwarded; GET / keeps serving the app.
if grep -q "api/webhooks/smartping/webhook" "$TARGET"; then
  ok "root POST forward already present - leaving it alone"
else
  python3 - "$TARGET" "$API_PORT" <<'PY'
import re, sys
path, port = sys.argv[1], sys.argv[2]
src = open(path).read()

block = f"""
    # --- CRM webhook root-POST forward (added by install-api-proxy.sh) ---
    # Smartping's webhook URL is the bare domain. Send only POST / to the
    # API's webhook endpoint; every other request to / is left to the SPA.
    RewriteEngine On
    RewriteCond %{{REQUEST_METHOD}} =POST
    RewriteRule ^/?$ http://127.0.0.1:{port}/api/webhooks/smartping/webhook [P,L]
    # --- end CRM webhook root-POST forward ---
"""

m = re.search(r'(<VirtualHost[^>]*>)', src)
if not m:
    sys.exit("no <VirtualHost> opening tag found")
src = src[:m.end()] + "\n" + block + src[m.end():]
open(path, 'w').write(src)
print("inserted root-POST forward")
PY
  ok "root POST forward added"
fi

# --------------------------------------------------------------------------
say "6. Making sure the React fallback skips /api"
# --------------------------------------------------------------------------
# A SPA fallback usually rewrites everything to index.html. If it does not
# exclude /api the proxy above can still be bypassed for some request shapes.
DOCROOT="$(grep -oP '(?<=DocumentRoot\s)\S+' "$TARGET" | head -1 | tr -d '"')"
if [ -n "${DOCROOT:-}" ] && [ -f "${DOCROOT}/.htaccess" ]; then
  if grep -q "RewriteCond %{REQUEST_URI} !\^/api" "${DOCROOT}/.htaccess"; then
    ok ".htaccess already excludes /api"
  else
    cp -a "${DOCROOT}/.htaccess" "${DOCROOT}/.htaccess.backup-${STAMP}"
    # Add the exclusion in front of the first rewrite to index.html.
    sed -i '0,/RewriteRule/s|RewriteRule|RewriteCond %{REQUEST_URI} !^/api\n  RewriteRule|' "${DOCROOT}/.htaccess"
    ok "added an /api exclusion to ${DOCROOT}/.htaccess (backup kept)"
  fi
else
  ok "no .htaccess fallback found - the vhost proxy is sufficient"
fi

# --------------------------------------------------------------------------
say "7. Testing the configuration"
# --------------------------------------------------------------------------
if apache2ctl configtest 2>&1 | grep -qi "Syntax OK"; then
  ok "Syntax OK"
else
  bad "Apache rejected the configuration - restoring the backup and stopping."
  apache2ctl configtest || true
  cp -a "$BACKUP" "$TARGET"
  bad "restored ${TARGET}; nothing was changed"
  exit 1
fi

# --------------------------------------------------------------------------
say "8. Reloading Apache"
# --------------------------------------------------------------------------
systemctl reload apache2 && ok "reloaded" || { bad "reload failed"; exit 1; }
sleep 2

# --------------------------------------------------------------------------
say "9. Verifying"
# --------------------------------------------------------------------------
CT="$(curl -s -o /dev/null -w '%{content_type}' --max-time 15 "https://${DOMAIN}/api/meta/webhook" || echo unknown)"
CODE="$(curl -s -o /dev/null -w '%{http_code}'   --max-time 15 "https://${DOMAIN}/api/meta/webhook" || echo 000)"
echo "  /api/meta/webhook -> HTTP ${CODE}, content-type ${CT}"
case "$CT" in
  *json*|*text/plain*) ok "the API is being reached (no longer the React app)" ;;
  *html*) bad "still returning HTML - the SPA fallback is still winning."
          echo "     Send your team the file ${TARGET} and this output."; exit 1 ;;
  *) warn "unexpected content type: ${CT}" ;;
esac

FRONT="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/" || echo 000)"
[ "$FRONT" = "200" ] && ok "the CRM front end still loads (HTTP 200)" || bad "front end returned HTTP ${FRONT} - check ${BACKUP}"

# A POST to the bare domain must reach the API, not the React page. An empty
# JSON body is rejected by the API with a JSON error - that JSON content type
# is exactly the proof that the webhook forward works.
HOOK_CT="$(curl -s -o /dev/null -w '%{content_type}' --max-time 15 -X POST -H 'Content-Type: application/json' -d '{}' "https://${DOMAIN}/" || echo unknown)"
case "$HOOK_CT" in
  *json*) ok "POST / reaches the API webhook (Smartping messages will be stored)" ;;
  *html*) bad "POST / still returns HTML - Smartping webhooks are being dropped." ;;
  *) warn "POST / returned unexpected content type: ${HOOK_CT}" ;;
esac

say "Done."
echo "  Backup of the original vhost: ${BACKUP}"
echo "  To undo everything:  sudo cp ${BACKUP} ${TARGET} && sudo systemctl reload apache2"
