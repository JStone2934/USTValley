import {
  advanceProgress,
  newProgress,
  restoreProgress,
  type JourneyEvent,
  type Progress,
} from "../shared/journey";
import type { WorldMap } from "../shared/world";
export const progressKey = "ustvalley.journey.v1";
export type JourneySnapshot = {
  progress: Progress;
  saveError: boolean;
  notices: { id: number; text: string }[];
};
export class ProgressStore extends EventTarget {
  snapshot: JourneySnapshot = {
    progress: newProgress(),
    saveError: false,
    notices: [],
  };
  private world?: WorldMap;
  private serial = 0;
  private lastSave = 0;
  private storage?: Pick<Storage, "getItem" | "setItem">;
  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    super();
    try {
      this.storage = storage ?? window.localStorage;
    } catch {
      this.snapshot.saveError = true;
    }
  }
  init(world: WorldMap) {
    if (this.world) {
      if (this.world.mapVersion === world.mapVersion) return;
      this.world = world;
      this.snapshot = {
        ...this.snapshot,
        progress: restoreProgress(this.snapshot.progress, world),
      };
      this.save();
      this.notify();
      return;
    }
    this.world = world;
    try {
      const raw = this.storage?.getItem(progressKey);
      if (raw)
        this.snapshot = {
          ...this.snapshot,
          progress: restoreProgress(JSON.parse(raw), world),
        };
    } catch {
      this.snapshot = { ...this.snapshot, saveError: true };
    }
    this.notify();
  }
  act(event: JourneyEvent) {
    if (!this.world) return;
    const { progress, notices } = advanceProgress(
      this.snapshot.progress,
      event,
      this.world,
    );
    if (progress === this.snapshot.progress && !notices.length) return;
    this.snapshot = {
      ...this.snapshot,
      progress,
      notices: [
        ...this.snapshot.notices,
        ...notices.map((text) => ({ id: ++this.serial, text })),
      ].slice(-4),
    };
    this.save();
    this.notify();
  }
  dismiss(id: number) {
    this.snapshot = {
      ...this.snapshot,
      notices: this.snapshot.notices.filter((n) => n.id !== id),
    };
    this.notify();
  }
  locate(location: NonNullable<Progress["location"]>, force = false) {
    this.snapshot.progress.location = { ...location };
    if (force || Date.now() - this.lastSave > 5000) this.save();
  }
  save() {
    this.lastSave = Date.now();
    try {
      if (!this.storage) throw new Error("Storage unavailable");
      this.storage.setItem(progressKey, JSON.stringify(this.snapshot.progress));
      if (this.snapshot.saveError) {
        this.snapshot = { ...this.snapshot, saveError: false };
        this.notify();
      }
    } catch {
      if (!this.snapshot.saveError) {
        this.snapshot = { ...this.snapshot, saveError: true };
        this.notify();
      }
    }
  }
  private notify() {
    this.dispatchEvent(new Event("change"));
  }
}
