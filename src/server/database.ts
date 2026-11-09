import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const version = sqlite.pragma("user_version", { simple: true }) as number;
  if (version > 1)
    throw new Error("Database schema is newer than this application");
  if (version === 0)
    sqlite.transaction(() => {
      sqlite.exec(`
 CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),banned INTEGER NOT NULL DEFAULT 0,note_muted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
 CREATE TABLE sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX sessions_account ON sessions(account_id);
 CREATE TABLE tickets(hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE characters(account_id TEXT PRIMARY KEY REFERENCES accounts(id),progress TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE currency_ledger(id INTEGER PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0),reason TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(account_id,source));
 CREATE TABLE receipts(account_id TEXT NOT NULL REFERENCES accounts(id),operation TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,operation,request_id));
 CREATE TABLE chests(id TEXT PRIMARY KEY,generation INTEGER NOT NULL DEFAULT 0,ready_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE chest_claims(chest_id TEXT NOT NULL REFERENCES chests(id),generation INTEGER NOT NULL,account_id TEXT NOT NULL REFERENCES accounts(id),created_at INTEGER NOT NULL,PRIMARY KEY(chest_id,generation));
 CREATE TABLE notes(id TEXT PRIMARY KEY,author_id TEXT NOT NULL REFERENCES accounts(id),scene_id TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('visible','hidden','deleted')),created_at INTEGER NOT NULL,deleted_at INTEGER);
 CREATE UNIQUE INDEX note_active_cell ON notes(scene_id,x,y) WHERE status='visible';
 CREATE INDEX notes_scene ON notes(scene_id,status,created_at,id);
 CREATE TABLE note_likes(note_id TEXT NOT NULL REFERENCES notes(id),account_id TEXT NOT NULL REFERENCES accounts(id),created_at INTEGER NOT NULL,PRIMARY KEY(note_id,account_id));
 CREATE TABLE note_reports(note_id TEXT NOT NULL REFERENCES notes(id),account_id TEXT NOT NULL REFERENCES accounts(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER,PRIMARY KEY(note_id,account_id));
 CREATE TABLE admin_audit(id INTEGER PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES accounts(id),action TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE reset_tokens(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 PRAGMA user_version = 1;
 `);
    })();
  return { sqlite, orm: drizzle(sqlite) };
}
