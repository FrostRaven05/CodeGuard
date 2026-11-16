#!/usr/bin/env bash
set -euo pipefail
# Run after issuing the domain certificate and uploading both Nginx snippets
# to /opt/codeguard/config. Existing public 443 uses ssl_preread routing.
base=/opt/codeguard
stamp=$(date +%Y%m%d%H%M%S)
mkdir -p "$base/backups" "$base/updates" "$base/sites"
cp /etc/nginx/nginx.conf "$base/backups/nginx-$stamp.conf"
if test -f /etc/nginx/conf.d/codeguard.conf; then
    cp /etc/nginx/conf.d/codeguard.conf "$base/backups/codeguard-$stamp.conf"
fi
cat "$base/config/nginx-http.conf" "$base/config/nginx-https.conf" > /etc/nginx/conf.d/codeguard.conf
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/nginx/nginx.conf')
text = p.read_text()
entry = '        codereview.frostraven05.com 127.0.0.1:8444;'
if entry not in text:
    marker = '    map $ssl_preread_server_name $tls_backend {'
    if text.count(marker) != 1:
        raise SystemExit('Expected existing SNI map; inspect configuration before proceeding')
    p.write_text(text.replace(marker, marker + '\n' + entry))
PY
if ! nginx -t; then
    cp "$base/backups/nginx-$stamp.conf" /etc/nginx/nginx.conf
    cp "$base/backups/codeguard-$stamp.conf" /etc/nginx/conf.d/codeguard.conf
    exit 1
fi
systemctl reload nginx
cat > /etc/systemd/system/codeguard-cert-renew.service <<'EOF'
[Unit]
Description=Renew CodeGuard HTTPS certificate
[Service]
Type=oneshot
ExecStart=/opt/praxis-certbot/bin/certbot renew --cert-name codereview.frostraven05.com --quiet --deploy-hook "/usr/sbin/nginx -s reload"
EOF
cat > /etc/systemd/system/codeguard-cert-renew.timer <<'EOF'
[Unit]
Description=Check CodeGuard certificate twice daily
[Timer]
OnCalendar=*-*-* 03,15:15:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now codeguard-cert-renew.timer
curl --fail --silent --show-error https://codereview.frostraven05.com/healthz
