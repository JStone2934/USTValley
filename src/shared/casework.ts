import type { Point } from "./world.ts";

export type RoomCasework = {
  sourceId: number;
  kind: "lectern" | "lab-bench" | "office-cabinet";
  /** Rear left, rear right, front right, front left, in floor pixels. */
  footprint: Point[];
  cells: number[];
};

export type SourcePointFixture = Point & {
  sourceId: number;
  kind: "coffee" | "first-aid";
  cells: number[];
};
