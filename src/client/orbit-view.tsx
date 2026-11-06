import { useEffect, useRef, useState } from "react";
import type { GameBridge } from "./game";
import type { WorldMap } from "../shared/world";
export function OrbitView({
  world,
  bridge,
  close,
}: {
  world: WorldMap;
  bridge: GameBridge;
  close: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("正在加载三维校园…");
  useEffect(() => {
    let cancelled = false,
      dispose: (() => void) | undefined;
    import("./orbit-renderer")
      .then(({ createOrbit }) => {
        if (!cancelled)
          dispose = createOrbit(host.current!, world, bridge, setMessage);
      })
      .catch(() => {
        if (!cancelled) setMessage("当前设备无法显示 3D 画面，请返回漫游。");
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [world, bridge]);
  return (
    <div className="orbit-view">
      <div className="orbit-host" ref={host} />
      {message && (
        <div className="orbit-message" role="status">
          <p>{message}</p>
          <button onClick={close}>返回漫游</button>
        </div>
      )}
    </div>
  );
}
