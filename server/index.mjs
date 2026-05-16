import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PUBLIC_INDEX = path.join(DIST_DIR, "index.html");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.IMAGE_DATA_DIR || "/data/image-service";
const DB_PATH = path.join(DATA_DIR, "app.db");
const IMAGE_DIR = path.join(DATA_DIR, "images");
const VIDEO_DIR = path.join(DATA_DIR, "videos");
const NEW_API_BASE_URL = (process.env.NEW_API_BASE_URL || "http://new-api:3000").replace(/\/+$/, "");
const JIMENG_API_BASE_URL = (process.env.JIMENG_API_BASE_URL || "http://jimeng-api:5100").replace(/\/+$/, "");
const JIMENG_SESSION_ID = cleanJimengToken(process.env.JIMENG_SESSION_ID || "");
const SERVICE_SECRET = process.env.IMAGE_SERVICE_SECRET || "change-me-image-service-secret";
const TOKEN_PEPPER = process.env.IMAGE_TOKEN_PEPPER || SERVICE_SECRET;
const SESSION_DAYS = Number(process.env.IMAGE_SESSION_DAYS || 7);
const MAX_GLOBAL_PROCESSING = Number(process.env.IMAGE_MAX_GLOBAL_PROCESSING || 1);
const MAX_TOKEN_PROCESSING = Number(process.env.IMAGE_MAX_TOKEN_PROCESSING || 1);
const MAX_TOKEN_QUEUED = Number(process.env.IMAGE_MAX_TOKEN_QUEUED || 5);
const WORKER_INTERVAL_MS = Number(process.env.IMAGE_WORKER_INTERVAL_MS || 1500);
const REQUEST_TIMEOUT_MS = Number(process.env.IMAGE_REQUEST_TIMEOUT_MS || 600000);
const VIDEO_REQUEST_TIMEOUT_MS = Number(process.env.VIDEO_REQUEST_TIMEOUT_MS || 2400000);
const MAX_IMAGE_BYTES = Number(process.env.IMAGE_MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const SESSION_COOKIE = "image_session";
const MISSING_IMAGE_MESSAGE = "上游模型这次没有返回图片，只返回了文字或空结果。请稍后重试；如果连续出现，请调整提示词或换一个模型。";
const MISSING_VIDEO_MESSAGE = "上游模型这次没有返回视频，只返回了文字或空结果。请稍后重试；如果连续出现，请调整提示词或换一个模型。";
const UPSTREAM_LOG_TEXT_LIMIT = 500;

if (!process.env.IMAGE_SERVICE_SECRET) {
  console.warn("[image-service] IMAGE_SERVICE_SECRET is not set. Set a long random value before production use.");
}

await mkdir(DATA_DIR, { recursive: true });
await mkdir(IMAGE_DIR, { recursive: true });
await mkdir(path.join(IMAGE_DIR, "sources"), { recursive: true });
await mkdir(path.join(IMAGE_DIR, "results"), { recursive: true });
await mkdir(VIDEO_DIR, { recursive: true });
await mkdir(path.join(VIDEO_DIR, "sources"), { recursive: true });
await mkdir(path.join(VIDEO_DIR, "results"), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    encrypted_token TEXT NOT NULL,
    token_iv TEXT NOT NULL,
    token_tag TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'image',
    provider TEXT NOT NULL DEFAULT 'openai',
    mode TEXT NOT NULL,
    model_key TEXT NOT NULL,
    params_json TEXT NOT NULL,
    source_image_path TEXT,
    source_image_name TEXT,
    source_image_mime TEXT,
    source_end_image_path TEXT,
    source_end_image_name TEXT,
    source_end_image_mime TEXT,
    result_image_path TEXT,
    result_media_path TEXT,
    result_mime TEXT,
    image_slug TEXT UNIQUE,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_path TEXT NOT NULL,
    images_archive_path TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_jobs_slug ON jobs(image_slug);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn("jobs", "media_type", "TEXT NOT NULL DEFAULT 'image'");
ensureColumn("jobs", "provider", "TEXT NOT NULL DEFAULT 'openai'");
ensureColumn("jobs", "source_end_image_path", "TEXT");
ensureColumn("jobs", "source_end_image_name", "TEXT");
ensureColumn("jobs", "source_end_image_mime", "TEXT");
ensureColumn("jobs", "result_media_path", "TEXT");

db.prepare(`
  UPDATE jobs
  SET status = 'failed',
      error_message = '服务重启时任务还没有完成，请重新生成。',
      finished_at = ?
  WHERE status = 'processing'
`).run(Date.now());

function now() {
  return Date.now();
}

function randomId(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(TOKEN_PEPPER).update(token).digest("hex");
}

function encryptionKey() {
  return createHash("sha256").update(SERVICE_SECRET).digest();
}

function encryptToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptToken(user) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(user.token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(user.token_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(user.encrypted_token, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function cleanToken(value) {
  return String(value || "").trim().replace(/^Bearer\s+/i, "");
}

function cleanJimengToken(value) {
  return String(value || "").trim().replace(/^Bearer\s+/i, "").replace(/^sessionid=/i, "");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map((item) => {
    const index = item.indexOf("=");
    if (index === -1) return null;
    return [decodeURIComponent(item.slice(0, index).trim()), decodeURIComponent(item.slice(index + 1).trim())];
  }).filter(Boolean));
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw httpError(413, "内容太大了，请减少后再试。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit) {
  const body = await readBody(req, limit);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw httpError(400, "提交内容格式不正确。");
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getSession(req) {
  const sessionId = parseCookies(req)[SESSION_COOKIE];
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(sessionId, now());
  return row || null;
}

function requireSession(req) {
  const session = getSession(req);
  if (!session) throw httpError(401, "请先登录。");
  return session;
}

function makeSessionCookie(req, sessionId, expiresAt) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "");
  const isHttps = forwardedProto.includes("https") || req.socket.encrypted;
  const secure = isHttps ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${new Date(expiresAt).toUTCString()}`;
}

function clearSessionCookie(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "");
  const isHttps = forwardedProto.includes("https") || req.socket.encrypted;
  const secure = isHttps ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyNewApiToken(token) {
  const response = await fetchWithTimeout(`${NEW_API_BASE_URL}/v1/models`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000,
  });
  if (!response.ok) {
    throw httpError(401, "访问密钥无效，请检查后再试。");
  }
}

async function handleLogin(req, res) {
  const payload = await readJson(req, 128 * 1024);
  const token = cleanToken(payload.token);
  if (!token) throw httpError(400, "请输入访问密钥。");

  await verifyNewApiToken(token);

  const tokenHash = hashToken(token);
  const encrypted = encryptToken(token);
  const timestamp = now();
  const existing = db.prepare("SELECT id FROM users WHERE token_hash = ?").get(tokenHash);
  let userId;
  if (existing) {
    userId = existing.id;
    db.prepare(`
      UPDATE users
      SET encrypted_token = ?, token_iv = ?, token_tag = ?, updated_at = ?
      WHERE id = ?
    `).run(encrypted.encrypted, encrypted.iv, encrypted.tag, timestamp, userId);
  } else {
    const result = db.prepare(`
      INSERT INTO users (token_hash, encrypted_token, token_iv, token_tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, encrypted.encrypted, encrypted.iv, encrypted.tag, timestamp, timestamp);
    userId = Number(result.lastInsertRowid);
  }

  const sessionId = randomId(24);
  const expiresAt = timestamp + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, userId, expiresAt, timestamp);

  sendJson(res, 200, { authenticated: true }, { "Set-Cookie": makeSessionCookie(req, sessionId, expiresAt) });
}

function handleSession(req, res) {
  const session = getSession(req);
  sendJson(res, 200, {
    authenticated: Boolean(session),
    limits: {
      maxQueued: MAX_TOKEN_QUEUED,
      maxActive: MAX_TOKEN_PROCESSING,
    },
  });
}

function handleLogout(req, res) {
  const sessionId = parseCookies(req)[SESSION_COOKIE];
  if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  sendJson(res, 200, { authenticated: false }, { "Set-Cookie": clearSessionCookie(req) });
}

function contentTypeToExtension(mime, fallback = "png") {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return fallback;
}

function extensionToMime(ext) {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "image/png";
}

function safeOutputFormat(value) {
  return ["png", "jpeg", "webp"].includes(value) ? value : "png";
}

const NANO_ASPECT_RATIOS = new Set(["21:9", "8:1", "4:1", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "1:4", "1:8"]);

function safeNanoAspectRatio(value) {
  return NANO_ASPECT_RATIOS.has(value) ? value : "1:1";
}

const JIMENG_VIDEO_MODES = new Set(["text", "first-frame", "first-last-frame"]);
const JIMENG_VIDEO_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"]);
const JIMENG_VIDEO_RESOLUTIONS = new Set(["720p", "1080p"]);
const JIMENG_VIDEO_MODELS = new Set([
  "jimeng-video-seedance-2.0",
  "jimeng-video-seedance-2.0-fast",
  "jimeng-video-3.5-pro",
  "jimeng-video-veo3",
  "jimeng-video-veo3.1",
  "jimeng-video-sora2",
  "jimeng-video-3.0-pro",
  "jimeng-video-3.0",
  "jimeng-video-3.0-fast",
  "jimeng-video-2.0-pro",
  "jimeng-video-2.0",
]);

function safeJimengVideoRatio(value) {
  return JIMENG_VIDEO_RATIOS.has(value) ? value : "16:9";
}

function safeJimengVideoResolution(value) {
  return JIMENG_VIDEO_RESOLUTIONS.has(value) ? value : "720p";
}

function safeJimengVideoModel(value) {
  return JIMENG_VIDEO_MODELS.has(value) ? value : "jimeng-video-3.5-pro";
}

function safeJimengVideoDuration(model, value) {
  const duration = Number(value);
  if (model === "jimeng-video-veo3" || model === "jimeng-video-veo3.1") return "8";
  if (model === "jimeng-video-sora2") return ["4", "8", "12"].includes(String(value)) ? String(value) : "4";
  if (model === "jimeng-video-seedance-2.0" || model === "jimeng-video-seedance-2.0-fast") {
    return Number.isInteger(duration) && duration >= 4 && duration <= 15 ? String(duration) : "5";
  }
  if (model === "jimeng-video-3.5-pro") return ["5", "10", "12"].includes(String(value)) ? String(value) : "5";
  return ["5", "10"].includes(String(value)) ? String(value) : "5";
}

const GPT_MAX_LONG_SIDE = 3840;
const GPT_MAX_SHORT_SIDE = 2160;

function validateGptDimensions(widthInput, heightInput) {
  const widthText = String(widthInput ?? "").trim();
  const heightText = String(heightInput ?? "").trim();
  if (!widthText || !heightText) {
    return { valid: false, error: "宽高必须填写完整" };
  }
  if (!/^\d+$/.test(widthText) || !/^\d+$/.test(heightText)) {
    return { valid: false, error: "宽高必须是正整数" };
  }

  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return { valid: false, error: "宽高必须是正整数" };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { valid: false, error: "宽高必须能被 16 整除" };
  }

  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) {
    return { valid: false, error: "宽高比必须在 1:3 到 3:1 之间" };
  }

  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (longSide > GPT_MAX_LONG_SIDE || shortSide > GPT_MAX_SHORT_SIDE) {
    return { valid: false, error: "最大支持 3840x2160，竖图方向为 2160x3840" };
  }

  return { valid: true, size: `${width}x${height}` };
}

function validateGptSizeString(size) {
  const match = /^(\d+)x(\d+)$/i.exec(String(size || "").trim());
  if (!match) return { valid: false, error: "宽高必须填写完整" };
  return validateGptDimensions(match[1], match[2]);
}

function normalizeJobParams(input) {
  const mediaType = input.mediaType === "video" ? "video" : "image";
  if (mediaType === "video") {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw httpError(400, "请先写下想生成的视频内容。");
    const videoMode = JIMENG_VIDEO_MODES.has(input.videoMode) ? input.videoMode : "text";
    const jimengModel = safeJimengVideoModel(String(input.jimengModel || "jimeng-video-3.5-pro").trim());
    const params = {
      mediaType,
      provider: "jimeng",
      mode: videoMode,
      modelKey: "jimeng",
      jimengModel,
      prompt,
      duration: safeJimengVideoDuration(jimengModel, input.duration),
      functionMode: "first_last_frames",
      responseFormat: "url",
    };
    if (videoMode === "text") params.ratio = safeJimengVideoRatio(input.ratio);
    if (jimengModel === "jimeng-video-3.0" || jimengModel === "jimeng-video-3.0-fast") {
      params.resolution = safeJimengVideoResolution(input.videoResolution);
    }
    return params;
  }

  const mode = input.mode === "edit" ? "edit" : "generate";
  const modelKey = input.modelKey === "nano" ? "nano" : "gpt";
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw httpError(400, "请先写下想生成的内容。");

  const outputFormat = safeOutputFormat(input.outputFormat);
  const outputCompressionInput = input.outputCompression === undefined || input.outputCompression === "" ? 82 : input.outputCompression;
  const outputCompressionValue = Number(outputCompressionInput);
  const outputCompression = Number.isFinite(outputCompressionValue)
    ? Math.min(100, Math.max(0, outputCompressionValue))
    : 82;
  const requestedSize = String(input.size || "1024x1024");
  const gptSizeValidation = modelKey === "gpt" ? validateGptSizeString(requestedSize) : { valid: true, size: requestedSize };
  if (!gptSizeValidation.valid) throw httpError(400, gptSizeValidation.error);
  const params = {
    mediaType,
    provider: modelKey === "nano" ? "gemini" : "openai",
    mode,
    modelKey,
    prompt,
    size: gptSizeValidation.size,
    quality: ["auto", "low", "medium", "high"].includes(input.quality) ? input.quality : "auto",
    outputFormat,
    outputCompression,
    moderation: input.moderation === "low" ? "low" : "auto",
    aspectRatio: safeNanoAspectRatio(String(input.aspectRatio || "1:1")),
    resolution: ["512", "1K", "2K", "4K"].includes(input.resolution) ? input.resolution : "1K",
  };
  return params;
}

function parseMultipartBody(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    start += boundaryBuffer.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(start, headerEnd).toString("utf8");
    let partEnd = buffer.indexOf(boundaryBuffer, headerEnd + 4);
    if (partEnd === -1) break;
    let dataEnd = partEnd;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;

    const disposition = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headerText)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const mime = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "application/octet-stream";
    const data = buffer.slice(headerEnd + 4, dataEnd);

    if (name && filename) {
      files[name] = { filename, mime, data };
    } else if (name) {
      fields[name] = data.toString("utf8");
    }
    start = partEnd;
  }
  return { fields, files };
}

async function parseJobRequest(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.startsWith("multipart/form-data")) {
    const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1];
    if (!boundary) throw httpError(400, "上传内容格式不正确。");
    const parsed = parseMultipartBody(await readBody(req, MAX_IMAGE_BYTES * 2 + 1024 * 1024), boundary);
    return {
      fields: parsed.fields,
      file: parsed.files.image || null,
      files: parsed.files,
    };
  }
  return { fields: await readJson(req, 512 * 1024), file: null, files: {} };
}

function publicJob(row) {
  const params = JSON.parse(row.params_json);
  const mediaType = row.media_type || params.mediaType || "image";
  const slug = row.image_slug;
  return {
    id: row.id,
    status: row.status,
    mediaType,
    provider: row.provider || params.provider || (params.modelKey === "nano" ? "gemini" : "openai"),
    mode: row.mode,
    modelKey: row.model_key,
    prompt: params.prompt,
    params,
    imageUrl: mediaType === "image" && slug ? `/images/${slug}` : null,
    videoUrl: mediaType === "video" && slug ? `/videos/${slug}` : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function createJob(req, res) {
  const session = requireSession(req);
  const queued = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND status = 'queued'")
    .get(session.id).count;
  if (queued >= MAX_TOKEN_QUEUED) {
    throw httpError(429, "等待中的作品太多了，请等前面的完成后再提交。");
  }

  const { fields, file, files } = await parseJobRequest(req);
  const params = normalizeJobParams(fields);
  const firstFrame = params.mediaType === "video" ? (files.firstFrame || null) : file;
  const endFrame = params.mediaType === "video" ? (files.endFrame || null) : null;

  if (params.mediaType === "image" && params.mode === "edit" && !firstFrame) {
    throw httpError(400, "请先上传一张参考图片。");
  }
  if (params.mediaType === "video" && params.mode !== "text" && !firstFrame) {
    throw httpError(400, "请先上传首帧图片。");
  }
  if (params.mediaType === "video" && params.mode === "first-last-frame" && !endFrame) {
    throw httpError(400, "请先上传尾帧图片。");
  }

  for (const upload of [firstFrame, endFrame].filter(Boolean)) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(upload.mime)) {
      throw httpError(400, "请上传 PNG、JPG 或 WebP 图片。");
    }
    if (upload.data.length > MAX_IMAGE_BYTES) {
      throw httpError(413, "图片不能超过 50MB。");
    }
  }

  const jobId = randomId(20);
  let sourcePath = null;
  let sourceEndPath = null;
  if (firstFrame) {
    const ext = contentTypeToExtension(firstFrame.mime);
    sourcePath = path.join("sources", `${jobId}.${ext}`);
    if (params.mediaType === "video") {
      await writeVideoFile(sourcePath, firstFrame.data);
    } else {
      await writeImageFile(sourcePath, firstFrame.data);
    }
  }
  if (endFrame) {
    const ext = contentTypeToExtension(endFrame.mime);
    sourceEndPath = path.join("sources", `${jobId}-end.${ext}`);
    await writeVideoFile(sourceEndPath, endFrame.data);
  }

  const timestamp = now();
  db.prepare(`
    INSERT INTO jobs (
      id, user_id, status, media_type, provider, mode, model_key, params_json,
      source_image_path, source_image_name, source_image_mime,
      source_end_image_path, source_end_image_name, source_end_image_mime,
      created_at
    )
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    session.id,
    params.mediaType,
    params.provider,
    params.mode,
    params.modelKey,
    JSON.stringify(params),
    sourcePath,
    firstFrame?.filename || null,
    firstFrame?.mime || null,
    sourceEndPath,
    endFrame?.filename || null,
    endFrame?.mime || null,
    timestamp,
  );

  const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(jobId, session.id);
  sendJson(res, 201, { job: publicJob(row) });
}

function listJobs(req, res) {
  const session = requireSession(req);
  const rows = db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 80").all(session.id);
  sendJson(res, 200, { jobs: rows.map(publicJob) });
}

function getJob(req, res, jobId) {
  const session = requireSession(req);
  const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(jobId, session.id);
  if (!row) throw httpError(404, "没有找到这条作品记录。");
  sendJson(res, 200, { job: publicJob(row) });
}

async function writeImageFile(relativePath, buffer) {
  const fullPath = safeImagePath(relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

async function writeVideoFile(relativePath, buffer) {
  const fullPath = safeVideoPath(relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

function safeImagePath(relativePath) {
  const fullPath = path.resolve(IMAGE_DIR, relativePath);
  if (!fullPath.startsWith(path.resolve(IMAGE_DIR) + path.sep)) {
    throw new Error("Invalid image path");
  }
  return fullPath;
}

function safeVideoPath(relativePath) {
  const fullPath = path.resolve(VIDEO_DIR, relativePath);
  if (!fullPath.startsWith(path.resolve(VIDEO_DIR) + path.sep)) {
    throw new Error("Invalid video path");
  }
  return fullPath;
}

async function handleImage(req, res, slug) {
  const session = requireSession(req);
  const row = db.prepare(`
    SELECT result_image_path, result_mime
    FROM jobs
    WHERE image_slug = ? AND user_id = ? AND status = 'succeeded' AND media_type = 'image'
  `).get(slug, session.id);
  if (!row?.result_image_path) throw httpError(404, "没有找到这张图片。");

  const fullPath = safeImagePath(row.result_image_path);
  const fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat?.isFile()) throw httpError(404, "图片文件不存在。");

  res.writeHead(200, {
    "Content-Type": row.result_mime || "image/png",
    "Content-Length": fileStat.size,
    "Cache-Control": "private, max-age=3600",
  });
  createReadStream(fullPath).pipe(res);
}

async function handleVideo(req, res, slug) {
  const session = requireSession(req);
  const row = db.prepare(`
    SELECT COALESCE(result_media_path, result_image_path) AS result_path, result_mime
    FROM jobs
    WHERE image_slug = ? AND user_id = ? AND status = 'succeeded' AND media_type = 'video'
  `).get(slug, session.id);
  if (!row?.result_path) throw httpError(404, "没有找到这个视频。");

  const fullPath = safeVideoPath(row.result_path);
  const fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat?.isFile()) throw httpError(404, "视频文件不存在。");

  const range = String(req.headers.range || "");
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (rangeMatch) {
    const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    const requestedEnd = rangeMatch[2] ? Number(rangeMatch[2]) : fileStat.size - 1;
    const end = Math.min(requestedEnd, fileStat.size - 1);
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end) {
      res.writeHead(206, {
        "Content-Type": row.result_mime || "video/mp4",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
        "Cache-Control": "private, max-age=3600",
        "Accept-Ranges": "bytes",
      });
      createReadStream(fullPath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    "Content-Type": row.result_mime || "video/mp4",
    "Content-Length": fileStat.size,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  });
  createReadStream(fullPath).pipe(res);
}

function buildGeminiBody(params, imagePart = null) {
  const parts = [{ text: params.prompt }];
  if (imagePart) {
    parts.push({
      inlineData: {
        mimeType: imagePart.mimeType,
        data: imagePart.data,
      },
    });
  }
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: params.aspectRatio,
        imageSize: params.resolution,
      },
    },
  };
}

function parseGeminiImage(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) return { b64: part.inlineData.data, mime: part.inlineData.mimeType || "image/png" };
    if (part?.inline_data?.data) return { b64: part.inline_data.data, mime: part.inline_data.mime_type || "image/png" };
  }
  return null;
}

function compactLogText(value, limit = UPSTREAM_LOG_TEXT_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function contentToText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.input_text || part?.output_text || "").filter(Boolean).join(" ");
  }
  return content.text || content.input_text || content.output_text || "";
}

function readPayloadText(payload) {
  const texts = [];
  for (const candidate of payload?.candidates || []) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      if (part?.text) texts.push(part.text);
    }
  }
  for (const choice of payload?.choices || []) {
    texts.push(contentToText(choice?.message?.content));
    texts.push(contentToText(choice?.delta?.content));
    texts.push(choice?.text || "");
  }
  for (const output of payload?.output || []) {
    texts.push(contentToText(output?.content));
  }
  return compactLogText(texts.filter(Boolean).join(" "));
}

function readUsageSummary(payload) {
  const usage = payload?.usage || payload?.usageMetadata;
  if (!usage || typeof usage !== "object") return null;
  const summary = {};
  for (const key of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "input_tokens",
    "output_tokens",
    "promptTokenCount",
    "candidatesTokenCount",
    "totalTokenCount",
  ]) {
    if (usage[key] !== undefined) summary[key] = usage[key];
  }
  return Object.keys(summary).length ? summary : null;
}

function summarizeMissingMediaPayload(payload) {
  if (!payload || typeof payload !== "object") return { payloadType: payload === null ? "null" : typeof payload };
  return {
    code: payload.code ?? null,
    message: payload.message ?? null,
    topLevelKeys: Object.keys(payload).slice(0, 20),
    dataSummary: summarizePayloadData(payload.data),
    usage: readUsageSummary(payload),
    text: readPayloadText(payload),
    finishReason: payload?.candidates?.[0]?.finishReason || payload?.choices?.[0]?.finish_reason || null,
  };
}

function summarizePayloadData(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return { type: "array", length: data.length, firstKeys: Object.keys(data[0] || {}).slice(0, 20) };
  if (typeof data !== "object") return { type: typeof data, preview: compactLogText(data, 160) };
  const innerData = data.data;
  return {
    type: "object",
    keys: Object.keys(data).slice(0, 20),
    innerData: Array.isArray(innerData)
      ? { type: "array", length: innerData.length, firstKeys: Object.keys(innerData[0] || {}).slice(0, 20) }
      : undefined,
  };
}

function missingMediaError(mediaType, payload, provider) {
  const error = new Error(mediaType === "video" ? MISSING_VIDEO_MESSAGE : MISSING_IMAGE_MESSAGE);
  error.code = mediaType === "video" ? "UPSTREAM_MISSING_VIDEO" : "UPSTREAM_MISSING_IMAGE";
  error.upstreamProvider = provider;
  error.upstreamSummary = summarizeMissingMediaPayload(payload);
  return error;
}

async function callImageModel(job, token) {
  const params = JSON.parse(job.params_json);
  if (params.modelKey === "nano") {
    const imagePart = job.source_image_path
      ? {
          mimeType: job.source_image_mime,
          data: (await readFile(safeImagePath(job.source_image_path))).toString("base64"),
        }
      : null;
    const response = await fetchWithTimeout(`${NEW_API_BASE_URL}/v1beta/models/gemini-3.1-flash-image:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(buildGeminiBody(params, imagePart)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(readUpstreamError(payload, response));
    const image = parseGeminiImage(payload);
    if (!image?.b64) throw missingMediaError("image", payload, "gemini");
    return { buffer: Buffer.from(image.b64, "base64"), mime: image.mime };
  }

  if (params.mode === "edit") {
    const formData = new FormData();
    formData.append("model", "gpt-image-2");
    formData.append("prompt", params.prompt);
    formData.append("n", "1");
    formData.append("size", params.size);
    formData.append("quality", params.quality);
    formData.append("output_format", params.outputFormat);
    formData.append("moderation", params.moderation);
    formData.append("background", "auto");
    if (params.outputFormat === "jpeg" || params.outputFormat === "webp") {
      formData.append("output_compression", String(params.outputCompression));
    }
    const source = await readFile(safeImagePath(job.source_image_path));
    formData.append("image", new Blob([source], { type: job.source_image_mime }), job.source_image_name || "image.png");

    const response = await fetchWithTimeout(`${NEW_API_BASE_URL}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    return await parseOpenAiImageResponse(response, params.outputFormat, "openai-edits");
  }

  const body = {
    model: "gpt-image-2",
    prompt: params.prompt,
    n: 1,
    size: params.size,
    quality: params.quality,
    output_format: params.outputFormat,
    moderation: params.moderation,
  };
  if (params.outputFormat === "jpeg" || params.outputFormat === "webp") {
    body.output_compression = params.outputCompression;
  }
  const response = await fetchWithTimeout(`${NEW_API_BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return await parseOpenAiImageResponse(response, params.outputFormat, "openai-generations");
}

async function parseOpenAiImageResponse(response, outputFormat, provider) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readUpstreamError(payload, response));
  const first = payload?.data?.[0];
  if (first?.b64_json) {
    return {
      buffer: Buffer.from(first.b64_json, "base64"),
      mime: outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`,
    };
  }
  if (first?.url) {
    const imageResponse = await fetchWithTimeout(first.url, { timeoutMs: REQUEST_TIMEOUT_MS });
    if (!imageResponse.ok) throw new Error("图片已经生成，但下载保存失败。");
    return {
      buffer: Buffer.from(await imageResponse.arrayBuffer()),
      mime: imageResponse.headers.get("content-type")?.split(";")[0] || "image/png",
    };
  }
  throw missingMediaError("image", payload, provider);
}

async function callJimengVideoModel(job) {
  if (!JIMENG_SESSION_ID) {
    throw new Error("Jimeng sessionid 还没有配置，请先设置 JIMENG_SESSION_ID。");
  }
  const params = JSON.parse(job.params_json);
  const headers = { Authorization: `Bearer ${JIMENG_SESSION_ID}` };
  let body;

  if (job.source_image_path) {
    body = new FormData();
    body.append("model", params.jimengModel || "jimeng-video-3.5-pro");
    body.append("prompt", params.prompt);
    body.append("duration", String(params.duration || "5"));
    body.append("functionMode", params.functionMode || "first_last_frames");
    body.append("response_format", params.responseFormat || "url");
    if (params.ratio) body.append("ratio", params.ratio);
    if (params.resolution) body.append("resolution", params.resolution);

    const firstFrame = await readFile(safeVideoPath(job.source_image_path));
    body.append("image_file_1", new Blob([firstFrame], { type: job.source_image_mime }), job.source_image_name || "first-frame.png");
    if (job.source_end_image_path) {
      const endFrame = await readFile(safeVideoPath(job.source_end_image_path));
      body.append("image_file_2", new Blob([endFrame], { type: job.source_end_image_mime }), job.source_end_image_name || "end-frame.png");
    }
  } else {
    headers["Content-Type"] = "application/json";
    const payload = {
      model: params.jimengModel || "jimeng-video-3.5-pro",
      prompt: params.prompt,
      duration: Number(params.duration || 5),
      functionMode: params.functionMode || "first_last_frames",
      response_format: params.responseFormat || "url",
    };
    if (params.ratio) payload.ratio = params.ratio;
    if (params.resolution) payload.resolution = params.resolution;
    body = JSON.stringify(payload);
  }

  const response = await fetchWithTimeout(`${JIMENG_API_BASE_URL}/v1/videos/generations`, {
    method: "POST",
    headers,
    body,
    timeoutMs: VIDEO_REQUEST_TIMEOUT_MS,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readUpstreamError(payload, response));
  const unwrappedPayload = unwrapJimengPayload(payload);

  const video = parseJimengVideoResponse(unwrappedPayload);
  if (video.b64) {
    return { buffer: Buffer.from(video.b64, "base64"), mime: "video/mp4" };
  }
  if (video.url) {
    const videoResponse = await fetchWithTimeout(video.url, { timeoutMs: VIDEO_REQUEST_TIMEOUT_MS });
    if (!videoResponse.ok) throw new Error("视频已经生成，但下载保存失败。");
    return {
      buffer: Buffer.from(await videoResponse.arrayBuffer()),
      mime: videoResponse.headers.get("content-type")?.split(";")[0] || "video/mp4",
    };
  }
  throw missingMediaError("video", payload, "jimeng");
}

function unwrapJimengPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Object.prototype.hasOwnProperty.call(payload, "code")) {
    const code = Number(payload.code);
    if (Number.isFinite(code) && code !== 0) {
      throw new Error(payload.message || `Jimeng API 返回错误 code=${payload.code}`);
    }
    return payload.data ?? payload;
  }
  return payload;
}

function parseJimengVideoResponse(payload) {
  const first = Array.isArray(payload?.data)
    ? payload.data[0]
    : payload?.data || payload?.videos?.[0] || payload;
  return {
    url: first?.url || first?.video_url || first?.videoUrl || first?.video?.url || first?.content?.video_url || findNestedVideoUrl(first),
    b64: first?.b64_json || first?.b64Json || findNestedBase64(first),
  };
}

function findNestedVideoUrl(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === "string") {
    return /^https?:\/\/.+\.(mp4|mov|webm)(\?|$)/i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of ["main_url", "backup_url", "download_url", "play_url", "video_url", "url"]) {
    const found = findNestedVideoUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    const found = findNestedVideoUrl(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function findNestedBase64(value, depth = 0) {
  if (!value || depth > 5 || typeof value !== "object") return null;
  for (const key of ["b64_json", "b64Json", "base64", "video_base64"]) {
    if (typeof value[key] === "string" && value[key].length > 1000) return value[key];
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    const found = findNestedBase64(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function readUpstreamError(payload, response) {
  return payload?.error?.message || payload?.message || payload?.detail || `生成失败，请稍后重试。(${response.status})`;
}

let workerRunning = false;

async function workerTick() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (true) {
      const active = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'processing'").get().count;
      if (active >= MAX_GLOBAL_PROCESSING) return;

      const job = db.prepare(`
        SELECT j.*, u.encrypted_token, u.token_iv, u.token_tag
        FROM jobs j
        JOIN users u ON u.id = j.user_id
        WHERE j.status = 'queued'
          AND (
            SELECT COUNT(*)
            FROM jobs p
            WHERE p.user_id = j.user_id AND p.status = 'processing'
          ) < ?
        ORDER BY j.created_at ASC
        LIMIT 1
      `).get(MAX_TOKEN_PROCESSING);
      if (!job) return;

      const started = now();
      const claimed = db.prepare(`
        UPDATE jobs
        SET status = 'processing', attempts = attempts + 1, started_at = ?, error_message = NULL
        WHERE id = ? AND status = 'queued'
      `).run(started, job.id);
      if (claimed.changes !== 1) continue;

      processJob(job).catch((error) => {
        console.error(`[image-service] job ${job.id} failed`, error);
      });
    }
  } finally {
    workerRunning = false;
  }
}

async function processJob(job) {
  try {
    const media = job.media_type === "video"
      ? await callJimengVideoModel(job)
      : await callImageModel(job, decryptToken(job));
    const ext = contentTypeToExtension(media.mime, job.media_type === "video" ? "mp4" : "png");
    const slug = `${randomId(24)}.${ext}`;
    const relativePath = path.join("results", new Date().toISOString().slice(0, 10), slug);
    if (job.media_type === "video") {
      await writeVideoFile(relativePath, media.buffer);
    } else {
      await writeImageFile(relativePath, media.buffer);
    }
    db.prepare(`
      UPDATE jobs
      SET status = 'succeeded',
          result_image_path = ?,
          result_media_path = ?,
          result_mime = ?,
          image_slug = ?,
          finished_at = ?,
          error_message = NULL
      WHERE id = ?
    `).run(relativePath, relativePath, media.mime || extensionToMime(ext), slug, now(), job.id);
  } catch (error) {
    if (error.code === "UPSTREAM_MISSING_IMAGE" || error.code === "UPSTREAM_MISSING_VIDEO") {
      console.warn("[image-service] upstream returned no media", {
        jobId: job.id,
        mediaType: job.media_type || "image",
        provider: error.upstreamProvider || job.provider || "unknown",
        modelKey: job.model_key,
        upstream: error.upstreamSummary,
      });
    }
    db.prepare(`
      UPDATE jobs
      SET status = 'failed', error_message = ?, finished_at = ?
      WHERE id = ?
    `).run(error.message || "生成失败，请稍后重试。", now(), job.id);
  }
}

setInterval(workerTick, WORKER_INTERVAL_MS).unref();
workerTick();

const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res, pathname) {
  if (pathname === "/image") return redirect(res, "/image/");
  let relative = decodeURIComponent(pathname.replace(/^\/image\/?/, ""));
  if (!relative) relative = "index.html";
  let fullPath = path.resolve(DIST_DIR, relative);
  if (!fullPath.startsWith(path.resolve(DIST_DIR) + path.sep) && fullPath !== path.resolve(DIST_DIR)) {
    throw httpError(404, "Not found");
  }
  let fileStat = await stat(fullPath).catch(() => null);
  if (!fileStat?.isFile()) {
    fullPath = PUBLIC_INDEX;
    fileStat = await stat(fullPath).catch(() => null);
  }
  if (!fileStat?.isFile()) throw httpError(404, "页面文件不存在，请先构建前端。");

  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": staticTypes[ext] || "application/octet-stream",
    "Content-Length": fileStat.size,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
  });
  createReadStream(fullPath).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/health") return sendJson(res, 200, { ok: true });
  if (pathname === "/image" || pathname.startsWith("/image/")) return await serveStatic(req, res, pathname);

  if (pathname === "/image-api/auth/login" && req.method === "POST") return await handleLogin(req, res);
  if (pathname === "/image-api/auth/session" && req.method === "GET") return handleSession(req, res);
  if (pathname === "/image-api/auth/logout" && req.method === "POST") return handleLogout(req, res);
  if (pathname === "/image-api/jobs" && req.method === "POST") return await createJob(req, res);
  if (pathname === "/image-api/jobs" && req.method === "GET") return listJobs(req, res);
  const jobMatch = /^\/image-api\/jobs\/([^/]+)$/.exec(pathname);
  if (jobMatch && req.method === "GET") return getJob(req, res, jobMatch[1]);
  const imageMatch = /^\/images\/([^/]+)$/.exec(pathname);
  if (imageMatch && req.method === "GET") return await handleImage(req, res, imageMatch[1]);
  const videoMatch = /^\/videos\/([^/]+)$/.exec(pathname);
  if (videoMatch && req.method === "GET") return await handleVideo(req, res, videoMatch[1]);

  sendError(res, 404, "Not found");
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error("[image-service]", error);
    sendError(res, statusCode, error.message || "服务暂时不可用，请稍后重试。");
  });
}).listen(PORT, () => {
  console.log(`[image-service] listening on :${PORT}`);
});
