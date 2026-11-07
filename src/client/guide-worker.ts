import { planGuide, type GuideTarget } from "../shared/guide";
import type { WorldMap, Point } from "../shared/world";
let world: WorldMap;
self.onmessage = (
  event: MessageEvent<{
    world?: WorldMap;
    request: number;
    sceneId: string;
    start: Point;
    target: GuideTarget;
  }>,
) => {
  if (event.data.world) {
    world = event.data.world;
    return;
  }
  const { request, sceneId, start, target } = event.data;
  try {
    self.postMessage({
      request,
      route: planGuide(world, sceneId, start, target),
    });
  } catch {
    self.postMessage({ request, failed: true });
  }
};
