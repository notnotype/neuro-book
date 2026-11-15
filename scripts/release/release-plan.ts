/**
 * 发布流水线的发布计划（`release-plan.json`，t11 计划的“publish.ts：发布计划与 CI 入口”）。`publish.ts --plan` 在构建作业里写它，
 * `publish.ts --ci` 在发布作业里只按它发。这里只放判断与 registry 输出的解析，查询与写文件在 publish.ts。
 *
 * 为什么要分“本次发布”与“历史包”：npm 上同一个版本发出去就不能再发。整轮重跑会重新打包，字节可能不同；上一轮发了一半时，
 * 已发的那些要么与这一轮相同（跳过），要么不同（失败：桌面载荷或依赖它们的包会配上另一批字节）。而源码改过没提版本号的老版本
 * 是常态，字节不同只提醒（现有的 `blockingStalePackages` 规则）。两者都是“registry 上已有、字节不同”，区分它们靠发布时间：
 * 晚于标签提交的，只可能是这一次发布的前一轮发的。不靠上一轮留下的产物，整轮重跑时它不一定还在。
 */

import {join} from "node:path";

import {RELEASE_DIRECTORY, type ReleaseManifest} from "#scripts/release/manifest";
import {compareVersions} from "#scripts/release/semver";

export const RELEASE_PLAN = join(RELEASE_DIRECTORY, "release-plan.json");
export const RELEASE_PLAN_SCHEMA = "nbook.release-plan/v1";

/** registry 上某个版本的状态。`publishedAt` 是 npm 记的发布时间（`time.<版本>`）。 */
export type RegistryVersion = {state: "unpublished"} | {state: "published"; integrity: string; publishedAt: string};

/** `release`：本次发布要有的包，registry 上没有就发，有就必须字节相同。`history`：早就发过的版本，不发、不拦。 */
export type PlanKind = "release" | "history";

export type PlanEntry = {
    name: string;
    version: string;
    tarball: string;
    sha256: string;
    /** npm 的 `dist.integrity` 写法，与 registry 上的直接比。 */
    integrity: string;
    /** 运行时依赖的包名（dependencies 与 peerDependencies）：构建作业里读得到生成目录，发布作业里读不到，所以记下来。 */
    dependencies: string[];
    kind: PlanKind;
    /** 写计划时 registry 上的状态，只作记录；发布作业会重读。 */
    registry: "unpublished" | "same" | "different";
};

export type ReleasePlan = {
    schema: typeof RELEASE_PLAN_SCHEMA;
    commit: string;
    /** 标签提交的提交时间（ISO 8601），区分本次发布与历史包的分界。 */
    commitTime: string;
    packages: PlanEntry[];
};

export type PlanInput = {
    manifest: ReleaseManifest;
    commitTime: string;
    /** 版本就是本次产品版本的包（应用包与 SDK）：不会是历史包。 */
    productPackages: ReadonlySet<string>;
    integrityOf: ReadonlyMap<string, string>;
    dependenciesOf: ReadonlyMap<string, readonly string[]>;
    registry: ReadonlyMap<string, RegistryVersion>;
};

/** 按发布清单的顺序写出计划；`problems` 非空时不该写计划，也不该发布。 */
export function buildReleasePlan(input: PlanInput): {plan: ReleasePlan; problems: string[]} {
    const problems: string[] = [];
    const stale: string[] = [];
    const boundary = Date.parse(input.commitTime);
    if (Number.isNaN(boundary)) throw new Error(`标签提交的提交时间读不懂：${input.commitTime}`);
    const packages = input.manifest.packages.map((entry): PlanEntry => {
        const integrity = input.integrityOf.get(entry.name);
        const registry = input.registry.get(entry.name);
        if (integrity === undefined || registry === undefined) throw new Error(`${entry.name} 缺 integrity 或 registry 状态`);
        const base = {...entry, integrity, dependencies: [...(input.dependenciesOf.get(entry.name) ?? [])]};
        if (registry.state === "unpublished") return {...base, kind: "release", registry: "unpublished"};
        const same = registry.integrity === integrity;
        const publishedAt = Date.parse(registry.publishedAt);
        if (Number.isNaN(publishedAt)) throw new Error(`${entry.name}@${entry.version} 的发布时间读不懂：${registry.publishedAt}`);
        const kind: PlanKind = input.productPackages.has(entry.name) || publishedAt > boundary ? "release" : "history";
        if (!same && kind === "release") {
            // 应用包与 SDK 早于标签提交就发过这个版本：产品版本号没提，不是前一轮发了一半。
            problems.push(publishedAt > boundary
                ? `${entry.name}@${entry.version} 已在 registry 上（${registry.publishedAt}，标签提交之后），与这一轮验过的 tarball 字节不同：这次发布的前一轮发出的不是这一批。版本号不能重发：重跑上一轮失败的作业，或提高补丁号重打标签`
                : `${entry.name}@${entry.version} 早就发过（${registry.publishedAt}），与这一轮验过的 tarball 字节不同：应用包与 SDK 的版本就是产品版本，先提高产品版本号再发布`);
        }
        if (!same && kind === "history") stale.push(entry.name);
        return {...base, kind, registry: same ? "same" : "different"};
    });
    const releaseNames = packages.filter((entry) => entry.kind === "release").map((entry) => entry.name);
    const blocking = blockingStalePackages(releaseNames, stale, input.dependenciesOf);
    if (blocking.length > 0) problems.push(`本次发布的包依赖这些已发的版本，而它们与这一轮验过的 tarball 不同：${blocking.join("、")}。版本号不能重发，提高它们的版本号再发布`);
    return {plan: {schema: RELEASE_PLAN_SCHEMA, commit: input.manifest.commit, commitTime: input.commitTime, packages}, problems};
}

/** 计划与发布清单、磁盘上的 tarball 对不对得上（同一个提交、同一批 tarball）；`digests` 按 tarball 文件名给 SHA-256。 */
export function planManifestProblems(plan: ReleasePlan, manifest: ReleaseManifest, digests: ReadonlyMap<string, string>): string[] {
    const problems: string[] = [];
    if (plan.schema !== RELEASE_PLAN_SCHEMA) problems.push(`release-plan.json 的 schema 是 ${String(plan.schema)}，不是 ${RELEASE_PLAN_SCHEMA}`);
    if (plan.commit !== manifest.commit) problems.push(`发布计划的提交 ${plan.commit.slice(0, 12)} 与发布清单的 ${manifest.commit.slice(0, 12)} 不同`);
    const listed = new Map(manifest.packages.map((entry) => [entry.name, entry]));
    for (const entry of plan.packages) {
        const inManifest = listed.get(entry.name);
        if (inManifest === undefined || inManifest.version !== entry.version || inManifest.tarball !== entry.tarball || inManifest.sha256 !== entry.sha256) {
            problems.push(`发布计划里的 ${entry.name}@${entry.version} 与发布清单对不上`);
            continue;
        }
        if (digests.get(entry.tarball) !== entry.sha256) problems.push(`${entry.tarball} 不在或 SHA-256 与计划不同`);
    }
    if (plan.packages.length !== manifest.packages.length) problems.push(`发布计划有 ${plan.packages.length} 个包，发布清单有 ${manifest.packages.length} 个`);
    return problems;
}

/** 发布作业对本次发布的每个包重读 registry 后要做的事；历史包不在这里出现。 */
export function publishSteps(plan: ReleasePlan, registry: ReadonlyMap<string, RegistryVersion>): {publish: PlanEntry[]; skip: PlanEntry[]; problems: string[]} {
    const result: {publish: PlanEntry[]; skip: PlanEntry[]; problems: string[]} = {publish: [], skip: [], problems: []};
    for (const entry of plan.packages) {
        if (entry.kind !== "release") continue;
        const state = registry.get(entry.name);
        if (state === undefined) throw new Error(`${entry.name} 缺 registry 状态`);
        if (state.state === "unpublished") result.publish.push(entry);
        else if (state.integrity === entry.integrity) result.skip.push(entry);
        else result.problems.push(`${entry.name}@${entry.version} 在写计划之后被别处发了另一份字节（${state.publishedAt}）：停下，不发其余的`);
    }
    return result;
}

/**
 * 发布时给的 dist-tag。从没发过（`latest` 为 null）或本次版本高于当前 `latest`：`latest`；否则 `history`，不往回拨。
 * 一律显式给：不带 `--tag` 时 npm 11.5.1 按 registry 里最高的正式版本拒绝隐式的 latest（不是按 `dist-tags.latest`），
 * 手工回拨过 `latest` 的包会被拒（t11 设计审查第 1 轮第 9 条）。
 */
export function distTagFor(version: string, latest: string | null): "latest" | "history" {
    return latest === null || compareVersions(version, latest) === 1 ? "latest" : "history";
}

/**
 * 已发的版本里与这次验过的字节不同、又被要发的包（直接或间接）依赖的：用户装上要发的包时会配上 registry 上那份没验过的，
 * 这时不能发。没人依赖的只是“源码改了没提版本”，提醒即可（例如应用与 SDK 把依赖打进了 bundle，不依赖任何源码包）。
 */
export function blockingStalePackages(pending: readonly string[], stale: readonly string[], dependenciesOf: ReadonlyMap<string, readonly string[]>): string[] {
    const reached = new Set<string>();
    const queue = [...pending];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
        for (const dependency of dependenciesOf.get(name) ?? []) {
            if (reached.has(dependency)) continue;
            reached.add(dependency);
            queue.push(dependency);
        }
    }
    return stale.filter((name) => reached.has(name));
}

type NpmResult = {code: number; stdout: string};

/** `npm view … --json` 失败时的错误码；不是 npm 的 JSON 错误时抛出。 */
function npmErrorCode(result: NpmResult): unknown {
    try {
        return (JSON.parse(result.stdout.trim()) as {error?: {code?: unknown}}).error?.code;
    } catch {
        throw new Error(`npm view 失败（退出码 ${result.code}），输出不是 JSON：${result.stdout.trim() || "（空）"}`);
    }
}

/** npm 10 把单个结果打成值，npm 12 打成只有一项的数组（2026-11-14 对 registry.npmjs.org 实测两种）。 */
function single(value: unknown): unknown {
    return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/**
 * 读 `npm view <名>@<版本> dist.integrity time --json`。只有 `E404` 算没发布；网络、权限、5xx 与读不懂的输出都抛出，
 * 不能当成“可以发”。
 */
export function parseRegistryVersion(result: NpmResult, version: string): RegistryVersion {
    if (result.code !== 0) {
        const code = npmErrorCode(result);
        if (code === "E404") return {state: "unpublished"};
        throw new Error(`npm view 失败（${String(code ?? `退出码 ${result.code}`)}）：${result.stdout.trim()}`);
    }
    let document: unknown;
    try {
        document = single(JSON.parse(result.stdout));
    } catch {
        throw new Error(`npm view 成功退出但输出不是 JSON：${result.stdout.trim() || "（空）"}`);
    }
    const fields = document as {"dist.integrity"?: unknown; time?: Record<string, unknown>} | null;
    const integrity = fields?.["dist.integrity"];
    const publishedAt = fields?.time?.[version];
    if (typeof integrity !== "string" || typeof publishedAt !== "string") throw new Error(`npm view 的输出里没有 dist.integrity 或 time.${version}：${result.stdout.trim()}`);
    return {state: "published", integrity, publishedAt};
}

/** 读 `npm view <名> dist-tags.latest --json`：包不存在（E404）或没有 latest 标签时为 null；其它失败抛出。 */
export function parseLatestTag(result: NpmResult): string | null {
    if (result.code !== 0) {
        const code = npmErrorCode(result);
        if (code === "E404") return null;
        throw new Error(`npm view 失败（${String(code ?? `退出码 ${result.code}`)}）：${result.stdout.trim()}`);
    }
    if (result.stdout.trim() === "") return null;
    const value = single(JSON.parse(result.stdout));
    if (typeof value !== "string") throw new Error(`npm view dist-tags.latest 的输出读不懂：${result.stdout.trim()}`);
    return value;
}
