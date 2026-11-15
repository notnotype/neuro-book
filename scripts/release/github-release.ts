#!/usr/bin/env bun
/**
 * 桌面版的 GitHub Release（`.github/workflows/release.yml` 的 `gate` 与 `github-release` 作业；docs/proposals/desktop-distribution.md 4.8）。
 * 经 `gh` CLI 调用（runner 自带，令牌是作业的 `GITHUB_TOKEN`），调用经注入的 `run` 端口，单测用记录调用的替身。
 *
 * - `draft <版本> <资产目录>`：没有这个标签的 Release 就建草稿；只上传缺的资产，同名资产的摘要与本地不同就失败；已公开的只核对。
 * - `publish <版本> <资产目录>`：资产齐全、摘要一致后公开；公开与是否设为最新在同一个请求里定（草稿不能设为最新，
 *   公开时不带 `make_latest` 会缺省设为最新）。已公开的只核对，必要时补设最新，不撤掉已有的标记。
 * - `previous <版本>`：上一个正式桌面版本的标签（Release 历史里低于本次、有正式 Setup 资产的最高稳定版本），打 `previous=<标签>`，
 *   没有时 `previous=`。不从可变的“最新”推断，整轮重跑时得到同一个。
 *
 * 只升不降、不往回拨“最新”：本次版本不低于当前最新时才设为最新（当前最新就是本次时按应为最新处理，重跑时不撤）。
 * 退出码：0 通过；1 失败（原因在 stderr）；2 用法错误。
 */

import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {sha256Of} from "#scripts/release/manifest";
import {compareVersions} from "#scripts/release/semver";

export class ReleaseFailure extends Error {}
class UsageError extends Error {}

export type RunResult = {code: number; stdout: string; stderr: string};
export type Run = (argv: readonly string[]) => Promise<RunResult>;

/** `gh release list --json tagName,isDraft,isPrerelease,isLatest` 的一项。 */
export type ReleaseSummary = {tagName: string; isDraft: boolean; isPrerelease: boolean; isLatest: boolean};
/** `gh release view --json assets` 的一项里用到的字段；`digest` 形如 `sha256:<64 位十六进制>`，资产没传完时可能没有。 */
export type ReleaseAsset = {name: string; digest?: string | null; state?: string};

export const SETUP_ASSET = "win-x64-NeuroBook-Setup.zip";
export const SUMS_ASSET = "SHA256SUMS";
const PATCH_ASSET = /^stable-win-x64-[a-z0-9]{1,13}\.patch$/;

/** 每个桌面 Release 都有的资产；补丁另按 `stable-win-x64-<上一版哈希>.patch` 认，可以没有。 */
export function requiredAssets(version: string): string[] {
    return [
        SETUP_ASSET,
        `NeuroBook-${version}-win-x64-portable.zip`,
        "stable-win-x64-NeuroBook.tar.zst",
        "stable-win-x64-update.json",
        "stable-win-x64-update-v2.json",
        SUMS_ASSET,
    ];
}

/**
 * 本地资产目录（`release-assets/`，由桌面作业冻结）的问题：缺必有的、多了不认识的、`SHA256SUMS` 与文件对不上。
 * `local` 是文件名到 SHA-256；`sums` 是 `SHA256SUMS` 的内容（`<64 位十六进制>  <文件名>` 每行一个，覆盖除它以外的全部）。
 */
export function localAssetProblems(version: string, local: ReadonlyMap<string, string>, sums: string): string[] {
    const problems: string[] = [];
    const required = requiredAssets(version);
    for (const name of required) if (!local.has(name)) problems.push(`资产目录里缺 ${name}`);
    for (const name of local.keys()) if (!required.includes(name) && !PATCH_ASSET.test(name)) problems.push(`资产目录里有不认识的文件 ${name}`);
    const listed = new Map<string, string>();
    for (const line of sums.split("\n")) {
        if (line.trim() === "") continue;
        const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
        if (match === null) problems.push(`SHA256SUMS 的一行读不懂：${line}`);
        else listed.set(match[2]!, match[1]!);
    }
    for (const [name, digest] of local) {
        if (name === SUMS_ASSET) continue;
        if (listed.get(name) !== digest) problems.push(`SHA256SUMS 里 ${name} 的摘要${listed.has(name) ? "与文件不同" : "没有列出"}`);
    }
    for (const name of listed.keys()) if (!local.has(name)) problems.push(`SHA256SUMS 列了不在资产目录里的 ${name}`);
    return problems;
}

/** 远端已有的资产与本地比：要上传的（远端没有的）与问题（同名摘要不同、没传完、远端多出的）。 */
export function assetUploads(local: ReadonlyMap<string, string>, remote: readonly ReleaseAsset[]): {upload: string[]; problems: string[]} {
    const problems: string[] = [];
    const present = new Set<string>();
    for (const asset of remote) {
        present.add(asset.name);
        const expected = local.get(asset.name);
        if (expected === undefined) problems.push(`Release 上多了本地没有的资产 ${asset.name}`);
        else if (asset.state !== undefined && asset.state !== "uploaded") problems.push(`Release 上的 ${asset.name} 没有传完（${asset.state}）：在 GitHub 上删掉它再重跑`);
        else if (asset.digest !== `sha256:${expected}`) problems.push(`Release 上的 ${asset.name} 与本地的摘要不同（${asset.digest ?? "没有摘要"}）：不是同一次构建的，停下`);
    }
    return {upload: [...local.keys()].filter((name) => !present.has(name)), problems};
}

/** 本次版本该不该是最新：没有最新、或当前最新不高于本次（等于时是重跑，不撤）。当前最新可以是旧应用带预发布段的标签。 */
export function shouldBeLatest(version: string, currentLatest: string | null): boolean {
    return currentLatest === null || compareVersions(version, currentLatest) >= 0;
}

/** 当前最新的标签；没有 Release 时为 null。 */
export function latestTag(releases: readonly ReleaseSummary[]): string | null {
    return releases.find((release) => release.isLatest)?.tagName ?? null;
}

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * 上一个正式桌面版本：公开的、稳定版本标签、低于本次的 Release，从高往低找第一个有正式 Setup 资产的（旧应用的 Release 没有）。
 * `hasSetup` 读一个 Release 的资产。
 */
export async function previousDesktopRelease(version: string, releases: readonly ReleaseSummary[], hasSetup: (tag: string) => Promise<boolean>): Promise<string | null> {
    const candidates = releases
        .filter((release) => !release.isDraft && !release.isPrerelease && STABLE_TAG.test(release.tagName) && compareVersions(release.tagName, version) < 0)
        .map((release) => release.tagName)
        .sort((left, right) => compareVersions(right, left));
    for (const tag of candidates) if (await hasSetup(tag)) return tag;
    return null;
}

/** 调 `gh` 的那几步。`repo` 是 `owner/name`。 */
export class GitHubReleases {
    constructor(private readonly run: Run, private readonly repo: string) {}

    async #gh(args: readonly string[]): Promise<string> {
        const result = await this.run(["gh", ...args, "--repo", this.repo]);
        if (result.code !== 0) throw new ReleaseFailure(`gh ${args.slice(0, 2).join(" ")} 失败（退出码 ${result.code}）：${result.stderr.trim() || result.stdout.trim()}`);
        return result.stdout;
    }

    /** 全部 Release（含草稿；作业的令牌有写权限才看得到草稿）。按列表判断有没有，不按 `gh release view` 的错误文字。 */
    async list(): Promise<ReleaseSummary[]> {
        return JSON.parse(await this.#gh(["release", "list", "--limit", "1000", "--json", "tagName,isDraft,isPrerelease,isLatest"])) as ReleaseSummary[];
    }

    async assets(tag: string): Promise<ReleaseAsset[]> {
        return (JSON.parse(await this.#gh(["release", "view", tag, "--json", "assets"])) as {assets: ReleaseAsset[]}).assets;
    }

    async createDraft(tag: string, title: string, notesFile: string): Promise<void> {
        // --verify-tag：标签不在远端时不让 gh 顺手建一个。
        await this.#gh(["release", "create", tag, "--draft", "--verify-tag", "--title", title, "--notes-file", notesFile]);
    }

    async upload(tag: string, paths: readonly string[]): Promise<void> {
        // 不带 --clobber：同名资产不覆盖，摘要不同已在 assetUploads 里拦下。
        await this.#gh(["release", "upload", tag, ...paths]);
    }

    async publish(tag: string, latest: boolean): Promise<void> {
        await this.#gh(["release", "edit", tag, "--draft=false", `--latest=${String(latest)}`]);
    }

    async markLatest(tag: string): Promise<void> {
        await this.#gh(["release", "edit", tag, "--latest"]);
    }
}

/** 读冻结的资产目录：文件名到 SHA-256；缺必有的、多了不认识的、SHA256SUMS 对不上时抛出。 */
export async function readLocalAssets(version: string, directory: string): Promise<Map<string, string>> {
    const local = new Map<string, string>();
    for (const name of (await readdir(directory)).sort()) local.set(name, await sha256Of(join(directory, name)));
    const problems = localAssetProblems(version, local, local.has(SUMS_ASSET) ? await readFile(join(directory, SUMS_ASSET), "utf8") : "");
    if (problems.length > 0) throw new ReleaseFailure(problems.join("\n"));
    return local;
}

const NOTES_TEMPLATE = new URL("./desktop-release-notes.md", import.meta.url);

/** 草稿：建、补资产。已经公开的 Release 只核对，不上传。 */
export async function draftRelease(github: GitHubReleases, version: string, directory: string, log: (line: string) => void = console.log): Promise<void> {
    const tag = `v${version}`;
    const local = await readLocalAssets(version, directory);
    const existing = (await github.list()).find((release) => release.tagName === tag);
    if (existing === undefined) {
        const notes = join(tmpdir(), `nbook-release-notes-${version}-${process.pid}.md`);
        await writeFile(notes, (await readFile(NOTES_TEMPLATE, "utf8")).replaceAll("{{version}}", version));
        try {
            await github.createDraft(tag, `NeuroBook ${version}`, notes);
        } finally {
            await rm(notes, {force: true});
        }
        log(`✓ 建了草稿 ${tag}`);
    }
    const {upload, problems} = assetUploads(local, existing === undefined ? [] : await github.assets(tag));
    if (problems.length > 0) throw new ReleaseFailure(problems.join("\n"));
    if (existing !== undefined && !existing.isDraft) {
        if (upload.length > 0) throw new ReleaseFailure(`${tag} 已经公开，却缺资产 ${upload.join("、")}：公开的 Release 不再补传，人工处理`);
        log(`✓ ${tag} 已经公开，资产齐全、摘要一致`);
        return;
    }
    if (upload.length > 0) await github.upload(tag, upload.map((name) => join(directory, name)));
    log(`✓ ${tag} 的资产：上传 ${upload.length} 个，已有 ${local.size - upload.length} 个摘要一致`);
}

/** 公开：资产齐全、摘要一致之后，同一个请求里公开并定是否设为最新。 */
export async function publishRelease(github: GitHubReleases, version: string, directory: string, log: (line: string) => void = console.log): Promise<{latest: boolean}> {
    const tag = `v${version}`;
    const local = await readLocalAssets(version, directory);
    const releases = await github.list();
    const existing = releases.find((release) => release.tagName === tag);
    if (existing === undefined) throw new ReleaseFailure(`没有 ${tag} 的 Release：先跑 draft`);
    const {upload, problems} = assetUploads(local, await github.assets(tag));
    if (upload.length > 0) problems.push(`${tag} 还缺资产 ${upload.join("、")}：先跑 draft`);
    if (problems.length > 0) throw new ReleaseFailure(problems.join("\n"));
    const current = latestTag(releases);
    const latest = shouldBeLatest(version, current);
    if (existing.isDraft) {
        await github.publish(tag, latest);
        log(`✓ 公开了 ${tag}${latest ? "，设为最新" : `，不设为最新（当前最新是 ${current ?? "无"}）`}`);
    } else if (latest && current !== tag) {
        // 上一次公开成功了、设最新没有落下（或别处改过）：补设。不撤：当前最新更高时 latest 已是 false。
        await github.markLatest(tag);
        log(`✓ ${tag} 已经公开，补设为最新（之前是 ${current ?? "无"}）`);
    } else {
        log(`✓ ${tag} 已经公开${current === tag ? "，是最新" : `，当前最新是 ${current ?? "无"}`}`);
    }
    return {latest};
}

async function spawnRun(argv: readonly string[]): Promise<RunResult> {
    const child = Bun.spawn([...argv], {stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

async function main(argv: readonly string[]): Promise<void> {
    const [command, version, directory, ...extra] = argv;
    const repo = process.env.GITHUB_REPOSITORY;
    const usage = "用法：bun scripts/release/github-release.ts draft|publish <版本> <资产目录> | previous <版本>（仓库取自 GITHUB_REPOSITORY）";
    if (repo === undefined || repo === "" || version === undefined || extra.length > 0) throw new UsageError(usage);
    const github = new GitHubReleases(spawnRun, repo);
    if (command === "previous" && directory === undefined) {
        const previous = await previousDesktopRelease(version, await github.list(), async (tag) => (await github.assets(tag)).some((asset) => asset.name === SETUP_ASSET));
        console.log(`previous=${previous ?? ""}`);
        return;
    }
    if (directory === undefined) throw new UsageError(usage);
    if (command === "draft") await draftRelease(github, version, directory);
    else if (command === "publish") await publishRelease(github, version, directory);
    else throw new UsageError(usage);
}

if (import.meta.main) {
    try {
        await main(Bun.argv.slice(2));
    } catch (error) {
        console.error(error instanceof ReleaseFailure || error instanceof UsageError ? error.message : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
