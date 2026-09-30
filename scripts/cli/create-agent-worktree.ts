#!/usr/bin/env bun
import {resolve} from "node:path";
import {defaultRepoRoot, git, gitBranch, governanceRoots, primaryCheckoutRoot, verifyMonorepoWorktreeLayout} from "#scripts/ci/agent-governance-contract";

/** 待清理的判定基准：worktree 的分支已是本地 master 的祖先即视为已合入。 */
const MERGED_INTO = "refs/heads/master";

const args = process.argv.slice(2);
const repoArgument = args.indexOf("--repo-root");
const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
const roots = governanceRoots(repoRoot);
const worktrees = git(repoRoot, ["worktree", "list", "--porcelain"]);
const entries = worktrees.split(/\n\n/u).filter(Boolean).map((block) => Object.fromEntries(block.split(/\r?\n/u).map((line) => {
    const separator = line.indexOf(" ");
    return separator < 0 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
})));
const failures = verifyMonorepoWorktreeLayout(repoRoot);
const mergedBranches = new Set<string>();
for (const entry of entries) {
    const branch = typeof entry.branch === "string" ? entry.branch : null;
    if (branch === null || branch === MERGED_INTO) continue;
    try {
        git(repoRoot, ["merge-base", "--is-ancestor", branch, MERGED_INTO]);
        mergedBranches.add(branch);
    } catch {
        // 未合入，或 master/revision 不可解析：保持未标记，不臆断为已合入。
    }
}
// 已合入 master 的 worktree 只被标记为待清理；删除仍需开发者授权，本报告不执行任何清理。
const reported = entries.map((entry) => ({...entry, cleanup: typeof entry.branch === "string" && mergedBranches.has(entry.branch) ? "待清理" : null}));
console.log(JSON.stringify({
    schema: "nbook.governance-worktree/v1",
    repoRoot,
    primaryCheckoutRoot: primaryCheckoutRoot(repoRoot),
    branch: gitBranch(repoRoot),
    configuredRoot: roots.worktreeRoot,
    mergedInto: MERGED_INTO,
    failures,
    current: reported.find((entry) => entry.worktree === repoRoot) ?? null,
    worktrees: reported,
}, null, 2));
if (failures.length > 0) process.exitCode = 1;
