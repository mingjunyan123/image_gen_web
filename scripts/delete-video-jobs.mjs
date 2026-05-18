import { DatabaseSync } from "node:sqlite";
import { rm } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.IMAGE_DATA_DIR || "/data/image-service";
const DB_PATH = path.join(DATA_DIR, "app.db");
const VIDEO_DIR = path.join(DATA_DIR, "videos");

function safeVideoPath(relativePath) {
  if (!relativePath) return null;
  const fullPath = path.resolve(VIDEO_DIR, relativePath);
  if (!fullPath.startsWith(path.resolve(VIDEO_DIR) + path.sep)) {
    throw new Error(`Invalid video path: ${relativePath}`);
  }
  return fullPath;
}

const db = new DatabaseSync(DB_PATH);
const rows = db.prepare(`
  SELECT id, source_image_path, result_image_path, result_media_path
  FROM jobs
  WHERE media_type = 'video'
`).all();

const deleteResult = db.prepare("DELETE FROM jobs WHERE media_type = 'video'").run();
db.close();

const paths = new Set();
for (const row of rows) {
  for (const relativePath of [row.source_image_path, row.result_media_path, row.result_image_path]) {
    if (relativePath) paths.add(safeVideoPath(relativePath));
  }
}

let deletedFiles = 0;
for (const fullPath of paths) {
  await rm(fullPath, { force: true }).then(() => {
    deletedFiles += 1;
  });
}

console.log(`Deleted video jobs: ${deleteResult.changes}`);
console.log(`Deleted video files: ${deletedFiles}`);
