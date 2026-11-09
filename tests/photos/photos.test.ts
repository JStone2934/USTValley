import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ZipFile } from "yazl";
import { createPhotoApp, digest } from "../../src/server/photo-app";
import {
  sourcePoint,
  scenePoint,
  headingVector,
  vectorHeading,
  reproject,
  type PhotoManifest,
} from "../../src/shared/photos";
import type { WorldMap } from "../../src/shared/world";
import { extractBundle, safeEntry } from "../../scripts/photo-bundle";
const world: WorldMap = JSON.parse(
  await readFile("public/maps/world.json", "utf8"),
);
test("source coordinate and heading round trips survive rotated maps and floor offsets", () => {
  for (const s of world.scenes) {
    const p = { x: s.width * 8, y: s.height * 8 },
      q = scenePoint(s, sourcePoint(s, p));
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6);
  }
  for (const a of [0, 30, 90, 180, 270, 359]) {
    const b = vectorHeading(headingVector(a));
    assert.ok(Math.abs(a - b) < 1e-8 || Math.abs(a - b + 360) < 1e-8);
  }
  assert.notEqual(headingVector(0).x, 0);
});
test("archive path checks reject traversal, Windows paths and empty segments", () => {
  for (const p of [
    "../secret",
    "/etc/passwd",
    "C:/secret",
    "a\\b",
    "a//b",
    "./x",
    "a/../x",
  ])
    assert.throws(() => safeEntry(p));
  assert.equal(safeEntry("previews/example.webp"), "previews/example.webp");
});
test("private upload, originals, admin export and revision-safe receipts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ust-photos-test-"));
  let service = createPhotoApp({
    databasePath: join(dir, "db.sqlite"),
    storagePath: join(dir, "photos"),
    world,
    origins: ["http://photo.test"],
    repoPath: resolve("."),
  });
  let server = service.app.listen(0, "127.0.0.1");
  await new Promise<void>((ok) => server.once("listening", ok));
  let base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + "/api/v1/" + path, {
      method,
      headers: {
        Origin: "http://photo.test",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const start = await req("photo-session", "POST"),
      cookie = start.headers.get("set-cookie")!.split(";")[0],
      session = (await start.json()) as any;
    const other = await req("photo-session", "POST"),
      otherCookie = other.headers.get("set-cookie")!.split(";")[0];
    const ownerHeaders = { Cookie: cookie, "X-Photo-CSRF": session.csrf };
    const s = world.scenes.find((s) => s.id === "interior_academic_f2")!;
    const pose = {
      sceneId: s.id,
      mapVersion: world.mapVersion,
      x: 430,
      y: 510,
      heading: 30,
      pitch: null,
      buildingId: "C3",
      blockedConfirmed: true,
    };
    const picture = await sharp({
      create: { width: 64, height: 96, channels: 3, background: "#558c93" },
    })
      .jpeg()
      .toBuffer();
    const upload = async (
      bytes: Buffer = picture,
      customPose = pose,
      id = randomUUID(),
      extra: Record<string, string> = {},
    ) => {
      const form = new FormData();
      form.append("pose", JSON.stringify(customPose));
      form.append("file", new Blob([new Uint8Array(bytes)]), "photo.jpg");
      return fetch(base + "/api/v1/photos", {
        method: "POST",
        headers: {
          Origin: "http://photo.test",
          ...ownerHeaders,
          "X-Upload-ID": id,
          ...extra,
        },
        body: form,
      });
    };
    const uploadId = randomUUID(),
      r = await upload(picture, pose, uploadId);
    assert.equal(r.status, 201, await r.clone().text());
    const photo = (await r.json()) as any;
    assert.equal(photo.draft, true);
    assert.equal(
      (
        (await (
          await req("photos", "GET", undefined, { Cookie: cookie })
        ).json()) as any[]
      ).length,
      0,
    );
    assert.equal((await upload(picture, pose, uploadId)).status, 200);
    assert.equal(
      service.db.sqlite.prepare("SELECT count(*) AS n FROM photos").get() &&
        (
          service.db.sqlite
            .prepare("SELECT count(*) AS n FROM photos")
            .get() as any
        ).n,
      1,
    );
    assert.equal(
      (
        await req("photos/" + photo.id + "/original", "GET", undefined, {
          Cookie: otherCookie,
        })
      ).status,
      404,
    );
    assert.equal((await req("photos/" + photo.id + "/original")).status, 401);
    assert.equal(
      (
        await req(
          "photos/" + photo.id + "/confirm",
          "POST",
          {},
          { Cookie: cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (await req("photos/" + photo.id + "/confirm", "POST", {}, ownerHeaders))
        .status,
      200,
    );
    const original = Buffer.from(
      await (
        await req("photos/" + photo.id + "/original", "GET", undefined, {
          Cookie: cookie,
        })
      ).arrayBuffer(),
    );
    assert.equal(digest(original), digest(picture));
    const preview = await req(
      "photos/" + photo.id + "/preview",
      "GET",
      undefined,
      { Cookie: cookie },
    );
    assert.equal(preview.headers.get("content-type"), "image/webp");
    assert.equal(
      (await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).exif,
      undefined,
    );
    const oriented = await sharp({
      create: { width: 40, height: 60, channels: 3, background: "#448899" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const rotatedResponse = await upload(oriented),
      rotated = (await rotatedResponse.json()) as any;
    assert.equal(rotatedResponse.status, 201);
    const rotatedPreview = await req(
      "photos/" + rotated.id + "/preview",
      "GET",
      undefined,
      ownerHeaders,
    );
    const rotatedMeta = await sharp(
      Buffer.from(await rotatedPreview.arrayBuffer()),
    ).metadata();
    assert.equal(rotatedMeta.width, 60);
    assert.equal(rotatedMeta.height, 40);
    const concurrent = await Promise.all([upload(), upload(), upload()]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 201, 503]);
    assert.equal(
      (await upload(Buffer.alloc(25 * 1024 * 1024 + 1))).status,
      413,
    );
    assert.equal((await upload(Buffer.from("not an image"))).status, 422);
    assert.equal(
      (await upload(picture, { ...pose, mapVersion: "old-map" })).status,
      409,
    );
    assert.equal((await upload(picture, { ...pose, x: -1 })).status, 400);
    assert.equal(
      (
        await upload(picture, pose, randomUUID(), {
          Origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await req("admin/photos", "GET", undefined, { Cookie: cookie })).status,
      403,
    );
    const user = await service.auth.register(
      {
        username: "admin_test",
        password: "long-random-test-password",
        nickname: "测试维护者",
      },
      "local",
    );
    service.db.sqlite
      .prepare("UPDATE accounts SET role='admin' WHERE id=?")
      .run(user.identity.id);
    const login = await req("auth/login", "POST", {
        username: "admin_test",
        password: "long-random-test-password",
      }),
      loginData = (await login.json()) as any;
    const adminHeaders = {
      Cookie: login.headers.get("set-cookie")!.split(";")[0],
      "X-CSRF-Token": loginData.csrf,
    };
    const exported = await req(
      "admin/photos/export",
      "POST",
      { ids: [photo.id] },
      adminHeaders,
    );
    assert.equal(exported.status, 200, await exported.clone().text());
    const zipPath = join(dir, "bundle.zip");
    await writeFile(zipPath, Buffer.from(await exported.arrayBuffer()));
    const { manifest, manifestHash } = await extractBundle(
      zipPath,
      join(dir, "extracted"),
    );
    assert.equal(manifest.photos[0].sha256, digest(picture));
    assert.equal(manifest.photos[0].capturedAt, null);
    const mapped = reproject(world, manifest.photos[0].pose);
    assert.ok(mapped);
    assert.ok(Math.abs(mapped.x - pose.x) < 1e-7);
    assert.equal(
      reproject({ ...world, scenes: [] }, manifest.photos[0].pose),
      null,
    );
    assert.equal(
      (
        await req(
          "admin/photo-batches/" + manifest.batchId + "/start",
          "POST",
          {},
          adminHeaders,
        )
      ).status,
      200,
    );
    const receipt = {
      schemaVersion: 1,
      batchId: manifest.batchId,
      manifestHash,
      baseline: "a".repeat(40),
      commit: "b".repeat(40),
      branch: "photo-rebuild/review",
      status: "review",
      verification: { passed: true, reportHash: "c".repeat(64) },
      photos: [
        {
          id: photo.id,
          revision: 1,
          sha256: photo.sha256,
          outcome: "applied",
          summary: "Corrected glass",
        },
      ],
    };
    let imported = await req(
      "admin/photo-batches/" + manifest.batchId + "/receipt",
      "POST",
      receipt,
      adminHeaders,
    );
    assert.equal(imported.status, 200, await imported.clone().text());
    assert.equal(
      (
        (await (
          await req(
            "admin/photo-batches/" + manifest.batchId + "/receipt",
            "POST",
            receipt,
            adminHeaders,
          )
        ).json()) as any
      ).duplicate,
      true,
    );
    // Two batches can share one review branch without replacing each other's receipt.
    const secondExport = await req(
      "admin/photos/export",
      "POST",
      { ids: [photo.id] },
      adminHeaders,
    );
    assert.equal(secondExport.status, 200);
    const secondZip = join(dir, "second.zip");
    await writeFile(secondZip, Buffer.from(await secondExport.arrayBuffer()));
    const secondBundle = await extractBundle(
      secondZip,
      join(dir, "second-extracted"),
    );
    const secondReceipt = {
      ...receipt,
      batchId: secondBundle.manifest.batchId,
      manifestHash: secondBundle.manifestHash,
      commit: "d".repeat(40),
      photos: receipt.photos.map((p) => ({
        ...p,
        outcome: "unchanged",
        summary: "Already represented",
      })),
    };
    const secondImport = await req(
      "admin/photo-batches/" + secondReceipt.batchId + "/receipt",
      "POST",
      secondReceipt,
      adminHeaders,
    );
    assert.equal(secondImport.status, 200, await secondImport.clone().text());
    const batches = (await (
      await req("admin/photo-batches", "GET", undefined, adminHeaders)
    ).json()) as any[];
    for (const expected of [receipt, secondReceipt]) {
      const stored = batches.find((b) => b.id === expected.batchId);
      assert.equal(stored.status, "review");
      assert.equal(JSON.parse(stored.receipt).commit, expected.commit);
      assert.equal(JSON.parse(stored.receipt).branch, "photo-rebuild/review");
    }
    assert.equal(
      (
        (await (
          await req("photos/" + photo.id, "GET", undefined, ownerHeaders)
        ).json()) as any
      ).status,
      "pending",
    );
    assert.equal(
      (
        await req(
          "admin/photo-batches/" + manifest.batchId + "/merge",
          "POST",
          { confirm: true, version: "test" },
          adminHeaders,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await req(
          "photos/" + photo.id,
          "PATCH",
          { revision: 1, pose: { ...pose, heading: 90 }, note: "updated" },
          ownerHeaders,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await req(
          "admin/photo-batches/" + manifest.batchId + "/receipt",
          "POST",
          receipt,
          adminHeaders,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await req(
          "photos/" + photo.id,
          "PATCH",
          { revision: 1, pose },
          ownerHeaders,
        )
      ).status,
      409,
    );
    await new Promise<void>((ok) => server.close(() => ok()));
    service.close();
    service = createPhotoApp({
      databasePath: join(dir, "db.sqlite"),
      storagePath: join(dir, "photos"),
      world,
      origins: ["http://photo.test"],
    });
    server = service.app.listen(0, "127.0.0.1");
    await new Promise<void>((ok) => server.once("listening", ok));
    base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
    assert.equal(
      (
        (await (
          await req("photos", "GET", undefined, ownerHeaders)
        ).json()) as any[]
      )[0].revision,
      2,
    );
    assert.equal(
      (await req("photos/" + photo.id, "DELETE", undefined, ownerHeaders))
        .status,
      200,
    );
    assert.equal(
      (
        await req(
          "photos/" + photo.id + "/preview",
          "GET",
          undefined,
          ownerHeaders,
        )
      ).status,
      404,
    );
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("archive reader rejects undeclared files, hash changes and symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ust-bundle-"));
  try {
    const scene = world.scenes[0],
      id = randomUUID(),
      picture = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#568" },
      })
        .webp()
        .toBuffer();
    const transform = JSON.parse(
      await readFile("content/map-config.json", "utf8"),
    ).transform;
    const manifest: PhotoManifest = {
      schemaVersion: 1,
      batchId: randomUUID(),
      createdAt: Date.now(),
      photos: [
        {
          id,
          revision: 1,
          sha256: digest(picture),
          previewSha256: digest(picture),
          original: "originals/" + id + ".webp",
          preview: "previews/" + id + ".webp",
          note: "archive fixture",
          capturedAt: null,
          capturedAtSource: null,
          pose: {
            sceneId: scene.id,
            mapVersion: world.mapVersion,
            x: 100,
            y: 100,
            heading: 0,
            pitch: null,
            buildingId: null,
            blockedConfirmed: true,
            sourceMap: scene.sourceMap,
            floorKey: scene.floor.key,
            floorName: scene.floor.name,
            elevation: scene.floor.elevation,
            source: sourcePoint(scene, { x: 100, y: 100 }),
            transform,
            scale: scene.units.pixelsPerProjectedUnit,
            offset: scene.sourceOffset,
          },
        },
      ],
    };
    for (const kind of ["undeclared", "hash", "link"]) {
      const zip = new ZipFile(),
        chunks: Buffer[] = [];
      zip.outputStream.on("data", (b) => chunks.push(b));
      const done = new Promise<void>((ok) => zip.outputStream.on("end", ok));
      zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
      zip.addBuffer(
        kind === "hash" ? Buffer.from("changed") : picture,
        manifest.photos[0].original,
      );
      zip.addBuffer(picture, manifest.photos[0].preview);
      if (kind === "undeclared") zip.addBuffer(Buffer.from("bad"), "script.sh");
      if (kind === "link")
        zip.addBuffer(Buffer.from("/etc/passwd"), "link", { mode: 0o120777 });
      zip.end();
      await done;
      const input = join(dir, kind + ".zip");
      await writeFile(input, Buffer.concat(chunks));
      await assert.rejects(
        extractBundle(input, join(dir, kind)),
        kind === "undeclared"
          ? /Undeclared/
          : kind === "hash"
            ? /hash mismatch/
            : /Links/,
      );
      await assert.rejects(readFile(join(dir, kind, "manifest.json")));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
