import { z } from "zod";
import config from "../../content/map-config.json";
import { project, type Point, type WorldMap, type SceneMap } from "./world";
export const photoLimits = {
  bytes: 25 * 1024 * 1024,
  pixels: 80_000_000,
  batch: 20,
};
export const poseInput = z
  .object({
    sceneId: z.string().min(1).max(100),
    mapVersion: z.string().max(100),
    x: z.number().finite(),
    y: z.number().finite(),
    heading: z.number().finite().min(0).lt(360),
    pitch: z.number().finite().min(-90).max(90).nullable().default(null),
    buildingId: z.string().max(12).nullable().default(null),
    blockedConfirmed: z.boolean().default(false),
  })
  .strict();
export type PoseInput = z.input<typeof poseInput>;
export type PhotoPose = z.output<typeof poseInput> & {
  sourceMap: string;
  floorKey: string;
  floorName: string;
  elevation: number;
  source: Point;
  transform: typeof config.transform;
  scale: number;
  offset: Point;
};
export function sourcePoint(scene: SceneMap, p: Point): Point {
  const t = config.transform,
    k = scene.units.pixelsPerProjectedUnit;
  const x = (p.x - scene.sourceOffset.x) / k;
  const y = ((p.y - scene.sourceOffset.y) / k) * (t.flipY ? -1 : 1);
  const a = (-t.rotationDegrees * Math.PI) / 180;
  return {
    x: t.origin[0] + x * Math.cos(a) - y * Math.sin(a),
    y: t.origin[1] + x * Math.sin(a) + y * Math.cos(a),
  };
}
export function scenePoint(scene: SceneMap, p: Point): Point {
  const q = project([p.x, p.y], {
    ...config.transform,
    pixelsPerProjectedUnit: scene.units.pixelsPerProjectedUnit,
  });
  return { x: q.x + scene.sourceOffset.x, y: q.y + scene.sourceOffset.y };
}
// Heading is clockwise from source-grid north, not screen up or camera yaw.
export function headingVector(degrees: number): Point {
  const a = (degrees * Math.PI) / 180,
    r = (config.transform.rotationDegrees * Math.PI) / 180;
  const x = Math.sin(a),
    y = Math.cos(a);
  return {
    x: x * Math.cos(r) - y * Math.sin(r),
    y: (x * Math.sin(r) + y * Math.cos(r)) * (config.transform.flipY ? -1 : 1),
  };
}
export function vectorHeading(p: Point): number {
  const y = p.y * (config.transform.flipY ? -1 : 1),
    a = (-config.transform.rotationDegrees * Math.PI) / 180;
  return (
    ((Math.atan2(
      p.x * Math.cos(a) - y * Math.sin(a),
      p.x * Math.sin(a) + y * Math.cos(a),
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}
export function reproject(world: WorldMap, pose: PhotoPose) {
  const scene = world.scenes.find(
    (s) =>
      s.id === pose.sceneId &&
      s.sourceMap === pose.sourceMap &&
      s.floor.key === pose.floorKey,
  );
  if (!scene) return null;
  const p = scenePoint(scene, pose.source);
  if (
    p.x < 0 ||
    p.y < 0 ||
    p.x >= scene.width * scene.tileSize ||
    p.y >= scene.height * scene.tileSize
  )
    return null;
  return { sceneId: scene.id, ...p };
}
export const photoStates = ["pending", "used", "declined"] as const;
export type PhotoRecord = {
  id: string;
  revision: number;
  pose: PhotoPose;
  status: (typeof photoStates)[number];
  note: string;
  createdAt: number;
  sha256: string;
  previewSha256: string;
  originalName: string;
  width: number;
  height: number;
  format: string;
  capturedAt: string | null;
  capturedAtSource: "user" | null;
  appliedVersion: string | null;
  maintenanceNote: string;
  draft: boolean;
};
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.string().uuid(),
    createdAt: z.number(),
    photos: z
      .array(
        z.object({
          id: z.string().uuid(),
          revision: z.number().int().positive(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          previewSha256: z.string().regex(/^[a-f0-9]{64}$/),
          original: z.string(),
          preview: z.string(),
          pose: z.object({
            sceneId: z.string(),
            mapVersion: z.string(),
            sourceMap: z.string(),
            floorKey: z.string(),
            floorName: z.string(),
            elevation: z.number().finite(),
            source: z.object({
              x: z.number().finite(),
              y: z.number().finite(),
            }),
            x: z.number().finite(),
            y: z.number().finite(),
            heading: z.number().min(0).lt(360),
            pitch: z.number().min(-90).max(90).nullable(),
            buildingId: z.string().nullable(),
            transform: z.object({
              origin: z.array(z.number()).length(2),
              rotationDegrees: z.number(),
              pixelsPerProjectedUnit: z.number().positive(),
              flipY: z.boolean(),
              padding: z.number(),
            }),
            scale: z.number().positive(),
            offset: z.object({ x: z.number(), y: z.number() }),
            blockedConfirmed: z.boolean(),
          }),
          note: z.string().max(1000),
          capturedAt: z.string().nullable(),
          capturedAtSource: z.literal("user").nullable(),
        }),
      )
      .min(1)
      .max(photoLimits.batch),
  })
  .strict();
export type PhotoManifest = z.infer<typeof manifestSchema>;
export const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.string().uuid(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    baseline: z.string().regex(/^[a-f0-9]{40}$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    branch: z.string().regex(/^photo-rebuild\/[a-zA-Z0-9_-]+$/),
    status: z.enum(["review", "needs-evidence", "failed"]),
    verification: z.object({
      passed: z.boolean(),
      reportHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    photos: z
      .array(
        z.object({
          id: z.string().uuid(),
          revision: z.number().int().positive(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          outcome: z.enum(["applied", "unchanged", "needs-evidence", "failed"]),
          summary: z.string().max(2000),
        }),
      )
      .min(1)
      .max(photoLimits.batch),
  })
  .strict();
export type RebuildReceipt = z.infer<typeof receiptSchema>;
