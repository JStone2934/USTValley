import type { GuideRoute, GuideTarget } from "../shared/guide";
import type { Point, SceneMap, WorldMap } from "../shared/world";
export class GuideController {
  route?: GuideRoute;
  private worker: Worker;
  private target?: GuideTarget;
  private serial = 0;
  private busy = false;
  private lastPoint: Point = { x: Infinity, y: Infinity };
  private lastScene = "";
  private lastTime = -Infinity;
  constructor(
    world: WorldMap,
    private changed: () => void,
  ) {
    this.worker = new Worker(new URL("./guide-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.postMessage({ world });
    this.worker.onmessage = ({ data }) => {
      if (data.request !== this.serial) return;
      this.busy = false;
      this.route = data.route ?? {
        ...this.route!,
        status: "unavailable",
        points: [],
        instruction: "路线加载失败，请重试",
      };
      this.changed();
    };
    this.worker.onerror = () => {
      this.busy = false;
      if (this.route) {
        this.route = {
          ...this.route,
          status: "unavailable",
          points: [],
          instruction: "路线加载失败，请重试",
        };
        this.changed();
      }
    };
  }
  start(target: GuideTarget, scene: SceneMap, position: Point) {
    this.target = target;
    this.serial++;
    this.busy = false;
    this.lastScene = "";
    this.route = {
      target,
      name: "步行指引",
      sceneId: scene.id,
      points: [],
      meters: 0,
      status: "planning",
      instruction: "正在寻找安全路线…",
    };
    this.changed();
    this.update(scene, position, 0, true);
  }
  stop() {
    this.target = undefined;
    this.serial++;
    this.busy = false;
    this.route = undefined;
    this.changed();
  }
  update(scene: SceneMap, position: Point, time: number, force = false) {
    if (!this.target) return;
    const changedScene = this.lastScene !== scene.id;
    if (
      !force &&
      !changedScene &&
      (this.busy ||
        time - this.lastTime < 1200 ||
        Math.hypot(
          position.x - this.lastPoint.x,
          position.y - this.lastPoint.y,
        ) <
          scene.collisionSize / 2)
    )
      return;
    if (changedScene && this.route) {
      this.route = {
        ...this.route,
        sceneId: scene.id,
        status: "planning",
        points: [],
        instruction: "正在接续下一段路线…",
      };
      this.changed();
    }
    this.lastPoint = { ...position };
    this.lastScene = scene.id;
    this.lastTime = time;
    this.busy = true;
    this.worker.postMessage({
      request: ++this.serial,
      sceneId: scene.id,
      start: position,
      target: this.target,
    });
  }
  dispose() {
    this.worker.terminate();
  }
}
