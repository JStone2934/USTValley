import { z } from "zod";
import type { Progress } from "./journey";
import type { Point } from "./world";
export const accountInput = z
  .object({
    username: z
      .string()
      .regex(/^[A-Za-z0-9_]{3,24}$/)
      .transform((s) => s.toLowerCase()),
    password: z
      .string()
      .refine((s) => [...s].length >= 10 && [...s].length <= 128),
  })
  .strict();
export const nicknameInput = z
  .string()
  .trim()
  .refine(
    (s) => [...s].length >= 2 && [...s].length <= 16 && !/[\p{Cc}]/u.test(s),
  );
export const registerInput = accountInput.extend({ nickname: nicknameInput });
export const inputMessage = z
  .object({
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    x: z.number().finite().min(-1).max(1),
    y: z.number().finite().min(-1).max(1),
    run: z.boolean(),
  })
  .strict();
export const requestId = z.string().uuid();
export const actionMessage = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("interact"),
      requestId,
      id: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("wear"),
      requestId,
      kind: z.enum(["outfit", "hat"]),
      id: z.string().min(1).max(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("note"),
      requestId,
      x: z.number().int(),
      y: z.number().int(),
      text: z.string().max(1024),
    })
    .strict(),
  z.object({ type: z.literal("reset"), requestId }).strict(),
]);
export const sceneReady = z
  .object({
    token: z.string().min(20).max(100),
    mapVersion: z.string().max(100),
  })
  .strict();
export function normalizeNote(value: string) {
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (
    !text ||
    [...text].length > 140 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  )
    return;
  return text;
}
export type PlayerView = Point & {
  accountId: string;
  nickname: string;
  sceneId: string;
  outfit: Progress["outfit"];
  hat: Progress["hat"];
  moving: boolean;
  loading: boolean;
  sequence: number;
  connected: boolean;
};
export type SharedWorldState = {
  tick: number;
  serverTime: number;
  mapVersion: string;
  players: PlayerView[];
  chests: Record<string, number>;
  doors: Record<string, string[]>;
};
export type PublicNote = {
  id: string;
  authorId: string;
  nickname: string;
  sceneId: string;
  x: number;
  y: number;
  text: string;
  createdAt: number;
  likes: number;
  liked: boolean;
};
export type ActionResult = {
  requestId: string;
  ok: boolean;
  code?: string;
  message?: string;
  progress?: Progress;
  notices?: string[];
  note?: PublicNote;
};
