# Deploy Notes

Read this file before changing nginx or Docker Compose deployment config.

## Server Layout

Production files are split across two directories on the Ubuntu server:

```text
/opt/image-web/
  Dockerfile
  README.md
  deploy/
  index.html
  package-lock.json
  package.json
  public/
  scripts/
  server/
  src/
  vite.config.js

/opt/ai-gateway/
  certbot/
  chatgpt2api/
  chatgpt2api-data/
  cliproxyapi/
  docker-compose.yml
  docker-compose.override.yml
  image-service-data/
  new-api-data/
  new-api-logs/
  nginx/
  renew-cert.log
  renew-cert.sh
  static/

/opt/ai-gateway/nginx/conf.d/
  api.domaeng.com.conf
```

## Source Of Truth

- Application source lives in `/opt/image-web`.
- Runtime gateway state and persistent data live in `/opt/ai-gateway`.
- Repo config files in `deploy/` are templates/source copies.
- Active nginx config on the server is `/opt/ai-gateway/nginx/conf.d/api.domaeng.com.conf`.
- Active Docker Compose files on the server are `/opt/ai-gateway/docker-compose.yml` and `/opt/ai-gateway/docker-compose.override.yml`.

## Update Checklist

When changing nginx config:

```bash
cp /opt/image-web/deploy/api.domaeng.com.conf /opt/ai-gateway/nginx/conf.d/api.domaeng.com.conf
cd /opt/ai-gateway
docker compose up -d nginx
```

When changing Docker Compose config:

```bash
cp /opt/image-web/deploy/docker-compose.yml /opt/ai-gateway/docker-compose.yml
cp /opt/image-web/deploy/docker-compose.override.yml /opt/ai-gateway/docker-compose.override.yml
cd /opt/ai-gateway
docker compose up -d --build
```

Do not edit only one side and assume the other side was updated. If production was hotfixed directly under `/opt/ai-gateway`, copy the change back into `/opt/image-web/deploy/` before the next deployment change.
