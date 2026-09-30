# hub.vertexmedia.pro: Vertex Hub (docs/deployment.md). Installed by deploy/provision.sh as
# /etc/nginx/sites-available/hub.vertexmedia.pro; edit it in the repository, never on the server.
#
# nginx is the only public gateway: the SPA build is served from the current release, /api is
# proxied to the API on loopback, and the licensed Madani font files come from outside the
# repository.

server {
    listen 80;
    listen [::]:80;
    server_name hub.vertexmedia.pro;
    access_log /var/log/nginx/hub.vertexmedia.pro.access.log;
    error_log /var/log/nginx/hub.vertexmedia.pro.error.log warn;
    location ^~ /.well-known/acme-challenge/ { root /var/www/vertexhub-acme; }
    location / { return 301 https://hub.vertexmedia.pro$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name hub.vertexmedia.pro;

    ssl_certificate /etc/letsencrypt/live/hub.vertexmedia.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hub.vertexmedia.pro/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    access_log /var/log/nginx/hub.vertexmedia.pro.access.log;
    error_log /var/log/nginx/hub.vertexmedia.pro.error.log warn;

    root /srv/hub.vertexmedia.pro/current/apps/web/dist;
    index index.html;

    # Uploads (F10) will raise this for their own route only.
    client_max_body_size 2m;
    client_body_timeout 20s;
    server_tokens off;

    limit_conn perip 100;
    limit_req zone=general burst=50 nodelay;

    include snippets/vertexhub-headers.conf;

    gzip on;
    gzip_vary on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # --- API -----------------------------------------------------------------------------
    location /api/ {
        proxy_pass http://127.0.0.1:3050;
        include snippets/vertexhub-proxy.conf;
    }

    # Password guessing: a tight limit on the sign-in endpoint on top of Better Auth's own.
    location = /api/auth/sign-in/email {
        limit_req zone=vhsignin burst=5 nodelay;
        proxy_pass http://127.0.0.1:3050;
        include snippets/vertexhub-proxy.conf;
    }

    # Activation and reset links are anonymous and set a password: the same tight limit.
    location = /api/password-links/redeem {
        limit_req zone=vhsignin burst=5 nodelay;
        proxy_pass http://127.0.0.1:3050;
        include snippets/vertexhub-proxy.conf;
    }

    # Notifications stream (F14, ADR 0018): Server-Sent Events pass through unbuffered, and the
    # read timeout outlasts the stream's 15-minute lifetime. The proxy snippet is not included
    # because it sets its own read timeout; its headers are repeated here. Streams count against
    # their own connection limit instead of the site-wide one (vertexhub-limits.conf).
    location = /api/me/notifications/stream {
        limit_conn vhstream 60;
        proxy_pass http://127.0.0.1:3050;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_hide_header X-Powered-By;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 20m;
        gzip off;
    }

    # The API documentation is disabled in production; don't forward probes for it.
    location ^~ /api/docs { return 404; }

    # --- Static files ----------------------------------------------------------------------
    # Hashed build assets never change: cache them for a year.
    location /assets/ {
        try_files $uri =404;
        include snippets/vertexhub-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        access_log off;
    }

    # Licensed Madani Arabic files (ADR 0011): 404 until provisioned, then Noto Kufi is replaced.
    location /fonts/madani/ {
        alias /srv/hub.vertexmedia.pro/fonts/madani/;
        try_files $uri =404;
        include snippets/vertexhub-headers.conf;
        add_header Cache-Control "public, max-age=2592000" always;
        access_log off;
    }

    # Dotfiles and source maps are never served.
    location ~ /\. { return 404; }
    location ~ \.map$ { return 404; }

    # The SPA: every other path renders index.html, which must always be revalidated so a
    # deploy takes effect on the next page load.
    location / {
        try_files $uri /index.html;
        include snippets/vertexhub-headers.conf;
        add_header Cache-Control "no-cache" always;
    }
}
