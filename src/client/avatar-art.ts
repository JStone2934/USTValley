import { outfits, type OutfitId, type HatId } from "../shared/journey";
import type Phaser from "phaser";

// Pixel clusters are drawn in an original 22 × 44 frame. The camera sets the
// displayed dimensions in metres; the shared foot point is always (11,44).
export const avatarWidth = 22,
  avatarHeight = 44;
export const studentPalette: Record<string, number> = {
  H: 0x45382c,
  h: 0x71513d,
  K: 0x302f32,
  k: 0x986e51,
  S: 0xe8b98c,
  s: 0xba8065,
  L: 0xf4cda6,
  e: 0x343b35,
  R: 0x874b3b,
  J: 0xc86b42,
  j: 0xe58d55,
  A: 0xf2ac69,
  C: 0xf3d9ac,
  c: 0xcbae85,
  b: 0x405c62,
  B: 0x64888d,
  t: 0x9aada0,
  P: 0x344655,
  p: 0x5b7080,
  n: 0x283844,
  X: 0x3b3837,
  W: 0xd8c8a4,
};
export type StudentFacing = "up" | "down" | "left" | "right";

const hairFront = [
  ".....HHHHH.....",
  "...HHhhhhHHH...",
  "..HHhhkkkhhhH..",
  ".HHhkkkkhhhHHH.",
  ".HhhhhhHHhhHHH.",
  "HHhhHHHSLhhHHHH",
  "HHHhHSSLLSLHHHH",
  ".HHHSLSSLLSSHH.",
  ".sHSSSeSSLSeHs.",
  ".sHSLSeLLSSes..",
  "..ssSLLLLLSs...",
  "...sSSLLLSs....",
  "....ssSSss.....",
  ".....sSSs......",
];
const hairBack = [
  ".....HHHHH.....",
  "...HHhhhhHHH...",
  "..HHhhkkkhhhH..",
  ".HHhhkkkhhhhHH.",
  ".HhhhhhhhhhhHH.",
  "HHhhhhhHhhhhhHH",
  "HHhHhhHHhhHhhHH",
  ".HHHhhHHhhHhHH.",
  ".sHHHHHHHHhHHs.",
  ".sHHHHHhhHHHHs.",
  "..HHHHHHHHHHH..",
  "...HHHHhHHHH...",
  "....hHsHHHs....",
  ".....ssss......",
];
const hairSide = [
  "....HHHHHH.....",
  "..HHhhhhhhHH...",
  ".HHhhkkkhhhHH..",
  ".HhhkkkhhhhHHH.",
  "HHhhhhhhHHHhhH.",
  "HHhHhhHHHSLLSH.",
  "HHHHhhhHSSLLLH.",
  ".HHHHHhHSSSeS..",
  ".HHHsshhSLLeSs.",
  ".HHHsSssSLLLLs.",
  "..HHHssSSSLs...",
  "...HHhsssSSS...",
  "....Hssssss....",
  ".....ssss......",
];
const frontCoat = [
  "...bbRRccRRbb...",
  "..bbjRRCCRjJbb..",
  ".RbjJAjCCjJJRbR.",
  ".JbjjjjCCJjJRbJ.",
  ".JbjJjJCCJJJRbJ.",
  "..bjJjJCCJJJbb..",
  "..JJjjJcCJJJRR..",
  "..JJjAJbCJJJRR..",
  "..JJjjJtCJJjRR..",
  "..JRjjJCcJjJRR..",
  "..JjRRJCcJRRJR..",
  "..JjjJJccJJJJR..",
  "..RJJJJCcJJJJR..",
  "..RRJJJccJJRRR..",
  "...RRRRccRRRR...",
];
const backCoat = [
  "...RRRcccccRR...",
  "..RJjACCccjJJR..",
  ".RJjJjjJJJjjJJR.",
  ".RjjbbbbbbbbJJR.",
  "..JbBBBBBBBBbJ..",
  "..JbBtttttBBbR..",
  "..JbBBbbbbBBbR..",
  "..JbBBBBBBBBbR..",
  "..JbbBBBBBBbbR..",
  "..JbBtttttBBbR..",
  "..JbBBbbbbBBbR..",
  "..JbbBBBBBBbbR..",
  "..RJJbbbbbbJRR..",
  "..RRJJJJJJJRRR..",
  "...RRRRRRRRRR...",
];
const sideCoat = [
  "....RRRcc......",
  "...RjACccjR....",
  "..bRjjjJJCRR...",
  ".bBBRjjJJJcR...",
  "bBBBbJjJJJcJR..",
  "bBtBbJjJJJcJR..",
  "bBBbbJjJJJcJR..",
  "bBBBBJjJJJcJR..",
  "bBBBbJjJJJcJR..",
  "bBttbJjJJJcJR..",
  ".bBBbJJJJJcJR..",
  ".bbbRJJJJJcJR..",
  "...RRJJJJJRRR..",
  "...RRJJJJJRR...",
  "....RRRRRRR....",
];

export function studentFrame(
  direction: StudentFacing,
  frame: number,
  hat: HatId = "none",
): string[] {
  const pixels = Array.from({ length: avatarHeight }, () =>
    Array<string>(avatarWidth).fill("."),
  );
  const step = [0, 1, 0, -1][frame % 4],
    bob = frame % 2,
    side = direction === "left" || direction === "right";
  const stamp = (rows: string[], x: number, y: number) => {
    rows.forEach((row, dy) =>
      [...row].forEach((p, dx) => {
        if (p !== "." && pixels[y + dy] && x + dx >= 0 && x + dx < avatarWidth)
          pixels[y + dy][x + dx] = p;
      }),
    );
  };
  function leg(x: number, travel: number, rear: boolean) {
    // At passing poses one heel lifts; at contact poses the side silhouette
    // actually strides horizontally while front/back feet trade depth.
    const bend = side ? travel * 2 : 0,
      lift = travel < 0 ? 2 : frame === 2 && rear ? 1 : 0;
    for (let y = 26; y < 40 - lift; y++) {
      const t = (y - 26) / 13,
        dx = Math.round(bend * t);
      stamp([rear ? "nPPn" : y === 31 ? "PPpP" : "PppP"], x + dx, y);
    }
    const tx = x + bend,
      ty = 39 - lift;
    if (side) stamp(["nPPn.", "XccXX", "XXWWW", ".PPPP"], tx, ty + 1);
    else stamp(["PppP", "XccX", "XXWW", "PPPP"], tx, ty + 1);
  }
  function arm(x: number, travel: number, far = false) {
    const swing = side ? travel * 2 : 0,
      lift = side ? 0 : travel;
    for (let y = 19; y < 29; y++) {
      const dx = Math.round((swing * (y - 19)) / 10);
      stamp(
        [far ? "RJR" : y < 22 ? "AjJ" : "jjR"],
        x + dx,
        y + bob + Math.round((lift * (y - 19)) / 10),
      );
    }
    stamp(
      [far ? "RRR" : "RJR", far ? "sss" : "SLs", ".ss"],
      x + swing,
      29 + bob + lift,
    );
  }
  leg(side ? 8 : 6, step, true);
  leg(side ? 11 : 12, -step, false);
  if (side) arm(11, -step, true);
  stamp(
    side ? sideCoat : direction === "up" ? backCoat : frontCoat,
    3,
    17 + bob,
  );
  if (side) arm(9, step);
  else {
    arm(2, step);
    arm(17, -step, true);
  }
  const head = side ? hairSide : direction === "up" ? hairBack : hairFront;
  const portraitHead = head.flatMap((row, y) => {
    const widened = Array.from(
      { length: 19 },
      (_, x) =>
        row[Math.min(row.length - 1, Math.floor((x * row.length) / 19))],
    ).join("");
    return [2, 4, 7, 11].includes(y) ? [widened, widened] : [widened];
  });
  stamp(portraitHead, 2, bob);
  if (hat !== "none") {
    const top =
      hat === "cap"
        ? [
            "....CCCCCCCC....",
            "...CCCCCCCCCC...",
            "..ccCCCCCCCCcc..",
            "..cccccccccccc..",
            "......CCCCCCCCCC",
          ]
        : hat === "bucket"
          ? [
              "....CCCCCCCC....",
              "...CCCCCCCCCC...",
              "...ccCCCCCCcc...",
              "..cccccccccccc..",
              "CCCCCCCCCCCCCCCC",
            ]
          : [
              ".....JJJJJJ.....",
              "..JJjjjjjjJJJJ..",
              ".JjjjjjjjjjjjJJ.",
              "..RRRRRRRRRRRR..",
            ];
    stamp(top, 3, bob);
  }
  return pixels.map((r) => (direction === "left" ? r.reverse() : r).join(""));
}

export function avatarKey(
  direction: string,
  frame: number,
  outfit: OutfitId = "clay",
  hat: HatId = "none",
) {
  return outfit === "clay" && hat === "none"
    ? `avatar-${direction}-${frame}`
    : `avatar-${outfit}-${hat}-${direction}-${frame}`;
}
export function makeStudentAvatar(
  scene: Phaser.Scene,
  outfit: OutfitId = "clay",
  hat: HatId = "none",
) {
  const colors = outfits.find((o) => o.id === outfit)!.colors;
  const palette: Record<string, number> = {
    ...studentPalette,
    R: colors[0],
    J: colors[1],
    j: colors[2],
    A: colors[3],
  };
  for (const dir of ["down", "up", "left", "right"] as const)
    for (let frame = 0; frame < 4; frame++) {
      const key = avatarKey(dir, frame, outfit, hat);
      if (scene.textures.exists(key)) continue;
      const texture = scene.textures.createCanvas(
        key,
        avatarWidth,
        avatarHeight,
      );
      if (!texture) throw new Error(`Cannot allocate ${key}`);
      const context = texture.getContext(),
        image = context.createImageData(avatarWidth, avatarHeight);
      studentFrame(dir, frame, hat).forEach((row, y) =>
        [...row].forEach((p, x) => {
          if (p === ".") return;
          const color = palette[p],
            i = (y * avatarWidth + x) * 4;
          image.data[i] = color >> 16;
          image.data[i + 1] = (color >> 8) & 255;
          image.data[i + 2] = color & 255;
          image.data[i + 3] = 255;
        }),
      );
      context.putImageData(image, 0, 0);
      texture.refresh();
    }
}
