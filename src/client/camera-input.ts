import type { GameBridge } from "./game";

/** Canvas gestures never capture controls, page scrolling outside the map, or dialog input. */
export function attachCameraInput(
  parent: HTMLElement,
  bridge: GameBridge,
  signal: AbortSignal,
) {
  let drag: { id: number; x: number; y: number; active: boolean } | undefined;
  let wheel = 0,
    lastWheel = 0,
    lastStep = 0;
  const cancel = () => {
    if (drag && parent.hasPointerCapture(drag.id))
      parent.releasePointerCapture(drag.id);
    drag = undefined;
    delete parent.dataset.dragging;
  };
  const canvasEvent = (event: Event) =>
    event.target instanceof HTMLCanvasElement;
  parent.addEventListener(
    "pointerdown",
    (e) => {
      if (
        bridge.paused ||
        !bridge.scene ||
        !canvasEvent(e) ||
        ![0, 1].includes(e.button)
      )
        return;
      if (drag) {
        cancel();
        return;
      }
      e.preventDefault();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
      parent.setPointerCapture(e.pointerId);
    },
    { signal },
  );
  parent.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (bridge.paused) {
        cancel();
        return;
      }
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!drag.active && Math.hypot(dx, dy) < 4) return;
      drag.active = true;
      parent.dataset.dragging = "true";
      const rect = parent.getBoundingClientRect();
      bridge.scene?.panView(dx / rect.width, dy / rect.height);
      if (drag) {
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    },
    { signal },
  );
  for (const event of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    parent.addEventListener(
      event,
      (e) => {
        if (drag?.id === e.pointerId) cancel();
      },
      { signal },
    );
  parent.addEventListener(
    "wheel",
    (e) => {
      if (bridge.paused || !bridge.scene || !canvasEvent(e) || !e.deltaY)
        return;
      e.preventDefault();
      const now = performance.now(),
        delta =
          e.deltaY *
          (e.deltaMode === 1
            ? 16
            : e.deltaMode === 2
              ? parent.clientHeight
              : 1);
      if (now - lastWheel > 200 || Math.sign(delta) !== Math.sign(wheel))
        wheel = 0;
      wheel += delta;
      lastWheel = now;
      if (Math.abs(wheel) < 40 || now - lastStep < 90) return;
      const rect = parent.getBoundingClientRect();
      bridge.scene.stepZoom(wheel < 0 ? 1 : -1, {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      });
      wheel = 0;
      lastStep = now;
    },
    { signal, passive: false },
  );
  bridge.addEventListener(
    "change",
    () => {
      if (
        bridge.paused ||
        (drag?.active && bridge.snapshot.cameraMode === "follow")
      )
        cancel();
    },
    { signal },
  );
  window.addEventListener("blur", cancel, { signal });
  document.addEventListener("visibilitychange", cancel, { signal });
  signal.addEventListener("abort", cancel, { once: true });
}
