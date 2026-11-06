import { attachCameraInput } from "./camera-input";
import { campusCutaway, entranceSill } from "./campus-cutaway";
import { slidingEntrance } from "./entrance-art";
import {
  approachedRoomDoor,
  clearOfDoor,
  crossedEntrance,
  facesEntrance,
} from "../shared/automatic-doors";
import { addSundialForeground } from "./sundial-art";
import { canObserveSundial, sundial } from "../shared/sundial";
import { makeStudentAvatar } from "./avatar-art";
import Phaser from "phaser";
import { actorOcclusion } from "./occlusion";
import {
  doorCollision,
  nearbyDoors,
  toggleDoor,
  type RoomDoor,
} from "../shared/doors";
import { drawRoomDoor } from "./room-door-art";
import {
  crossedGallery,
  passageLabel,
  passageMarkers,
} from "../shared/passages";
import {
  contains,
  move,
  nearbyPortals,
  type Point,
  type SceneMap,
  type WorldMap,
} from "../shared/world";

const CAMERA_STOPS = [12.5, 25, 50, 75, 100, 125, 150, 175, 200];

export type Snapshot = {
  sceneId: string;
  position: Point;
  discovered: string[];
  target?: string;
  passages?: { id: string; label: string }[];
  openDoorIds?: string[];
  cameraMode: "follow" | "free" | "overview";
  cameraCenter?: Point;
  zoomPercent: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  cameraZoom?: number;
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
    cameraMode: "follow",
    zoomPercent: 100,
    canZoomOut: false,
    canZoomIn: false,
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
  zoom(direction: -1 | 1) {
    if (!this.paused) this.scene?.stepZoom(direction);
  }
  toggleCamera() {
    if (!this.paused)
      this.scene?.setCameraMode(
        this.snapshot.cameraMode === "follow" ? "free" : "follow",
      );
  }
  overview() {
    if (!this.paused) this.scene?.setCameraMode("overview");
  }
  focusBuilding(id: string) {
    this.scene?.focusBuilding(id);
  }
  followPlayer() {
    if (!this.paused) this.scene?.setCameraMode("follow");
  }
}

export class CampusScene extends Phaser.Scene {
  private current!: SceneMap;
  private player!: Phaser.GameObjects.Image;
  private occlusion?: ReturnType<typeof actorOcclusion>;
  private cutaway?: ReturnType<typeof campusCutaway>;
  private playerBeacon!: Phaser.GameObjects.Arc;
  private footShadow!: Phaser.GameObjects.Ellipse;
  private referenceLayer!: Phaser.GameObjects.Graphics;
  private discovered = new Set<string>();
  private openDoors = new Set<string>();
  private entranceLeaves: ((feet: Point, delta: number) => void)[] = [];
  private swings = new Map<string, { door: RoomDoor; progress: number }>();
  private doorSprites = new Map<string, Phaser.GameObjects.Graphics>();
  private position: Point = { x: 0, y: 0 };
  private lastEmit = 0;
  private loading = false;
  private pendingReset = false;
  private direction = "down";
  private cues: {
    object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    maxScale: number;
  }[] = [];
  private cameraMode: "follow" | "free" | "overview" = "follow";
  private preferredZoom = 100;
  private zoomPercent = 100;
  private zoomStops = CAMERA_STOPS;
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
      ...(scene.art.riseMap ? [scene.art.riseMap] : []),
      ...(scene.art.landmarks ?? []).flatMap((l) =>
        l.riseMap ? [l.image, l.riseMap] : [l.image],
      ),
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
    this.scale.on(Phaser.Scale.Events.RESIZE, this.frameCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.frameCamera, this),
    );

    makeStudentAvatar(this);
    this.restartWalk();
  }
  restartWalk() {
    if (this.loading) {
      this.pendingReset = true;
      this.bridge.clear();
      return;
    }
    this.discovered.clear();
    this.openDoors.clear();
    const scene = this.world.scenes.find((s) => s.id === "campus_core")!;
    this.enterScene(scene.id, scene.spawns[0]);
  }
  private enterScene(id: string, point: Point, keepWalking = false) {
    const next = this.world.scenes.find((s) => s.id === id)!;
    const missing = this.assets(next).filter(
      (asset) => !this.textures.exists(asset),
    );
    if (missing.length) {
      if (this.loading) return;
      this.loading = true;
      if (!keepWalking) this.bridge.clear();
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
          this.enterScene(id, point, keepWalking);
      });
      for (const asset of missing) this.load.image(asset, `/maps/${asset}`);
      this.load.start();
      return;
    }
    if (!keepWalking) this.bridge.clear();
    this.cutaway?.dispose();
    this.cutaway = undefined;
    this.occlusion?.dispose();
    this.occlusion = undefined;
    this.cues = [];
    this.children.removeAll(true);
    if (this.current && this.current !== next) {
      const keep = new Set(this.assets(next));
      for (const asset of this.assets(this.current))
        if (!keep.has(asset)) this.textures.remove(asset);
    }
    this.openDoors.clear();
    this.swings.clear();
    this.entranceLeaves = [];
    this.current = doorCollision(next, this.openDoors);
    this.position = { ...point };
    const s = this.current;
    this.add
      .image(0, 0, s.art.ground)
      .setOrigin(0)
      .setDisplaySize(s.width * s.tileSize, s.height * s.tileSize)
      .setDepth(-100)
      .setName("floor-plan");
    for (const landmark of s.art.landmarks ?? []) {
      const plaza = landmark.id === sundial.featureId;
      this.add
        .image(landmark.x, landmark.y, landmark.image)
        .setOrigin(0)
        .setDisplaySize(landmark.width, landmark.height)
        .setDepth(
          plaza
            ? -89
            : landmark.frontY < 0
              ? -90
              : landmark.riseMap
                ? -88
                : 6000 + landmark.frontY,
        );
      if (plaza) addSundialForeground(this, landmark);
    }
    this.cutaway = campusCutaway(this, s);
    this.doorSprites.clear();
    for (const door of s.doors ?? []) {
      const g = this.add
        .graphics({ x: door.x, y: door.y })
        .setDepth(6000 + door.y)
        .setName("room-door");
      this.doorSprites.set(door.id, g);
      this.paintDoor(door, 0);
    }
    const g = this.add.graphics().setDepth(5500);
    for (const b of s.buildings) {
      const label = this.add
        .text(b.label.x, b.label.y, b.id, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#243e34",
          backgroundColor: "#f5edd3",
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(10000);
      label.setName("building-label");
      this.mapCue(label, 2.1, -12);
    }
    for (const z of s.exploration) {
      g.fillStyle(0x87a899, 0.16).fillRect(z.x, z.y, z.width, z.height);
      const label = this.add
        .text(
          z.x + z.width / 2,
          z.y + z.height / 2,
          `${z.buildingId}\n探索区`,
          { fontSize: "4px", color: "#294b3c", align: "center" },
        )
        .setOrigin(0.5)
        .setDepth(-40);
      this.mapCue(label, 3);
    }
    for (const c of s.chests) {
      const dimensions = this.world.chest,
        ppm = s.units.pixelsPerMeter;
      const chest = this.add
        .graphics({ x: c.x, y: c.y })
        .setDepth(6000 + c.y)
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
      const glass = slidingEntrance(this, s, p);
      if (glass) this.entranceLeaves.push(glass);
      entranceSill(this, s, p);
    }
    for (const marker of passageMarkers(this.world, s)) {
      const lift = marker.kind === "lift",
        gallery = marker.kind === "gallery";
      const ink = gallery ? 0x96572d : lift ? 0x397e9f : 0x3e7350;
      const icon = this.add
        .graphics({ x: marker.x, y: marker.y })
        .setDepth(5600)
        .setName(
          gallery ? "gallery-marker" : lift ? "lift-marker" : "stair-marker",
        );
      icon
        .fillStyle(gallery ? 0xffe4b3 : lift ? 0xe2edf4 : 0xe4efdc, 0.98)
        .fillRoundedRect(-5, -5, 10, 10, 1);
      icon.lineStyle(0.7, ink).strokeRoundedRect(-5, -5, 10, 10, 1);
      if (gallery) {
        icon.lineBetween(-3.5, -2, 3.5, -2).lineBetween(-3.5, 2, 3.5, 2);
        for (const x of [-3, 0, 3]) icon.lineBetween(x, -2, x, 2);
      } else if (lift) {
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
      this.mapCue(icon, 1.8, -8, 12);
      // Destination text is shown in the interaction controls at the landing.
      // Keeping labels off the floor leaves nearby door leaves and jambs visible.
    }
    this.referenceLayer = this.add.graphics().setDepth(11000);
    this.drawReferences();
    this.footShadow = this.add
      .ellipse(
        point.x,
        point.y,
        s.player.width,
        s.player.groundDepth,
        0x253b40,
        0.34,
      )
      .setDepth(-60);
    this.occlusion = actorOcclusion(this, s);
    this.player = this.add
      .image(point.x, point.y, "avatar-down-0")
      .setOrigin(0.5, 1)
      .setDisplaySize(s.player.width, s.player.height);
    this.playerBeacon = this.add
      .circle(point.x, point.y, 4, 0xd46a3a)
      .setStrokeStyle(2, 0xfff6dc)
      .setDepth(20000)
      .setName("player-location");
    this.cameraMode = "follow";
    this.cameras.main
      .setBounds(0, 0, s.width * 16, s.height * 16)
      .startFollow(this.player, false, 1, 1);
    this.cameras.main.roundPixels = false;
    this.frameCamera();
  }
  drawReferences() {
    if (!this.referenceLayer) return;
    const g = this.referenceLayer.clear();
    if (!this.bridge.references) return;
    // Note zones reserve future content. Show their bounds with the source overlay.
    for (const z of this.current.note_zones)
      g.lineStyle(0.5, 0x9a7f51, 0.5).strokeRect(z.x, z.y, z.width, z.height);
    g.lineStyle(1, 0x416c78, 0.55);
    for (const line of this.current.sourceRoads) g.strokePoints(line, false);
    g.lineStyle(1, 0x80565a, 0.6);
    for (const shape of this.current.sourceOutlines)
      g.strokePoints(shape.points, true);
    for (const p of this.current.sourceEntries)
      g.fillStyle(0xb26053).fillCircle(p.x, p.y, 3);
  }
  private mapCue(
    object: Phaser.GameObjects.Graphics | Phaser.GameObjects.Text,
    maxScale: number,
    offsetY = 0,
    offsetX = 0,
  ) {
    if (object instanceof Phaser.GameObjects.Text) {
      object.setResolution(5);
      // Canvas reads the texture-source density; WebGL Text reads style.resolution.
      // Keep both renderers at the same physical label size.
      object.frame.source.resolution = object.style.resolution;
    }
    this.cues.push({
      object,
      x: object.x,
      y: object.y,
      maxScale,
      offsetX,
      offsetY,
    });
  }
  private frameCamera() {
    if (!this.current || !this.player) return;
    const center =
      this.cameraMode !== "follow"
        ? this.cameras.main.midPoint.clone()
        : undefined;
    const { width, height } = this.scale.gameSize;
    if (!width || !height) return;
    const compactLandscape = width > height && height <= 550;
    // Frame the physical avatar in CSS pixels. A narrow portrait viewport also
    // needs enough room on either side to see a turn before reaching it.
    const screenHeight = Math.min(
      height * (compactLandscape ? 0.075 : 0.0875),
      width / 7,
    );
    // A percentage means the same view in every building. Choose the common
    // limit from each scene's source texture density and physical avatar size.
    const nativeAvatarHeight = Math.min(
      ...this.world.scenes.map(
        (s) => s.player.height * (s.art.pixelRatio ?? 1),
      ),
    );
    const maximum = Math.max(
      100,
      Math.min(
        200,
        Math.floor((600 * nativeAvatarHeight) / screenHeight / 5) * 5,
      ),
    );
    this.zoomStops = [...CAMERA_STOPS.filter((p) => p < maximum), maximum];
    const camera = this.cameras.main;
    const mapWidth = this.current.width * this.current.tileSize;
    const mapHeight = this.current.height * this.current.tileSize;
    const baseZoom = screenHeight / this.player.displayHeight;
    if (this.cameraMode === "overview") {
      const fit = Math.min((width - 48) / mapWidth, (height - 210) / mapHeight);
      camera.setZoom(Math.max(0.01, fit));
      this.zoomPercent = +((camera.zoom / baseZoom) * 100).toFixed(2);
    } else {
      this.zoomPercent = Math.min(this.preferredZoom, maximum);
      camera.setZoom((baseZoom * this.zoomPercent) / 100);
    }
    // When a viewport is wider than the map, centre the extra margin instead
    // of clamping all of the blank space to one side.
    const boundsWidth = Math.max(mapWidth, width / camera.zoom);
    const boundsHeight = Math.max(mapHeight, height / camera.zoom);
    camera.setBounds(
      (mapWidth - boundsWidth) / 2,
      (mapHeight - boundsHeight) / 2,
      boundsWidth,
      boundsHeight,
    );
    if (this.cameraMode === "overview") {
      // Leave 130 px above and 80 px below the map for view controls and hints.
      camera.removeBounds();
      camera.centerOn(mapWidth / 2, mapHeight / 2 - 25 / camera.zoom);
    } else if (center) camera.centerOn(center.x, center.y);
    this.cameras.main.preRender();
    for (const cue of this.cues) {
      const scale = Math.max(
        cue.object.name === "building-label" ? 1.1 / camera.zoom : 0,
        Math.min(1, cue.maxScale / camera.zoom),
      );
      cue.object
        .setScale(scale)
        .setPosition(cue.x + cue.offsetX * scale, cue.y + cue.offsetY * scale);
    }
    this.playerBeacon
      .setScale(1 / camera.zoom)
      .setVisible(this.cameraMode === "overview" || this.zoomPercent <= 25);
    this.publish();
  }
  setCameraMode(mode: "follow" | "free" | "overview") {
    if (!this.player || this.loading || this.bridge.paused) return;
    this.cameraMode = mode;
    const camera = this.cameras.main;
    if (mode === "follow") camera.startFollow(this.player, false, 1, 1);
    else camera.stopFollow();
    this.frameCamera();
  }
  focusBuilding(id: string) {
    if (this.current?.id !== "campus_core") return;
    const building = this.current.buildings.find((b) => b.id === id);
    if (building) this.focusPoint(building.label);
  }
  private focusPoint(point: Point) {
    if (!this.player || this.loading || this.bridge.paused) return;
    if (this.cameraMode === "overview") this.preferredZoom = 25;
    this.setCameraMode("free");
    this.cameras.main.centerOn(point.x, point.y);
    this.cameras.main.preRender();
    this.publish();
  }
  focusView(point: Point) {
    if (!this.player || this.loading || this.bridge.paused) return;
    const camera = this.cameras.main;
    camera.preRender();
    const target = camera.getWorldPoint(
      point.x * camera.width,
      point.y * camera.height,
    );
    if (
      target.x < 0 ||
      target.y < 0 ||
      target.x > this.current.width * this.current.tileSize ||
      target.y > this.current.height * this.current.tileSize
    )
      return;
    this.focusPoint(target);
  }
  panView(dx: number, dy: number) {
    if (!this.player || this.loading || this.bridge.paused) return;
    if (this.cameraMode === "overview") this.preferredZoom = 25;
    if (this.cameraMode !== "free") this.setCameraMode("free");
    const camera = this.cameras.main;
    camera.scrollX -= (dx * camera.width) / camera.zoom;
    camera.scrollY -= (dy * camera.height) / camera.zoom;
    camera.preRender();
    this.publish();
  }
  stepZoom(direction: -1 | 1, anchor?: Point) {
    if (!this.player || this.loading || this.bridge.paused) return;
    if (this.cameraMode === "overview" && direction < 0) return;
    const next =
      direction > 0
        ? this.zoomStops.find((p) => p > this.zoomPercent)
        : this.zoomStops.findLast((p) => p < this.zoomPercent);
    if (next === undefined) return;
    const camera = this.cameras.main;
    const screen =
      anchor && this.cameraMode !== "follow"
        ? { x: anchor.x * camera.width, y: anchor.y * camera.height }
        : undefined;
    camera.preRender();
    const before = screen
      ? camera.getWorldPoint(screen.x, screen.y)
      : undefined;
    this.preferredZoom = next;
    if (this.cameraMode === "overview") this.cameraMode = "free";
    this.frameCamera();
    if (screen && before) {
      const after = camera.getWorldPoint(screen.x, screen.y);
      camera.scrollX += before.x - after.x;
      camera.scrollY += before.y - after.y;
      camera.preRender();
      this.publish();
    }
  }
  private setDoor(door: RoomDoor, open: boolean) {
    if (this.openDoors.has(door.id) === open) return;
    if (!toggleDoor(this.current, door, this.openDoors, this.position)) return;
    if (!this.swings.has(door.id))
      this.swings.set(door.id, { door, progress: open ? 0 : 1 });
  }
  private advanceDoors(delta: number) {
    for (const [id, swing] of this.swings) {
      const target = this.openDoors.has(id) ? 1 : 0;
      const step = Math.min(1, delta / 180);
      swing.progress = target
        ? Math.min(1, swing.progress + step)
        : Math.max(0, swing.progress - step);
      this.paintDoor(
        swing.door,
        swing.progress * swing.progress * (3 - 2 * swing.progress),
      );
      if (swing.progress === target) this.swings.delete(id);
    }
  }
  private paintDoor(door: RoomDoor, progress: number) {
    drawRoomDoor(
      this.doorSprites.get(door.id)!,
      door,
      progress,
      this.current.units.pixelsPerMeter,
      this.current.units.heightProjection,
    );
  }
  private nearbyActions() {
    const portals = nearbyPortals(this.current, this.position)
      .filter((p) => facesEntrance(this.current, this.position, p))
      .map((portal) => ({
        id: portal.id,
        label: passageLabel(this.world, this.current, portal),
        point: portal,
        portal,
        door: undefined as RoomDoor | undefined,
      }));
    const doors = nearbyDoors(this.current, this.position).map((door) => ({
      id: door.id,
      label: `${this.openDoors.has(door.id) ? "关门" : "开门"} · ${door.room}`,
      point: door,
      door,
      portal: undefined,
    }));
    const distance = (p: Point) =>
      Math.hypot(p.x - this.position.x, p.y - this.position.y);
    return [...portals, ...doors].sort(
      (a, b) => distance(a.point) - distance(b.point),
    );
  }
  interact(actionId?: string) {
    if (this.loading) return;
    const nearby = this.nearbyActions();
    const action = actionId ? nearby.find((a) => a.id === actionId) : nearby[0];
    if (action?.door) {
      this.setDoor(action.door, !this.openDoors.has(action.door.id));
      this.publish();
      return;
    }
    const p = action?.portal;
    if (!p) {
      if (
        !nearby.length &&
        (!actionId || actionId === sundial.id) &&
        canObserveSundial(this.current, this.position)
      )
        this.bridge.dispatchEvent(new Event(sundial.id));
      return;
    }
    const target = this.world.scenes.find((s) => s.id === p.targetScene)!;
    const reverse = target.portals.find((q) => q.id === p.targetPortal)!;
    this.enterScene(target.id, reverse.spawn);
  }
  publish() {
    if (!this.current) return;
    const actions = this.loading ? [] : this.nearbyActions();
    const observation =
      !this.loading &&
      !actions.length &&
      canObserveSundial(this.current, this.position);
    this.bridge.emit({
      sceneId: this.current.id,
      position: { ...this.position },
      discovered: [...this.discovered],
      openDoorIds: [...this.openDoors],
      target: actions[0]?.label ?? (observation ? sundial.action : undefined),
      passages: observation
        ? [{ id: sundial.id, label: sundial.action }]
        : actions.map(({ id, label }) => ({ id, label })),
      floorImages: this.children.list
        .filter((object) => object.name === "floor-plan")
        .map((object) => (object as Phaser.GameObjects.Image).texture.key),
      stairMarkers: this.children.list.filter(
        (object) => object.name === "stair-marker",
      ).length,
      cameraMode: this.cameraMode,
      cameraCenter: {
        x: this.cameras.main.midPoint.x,
        y: this.cameras.main.midPoint.y,
      },
      zoomPercent: this.zoomPercent,
      canZoomOut:
        this.cameraMode !== "overview" && this.zoomPercent > this.zoomStops[0],
      canZoomIn: this.zoomPercent < this.zoomStops.at(-1)!,
      cameraZoom: this.cameras.main.zoom,
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
    const approaching = approachedRoomDoor(this.current, before, input);
    if (approaching) this.setDoor(approaching, true);
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
    if (this.openDoors.size) {
      for (const door of this.current.doors ?? [])
        if (
          this.openDoors.has(door.id) &&
          clearOfDoor(this.current, door, this.position)
        )
          this.setDoor(door, false);
    }
    if (!this.bridge.paused && !this.loading) {
      this.advanceDoors(delta);
      for (const update of this.entranceLeaves) update(this.position, delta);
    }
    const gate =
      crossedGallery(this.current, before, this.position) ??
      crossedEntrance(this.current, before, this.position);
    if (gate) {
      const target = this.world.scenes.find((s) => s.id === gate.targetScene)!;
      const reverse = target.portals.find((p) => p.id === gate.targetPortal)!;
      this.enterScene(target.id, reverse.spawn, true);
      return;
    }
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
    const density = this.current.art.pixelRatio ?? 1;
    this.player
      .setPosition(
        Math.round(this.position.x * density) / density,
        Math.round(this.position.y * density) / density,
      )
      .setDepth(6000 + this.position.y + 0.1)
      .setTexture(
        `avatar-${this.direction}-${moving ? Math.floor(time / (running ? 80 : 130)) % 4 : 0}`,
      );
    this.footShadow.setPosition(this.player.x, this.player.y);
    this.playerBeacon.setPosition(this.player.x, this.player.y);
    this.occlusion?.update(this.player.x, this.player.y, this.player.depth);
    this.cutaway?.update(this.player, this.player.depth);
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
  // On older mobile GPUs the largest HD floor exceeds the texture-size limit.
  // Phaser's canvas renderer can draw the same native image and coordinates.
  const probe = document.createElement("canvas").getContext("webgl");
  const limit = probe?.getParameter(probe.MAX_TEXTURE_SIZE) ?? 0;
  const info = probe?.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? String(probe!.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : "";
  const softwareRenderer = /swiftshader|llvmpipe|software rasterizer/i.test(
    renderer,
  );
  probe?.getExtension("WEBGL_lose_context")?.loseContext();
  const fitsGpu = world.scenes.every(
    (s) =>
      Math.max(s.width, s.height) * s.tileSize * (s.art.pixelRatio ?? 1) <=
      limit,
  );
  const game = new Phaser.Game({
    type: fitsGpu && !softwareRenderer ? Phaser.AUTO : Phaser.CANVAS,
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
      game.scale.setParentSize(parent.clientWidth, parent.clientHeight);
  });
  observer.observe(parent);
  const abort = new AbortController();
  const options = { signal: abort.signal };
  attachCameraInput(parent, bridge, abort.signal);
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
      if (key === "c" && !e.repeat) bridge.followPlayer();
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
