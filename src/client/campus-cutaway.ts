import { facadeDoorInterval } from "../shared/campus-shell";
import type Phaser from "phaser";
import type { Point, Portal, SceneMap } from "../shared/world";

type Wall = { a: Point; b: Point; ink: number };

// Use the same F1 loops as collision, including freestanding columns. Cut only
// the portion of a facade at its surveyed door, keeping both ends of the wall.
function facadeWalls(map: SceneMap): Wall[] {
  const walls: Wall[] = [];
  for (const roof of map.art.roofs) {
    const entries = map.portals.filter((p) =>
      map.buildings.some((b) => b.id === p.buildingId && b.group === roof.id),
    );
    for (const polygon of roof.footprint)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i];
          const dx = b.x - a.x,
            dy = b.y - a.y,
            length = Math.hypot(dx, dy);
          if (length < 0.01) continue;
          const ux = dx / length;
          const intervals = entries
            .flatMap((portal) => {
              const cut =
                portal.entrance &&
                facadeDoorInterval(
                  a,
                  b,
                  portal.entrance,
                  map.units.pixelsPerMeter,
                );
              return cut ? [cut] : [];
            })
            .sort((p, q) => p[0] - q[0]);
          const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
          const ink = Math.abs(ux) > 0.75 ? 0x9d9988 : 0x858c82;
          let start = 0;
          for (const [lo, hi] of [...intervals, [1, 1]]) {
            if (start < lo) walls.push({ a: at(start), b: at(lo), ink });
            start = Math.max(start, hi);
          }
        }
  }
  return walls.sort((p, q) => p.a.y + p.b.y - q.a.y - q.b.y);
}

export function entranceSill(
  scene: Phaser.Scene,
  map: SceneMap,
  portal: Portal,
) {
  if (!portal.entrance) return;
  const { threshold, width, toward } = portal.entrance;
  const ppm = map.units.pixelsPerMeter;
  const point = (side: number, distance: number) => ({
    x: threshold.x - toward.y * side + toward.x * distance,
    y: threshold.y + toward.x * side + toward.y * distance,
  });
  const left = -width / 2,
    right = width / 2;
  const tread = scene.add.graphics().setName("entrance-sill").setDepth(-65);
  tread
    .fillStyle(0x9f9e90)
    .fillPoints(
      [
        point(left, -0.2 * ppm),
        point(right, -0.2 * ppm),
        point(right, 0.2 * ppm),
        point(left, 0.2 * ppm),
      ],
      true,
    );
  const a = point(left, -0.13 * ppm),
    b = point(right, -0.13 * ppm);
  tread.lineStyle(0.08 * ppm, 0xefe2b5).lineBetween(a.x, a.y, b.x, b.y);
  if (map.id !== "campus_core") return;
  // The posts have separate contact depths so an oblique doorway can straddle the walker.
  for (const side of [left, right]) {
    const foot = point(side, 0),
      h = ppm * map.units.heightProjection * 2.1;
    const post = scene.add
      .graphics({ x: foot.x, y: foot.y })
      .setDepth(6000 + foot.y);
    post.fillStyle(0x5e6a64).fillRect(-ppm * 0.1, -h, ppm * 0.2, h);
    post.fillStyle(0xc4c9bc).fillRect(-ppm * 0.1, -h, ppm * 0.07, h);
    post.fillStyle(0xddd8bd).fillRect(-ppm * 0.13, -h, ppm * 0.26, ppm * 0.1);
  }
}

export function campusCutaway(scene: Phaser.Scene, map: SceneMap) {
  if (map.id !== "campus_core") return;
  const ratio = map.art.pixelRatio ?? 1;
  const roofs = map.art.roofs.map((roof) => ({
    roof,
    source: scene.textures.get(roof.image).getSourceImage() as HTMLImageElement,
    sprite: scene.add
      .image(roof.x, roof.y, roof.image)
      .setOrigin(0)
      .setDisplaySize(roof.width, roof.height)
      .setDepth(8000),
  }));
  const walls = facadeWalls(map);
  const h = 1.05 * map.units.pixelsPerMeter * map.units.heightProjection;
  function draw(g: Phaser.GameObjects.Graphics, { a, b, ink }: Wall) {
    g.fillStyle(ink).fillPoints(
      [a, b, { x: b.x, y: b.y - h }, { x: a.x, y: a.y - h }],
      true,
    );
    g.lineStyle(0.32, 0x66756c).lineBetween(a.x, a.y, b.x, b.y);
    g.lineStyle(0.55, 0xd5d4bf).lineBetween(a.x, a.y - h, b.x, b.y - h);
  }
  const shell = scene.add.graphics().setDepth(-74),
    front = scene.add.graphics();
  for (const wall of walls) draw(shell, wall);

  // Clip only a small square in the overhead model sprites and repaint it with
  // a feathered opening. All ground objects beneath retain their own depth.
  // Four ordinary rectangles work with both Canvas and WebGL stencil masks.
  const radius = Math.ceil(5 * map.units.pixelsPerMeter * ratio);
  const size = 2 * radius,
    span = size / ratio;
  const key = "campus-roof-window";
  const texture = scene.textures.createCanvas(key, size, size)!;
  const patch = scene.add
    .image(0, 0, key)
    .setOrigin(0)
    .setScale(1 / ratio)
    .setDepth(8001);
  const ctx = texture.context;
  const brush = document.createElement("canvas");
  brush.width = brush.height = size;
  const ink = brush.getContext("2d")!;
  const aperture = ink.createRadialGradient(
    radius,
    radius,
    0,
    radius,
    radius,
    radius,
  );
  aperture.addColorStop(0, "black");
  aperture.addColorStop(0.6, "black");
  aperture.addColorStop(1, "transparent");
  ink.fillStyle = aperture;
  ink.fillRect(0, 0, size, size);
  // Grow the opening only where the visible mesh actually approaches the actor.
  // A person standing in front of a clear facade leaves the building intact.
  const probe = document.createElement("canvas");
  probe.width = probe.height = 8;
  const probeContext = probe.getContext("2d", { willReadFrequently: true })!;
  const reach = Math.ceil(map.player.height * ratio * 1.6);
  const stencil = scene.make.graphics({}),
    mask = stencil.createGeometryMask();
  const width = map.width * map.tileSize,
    height = map.height * map.tileSize;
  let lastX = Infinity,
    lastY = Infinity;
  return {
    update(feet: Point, actorDepth: number) {
      const px = Math.round(feet.x * ratio),
        py = Math.round(feet.y * ratio);
      if (front.depth !== actorDepth + 0.02) front.setDepth(actorDepth + 0.02);
      if (px === lastX && py === lastY) return;
      lastX = px;
      lastY = py;
      const x = (px - radius) / ratio;
      const y =
        (py - Math.round((map.player.height * ratio) / 3) - radius) / ratio;
      stencil
        .clear()
        .fillStyle(0xffffff)
        .fillRect(0, 0, width, y)
        .fillRect(0, y + span, width, height - y - span)
        .fillRect(0, y, x, span)
        .fillRect(x + span, y, width - x - span, span);
      ctx.clearRect(0, 0, size, size);
      let covered = false;
      for (const { roof, source, sprite } of roofs) {
        if (
          x + span <= roof.x ||
          y + span <= roof.y ||
          x >= roof.x + roof.width ||
          y >= roof.y + roof.height
        ) {
          sprite.clearMask();
          continue;
        }
        covered = true;
        sprite.setMask(mask);
        ctx.drawImage(
          source,
          Math.round((x - roof.x) * ratio),
          Math.round((y - roof.y) * ratio),
          size,
          size,
          0,
          0,
          size,
          size,
        );
      }
      patch.setVisible(covered);
      front.clear();
      if (!covered) return;
      probeContext.clearRect(0, 0, 8, 8);
      probeContext.drawImage(
        texture.canvas,
        radius - reach,
        radius - reach,
        2 * reach,
        2 * reach,
        0,
        0,
        8,
        8,
      );
      const pixels = probeContext.getImageData(0, 0, 8, 8).data;
      let nearest = Infinity;
      for (let i = 0; i < 64; i++)
        if (pixels[i * 4 + 3] > 0)
          nearest = Math.min(
            nearest,
            Math.hypot((i % 8) - 3.5, Math.floor(i / 8) - 3.5),
          );
      const r = radius * Math.min(1, Math.max(0, (4 - nearest) / 2.5));
      if (r > 0) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(brush, radius - r, radius - r, 2 * r, 2 * r);
        ctx.globalCompositeOperation = "source-over";
      }
      texture.refresh();
      patch.setPosition(x, y);
      // Render a near wall over the shoes only when its baseline is closer to
      // the camera than the walker. Long oblique walls use the local baseline.
      for (const wall of walls) {
        const { a, b } = wall;
        if (
          feet.x + map.player.width / 2 < Math.min(a.x, b.x) ||
          feet.x - map.player.width / 2 > Math.max(a.x, b.x) ||
          feet.y < Math.min(a.y, b.y) - h ||
          feet.y > Math.max(a.y, b.y)
        )
          continue;
        const dx = b.x - a.x;
        const t = dx ? Math.max(0, Math.min(1, (feet.x - a.x) / dx)) : 0.5;
        if (a.y + (b.y - a.y) * t > feet.y) draw(front, wall);
      }
    },
    dispose() {
      for (const { sprite } of roofs) sprite.clearMask();
      mask.destroy();
      stencil.destroy();
      patch.destroy();
      scene.textures.remove(key);
    },
  };
}
