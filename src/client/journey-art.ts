import type Phaser from "phaser";
import { actorOcclusion } from "./occlusion";
import { avatarKey, makeStudentAvatar } from "./avatar-art";
import { campusNpcs, canInteractWith } from "../shared/journey";
import type { SceneMap, Point, WorldMap } from "../shared/world";
import type { ProgressStore } from "./progress-store";

export function addJourneyArt(
  scene: Phaser.Scene,
  map: SceneMap,
  world: WorldMap,
  store: ProgressStore,
  cue: (object: Phaser.GameObjects.Text, max: number, dy?: number) => void,
) {
  const occlusions: NonNullable<ReturnType<typeof actorOcclusion>>[] = [];
  function cover(point: Point, depth: number, id: string) {
    const foreground = actorOcclusion(scene, map, `journey-foreground-${id}`);
    if (foreground) {
      foreground.update(point.x, point.y, depth);
      occlusions.push(foreground);
    }
  }
  const npcs = campusNpcs(world)
    .filter((n) => n.sceneId === map.id)
    .map((npc) => {
      makeStudentAvatar(scene, npc.outfit, npc.hat);
      scene.add
        .ellipse(
          npc.x,
          npc.y,
          map.player.width,
          map.player.groundDepth,
          0x31443a,
          0.25,
        )
        .setDepth(-50);
      const body = scene.add
        .image(npc.x, npc.y, avatarKey("down", 0, npc.outfit, npc.hat))
        .setOrigin(0.5, 1)
        .setDisplaySize(map.player.width, map.player.height)
        .setDepth(6000 + npc.y)
        .setName(`npc-${npc.id}`);
      const label = scene.add
        .text(npc.x, npc.y - map.player.height - 1, npc.name, {
          fontSize: "4px",
          color: "#35564b",
          backgroundColor: "#fff6df",
          padding: { x: 1, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(12000)
        .setName(`npc-label-${npc.id}`);
      cue(label, 2.4);
      cover(npc, body.depth, `npc-${npc.id}`);
      return { npc, body, label };
    });
  const chests = map.chests.map((chest) => {
    const dimensions = world.chest,
      ppm = map.units.pixelsPerMeter;
    const body = scene.add
      .graphics({ x: chest.x, y: chest.y })
      .setDepth(6000 + chest.y)
      .setScale(
        (dimensions.widthMeters * ppm) / 14,
        ((dimensions.heightMeters * map.units.heightProjection +
          dimensions.depthMeters) *
          ppm) /
          12,
      )
      .setName(`chest-${chest.id}`);
    const label = scene.add
      .text(chest.x, chest.y - dimensions.heightMeters * ppm - 1, "宝箱", {
        fontSize: "3px",
        color: "#765323",
        backgroundColor: "#fff4d0",
        padding: { x: 1, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(12000);
    cue(label, 2);
    cover(chest, body.depth, `chest-${chest.id}`);
    return { chest, body, label, ready: undefined as boolean | undefined };
  });
  const update = (player: Point) => {
    const progress = store.snapshot.progress;
    for (const { npc, body, label } of npcs) {
      const dx = player.x - npc.x,
        dy = player.y - npc.y;
      const facing =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "right"
            : "left"
          : dy > 0
            ? "down"
            : "up";
      if (Math.hypot(dx, dy) < map.player.interactionRadius * 4)
        body.setTexture(avatarKey(facing, 0, npc.outfit, npc.hat));
      const near = canInteractWith(map, player, npc);
      label.setText(
        `${near ? "E · " : progress.talked.includes(npc.id) ? "" : "! "}${npc.name}`,
      );
    }
    for (const object of chests) {
      const { chest, body, label } = object;
      const remaining = (progress.chestReadyAt[chest.id] ?? 0) - Date.now(),
        ready = remaining <= 0;
      if (ready !== object.ready) {
        object.ready = ready;
        body.clear();
        body.fillStyle(0x263c35, 0.25).fillEllipse(0, 0, 16, 5);
        body.fillStyle(0x684930).fillRect(-7, -9, 14, 9);
        body.fillStyle(0xa87142).fillRect(-6, -8, 12, 7);
        body.fillStyle(0x4e392c).fillRect(-5, -7, 10, ready ? 2 : 5);
        body
          .fillStyle(0xcca16a)
          .fillRect(-7, ready ? -12 : -16, 14, ready ? 5 : 4);
        body
          .fillStyle(0xf2d595)
          .fillRect(-5, ready ? -12 : -16, 2, ready ? 12 : 4)
          .fillRect(3, ready ? -12 : -16, 2, ready ? 12 : 4);
        body.fillStyle(0xffe6a3).fillRect(-1, -8, 2, 3);
        body.lineStyle(0.6, 0x634c35).strokeRect(-7, -9, 14, 9);
        body.setData("opened", !ready);
      }
      const near = canInteractWith(map, player, chest);
      label
        .setText(
          ready
            ? near
              ? "E · 打开宝箱"
              : "✦ 宝箱"
            : `${Math.ceil(remaining / 60000)} 分钟后补充`,
        )
        .setVisible(ready || near);
    }
  };
  return Object.assign(update, {
    dispose() {
      occlusions.forEach((foreground) => foreground.dispose());
    },
  });
}
