import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID, createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import Busboy from "busboy";
import { ZipFile } from "yazl";
import { z } from "zod";
import { openDatabase } from "./database";
import { Auth, hashToken, secret, type Identity } from "./auth";
import { GameError, requireThat } from "./errors";
import { migratePhotos } from "./photo-database";
import { canStand, type WorldMap } from "../shared/world";
import config from "../../content/map-config.json";
import {
  photoLimits,
  poseInput,
  sourcePoint,
  receiptSchema,
  type PhotoPose,
  type PhotoRecord,
  type PhotoManifest,
} from "../shared/photos";
export type PhotoOptions = {
  databasePath: string;
  storagePath: string;
  world: WorldMap;
  origins: string[];
  distPath?: string;
  secureCookies?: boolean;
  repoPath?: string;
  ownerDailyLimit?: number;
  ipDailyLimit?: number;
};
export const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
type Row = {
  id: string;
  owner_hash: string;
  request_id: string;
  revision: number;
  pose: string;
  note: string;
  status: PhotoRecord["status"];
  draft: number;
  created_at: number;
  sha256: string;
  preview_sha256: string;
  original_name: string;
  width: number;
  height: number;
  format: string;
  captured_at: string | null;
  captured_source: "user" | null;
  applied_version: string | null;
  maintenance_note: string;
};
const publicPhoto = (r: Row): PhotoRecord => ({
  id: r.id,
  revision: r.revision,
  pose: JSON.parse(r.pose),
  note: r.note,
  status: r.status,
  draft: !!r.draft,
  createdAt: r.created_at,
  sha256: r.sha256,
  previewSha256: r.preview_sha256,
  originalName: r.original_name,
  width: r.width,
  height: r.height,
  format: r.format,
  capturedAt: r.captured_at,
  capturedAtSource: r.captured_source,
  appliedVersion: r.applied_version,
  maintenanceNote: r.maintenance_note,
});
const cookieValue = (req: Request, key: string) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(key + "="))
    ?.slice(key.length + 1);
export function createPhotoApp(options: PhotoOptions) {
  const db = openDatabase(options.databasePath);
  migratePhotos(db);
  const auth = new Auth(db),
    app = express(),
    root = resolve(options.storagePath),
    origins = new Set(options.origins);
  let processing = 0;
  const ready = mkdir(root, { recursive: true, mode: 0o700 });
  const audit = (actor: string, action: string, target: string) =>
    db.sqlite
      .prepare(
        "INSERT INTO photo_audit(actor,action,target,created_at) VALUES(?,?,?,?)",
      )
      .run(actor, action, target, Date.now());
  const cookie = (name: string, value: string, maxAge = 31536000) =>
    name +
    "=" +
    value +
    "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
    maxAge +
    (options.secureCookies ? "; Secure" : "");
  const admin = (req: Request): Identity => {
    const u = auth.session(cookieValue(req, "ustvalley_session"));
    requireThat(u?.role === "admin", "FORBIDDEN", "需要管理员登录", 403);
    return u;
  };
  const owner = (req: Request) => {
    const token = cookieValue(req, "ustvalley_photos");
    requireThat(
      token && token.length <= 100,
      "PHOTO_SESSION_REQUIRED",
      "请重新打开照片采集界面",
      401,
    );
    const o = db.sqlite
      .prepare("SELECT * FROM photo_owners WHERE hash=?")
      .get(hashToken(token)) as { hash: string; csrf: string } | undefined;
    requireThat(o, "PHOTO_SESSION_REQUIRED", "采集身份已失效", 401);
    return o;
  };
  const ownerWrite = (req: Request) => {
    const o = owner(req);
    requireThat(
      req.headers["x-photo-csrf"] === o.csrf,
      "CSRF_FAILED",
      "请刷新采集界面",
      403,
    );
    return o;
  };
  const adminWrite = (req: Request) => {
    const u = admin(req);
    auth.csrf(u, req.headers["x-csrf-token"]);
    return u;
  };
  const get = (id: string) =>
    db.sqlite.prepare("SELECT * FROM photos WHERE id=?").get(id) as
      | Row
      | undefined;
  const accessible = (req: Request) => {
    const p = get(String(req.params.id));
    requireThat(p, "NOT_FOUND", "照片不存在", 404);
    const u = auth.session(cookieValue(req, "ustvalley_session"));
    if (u?.role !== "admin")
      requireThat(
        owner(req).hash === p.owner_hash,
        "NOT_FOUND",
        "照片不存在",
        404,
      );
    return p;
  };
  const invalidate = (id: string) => {
    const rows = db.sqlite
      .prepare("SELECT id,manifest FROM photo_batches")
      .all() as { id: string; manifest: string }[];
    for (const b of rows)
      if (
        (JSON.parse(b.manifest) as PhotoManifest).photos.some(
          (p) => p.id === id,
        )
      )
        db.sqlite
          .prepare("UPDATE photo_batches SET stale=1 WHERE id=?")
          .run(b.id);
  };
  const validatePose = (raw: unknown): PhotoPose => {
    const p = poseInput.parse(raw),
      s = options.world.scenes.find((s) => s.id === p.sceneId);
    requireThat(s, "INVALID_SCENE", "场景不存在");
    requireThat(
      p.mapVersion === options.world.mapVersion,
      "VERSION_MISMATCH",
      "地图已更新，请刷新后重新确认位置",
      409,
    );
    requireThat(
      p.x >= 0 &&
        p.y >= 0 &&
        p.x < s.width * s.tileSize &&
        p.y < s.height * s.tileSize,
      "INVALID_POSITION",
      "位置超出所选场景",
    );
    requireThat(
      !p.buildingId ||
        options.world.buildings.some((b) => b.id === p.buildingId),
      "INVALID_BUILDING",
      "建筑编号无效",
    );
    requireThat(
      canStand(s, p) || p.blockedConfirmed,
      "POSITION_CONFIRMATION_REQUIRED",
      "这里在当前地图中不可行走，请确认实际拍摄位置",
    );
    return {
      ...p,
      sourceMap: s.sourceMap,
      floorKey: s.floor.key,
      floorName: s.floor.name,
      elevation: s.floor.elevation,
      source: sourcePoint(s, p),
      transform: config.transform,
      scale: s.units.pixelsPerProjectedUnit,
      offset: s.sourceOffset,
    };
  };
  const throttle = (key: string, limit: number) => {
    const now = Date.now(),
      r = db.sqlite
        .prepare("SELECT count,expires_at FROM photo_limits WHERE key=?")
        .get(key) as { count: number; expires_at: number } | undefined;
    requireThat(
      !r || r.expires_at <= now || r.count < limit,
      "RATE_LIMITED",
      "今日上传次数已达上限，请明天再试",
      429,
    );
    db.sqlite
      .prepare(
        "INSERT INTO photo_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at",
      )
      .run(
        key,
        r && r.expires_at > now ? r.count + 1 : 1,
        r && r.expires_at > now ? r.expires_at : now + 86400000,
      );
  };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
    }
    if (
      req.path.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !origins.has(req.headers.origin ?? "")
    )
      return next(new GameError("ORIGIN_REJECTED", "请从校园页面操作", 403));
    next();
  });
  app.use("/api", express.json({ limit: "256kb" }));
  app.get("/health/ready", (_q, r) =>
    r.json({ ready: true, mapVersion: options.world.mapVersion }),
  );
  app.get("/api/v1/me", (req, res) => {
    const u = auth.session(cookieValue(req, "ustvalley_session"));
    res.json({
      user: u
        ? { id: u.id, username: u.username, nickname: u.nickname, role: u.role }
        : null,
      csrf: u?.csrf,
    });
  });
  app.post("/api/v1/auth/login", async (req, res) => {
    const result = await auth.login(req.body, req.ip ?? "unknown");
    requireThat(
      result.identity.role === "admin",
      "FORBIDDEN",
      "此入口仅供维护者使用",
      403,
    );
    res.setHeader(
      "Set-Cookie",
      cookie("ustvalley_session", result.token, 604800),
    );
    res.json({
      user: {
        id: result.identity.id,
        role: result.identity.role,
        nickname: result.identity.nickname,
      },
      csrf: result.identity.csrf,
    });
  });
  app.post("/api/v1/auth/logout", (req, res) => {
    const u = adminWrite(req);
    auth.logout(u);
    res.setHeader("Set-Cookie", cookie("ustvalley_session", "", 0));
    res.json({ ok: true });
  });
  app.post("/api/v1/photo-session", (req, res) => {
    let o: { hash: string; csrf: string } | undefined;
    const existing = cookieValue(req, "ustvalley_photos");
    if (existing && existing.length <= 100)
      o = db.sqlite
        .prepare("SELECT hash,csrf FROM photo_owners WHERE hash=?")
        .get(hashToken(existing)) as typeof o;
    if (!o) {
      const token = secret();
      o = { hash: hashToken(token), csrf: secret() };
      db.sqlite
        .prepare("INSERT INTO photo_owners VALUES(?,?,?)")
        .run(o.hash, o.csrf, Date.now());
      res.setHeader("Set-Cookie", cookie("ustvalley_photos", token));
    }
    res.json({
      csrf: o.csrf,
      limits: photoLimits,
      mapVersion: options.world.mapVersion,
    });
  });
  app.post("/api/v1/photos", async (req, res) => {
    const o = ownerWrite(req),
      requestId = z.string().uuid().parse(req.headers["x-upload-id"]);
    const previous = db.sqlite
      .prepare("SELECT * FROM photos WHERE owner_hash=? AND request_id=?")
      .get(o.hash, requestId) as Row | undefined;
    if (previous) {
      req.resume();
      res.json(publicPhoto(previous));
      return;
    }
    requireThat(processing < 2, "BUSY", "照片正在处理中，请稍后重试", 503);
    throttle("owner:" + o.hash, options.ownerDailyLimit ?? 100);
    throttle("ip:" + digest(req.ip ?? "unknown"), options.ipDailyLimit ?? 500);
    req.setTimeout(120000, () => req.destroy(new Error("Upload timeout")));
    processing++;
    let cleanupTemp: string | undefined;
    try {
      await ready;
      const temp = await mkdtemp(join(root, ".upload-"));
      cleanupTemp = temp;
      const fields: Record<string, string> = {};
      let filename = "",
        fileCount = 0,
        tooLarge = false,
        ioError: unknown;
      await new Promise<void>((resolveUpload, reject) => {
        const writes: Promise<unknown>[] = [];
        const bus = Busboy({
          headers: req.headers,
          limits: {
            files: 1,
            fields: 4,
            fileSize: photoLimits.bytes,
            fieldSize: 16384,
            parts: 5,
          },
        });
        bus.on("field", (name, value, info) => {
          if (info.valueTruncated) tooLarge = true;
          fields[name] = value;
        });
        bus.on("file", (_name, file, info) => {
          fileCount++;
          filename =
            (info.filename ?? "photo")
              .replace(/[\\/\r\n]/g, "_")
              .slice(0, 160) || "photo";
          file.on("limit", () => {
            tooLarge = true;
          });
          writes.push(
            pipeline(
              file,
              createWriteStream(join(temp, "original"), { mode: 0o600 }),
            ).catch((e) => {
              ioError = e;
            }),
          );
        });
        for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
          bus.on(event, () => {
            tooLarge = true;
          });
        bus.on("error", reject);
        req.once("aborted", () => {
          bus.destroy();
          reject(new GameError("ABORTED", "上传已取消", 400));
        });
        bus.on("close", () => {
          Promise.all(writes).then(
            () => (ioError ? reject(ioError) : resolveUpload()),
            reject,
          );
        });
        req.pipe(bus);
      });
      requireThat(
        !tooLarge && fileCount === 1,
        "INVALID_UPLOAD",
        "请选择一张不超过 25 MB 的照片",
        413,
      );
      const pose = validatePose(JSON.parse(fields.pose ?? "null"));
      const note = z
        .string()
        .max(1000)
        .parse(fields.note ?? "");
      const captured = z
        .string()
        .datetime({ offset: true })
        .nullable()
        .parse(fields.capturedAt || null);
      await new Promise<void>((ok, no) => {
        const child = spawn(
          process.execPath,
          [
            "--max-old-space-size=512",
            "--import",
            "tsx",
            resolve(import.meta.dirname, "photo-image-worker.ts"),
            join(temp, "original"),
            join(temp, "preview.webp"),
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (d) => {
          stderr = (stderr + String(d)).slice(-2000);
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 35000);
        child.once("error", (e) => {
          clearTimeout(timer);
          no(e);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0
            ? ok()
            : no(
                new GameError(
                  "INVALID_IMAGE",
                  "无法解码此照片、像素超限或处理超时，请使用静态照片",
                  422,
                ),
              );
        });
      });
      const meta = JSON.parse(
        await readFile(join(temp, "preview.webp.json"), "utf8"),
      );
      const sha = digest(await readFile(join(temp, "original"))),
        previewSha = digest(await readFile(join(temp, "preview.webp")));
      const id = randomUUID();
      await rename(temp, join(root, id));
      try {
        db.sqlite
          .prepare(
            "INSERT INTO photos(id,owner_hash,request_id,pose,note,created_at,sha256,preview_sha256,original_name,width,height,format,captured_at,captured_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            o.hash,
            requestId,
            JSON.stringify(pose),
            note,
            Date.now(),
            sha,
            previewSha,
            filename,
            meta.width,
            meta.height,
            meta.format,
            captured,
            captured ? "user" : null,
          );
      } catch (e) {
        await rm(join(root, id), { recursive: true, force: true });
        const duplicate = db.sqlite
          .prepare("SELECT * FROM photos WHERE owner_hash=? AND request_id=?")
          .get(o.hash, requestId) as Row | undefined;
        if (duplicate) {
          res.json(publicPhoto(duplicate));
          return;
        }
        throw e;
      }
      res.status(201).json(publicPhoto(get(id)!));
    } finally {
      processing--;
      if (cleanupTemp) await rm(cleanupTemp, { recursive: true, force: true });
    }
  });
  app.post("/api/v1/photos/:id/confirm", (req, res) => {
    const o = ownerWrite(req),
      p = accessible(req);
    requireThat(
      p.owner_hash === o.hash,
      "FORBIDDEN",
      "只能确认自己的照片",
      403,
    );
    validatePose(poseInput.strip().parse(JSON.parse(p.pose)));
    db.sqlite.prepare("UPDATE photos SET draft=0 WHERE id=?").run(p.id);
    res.json(publicPhoto(get(p.id)!));
  });
  app.get("/api/v1/photos", (req, res) => {
    const o = owner(req);
    res.json(
      (
        db.sqlite
          .prepare(
            "SELECT * FROM photos WHERE owner_hash=? AND draft=0 ORDER BY created_at DESC LIMIT 500",
          )
          .all(o.hash) as Row[]
      ).map(publicPhoto),
    );
  });
  app.get("/api/v1/photos/:id", (req, res) =>
    res.json(publicPhoto(accessible(req))),
  );
  app.get("/api/v1/photos/:id/:variant", (req, res) => {
    const p = accessible(req),
      variant = req.params.variant;
    requireThat(
      variant === "original" || variant === "preview",
      "NOT_FOUND",
      "资源不存在",
      404,
    );
    if (variant === "original") {
      const u = auth.session(cookieValue(req, "ustvalley_session"));
      audit(u?.id ?? p.owner_hash, "download", p.id);
      res.type("application/octet-stream");
      res.attachment(p.original_name);
    } else res.type("image/webp");
    res.sendFile(
      join(root, p.id, variant === "original" ? "original" : "preview.webp"),
    );
  });
  app.patch("/api/v1/photos/:id", (req, res) => {
    const o = ownerWrite(req),
      p = accessible(req);
    requireThat(
      p.owner_hash === o.hash,
      "FORBIDDEN",
      "只能修改自己的标注",
      403,
    );
    requireThat(
      req.body.revision === p.revision,
      "REVISION_CONFLICT",
      "标注已变化，请重新打开",
      409,
    );
    const pose = validatePose(req.body.pose),
      note = z
        .string()
        .max(1000)
        .parse(req.body.note ?? p.note);
    db.sqlite.transaction(() => {
      db.sqlite
        .prepare(
          "UPDATE photos SET pose=?,note=?,revision=revision+1,status='pending',applied_version=NULL WHERE id=?",
        )
        .run(JSON.stringify(pose), note, p.id);
      invalidate(p.id);
      audit(o.hash, "edit", p.id);
    })();
    res.json(publicPhoto(get(p.id)!));
  });
  app.delete("/api/v1/photos/:id", async (req, res) => {
    const o = ownerWrite(req),
      p = accessible(req);
    requireThat(
      p.owner_hash === o.hash,
      "FORBIDDEN",
      "只能删除自己的照片",
      403,
    );
    db.sqlite.transaction(() => {
      invalidate(p.id);
      db.sqlite.prepare("DELETE FROM photos WHERE id=?").run(p.id);
      audit(o.hash, "delete", p.id);
    })();
    await rm(join(root, p.id), { recursive: true, force: true });
    res.json({ ok: true });
  });
  app.get("/api/v1/admin/photos", (req, res) => {
    admin(req);
    let rows = (
      db.sqlite
        .prepare("SELECT * FROM photos WHERE draft=0 ORDER BY created_at DESC")
        .all() as Row[]
    ).map(publicPhoto);
    if (req.query.sceneId)
      rows = rows.filter((p) => p.pose.sceneId === req.query.sceneId);
    if (req.query.buildingId)
      rows = rows.filter((p) => p.pose.buildingId === req.query.buildingId);
    if (req.query.status)
      rows = rows.filter((p) => p.status === req.query.status);
    if (req.query.since)
      rows = rows.filter((p) => p.createdAt >= Number(req.query.since));
    res.json(rows.slice(0, 1000));
  });
  app.patch("/api/v1/admin/photos/:id", (req, res) => {
    const u = adminWrite(req),
      p = accessible(req);
    const status = z.enum(["pending", "declined"]).parse(req.body.status),
      note = z
        .string()
        .max(2000)
        .parse(req.body.note ?? "");
    requireThat(
      p.status !== "used",
      "BATCH_REQUIRED",
      "已采用记录请通过重建批次核对",
      409,
    );
    db.sqlite
      .prepare("UPDATE photos SET status=?,maintenance_note=? WHERE id=?")
      .run(status, note, p.id);
    audit(u.id, "review", p.id);
    res.json(publicPhoto(get(p.id)!));
  });
  app.post("/api/v1/admin/photos/export", async (req, res) => {
    const u = adminWrite(req),
      ids = z
        .array(z.string().uuid())
        .min(1)
        .max(photoLimits.batch)
        .parse(req.body.ids);
    requireThat(
      new Set(ids).size === ids.length,
      "DUPLICATE",
      "不能重复导出同一记录",
    );
    const rows = ids.map((id) => {
      const p = get(id);
      requireThat(p && !p.draft, "NOT_FOUND", "照片不存在", 404);
      return p;
    });
    const batchId = randomUUID();
    const manifest: PhotoManifest = {
      schemaVersion: 1,
      batchId,
      createdAt: Date.now(),
      photos: rows.map((p) => ({
        id: p.id,
        revision: p.revision,
        sha256: p.sha256,
        previewSha256: p.preview_sha256,
        original: "originals/" + p.id + "." + p.format,
        preview: "previews/" + p.id + ".webp",
        pose: JSON.parse(p.pose),
        note: p.note,
        capturedAt: p.captured_at,
        capturedAtSource: p.captured_source,
      })),
    };
    const serialized = JSON.stringify(manifest, null, 2) + "\n";
    const zip = new ZipFile();
    // Read files before writing response, so deleting a record cannot produce a silently truncated bundle.
    for (const p of manifest.photos) {
      zip.addBuffer(await readFile(join(root, p.id, "original")), p.original);
      zip.addBuffer(
        await readFile(join(root, p.id, "preview.webp")),
        p.preview,
      );
    }
    zip.addBuffer(Buffer.from(serialized), "manifest.json");
    zip.addBuffer(
      Buffer.from(
        "id,scene,floor,heading,pitch\n" +
          manifest.photos
            .map((p) =>
              [
                p.id,
                p.pose.sceneId,
                p.pose.floorKey,
                p.pose.heading,
                p.pose.pitch ?? "",
              ].join(","),
            )
            .join("\n"),
      ),
      "index.csv",
    );
    zip.addBuffer(
      Buffer.from(
        "Coordinates: source projected grid; heading clockwise from source-grid north; pitch positive upward. Markers are photographer positions, not target positions. Original metadata is private.\n",
      ),
      "COORDINATES.txt",
    );
    db.sqlite
      .prepare(
        "INSERT INTO photo_batches(id,manifest,manifest_hash,created_at) VALUES(?,?,?,?)",
      )
      .run(batchId, serialized, digest(serialized), Date.now());
    audit(u.id, "export", batchId);
    res.setHeader("X-Photo-Batch-ID", batchId);
    res.type("application/zip").attachment("photos-" + batchId + ".zip");
    zip.outputStream.pipe(res);
    zip.end();
  });
  app.get("/api/v1/admin/photo-batches", (req, res) => {
    admin(req);
    res.json(
      db.sqlite
        .prepare(
          "SELECT id,status,stale,created_at,receipt,merged_commit FROM photo_batches ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
    );
  });
  app.post("/api/v1/admin/photo-batches/:id/start", (req, res) => {
    const u = adminWrite(req);
    const result = db.sqlite
      .prepare(
        "UPDATE photo_batches SET status='processing' WHERE id=? AND status='pending' AND stale=0",
      )
      .run(String(req.params.id));
    requireThat(
      result.changes,
      "INVALID_BATCH",
      "批次不存在、已开始或已过期",
      409,
    );
    audit(u.id, "start", String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/v1/admin/photo-batches/:id/receipt", (req, res) => {
    const u = adminWrite(req),
      receipt = receiptSchema.parse(req.body);
    requireThat(
      receipt.batchId === req.params.id,
      "INVALID_BATCH",
      "批次不匹配",
    );
    const b = db.sqlite
      .prepare("SELECT * FROM photo_batches WHERE id=?")
      .get(receipt.batchId) as
      | {
          manifest: string;
          manifest_hash: string;
          receipt_hash: string | null;
          status: string;
          stale: number;
        }
      | undefined;
    requireThat(b, "NOT_FOUND", "批次不存在", 404);
    requireThat(!b.stale, "STALE_BATCH", "照片标注已变化，需要重新导出", 409);
    const hash = digest(JSON.stringify(receipt));
    if (b.receipt_hash === hash) {
      res.json({ ok: true, duplicate: true });
      return;
    }
    requireThat(
      b.status !== "merged",
      "ALREADY_MERGED",
      "已合入批次不能替换回执",
      409,
    );
    requireThat(
      b.manifest_hash === receipt.manifestHash,
      "INVALID_MANIFEST",
      "清单哈希不匹配",
    );
    const manifest = JSON.parse(b.manifest) as PhotoManifest;
    requireThat(
      receipt.photos.length === manifest.photos.length &&
        new Set(receipt.photos.map((p) => p.id)).size === receipt.photos.length,
      "INVALID_RECEIPT",
      "必须逐条报告全部照片",
    );
    for (const p of receipt.photos) {
      const original = manifest.photos.find((v) => v.id === p.id),
        current = get(p.id);
      requireThat(
        original &&
          current &&
          original.sha256 === p.sha256 &&
          current.sha256 === p.sha256 &&
          original.revision === p.revision &&
          current.revision === p.revision,
        "STALE_BATCH",
        "照片或标注已经变化",
        409,
      );
    }
    requireThat(
      receipt.status !== "review" || receipt.verification.passed,
      "VERIFICATION_FAILED",
      "验证未通过，不能进入待审核",
    );
    db.sqlite
      .prepare(
        "UPDATE photo_batches SET receipt=?,receipt_hash=?,status=? WHERE id=?",
      )
      .run(JSON.stringify(receipt), hash, receipt.status, receipt.batchId);
    audit(u.id, "receipt", receipt.batchId);
    res.json({ ok: true });
  });
  app.post("/api/v1/admin/photo-batches/:id/merge", async (req, res) => {
    const u = adminWrite(req),
      id = String(req.params.id);
    const b = db.sqlite
      .prepare("SELECT * FROM photo_batches WHERE id=?")
      .get(id) as
      | { status: string; stale: number; receipt: string }
      | undefined;
    requireThat(
      b && b.status === "review" && !b.stale,
      "INVALID_BATCH",
      "批次未通过审核或已过期",
      409,
    );
    const receipt = receiptSchema.parse(JSON.parse(b.receipt)),
      version = z.string().min(1).max(100).parse(req.body.version);
    requireThat(
      req.body.confirm === true,
      "CONFIRM_REQUIRED",
      "请确认已审核并合入",
    );
    requireThat(
      options.repoPath,
      "REPO_UNAVAILABLE",
      "服务端未配置仓库核对路径",
      503,
    );
    await new Promise<void>((ok, no) => {
      const p = spawn(
        "git",
        ["merge-base", "--is-ancestor", receipt.commit, "refs/heads/main"],
        { cwd: options.repoPath, stdio: "ignore" },
      );
      p.on("error", no);
      p.on("exit", (code) =>
        code === 0
          ? ok()
          : no(
              new GameError(
                "NOT_MERGED",
                "本地 main 尚未包含该提交，请先同步已审核的主分支",
                409,
              ),
            ),
      );
    });
    db.sqlite.transaction(() => {
      for (const p of receipt.photos) {
        const current = get(p.id);
        requireThat(
          current &&
            current.revision === p.revision &&
            current.sha256 === p.sha256,
          "STALE_BATCH",
          "照片已变化",
          409,
        );
        if (p.outcome === "applied")
          db.sqlite
            .prepare(
              "UPDATE photos SET status='used',applied_version=? WHERE id=?",
            )
            .run(version + " @ " + receipt.commit, p.id);
      }
      db.sqlite
        .prepare(
          "UPDATE photo_batches SET status='merged',merged_commit=? WHERE id=?",
        )
        .run(receipt.commit, id);
      audit(u.id, "merged", id);
    })();
    res.json({ ok: true });
  });
  app.use("/api", (_q, r) => r.status(404).json({ message: "接口不存在" }));
  if (options.distPath)
    app.use(express.static(resolve(options.distPath), { dotfiles: "deny" }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const known = err instanceof GameError;
    res
      .status(
        known
          ? err.status
          : err instanceof z.ZodError || err instanceof SyntaxError
            ? 400
            : 500,
      )
      .json({
        code: known ? err.code : "REQUEST_FAILED",
        message: known
          ? err.message
          : err instanceof z.ZodError || err instanceof SyntaxError
            ? "输入格式无效"
            : "服务暂时不可用，请稍后重试",
      });
  });
  const cleanup = async () => {
    await ready;
    const now = Date.now();
    for (const name of await readdir(root)) {
      const path = join(root, name),
        s = await stat(path);
      if (now - s.mtimeMs < 86400000) continue;
      const row = get(name);
      if (
        name.startsWith(".upload-") ||
        (!row && /^[a-f0-9-]{36}$/.test(name)) ||
        row?.draft
      ) {
        if (row?.draft)
          db.sqlite
            .prepare("DELETE FROM photos WHERE id=? AND draft=1")
            .run(name);
        await rm(path, { recursive: true, force: true });
      }
    }
    db.sqlite.prepare("DELETE FROM photo_limits WHERE expires_at<?").run(now);
  };
  const timer = setInterval(() => void cleanup().catch(() => {}), 3600000);
  timer.unref();
  return {
    app,
    db,
    auth,
    cleanup,
    close() {
      clearInterval(timer);
      db.sqlite.close();
    },
  };
}
