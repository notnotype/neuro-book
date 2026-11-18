#!/usr/bin/env bun
/**
 * 发版前的准备提交（`bun run release:prepare <版本> [--stage canary|preview]`，ADR 0053；流程见 docs/standards/releasing.md 的“发版”）。
 *
 * 在与 origin 同步的 master 上：改产品版本（应用 `package.json`、`PRODUCT_VERSION`）与阶段（`PRODUCT_STAGE`），把应用与
 * 这次提了版本号的源码包的 CHANGELOG 定稿（`[Unreleased]` → `[<各自的版本>] - <今天>`），刷新 `bun.lock`，提交
 * `release: v<版本>`。不打标签、不推送：推送与打标签由开发者做（标签规则集只允许开发者建 `v*`）。
 *
 * 源码包的版本照 ADR 0029 手工提（改它的 `package.json` 并先提交）：提了版本号就是“这个包这次发”。与上一个桌面版本相比
 * 版本号升了的包要有 CHANGELOG、`[Unreleased]` 有条目；版本没变而 `[Unreleased]` 有条目的，留到它下次提版；版本降了的停下。
 * “上一个桌面版本”与发布流水线的门禁同一个来源：GitHub 上低于本次、有安装包的最高稳定版本（`previousDesktopRelease`），
 * 不用本地最高的标签：推了标签而没发出 Release 的版本不算（要本机的 `gh` 已登录）。
 *
 * 先只读收集并检查全部，有一项不过就不写任何文件；全部通过才写入。写入之后的任何一步（刷新 `bun.lock`、重新解析、
 * `git add` 与 `git commit`）失败，都把写过的文件与 `bun.lock` 还原成原来的字节、撤掉暂存，再报错。
 */

import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {finalizeUnreleased, isEmpty, parseChangelog, ChangelogError} from "#scripts/release/changelog";
import {GitHubReleases, hasDesktopSetup, previousDesktopRelease, spawnRun} from "#scripts/release/github-release";
import {RELEASE_PACKAGES, releaseDirectories} from "#scripts/release/packages";
import {compareVersions} from "#scripts/release/semver";
import {sourceVersions, type ReleaseStage} from "#scripts/release/tag";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const APP_PACKAGE_JSON = "packages/neuro-book/package.json";
const PRODUCT_TS = "packages/neuro-book/src/shared/product.ts";
const APP_CHANGELOG = "packages/neuro-book/CHANGELOG.md";

export type PrepareState = {
    branch: string;
    /** HEAD 包含刚取到的 origin/master。 */
    containsOrigin: boolean;
    /** 会发布的目录与 `bun.lock` 里没提交的改动（`git status --porcelain` 的行）。 */
    dirty: readonly string[];
    version: string;
    stage: string;
    /** 上一个桌面版本的标签（与门禁相同：GitHub 上低于目标、有安装包的最高稳定版本）；第一次发布没有。 */
    previousTag: string | null;
    appPackageJson: string;
    product: string;
    appChangelog: string;
    packages: readonly {dir: string; version: string; previousVersion: string | null; changelog: string | null}[];
};

export type PreparePlan = {writes: {path: string; text: string}[]; problems: string[]; notices: string[]};

function replaceOnce(text: string, from: string, to: string, path: string, problems: string[]): string {
    if (text.split(from).length !== 2) {
        problems.push(`${path} 里 ${from} 不是正好一处`);
        return text;
    }
    return text.replace(from, to);
}

/** 只读：按收集到的状态算出要写的文件、问题与提示。有问题时调用方什么都不写。 */
export function preparePlan(state: PrepareState, target: {version: string; stage: ReleaseStage; date: string}): PreparePlan {
    const problems: string[] = [];
    const notices: string[] = [];
    const writes: {path: string; text: string}[] = [];
    if (state.branch !== "master") problems.push(`当前在 ${state.branch} 上：发版提交只在 master 上做`);
    if (!state.containsOrigin) problems.push("HEAD 不包含 origin/master：先把 master 同步到 origin（git pull --ff-only）");
    if (state.dirty.length > 0) problems.push(`会发布的目录或 bun.lock 有没提交的改动（源码包提版要先提交）：\n${state.dirty.join("\n")}`);
    if (!STABLE_VERSION.test(target.version)) problems.push(`版本 ${target.version} 不是纯数字的三段版本（阶段不写进版本号，用 --stage）`);
    else if (compareVersions(target.version, state.version) <= 0) problems.push(`版本 ${target.version} 不高于现在的 ${state.version}`);
    if (target.stage === "stable") problems.push("stable 的发布规则还没实现（ADR 0053），现在只能发 canary 或 preview");
    if (state.stage === "preview" && target.stage === "canary") notices.push("阶段从 preview 回到 canary：确认这是有意的");

    const finalize = (path: string, text: string, version: string) => {
        try {
            writes.push({path, text: finalizeUnreleased(text, version, target.date, path)});
        } catch (error) {
            if (!(error instanceof ChangelogError)) throw error;
            problems.push(error.message);
        }
    };

    const packageJson = replaceOnce(state.appPackageJson, `"version": "${state.version}"`, `"version": "${target.version}"`, APP_PACKAGE_JSON, problems);
    let product = replaceOnce(state.product, `export const PRODUCT_VERSION = "${state.version}";`, `export const PRODUCT_VERSION = "${target.version}";`, PRODUCT_TS, problems);
    product = replaceOnce(product, `export const PRODUCT_STAGE: ProductStage = "${state.stage}";`, `export const PRODUCT_STAGE: ProductStage = "${target.stage}";`, PRODUCT_TS, problems);
    writes.push({path: APP_PACKAGE_JSON, text: packageJson}, {path: PRODUCT_TS, text: product});
    finalize(APP_CHANGELOG, state.appChangelog, target.version);

    // 第一次发布（没有上一个标签）时源码包没有比较的基准，不定稿。
    for (const entry of state.previousTag === null ? [] : state.packages) {
        const path = `packages/${entry.dir}/CHANGELOG.md`;
        if (entry.previousVersion !== null && compareVersions(entry.version, entry.previousVersion) < 0) {
            problems.push(`packages/${entry.dir} 的版本从 ${entry.previousVersion} 降到了 ${entry.version}：源码包的版本只升不降（ADR 0029）`);
            continue;
        }
        if (entry.version === entry.previousVersion) {
            if (entry.changelog !== null && !isEmpty(parseChangelog(entry.changelog, path).unreleased)) notices.push(`${path} 的 [Unreleased] 有条目，但版本没提（仍是 ${entry.version}）：留到它下次提版`);
            continue;
        }
        if (entry.changelog === null) {
            problems.push(`packages/${entry.dir} 的版本从 ${entry.previousVersion ?? "（新包）"} 提到了 ${entry.version}，没有 ${path}：先建它并写上这次的变化`);
            continue;
        }
        // 已经有这个版本的段（例如这个包在别的发布里先定稿过）：不再定稿。
        if (parseChangelog(entry.changelog, path).releases.some((release) => release.version === entry.version)) {
            notices.push(`${path} 已有 [${entry.version}]，不再定稿`);
            continue;
        }
        finalize(path, entry.changelog, entry.version);
    }
    return {writes: problems.length > 0 ? [] : writes, problems, notices};
}

function git(args: readonly string[]): {code: number; stdout: string; stderr: string} {
    const result = spawnSync("git", [...args], {cwd: REPOSITORY, encoding: "utf8"});
    return {code: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim()};
}

function mustGit(args: readonly string[]): string {
    const result = git(args);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")} 失败：${result.stderr || result.stdout}`);
    return result.stdout;
}

function read(path: string): string {
    return readFileSync(join(REPOSITORY, path), "utf8");
}

/** `owner/name`：`GITHUB_REPOSITORY`，否则从 origin 的地址取（`git@github.com:o/n.git` 或 `https://github.com/o/n`）。 */
function repositoryName(): string {
    if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
    const url = mustGit(["remote", "get-url", "origin"]);
    const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(url);
    if (match === null) throw new Error(`origin（${url}）不是 GitHub 上的仓库，设 GITHUB_REPOSITORY=<owner/name>`);
    return match[1] as string;
}

/** 只读地收集仓库状态（会先取 origin 的 master 与标签，再经 `gh` 读 Release 列表）。 */
async function collectState(target: string): Promise<PrepareState> {
    mustGit(["fetch", "--quiet", "--tags", "origin", "master"]);
    const source = sourceVersions(REPOSITORY);
    const stage = /export const PRODUCT_STAGE: ProductStage = "([^"]+)";/.exec(read(PRODUCT_TS))?.[1] ?? "";
    let previousTag: string | null = null;
    if (STABLE_VERSION.test(target)) {
        const github = new GitHubReleases(spawnRun, repositoryName());
        previousTag = await previousDesktopRelease(target, await github.list(), async (tag) => hasDesktopSetup(await github.assets(tag)));
    }
    return {
        branch: mustGit(["rev-parse", "--abbrev-ref", "HEAD"]),
        containsOrigin: git(["merge-base", "--is-ancestor", "origin/master", "HEAD"]).code === 0,
        dirty: mustGit(["status", "--porcelain", "--untracked-files=all", "--", ...releaseDirectories(), "bun.lock"]).split("\n").filter((line) => line !== ""),
        version: source.packageJson,
        stage,
        previousTag,
        appPackageJson: read(APP_PACKAGE_JSON),
        product: read(PRODUCT_TS),
        appChangelog: read(APP_CHANGELOG),
        packages: RELEASE_PACKAGES.map((dir) => {
            const version = (JSON.parse(read(`packages/${dir}/package.json`)) as {version: string}).version;
            const shown = previousTag === null ? null : git(["show", `${previousTag}:packages/${dir}/package.json`]);
            const previousVersion = shown !== null && shown.code === 0 ? (JSON.parse(shown.stdout) as {version: string}).version : null;
            const changelogPath = join(REPOSITORY, "packages", dir, "CHANGELOG.md");
            return {dir, version, previousVersion, changelog: existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null};
        }),
    };
}

class UsageError extends Error {}

async function main(argv: readonly string[]): Promise<number> {
    const parse = () => parseArgs({args: [...argv], options: {stage: {type: "string"}}, allowPositionals: true});
    let parsed: ReturnType<typeof parse>;
    try {
        parsed = parse();
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    const [version, ...extra] = parsed.positionals;
    const stage = parsed.values.stage;
    if (version === undefined || extra.length > 0 || (stage !== undefined && stage !== "canary" && stage !== "preview")) {
        throw new UsageError("用法：bun run release:prepare <版本> [--stage canary|preview]（缺省沿用现在的阶段）");
    }
    const state = await collectState(version);
    const date = new Date().toISOString().slice(0, 10);
    console.log(`上一个桌面版本：${state.previousTag ?? "没有（第一次发布）"}`);
    const plan = preparePlan(state, {version, stage: (stage ?? state.stage) as ReleaseStage, date});
    for (const notice of plan.notices) console.log(`提示：${notice}`);
    if (plan.problems.length > 0) {
        for (const problem of plan.problems) console.error(`✗ ${problem}`);
        console.error("没有改任何文件。");
        return 1;
    }
    const paths = [...plan.writes.map((write) => write.path), "bun.lock"];
    // 写之前记下原来的字节（这些文件都已提交、没有改动，见 dirty 检查），后面任何一步失败都还原。
    const originals = new Map(paths.map((path) => [path, readFileSync(join(REPOSITORY, path))]));
    try {
        for (const write of plan.writes) writeFileSync(join(REPOSITORY, write.path), write.text);
        // 工作区包的版本记在 bun.lock 里：不刷新，CI 的 --frozen-lockfile 会失败。
        const lock = spawnSync("bun", ["install", "--lockfile-only"], {cwd: REPOSITORY, stdio: "inherit"});
        if (lock.status !== 0) throw new Error(`bun install --lockfile-only 失败（退出码 ${String(lock.status)}）`);
        for (const write of plan.writes) if (write.path.endsWith("CHANGELOG.md")) parseChangelog(read(write.path), write.path);
        mustGit(["add", "--", ...paths]);
        mustGit(["commit", "--quiet", "-m", `release: v${version}`, "--", ...paths]);
    } catch (error) {
        for (const [path, bytes] of originals) writeFileSync(join(REPOSITORY, path), bytes);
        const unstaged = git(["reset", "--quiet", "--", ...paths]);
        console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
        console.error(unstaged.code === 0 ? `已把 ${paths.join("、")} 还原成原来的样子，没有提交。` : `文件已还原，撤掉暂存失败（${unstaged.stderr}）：用 git status 核对暂存区。`);
        return 1;
    }
    console.log(`✓ 提交了 release: v${version}（${paths.join("、")}）`);
    console.log(`下一步：git push origin master；再由开发者打标签：git tag v${version} && git push origin v${version}`);
    return 0;
}

if (import.meta.main) {
    try {
        process.exitCode = await main(Bun.argv.slice(2));
    } catch (error) {
        console.error(error instanceof UsageError ? error.message : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
