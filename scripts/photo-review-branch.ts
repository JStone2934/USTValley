import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { PHOTO_REVIEW_BRANCH } from "../src/shared/photo-review-branch.ts";

export function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed:\n${r.stderr}\n${r.stdout}`);
  return r.stdout.trim();
}
export function ancestor(cwd: string, from: string, to: string) {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", from, to], {
    cwd,
    encoding: "utf8",
  });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error("Cannot inspect review ancestry: " + r.stderr);
}
export function reviewTip(cwd: string) {
  // A single remote ref is the queue; FETCH_HEAD is shared by worktrees and
  // can be changed by unrelated fetches, so resolve the explicit tracking ref.
  const ref = `refs/remotes/origin/${PHOTO_REVIEW_BRANCH}`;
  git(cwd, [
    "fetch",
    "--no-tags",
    "origin",
    `refs/heads/${PHOTO_REVIEW_BRANCH}:${ref}`,
  ]);
  return git(cwd, ["rev-parse", ref]);
}
export function cleanTask(cwd: string) {
  let link = false;
  try {
    link = lstatSync(join(cwd, "node_modules")).isSymbolicLink();
  } catch {}
  if (
    git(cwd, ["status", "--porcelain"])
      .split("\n")
      .filter(Boolean)
      .some((line) => !(link && line === "?? node_modules"))
  )
    throw new Error(
      "Commit or preserve task changes before updating the shared review baseline",
    );
}
export function createReviewWorktree(
  repo: string,
  worktree: string,
  base: string,
) {
  git(repo, ["worktree", "add", "--detach", worktree, base]);
}
export function refreshReviewWorktree(cwd: string, baseline: string) {
  cleanTask(cwd);
  if (git(cwd, ["branch", "--show-current"]))
    throw new Error(
      "Refresh requires the detached task worktree created by prepare",
    );
  const tip = reviewTip(cwd),
    head = git(cwd, ["rev-parse", "HEAD"]);
  if (!ancestor(cwd, baseline, head))
    throw new Error("Task history no longer contains its baseline");
  if (tip === baseline) return { changed: false, tip, head };
  try {
    git(cwd, ["rebase", "--onto", tip, baseline]);
  } catch (e) {
    git(cwd, ["rebase", "--abort"]);
    throw new Error(
      "Shared review conflicts with this task; original commit retained. Resolve in the isolated worktree and reverify.\n" +
        String(e),
    );
  }
  return { changed: true, tip, head: git(cwd, ["rev-parse", "HEAD"]) };
}
export function deliverReviewCommit(
  cwd: string,
  baseline: string,
  commit: string,
  publish: boolean,
) {
  const tip = reviewTip(cwd);
  if (!ancestor(cwd, baseline, commit))
    throw new Error("Result does not contain the task baseline");
  if (ancestor(cwd, commit, tip)) return tip; // Safe retry after a successful push.
  if (tip !== baseline)
    throw new Error(
      "Shared review advanced; rerun prepare with the same bundle and --refresh, recapture evidence, and run full verify before reporting",
    );
  if (!publish)
    throw new Error(
      "Result is not on the shared review branch; use report --publish after validation",
    );
  // Never force-push: if another batch lands after our fetch, Git rejects us.
  git(cwd, ["push", "origin", `${commit}:refs/heads/${PHOTO_REVIEW_BRANCH}`]);
  const after = reviewTip(cwd);
  if (!ancestor(cwd, commit, after))
    throw new Error("Shared review does not contain the delivered commit");
  return after;
}
