import { test } from "node:test";
import assert from "node:assert/strict";
import {
  photoReviewSchema,
  hasLocatedPhotoChange,
} from "../../src/shared/photo-review";
const legacy = {
  id: "00000000-0000-4000-8000-000000000001",
  outcome: "applied",
  observations: "照片可见一组长椅与花盆",
  changes: "补充像素花盆",
  sourceIds: [],
  uncertainties: "花盆位置及尺寸为估计，后续照片可修正",
};
const planter = {
  objectId: "academic-f2-planter-01",
  name: "走廊花盆",
  action: "added",
  observation: "白色圆盆和深绿色叶片，大致位于连廊边缘",
  nextUpdate: "补充侧面照片后调整间距",
  placement: {
    sceneId: "interior_academic_f2",
    position: { x: 430, y: 510 },
    rotationDegrees: 0,
    dimensionsMeters: { width: 0.45, depth: 0.45, height: 0.9 },
    support: "floor",
    collision: "solid",
    accuracy: "approximate",
    locationBasis: "根据连廊边缘估计；不要求精确复刻",
    scaleBasis: "按常见花盆与角色身高估计",
  },
};
test("recognizable new objects can be applied at approximate positions without source feature IDs", () => {
  const photo = photoReviewSchema.parse({
    photos: [{ ...legacy, objects: [planter] }],
  }).photos[0];
  assert.equal(hasLocatedPhotoChange(photo), true);
  assert.equal(photo.objects[0].placement?.accuracy, "approximate");
  assert.equal(photo.objects[0].objectId, planter.objectId);
  assert.equal(photo.objects[0].nextUpdate, planter.nextUpdate);
});
test("later photos update the same object identity without requiring confirmed precision", () => {
  const photo = photoReviewSchema.parse({
    photos: [
      {
        ...legacy,
        objects: [
          {
            ...planter,
            action: "updated",
            placement: { ...planter.placement, position: { x: 434, y: 507 } },
          },
        ],
      },
    ],
  }).photos[0];
  assert.equal(photo.objects[0].objectId, planter.objectId);
  assert.equal(photo.objects[0].placement?.position.x, 434);
  assert.equal(hasLocatedPhotoChange(photo), true);
});
test("placement still needs finite coordinates, sensible dimensions and an omission explanation", () => {
  const parse = (o: unknown) =>
    photoReviewSchema.parse({ photos: [{ ...legacy, objects: [o] }] });
  assert.throws(() => parse({ ...planter, placement: undefined }));
  assert.throws(() =>
    parse({
      ...planter,
      placement: { ...planter.placement, position: { x: NaN, y: 0 } },
    }),
  );
  assert.throws(() =>
    parse({
      ...planter,
      placement: {
        ...planter.placement,
        dimensionsMeters: { width: -1, depth: 1, height: 1 },
      },
    }),
  );
  assert.throws(() => parse({ ...planter, action: "deferred", reason: "" }));
  assert.throws(() =>
    photoReviewSchema.parse({
      photos: [{ ...legacy, objects: [planter, planter] }],
    }),
  );
});
test("older material-only reviews remain valid; an unplaced object is not a completed change", () => {
  const old = photoReviewSchema.parse({
    photos: [{ ...legacy, sourceIds: [44821] }],
  }).photos[0];
  assert.deepEqual(old.objects, []);
  assert.equal(hasLocatedPhotoChange(old), true);
  const pending = photoReviewSchema.parse({
    photos: [
      {
        ...legacy,
        objects: [
          {
            ...planter,
            action: "deferred",
            placement: undefined,
            reason: "无法辨认是灯具还是临时支架",
          },
        ],
      },
    ],
  }).photos[0];
  assert.equal(hasLocatedPhotoChange(pending), false);
});
