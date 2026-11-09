import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPhotoApp } from "../../src/server/photo-app";
const dir = await mkdtemp(join(tmpdir(), "ust-photo-browser-"));
const service = createPhotoApp({
  databasePath: join(dir, "db.sqlite"),
  storagePath: join(dir, "photos"),
  world: JSON.parse(await readFile("public/maps/world.json", "utf8")),
  origins: ["http://127.0.0.1:4322"],
  distPath: resolve("dist"),
});
const admin = await service.auth.register(
  {
    username: "browser_admin",
    password: "browser-test-password",
    nickname: "测试维护者",
  },
  "test",
);
service.db.sqlite
  .prepare("UPDATE accounts SET role='admin' WHERE id=?")
  .run(admin.identity.id);
const server = service.app.listen(4322, "127.0.0.1");
for (const s of ["SIGTERM", "SIGINT"])
  process.on(s, () =>
    server.close(() => {
      service.close();
      void rm(dir, { recursive: true, force: true }).then(() =>
        process.exit(0),
      );
    }),
  );
