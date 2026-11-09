import type { Point, SceneMap } from "./world";
export type PhotoProp = {
  objectId: string;
  kind:
    | "humanoid"
    | "mobile-arms"
    | "hoist"
    | "support-frame"
    | "booth"
    | "desk"
    | "cabinet"
    | "mat";
  name: string;
  x: number;
  y: number;
  rotationDegrees: number;
  width: number;
  depth: number;
  height: number;
  variant?: "silver";
  collision: boolean;
};
// Scene-local coordinates; placement and sizes are photo-based estimates.
// Stable instance IDs are retained when later photographs refine the arrangement.
export const roboticsLabScene = "interior_west_f6";
export const roboticsLabSource = 620722;
export const roboticsLabProps: PhotoProp[] = [
  {
    objectId: "w1-f6-robotics-mat",
    kind: "mat",
    name: "深灰拼接实验地垫",
    x: 607,
    y: 1093,
    rotationDegrees: 76,
    width: 9.4,
    depth: 6.4,
    height: 0.025,
    collision: false,
  },
  {
    objectId: "w1-f6-mobile-dual-arm-01",
    kind: "mobile-arms",
    name: "双臂移动机器人",
    x: 601,
    y: 1073,
    rotationDegrees: 76,
    width: 1.35,
    depth: 0.95,
    height: 1.7,
    collision: true,
  },
  {
    objectId: "w1-f6-humanoid-01",
    kind: "humanoid",
    name: "白色人形机器人",
    x: 612,
    y: 1090,
    rotationDegrees: 76,
    width: 0.7,
    depth: 0.5,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-support-frame-01",
    kind: "support-frame",
    name: "白色移动保护支架",
    x: 612,
    y: 1090,
    rotationDegrees: 76,
    width: 1.55,
    depth: 1.45,
    height: 2.25,
    collision: true,
  },
  {
    objectId: "w1-f6-humanoid-02",
    kind: "humanoid",
    name: "银色人形机器人",
    x: 605,
    y: 1106,
    rotationDegrees: 76,
    width: 0.62,
    depth: 0.45,
    height: 1.7,
    variant: "silver",
    collision: true,
  },
  {
    objectId: "w1-f6-hoist-01",
    kind: "hoist",
    name: "黑色悬臂吊架与黄色手摇绞盘",
    x: 605,
    y: 1106,
    rotationDegrees: 76,
    width: 1.9,
    depth: 1.85,
    height: 2.7,
    collision: true,
  },
  {
    objectId: "w1-f6-humanoid-03",
    kind: "humanoid",
    name: "后排白色人形机器人",
    x: 622,
    y: 1118,
    rotationDegrees: 76,
    width: 0.7,
    depth: 0.5,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-support-frame-02",
    kind: "support-frame",
    name: "后排保护支架",
    x: 622,
    y: 1118,
    rotationDegrees: 76,
    width: 1.55,
    depth: 1.45,
    height: 2.25,
    collision: true,
  },
  {
    objectId: "w1-f6-booth-01",
    kind: "booth",
    name: "东墙连体面对面双人卡座（含桌面）",
    x: 646.17,
    y: 1070,
    rotationDegrees: 76,
    width: 2.2,
    depth: 1.6,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-booth-02",
    kind: "booth",
    name: "东墙连体面对面双人卡座（含桌面）",
    x: 649.6363371818474,
    y: 1083.9027190781599,
    rotationDegrees: 76,
    width: 2.2,
    depth: 1.6,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-booth-03",
    kind: "booth",
    name: "东墙连体面对面双人卡座（含桌面）",
    x: 653.1026743636947,
    y: 1097.8054381563195,
    rotationDegrees: 76,
    width: 2.2,
    depth: 1.6,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-workstation-01",
    kind: "desk",
    name: "白色工作台与显示器",
    x: 550,
    y: 1087,
    rotationDegrees: 346,
    width: 1.4,
    depth: 0.7,
    height: 1.25,
    collision: true,
  },
  {
    objectId: "w1-f6-workstation-02",
    kind: "desk",
    name: "后排工作台与显示器",
    x: 628,
    y: 1048,
    rotationDegrees: 76,
    width: 1.4,
    depth: 0.7,
    height: 1.25,
    collision: true,
  },
  {
    objectId: "w1-f6-equipment-cabinet-01",
    kind: "cabinet",
    name: "深灰设备柜",
    x: 630,
    y: 1130,
    rotationDegrees: 76,
    width: 0.8,
    depth: 0.65,
    height: 1.6,
    collision: true,
  },
];
export const photoProps = (scene: Pick<SceneMap, "id">) =>
  scene.id === roboticsLabScene ? roboticsLabProps : [];
export function propPoint(
  scene: SceneMap,
  item: PhotoProp,
  x: number,
  y: number,
): Point {
  const a = (item.rotationDegrees * Math.PI) / 180,
    s = scene.units.pixelsPerMeter;
  return {
    x: item.x + (x * Math.cos(a) - y * Math.sin(a)) * s,
    y: item.y + (x * Math.sin(a) + y * Math.cos(a)) * s,
  };
}
export const propFootprint = (scene: SceneMap, item: PhotoProp) =>
  [
    [-item.width / 2, -item.depth / 2],
    [item.width / 2, -item.depth / 2],
    [item.width / 2, item.depth / 2],
    [-item.width / 2, item.depth / 2],
  ].map(([x, y]) => propPoint(scene, item, x, y));
