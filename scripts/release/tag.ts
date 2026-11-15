#!/usr/bin/env bun
/**
 * 发布流水线的标签门禁与构建后的版本核对（`.github/workflows/release.yml` 的 `gate` 与构建作业；
 * docs/proposals/desktop-distribution.md 4.8，docs/standards/repository-workflow.md 的“发布授权”）。
 *
 * - `check <标签>`：标签是 `v<稳定版本>`，与源码里的产品版本相同，解引用后的提交就是这次检出的提交，且在 origin/master 上。
 *   通过时在 stdout 打一行 `version=<版本>`，工作流把它追加进 `GITHUB_OUTPUT`。
 * - `verify-built --version <版本> [--manifest <release-manifest.json>] [--desktop <桌面工程目录>]`：构建出的应用包、SDK、
 *   壳与载荷的版本都是预期的那个（测试包 B′ 的预期是补丁号加 1，见 t11 计划的“构建分工”）。
 *
 * 退出码：0 通过；1 门禁失败（原因在 stderr）；2 用法错误。“这次推送是新建标签、不是改指或删除”由工作流看推送事件判断，不在这里。
 */

import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {APP_PACKAGE, SDK_PACKAGE} from "#scripts/release/packages";
import type {ReleaseManifest} from "#scripts/release/manifest";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const RELEASE_BRANCH = "origin/master";

export class GateFailure extends Error {}
class UsageError extends Error {}

/** 稳定的语义化版本：三段数字、没有前导零、没有预发布段与构建元数据。 */
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** `v<稳定版本>` 的版本部分；带预发布段（`v1.0.0-rc.1`）或别的形状都拒绝：流水线只发正式版本。 */
export function versionOfTag(tag: string): string {
    const version = tag.startsWith("v") ? tag.slice(1) : null;
    if (version === null || !STABLE_VERSION.test(version)) throw new GateFailure(`标签 ${tag} 不是 v<稳定版本>（例如 v0.12.1）：带预发布段或别的形状的标签不发布`);
    return version;
}

/**
 * 源码里的产品版本有两处：应用包 package.json 的 `version` 与 `src/shared/product.ts` 的 `PRODUCT_VERSION`（product.test.ts 锁定两者相等）。
 * 读文件文本而不导入 product.ts：脚本不依赖应用的模块图，`root` 也可以是测试造的仓库。
 */
export function sourceVersions(root: string): {packageJson: string; product: string} {
    const app = join(root, "packages", "neuro-book");
    const packageJson = (JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as {version?: unknown}).version;
    const product = /export const PRODUCT_VERSION = "([^"]+)";/.exec(readFileSync(join(app, "src", "shared", "product.ts"), "utf8"))?.[1];
    if (typeof packageJson !== "string" || product === undefined) throw new GateFailure("读不到 packages/neuro-book/package.json 的 version 或 src/shared/product.ts 的 PRODUCT_VERSION");
    return {packageJson, product};
}

function git(root: string, args: readonly string[]): {code: number; stdout: string; stderr: string} {
    const result = spawnSync("git", [...args], {cwd: root, encoding: "utf8"});
    return {code: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim()};
}

/**
 * 标签门禁。`head` 是这次检出的提交（工作流里是 `GITHUB_SHA`）：标签解引用到别的提交说明推送之后标签被改指过，不发。
 * origin/master 要事先取到（工作流 `fetch-depth: 0`）；取不到时 merge-base 失败，按“不在 master 上”拒绝。
 */
export function checkReleaseTag(options: {tag: string; head: string; root?: string}): {version: string} {
    const root = options.root ?? REPOSITORY;
    const version = versionOfTag(options.tag);
    const source = sourceVersions(root);
    if (source.packageJson !== version || source.product !== version) {
        throw new GateFailure(`标签版本 ${version} 与源码不一致：packages/neuro-book/package.json 是 ${source.packageJson}，PRODUCT_VERSION 是 ${source.product}`);
    }
    const tagged = git(root, ["rev-parse", "--verify", "--quiet", `refs/tags/${options.tag}^{commit}`]);
    if (tagged.code !== 0) throw new GateFailure(`本地没有标签 ${options.tag}`);
    if (tagged.stdout !== options.head) throw new GateFailure(`标签 ${options.tag} 指向 ${tagged.stdout.slice(0, 12)}，不是这次检出的 ${options.head.slice(0, 12)}`);
    if (git(root, ["merge-base", "--is-ancestor", options.head, RELEASE_BRANCH]).code !== 0) {
        throw new GateFailure(`标签提交 ${options.head.slice(0, 12)} 不在 ${RELEASE_BRANCH} 上：先合入 master 再打标签`);
    }
    return {version};
}

/** 构建出的各个版本：发布清单里的应用包与 SDK、壳的 `bundle/version.json`、载荷清单；没给的那一项不核对。 */
export type BuiltVersions = {manifest?: ReleaseManifest; shell?: string; payload?: string};

/** 与 `expected` 不同的每一项一条问题，空表示通过。 */
export function builtVersionProblems(expected: string, built: BuiltVersions): string[] {
    const problems: string[] = [];
    if (built.manifest !== undefined) {
        for (const name of [APP_PACKAGE, SDK_PACKAGE]) {
            const entry = built.manifest.packages.find((item) => item.name === name);
            if (entry === undefined) problems.push(`发布清单里没有 ${name}`);
            else if (entry.version !== expected) problems.push(`发布清单里 ${name} 是 ${entry.version}，不是 ${expected}`);
        }
    }
    if (built.shell !== undefined && built.shell !== expected) problems.push(`壳的 bundle/version.json 是 ${built.shell}，不是 ${expected}`);
    if (built.payload !== undefined && built.payload !== expected) problems.push(`载荷里的应用包是 ${built.payload}，不是 ${expected}`);
    return problems;
}

function readVersion(path: string): string {
    const version = (JSON.parse(readFileSync(path, "utf8")) as {version?: unknown}).version;
    if (typeof version !== "string") throw new GateFailure(`${path} 里没有 version`);
    return version;
}

function main(argv: readonly string[]): void {
    const [command, ...rest] = argv;
    if (command === "check") {
        const [tag, ...extra] = rest;
        const head = process.env.GITHUB_SHA ?? git(REPOSITORY, ["rev-parse", "HEAD"]).stdout;
        if (tag === undefined || extra.length > 0) throw new UsageError("用法：bun scripts/release/tag.ts check <标签>");
        console.log(`version=${checkReleaseTag({tag, head}).version}`);
        return;
    }
    if (command === "verify-built") {
        let values: {version?: string; manifest?: string; desktop?: string};
        try {
            ({values} = parseArgs({args: [...rest], options: {version: {type: "string"}, manifest: {type: "string"}, desktop: {type: "string"}}}));
        } catch (error) {
            throw new UsageError((error as Error).message);
        }
        if (values.version === undefined || (values.manifest === undefined && values.desktop === undefined)) {
            throw new UsageError("用法：bun scripts/release/tag.ts verify-built --version <版本> [--manifest <release-manifest.json>] [--desktop <桌面工程目录>]");
        }
        const built: BuiltVersions = {};
        if (values.manifest !== undefined) built.manifest = JSON.parse(readFileSync(values.manifest, "utf8")) as ReleaseManifest;
        if (values.desktop !== undefined) {
            built.shell = readVersion(join(values.desktop, "bundle", "version.json"));
            built.payload = readVersion(join(values.desktop, "payload", "payload-manifest.json"));
        }
        const problems = builtVersionProblems(values.version, built);
        if (problems.length > 0) throw new GateFailure(problems.join("\n"));
        console.log(`✓ 构建出的版本都是 ${values.version}`);
        return;
    }
    throw new UsageError("用法：bun scripts/release/tag.ts check <标签> | verify-built --version <版本> …");
}

if (import.meta.main) {
    try {
        main(Bun.argv.slice(2));
    } catch (error) {
        console.error(error instanceof GateFailure || error instanceof UsageError ? error.message : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
