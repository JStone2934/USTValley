import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPhotoApp } from "./photo-app";
const port = Number(process.env.USTVALLEY_PHOTO_PORT ?? 4320),
  host = process.env.USTVALLEY_HOST ?? "127.0.0.1";
const origins = (process.env.USTVALLEY_ORIGINS ?? "http://127.0.0.1:" + port)
  .split(",")
  .map((s) => s.trim());
const secure = process.env.USTVALLEY_SECURE_COOKIES === "true";
if (secure && origins.some((s) => !s.startsWith("https://")))
  throw new Error("Secure cookies require HTTPS origins");
const service = createPhotoApp({
  databasePath: resolve(
    process.env.USTVALLEY_DATABASE ?? "data/server/campus.sqlite",
  ),
  storagePath: resolve(process.env.USTVALLEY_PHOTOS ?? "data/private-photos"),
  world: JSON.parse(readFileSync("public/maps/world.json", "utf8")),
  origins,
  secureCookies: secure,
  distPath: resolve("dist"),
  repoPath: resolve("."),
  ownerDailyLimit: Number(process.env.USTVALLEY_PHOTO_OWNER_LIMIT ?? 100),
  ipDailyLimit: Number(process.env.USTVALLEY_PHOTO_IP_LIMIT ?? 500),
});
await service.cleanup();
const server = service.app.listen(port, host, () =>
  console.log("Photo service ready on " + host + ":" + port),
);
for (const s of ["SIGINT", "SIGTERM"])
  process.on(s, () =>
    server.close(() => {
      service.close();
      process.exit(0);
    }),
  );
