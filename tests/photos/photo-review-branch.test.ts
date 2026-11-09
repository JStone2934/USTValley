import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  readFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ZipFile } from "yazl";
import {
  git,
  reviewTip,
  createReviewWorktree,
  refreshReviewWorktree,
  deliverReviewCommit,
} from "../../scripts/photo-review-branch.ts";
import { PHOTO_REVIEW_BRANCH } from "../../src/shared/photo-review-branch.ts";
import { receiptSchema, sourcePoint } from "../../src/shared/photos.ts";
import { sha } from "../../scripts/photo-bundle.ts";
import config from "../../content/map-config.json";
import type { WorldMap } from "../../src/shared/world.ts";

async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "ust-shared-review-")),
    repo = join(dir, "repo"),
    remote = join(dir, "remote.git");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["config", "user.name", "Test"]);
  await writeFile(join(repo, "shared.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  const main = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["init", "--bare", remote]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "origin", `HEAD:refs/heads/${PHOTO_REVIEW_BRANCH}`]);
  return { dir, repo, remote, main };
}
async function commit(cwd: string, name: string, content: string) {
  await writeFile(join(cwd, name), content);
  git(cwd, ["add", name]);
  git(cwd, ["commit", "-m", name]);
  return git(cwd, ["rev-parse", "HEAD"]);
}
test("multiple detached tasks accumulate on one review ref; stale tasks rebase without losing earlier work", async (t) => {
  const f = await fixture(t),
    base = reviewTip(f.repo),
    a = join(f.dir, "a"),
    b = join(f.dir, "b");
  createReviewWorktree(f.repo, a, base);
  createReviewWorktree(f.repo, b, base);
  assert.equal(git(a, ["branch", "--show-current"]), "");
  const ca = await commit(a, "a.txt", "photo A\n"),
    cb = await commit(b, "b.txt", "photo B\n");
  assert.throws(() => deliverReviewCommit(a, base, ca, false), /--publish/);
  assert.equal(deliverReviewCommit(a, base, ca, true), ca);
  assert.equal(deliverReviewCommit(a, base, ca, true), ca);
  assert.throws(() => deliverReviewCommit(b, base, cb, true), /advanced/);
  const updated = refreshReviewWorktree(b, base);
  assert.equal(updated.tip, ca);
  assert.ok(updated.changed);
  const latest = deliverReviewCommit(b, ca, updated.head, true);
  assert.equal(git(f.remote, ["show", latest + ":a.txt"]), "photo A");
  assert.equal(git(f.remote, ["show", latest + ":b.txt"]), "photo B");
  assert.equal(
    git(f.remote, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
    "refs/heads/" + PHOTO_REVIEW_BRANCH,
  );
  assert.equal(git(f.repo, ["rev-parse", "main"]), f.main);
  assert.equal(
    git(f.repo, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/photo-rebuild",
    ]),
    "",
  );
});
test("a competing push after fetch is rejected without force-updating the shared branch", async (t) => {
  const f = await fixture(t),
    base = reviewTip(f.repo),
    a = join(f.dir, "a"),
    b = join(f.dir, "b");
  createReviewWorktree(f.repo, a, base);
  createReviewWorktree(f.repo, b, base);
  const ca = await commit(a, "a.txt", "first\n"),
    cb = await commit(b, "b.txt", "rival\n");
  const hook = join(f.repo, ".git/hooks/pre-push");
  await writeFile(
    hook,
    "#!/bin/sh\ngit -c core.hooksPath=/dev/null push origin " +
      cb +
      ":refs/heads/" +
      PHOTO_REVIEW_BRANCH +
      "\n",
  );
  await chmod(hook, 0o755);
  assert.throws(() => deliverReviewCommit(a, base, ca, true), /failed/);
  assert.equal(reviewTip(f.repo), cb);
  assert.equal(git(a, ["rev-parse", "HEAD"]), ca);
});

test("conflicting refresh restores the task commit and never overwrites shared review", async (t) => {
  const f = await fixture(t),
    base = reviewTip(f.repo),
    a = join(f.dir, "a"),
    b = join(f.dir, "b");
  createReviewWorktree(f.repo, a, base);
  createReviewWorktree(f.repo, b, base);
  const ca = await commit(a, "shared.txt", "first\n"),
    cb = await commit(b, "shared.txt", "second\n");
  deliverReviewCommit(a, base, ca, true);
  assert.throws(() => refreshReviewWorktree(b, base), /conflicts/);
  assert.equal(git(b, ["rev-parse", "HEAD"]), cb);
  assert.equal(reviewTip(f.repo), ca);
  assert.equal(git(b, ["status", "--porcelain"]), "");
});
test("prepare uses detached tasks, resumes old batches, and refresh invalidates old verification and evidence", async (t) => {
  const f = await fixture(t);
  const world: WorldMap = JSON.parse(
      await readFile("public/maps/world.json", "utf8"),
    ),
    scene = world.scenes.find((s) => s.id === "interior_academic_f2")!;
  await mkdir(join(f.repo, "public/maps"), { recursive: true });
  await commit(
    f.repo,
    "public/maps/world.json",
    JSON.stringify({ ...world, scenes: [scene] }),
  );
  git(f.repo, ["push", "origin", `HEAD:refs/heads/${PHOTO_REVIEW_BRANCH}`]);
  const image = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#aabbcc" },
  })
    .png()
    .toBuffer();
  const batch = randomUUID(),
    id = randomUUID(),
    point = { x: 430, y: 510 };
  const manifest = {
    schemaVersion: 1,
    batchId: batch,
    createdAt: Date.now(),
    photos: [
      {
        id,
        revision: 1,
        sha256: sha(image),
        previewSha256: sha(image),
        original: "original.png",
        preview: "preview.png",
        note: "",
        capturedAt: null,
        capturedAtSource: null,
        pose: {
          sceneId: scene.id,
          mapVersion: world.mapVersion,
          sourceMap: scene.sourceMap,
          floorKey: scene.floor.key,
          floorName: scene.floor.name,
          elevation: scene.floor.elevation,
          ...point,
          source: sourcePoint(scene, point),
          heading: 30,
          pitch: null,
          buildingId: "C3",
          transform: config.transform,
          scale: scene.units.pixelsPerProjectedUnit,
          offset: scene.sourceOffset,
          blockedConfirmed: false,
        },
      },
    ],
  };
  const zip = new ZipFile(),
    chunks: Buffer[] = [];
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json");
  zip.addBuffer(image, "original.png");
  zip.addBuffer(image, "preview.png");
  const done = new Promise<Buffer>((ok, no) => {
    zip.outputStream.on("data", (b) => chunks.push(b));
    zip.outputStream.on("error", no);
    zip.outputStream.on("end", () => ok(Buffer.concat(chunks)));
  });
  zip.end();
  const bundle = join(f.dir, "bundle.zip"),
    out = join(f.dir, "private"),
    wt = join(f.dir, "task");
  await writeFile(bundle, await done);
  const run = (...extra: string[]) => {
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/photo-rebuild.ts"),
        "prepare",
        "--repo",
        f.repo,
        "--bundle",
        bundle,
        "--out",
        out,
        "--worktree",
        wt,
        ...extra,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  run();
  assert.equal(git(wt, ["branch", "--show-current"]), "");
  const dir = join(out, batch),
    initial = JSON.parse(await readFile(join(dir, "task.json"), "utf8"));
  assert.equal(initial.branch, PHOTO_REVIEW_BRANCH);
  assert.equal(initial.schemaVersion, 2);
  await commit(wt, "task.txt", "my object\n");
  await commit(f.repo, "other.txt", "another batch\n");
  git(f.repo, ["push", "origin", `HEAD:refs/heads/${PHOTO_REVIEW_BRANCH}`]);
  run();
  assert.equal(
    JSON.parse(await readFile(join(dir, "task.json"), "utf8")).baseline,
    initial.baseline,
  );
  await writeFile(
    join(dir, "verification.json"),
    JSON.stringify({ passed: true }),
  );
  const review = JSON.parse(await readFile(join(dir, "review.json"), "utf8"));
  review.photos[0].evidence = { visualChecked: true };
  await writeFile(join(dir, "review.json"), JSON.stringify(review));
  run("--refresh");
  assert.equal(
    JSON.parse(await readFile(join(dir, "task.json"), "utf8")).baseline,
    reviewTip(f.repo),
  );
  await assert.rejects(readFile(join(dir, "verification.json")), /ENOENT/);
  assert.equal(
    JSON.parse(await readFile(join(dir, "review.json"), "utf8")).photos[0]
      .evidence,
    undefined,
  );
  assert.equal(await readFile(join(wt, "task.txt"), "utf8"), "my object\n");
  assert.equal(
    await readFile(join(wt, "other.txt"), "utf8"),
    "another batch\n",
  );
});
test("receipt contract supports shared review and historical receipts without allowing main as a review target", () => {
  const sample = {
    schemaVersion: 1,
    batchId: randomUUID(),
    manifestHash: "a".repeat(64),
    baseline: "b".repeat(40),
    commit: "c".repeat(40),
    branch: PHOTO_REVIEW_BRANCH,
    status: "review",
    verification: { passed: true, reportHash: "d".repeat(64) },
    photos: [
      {
        id: randomUUID(),
        revision: 1,
        sha256: "e".repeat(64),
        outcome: "applied",
        summary: "updated",
      },
    ],
  };
  assert.ok(receiptSchema.safeParse(sample).success);
  assert.ok(
    receiptSchema.safeParse({
      ...sample,
      branch: "photo-rebuild/" + sample.batchId,
    }).success,
  );
  assert.equal(
    receiptSchema.safeParse({ ...sample, branch: "main" }).success,
    false,
  );
});
