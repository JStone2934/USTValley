import { recommendedTarget, type GuideTarget } from "../shared/guide";
import { useEffect, useState } from "react";
import { studentFrame, studentPalette } from "./avatar-art";
import {
  hats,
  outfits,
  tasks,
  campusNpcs,
  type Progress,
  type Npc,
  type OutfitId,
  type HatId,
} from "../shared/journey";
import type { WorldMap } from "../shared/world";
import type { ProgressStore, JourneySnapshot } from "./progress-store";

export function PixelPortrait({
  outfit = "clay",
  hat = "none",
  label = "校园旅人",
}: {
  outfit?: OutfitId;
  hat?: HatId;
  label?: string;
}) {
  const colors = outfits.find((o) => o.id === outfit)!.colors;
  const palette: Record<string, number> = {
    ...studentPalette,
    R: colors[0],
    J: colors[1],
    j: colors[2],
    A: colors[3],
  };
  const paths: Record<string, string> = {};
  studentFrame("down", 0, hat).forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const color = row[x];
      let end = x + 1;
      while (row[end] === color) end++;
      if (color !== ".")
        paths[color] =
          (paths[color] ?? "") + `M${x} ${y}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return (
    <svg
      className="pixel-portrait"
      viewBox="0 0 22 44"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      {Object.entries(paths).map(([key, d]) => (
        <path
          key={key}
          d={d}
          fill={`#${palette[key].toString(16).padStart(6, "0")}`}
        />
      ))}
    </svg>
  );
}
export function JourneyBook({
  progress,
  world,
  locate,
  navigate,
  sceneId,
}: {
  progress: Progress;
  world: WorldMap;
  locate?: (id: string, kind?: "building" | "npc") => void;
  navigate: (target: GuideTarget) => void;
  sceneId: string;
}) {
  const [tab, setTab] = useState<"tasks" | "stamps" | "friends">("tasks");
  return (
    <div className="journey-book">
      <div className="journal-summary">
        <div>
          <small>每一步，都是校园的一页</small>
          <strong>你的校园手账</strong>
        </div>
        <span className="coin-pill">✦ {progress.coins} 探索币</span>
      </div>
      <div className="journal-tabs" role="tablist" aria-label="手账分类">
        {[
          ["tasks", "探索任务"],
          ["stamps", "建筑印记"],
          ["friends", "校园朋友"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            aria-controls="journal-page"
            key={id}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {!locate && (
        <p className="journal-note">
          当前在室内，步行指引会带你经过出口、连廊或楼梯。回到室外后也可以单独查看镜头。
        </p>
      )}
      <div id="journal-page" role="tabpanel">
        {tab === "tasks" ? (
          <div className="quest-list">
            {tasks.map((task) => {
              const count = task.count(progress),
                done = progress.completed.includes(task.id);
              return (
                <article
                  key={task.id}
                  className={`quest-card ${done ? "complete" : ""}`}
                >
                  <span className="quest-seal">{done ? "✓" : "✦"}</span>
                  <div>
                    <h3>
                      {task.title}{" "}
                      <small>
                        {count}/{task.total}
                      </small>
                    </h3>
                    <p>{task.description}</p>
                    <progress max={task.total} value={count} />
                    <span className="quest-reward">
                      {done
                        ? "已收进手账"
                        : `奖励：${task.reward ? `${task.reward} 探索币 · ` : ""}${task.badge}`}
                    </span>
                    {!done &&
                      recommendedTarget(world, progress, sceneId, task.id) && (
                        <button
                          className="quest-track"
                          onClick={() =>
                            navigate(
                              recommendedTarget(
                                world,
                                progress,
                                sceneId,
                                task.id,
                              )!,
                            )
                          }
                        >
                          追踪 · {task.title}
                        </button>
                      )}
                  </div>
                </article>
              );
            })}
            <p className="journal-note">
              任务自动记录并发放奖励，无需领取。首次探索每栋建筑另得 5
              枚探索币。
            </p>
          </div>
        ) : tab === "stamps" ? (
          <>
            <p className="journal-note">
              走进建筑的绿色探索区，收下这一站的印记。已发现{" "}
              {progress.discovered.length}/15。
            </p>
            <div className="stamp-grid">
              {world.buildings.map((b) => {
                const found = progress.discovered.includes(b.id);
                return (
                  <div className="stamp-actions" key={b.id}>
                    <button
                      className={`building-stamp ${found ? "collected" : ""}`}
                      key={b.id}
                      onClick={() => navigate({ kind: "building", id: b.id })}
                      aria-label={`步行前往 ${b.id}`}
                    >
                      <strong>{b.id}</strong>
                      <span>{b.name}</span>
                      <small>{found ? "已探索 · +5 币" : "等待你的足迹"}</small>
                    </button>
                    {locate && (
                      <button
                        className="stamp-view"
                        onClick={() => locate(b.id)}
                      >
                        查看 {b.id}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="friend-list">
            {campusNpcs(world).map((n) => (
              <article className="friend-card" key={n.id}>
                <PixelPortrait outfit={n.outfit} hat={n.hat} label={n.name} />
                <div>
                  <h3>{n.name}</h3>
                  <p>{n.role}</p>
                  <small>
                    {progress.talked.includes(n.id)
                      ? "已经认识的校园朋友"
                      : "还没见面 · 在校园里等你"}
                  </small>
                  <button onClick={() => navigate({ kind: "npc", id: n.id })}>
                    步行前往 {n.name}
                  </button>
                  <button
                    disabled={!locate}
                    onClick={() => locate?.(n.id, "npc")}
                  >
                    查看 {n.destination} 附近
                  </button>
                </div>
              </article>
            ))}
            <p className="journal-note">
              以上为科大谷原创角色。进度保存在当前浏览器，不代表真实校园人员。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
export function Wardrobe({
  progress,
  store,
}: {
  progress: Progress;
  store: ProgressStore;
}) {
  return (
    <div className="wardrobe">
      <div className="wardrobe-preview">
        <PixelPortrait outfit={progress.outfit} hat={progress.hat} />
        <strong>今天，穿这身去散步</strong>
        <span className="coin-pill">✦ {progress.coins} 探索币</span>
        <p>服装只改变外观，所有地点都可以自由探索。</p>
      </div>
      <div className="wardrobe-items">
        {(["outfit", "hat"] as const).map((kind) => (
          <section key={kind}>
            <h3>{kind === "outfit" ? "外套配色" : "帽子收藏"}</h3>
            <div className="cosmetic-grid">
              {(kind === "outfit" ? outfits : hats).map((item) => {
                const owned = (
                    kind === "outfit"
                      ? progress.ownedOutfits
                      : progress.ownedHats
                  ).includes(item.id),
                  equipped = progress[kind] === item.id;
                return (
                  <article
                    className={`cosmetic-card ${equipped ? "equipped" : ""}`}
                    key={item.id}
                  >
                    <PixelPortrait
                      outfit={
                        kind === "outfit"
                          ? (item.id as OutfitId)
                          : progress.outfit
                      }
                      hat={kind === "hat" ? (item.id as HatId) : progress.hat}
                      label={item.name}
                    />
                    <strong>{item.name}</strong>
                    <button
                      disabled={
                        equipped || (!owned && progress.coins < item.cost)
                      }
                      onClick={() =>
                        store.act({ type: "wear", kind, id: item.id })
                      }
                      aria-label={`${owned ? "穿上" : "解锁"} ${item.name}`}
                    >
                      {equipped
                        ? "正在穿戴"
                        : owned
                          ? "换上这件"
                          : `解锁 · ${item.cost} 币`}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
export function NpcDialogue({ npc, close }: { npc: Npc; close: () => void }) {
  const [page, setPage] = useState(0);
  return (
    <div className="npc-dialogue">
      <div className="npc-portrait">
        <PixelPortrait outfit={npc.outfit} hat={npc.hat} label={npc.name} />
        <small>原创校园角色</small>
      </div>
      <div className="npc-speech">
        <span className="eyebrow">{npc.role}</span>
        <h3>{npc.name}</h3>
        <p>{npc.lines[page]}</p>
        <div className="dialogue-actions">
          <small>
            {page + 1} / {npc.lines.length}
          </small>
          <button
            autoFocus
            onClick={() =>
              page < npc.lines.length - 1 ? setPage(page + 1) : close()
            }
          >
            {page < npc.lines.length - 1 ? "继续聊聊 →" : "这就去看看"}
          </button>
        </div>
      </div>
    </div>
  );
}
function Notice({
  notice,
  store,
}: {
  notice: JourneySnapshot["notices"][number];
  store: ProgressStore;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => store.dismiss(notice.id), 6000);
    return () => clearTimeout(timer);
  }, [notice.id, store]);
  return (
    <div className="reward-toast">
      <span>✦</span>
      <p>{notice.text}</p>
      <button
        aria-label="收起奖励提示"
        onClick={() => store.dismiss(notice.id)}
      >
        ×
      </button>
    </div>
  );
}
export function JourneyNotices({
  snapshot,
  store,
}: {
  snapshot: JourneySnapshot;
  store: ProgressStore;
}) {
  return (
    <div className="journey-notices" aria-live="polite" aria-atomic="false">
      {snapshot.notices.slice(-2).map((notice) => (
        <Notice key={notice.id} notice={notice} store={store} />
      ))}
    </div>
  );
}
export function nextStep(p: Progress) {
  if (!p.talked.includes("lin")) return "和身旁的林同学打个招呼 · 按 E 交谈";
  if (!p.discovered.includes("C2")) return "第一站：走进 C2，寻找绿色探索标记";
  if (!p.chestsOpened) return "找一只木宝箱，靠近后按 E 打开";
  if (p.ownedOutfits.length === 1)
    return "探索币攒起来了，去衣橱换一件新外套吧";
  if (p.discovered.length < 5)
    return `继续散步，收集五栋建筑印记 · ${p.discovered.length}/5`;
  return "寻找校园朋友、观察日晷，收齐十五枚建筑印记";
}
