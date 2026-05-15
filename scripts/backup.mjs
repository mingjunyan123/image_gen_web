import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DATA_DIR = process.env.IMAGE_DATA_DIR || "/data/image-service";
const DB_PATH = path.join(DATA_DIR, "app.db");
const IMAGE_DIR = path.join(DATA_DIR, "images");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

await mkdir(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dbBackupPath = path.join(BACKUP_DIR, `image-service-${stamp}.db`);
const imageArchivePath = path.join(BACKUP_DIR, `image-service-images-${stamp}.tar.gz`);

const db = new DatabaseSync(DB_PATH);
db.exec(`VACUUM INTO '${dbBackupPath.replaceAll("'", "''")}'`);
db.close();

const tar = spawnSync("tar", ["-czf", imageArchivePath, "-C", IMAGE_DIR, "."], { stdio: "inherit" });
if (tar.status !== 0) {
  throw new Error("Image archive backup failed.");
}

const liveDb = new DatabaseSync(DB_PATH);
liveDb.exec(`
  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_path TEXT NOT NULL,
    images_archive_path TEXT,
    created_at INTEGER NOT NULL
  )
`);
liveDb.prepare("INSERT INTO backups (backup_path, images_archive_path, created_at) VALUES (?, ?, ?)")
  .run(dbBackupPath, imageArchivePath, Date.now());
liveDb.close();

console.log(`Database backup: ${dbBackupPath}`);
console.log(`Images backup: ${imageArchivePath}`);
