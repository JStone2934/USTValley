import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avatarHeight,
  avatarWidth,
  studentFrame,
  studentPalette,
} from "../src/client/avatar-art.ts";

test("the campus student has distinct four-frame walks and a planted foot in every direction", () => {
  for (const dir of ["down", "up", "left", "right"] as const) {
    const frames = Array.from({ length: 4 }, (_, i) => studentFrame(dir, i));
    assert.equal(new Set(frames.map((frame) => frame.join(""))).size, 4);
    for (const rows of frames) {
      assert.equal(rows.length, avatarHeight);
      assert.ok(
        rows.every(
          (row) =>
            row.length === avatarWidth &&
            [...row].every((ink) => ink === "." || ink in studentPalette),
        ),
      );
      assert.ok(rows.at(-1)?.includes("P"));
    }
    assert.ok(frames[0][0].includes("H"));
  }
  assert.notDeepEqual(studentFrame("up", 0), studentFrame("down", 0));
});
