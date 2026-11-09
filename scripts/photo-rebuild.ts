import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  readdir,
  symlink,
  access,
  lstat,
} from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import { z } from "zod";
import {
  photoReviewSchema as reviewSchema,
  hasLocatedPhotoChange,
} from "../src/shared/photo-review";
import { extractBundle, sha } from "./photo-bundle";
import {
  manifestSchema,
  reproject,
  receiptSchema,
  type PhotoManifest,
} from "../src/shared/photos";
import type { WorldMap } from "../src/shared/world";
const args = process.argv.slice(2),
  command = args.shift();
const arg = (key: string) => {
  const i = args.indexOf("--" + key);
  return i < 0 ? undefined : args[i + 1];
};
const repo = resolve(arg("repo") ?? process.cwd());
const exec = (bin: string, params: string[], cwd = repo) => {
  const p = spawnSync(bin, params, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (p.status !== 0)
    throw new Error(
      bin + " " + params.join(" ") + " failed:\n" + p.stderr + "\n" + p.stdout,
    );
  return p.stdout.trim();
};
async function json(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function put(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
async function fingerprint(cwd: string) {
  const files = exec(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd,
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const data = [];
  for (const f of files) {
    try {
      data.push(f + "\0" + sha(await readFile(join(cwd, f))));
    } catch {
      data.push(f + "\0DELETED");
    }
  }
  return sha(data.join("\n"));
}
function taskPath() {
  const value = arg("task");
  if (!value) throw new Error("--task <private task directory> is required");
  return resolve(value);
}
async function review(dir: string, manifest: PhotoManifest) {
  const r = reviewSchema.parse(await json(join(dir, "review.json")));
  if (
    r.photos.length !== manifest.photos.length ||
    new Set(r.photos.map((p) => p.id)).size !== r.photos.length
  )
    throw new Error("Every photo needs exactly one outcome");
  for (const p of r.photos) {
    if (!manifest.photos.some((q) => q.id === p.id))
      throw new Error("Unexpected photo result");
    if (p.outcome === "applied") {
      if (!hasLocatedPhotoChange(p) || !p.changes || !p.evidence)
        throw new Error(
          "Applied changes require source features or placed objects, plus visual evidence; approximate placements are valid",
        );
      if (
        p.evidence.sceneId !==
        manifest.photos.find((q) => q.id === p.id)!.pose.sceneId
      )
        throw new Error("Evidence scene must match source photo scene");
      const files = [p.evidence.before, p.evidence.after];
      if (files[0] === files[1])
        throw new Error("Before and after need distinct captures");
      for (const f of files) {
        if (
          !f.startsWith("evidence/") ||
          f.includes("..") ||
          ![".png", ".webp"].some((ext) => f.endsWith(ext))
        )
          throw new Error("Use evidence/*.png or *.webp");
        await sharp(join(dir, f)).metadata();
      }
    }
  }
  return r;
}
async function evidenceHash(
  dir: string,
  assessment: z.infer<typeof reviewSchema>,
) {
  const records = [];
  for (const p of assessment.photos)
    if (p.evidence)
      for (const name of [p.evidence.before, p.evidence.after])
        records.push(name + ":" + sha(await readFile(join(dir, name))));
  return sha(records.sort().join("\n"));
}
function structural(world: WorldMap) {
  return world.scenes.map((s) => ({
    id: s.id,
    sourceMap: s.sourceMap,
    floor: s.floor,
    width: s.width,
    height: s.height,
    units: s.units,
    sourceOffset: s.sourceOffset,
    collision: s.collision,
    portals: s.portals,
    doors: s.doors,
    geometry: s.surfaces.map((x) => ({
      sourceId: x.sourceId,
      polygons: x.polygons,
      line: x.line,
    })),
    sourceOutlines: s.sourceOutlines,
  }));
}
if (command === "prepare") {
  const bundle = arg("bundle");
  if (!bundle) throw new Error("--bundle <export.zip> is required");
  const base = exec("git", ["rev-parse", arg("baseline") ?? "HEAD"]);
  const privateRoot = resolve(arg("out") ?? join(repo, "data/private-rebuild"));
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(privateRoot, ".prepare-"));
  let createdWorktree: string | undefined;
  let createdBranch: string | undefined;
  try {
    const result = await extractBundle(
      resolve(bundle),
      join(staging, "bundle"),
    );
    const { manifest, manifestHash } = result,
      dir = join(privateRoot, manifest.batchId);
    const selected = manifest.photos.filter(
      (p) =>
        (!arg("scene") || p.pose.sceneId === arg("scene")) &&
        (!arg("building") || p.pose.buildingId === arg("building")),
    );
    if (!selected.length) throw new Error("No photos match requested filter");

    try {
      const existing = await json(join(dir, "task.json"));
      if (
        existing.manifestHash !== manifestHash ||
        existing.baseline !== base ||
        JSON.stringify(existing.selected) !==
          JSON.stringify(selected.map((p) => p.id))
      )
        throw new Error(
          "Existing batch, baseline or selection differs; export a new batch",
        );
      await rm(staging, { recursive: true, force: true });
      console.log(dir);
      process.exit(0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const branch = "photo-rebuild/" + manifest.batchId,
      worktree = resolve(
        arg("worktree") ??
          join(dirname(repo), ".ustvalley-rebuild", manifest.batchId),
      );
    const world: WorldMap = JSON.parse(
      exec("git", ["show", base + ":public/maps/world.json"]),
    );
    await mkdir(join(staging, "evidence"));
    await put(join(staging, "baseline-world.json"), world);
    const groups = selected.map((p) => ({
      id: p.id,
      sceneId: p.pose.sceneId,
      floorKey: p.pose.floorKey,
      heading: p.pose.heading,
      location: reproject(world, p.pose),
      status: reproject(world, p.pose) ? "pending" : "needs-evidence",
    }));
    await put(join(staging, "index.json"), groups);
    const tiles: OverlayOptions[] = [];
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i],
        tile = await sharp(join(staging, "bundle", p.preview))
          .resize(280, 200, { fit: "contain", background: "#f6f1e1" })
          .png()
          .toBuffer();
      const label = Buffer.from(
        '<svg width="280" height="42"><rect width="280" height="42" fill="#f6f1e1"/><text x="8" y="17" font-size="12">' +
          p.id.slice(0, 8) +
          " | " +
          p.pose.sceneId.replace(/[^a-zA-Z0-9_-]/g, "") +
          '</text><text x="8" y="34" font-size="12">floor ' +
          p.pose.floorKey.replace(/[^a-zA-Z0-9_-]/g, "") +
          " | heading " +
          p.pose.heading.toFixed(1) +
          "</text></svg>",
      );
      tiles.push(
        { input: tile, left: (i % 3) * 280, top: Math.floor(i / 3) * 242 },
        {
          input: label,
          left: (i % 3) * 280,
          top: Math.floor(i / 3) * 242 + 200,
        },
      );
    }
    await sharp({
      create: {
        width: 840,
        height: Math.ceil(selected.length / 3) * 242,
        channels: 3,
        background: "#f6f1e1",
      },
    })
      .composite(tiles)
      .png()
      .toFile(join(staging, "contact-sheet.private.png"));
    await mkdir(dirname(worktree), { recursive: true });
    exec("git", ["worktree", "add", "-b", branch, worktree, base]);
    createdWorktree = worktree;
    createdBranch = branch;
    try {
      await symlink(
        join(repo, "node_modules"),
        join(worktree, "node_modules"),
        "dir",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    await put(join(staging, "task.json"), {
      schemaVersion: 1,
      batchId: manifest.batchId,
      manifestHash,
      baseline: base,
      branch,
      worktree,
      selected: selected.map((p) => p.id),
      createdAt: Date.now(),
    });
    await put(join(staging, "review.json"), {
      photos: manifest.photos.map((p) => ({
        id: p.id,
        outcome: "needs-evidence",
        observations: selected.some((q) => q.id === p.id)
          ? "待查看原图并确认位置"
          : "本次过滤范围外，未处理",
        changes: "",
        sourceIds: [],
        objects: [],
        uncertainties: "尚未完成照片校对",
      })),
    });
    await rename(staging, dir);
    console.log(JSON.stringify({ task: dir, worktree, branch }, null, 2));
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    if (createdWorktree && createdBranch) {
      exec("git", ["worktree", "remove", "--force", createdWorktree]);
      exec("git", ["branch", "-D", createdBranch]);
    }
    throw e;
  }
} else if (command === "verify") {
  const dir = taskPath(),
    task = await json(join(dir, "task.json")),
    manifest = manifestSchema.parse(
      await json(join(dir, "bundle/manifest.json")),
    );
  const assessment = await review(dir, manifest),
    checks: { command: string; passed: boolean; log: string }[] = [];
  const cwd = task.worktree as string;
  const previous = args.includes("--resume")
    ? await json(join(dir, "verification.json"))
    : undefined;
  if (
    previous &&
    (previous.fingerprint !== (await fingerprint(cwd)) ||
      previous.reviewHash !== sha(await readFile(join(dir, "review.json"))) ||
      previous.evidenceHash !== (await evidenceHash(dir, assessment)))
  )
    throw new Error(
      "Cannot resume: code, assessment or evidence changed; run full verify",
    );
  const attempt = previous ? (previous.attempt ?? 1) + 1 : 1;
  if (attempt > 3)
    throw new Error(
      "Three verification attempts exhausted; preserve failure and request investigation",
    );
  for (const [bin, params] of [
    ["npm", ["run", "maps:build"]],
    ["npm", ["test"]],
    ["npm", ["run", "build"]],
    [
      "npx",
      [
        "--no-install",
        "playwright",
        "test",
        "tests/browser/facade.spec.ts",
        "tests/browser/fixtures.spec.ts",
        "tests/browser/doors.spec.ts",
        "tests/browser/orbit.spec.ts",
        "--workers=1",
      ],
    ],
  ] as [string, string[]][]) {
    const commandLabel = [bin, ...params].join(" ");
    const cached = previous?.checks.find(
      (c: { command: string; passed: boolean; log: string }) =>
        c.command === commandLabel && c.passed,
    );
    if (cached) {
      checks.push(cached);
      continue;
    }
    let passed = true,
      log = "";
    try {
      log = exec(bin, params, cwd);
    } catch (e) {
      passed = false;
      log = (e as Error).message;
    }
    const name = "check-" + checks.length + "-attempt-" + attempt + ".log";
    await writeFile(join(dir, name), log, { mode: 0o600 });
    checks.push({ command: [bin, ...params].join(" "), passed, log: name });
    if (!passed) break;
  }
  let unchanged = false;
  try {
    unchanged =
      JSON.stringify(
        structural(await json(join(dir, "baseline-world.json"))),
      ) ===
      JSON.stringify(
        structural(await json(join(cwd, "public/maps/world.json"))),
      );
  } catch {}
  checks.push({
    command:
      "preserve source geometry, structural collision, portals and doors",
    passed: unchanged,
    log: "",
  });
  checks.push({
    command: "preserve raw source maps",
    passed: !exec("git", ["diff", task.baseline, "--", "data/maps"], cwd),
    log: "",
  });
  const privateHashes = new Set(
    manifest.photos.flatMap((p) => [p.sha256, p.previewSha256]),
  );
  let clean = true;
  const names = exec(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd,
  )
    .split("\0")
    .filter(Boolean);
  for (const name of names) {
    if (/(^|\/)(private-photos|private-rebuild|\.upload-)/.test(name)) {
      clean = false;
      break;
    }
    try {
      if (privateHashes.has(sha(await readFile(join(cwd, name))))) {
        clean = false;
        break;
      }
    } catch {}
  }
  checks.push({
    command: "private photo bytes excluded from repository",
    passed: clean,
    log: "",
  });
  const result = {
    schemaVersion: 1,
    batchId: task.batchId,
    baseline: task.baseline,
    fingerprint: await fingerprint(cwd),
    reviewHash: sha(await readFile(join(dir, "review.json"))),
    evidenceHash: await evidenceHash(dir, assessment),
    passed:
      checks.every((c) => c.passed) &&
      !assessment.photos.some((p) => p.outcome === "failed"),
    checks,
    attempt,
    previousRun: previous
      ? { createdAt: previous.createdAt, checks: previous.checks }
      : undefined,
    createdAt: Date.now(),
  };
  await put(join(dir, "verification.json"), result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} else if (command === "report") {
  const dir = taskPath(),
    task = await json(join(dir, "task.json")),
    manifest = manifestSchema.parse(
      await json(join(dir, "bundle/manifest.json")),
    ),
    r = await review(dir, manifest);
  const verified = await json(join(dir, "verification.json")),
    cwd = task.worktree as string;
  if (
    verified.fingerprint !== (await fingerprint(cwd)) ||
    verified.reviewHash !== sha(await readFile(join(dir, "review.json"))) ||
    verified.evidenceHash !== (await evidenceHash(dir, r))
  )
    throw new Error(
      "Code or assessment changed after verification; rerun verify",
    );
  const status = exec("git", ["status", "--porcelain"], cwd)
    .split("\n")
    .filter(Boolean);
  // Older baselines ignore node_modules/ directories but not the dependency symlink
  // created by prepare. Never ignore any other uncommitted artifact.
  const dependencyLink = await lstat(join(cwd, "node_modules")).then(
    (s) => s.isSymbolicLink(),
    () => false,
  );
  if (status.some((line) => !(line === "?? node_modules" && dependencyLink)))
    throw new Error("Commit verified changes before producing final receipt");
  const commit = exec("git", ["rev-parse", "HEAD"], cwd),
    branch = exec("git", ["branch", "--show-current"], cwd);
  if (branch !== task.branch) throw new Error("Unexpected review branch");
  const outcome = verified.passed
    ? r.photos.some((p) => p.outcome === "applied") ||
      r.photos.every((p) => p.outcome === "unchanged")
      ? "review"
      : "needs-evidence"
    : "failed";
  const receipt = receiptSchema.parse({
    schemaVersion: 1,
    batchId: task.batchId,
    manifestHash: task.manifestHash,
    baseline: task.baseline,
    commit,
    branch,
    status: outcome,
    verification: {
      passed: verified.passed,
      reportHash: sha(await readFile(join(dir, "verification.json"))),
    },
    photos: r.photos.map((p) => ({
      id: p.id,
      revision: manifest.photos.find((q) => q.id === p.id)!.revision,
      sha256: manifest.photos.find((q) => q.id === p.id)!.sha256,
      outcome: p.outcome,
      summary: p.changes || p.uncertainties,
    })),
  });
  await put(join(dir, "receipt.json"), receipt);
  await put(join(dir, "report.private.json"), {
    task,
    manifest,
    assessment: r,
    verification: verified,
    receipt,
  });
  await writeFile(
    join(dir, "summary.public.md"),
    "# Photo reconstruction review\n\nBatch: " +
      task.batchId +
      "\n\nBaseline: " +
      task.baseline +
      "\n\nResult: " +
      commit +
      "\n\nVerification: " +
      (verified.passed ? "passed" : "failed") +
      "\n\n" +
      r.photos.map((p) => "- " + p.id + ": " + p.outcome).join("\n") +
      "\n\nPrivate photos and detailed evidence are retained in the protected task directory.\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        status: outcome,
        receipt: join(dir, "receipt.json"),
        summary: join(dir, "summary.public.md"),
      },
      null,
      2,
    ),
  );
} else
  throw new Error(
    "Usage: npm run photo-rebuild -- prepare --bundle export.zip [--repo path] [--scene id] [--building C3] | verify --task directory | report --task directory",
  );
