# Application logs of hub.vertexmedia.pro only, named explicitly. nginx logs live in
# /var/log/nginx/hub.vertexmedia.pro.*.log and /etc/logrotate.d/nginx rotates them (SERVER.md rule 9).
/var/log/hub.vertexmedia.pro/api.*.log
/var/log/hub.vertexmedia.pro/worker.*.log
{
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su vertexhub vertexhub
    create 0640 vertexhub vertexhub
}
