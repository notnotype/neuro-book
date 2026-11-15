#!/usr/bin/env bun
/**
 * 发布完成门禁：照装好的桌面版的更新器（Electrobun 2.0.6）与下一次构建的 Hutch 的取法，从 GitHub 上取这次发布的更新文件，
 * 核对它们就是冻结的那批、更新器会收下（`.github/workflows/release.yml` 的 `verify-feed` 作业；t10 计划“验证”一节交下来的门禁，
 * docs/specs/runtime/desktop-update.md）。
 *
 * 用法：`bun scripts/release/verify-update-feed.ts <版本> <资产目录> <证据文件>`，仓库取自 `GITHUB_REPOSITORY`。
 * 先重读 Release 列表：本次是最新时取 `releases/latest/download/`（已装用户的更新器取的就是它）；本次已公开但不是最新
 * （补发的旧版本，或重跑时已被更高版本取代）时取 `releases/download/v<版本>/`，并注明这次没有验 latest 路由；没公开则失败。
 * 每个请求的地址、重定向链、状态与应答头写进证据文件，成败都写。退出码：0 通过；1 失败；2 用法错误。
 */

import {createHash, randomBytes} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {zstdDecompressSync} from "node:zlib";

import {GitHubReleases, readLocalAssets, type Run} from "#scripts/release/github-release";

/**
 * 正式包的身份。与 `packages/neuro-book/desktop/electrobun.config.ts` 的缺省值相同（那个文件构建时读环境变量与 bundle，
 * 脚本导入不了）；应用标识与频道发出去以后不改（docs/specs/runtime/desktop-shell.md 的“输入与前置条件”）。
 */
export const OFFICIAL = {identifier: "io.github.notnotype.neurobook", channel: "stable", platform: "win", arch: "x64"} as const;
export const PLATFORM_PREFIX = `${OFFICIAL.channel}-${OFFICIAL.platform}-${OFFICIAL.arch}`;
export const ARCHIVE_ASSET = `${PLATFORM_PREFIX}-NeuroBook.tar.zst`;

/**
 * 查询串的形状，照 Electrobun 2.0.6 `Updater.ts`：取清单时 `?<randomBytes(8) 的十六进制>`，取完整包与补丁时
 * `?cache=<32 位十六进制的事务号>`（`addUpdateArtifactCacheBuster`）；Hutch 0.29.0 构建时取上一版的清单与完整包也用
 * `?cache=<32 位>`。t10 的请求日志里看到的就是这三种（w00046 t10 evidences/windows-update-r1.txt 的“请求形状”）。
 */
export const manifestQuery = () => `?${randomBytes(8).toString("hex")}`;
export const cacheQuery = () => `?cache=${randomBytes(16).toString("hex")}`;

export class FeedFailure extends Error {}
class UsageError extends Error {}

type Manifest = {version: string; hash: string; identifier: string; channel: string; platform: string; arch: string; file: string; tarSha256?: string; tarSize?: number};

/**
 * 按更新器的清单校验（`validateUpdateManifest`）读一份 update.json：`schemaVersion` 为 1，身份与正式包一致，
 * 文件名以平台前缀开头、是 `.tar.zst`；`requireIntegrity` 时（v2 清单）`tarSha256`、`tarSize` 必须有且合法。
 */
export function readManifest(text: string, requireIntegrity: boolean): {manifest: Manifest | null; problems: string[]} {
    const problems: string[] = [];
    let document: Record<string, unknown>;
    try {
        document = JSON.parse(text) as Record<string, unknown>;
    } catch {
        return {manifest: null, problems: ["不是 JSON"]};
    }
    if (document.schemaVersion !== 1) problems.push(`schemaVersion 是 ${String(document.schemaVersion)}，不是 1`);
    const field = (key: string, source: Record<string, unknown> = document): string => {
        const value = source[key];
        if (typeof value !== "string" || value === "") problems.push(`${key} 缺失或不是字符串`);
        return typeof value === "string" ? value : "";
    };
    const identity = {identifier: field("identifier"), channel: field("channel"), platform: field("platform"), arch: field("arch")};
    for (const [key, expected] of Object.entries(OFFICIAL)) {
        if (identity[key as keyof typeof identity] !== expected) problems.push(`${key} 是 ${identity[key as keyof typeof identity]}，不是 ${expected}`);
    }
    const version = field("version");
    const hash = field("hash");
    if (hash !== "" && !/^[a-z0-9]{1,13}$/.test(hash)) problems.push(`hash 的形状不对：${hash}`);
    const artifact = typeof document.artifact === "object" && document.artifact !== null ? (document.artifact as Record<string, unknown>) : null;
    if (artifact === null) return {manifest: null, problems: [...problems, "缺 artifact"]};
    const file = field("file", artifact);
    if (!file.startsWith(`${PLATFORM_PREFIX}-`) || !file.endsWith(".tar.zst") || /[\u0000-\u001f\u007f/\\:]/.test(file)) problems.push(`artifact.file 不是本平台的 .tar.zst：${file}`);
    const manifest: Manifest = {version, hash, ...identity, file};
    const {tarSha256, tarSize} = artifact;
    if (tarSha256 !== undefined || tarSize !== undefined || requireIntegrity) {
        if (typeof tarSha256 !== "string" || !/^[a-f0-9]{64}$/.test(tarSha256) || typeof tarSize !== "number" || !Number.isSafeInteger(tarSize) || tarSize <= 0) {
            problems.push("artifact.tarSha256 或 artifact.tarSize 缺失或不合法（v2 清单必须有，更新器靠它们核对解压后的归档）");
        } else {
            manifest.tarSha256 = tarSha256;
            manifest.tarSize = tarSize;
        }
    }
    return {manifest, problems};
}

/**
 * 从未压缩的 tar 里取一个文件。只认这里会遇到的条目：普通文件、pax 扩展头（`x`，带 `path=` 时改写下一条的路径）
 * 与 GNU 长名（`L`）；`pick` 按路径选。找不到返回 null。
 */
export function readTarEntry(tar: Uint8Array, pick: (path: string) => boolean): {path: string; content: Uint8Array} | null {
    const decoder = new TextDecoder();
    const text = (start: number, length: number) => decoder.decode(tar.subarray(start, start + length)).replace(/\0.*$/s, "");
    let offset = 0;
    let override: string | null = null;
    while (offset + 512 <= tar.length) {
        const name = text(offset, 100);
        if (name === "") break;
        const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
        const type = String.fromCharCode(tar[offset + 156] ?? 0);
        const prefix = text(offset + 345, 155);
        const body = tar.subarray(offset + 512, offset + 512 + size);
        const path = override ?? (prefix === "" ? name : `${prefix}/${name}`);
        override = null;
        if (type === "x") {
            const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(decoder.decode(body));
            if (record !== null) override = record[1]!;
        } else if (type === "L") {
            override = decoder.decode(body).replace(/\0.*$/s, "");
        } else if ((type === "0" || type === "\0") && pick(path)) {
            return {path, content: body};
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return null;
}

/** 构建进包里的 `Resources/version.json`（tar 里的 `<应用名>/Resources/version.json`，与更新器认的位置相同）。 */
const isVersionJson = (path: string) => /^[^/]+\/Resources\/version\.json$/.test(path);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** 本地这批更新文件自洽：两份清单指向同一个目标，完整包解压后与 v2 的摘要相同，包里的 version.json 是正式的身份与更新源。 */
export async function localFeedProblems(version: string, directory: string, officialBaseUrl: string): Promise<{problems: string[]; manifest: Manifest | null}> {
    const problems: string[] = [];
    const v2 = readManifest(await readFile(join(directory, `${PLATFORM_PREFIX}-update-v2.json`), "utf8"), true);
    const v1 = readManifest(await readFile(join(directory, `${PLATFORM_PREFIX}-update.json`), "utf8"), false);
    problems.push(...v2.problems.map((problem) => `update-v2.json：${problem}`), ...v1.problems.map((problem) => `update.json：${problem}`));
    const manifest = v2.manifest;
    if (manifest === null || v1.manifest === null) return {problems, manifest};
    if (manifest.version !== version) problems.push(`update-v2.json 的版本是 ${manifest.version}，不是 ${version}`);
    for (const key of ["version", "hash", "file"] as const) {
        if (v1.manifest[key] !== manifest[key]) problems.push(`update.json 的 ${key} 是 ${v1.manifest[key]}，与 update-v2.json 的 ${manifest[key]} 不同`);
    }
    if (manifest.file !== ARCHIVE_ASSET) problems.push(`artifact.file 是 ${manifest.file}，资产里的完整包是 ${ARCHIVE_ASSET}`);
    const tar = zstdDecompressSync(await readFile(join(directory, ARCHIVE_ASSET)));
    if (tar.length !== manifest.tarSize) problems.push(`完整包解压后 ${tar.length} 字节，update-v2.json 记的是 ${String(manifest.tarSize)}`);
    if (sha256(tar) !== manifest.tarSha256) problems.push("完整包解压后的 SHA-256 与 update-v2.json 的 tarSha256 不同（更新器会以 ArchiveHashMismatch 失败）");
    const entry = readTarEntry(tar, isVersionJson);
    if (entry === null) return {problems: [...problems, "完整包里没有 <应用名>/Resources/version.json"], manifest};
    const info = JSON.parse(new TextDecoder().decode(entry.content)) as Record<string, unknown>;
    const expected: Record<string, string> = {version, hash: manifest.hash, baseUrl: officialBaseUrl, identifier: OFFICIAL.identifier, channel: OFFICIAL.channel};
    for (const [key, value] of Object.entries(expected)) {
        if (info[key] !== value) problems.push(`包里 ${entry.path} 的 ${key} 是 ${String(info[key])}，不是 ${value}`);
    }
    return {problems, manifest};
}

export type Hop = {url: string; status: number; headers: Record<string, string>};
export type RequestRecord = {asset: string; purpose: string; hops: Hop[]; sha256: string | null; ok: boolean; problem?: string};

/** 手动跟随重定向（至多 5 跳），每一跳都记下；最后一跳要 200。返回正文与记录。 */
export async function fetchFollowing(url: string, fetcher: typeof fetch = fetch): Promise<{hops: Hop[]; body: Uint8Array | null; problem?: string}> {
    const hops: Hop[] = [];
    let current = url;
    for (let redirects = 0; ; redirects += 1) {
        const response = await fetcher(current, {redirect: "manual", signal: AbortSignal.timeout(120_000)});
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            if (key !== "set-cookie") headers[key] = value;
        });
        hops.push({url: current, status: response.status, headers});
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location !== null) {
            await response.body?.cancel();
            if (redirects >= 5) return {hops, body: null, problem: "重定向超过 5 跳"};
            current = new URL(location, current).toString();
            continue;
        }
        if (response.status !== 200) {
            await response.body?.cancel();
            return {hops, body: null, problem: `HTTP ${response.status}`};
        }
        return {hops, body: new Uint8Array(await response.arrayBuffer())};
    }
}

/** 远端要取的文件：清单两份、完整包、这次实际生成的每个补丁（清单里没有补丁列表，按冻结的资产列出）。 */
export function feedRequests(assets: Iterable<string>): Array<{asset: string; purpose: string; query: () => string}> {
    const requests = [
        {asset: `${PLATFORM_PREFIX}-update-v2.json`, purpose: "更新器取清单", query: manifestQuery},
        {asset: `${PLATFORM_PREFIX}-update.json`, purpose: "下一次构建的 Hutch 取上一版清单", query: cacheQuery},
        {asset: ARCHIVE_ASSET, purpose: "更新器取完整包；Hutch 取上一版", query: cacheQuery},
    ];
    for (const name of [...assets].sort()) {
        if (/^stable-win-x64-[a-z0-9]{1,13}\.patch$/.test(name)) requests.push({asset: name, purpose: "更新器按本地哈希取补丁", query: cacheQuery});
    }
    return requests;
}

/** 逐个取远端文件，SHA-256 要与冻结的资产相同。 */
export async function remoteFeedRecords(base: string, local: ReadonlyMap<string, string>, fetcher: typeof fetch = fetch): Promise<RequestRecord[]> {
    const records: RequestRecord[] = [];
    for (const request of feedRequests(local.keys())) {
        const url = `${base.replace(/\/+$/, "")}/${encodeURIComponent(request.asset)}${request.query()}`;
        const {hops, body, problem} = await fetchFollowing(url, fetcher);
        const digest = body === null ? null : sha256(body);
        const mismatch = digest !== null && digest !== local.get(request.asset) ? "与冻结的资产 SHA-256 不同" : undefined;
        const failure = problem ?? mismatch;
        records.push({asset: request.asset, purpose: request.purpose, hops, sha256: digest, ok: failure === undefined, ...(failure === undefined ? {} : {problem: failure})});
    }
    return records;
}

async function spawnRun(argv: readonly string[]): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn([...argv], {stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

async function main(argv: readonly string[], run: Run): Promise<void> {
    const [version, directory, evidencePath, ...extra] = argv;
    const repo = process.env.GITHUB_REPOSITORY;
    if (version === undefined || directory === undefined || evidencePath === undefined || extra.length > 0 || repo === undefined || repo === "") {
        throw new UsageError("用法：bun scripts/release/verify-update-feed.ts <版本> <资产目录> <证据文件>（仓库取自 GITHUB_REPOSITORY）");
    }
    const tag = `v${version}`;
    const latestBase = `https://github.com/${repo}/releases/latest/download`;
    const evidence: Record<string, unknown> = {version, at: new Date().toISOString()};
    const problems: string[] = [];
    try {
        const release = (await new GitHubReleases(run, repo).list()).find((item) => item.tagName === tag);
        if (release === undefined || release.isDraft) throw new FeedFailure(`${tag} 没有公开：发行没有完成，自动更新不可用`);
        // 已装用户的更新器取的是 latest/download；本次不是最新时它们不会从这里取，只核对这次的资产本身。
        const base = release.isLatest ? latestBase : `https://github.com/${repo}/releases/download/${tag}`;
        evidence.route = release.isLatest ? "latest" : "tag（本次不是最新：补发的旧版本，或已被更高版本取代；这次没有验 latest 路由）";
        const local = await readLocalAssets(directory);
        const own = await localFeedProblems(version, directory, latestBase);
        problems.push(...own.problems);
        const records = await remoteFeedRecords(base, local);
        evidence.requests = records;
        for (const record of records) if (!record.ok) problems.push(`${record.asset}（${record.purpose}）：${record.problem ?? "失败"}`);
        if (!records.some((record) => record.asset.endsWith(".patch"))) evidence.patches = "这次没有生成补丁（没有上一版，或 Hutch 取上一版失败；看 desktop 作业的构建日志）";
    } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
    } finally {
        evidence.problems = problems;
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    if (problems.length > 0) throw new FeedFailure(`发行没有完成，自动更新不可用：\n${problems.join("\n")}`);
    console.log(`✓ ${tag} 的更新文件按更新器的取法都取得到、与冻结的资产相同（${String(evidence.route)}）`);
}

if (import.meta.main) {
    try {
        await main(Bun.argv.slice(2), spawnRun);
    } catch (error) {
        console.error(error instanceof FeedFailure || error instanceof UsageError ? error.message : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
