import * as THREE from "three";
import {
  studentFrame,
  studentPalette,
  avatarWidth,
  avatarHeight,
  type StudentFacing,
} from "./avatar-art";
import { outfits, type OutfitId, type HatId } from "../shared/journey";
export function pixelCast() {
  const textures = new Map<string, THREE.CanvasTexture>();
  function texture(
    outfit: OutfitId,
    hat: HatId,
    facing: StudentFacing,
    frame: number,
  ) {
    const key = `${outfit}:${hat}:${facing}:${frame}`;
    if (textures.has(key)) return textures.get(key)!;
    const canvas = document.createElement("canvas");
    canvas.width = avatarWidth;
    canvas.height = avatarHeight;
    const context = canvas.getContext("2d")!,
      data = context.createImageData(avatarWidth, avatarHeight);
    const colors = outfits.find((o) => o.id === outfit)!.colors;
    const palette: Record<string, number> = {
      ...studentPalette,
      R: colors[0],
      J: colors[1],
      j: colors[2],
      A: colors[3],
    };
    studentFrame(facing, frame, hat).forEach((row, y) =>
      [...row].forEach((value, x) => {
        if (value === ".") return;
        const color = palette[value],
          i = (y * avatarWidth + x) * 4;
        data.data[i] = color >> 16;
        data.data[i + 1] = (color >> 8) & 255;
        data.data[i + 2] = color & 255;
        data.data[i + 3] = 255;
      }),
    );
    context.putImageData(data, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    textures.set(key, map);
    return map;
  }
  return {
    actor(width: number, height: number) {
      const group = new THREE.Group(),
        material = new THREE.SpriteMaterial({
          map: texture("clay", "none", "down", 0),
          alphaTest: 0.5,
          toneMapped: false,
        });
      const sprite = new THREE.Sprite(material);
      sprite.center.set(0.5, 0);
      sprite.scale.set(width, height, 1);
      group.add(sprite);
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(width * 0.65, 16),
        new THREE.MeshBasicMaterial({
          color: 0x31422c,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.04;
      group.add(shadow);
      return {
        group,
        pose(
          outfit: OutfitId,
          hat: HatId,
          facing: StudentFacing,
          frame: number,
        ) {
          material.map = texture(outfit, hat, facing, frame);
        },
      };
    },
    dispose() {
      textures.forEach((texture) => texture.dispose());
      textures.clear();
    },
  };
}
export function woodenChest(width: number, height: number, depth: number) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
      color: 0x9f6239,
      roughness: 0.9,
    }),
    edge = new THREE.MeshStandardMaterial({ color: 0x694530, roughness: 1 }),
    brass = new THREE.MeshStandardMaterial({
      color: 0xe4bb62,
      roughness: 0.65,
    });
  const add = (
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  add(group, 0, height * 0.35, 0, width, height * 0.7, depth, wood);
  for (const y of [0.04, 0.34, 0.65])
    add(
      group,
      0,
      height * y,
      depth / 2 + 0.01,
      width,
      height * 0.035,
      0.03,
      edge,
    );
  for (const x of [-0.33, 0.33])
    add(
      group,
      width * x,
      height * 0.35,
      depth / 2 + 0.03,
      width * 0.1,
      height * 0.7,
      0.04,
      brass,
    );
  const lid = new THREE.Group();
  lid.position.set(0, height * 0.7, -depth / 2);
  group.add(lid);
  add(
    lid,
    0,
    height * 0.12,
    depth / 2,
    width * 1.05,
    height * 0.24,
    depth * 1.06,
    wood,
  );
  for (const x of [-0.33, 0.33])
    add(
      lid,
      width * x,
      height * 0.25,
      depth / 2,
      width * 0.1,
      0.04,
      depth * 1.07,
      brass,
    );
  add(
    group,
    0,
    height * 0.56,
    depth / 2 + 0.06,
    width * 0.17,
    height * 0.22,
    0.08,
    brass,
  );
  return {
    group,
    open(value: boolean) {
      lid.rotation.x += ((value ? -1.15 : 0) - lid.rotation.x) * 0.18;
    },
  };
}
