import { pixelCast, woodenChest } from "./pixel-cast";
import { campusNpcs } from "../shared/journey";
import type { StudentFacing } from "./avatar-art";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GameBridge } from "./game";
import type { WorldMap } from "../shared/world";

export function createOrbit(
  host: HTMLDivElement,
  world: WorldMap,
  bridge: GameBridge,
  status: (message: string) => void,
) {
  const campus = world.scenes[0],
    width = campus.width * campus.tileSize,
    height = campus.height * campus.tileSize;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // Campus meshes and sunlight are static; regenerate their shadows only after loading.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor("#d9e6e7");
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute("aria-label", "可旋转的三维校园");
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#d9e6e7", 5000, 10000);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 15000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minPolarAngle = Math.PI / 12;
  controls.maxPolarAngle = Math.PI * 0.43;
  controls.minDistance = 45;
  controls.maxDistance = 7000;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.8;
  scene.add(new THREE.HemisphereLight(0xe7efdc, 0x4f6243, 1.2));
  const sun = new THREE.DirectionalLight(0xffdfaa, 2.1);
  sun.position.set(width * 0.2, 1600, height * 0.1);
  sun.target.position.set(width / 2, 0, height / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -1400,
    right: 1400,
    top: 1400,
    bottom: -1400,
    near: 1,
    far: 4000,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.set(width / 2, -0.15, height / 2);
  terrain.receiveShadow = true;
  scene.add(terrain);
  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 1600, height + 1600, 16, 16),
    new THREE.MeshBasicMaterial({
      color: "#bdcba9",
      fog: false,
      side: THREE.DoubleSide,
    }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.set(width / 2, -0.3, height / 2);
  surround.receiveShadow = false;
  scene.add(surround);
  const cast = pixelCast(),
    personHeight = campus.player.height;
  const student = cast.actor(campus.player.width, personHeight),
    avatar = student.group;
  scene.add(avatar);
  let lastFeet = { ...bridge.snapshot.position },
    facing: StudentFacing = "down";
  const people = campusNpcs(world).map((npc) => {
    const actor = cast.actor(campus.player.width, personHeight);
    actor.pose(npc.outfit, npc.hat, "down", 0);
    actor.group.position.set(npc.x, 0, npc.y);
    scene.add(actor.group);
    const label = document.createElement("span");
    label.className = "orbit-building-label orbit-activity-label";
    label.textContent = `! ${npc.name}`;
    host.append(label);
    return { npc, actor, label };
  });
  const treasure = campus.chests.map((chest) => {
    const ppm = campus.units.pixelsPerMeter;
    const model = woodenChest(
      world.chest.widthMeters * ppm,
      world.chest.heightMeters * ppm,
      world.chest.depthMeters * ppm,
    );
    model.group.position.set(chest.x, 0, chest.y);
    scene.add(model.group);
    const label = document.createElement("span");
    label.className = "orbit-building-label orbit-activity-label";
    label.textContent = "✦ 宝箱";
    host.append(label);
    return { chest, model, label };
  });
  const marker = document.createElement("span");
  marker.className = "orbit-player-label";
  marker.textContent = "你";
  host.append(marker);
  const labels = world.buildings.map((building) => {
    const label = document.createElement("span");
    label.className = "orbit-building-label";
    label.textContent = `${building.id} · ${building.name}`;
    host.append(label);
    return { label, building };
  });
  const pickTargets: THREE.Object3D[] = [terrain];
  const groupBounds = new Map<string, THREE.Box3>();
  const scratch = new THREE.Vector3(),
    raycaster = new THREE.Raycaster(),
    ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let alive = true,
    frame = 0,
    ready = false,
    following = false,
    panorama = false;
  const cancel = new AbortController();
  function center(x: number, z: number, distance?: number, y = 20) {
    const offset = camera.position.clone().sub(controls.target);
    if (distance) offset.setLength(distance);
    controls.target.set(x, y, z);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
  camera.position.set(0, 370, 440);
  center(bridge.snapshot.position.x, bridge.snapshot.position.y, 560);
  const api = {
    zoom(direction: -1 | 1) {
      panorama = false;
      center(
        controls.target.x,
        controls.target.z,
        THREE.MathUtils.clamp(
          camera.position.distanceTo(controls.target) *
            (direction === 1 ? 0.8 : 1.25),
          controls.minDistance,
          controls.maxDistance,
        ),
        controls.target.y,
      );
    },
    overview() {
      following = false;
      panorama = true;
      const halfFov = Math.min(
        (camera.fov * Math.PI) / 360,
        Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect),
      );
      center(
        width / 2,
        height / 2,
        (Math.hypot(width, height, 300) / 2 / Math.sin(halfFov)) * 0.86,
        50,
      );
    },
    focusPoint(point: { x: number; y: number }) {
      following = false;
      panorama = false;
      center(point.x, point.y, 110, 8);
    },
    focusBuilding(id: string) {
      const b = world.buildings.find((b) => b.id === id);
      if (!b) return;
      following = false;
      panorama = false;
      const uniqueGroup =
        world.buildings.filter((other) => other.group === b.group).length === 1;
      const box = uniqueGroup ? groupBounds.get(b.group) : undefined;
      const target = box
        ? box.getCenter(new THREE.Vector3())
        : new THREE.Vector3(b.label.x, 65, b.label.y);
      const size = box
        ? box.getSize(new THREE.Vector3())
        : new THREE.Vector3(
            Math.max(220, b.width),
            150,
            Math.max(220, b.height),
          );
      const halfFov = Math.min(
        (camera.fov * Math.PI) / 360,
        Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect),
      );
      const distance = Math.min(
        controls.maxDistance,
        (size.length() / 2 / Math.sin(halfFov)) * 1.15,
      );
      // Building anchors can be a single POI; fit the physical model instead of that zero-size point.
      camera.position
        .copy(controls.target)
        .add(
          new THREE.Vector3().setFromSpherical(
            new THREE.Spherical(distance, 0.85, controls.getAzimuthalAngle()),
          ),
        );
      center(target.x, target.z, distance, Math.min(100, target.y));
    },
    follow() {
      following = true;
      panorama = false;
      center(bridge.snapshot.position.x, bridge.snapshot.position.y, 110, 8);
    },
  };
  const resize = new ResizeObserver(() => {
    if (!host.clientWidth || !host.clientHeight) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    if (panorama) api.overview();
  });
  resize.observe(host);
  controls.addEventListener("start", () => {
    following = false;
    panorama = false;
  });
  const pointers = new Set<number>();
  let press: { x: number; y: number; id: number; moved: boolean } | undefined;
  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => {
      pointers.add(e.pointerId);
      if (!e.isPrimary) {
        if (press) press.moved = true;
        return;
      }
      if (e.button === 0 && !bridge.paused)
        press = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    },
    { signal: cancel.signal },
  );
  renderer.domElement.addEventListener(
    "pointermove",
    (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5)
        press.moved = true;
    },
    { signal: cancel.signal },
  );
  renderer.domElement.addEventListener(
    "pointerup",
    (e) => {
      pointers.delete(e.pointerId);
      if (
        press?.id === e.pointerId &&
        !press.moved &&
        !bridge.paused &&
        ready
      ) {
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            1 - ((e.clientY - rect.top) / rect.height) * 2,
          ),
          camera,
        );
        const hit = raycaster.intersectObjects(pickTargets, true)[0];
        const point = hit
          ? scratch.copy(hit.point)
          : raycaster.ray.intersectPlane(ground, scratch);
        if (point)
          center(
            THREE.MathUtils.clamp(scratch.x, 0, width),
            THREE.MathUtils.clamp(scratch.z, 0, height),
            Math.min(600, camera.position.distanceTo(controls.target)),
          );
      }
      press = undefined;
    },
    { signal: cancel.signal },
  );
  const clearGesture = () => {
    press = undefined;
    for (const pointerId of pointers)
      renderer.domElement.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId }),
      );
    pointers.clear();
  };
  renderer.domElement.addEventListener(
    "pointercancel",
    (e) => {
      pointers.delete(e.pointerId);
      press = undefined;
    },
    { signal: cancel.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) clearGesture();
    },
    { signal: cancel.signal },
  );
  bridge.addEventListener(
    "change",
    () => {
      if (bridge.paused) clearGesture();
    },
    { signal: cancel.signal },
  );
  window.addEventListener("blur", clearGesture, { signal: cancel.signal });
  renderer.domElement.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      ready = false;
      bridge.orbit = undefined;
      bridge.orbitYaw = 0;
      status("3D 画面暂时不可用，请返回漫游后重试。");
    },
    { signal: cancel.signal },
  );
  const disposeObject = (object: THREE.Object3D) => {
    const textures = new Set<THREE.Texture>();
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Sprite))
        return;
      child.geometry.dispose();
      for (const material of Array.isArray(child.material)
        ? child.material
        : [child.material]) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
    });
    textures.forEach((texture) => {
      texture.dispose();
      if (
        typeof ImageBitmap !== "undefined" &&
        texture.image instanceof ImageBitmap
      )
        texture.image.close();
    });
  };
  const load = async () => {
    let model: THREE.Group | undefined, texture: THREE.Texture | undefined;
    try {
      const responses = await Promise.all([
        fetch("/orbit/campus.glb", { signal: cancel.signal }),
        fetch("/orbit/terrain.png", { signal: cancel.signal }),
      ]);
      if (responses.some((r) => !r.ok))
        throw new Error("3D assets unavailable");
      const [bytes, blob] = await Promise.all([
        responses[0].arrayBuffer(),
        responses[1].blob(),
      ]);
      model = (await new GLTFLoader().parseAsync(bytes, "")).scene;
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "flipY",
      });
      texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      texture.anisotropy = Math.min(
        8,
        renderer.capabilities.getMaxAnisotropy(),
      );
      if (!alive) {
        disposeObject(model);
        texture.dispose();
        bitmap.close();
        return;
      }
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          for (const material of Array.isArray(child.material)
            ? child.material
            : [child.material]) {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.color.multiply(new THREE.Color(1, 0.96, 0.87));
              material.roughness = 0.94;
              material.metalness = 0;
              if (material.map) {
                material.map.magFilter = THREE.NearestFilter;
                material.map.anisotropy = 4;
              }
            }
          }
        }
      });
      for (const group of model.children)
        groupBounds.set(group.name, new THREE.Box3().setFromObject(group));
      renderer.shadowMap.needsUpdate = true;
      scene.add(model);
      pickTargets.push(model);
      terrain.material.map = texture;
      terrain.material.needsUpdate = true;
      ready = true;
      bridge.orbit = api;
      host.dataset.ready = "true";
      status("");
    } catch (e) {
      if (model) disposeObject(model);
      if (texture) {
        texture.dispose();
        if (texture.image instanceof ImageBitmap) texture.image.close();
      }
      if (alive) status("3D 模型加载失败，请返回漫游后重试。");
    }
  };
  void load();
  function placeLabel(label: HTMLElement, x: number, y: number, z: number) {
    scratch.set(x, y, z).project(camera);
    label.hidden =
      scratch.z > 1 ||
      scratch.z < -1 ||
      Math.abs(scratch.x) > 0.96 ||
      Math.abs(scratch.y) > 0.92;
    label.style.transform = `translate(-50%, -100%) translate(${((scratch.x + 1) * host.clientWidth) / 2}px, ${((1 - scratch.y) * host.clientHeight) / 2}px)`;
  }
  const animate = () => {
    if (!alive) return;
    frame = requestAnimationFrame(animate);
    controls.enabled = ready && !bridge.paused;
    if (!bridge.paused) {
      if (following)
        center(
          bridge.snapshot.position.x,
          bridge.snapshot.position.y,
          undefined,
          8,
        );
      controls.update();
      const bounded = controls.target.clone();
      bounded.x = THREE.MathUtils.clamp(bounded.x, 0, width);
      bounded.z = THREE.MathUtils.clamp(bounded.z, 0, height);
      bounded.y = THREE.MathUtils.clamp(bounded.y, 0, 100);
      camera.position.add(bounded.clone().sub(controls.target));
      controls.target.copy(bounded);
    }
    if (ready) bridge.orbitYaw = controls.getAzimuthalAngle();
    const progress = bridge.progress.snapshot.progress;
    const feet = bridge.actor?.position ?? bridge.snapshot.position;
    const dx = feet.x - lastFeet.x,
      dz = feet.y - lastFeet.y;
    const yaw = controls.getAzimuthalAngle(),
      sx = dx * Math.cos(yaw) - dz * Math.sin(yaw),
      sy = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const walking = !bridge.paused && (bridge.actor?.moving ?? false);
    if (walking)
      facing =
        Math.abs(sx) > Math.abs(sy)
          ? sx > 0
            ? "right"
            : "left"
          : sy > 0
            ? "down"
            : "up";
    student.pose(
      progress.outfit,
      progress.hat,
      facing,
      walking ? Math.floor(performance.now() / 140) % 4 : 0,
    );
    lastFeet = { ...feet };
    avatar.position.set(feet.x, 0, feet.y);
    for (const { chest, model } of treasure)
      model.open((progress.chestReadyAt[chest.id] ?? 0) > Date.now());
    renderer.render(scene, camera);
    placeLabel(marker, avatar.position.x, personHeight + 2, avatar.position.z);
    for (const { npc, label } of people) {
      label.textContent = `${progress.talked.includes(npc.id) ? "" : "! "}${npc.name}`;
      placeLabel(label, npc.x, personHeight + 2, npc.y);
      if (controls.getDistance() > 1600) label.hidden = true;
    }
    for (const { chest, label } of treasure) {
      label.textContent =
        (progress.chestReadyAt[chest.id] ?? 0) > Date.now()
          ? "已打开"
          : "✦ 宝箱";
      placeLabel(label, chest.x, 5, chest.y);
      if (controls.getDistance() > 1200) label.hidden = true;
    }
    for (const { label, building } of labels) {
      label.textContent =
        controls.getDistance() > 1300
          ? building.id
          : `${building.id} · ${building.name}`;
      placeLabel(label, building.label.x, 175, building.label.y);
    }
    Object.assign(host.dataset, {
      yaw: controls.getAzimuthalAngle().toFixed(4),
      pitch: controls.getPolarAngle().toFixed(4),
      distance: controls.getDistance().toFixed(2),
      targetX: controls.target.x.toFixed(2),
      targetY: controls.target.z.toFixed(2),
      triangles: String(renderer.info.render.triangles),
    });
  };
  animate();
  return () => {
    alive = false;
    cancel.abort();
    cancelAnimationFrame(frame);
    resize.disconnect();
    controls.dispose();
    if (bridge.orbit === api) {
      bridge.orbit = undefined;
      bridge.orbitYaw = 0;
    }
    disposeObject(scene);
    cast.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    host.replaceChildren();
  };
}
