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

The container runs Node.js, not nginx. It builds the React page and then starts:

```text
node --experimental-sqlite server/index.mjs
```

Required persistent volume:

```text
./image-service-data:/data/image-service
```

Important environment variables:

- `NEW_API_BASE_URL=http://new-api:3000`
- `IMAGE_DATA_DIR=/data/image-service`
- `IMAGE_SERVICE_SECRET=<set-a-long-random-secret>`
- `IMAGE_MAX_GLOBAL_PROCESSING=1`
- `IMAGE_MAX_TOKEN_PROCESSING=1`
- `IMAGE_MAX_TOKEN_QUEUED=5`

`IMAGE_SERVICE_SECRET` protects saved user tokens. Set it once and keep it stable. If it changes, previously saved encrypted tokens cannot be used by unfinished jobs.

Nginx should route:

- `/image/` to `image-service:3000`
- `/image-api/` to `image-service:3000`
- `/images/` to `image-service:3000`
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

## Future Migration

The first version is intentionally single-machine and lightweight:

- SQLite can later be replaced by Postgres or MySQL.
- The internal polling worker can later be replaced by Redis/BullMQ or a separate worker service.
- Local disk storage can later be replaced by S3, R2, or MinIO.
- Existing image URLs use random slugs, so storage can move behind the same `/images/` route without changing the browser-facing URL shape.
