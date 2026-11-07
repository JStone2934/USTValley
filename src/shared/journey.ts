import {
  canStand,
  canTraverse,
  hasLineOfSight,
  type Point,
  type SceneMap,
  type WorldMap,
} from "./world";

export const chestCooldown = 30 * 60 * 1000;
export const outfits = [
  {
    id: "clay",
    name: "赤陶外套",
    cost: 0,
    colors: [0x874b3b, 0xc86b42, 0xe58d55, 0xf2ac69],
  },
  {
    id: "moss",
    name: "苔绿漫步",
    cost: 10,
    colors: [0x34594c, 0x5a8b6c, 0x85b187, 0xb7cc98],
  },
  {
    id: "lake",
    name: "湖蓝手记",
    cost: 10,
    colors: [0x315368, 0x4b829d, 0x74acc0, 0xafd4d5],
  },
  {
    id: "plum",
    name: "暮色书页",
    cost: 10,
    colors: [0x674961, 0x976b8c, 0xc090ac, 0xe1b7c7],
  },
] as const;
export const hats = [
  { id: "none", name: "不戴帽子", cost: 0 },
  { id: "cap", name: "迎新鸭舌帽", cost: 20 },
  { id: "bucket", name: "散步渔夫帽", cost: 30 },
  { id: "beret", name: "手账贝雷帽", cost: 40 },
] as const;
export type OutfitId = (typeof outfits)[number]["id"];
export type HatId = (typeof hats)[number]["id"];
export type Progress = {
  schema: 1;
  coins: number;
  discovered: string[];
  talked: string[];
  observations: string[];
  completed: string[];
  chestReadyAt: Record<string, number>;
  chestsOpened: number;
  ownedOutfits: string[];
  ownedHats: string[];
  outfit: OutfitId;
  hat: HatId;
  location?: Point & { sceneId: string; mapVersion: string };
};
export const newProgress = (): Progress => ({
  schema: 1,
  coins: 0,
  discovered: [],
  talked: [],
  observations: [],
  completed: [],
  chestReadyAt: {},
  chestsOpened: 0,
  ownedOutfits: ["clay"],
  ownedHats: ["none"],
  outfit: "clay",
  hat: "none",
});
export type Npc = Point & {
  id: string;
  name: string;
  role: string;
  sceneId: string;
  outfit: OutfitId;
  hat: HatId;
  lines: string[];
  destination: string;
};
const npcDefinitions = [
  {
    id: "lin",
    name: "林同学",
    role: "迎新志愿者",
    outfit: "moss",
    hat: "cap",
    entrance: "",
    destination: "C2",
    lines: [
      "欢迎来到科大谷！我把一份校园手账放进了你的背包。每走进一栋建筑的探索区，就能留下一个印记，也会得到 5 枚探索币。",
      "先去前面的 C2 学生活动中心吧。走向金色门槛就能进门，沿绿色探索标记寻找公共大厅。路上遇见木宝箱，可以靠近按 E 打开；攒下的探索币能换外套和帽子。",
    ],
  },
  {
    id: "yun",
    name: "小芸",
    role: "阅读社成员",
    outfit: "plum",
    hat: "beret",
    entrance: "enter_c7",
    destination: "C7",
    lines: [
      "我喜欢把散步的终点留给图书馆。这里有书架，也有可以慢慢走过的阅读空间。进楼后别忘了看看手账，新的建筑印记会自动收好。",
      "如果想换个角度认识校园，可以在室外打开 3D 环视。等你逛完图书馆，再回到广场看看日晷——同一座校园，每次都有不同的细节。",
    ],
  },
  {
    id: "he",
    name: "阿禾",
    role: "校园观察员",
    outfit: "lake",
    hat: "bucket",
    entrance: "enter_e1",
    destination: "E1",
    lines: [
      "我正在记录科研楼之间的连廊。只沿着外墙走，和真正走进楼里，是两种很不一样的体验。",
      "东、西两翼都有各自的探索印记。走过五栋建筑，手账会为你记下“校园访客”的称号。慢慢走，不必一次完成所有地方。",
    ],
  },
] as const;
export function campusNpcs(world: WorldMap): Npc[] {
  const campus = world.scenes[0];
  return npcDefinitions.map((d) => {
    const portal = campus.portals.find((p) => p.id === d.entrance);
    const anchor = portal?.spawn ?? campus.spawns[0];
    const distances = portal ? [12, 16, 20, 24, 28] : [4, 6, 8, 10];
    for (const distance of distances)
      for (let n = 0; n < 16; n++) {
        const angle = (n * Math.PI) / 8;
        const point = {
          x: anchor.x + Math.cos(angle) * distance,
          y: anchor.y + Math.sin(angle) * distance,
        };
        if (
          canTraverse(campus, anchor, point) &&
          campus.portals.every(
            (p) =>
              Math.hypot(p.x - point.x, p.y - point.y) >
              campus.player.interactionRadius * 1.7,
          ) &&
          campus.chests.every(
            (c) =>
              Math.hypot(c.x - point.x, c.y - point.y) >
              campus.player.interactionRadius * 1.5,
          )
        ) {
          return { ...d, ...point, sceneId: campus.id, lines: [...d.lines] };
        }
      }
    throw new Error(`No walkable position for NPC ${d.id}`);
  });
}
export function canInteractWith(
  scene: SceneMap,
  player: Point,
  object: Point,
): boolean {
  return (
    canStand(scene, player) &&
    Math.hypot(player.x - object.x, player.y - object.y) <=
      scene.player.interactionRadius &&
    canTraverse(scene, player, object, 0)
  );
}
export const tasks = [
  {
    id: "first_walk",
    title: "初来科大谷",
    description: "认识林同学，探索 C2，再开启任意宝箱。",
    reward: 10,
    total: 3,
    count: (p: Progress) =>
      Number(p.talked.includes("lin")) +
      Number(p.discovered.includes("C2")) +
      Number(p.chestsOpened > 0),
    badge: "第一段校园记忆",
  },
  {
    id: "first_chest",
    title: "角落里的惊喜",
    description: "开启第一只探索宝箱。",
    reward: 5,
    total: 1,
    count: (p: Progress) => Number(p.chestsOpened > 0),
    badge: "寻宝新手",
  },
  {
    id: "reading",
    title: "书页之间",
    description: "认识小芸，并走进 C7 图书馆的探索区。",
    reward: 5,
    total: 2,
    count: (p: Progress) =>
      Number(p.talked.includes("yun")) + Number(p.discovered.includes("C7")),
    badge: "书页收集者",
  },
  {
    id: "sundial",
    title: "午后的一束光",
    description: "到红鸟广场，近距离观察日晷。",
    reward: 5,
    total: 1,
    count: (p: Progress) => Number(p.observations.includes("sundial")),
    badge: "光影观察员",
  },
  {
    id: "explore_5",
    title: "校园访客",
    description: "探索五栋不同的建筑。",
    reward: 0,
    total: 5,
    count: (p: Progress) => Math.min(5, p.discovered.length),
    badge: "校园访客",
  },
  {
    id: "explore_15",
    title: "科大漫游者",
    description: "收齐十五栋建筑的探索印记。",
    reward: 0,
    total: 15,
    count: (p: Progress) => p.discovered.length,
    badge: "科大漫游者",
  },
  {
    id: "friends",
    title: "路上的同行者",
    description: "与三位原创校园角色交谈。",
    reward: 5,
    total: 3,
    count: (p: Progress) => p.talked.length,
    badge: "校园同行者",
  },
] as const;
export type JourneyEvent =
  | { type: "discover"; id: string }
  | { type: "talk"; id: string }
  | { type: "observe"; id: string }
  | { type: "chest"; id: string; now: number }
  | { type: "wear"; kind: "outfit" | "hat"; id: string };
export function advanceProgress(
  previous: Progress,
  event: JourneyEvent,
  world: WorldMap,
): { progress: Progress; notices: string[] } {
  const p: Progress = structuredClone(previous),
    notices: string[] = [];
  if (event.type === "discover") {
    const b = world.buildings.find((b) => b.id === event.id);
    if (!b || p.discovered.includes(event.id))
      return { progress: previous, notices };
    p.discovered.push(event.id);
    p.coins += 5;
    notices.push(`发现 ${b.id} · ${b.name}，探索币 +5`);
  } else if (event.type === "talk") {
    if (
      !npcDefinitions.some((n) => n.id === event.id) ||
      p.talked.includes(event.id)
    )
      return { progress: previous, notices };
    p.talked.push(event.id);
  } else if (event.type === "observe") {
    if (event.id !== "sundial" || p.observations.includes(event.id))
      return { progress: previous, notices };
    p.observations.push(event.id);
  } else if (event.type === "chest") {
    if (
      !Number.isFinite(event.now) ||
      event.now < 0 ||
      !world.scenes.some((s) => s.chests.some((c) => c.id === event.id)) ||
      (p.chestReadyAt[event.id] ?? 0) > event.now
    )
      return { progress: previous, notices };
    p.chestReadyAt[event.id] = event.now + chestCooldown;
    p.chestsOpened++;
    p.coins += 10;
    notices.push("开启探索宝箱，探索币 +10");
  } else {
    const item = (event.kind === "outfit" ? outfits : hats).find(
      (i) => i.id === event.id,
    );
    if (!item) return { progress: previous, notices };
    const owned = event.kind === "outfit" ? p.ownedOutfits : p.ownedHats;
    if (!owned.includes(item.id)) {
      if (p.coins < item.cost)
        return {
          progress: previous,
          notices: ["探索币还不够，先去发现新的建筑吧。"],
        };
      p.coins -= item.cost;
      owned.push(item.id);
      notices.push(`解锁 ${item.name}`);
    }
    if (event.kind === "outfit") p.outfit = item.id as OutfitId;
    else p.hat = item.id as HatId;
  }
  for (const task of tasks)
    if (!p.completed.includes(task.id) && task.count(p) >= task.total) {
      p.completed.push(task.id);
      p.coins += task.reward;
      notices.push(
        `完成「${task.title}」${task.reward ? `，探索币 +${task.reward}` : `，获得称号`}`,
      );
    }
  return { progress: p, notices };
}
export function restoreProgress(raw: unknown, world: WorldMap): Progress {
  const p = newProgress();
  if (!raw || typeof raw !== "object" || (raw as Progress).schema !== 1)
    return p;
  const s = raw as Record<string, unknown>;
  const strings = (key: string, allowed: string[]) =>
    Array.isArray(s[key])
      ? [
          ...new Set(
            (s[key] as unknown[]).filter(
              (v): v is string => typeof v === "string" && allowed.includes(v),
            ),
          ),
        ]
      : [];
  p.discovered = strings(
    "discovered",
    world.buildings.map((b) => b.id),
  );
  p.talked = strings(
    "talked",
    npcDefinitions.map((n) => n.id),
  );
  p.observations = strings("observations", ["sundial"]);
  p.coins =
    Number.isSafeInteger(s.coins) && Number(s.coins) >= 0
      ? Math.min(Number(s.coins), 9999999)
      : 0;
  p.chestsOpened =
    Number.isSafeInteger(s.chestsOpened) && Number(s.chestsOpened) >= 0
      ? Math.min(Number(s.chestsOpened), 999999)
      : 0;
  p.completed = strings(
    "completed",
    tasks.filter((t) => t.count(p) >= t.total).map((t) => t.id),
  );
  p.ownedOutfits = [
    ...new Set([
      "clay",
      ...strings(
        "ownedOutfits",
        outfits.map((o) => o.id),
      ),
    ]),
  ];
  p.ownedHats = [
    ...new Set([
      "none",
      ...strings(
        "ownedHats",
        hats.map((h) => h.id),
      ),
    ]),
  ];
  if (typeof s.outfit === "string" && p.ownedOutfits.includes(s.outfit))
    p.outfit = s.outfit as OutfitId;
  if (typeof s.hat === "string" && p.ownedHats.includes(s.hat))
    p.hat = s.hat as HatId;
  if (s.chestReadyAt && typeof s.chestReadyAt === "object")
    for (const c of world.scenes.flatMap((s) => s.chests)) {
      const time = (s.chestReadyAt as Record<string, unknown>)[c.id];
      if (typeof time === "number" && Number.isFinite(time) && time > 0)
        p.chestReadyAt[c.id] = time;
    }
  if (s.location && typeof s.location === "object") {
    const l = s.location as Progress["location"];
    const scene = world.scenes.find((scene) => scene.id === l?.sceneId);
    if (l && scene && l.mapVersion === world.mapVersion && canStand(scene, l))
      p.location = {
        x: l.x,
        y: l.y,
        sceneId: scene.id,
        mapVersion: world.mapVersion,
      };
  }
  return p;
}
