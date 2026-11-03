import Phaser from "phaser";
import { passageLabel, passageMarkers } from "../shared/passages";
import {
  contains,
  move,
  nearbyPortal,
  nearbyPortals,
  type Point,
  type SceneMap,
  type WorldMap,
  type Roof,
} from "../shared/world";

export const CAMERA_ZOOM = { min: 1, initial: 4, max: 10 } as const;

export type Snapshot = {
  sceneId: string;
  position: Point;
  discovered: string[];
  target?: string;
  passages?: { id: string; label: string }[];
  zoom: number;
  avatarSize?: { width: number; height: number };
  floorImages?: string[];
  stairMarkers?: number;
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
    zoom: CAMERA_ZOOM.initial,
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
  interact(portalId?: string) {
    if (!this.paused) this.scene?.interact(portalId);
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
  private loading = false;
  private pendingReset = false;
  private direction = "down";
  private scaleFactor: number = CAMERA_ZOOM.initial;
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
    for (const asset of this.assets(this.world.scenes[0]))
      this.load.image(asset, `/maps/${asset}`);
  }
  private assets(scene: SceneMap) {
    // Static source layers are baked into one ground texture; roofs remain dynamic.
    return [
      scene.art.ground,
      ...(scene.id === "campus_core"
        ? scene.art.roofs.map((r) => r.image)
        : []),
    ];
  }
  create() {
    if (
      !this.assets(this.world.scenes[0]).every((asset) =>
        this.textures.exists(asset),
      )
    )
      return;
    this.bridge.scene = this;

    this.makeAvatar();
    this.restartWalk();
  }
  restartWalk() {
    if (this.loading) {
      this.pendingReset = true;
      this.bridge.clear();
      return;
    }
    this.discovered.clear();
    const scene = this.world.scenes.find((s) => s.id === "campus_core")!;
    this.enterScene(scene.id, scene.spawns[0]);
  }
  private makeAvatar() {
    for (const dir of ["down", "up", "left", "right"])
      for (let frame = 0; frame < 4; frame++) {
        const g = this.make.graphics({ x: 0, y: 0 });
        const step = frame % 2 ? 1 : 0;

        g.fillStyle(0x344655)
          .fillRect(4, 23, 3, 9 - step)
          .fillRect(9, 23, 3, 8 + step);
        g.fillStyle(0xc86b42).fillRect(3, 13, 10, 11);
        g.fillStyle(0xdfa473)
          .fillRect(0, 15 + step, 2, 7)
          .fillRect(14, 15 - step, 2, 7);
        g.fillStyle(0xe8b98c).fillRect(3, 3, 10, 10);
        g.fillStyle(0x45382c)
          .fillRect(2, 0, 12, 7)
          .fillRect(dir === "right" ? 2 : 12, 6, 2, 4);
        if (dir === "up") g.fillRect(3, 5, 10, 6);
        else g.fillStyle(0x343b35).fillRect(dir === "left" ? 4 : 9, 8, 2, 2);
        g.generateTexture(`avatar-${dir}-${frame}`, 16, 32);
        g.destroy();
      }
  }
  private enterScene(id: string, point: Point) {
    const next = this.world.scenes.find((s) => s.id === id)!;
    const missing = this.assets(next).filter(
      (asset) => !this.textures.exists(asset),
    );
    if (missing.length) {
      if (this.loading) return;
      this.loading = true;
      this.bridge.clear();
      this.publish();
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.loading = false;
        if (this.pendingReset) {
          this.pendingReset = false;
          for (const asset of missing) this.textures.remove(asset);
          this.restartWalk();
          return;
        }
        if (this.assets(next).every((asset) => this.textures.exists(asset)))
          this.enterScene(id, point);
      });
      for (const asset of missing) this.load.image(asset, `/maps/${asset}`);
      this.load.start();
      return;
    }
    this.bridge.clear();
    this.children.removeAll(true);
    if (this.current && this.current !== next) {
      const keep = new Set(this.assets(next));
      for (const asset of this.assets(this.current))
        if (!keep.has(asset)) this.textures.remove(asset);
    }
    this.current = next;
    this.position = { ...point };
    const s = this.current;
    this.add
      .image(0, 0, s.art.ground)
      .setOrigin(0)
      .setDepth(-100)
      .setName("floor-plan");
    this.roofSprites = (s.id === "campus_core" ? s.art.roofs : []).map(
      (roof) => ({
        roof,
        sprite: this.add
          .image(roof.x, roof.y, roof.image)
          .setOrigin(0)
          .setDepth(8000),
      }),
    );
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
          { fontSize: "4px", color: "#294b3c", align: "center" },
        )
        .setOrigin(0.5)
        .setDepth(-40);
    }
    for (const z of s.note_zones)
      g.lineStyle(1, 0x9a7f51, 0.5).strokeRect(z.x, z.y, z.width, z.height);
    for (const c of s.chests) {
      const dimensions = this.world.chest,
        ppm = s.units.pixelsPerMeter;
      const chest = this.add
        .graphics({ x: c.x, y: c.y })
        .setDepth(c.y)
        .setScale(
          (dimensions.widthMeters * ppm) / 14,
          ((dimensions.heightMeters * s.units.heightProjection +
            dimensions.depthMeters) *
            ppm) /
            10,
        );
      chest.fillStyle(0x8b5b36).fillRect(-7, -10, 14, 10);
      chest.fillStyle(0xc9974d).fillRect(-6, -9, 12, 4);
      chest.fillStyle(0xf4d677).fillRect(-1, -5, 3, 4);
    }
    for (const p of s.portals.filter((p) => p.kind === "entrance")) {
      g.fillStyle(
        p.kind === "entrance"
          ? 0xf0d893
          : p.kind === "lift"
            ? 0x86b6d3
            : 0xa5c9af,
        0.9,
      ).fillRect(p.x - 4, p.y - 2, 8, 4);
      if (id !== "campus_core" && p.kind === "entrance")
        this.add
          .text(p.x, p.y - 12, `↓ ${p.label}`, {
            fontSize: "4px",
            color: "#365545",
          })
          .setOrigin(0.5)
          .setDepth(-40);
    }
    for (const marker of passageMarkers(this.world, s)) {
      const lift = marker.kind === "lift";
      const icon = this.add
        .graphics({ x: marker.x, y: marker.y })
        .setDepth(5600)
        .setName(lift ? "lift-marker" : "stair-marker");
      icon
        .fillStyle(lift ? 0xe2edf4 : 0xe4efdc, 0.98)
        .fillRoundedRect(-5, -5, 10, 10, 1);
      icon
        .lineStyle(0.7, lift ? 0x397e9f : 0x3e7350)
        .strokeRoundedRect(-5, -5, 10, 10, 1);
      if (lift) {
        icon.strokeRect(-2.5, -3, 5, 6);
        icon.lineBetween(0, -3, 0, 3);
      } else {
        icon
          .beginPath()
          .moveTo(-3.5, 3)
          .lineTo(-1.5, 3)
          .lineTo(-1.5, 1)
          .lineTo(0.5, 1)
          .lineTo(0.5, -1)
          .lineTo(2.5, -1)
          .lineTo(2.5, -3)
          .lineTo(4, -3)
          .strokePath();
      }
      icon.setData("portalIds", marker.portalIds);
      this.add
        .text(marker.x, marker.y + 7, marker.label, {
          fontFamily: "sans-serif",
          fontSize: "3px",
          color: lift ? "#28627c" : "#315e3e",
          backgroundColor: "#f2f3e4",
          padding: { x: 1, y: 1 },
        })
        .setOrigin(0.5, 0)
        .setDepth(5600);
    }
    this.referenceLayer = this.add.graphics().setDepth(11000);
    this.drawReferences();
    this.player = this.add
      .image(point.x, point.y, "avatar-down-0")
      .setOrigin(0.5, 1)
      .setDisplaySize(s.player.width, s.player.height);
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
    this.scaleFactor = Math.max(
      CAMERA_ZOOM.min,
      Math.min(CAMERA_ZOOM.max, Math.round(value)),
    );
    this.cameras.main.setZoom(this.scaleFactor);
    this.publish();
  }
  interact(portalId?: string) {
    if (this.loading) return;
    const nearby = nearbyPortals(this.current, this.position);
    const p = portalId ? nearby.find((p) => p.id === portalId) : nearby[0];
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
      this.current.player.interactionRadius,
    );
    this.bridge.emit({
      sceneId: this.current.id,
      position: { ...this.position },
      discovered: [...this.discovered],
      target:
        this.loading || !portal
          ? undefined
          : passageLabel(this.world, this.current, portal),
      passages: this.loading
        ? []
        : nearbyPortals(this.current, this.position).map((p) => ({
            id: p.id,
            label: passageLabel(this.world, this.current, p),
          })),
      floorImages: this.children.list
        .filter((object) => object.name === "floor-plan")
        .map((object) => (object as Phaser.GameObjects.Image).texture.key),
      stairMarkers: this.children.list.filter(
        (object) => object.name === "stair-marker",
      ).length,
      zoom: this.cameras.main.zoom,
      avatarSize: {
        width: this.player.displayWidth,
        height: this.player.displayHeight,
      },
    });
  }
  update(time: number, delta: number) {
    if (!this.player) return;
    const k = this.bridge.keys;
    const input =
      this.bridge.paused || this.loading
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
    const running =
      !this.bridge.paused &&
      (k.has("ShiftLeft") || k.has("ShiftRight") || k.has("Shift"));
    this.position = move(
      this.current,
      this.position,
      input,
      delta / 1000,
      running ? this.current.player.runSpeed : this.current.player.speed,
      this.current.player.radius,
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
        `avatar-${this.direction}-${moving ? Math.floor(time / (running ? 80 : 130)) % 4 : 0}`,
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
      // Roof height projection can cover public ground outside its F1 footprint.
      const x = Math.floor(this.position.x - roof.x),
        y = Math.floor(this.position.y - roof.y);
      const covered =
        x >= 0 &&
        y >= 0 &&
        x < roof.width &&
        y < roof.height &&
        this.textures.getPixelAlpha(x, y, roof.image) > 0;
      const alpha = within || nearDoor || covered ? 0.32 : 1;
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
      if (key === "Shift") {
        bridge.keys.add(e.code || key);
        return;
      }
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
    (e) => {
      if (e.key === "Shift") {
        bridge.keys.delete(e.code);
        bridge.keys.delete("Shift");
      } else
        bridge.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    },
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
