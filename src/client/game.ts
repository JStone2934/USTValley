import Phaser from "phaser";
import {
  contains,
  move,
  nearbyPortal,
  type Point,
  type SceneMap,
  type WorldMap,
  type Roof,
} from "../shared/world";

export type Snapshot = {
  sceneId: string;
  position: Point;
  discovered: string[];
  target?: string;
  zoom: number;
};
export class GameBridge extends EventTarget {
  direction: Point = { x: 0, y: 0 };
  keys = new Set<string>();
  paused = false;
  references = false;
  scene?: CampusScene;
  snapshot: Snapshot = {
    sceneId: "campus_core",
    position: { x: 0, y: 0 },
    discovered: [],
    zoom: 2,
  };
  clear() {
    this.keys.clear();
    this.direction = { x: 0, y: 0 };
  }
  pause(value: boolean) {
    this.paused = value;
    this.clear();
    this.scene?.publish();
  }
  emit(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.dispatchEvent(new Event("change"));
  }
  interact() {
    if (!this.paused) this.scene?.interact();
  }
  reset() {
    this.clear();
    this.scene?.restartWalk();
  }
  toggleReferences() {
    this.references = !this.references;
    this.scene?.drawReferences();
  }
  zoom(value: number) {
    this.scene?.setZoom(value);
  }
}

export class CampusScene extends Phaser.Scene {
  private current!: SceneMap;
  private player!: Phaser.GameObjects.Image;
  private referenceLayer!: Phaser.GameObjects.Graphics;
  private discovered = new Set<string>();
  private position: Point = { x: 0, y: 0 };
  private lastEmit = 0;
  private direction = "down";
  private scaleFactor = 2;
  constructor(
    private world: WorldMap,
    private bridge: GameBridge,
  ) {
    super("campus");
  }
  preload() {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, () =>
      this.bridge.dispatchEvent(new Event("loaderror")),
    );
    const assets = new Set(
      this.world.scenes.flatMap((s) => [
        s.art.ground,
        ...s.art.roofs.map((r) => r.image),
      ]),
    );
    for (const asset of assets) this.load.image(asset, `/maps/${asset}`);
  }
  create() {
    if (
      !this.world.scenes.every(
        (s) =>
          this.textures.exists(s.art.ground) &&
          s.art.roofs.every((r) => this.textures.exists(r.image)),
      )
    )
      return;
    this.bridge.scene = this;

    this.makeAvatar();
    this.restartWalk();
  }
  restartWalk() {
    this.discovered.clear();
    const scene = this.world.scenes.find((s) => s.id === "campus_core")!;
    this.enterScene(scene.id, scene.spawns[0]);
  }
  private makeAvatar() {
    for (const dir of ["down", "up", "left", "right"])
      for (let frame = 0; frame < 4; frame++) {
        const g = this.make.graphics({ x: 0, y: 0 });
        const step = frame % 2 ? 1 : 0;
        g.fillStyle(0x283d36, 0.25).fillRect(2, 28, 12, 3);
        g.fillStyle(0x344655)
          .fillRect(4, 23, 3, 6 - step)
          .fillRect(9, 23, 3, 5 + step);
        g.fillStyle(0xf4db92).fillRect(3, 13, 10, 11);
        g.fillStyle(0xdfa473)
          .fillRect(1, 15 + step, 2, 7)
          .fillRect(13, 15 - step, 2, 7);
        g.fillStyle(0xe8b98c).fillRect(3, 3, 10, 10);
        g.fillStyle(0x45382c)
          .fillRect(2, 2, 12, 5)
          .fillRect(dir === "right" ? 2 : 12, 6, 2, 4);
        if (dir === "up") g.fillRect(3, 5, 10, 6);
        else g.fillStyle(0x343b35).fillRect(dir === "left" ? 4 : 9, 8, 2, 2);
        g.generateTexture(`avatar-${dir}-${frame}`, 16, 32);
        g.destroy();
      }
  }
  private enterScene(id: string, point: Point) {
    this.bridge.clear();
    this.children.removeAll(true);
    this.current = this.world.scenes.find((s) => s.id === id)!;
    this.position = { ...point };
    const s = this.current;
    this.add.image(0, 0, s.art.ground).setOrigin(0).setDepth(-100);
    this.roofSprites = s.art.roofs.map((roof) => ({
      roof,
      sprite: this.add
        .image(roof.x, roof.y, roof.image)
        .setOrigin(0)
        .setDepth(5000),
    }));
    const g = this.add.graphics().setDepth(5500);
    for (const b of s.buildings) {
      this.add
        .text(b.label.x, b.label.y - 18, b.id, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#243e34",
          backgroundColor: "#f5edd3",
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(10000);
    }
    for (const z of s.exploration) {
      g.fillStyle(0x87a899, 0.6).fillRect(z.x, z.y, z.width, z.height);
      this.add
        .text(
          z.x + z.width / 2,
          z.y + z.height / 2,
          `${z.buildingId}\n探索区`,
          { fontSize: "10px", color: "#294b3c", align: "center" },
        )
        .setOrigin(0.5)
        .setDepth(-40);
    }
    for (const z of s.note_zones)
      g.lineStyle(1, 0x9a7f51, 0.5).strokeRect(z.x, z.y, z.width, z.height);
    for (const c of s.chests) {
      const chest = this.add.graphics().setDepth(c.y);
      chest.fillStyle(0x8b5b36).fillRect(c.x - 7, c.y - 10, 14, 10);
      chest.fillStyle(0xc9974d).fillRect(c.x - 6, c.y - 9, 12, 4);
      chest.fillStyle(0xf4d677).fillRect(c.x - 1, c.y - 5, 3, 4);
    }
    for (const p of s.portals) {
      g.fillStyle(0xf0d893, 0.8).fillRect(p.x - 6, p.y - 3, 12, 6);
      if (id !== "campus_core")
        this.add
          .text(p.x, p.y - 12, "↓ 返回校园", {
            fontSize: "10px",
            color: "#365545",
          })
          .setOrigin(0.5)
          .setDepth(-40);
    }
    this.referenceLayer = this.add.graphics().setDepth(11000);
    this.drawReferences();
    this.player = this.add
      .image(point.x, point.y, "avatar-down-0")
      .setOrigin(0.5, 1);
    this.cameras.main
      .setBounds(0, 0, s.width * 16, s.height * 16)
      .setZoom(this.scaleFactor)
      .startFollow(this.player, true, 1, 1);
    this.cameras.main.roundPixels = true;
    this.publish();
  }
  private roofSprites: { roof: Roof; sprite: Phaser.GameObjects.Image }[] = [];
  drawReferences() {
    if (!this.referenceLayer) return;
    const g = this.referenceLayer.clear();
    if (!this.bridge.references) return;
    g.lineStyle(1, 0x416c78, 0.55);
    for (const line of this.current.sourceRoads) g.strokePoints(line, false);
    g.lineStyle(1, 0x80565a, 0.6);
    for (const shape of this.current.sourceOutlines)
      g.strokePoints(shape.points, true);
    for (const p of this.current.sourceEntries)
      g.fillStyle(0xb26053).fillCircle(p.x, p.y, 3);
  }
  setZoom(value: number) {
    this.scaleFactor = Math.max(1, Math.min(4, Math.round(value)));
    this.cameras.main.setZoom(this.scaleFactor);
    this.publish();
  }
  interact() {
    const p = nearbyPortal(
      this.current,
      this.position,
      this.world.interactionRadius,
    );
    if (!p) return;
    const target = this.world.scenes.find((s) => s.id === p.targetScene)!;
    const reverse = target.portals.find((q) => q.id === p.targetPortal)!;
    this.enterScene(target.id, reverse.spawn);
  }
  publish() {
    if (!this.current) return;
    const portal = nearbyPortal(
      this.current,
      this.position,
      this.world.interactionRadius,
    );
    this.bridge.emit({
      sceneId: this.current.id,
      position: { ...this.position },
      discovered: [...this.discovered],
      target: portal
        ? this.current.id === "campus_core"
          ? `进入 ${portal.buildingId}`
          : "返回校园"
        : undefined,
      zoom: this.scaleFactor,
    });
  }
  update(time: number, delta: number) {
    if (!this.player) return;
    const k = this.bridge.keys;
    const input = this.bridge.paused
      ? { x: 0, y: 0 }
      : {
          x:
            this.bridge.direction.x +
            Number(k.has("d") || k.has("ArrowRight")) -
            Number(k.has("a") || k.has("ArrowLeft")),
          y:
            this.bridge.direction.y +
            Number(k.has("s") || k.has("ArrowDown")) -
            Number(k.has("w") || k.has("ArrowUp")),
        };
    const before = this.position;
    this.position = move(
      this.current,
      this.position,
      input,
      delta / 1000,
      this.world.speed,
      this.world.playerRadius,
    );
    const moving =
      Math.hypot(before.x - this.position.x, before.y - this.position.y) > 0.01;
    if (moving)
      this.direction =
        Math.abs(input.x) > Math.abs(input.y)
          ? input.x > 0
            ? "right"
            : "left"
          : input.y > 0
            ? "down"
            : "up";
    this.player
      .setPosition(Math.round(this.position.x), Math.round(this.position.y))
      .setDepth(6000)
      .setTexture(
        `avatar-${this.direction}-${moving ? Math.floor(time / 130) % 4 : 0}`,
      );
    for (const { roof, sprite } of this.roofSprites) {
      const within = roof.footprint.some((poly) =>
        inPolygon(this.position, poly),
      );
      const nearDoor = this.current.portals.some(
        (p) =>
          Math.hypot(p.x - this.position.x, p.y - this.position.y) < 40 &&
          p.x >= roof.x &&
          p.x <= roof.x + roof.width &&
          p.y >= roof.y &&
          p.y <= roof.y + roof.height,
      );
      const alpha = within || nearDoor ? 0.32 : 1;
      sprite.setAlpha(
        Phaser.Math.Linear(sprite.alpha, alpha, Math.min(1, delta / 100)),
      );
    }
    for (const zone of this.current.exploration)
      if (contains(zone, this.position)) this.discovered.add(zone.buildingId);
    if (time - this.lastEmit >= 100) {
      this.lastEmit = time;
      this.publish();
    }
  }
}

export function createGame(
  parent: HTMLDivElement,
  world: WorldMap,
  bridge: GameBridge,
) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#88a56c",
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth,
      height: parent.clientHeight,
    },
    scene: [new CampusScene(world, bridge)],
    callbacks: {
      postBoot: () => {
        const canvas = game.canvas;
        canvas.setAttribute("aria-label", "科大谷校园探索画面");
        canvas.setAttribute("role", "img");
      },
    },
  });
  const observer = new ResizeObserver(() => {
    if (parent.clientWidth && parent.clientHeight)
      game.scale.resize(parent.clientWidth, parent.clientHeight);
  });
  observer.observe(parent);
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const typing = () =>
    document.activeElement?.matches(
      'input,textarea,select,[contenteditable="true"]',
    );
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        typing() ||
        e.isComposing ||
        bridge.paused ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(key)
      ) {
        e.preventDefault();
        bridge.keys.add(key);
      }
      if (key === "e" && !e.repeat) bridge.interact();
    },
    options,
  );
  window.addEventListener(
    "keyup",
    (e) => bridge.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key),
    options,
  );
  window.addEventListener("blur", () => bridge.clear(), options);
  document.addEventListener("visibilitychange", () => bridge.clear(), options);
  document.addEventListener(
    "focusin",
    () => {
      if (typing()) bridge.clear();
    },
    options,
  );
  return () => {
    abort.abort();
    observer.disconnect();
    bridge.clear();
    bridge.scene = undefined;
    game.destroy(true);
  };
}

function inPolygon(point: Point, rings: Point[][]): boolean {
  const inside = (ring: Point[]) => {
    let value = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        value = !value;
    }
    return value;
  };
  return inside(rings[0]) && !rings.slice(1).some(inside);
}
