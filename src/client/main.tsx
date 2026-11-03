import { sundial } from "../shared/sundial";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { createGame, GameBridge } from "./game";
import {
  passageLabel,
  passageMarkers,
  visibleFloorPlan,
} from "../shared/passages";
import type { WorldMap } from "../shared/world";
import "./style.css";

const bridge = new GameBridge();
const subscribe = (cb: () => void) => {
  bridge.addEventListener("change", cb);
  return () => bridge.removeEventListener("change", cb);
};
const getSnapshot = () => bridge.snapshot;
function WorldCanvas({ world }: { world: WorldMap }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => createGame(element.current!, world, bridge), [world]);
  return <div ref={element} className="canvas-host" />;
}
function Joystick() {
  const [thumb, setThumb] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const stop = () => {
    active.current = null;
    bridge.direction = { x: 0, y: 0 };
    setThumb({ x: 0, y: 0 });
  };
  useEffect(() => {
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);
  const update = (e: React.PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId || bridge.paused) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / 32,
      y = (e.clientY - rect.top - rect.height / 2) / 32;
    const length = Math.max(1, Math.hypot(x, y));
    x /= length;
    y /= length;
    bridge.direction = Math.hypot(x, y) < 0.15 ? { x: 0, y: 0 } : { x, y };
    setThumb({ x: x * 28, y: y * 28 });
  };
  return (
    <div
      className="joystick"
      aria-label="移动摇杆"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={update}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      <span style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}>
        ✣
      </span>
    </div>
  );
}
function Overview({ world }: { world: WorldMap }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const campus = world.scenes[0];
  const [selected, select] = useState("C2");
  const b = world.buildings.find((b) => b.id === selected)!;
  const [floorId, setFloorId] = useState("");
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const entry = campus.portals.find((p) => p.buildingId === b.id)!;
  const initial = world.scenes.find((s) => s.id === entry.targetScene)!;
  const floors = world.scenes.filter((s) => s.sourceMap === initial.sourceMap);
  const current = world.scenes.find((s) => s.id === snapshot.sceneId)!;
  const indoors = current.id !== "campus_core";
  const plan = visibleFloorPlan(world, current.id, floorId || initial.id);
  return (
    <>
      {!indoors && (
        <>
          <div className="overview-map">
            <svg
              viewBox={`0 0 ${campus.width * 16} ${campus.height * 16}`}
              role="img"
              aria-label="源模型重建的核心校园总览"
            >
              <rect width="100%" height="100%" fill="#dfe5cf" />
              <image
                href="/maps/campus-reconstruction.png"
                width={campus.width * 16}
                height={campus.height * 16}
              />
              {world.buildings.map((b) => (
                <g
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${b.id}`}
                  onClick={() => {
                    select(b.id);
                    setFloorId("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(b.id);
                      setFloorId("");
                    }
                  }}
                >
                  <rect
                    x={b.label.x - 30}
                    y={b.label.y - 30}
                    width="60"
                    height="60"
                    rx="6"
                    fill={b.id === selected ? "#365e4c" : "#f3e9ce"}
                    stroke="#688374"
                    strokeWidth="3"
                  />
                  <text
                    x={b.label.x}
                    y={b.label.y + 11}
                    fontSize="30"
                    textAnchor="middle"
                    fill={b.id === selected ? "#fff9e8" : "#365e4c"}
                  >
                    {b.id}
                  </text>
                </g>
              ))}
              {snapshot.sceneId === "campus_core" && (
                <circle
                  cx={snapshot.position.x}
                  cy={snapshot.position.y}
                  r="12"
                  fill="#d17b4b"
                  stroke="#fff9e8"
                  strokeWidth="5"
                />
              )}
            </svg>
          </div>
          <div className="map-detail">
            <strong>
              {b.id} · {b.name}
            </strong>
            <span className="tag">待人工核对</span>
            <p>{`定位依据：${({ "room-label-median": "F1 房间编号标签", "model-center": "总图建筑模型中心", poi: "源地图 POI", "feature-center": "F1 演讲厅编号属性" } as Record<string, string>)[b.anchorMethod]}。各楼层与公共通道已重建，入口编号关联待现场确认。`}</p>
          </div>
        </>
      )}
      <div className={`floor-plans${indoors ? " current-floor-plan" : ""}`}>
        {indoors ? (
          <div className="floor-plan-heading">
            <strong>当前楼层 · {plan.floor.name}</strong>
            <p>
              {plan.name} · 楼梯与电梯通往其他楼层，走过连廊标记可到达相邻建筑。
            </p>
          </div>
        ) : (
          <label>
            楼层平面
            <select
              aria-label="查看楼层平面"
              value={plan.id}
              onChange={(e) => setFloorId(e.target.value)}
            >
              {floors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="layer-switches" aria-label="地图图层">
          {plan.art.layers
            .filter((l) => l.id !== "base")
            .map((l) => (
              <label key={l.id}>
                <input
                  type="checkbox"
                  checked={!hiddenLayers.includes(l.id)}
                  onChange={() =>
                    setHiddenLayers((hidden) =>
                      hidden.includes(l.id)
                        ? hidden.filter((id) => id !== l.id)
                        : [...hidden, l.id],
                    )
                  }
                />
                {
                  {
                    floor: "地面",
                    terrain: "地形",
                    rooms: "房间",
                    passages: "通道",
                    fixtures: "设施",
                    walls: "墙体",
                    shadows: "投影",
                  }[l.id]
                }
              </label>
            ))}
        </div>
        <svg
          viewBox={`0 0 ${plan.width * 16} ${plan.height * 16}`}
          role="img"
          aria-label={`${plan.name}通道平面`}
        >
          {plan.art.layers
            .filter((l) => !hiddenLayers.includes(l.id))
            .map((l) => (
              <image
                key={l.id}
                href={`/maps/${l.image}`}
                width={plan.width * 16}
                height={plan.height * 16}
              />
            ))}
          {!hiddenLayers.includes("walls") &&
            plan.doors?.map(
              (door) =>
                door.hinge &&
                door.latch && (
                  <line
                    key={door.id}
                    x1={door.hinge.x}
                    y1={door.hinge.y}
                    x2={door.latch.x}
                    y2={door.latch.y}
                    stroke={
                      snapshot.openDoorIds?.includes(door.id)
                        ? "#428779"
                        : "#936737"
                    }
                    strokeWidth="1"
                  >
                    <title>{door.room}</title>
                  </line>
                ),
            )}
          {plan.portals
            .filter((p) => p.kind === "entrance")
            .map((p) => (
              <circle
                key={p.id}
                cx={p.entrance?.threshold.x ?? p.x}
                cy={p.entrance?.threshold.y ?? p.y}
                r="4"
                fill={
                  p.kind === "entrance"
                    ? "#edbe60"
                    : p.kind === "lift"
                      ? "#408fc2"
                      : "#3b9b70"
                }
              >
                <title>{passageLabel(world, plan, p)}</title>
              </circle>
            ))}
          {passageMarkers(world, plan).map((marker) => (
            <g
              key={marker.portalIds.join(":")}
              transform={`translate(${marker.x} ${marker.y})`}
              data-passage-kind={marker.kind}
            >
              <title>{marker.label}</title>
              <rect
                x="-6"
                y="-6"
                width="12"
                height="12"
                rx="2"
                fill={
                  marker.kind === "gallery"
                    ? "#ffe4b3"
                    : marker.kind === "lift"
                      ? "#e2edf4"
                      : "#e4efdc"
                }
                stroke={
                  marker.kind === "gallery"
                    ? "#96572d"
                    : marker.kind === "lift"
                      ? "#397e9f"
                      : "#3e7350"
                }
              />
              {marker.kind === "gallery" ? (
                <path
                  d="M-4-2H4M-4 2H4M-3-2V2M0-2V2M3-2V2"
                  fill="none"
                  stroke="#96572d"
                />
              ) : marker.kind === "lift" ? (
                <path d="M-3-4H3V4H-3ZM0-4V4" fill="none" stroke="#397e9f" />
              ) : (
                <path
                  d="M-4 4H-2V2H0V0H2V-2H4V-4"
                  fill="none"
                  stroke="#3e7350"
                  strokeWidth="1.3"
                />
              )}
            </g>
          ))}
          {snapshot.sceneId === plan.id && (
            <circle
              cx={snapshot.position.x}
              cy={snapshot.position.y}
              r="5"
              fill="#d17b4b"
              stroke="white"
              strokeWidth="2"
            />
          )}
        </svg>
        <p className="muted">
          {plan.floor.name} · 源标高 {plan.floor.elevation} · 金色：出入口 ·
          蓝色：电梯 · 绿色：楼梯／扶梯 · 琥珀色：跨楼连廊
        </p>
      </div>
      {!indoors && (
        <p className="muted">
          建筑：GLB 节点和材质烘焙 · 地形：源道路、绿化和水体 · 橙点：你
        </p>
      )}
    </>
  );
}
function App() {
  const [world, setWorld] = useState<WorldMap>();
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [panel, setPanel] = useState<"map" | "guide" | "sundial" | null>(null);
  const [references, setReferences] = useState(false);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const onError = () => {
      setWorld(undefined);
      setError("地图图像加载失败，请重试");
    };
    const observe = () => setPanel("sundial");
    bridge.addEventListener(sundial.id, observe);
    bridge.addEventListener("loaderror", onError);
    return () => {
      bridge.removeEventListener(sundial.id, observe);
      bridge.removeEventListener("loaderror", onError);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    fetch("/maps/world.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`地图加载失败 (${r.status})`);
        return r.json();
      })
      .then((data: WorldMap) => {
        if (
          data.protocolVersion !== 2 ||
          data.status !== "reconstructed" ||
          data.scenes?.[0]?.id !== "campus_core" ||
          !data.scenes.every((s) => s.floor && s.art?.layers?.length)
        )
          throw new Error("地图版本不匹配，请重新构建后刷新");
        setWorld(data);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    bridge.pause(Boolean(panel));
    if (panel) dialog.current?.showModal();
    else dialog.current?.close();
    return () => bridge.pause(false);
  }, [panel]);
  const current = world?.scenes.find((s) => s.id === snapshot.sceneId);
  return (
    <main
      className="app-shell"
      data-scene={snapshot.sceneId}
      data-avatar-width={snapshot.avatarSize?.width}
      data-avatar-height={snapshot.avatarSize?.height}
      data-camera-zoom={snapshot.cameraZoom}
      data-x={Math.round(snapshot.position.x)}
      data-y={Math.round(snapshot.position.y)}
      data-open-doors={(snapshot.openDoorIds ?? []).join(" ")}
      data-floor={current?.floor.name}
      data-floor-images={JSON.stringify(snapshot.floorImages ?? [])}
      data-stair-markers={snapshot.stairMarkers ?? 0}
    >
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">谷</span>
          <span>
            科大谷<small>UST VALLEY</small>
          </span>
        </a>
        <div className="chapter">
          <span className="eyebrow">BUILD 0.5.2 / 立体像素校园</span>
          <h1>
            从校园，
            <br />
            开始漫游。
          </h1>
          <p>
            走过熟悉的连廊，
            <br />
            重新发现一座校园。
          </p>
        </div>
        <div className="progress-card">
          <div>
            <span>本次探索</span>
            <strong>
              {snapshot.discovered.length}
              <small> / 15</small>
            </strong>
          </div>
          <progress max="15" value={snapshot.discovered.length} />
          <p>走入建筑内的绿色探索区，留下足迹。</p>
        </div>
        <nav aria-label="校园工具">
          <button onClick={() => setPanel("map")} disabled={!world}>
            <span>▦</span> 校园地图 <kbd>M</kbd>
          </button>
          <button onClick={() => setPanel("guide")}>
            <span>☷</span> 漫游指南 <span>↗</span>
          </button>
        </nav>
        <div className="build-note">
          <span className="status-dot" /> 几何重建 · 单机预览
          <p>
            当前用于核对地图与操作。
            <br />
            账号、联机与奖励系统待实现。
          </p>
        </div>
        <footer>
          HKUST(GZ) · 校园探索计划
          <br />
          <span>每一段路，都值得走一遍。</span>
        </footer>
      </aside>
      <section className="play-area" aria-label="校园游戏区">
        <header className="topbar">
          <div>
            <span className="location-icon">⌖</span>
            <span>
              <small>你正在</small>
              <strong>{current?.name ?? "准备进入校园"}</strong>
            </span>
          </div>
          <span className="day-tag">☀ 日间 · 自由漫游</span>
          <button
            className="mobile-map"
            onClick={() => setPanel("map")}
            disabled={!world}
          >
            地图
          </button>
        </header>
        <div className="world-frame">
          {world ? (
            <WorldCanvas world={world} />
          ) : (
            <div className="loading">
              <span className="brand-mark">谷</span>
              <p>{error || "正在整理校园地图…"}</p>
              {error && (
                <button onClick={() => retry((n) => n + 1)}>重新加载</button>
              )}
            </div>
          )}
          {world && (
            <>
              <div className="world-badge">
                <span className="status-dot" />{" "}
                {current?.floor.name === "室外"
                  ? "核心区 · 源模型重建"
                  : `${current?.floor.name} · 楼层与通道`}
              </div>
              <div className="zoom-controls">
                <button
                  aria-label="缩小视野"
                  disabled={!snapshot.canZoomOut}
                  onClick={() => bridge.zoom(-1)}
                >
                  −
                </button>
                <span title="相对于当前视口默认镜头的倍率">
                  {snapshot.zoomPercent}%
                </span>
                <button
                  aria-label="放大视野"
                  disabled={!snapshot.canZoomIn}
                  onClick={() => bridge.zoom(1)}
                >
                  ＋
                </button>
              </div>
              {!snapshot.target && (
                <div className="interaction-hint" role="status">
                  {current?.id === "campus_core"
                    ? "走向金色门槛，自动进入建筑"
                    : "走近房门自动开启，楼梯和电梯按 E 选择"}
                </div>
              )}
              {Boolean(snapshot.passages?.length) && (
                <div className="passage-options" aria-label="附近的门与通道">
                  {snapshot.passages!.map((p, index) => (
                    <button
                      key={p.id}
                      data-portal={p.id}
                      aria-keyshortcuts={index === 0 ? "E" : undefined}
                      onClick={() => bridge.interact(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="touch-controls">
                <Joystick />
                <button
                  aria-label={snapshot.target ?? "交互"}
                  disabled={!snapshot.target}
                  onClick={() => bridge.interact()}
                >
                  E<span>{snapshot.target ?? "交互"}</span>
                </button>
              </div>
              <div className="rotate-hint">
                <span>↻</span>横屏漫游，视野更开阔
              </div>
            </>
          )}
        </div>
        <div className="bottom-bar">
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> / 方向键移动 <b>·</b> <kbd>Shift</kbd> 奔跑 <b>·</b>{" "}
            <kbd>E</kbd> 交互
          </span>
          <div>
            <button
              onClick={() => {
                bridge.toggleReferences();
                setReferences(bridge.references);
              }}
              aria-pressed={references}
            >
              源地图参考 {references ? "开" : "关"}
            </button>
            <button onClick={() => bridge.reset()} disabled={!world}>
              回到广场 ↺
            </button>
          </div>
        </div>
        <div className="caption">
          <span>01 — CORE CAMPUS</span>
          <p>15 栋建筑 · 同一座校园</p>
          <span>31 个室内楼层 · 3D 像素重建</span>
        </div>
      </section>
      <dialog
        ref={dialog}
        data-panel={panel}
        aria-labelledby="panel-title"
        onKeyDown={(e) => {
          if (panel === "sundial" && e.key.toLowerCase() === "e" && !e.repeat) {
            e.stopPropagation();
            setPanel(null);
          }
        }}
        onCancel={() => setPanel(null)}
        onClose={() => {
          if (panel) setPanel(null);
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">UST VALLEY / FIELD NOTES</span>
            <h2 id="panel-title">
              {panel === "map"
                ? current?.id !== "campus_core"
                  ? `当前楼层地图 · ${current?.floor.name}`
                  : "校园地图"
                : panel === "sundial"
                  ? sundial.title
                  : "漫游指南"}
            </h2>
          </div>
          <button aria-label="关闭面板" onClick={() => setPanel(null)}>
            ×
          </button>
        </div>
        {panel === "map" && world ? (
          <Overview world={world} />
        ) : panel === "sundial" ? (
          <p className="guide">{sundial.note}</p>
        ) : (
          <div className="guide">
            <p>从 C2 学生活动中心附近出发，沿浅色步道探索校园。</p>
            <ol>
              <li>使用 WASD、方向键或左侧触摸摇杆移动。</li>
              <li>电脑按住 Shift 奔跑，松开后恢复基础移动速度。</li>
              <li>
                走向金色门槛，自动进出建筑。也可以在门前按 E 或点入口名称。
              </li>
              <li>
                靠近绿色台阶图标，按 E
                上下楼；同处有多个方向时，点击“上楼至”或“下楼至”按钮。蓝色图标为电梯。
              </li>
              <li>
                进入建筑后，漫游画面与地图只显示当前楼层平面；上下楼后自动同步。室外校园总览可预览各建筑楼层。
              </li>
              <li>
                沿同层连廊走过交界点即可进入相邻楼。走近房门会自动开门，离开后自动关门。按
                E 或点房间名也可手动开关。
              </li>
              <li>到达室内绿色探索区后，本次探索计数增加；再从出口返回。</li>
              <li>
                开启「源地图参考」可对照当前楼层地面轮廓、步行路网和入口候选点。
              </li>
            </ol>
            <p>
              本次探索只保存在当前页面内存中。宝箱为点位预览，纸条区仅显示范围；领取、留言、货币、注册与多人功能尚未开放。
            </p>
            <p>
              建筑依据源 GLB 重建，室内采用全部 31
              个真实楼层平面；入口编号关联仍待现场确认。
            </p>
          </div>
        )}
      </dialog>
      <KeyboardPanels open={setPanel} />
    </main>
  );
}
function KeyboardPanels({ open }: { open: (panel: "map") => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "m" &&
        !e.repeat &&
        !e.isComposing &&
        !bridge.paused &&
        !document.activeElement?.matches(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        open("map");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
  return null;
}
createRoot(document.getElementById("root")!).render(<App />);
