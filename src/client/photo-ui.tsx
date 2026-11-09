import React, { useEffect, useRef, useState } from "react";
import type { WorldMap, SceneMap, Point } from "../shared/world";
import { canStand } from "../shared/world";
import {
  headingVector,
  vectorHeading,
  reproject,
  photoLimits,
  type PhotoRecord,
  type PoseInput,
} from "../shared/photos";
import "./photo.css";
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch("/api/v1/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r
    .json()
    .catch(() => ({ message: "服务器未提供照片功能，请启动照片服务" }));
  if (!r.ok) throw new Error(value.message ?? "请求失败");
  return value;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AnnotationMap({
  scene,
  point,
  heading,
  onPoint,
  onHeading,
  markers = [],
}: {
  scene: SceneMap;
  point: Point | null;
  heading: number | null;
  onPoint?: (p: Point) => void;
  onHeading?: (v: number) => void;
  markers?: { id: string; point: Point; onClick: () => void }[];
}) {
  const svg = useRef<SVGSVGElement>(null),
    [mode, setMode] = useState<"point" | "heading" | "pan">("point");
  const full = {
    x: 0,
    y: 0,
    w: scene.width * scene.tileSize,
    h: scene.height * scene.tileSize,
  };
  const [view, setView] = useState(full),
    drag = useRef<{ x: number; y: number; view: typeof full } | null>(null);
  useEffect(() => {
    setView(full);
    setMode("point");
  }, [scene.id]);
  const local = (x: number, y: number) => {
    const p = svg.current!.createSVGPoint();
    p.x = x;
    p.y = y;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const zoom = (factor: number) =>
    setView((v) => {
      const w = Math.max(full.w / 12, Math.min(full.w * 1.2, v.w * factor));
      return {
        x: v.x + (v.w - w) / 2,
        y: v.y + (v.h - (w * full.h) / full.w) / 2,
        w,
        h: (w * full.h) / full.w,
      };
    });
  useEffect(() => {
    const node = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      setView((v) => {
        const w = Math.max(
            full.w / 12,
            Math.min(full.w * 1.2, v.w * (e.deltaY > 0 ? 1.15 : 1 / 1.15)),
          ),
          f = w / v.w;
        return {
          x: p.x - (p.x - v.x) * f,
          y: p.y - (p.y - v.y) * f,
          w,
          h: v.h * f,
        };
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [scene.id]);
  const choose = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = local(e.clientX, e.clientY);
    if (mode === "point")
      onPoint?.({
        x: Math.max(0, Math.min(full.w - 0.01, p.x)),
        y: Math.max(0, Math.min(full.h - 0.01, p.y)),
      });
    else if (
      mode === "heading" &&
      point &&
      Math.hypot(p.x - point.x, p.y - point.y) > 1
    )
      onHeading?.(vectorHeading({ x: p.x - point.x, y: p.y - point.y }));
  };
  const radius = view.w / 85,
    arrow = heading === null ? null : headingVector(heading),
    north = headingVector(0);
  const groups = new Map<string, typeof markers>();
  for (const m of markers) {
    const k =
      Math.round(m.point.x / radius) + ":" + Math.round(m.point.y / radius);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return (
    <div className="photo-map">
      <div className="photo-row">
        {onPoint &&
          (["point", "heading", "pan"] as const).map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {
                {
                  point: "放置／移动拍摄点",
                  heading: "标记镜头朝向",
                  pan: "拖动地图",
                }[m]
              }
            </button>
          ))}
        <button
          type="button"
          onClick={() => zoom(0.7)}
          aria-label="放大标注地图"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => zoom(1 / 0.7)}
          aria-label="缩小标注地图"
        >
          −
        </button>
        <button type="button" onClick={() => setView(full)}>
          全图
        </button>
      </div>
      <svg
        ref={svg}
        role="img"
        aria-label="拍摄位置与朝向标注地图"
        viewBox={view.x + " " + view.y + " " + view.w + " " + view.h}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view };
          if (mode !== "pan" && onPoint) choose(e);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          if (mode === "pan" || !onPoint) {
            const scale = svg.current!.getScreenCTM()!.a;
            const d = drag.current;
            setView({
              ...d.view,
              x: d.view.x - (e.clientX - d.x) / scale,
              y: d.view.y - (e.clientY - d.y) / scale,
            });
          } else choose(e);
        }}
        onPointerUp={(e) => {
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <rect x={0} y={0} width={full.w} height={full.h} fill="#e7ead9" />
        {scene.surfaces
          .filter((s) => !["label", "text"].includes(s.kind))
          .map((s, i) => (
            <path
              key={i}
              d={s.polygons
                .map((poly) =>
                  poly
                    .map(
                      (ring) =>
                        "M" + ring.map((p) => p.x + "," + p.y).join("L") + "Z",
                    )
                    .join(" "),
                )
                .join(" ")}
              fill={s.color || "#ddd8bf"}
              fillRule="evenodd"
              stroke="#8d9880"
              strokeWidth={0.35}
            />
          ))}
        {scene.sourceRoads.map((r, i) => (
          <polyline
            key={"r" + i}
            points={r.map((p) => p.x + "," + p.y).join(" ")}
            fill="none"
            stroke="#f6f0d9"
            strokeWidth={2}
          />
        ))}
        {scene.sourceOutlines.map((o, i) => (
          <polygon
            key={"o" + i}
            points={o.points.map((p) => p.x + "," + p.y).join(" ")}
            fill="#cfdbd5"
            stroke="#5b7970"
            strokeWidth={1}
          />
        ))}
        {scene.buildings.map((b) => (
          <text
            key={b.id}
            x={b.label.x}
            y={b.label.y}
            fontSize={radius * 1.5}
            textAnchor="middle"
          >
            {b.id}
          </text>
        ))}
        {[...groups.values()].map((g) => (
          <g
            key={g[0].id}
            role="button"
            aria-label={"查看照片点位 " + g.length + " 张"}
            tabIndex={0}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => g[0].onClick()}
            onKeyDown={(e) => {
              if (e.key === "Enter") g[0].onClick();
            }}
          >
            <circle
              cx={g[0].point.x}
              cy={g[0].point.y}
              r={radius}
              fill="#a369a4"
              stroke="white"
              strokeWidth={radius / 4}
            />
            <text
              x={g[0].point.x}
              y={g[0].point.y + radius * 0.4}
              textAnchor="middle"
              fontSize={radius * 1.3}
              fill="white"
            >
              {g.length}
            </text>
          </g>
        ))}
        {point && (
          <g>
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill="#de763d"
              stroke="#fff"
              strokeWidth={radius * 0.3}
            />
            {arrow && (
              <g stroke="#ba481a" strokeWidth={radius * 0.45}>
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={point.x + arrow.x * radius * 6}
                  y2={point.y + arrow.y * radius * 6}
                />
                <circle
                  cx={point.x + arrow.x * radius * 6}
                  cy={point.y + arrow.y * radius * 6}
                  r={radius * 0.55}
                  fill="#ba481a"
                />
              </g>
            )}
          </g>
        )}
        <g
          transform={
            "translate(" +
            (view.x + view.w * 0.9) +
            "," +
            (view.y + view.h * 0.12) +
            ")"
          }
        >
          <circle
            r={radius * 2.2}
            fill="#fffc"
            stroke="#647566"
            strokeWidth={radius * 0.1}
          />
          <line
            x2={north.x * radius * 1.6}
            y2={north.y * radius * 1.6}
            stroke="#a64937"
            strokeWidth={radius * 0.3}
          />
          <text
            x={north.x * radius * 2.9}
            y={north.y * radius * 2.9}
            fontSize={radius * 1.5}
            textAnchor="middle"
          >
            N
          </text>
        </g>
      </svg>
      <p className="photo-help">
        {onPoint
          ? "标记你站的位置，再指向镜头拍摄方向。平面底图用于精确落点；滚轮缩放，切换「拖动地图」浏览。"
          : "点位显示照片拍摄者的位置；点击紫色点查看照片。"}
        北向采用源地图坐标，不随游戏镜头旋转。
      </p>
    </div>
  );
}
export function PhotoPanel({
  world,
  sceneId,
  position,
}: {
  world: WorldMap;
  sceneId: string;
  position: Point;
}) {
  const [tab, setTab] = useState<"upload" | "mine" | "admin">("upload"),
    [csrf, setCsrf] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [scene, setScene] = useState(sceneId),
    [point, setPoint] = useState<Point | null>({ ...position }),
    [heading, setHeading] = useState<number | null>(null),
    [pitch, setPitch] = useState(""),
    [building, setBuilding] = useState(""),
    [blocked, setBlocked] = useState(false);
  const [file, setFile] = useState<File>(),
    [note, setNote] = useState(""),
    [captured, setCaptured] = useState(""),
    [consent, setConsent] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [draft, setDraft] = useState<PhotoRecord>(),
    [editing, setEditing] = useState<PhotoRecord>();
  const [photos, setPhotos] = useState<PhotoRecord[]>([]),
    requestId = useRef(crypto.randomUUID()),
    xhr = useRef<XMLHttpRequest | null>(null);
  const initial = useRef({ sceneId, position: { ...position } });
  const current = world.scenes.find((s) => s.id === scene)!;
  useEffect(() => {
    api("photo-session", "POST")
      .then((r) => setCsrf(r.csrf))
      .catch((e) => setError(e.message));
    return () => xhr.current?.abort();
  }, []);
  const call = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => setPhotos(await api("photos"));
  useEffect(() => {
    if (tab === "mine" && csrf) void call(refresh);
  }, [tab, csrf]);
  const changeScene = (id: string) => {
    setScene(id);
    setPoint(null);
    setHeading(null);
    setBlocked(false);
  };
  const pose = (): PoseInput => ({
    sceneId: scene,
    mapVersion: world.mapVersion,
    x: point!.x,
    y: point!.y,
    heading: heading!,
    pitch: pitch === "" ? null : Number(pitch),
    buildingId: building || null,
    blockedConfirmed: blocked,
  });
  const edit = (p: PhotoRecord) => {
    const projected = reproject(world, p.pose);
    setEditing(p);
    setScene(projected?.sceneId ?? p.pose.sceneId);
    setPoint(projected ? { x: projected.x, y: projected.y } : null);
    setHeading(p.pose.heading);
    setPitch(p.pose.pitch === null ? "" : String(p.pose.pitch));
    setBuilding(p.pose.buildingId ?? "");
    setNote(p.note);
    setBlocked(false);
    setDraft(undefined);
    setTab("upload");
  };
  const upload = async () => {
    if (!point || heading === null || !file || !consent)
      throw new Error("请确认拍摄位置、朝向、照片及用途说明");
    if (file.size > photoLimits.bytes) throw new Error("照片不能超过 25 MB");
    const data = new FormData();
    data.append("pose", JSON.stringify(pose()));
    data.append("note", note);
    if (captured) data.append("capturedAt", new Date(captured).toISOString());
    data.append("file", file);
    setProgress(0);
    try {
      const result = await new Promise<PhotoRecord>((ok, no) => {
        const r = new XMLHttpRequest();
        xhr.current = r;
        r.open("POST", "/api/v1/photos");
        r.setRequestHeader("X-Photo-CSRF", csrf);
        r.setRequestHeader("X-Upload-ID", requestId.current);
        r.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        r.onerror = () => no(new Error("网络中断，请重试；不会重复提交"));
        r.onabort = () => no(new Error("上传已取消，标注已保留"));
        r.onload = () => {
          try {
            const value = JSON.parse(r.responseText);
            r.status < 300 ? ok(value) : no(new Error(value.message));
          } catch {
            no(new Error("照片服务不可用"));
          }
        };
        r.send(data);
      });
      setDraft(result);
    } finally {
      setProgress(null);
      xhr.current = null;
    }
  };
  const usable =
    point && heading !== null && (canStand(current, point) || blocked);
  return (
    <div className="photo-panel">
      <div className="photo-tabs">
        {(["upload", "mine", "admin"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            aria-pressed={tab === t}
          >
            {{ upload: "上传实景", mine: "我的提交", admin: "维护者资料库" }[t]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="photo-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {tab === "admin" ? (
        <PhotoAdmin world={world} />
      ) : tab === "mine" ? (
        <>
          <p>
            仅你和维护者可见。此列表绑定当前浏览器；清除浏览器身份或更换设备后无法自动找回。
          </p>
          <PhotoCards photos={photos} onSelect={edit} />
          {photos.length === 0 && <p>还没有提交照片。</p>}
        </>
      ) : draft ? (
        <div className="photo-confirm">
          <h3>确认这张照片的拍摄标注</h3>
          <img
            src={"/api/v1/photos/" + draft.id + "/preview"}
            alt="待提交的实景照片预览"
          />
          <p>
            {current.name} · 朝向 {draft.pose.heading.toFixed(1)}° · 仰俯{" "}
            {draft.pose.pitch === null ? "未知" : draft.pose.pitch + "°"}
          </p>
          <AnnotationMap
            scene={current}
            point={draft.pose}
            heading={draft.pose.heading}
          />
          <button
            onClick={() =>
              void call(async () => {
                await api(
                  "photos/" + draft.id + "/confirm",
                  "POST",
                  {},
                  { "X-Photo-CSRF": csrf },
                );
                setDraft(undefined);
                setFile(undefined);
                setConsent(false);
                requestId.current = crypto.randomUUID();
                setNotice("照片已保存。可以沿用位置继续添加其他朝向的照片。");
                setHeading(null);
              })
            }
          >
            确认提交
          </button>
          <button
            onClick={() => {
              setEditing(draft);
              setDraft(undefined);
            }}
          >
            修改标注
          </button>
        </div>
      ) : (
        <>
          <div className="photo-row">
            <button
              disabled={!!editing}
              onClick={() => {
                setScene(initial.current.sceneId);
                setPoint(initial.current.position);
                setHeading(null);
                setBlocked(false);
              }}
            >
              使用角色当前位置
            </button>
            <button
              disabled={!!editing}
              onClick={() => {
                setPoint(null);
                setHeading(null);
              }}
            >
              在地图上选位置
            </button>
          </div>
          <div className="photo-fields">
            <label>
              拍摄场景与楼层
              <select
                value={scene}
                onChange={(e) => changeScene(e.target.value)}
              >
                {world.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.floor.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关联建筑（可选）
              <select
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
              >
                <option value="">未指定／公共区域</option>
                {world.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} · {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <AnnotationMap
            scene={current}
            point={point}
            heading={heading}
            onPoint={(p) => {
              setPoint(p);
              setBlocked(false);
            }}
            onHeading={setHeading}
          />
          <div className="photo-fields">
            <label>
              水平朝向（0–359.9°，必填）
              <input
                type="number"
                aria-label="水平朝向"
                min="0"
                max="359.9"
                step=".1"
                value={heading === null ? "" : +heading.toFixed(1)}
                onChange={(e) =>
                  setHeading(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
            <label>
              仰俯角（可选，抬头为正）
              <input
                type="number"
                aria-label="仰俯角"
                min="-90"
                max="90"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
              />
            </label>
          </div>
          {point && !canStand(current, point) && (
            <label className="photo-check">
              <input
                type="checkbox"
                checked={blocked}
                onChange={(e) => setBlocked(e.target.checked)}
              />
              此处在当前地图中不可行走；我确认这是实际拍摄位置。
            </label>
          )}
          <label>
            照片说明（可选）
            <textarea
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：二楼中庭内侧是玻璃，不是栏杆"
            />
          </label>
          {editing ? (
            <div className="photo-row">
              <button
                disabled={!usable}
                onClick={() =>
                  void call(async () => {
                    const saved = await api(
                      "photos/" + editing.id,
                      "PATCH",
                      { revision: editing.revision, pose: pose(), note },
                      { "X-Photo-CSRF": csrf },
                    );
                    if (saved.draft) setDraft(saved);
                    else {
                      setTab("mine");
                      await refresh();
                      setNotice("标注已更新，相关重建批次将重新核对。");
                    }
                    setEditing(undefined);
                  })
                }
              >
                保存标注
              </button>
              <button
                onClick={() => {
                  setEditing(undefined);
                  setTab("mine");
                }}
              >
                取消修改
              </button>
              <button
                onClick={() =>
                  void call(async () => {
                    if (!window.confirm("删除此照片及原图？此操作无法撤销。"))
                      return;
                    await api("photos/" + editing.id, "DELETE", undefined, {
                      "X-Photo-CSRF": csrf,
                    });
                    setEditing(undefined);
                    setTab("mine");
                    await refresh();
                  })
                }
              >
                删除照片
              </button>
              <img
                className="photo-edit-preview"
                src={"/api/v1/photos/" + editing.id + "/preview"}
                alt="当前修改的照片"
              />
            </div>
          ) : (
            <>
              <label>
                拍摄时间（可选）
                <input
                  type="datetime-local"
                  value={captured}
                  onChange={(e) => setCaptured(e.target.value)}
                />
              </label>
              <label>
                选择照片
                <input
                  type="file"
                  aria-label="选择实景照片"
                  accept=".jpg,.jpeg,.png,.webp,.heic,.heif"
                  disabled={progress !== null}
                  onChange={(e) => {
                    setFile(e.target.files?.[0]);
                    requestId.current = crypto.randomUUID();
                  }}
                />
              </label>
              <p className="photo-help">
                支持 JPG、PNG、WebP、HEIC／HEIF，单张 25 MB 以内。HEIC
                上传处理后显示预览。
              </p>
              <label className="photo-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                我确认可将此照片提供给校园重建项目。照片仅本人和维护者可见；会保留原图及其中可能包含的时间、设备和
                GPS 信息。
              </label>
              <div className="photo-row">
                <button
                  disabled={
                    !csrf ||
                    !usable ||
                    !file ||
                    !consent ||
                    progress !== null ||
                    heading! < 0 ||
                    heading! >= 360
                  }
                  onClick={() => void call(upload)}
                >
                  上传并预览
                </button>
                {progress !== null && (
                  <>
                    <progress max={100} value={progress} />
                    <span role="status">
                      {progress === 100 ? "正在生成预览…" : progress + "%"}
                    </span>
                    <button onClick={() => xhr.current?.abort()}>
                      取消上传
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
function PhotoCards({
  photos,
  onSelect,
}: {
  photos: PhotoRecord[];
  onSelect: (p: PhotoRecord) => void;
}) {
  return (
    <div className="photo-cards">
      {photos.map((p) => (
        <button key={p.id} onClick={() => onSelect(p)}>
          <img
            loading="lazy"
            src={"/api/v1/photos/" + p.id + "/preview"}
            alt={p.note || "校园实景照片"}
          />
          <strong>
            {p.pose.buildingId ?? "校园"} · {p.pose.floorName}
          </strong>
          <span>
            {p.pose.heading.toFixed(0)}° ·{" "}
            {
              { pending: "待处理", used: "已用于重建", declined: "暂不采用" }[
                p.status
              ]
            }
          </span>
        </button>
      ))}
    </div>
  );
}
function PhotoAdmin({ world }: { world: WorldMap }) {
  const [csrf, setCsrf] = useState(""),
    [user, setUser] = useState(""),
    [pass, setPass] = useState(""),
    [error, setError] = useState(""),
    [photos, setPhotos] = useState<PhotoRecord[]>([]),
    [selected, setSelected] = useState<PhotoRecord>(),
    [ids, setIds] = useState<string[]>([]);
  const [scene, setScene] = useState(""),
    [building, setBuilding] = useState(""),
    [status, setStatus] = useState(""),
    [since, setSince] = useState(""),
    [batches, setBatches] = useState<any[]>([]),
    [reviewNote, setReviewNote] = useState("");
  const headers = { "X-CSRF-Token": csrf };
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    const q = new URLSearchParams({
      sceneId: scene,
      buildingId: building,
      status,
      ...(since ? { since: String(new Date(since).getTime()) } : {}),
    });
    setPhotos(await api("admin/photos?" + q));
    setBatches(await api("admin/photo-batches"));
  };
  useEffect(() => {
    api("me")
      .then((r) => {
        if (r.user?.role === "admin") setCsrf(r.csrf);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (csrf) void run(refresh);
  }, [csrf, scene, building, status, since]);
  const exportPhotos = async () => {
    const r = await fetch("/api/v1/admin/photos/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        ids: ids.length
          ? ids
          : photos.slice(0, photoLimits.batch).map((p) => p.id),
      }),
    });
    if (!r.ok) throw new Error((await r.json()).message);
    saveBlob(
      await r.blob(),
      "photos-" + r.headers.get("X-Photo-Batch-ID") + ".zip",
    );
    await refresh();
  };
  const active = selected ? reproject(world, selected.pose) : null;
  return (
    <div>
      {error && (
        <p role="alert" className="photo-error">
          {error}
        </p>
      )}
      {!csrf ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api("auth/login", "POST", {
                username: user,
                password: pass,
              });
              setCsrf(r.csrf);
              setPass("");
            });
          }}
        >
          <h3>维护者登录</h3>
          <label>
            管理员用户名
            <input
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </label>
          <label>
            管理员密码
            <input
              autoComplete="current-password"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>
          <button>登录资料库</button>
        </form>
      ) : (
        <>
          <div className="photo-fields">
            <label>
              场景／楼层
              <select
                value={scene}
                onChange={(e) => {
                  setScene(e.target.value);
                  setIds([]);
                }}
              >
                <option value="">全部</option>
                {world.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              建筑
              <select
                value={building}
                onChange={(e) => {
                  setBuilding(e.target.value);
                  setIds([]);
                }}
              >
                <option value="">全部</option>
                {world.buildings.map((b) => (
                  <option key={b.id}>{b.id}</option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setIds([]);
                }}
              >
                <option value="">全部</option>
                <option value="pending">待处理</option>
                <option value="used">已用于重建</option>
                <option value="declined">暂不采用</option>
              </select>
            </label>
            <label>
              提交日期起
              <input
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </label>
          </div>
          <div className="photo-row">
            <button
              disabled={!photos.length}
              onClick={() => void run(exportPhotos)}
            >
              导出
              {ids.length
                ? "选中 " + ids.length + " 张"
                : "当前筛选（最多 20 张）"}
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await api("auth/logout", "POST", {}, headers);
                  setCsrf("");
                  setPhotos([]);
                  setSelected(undefined);
                  setBatches([]);
                })
              }
            >
              退出维护者
            </button>
          </div>
          {photos.map((p) => (
            <label key={p.id} className="photo-select">
              <input
                type="checkbox"
                checked={ids.includes(p.id)}
                onChange={(e) =>
                  setIds((v) =>
                    e.target.checked
                      ? [...v, p.id]
                      : v.filter((id) => id !== p.id),
                  )
                }
              />
              {p.pose.buildingId ?? "公共区"} · {p.pose.floorName} ·{" "}
              {p.id.slice(0, 8)}
            </label>
          ))}
          <PhotoCards
            photos={photos}
            onSelect={(p) => {
              setSelected(p);
              setReviewNote(p.maintenanceNote);
            }}
          />
          {(active || scene) && (
            <AnnotationMap
              scene={
                world.scenes.find((s) => s.id === (active?.sceneId ?? scene))!
              }
              point={active}
              heading={selected?.pose.heading ?? null}
              markers={photos.flatMap((p) => {
                const q = reproject(world, p.pose);
                return q && q.sceneId === (active?.sceneId ?? scene)
                  ? [{ id: p.id, point: q, onClick: () => setSelected(p) }]
                  : [];
              })}
            />
          )}
          {selected && (
            <section className="photo-detail">
              <h3>
                {selected.pose.floorName} · 朝向{" "}
                {selected.pose.heading.toFixed(1)}° · 仰俯{" "}
                {selected.pose.pitch ?? "未知"}
              </h3>
              {!active && <p>源位置无法对应当前地图，需人工核对。</p>}
              <img
                src={"/api/v1/photos/" + selected.id + "/preview"}
                alt="实景照片高清预览"
              />
              <p>{selected.note}</p>
              <a href={"/api/v1/photos/" + selected.id + "/original"}>
                下载原图
              </a>
              <p>{selected.appliedVersion ?? "尚未用于已合入的重建"}</p>
              <label>
                维护备注
                <textarea
                  maxLength={2000}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
              </label>
              <div className="photo-row">
                {(["pending", "declined"] as const).map((s) => (
                  <button
                    key={s}
                    disabled={selected.status === "used"}
                    onClick={() =>
                      void run(async () => {
                        const p = await api(
                          "admin/photos/" + selected.id,
                          "PATCH",
                          { status: s, note: reviewNote },
                          headers,
                        );
                        setSelected(p);
                        await refresh();
                      })
                    }
                  >
                    {s === "pending" ? "保存为待处理" : "暂不采用"}
                  </button>
                ))}
              </div>
            </section>
          )}
          <h3>重建批次</h3>
          <label>
            导入重建结果回执
            <input
              type="file"
              aria-label="导入重建结果回执"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    const receipt = JSON.parse(await file.text());
                    await api(
                      "admin/photo-batches/" + receipt.batchId + "/receipt",
                      "POST",
                      receipt,
                      headers,
                    );
                    await refresh();
                  });
                e.target.value = "";
              }}
            />
          </label>
          {batches.map((b) => (
            <div className="photo-batch" key={b.id}>
              <strong>{b.id}</strong>
              <p>
                {
                  (
                    {
                      pending: "待处理",
                      processing: "处理中",
                      review: "待审核",
                      merged: "已合入",
                      "needs-evidence": "需补充资料",
                      failed: "失败",
                    } as Record<string, string>
                  )[b.status]
                }
                {b.stale ? " · 标注已变化，结果过期" : ""}
              </p>
              {b.status === "pending" && !b.stale && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(
                        "admin/photo-batches/" + b.id + "/start",
                        "POST",
                        {},
                        headers,
                      );
                      await refresh();
                    })
                  }
                >
                  标记处理中
                </button>
              )}
              {b.status === "review" && !b.stale && (
                <button
                  onClick={() =>
                    void run(async () => {
                      const version = window.prompt("已审核并合入的地图版本");
                      if (!version) return;
                      await api(
                        "admin/photo-batches/" + b.id + "/merge",
                        "POST",
                        { version, confirm: true },
                        headers,
                      );
                      await refresh();
                    })
                  }
                >
                  确认已合入
                </button>
              )}
              {b.receipt && (
                <details>
                  <summary>查看逐张结果</summary>
                  <pre>{JSON.stringify(JSON.parse(b.receipt), null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
