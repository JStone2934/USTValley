import yauzl from "yauzl";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve, isAbsolute, relative } from "node:path";
import { createHash } from "node:crypto";
import { manifestSchema, type PhotoManifest } from "../src/shared/photos";
export const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function safeEntry(name: string) {
  if (
    !name ||
    isAbsolute(name) ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((p) => p === ".." || p === "." || p === "") ||
    /^[A-Za-z]:/.test(name)
  )
    throw new Error("Unsafe ZIP entry: " + name);
  return name;
}
export async function extractBundle(
  zipPath: string,
  out: string,
): Promise<{ manifest: PhotoManifest; manifestHash: string }> {
  await mkdir(out, { recursive: true, mode: 0o700 });
  try {
    await new Promise<void>((ok, no) =>
      yauzl.open(
        zipPath,
        { lazyEntries: true, validateEntrySizes: true },
        (err, zip) => {
          if (err || !zip) return no(err);
          let total = 0,
            count = 0;
          const names = new Set<string>();
          const fail = (e: unknown) => {
            zip.close();
            no(e);
          };
          zip.on("error", fail);
          zip.on("end", ok);
          zip.on("entry", (entry) => {
            try {
              safeEntry(entry.fileName);
              if (names.has(entry.fileName) || ++count > 45)
                throw new Error("Duplicate or excessive ZIP entries");
              names.add(entry.fileName);
              const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
              if (mode === 0xa000 || mode === 0x4000)
                throw new Error(
                  "Links and directory entries are not permitted",
                );
              total += entry.uncompressedSize;
              if (
                total > 600 * 1024 * 1024 ||
                entry.uncompressedSize > 26 * 1024 * 1024
              )
                throw new Error("ZIP exceeds size limits");
              zip.openReadStream(entry, (e, stream) => {
                if (e || !stream) return fail(e);
                const chunks: Buffer[] = [];
                let length = 0;
                stream.on("data", (b: Buffer) => {
                  length += b.length;
                  if (
                    length > entry.uncompressedSize ||
                    length > 26 * 1024 * 1024
                  ) {
                    stream.destroy(new Error("ZIP size mismatch"));
                    return;
                  }
                  chunks.push(b);
                });
                stream.on("error", fail);
                stream.on("end", () => {
                  const dest = resolve(out, entry.fileName);
                  if (relative(out, dest).startsWith(".."))
                    return fail(new Error("Unsafe path"));
                  mkdir(resolve(dest, ".."), { recursive: true, mode: 0o700 })
                    .then(() =>
                      writeFile(dest, Buffer.concat(chunks), { mode: 0o600 }),
                    )
                    .then(() => zip.readEntry(), fail);
                });
              });
            } catch (e) {
              fail(e);
            }
          });
          zip.readEntry();
        },
      ),
    );
    const bytes = await readFile(join(out, "manifest.json")),
      manifest = manifestSchema.parse(JSON.parse(bytes.toString()));
    const paths = new Set(["manifest.json", "index.csv", "COORDINATES.txt"]),
      ids = new Set<string>();
    for (const p of manifest.photos) {
      if (ids.has(p.id)) throw new Error("Duplicate photo ID");
      ids.add(p.id);
      for (const [name, hash] of [
        [p.original, p.sha256],
        [p.preview, p.previewSha256],
      ]) {
        safeEntry(name);
        if (paths.has(name)) throw new Error("Overlapping artifact path");
        paths.add(name);
        if (sha(await readFile(join(out, name))) !== hash)
          throw new Error("Photo hash mismatch: " + p.id);
      }
    }
    // No auxiliary scripts or undeclared files are accepted from uploaded archives.
    const { readdir } = await import("node:fs/promises");
    for (const name of await readdir(out, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (name.isFile()) {
        const path = relative(out, join(name.parentPath, name.name));
        if (!paths.has(path)) throw new Error("Undeclared ZIP file: " + path);
      }
    }
    return { manifest, manifestHash: sha(bytes) };
  } catch (e) {
    await rm(out, { recursive: true, force: true });
    throw e;
  }
}
