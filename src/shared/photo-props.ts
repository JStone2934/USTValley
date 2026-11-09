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
// Positioned in the user-marked eastern 6-1/6-2 zones.
// Stable instance IDs are retained when later photographs refine the arrangement.
export const roboticsLabScene = "interior_west_f6";
export const roboticsLabSource = 620722;
export const roboticsLabProps: PhotoProp[] = [
  {
    objectId: "w1-f6-robotics-mat",
    kind: "mat",
    name: "深灰拼接实验地垫",
    x: 569.0417312958216,
    y: 1109.293430503435,
    rotationDegrees: 346,
    width: 8,
    depth: 4.1,
    height: 0.025,
    collision: false,
  },
  {
    objectId: "w1-f6-mobile-dual-arm-01",
    kind: "mobile-arms",
    name: "双臂移动机器人",
    x: 550.4490958669762,
    y: 1079.553564613931,
    rotationDegrees: 346,
    width: 1.35,
    depth: 0.95,
    height: 1.7,
    collision: true,
  },
  {
    objectId: "w1-f6-humanoid-01",
    kind: "humanoid",
    name: "白色人形机器人",
    x: 551.2138242906094,
    y: 1106.5306544175414,
    rotationDegrees: 346,
    width: 0.7,
    depth: 0.5,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-support-frame-01",
    kind: "support-frame",
    name: "白色移动保护支架",
    x: 551.2138242906094,
    y: 1106.5306544175414,
    rotationDegrees: 346,
    width: 1.55,
    depth: 1.45,
    height: 2.25,
    collision: true,
  },
  {
    objectId: "w1-f6-humanoid-02",
    kind: "humanoid",
    name: "银色人形机器人",
    x: 571.1749222636415,
    y: 1114.8604507119112,
    rotationDegrees: 346,
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
    x: 571.1749222636415,
    y: 1114.8604507119112,
    rotationDegrees: 346,
    width: 1.9,
    depth: 1.85,
    height: 2.7,
    collision: true,
  },
  {
    objectId: "w1-f6-humanoid-03",
    kind: "humanoid",
    name: "后排白色人形机器人",
    x: 583.0953504994318,
    y: 1096.918365036985,
    rotationDegrees: 346,
    width: 0.7,
    depth: 0.5,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-support-frame-02",
    kind: "support-frame",
    name: "后排保护支架",
    x: 583.0953504994318,
    y: 1096.918365036985,
    rotationDegrees: 346,
    width: 1.55,
    depth: 1.45,
    height: 2.25,
    collision: true,
  },
  {
    objectId: "w1-f6-booth-01",
    kind: "booth",
    name: "设备区东侧连体面对面卡座",
    x: 577.2945170074447,
    y: 1051.236931772362,
    rotationDegrees: 76,
    width: 2.2,
    depth: 1.6,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-booth-02",
    kind: "booth",
    name: "设备区东侧连体面对面卡座",
    x: 580.7608541892921,
    y: 1065.1396508505213,
    rotationDegrees: 76,
    width: 2.2,
    depth: 1.6,
    height: 1.65,
    collision: true,
  },
  {
    objectId: "w1-f6-booth-03",
    kind: "booth",
    name: "设备区东侧连体面对面卡座",
    x: 584.2271913711395,
    y: 1079.0423699286816,
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
    x: 539.1893963254868,
    y: 1061.2920494511986,
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
    x: 582.8697213654204,
    y: 1116.9346061781657,
    rotationDegrees: 346,
    width: 1.4,
    depth: 0.7,
    height: 1.25,
    collision: true,
  },
  {
    objectId: "w1-f6-equipment-cabinet-01",
    kind: "cabinet",
    name: "深灰设备柜",
    x: 549.6358913201445,
    y: 1124.1118425679724,
    rotationDegrees: 346,
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
