#!/bin/sh
set -e

mkdir -p /etc/nginx/conf.d /var/www/certbot

if [ -s /etc/nginx/certs/fullchain.pem ] && [ -s /etc/nginx/certs/privkey.pem ]; then
  echo "Nginx: HTTPS enabled for sabad-yar.ir, piiip.ir, piiip.ai"
  cp /etc/nginx/templates/https.conf /etc/nginx/conf.d/default.conf
else
  echo "Nginx: HTTP only (put TLS certs in docker/nginx/certs to enable HTTPS)"
  cp /etc/nginx/templates/http.conf /etc/nginx/conf.d/default.conf
fi

nginx -t
exec nginx -g 'daemon off;'
