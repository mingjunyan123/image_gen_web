# AI Image Workbench

A lightweight React/Vite frontend for image generation and editing. The app is intentionally frontend-only: user actions send HTTP requests directly to the configured image API endpoints.

## Local Development

```powershell
cd image_gen_web
npm install
npm run dev
```

Open `http://127.0.0.1:5173/image/`.

By default, browser requests go to same-origin paths:

- `/v1/images/generations`
- `/v1/images/edits`
- `/v1beta/models/gemini-3.1-flash-image:generateContent`

For local development against a remote gateway, set `VITE_NEW_API_ORIGIN` before starting Vite:

```powershell
$env:VITE_NEW_API_ORIGIN="https://domaeng.com"
npm run dev
```

Vite will proxy `/v1` and `/v1beta` to that origin during local development only.

## Build

```powershell
cd image_gen_web
npm run build
```

Vite is configured with `base: "/image/"` for deployment under `/image/`.

## Docker Deployment

The Docker image builds the static frontend and serves it with nginx.

```bash
cd image_gen_web
docker compose -f deploy/docker-compose.image-web.yml build
docker compose -f deploy/docker-compose.image-web.yml up -d
```

See:

- `deploy/docker-compose.image-web.yml`
- `deploy/image-web.nginx.conf`
- `deploy/domaeng.com.conf`

## Models

- `GPT Image 2` uses model id `gpt-image-2` with `/v1/images/generations` and `/v1/images/edits`.
- `Nano Banana 2` uses model id `gemini-3.1-flash-image` with `/v1beta/models/gemini-3.1-flash-image:generateContent`.
- The upstream gateway must allow these models and route `/v1/images/` plus `/v1beta/`.
