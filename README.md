# Domaeng Image Service

Single-container image workbench for `api.domaeng.com/image/`.

The service includes:

- `/image/` web page
- `/image-api/` login, job creation, job history, job status
- `/images/` authenticated image delivery
- an internal worker that calls New-API asynchronously

New-API and CliproxyAPI stay unchanged. Image jobs are still billed, routed, and authorized by New-API.

## Local Development

Install dependencies and build the web page:

```powershell
npm install
npm.cmd run build
```

Run the combined service:

```powershell
$env:NEW_API_BASE_URL="https://api.domaeng.com"
$env:IMAGE_DATA_DIR="$PWD\.local-data"
$env:IMAGE_SERVICE_SECRET="local-dev-secret-change-me"
npm.cmd start
```

Open:

```text
http://127.0.0.1:3000/image/
```

For Vite-only frontend development against a deployed service:

```powershell
$env:VITE_NEW_API_ORIGIN="https://api.domaeng.com"
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173/image/
```

## Deployment

Deployment files now live in `deploy/`:

- `deploy/docker-compose.yml` is the base server Compose file for New-API, CLIProxyAPI, and chatgpt2api.
- `deploy/docker-compose.override.yml` adds image-service and nginx on top of the base Compose file.
- `deploy/api.domaeng.com.conf` is the source nginx config; copy it to `/opt/ai-gateway/nginx/conf.d/api.domaeng.com.conf` before restarting nginx.
- `deploy/.env.example` lists optional queue tuning variables that can be copied to `deploy/.env` on the server.

Run from the `deploy/` directory on the server:

```bash
cp /opt/image-web/deploy/api.domaeng.com.conf /opt/ai-gateway/nginx/conf.d/api.domaeng.com.conf
cd /opt/ai-gateway
docker compose up -d --build
```

The container runs Node.js, not nginx. It builds the React page and then starts:

```text
node --experimental-sqlite server/index.mjs
```

Required persistent volume:

```text
./image-service-data:/data/image-service
```

Important environment variables:

- `IMAGE_MAX_GLOBAL_PROCESSING=1`
- `IMAGE_MAX_TOKEN_PROCESSING=1`
- `IMAGE_MAX_TOKEN_QUEUED=5`

`IMAGE_SERVICE_SECRET` is currently set directly in `deploy/docker-compose.override.yml`. It protects saved user tokens. Set it once and keep it stable. If it changes, previously saved encrypted tokens cannot be used by unfinished jobs.

For Docker Compose deployments, the image-service queue and upload settings are read from environment variables, so changing concurrency normally only requires editing `deploy/.env` and recreating the container, not changing source code. Video UI code is intentionally kept in the frontend but disabled by default, and the backend currently rejects new video generation jobs until a new provider is added.

Nginx should route:

- `/image/` to `image-service:3000`
- `/image-api/` to `image-service:3000`
- `/images/` to `image-service:3000`
- `/videos/` to `image-service:3000`
- `/v1/`, `/v1beta/`, and `/` to `new-api:3000`

## Data Backup

Create a local backup from inside the running container:

```bash
docker exec image-service node --experimental-sqlite scripts/backup.mjs
```

Backups are written to:

```text
./image-service-data/backups/
```

The backup includes:

- a SQLite database copy created with `VACUUM INTO`
- a compressed archive of saved images

Recommended server cron example:

```cron
20 3 * * * docker exec image-service node --experimental-sqlite scripts/backup.mjs >> /var/log/image-service-backup.log 2>&1
```

Copy backup files off the EC2 instance regularly if the images are important.

## Maintenance

Delete all saved video jobs and their video files from inside the running container:

```bash
docker exec image-service node --experimental-sqlite scripts/delete-video-jobs.mjs
```

## Future Migration

The first version is intentionally single-machine and lightweight:

- SQLite can later be replaced by Postgres or MySQL.
- The internal polling worker can later be replaced by Redis/BullMQ or a separate worker service.
- Local disk storage can later be replaced by S3, R2, or MinIO.
- Existing image URLs use random slugs, so storage can move behind the same `/images/` route without changing the browser-facing URL shape.
