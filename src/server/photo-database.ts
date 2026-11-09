import type { openDatabase } from "./database";
export function migratePhotos(db: ReturnType<typeof openDatabase>) {
  db.sqlite.exec(`
 CREATE TABLE IF NOT EXISTS photo_schema(version INTEGER NOT NULL);
 INSERT INTO photo_schema SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM photo_schema);
 CREATE TABLE IF NOT EXISTS photo_owners(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,owner_hash TEXT NOT NULL REFERENCES photo_owners(hash),request_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, pose TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',
 draft INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,sha256 TEXT NOT NULL,preview_sha256 TEXT NOT NULL,
 original_name TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,format TEXT NOT NULL,
 captured_at TEXT,captured_source TEXT,applied_version TEXT,maintenance_note TEXT NOT NULL DEFAULT '',
 UNIQUE(owner_hash,request_id));
 CREATE INDEX IF NOT EXISTS photos_owner ON photos(owner_hash,created_at);
 CREATE TABLE IF NOT EXISTS photo_batches(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,manifest_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 receipt TEXT,receipt_hash TEXT,stale INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,merged_commit TEXT);
 CREATE TABLE IF NOT EXISTS photo_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS photo_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 `);
  const row = db.sqlite.prepare("SELECT version FROM photo_schema").get() as {
    version: number;
  };
  if (row.version !== 1) throw new Error("Unsupported photo database version");
}
