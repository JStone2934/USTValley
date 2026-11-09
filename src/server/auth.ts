import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import { accounts, characters } from "./schema";
import type { openDatabase } from "./database";
import { accountInput, registerInput } from "../shared/network";
import { newProgress } from "../shared/journey";
import { GameError, requireThat } from "./errors";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export type Identity = {
  id: string;
  username: string;
  nickname: string;
  role: string;
  banned: number;
  noteMuted: number;
  sessionHash: string;
  csrf: string;
};
const hashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;
export class Auth {
  private attempts = new Map<string, { count: number; until: number }>();
  private dummyHash: Promise<string>;
  constructor(
    private db: ReturnType<typeof openDatabase>,
    private sessionMs = 7 * 86400000,
  ) {
    this.dummyHash = argon2.hash(secret(), hashOptions);
  }
  private throttle(
    key: string,
    limit: number,
    window: number,
    now = Date.now(),
  ) {
    let hit = this.attempts.get(key);
    if (!hit || hit.until <= now) {
      hit = { count: 0, until: now + window };
      this.attempts.set(key, hit);
    }
    requireThat(
      ++hit.count <= limit,
      "RATE_LIMITED",
      "尝试过于频繁，请稍后再试",
      429,
    );
    if (this.attempts.size > 10000)
      for (const [k, v] of this.attempts)
        if (v.until <= now) this.attempts.delete(k);
  }
  async register(raw: unknown, ip: string) {
    this.throttle("register:" + ip, 20, 3600000);
    const parsed = registerInput.safeParse(raw);
    requireThat(
      parsed.success,
      "INVALID_ACCOUNT",
      "用户名需为 3–24 位字母、数字或下划线；昵称 2–16 字，密码 10–128 字",
    );
    const data = parsed.data;
    const passwordHash = await argon2.hash(data.password, hashOptions),
      id = randomUUID(),
      now = Date.now();
    requireThat(
      !this.db.orm
        .select()
        .from(accounts)
        .where(eq(accounts.username, data.username))
        .get(),
      "USERNAME_TAKEN",
      "这个用户名已被使用",
      409,
    );
    try {
      this.db.sqlite.transaction(() => {
        this.db.orm
          .insert(accounts)
          .values({
            id,
            username: data.username,
            nickname: data.nickname,
            passwordHash,
            createdAt: now,
          })
          .run();
        this.db.orm
          .insert(characters)
          .values({
            accountId: id,
            progress: JSON.stringify(newProgress()),
            updatedAt: now,
          })
          .run();
      })();
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        throw new GameError("USERNAME_TAKEN", "这个用户名已被使用", 409);
      throw e;
    }
    return this.newSession(id);
  }
  async login(raw: unknown, ip: string) {
    const parsed = accountInput.safeParse(raw);
    requireThat(
      parsed.success,
      "INVALID_CREDENTIALS",
      "用户名或密码不正确",
      401,
    );
    const data = parsed.data;
    this.throttle("login:ip:" + ip, 100, 900000);
    this.throttle("login:user:" + data.username, 10, 900000);
    const user = this.db.orm
      .select()
      .from(accounts)
      .where(eq(accounts.username, data.username))
      .get();
    const valid = await argon2.verify(
      user?.passwordHash ?? (await this.dummyHash),
      data.password,
    );
    requireThat(
      user && valid && !user.banned,
      "INVALID_CREDENTIALS",
      "用户名或密码不正确",
      401,
    );
    this.attempts.delete("login:user:" + data.username);
    return this.newSession(user.id);
  }
  private newSession(id: string) {
    const token = secret(),
      csrf = secret(),
      now = Date.now();
    this.db.sqlite.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    this.db.sqlite
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(hashToken(token), id, csrf, now + this.sessionMs);
    return { token, identity: this.session(token)! };
  }
  session(token: string | undefined): Identity | undefined {
    if (!token || token.length > 100) return;
    return this.byHash(hashToken(token));
  }
  byHash(hash: string): Identity | undefined {
    return this.db.sqlite
      .prepare(
        `SELECT a.id,a.username,a.nickname,a.role,a.banned,a.note_muted AS noteMuted,s.hash AS sessionHash,s.csrf FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires_at>? AND a.banned=0`,
      )
      .get(hash, Date.now()) as Identity | undefined;
  }
  csrf(identity: Identity, token: unknown) {
    requireThat(
      typeof token === "string" &&
        Buffer.byteLength(token) === Buffer.byteLength(identity.csrf) &&
        timingSafeEqual(Buffer.from(token), Buffer.from(identity.csrf)),
      "CSRF_FAILED",
      "页面已过期，请刷新后重试",
      403,
    );
  }
  logout(identity: Identity) {
    this.db.sqlite
      .prepare("DELETE FROM sessions WHERE hash=?")
      .run(identity.sessionHash);
  }
  ticket(identity: Identity) {
    const ticket = secret();
    this.db.sqlite
      .prepare("DELETE FROM tickets WHERE expires_at<=?")
      .run(Date.now());
    this.db.sqlite
      .prepare("INSERT INTO tickets VALUES(?,?,?,0)")
      .run(hashToken(ticket), identity.sessionHash, Date.now() + 30000);
    return ticket;
  }
  consume(ticket: unknown) {
    requireThat(
      typeof ticket === "string" && ticket.length <= 100,
      "UNAUTHENTICATED",
      "请重新进入校园",
      401,
    );
    return this.db.sqlite.transaction(() => {
      const row = this.db.sqlite
        .prepare(
          "SELECT session_hash FROM tickets WHERE hash=? AND used=0 AND expires_at>?",
        )
        .get(hashToken(ticket), Date.now()) as
        | { session_hash: string }
        | undefined;
      requireThat(row, "TICKET_EXPIRED", "入场凭据已过期，请重新进入", 401);
      const identity = this.byHash(row.session_hash);
      requireThat(identity, "UNAUTHENTICATED", "登录已过期，请重新登录", 401);
      this.db.sqlite
        .prepare("UPDATE tickets SET used=1 WHERE hash=?")
        .run(hashToken(ticket));
      return identity;
    })();
  }
  async resetPassword(token: string, password: string) {
    requireThat(
      accountInput.shape.password.safeParse(password).success,
      "INVALID_PASSWORD",
      "密码需为 10–128 字",
    );
    const row = this.db.sqlite
      .prepare(
        "SELECT account_id FROM reset_tokens WHERE hash=? AND used=0 AND expires_at>?",
      )
      .get(hashToken(token), Date.now()) as { account_id: string } | undefined;
    requireThat(row, "TOKEN_EXPIRED", "重置凭据已失效", 401);
    const hash = await argon2.hash(password, hashOptions);
    this.db.sqlite.transaction(() => {
      const changed = this.db.sqlite
        .prepare(
          "UPDATE reset_tokens SET used=1 WHERE hash=? AND used=0 AND expires_at>?",
        )
        .run(hashToken(token), Date.now());
      requireThat(
        changed.changes === 1,
        "TOKEN_EXPIRED",
        "重置凭据已失效",
        401,
      );
      this.db.orm
        .update(accounts)
        .set({ passwordHash: hash })
        .where(eq(accounts.id, row.account_id))
        .run();
      this.db.sqlite
        .prepare("DELETE FROM sessions WHERE account_id=?")
        .run(row.account_id);
    })();
    return row.account_id;
  }
}
