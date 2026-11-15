#!/usr/bin/env bun
/**
 * GitHub Release 的说明（ADR 0053；写法见 docs/standards/releasing.md）。由应用的 CHANGELOG 生成，在发布流水线的
 * `gate` 作业里写成文件、作为工件交给 `github-release` 作业：说明生成不出来就停在一切远端写入之前，Release 作业只用这份文件，
 * 重跑也是同一份（输入只有标签提交的源码与门禁定下的上一个桌面版本）。
 *
 * 用法：`bun scripts/release/release-notes.ts <版本> <阶段> <输出文件> [--previous <上一个桌面版本的标签>] [--dry-run]`
 *
 * 检查（不过就以 1 退出、不写文件）：应用的 CHANGELOG 有非空的 `[<版本>]`、`[Unreleased]` 为空（定稿到打标签之间进来的条目
 * 不会漏发）；与上一个版本相比版本号变了的源码包，有 CHANGELOG 且有 `[<它的版本>]`。演练（`--dry-run`）在 master 上跑、
 * 用源码里已经发过的版本，`[Unreleased]` 通常有条目：只把问题打成警告，照样写文件。
 */

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {CATEGORIES, isEmpty, mergeSections, parseChangelog, type Category, type Section} from "#scripts/release/changelog";
import {RELEASE_PACKAGES} from "#scripts/release/packages";
import {compareVersions} from "#scripts/release/semver";
import type {ReleaseStage} from "#scripts/release/tag";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATE = new URL("./desktop-release-notes.md", import.meta.url);
const APP_CHANGELOG = "packages/neuro-book/CHANGELOG.md";

/** 一个以源码发布的包：现在的版本与上一个桌面版本时的版本（那时还没有这个包为 null），以及它的 CHANGELOG（没有为 null）。 */
export type SourcePackage = {dir: string; name: string; version: string; previousVersion: string | null; changelog: string | null};

export type NotesInput = {
    version: string;
    stage: ReleaseStage;
    /** 上一个桌面版本的标签（`gate` 的 `previous`）；第一个桌面版本没有。 */
    previous: string | null;
    /** `owner/name`。 */
    repo: string;
    appChangelog: string;
    packages: readonly SourcePackage[];
    /** 模板：说明里固定的几节（下载哪个、第一次运行、回到旧版本），`{{version}}` 换成版本。 */
    template: string;
};

const INTRO: Record<ReleaseStage, string> = {
    canary: "**canary（早期验证版）**：功能能用，但未必经过完整的人工验收。之后还会有预览版，最后才是稳定版；已装的版本会自动更新到之后发布的版本。数据请自己备份。",
    preview: "**preview（预览版）**：新功能的预览，比 canary 稳定，仍可能有问题；之后是稳定版。已装的版本会自动更新到之后发布的版本。数据请自己备份。",
    stable: "",
};

function entryLines(entries: readonly string[]): string[] {
    // 条目的续行缩进两格，仍属同一个列表项。
    return entries.map((entry) => `- ${entry.split("\n").join("\n  ")}`);
}

function sectionLines(section: Section, skip: readonly Category[]): string[] {
    return CATEGORIES.filter((category) => !skip.includes(category) && section.has(category)).flatMap((category) => [`### ${category}`, "", ...entryLines(section.get(category) ?? []), ""]);
}

/** 说明与问题。有问题时调用方决定是失败还是警告（演练）；说明照样生成，缺的那部分空着。 */
export function releaseNotes(input: NotesInput): {markdown: string; problems: string[]} {
    const problems: string[] = [];
    const app = parseChangelog(input.appChangelog, APP_CHANGELOG);
    if (!app.releases.some((release) => release.version === input.version)) problems.push(`${APP_CHANGELOG} 没有 [${input.version}]：发版前用 release:prepare 定稿`);
    if (!isEmpty(app.unreleased)) problems.push(`${APP_CHANGELOG} 的 [Unreleased] 还有条目：它们不在这次发布里，要么先定稿进 [${input.version}]，要么等下一个版本`);
    // 上一个桌面版本之后、到本次为止的全部版本段：中间的标签没发出 Release 时，它的条目并进这次（omp 的 ci-release-notes 同样处理）。
    const floor = input.previous?.replace(/^v/u, "") ?? null;
    const sections = app.releases
        .filter((release) => compareVersions(release.version, input.version) <= 0 && (floor === null ? release.version === input.version : compareVersions(release.version, floor) > 0))
        .sort((left, right) => compareVersions(right.version, left.version))
        .map((release) => release.section);
    const changes = mergeSections(sections);
    if (isEmpty(changes) && problems.length === 0) problems.push(`${APP_CHANGELOG} 里${floor === null ? "" : ` ${floor} 之后`}到 [${input.version}] 为止没有条目`);

    const lines: string[] = [];
    const intro = INTRO[input.stage];
    lines.push(`NeuroBook ${input.version} 的 Windows 桌面版${intro === "" ? "。" : `，${intro}`}`, "");
    lines.push(`npm 上的命令行版本与插件 SDK 同时发布：\`bun add -g @notnotype/neuro-book@${input.version}\`、\`@notnotype/nb-plugin-sdk@${input.version}\`。`, "");
    const data = changes.get("数据与升级");
    if (data !== undefined) lines.push("## 数据与升级", "", "升级前先备份数据目录（见下文“回到旧版本”）。", "", ...entryLines(data), "");
    const body = sectionLines(changes, ["数据与升级"]);
    if (body.length > 0) lines.push("## 变更", "", ...body);

    // 版本号变了的源码包：每个一行，链到这个标签下它的 CHANGELOG。说明的读者是桌面用户，库的变化写给直接用库的人。
    const released = floor === null ? [] : input.packages.filter((entry) => entry.previousVersion !== entry.version);
    for (const entry of released) {
        if (entry.previousVersion !== null && compareVersions(entry.version, entry.previousVersion) < 0) {
            problems.push(`packages/${entry.dir} 的版本从 ${entry.previousVersion} 降到了 ${entry.version}：源码包的版本只升不降（ADR 0029）`);
            continue;
        }
        if (entry.changelog === null) {
            problems.push(`packages/${entry.dir} 的版本从 ${entry.previousVersion ?? "（新包）"} 改成了 ${entry.version}，却没有 CHANGELOG.md`);
            continue;
        }
        const parsed = parseChangelog(entry.changelog, `packages/${entry.dir}/CHANGELOG.md`);
        if (!parsed.releases.some((release) => release.version === entry.version)) problems.push(`packages/${entry.dir}/CHANGELOG.md 没有 [${entry.version}]`);
    }
    if (released.length > 0) {
        lines.push("## 同时发布的 npm 包", "");
        for (const entry of released) lines.push(`- [\`${entry.name}\` ${entry.version}](https://github.com/${input.repo}/blob/v${input.version}/packages/${entry.dir}/CHANGELOG.md)`);
        lines.push("");
    }

    lines.push(input.template.replaceAll("{{version}}", input.version).trim(), "");
    if (input.previous !== null) lines.push(`**完整对比**：[${input.previous}...v${input.version}](https://github.com/${input.repo}/compare/${input.previous}...v${input.version})`, "");
    return {markdown: lines.join("\n"), problems};
}

function git(args: readonly string[]): {code: number; stdout: string} {
    const result = spawnSync("git", [...args], {cwd: REPOSITORY, encoding: "utf8"});
    return {code: result.status ?? 1, stdout: result.stdout};
}

/** 源码包现在的版本、上一个桌面版本标签下的版本（`git show`；那时还没有这个包为 null）与 CHANGELOG。 */
function sourcePackages(previous: string | null): SourcePackage[] {
    return RELEASE_PACKAGES.map((dir) => {
        const manifest = JSON.parse(readFileSync(join(REPOSITORY, "packages", dir, "package.json"), "utf8")) as {name: string; version: string};
        let previousVersion: string | null = null;
        if (previous !== null) {
            const shown = git(["show", `${previous}:packages/${dir}/package.json`]);
            if (shown.code === 0) previousVersion = (JSON.parse(shown.stdout) as {version: string}).version;
        }
        const changelogPath = join(REPOSITORY, "packages", dir, "CHANGELOG.md");
        return {dir, name: manifest.name, version: manifest.version, previousVersion, changelog: existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : null};
    });
}

class UsageError extends Error {}

function main(argv: readonly string[]): number {
    const parse = () => parseArgs({args: [...argv], options: {previous: {type: "string"}, "dry-run": {type: "boolean"}}, allowPositionals: true});
    let parsed: ReturnType<typeof parse>;
    try {
        parsed = parse();
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    const [version, stage, output, ...extra] = parsed.positionals;
    if (version === undefined || output === undefined || extra.length > 0 || !(stage === "canary" || stage === "preview" || stage === "stable")) {
        throw new UsageError("用法：bun scripts/release/release-notes.ts <版本> <canary|preview|stable> <输出文件> [--previous <标签>] [--dry-run]");
    }
    const previous = parsed.values.previous === undefined || parsed.values.previous === "" ? null : parsed.values.previous;
    if (previous !== null && git(["rev-parse", "--verify", "--quiet", `refs/tags/${previous}`]).code !== 0) throw new UsageError(`本地没有标签 ${previous}（检出要带标签，fetch-depth: 0）`);
    const dryRun = parsed.values["dry-run"] === true;
    const {markdown, problems} = releaseNotes({
        version,
        stage,
        previous,
        repo: process.env.GITHUB_REPOSITORY ?? "notnotype/neuro-book",
        appChangelog: readFileSync(join(REPOSITORY, APP_CHANGELOG), "utf8"),
        packages: sourcePackages(previous),
        template: readFileSync(TEMPLATE, "utf8"),
    });
    for (const problem of problems) console.error(`${dryRun ? "警告" : "说明生成失败"}：${problem}`);
    if (problems.length > 0 && !dryRun) return 1;
    writeFileSync(output, markdown);
    console.log(`✓ 写出 v${version} 的说明（${stage}${previous === null ? "，没有上一个桌面版本" : `，对比 ${previous}`}）：${output}`);
    return 0;
}

if (import.meta.main) {
    try {
        process.exitCode = main(Bun.argv.slice(2));
    } catch (error) {
        console.error(error instanceof UsageError ? error.message : error);
        process.exitCode = error instanceof UsageError ? 2 : 1;
    }
}
