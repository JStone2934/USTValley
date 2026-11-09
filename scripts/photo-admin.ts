import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { openDatabase } from "../src/server/database";
import { Auth } from "../src/server/auth";
const username = process.argv[2];
if (!username)
  throw new Error(
    "Usage: npm run photos:admin -- <username>; set USTVALLEY_ADMIN_PASSWORD through a protected environment or use hidden terminal input.",
  );
let password = process.env.USTVALLEY_ADMIN_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY)
    throw new Error("A TTY or USTVALLEY_ADMIN_PASSWORD is required");
  process.stdout.write("管理员密码（输入隐藏）: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  password = await new Promise<string>((ok, no) => {
    let value = "";
    const onData = (b: Buffer) => {
      for (const c of b.toString()) {
        if (c === "\u0003") {
          process.stdin.off("data", onData);
          no(new Error("Cancelled"));
          return;
        }
        if (c === "\r" || c === "\n") {
          process.stdin.off("data", onData);
          ok(value);
          return;
        }
        if (c === "\u007f") value = value.slice(0, -1);
        else value += c;
      }
    };
    process.stdin.on("data", onData);
  }).finally(() => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
  });
}
const db = openDatabase(
  resolve(process.env.USTVALLEY_DATABASE ?? "data/server/campus.sqlite"),
);
try {
  const auth = new Auth(db),
    created = await auth.register(
      { username, password, nickname: "校园维护者" },
      "local-admin-bootstrap",
    );
  db.sqlite
    .prepare("UPDATE accounts SET role='admin' WHERE id=?")
    .run(created.identity.id);
  auth.logout(created.identity);
  console.log("已创建管理员 " + username + "；未输出或保存明文密码。");
} finally {
  db.sqlite.close();
}
