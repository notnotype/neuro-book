/**
 * 发布单元的变更记录（`packages/<包>/CHANGELOG.md`，ADR 0053；写法见 docs/standards/releasing.md 的“写变更记录”）。
 *
 * 格式照 omp（can1357/oh-my-pi）的 Keep a Changelog 变体，分类名用中文：
 *
 *     ## [Unreleased]
 *     ### 新增
 *     - 一行一条，写用户看到的或能做的事（[#12](…)）
 *     ## [0.13.0] - 2026-11-15
 *
 * 第一个 `## ` 之前是自由的说明文字。版本段里只认空行、`### <分类>`、`- ` 开头的条目与条目下缩进的续行；别的内容报错，
 * 不静默丢掉：说明由这里解析出的条目生成，丢一行就是 Release 说明里少一条。
 */

import {compareVersions} from "#scripts/release/semver";

/** 分类与它们在说明里的次序。`数据与升级` 只有应用用，说明里单独放在最前。 */
export const CATEGORIES = ["不兼容的改动", "新增", "改动", "修复", "移除", "数据与升级"] as const;
export type Category = (typeof CATEGORIES)[number];

/** 一个版本段：分类到条目（条目是 `- ` 之后的文字，续行用换行接上）。只含有条目的分类。 */
export type Section = ReadonlyMap<Category, readonly string[]>;

export type Release = {version: string; date: string; section: Section};
export type Changelog = {unreleased: Section; releases: Release[]};

export class ChangelogError extends Error {}

const UNRELEASED = "## [Unreleased]";
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;

function parseSection(lines: readonly string[], where: string): Section {
    const section = new Map<Category, string[]>();
    let category: Category | null = null;
    for (const line of lines) {
        if (line.trim() === "") continue;
        if (line.startsWith("### ")) {
            const name = line.slice(4).trim();
            if (!(CATEGORIES as readonly string[]).includes(name)) throw new ChangelogError(`${where} 有不认识的分类“${name}”（可用：${CATEGORIES.join("、")}）`);
            category = name as Category;
            continue;
        }
        const entries = category === null ? undefined : section.get(category) ?? [];
        if (line.startsWith("- ")) {
            if (category === null || entries === undefined) throw new ChangelogError(`${where} 的条目“${line}”不在任何分类下`);
            entries.push(line.slice(2).trim());
            section.set(category, entries);
            continue;
        }
        if (/^\s+\S/u.test(line) && entries !== undefined && entries.length > 0) {
            entries[entries.length - 1] = `${entries[entries.length - 1]}\n${line.trim()}`;
            continue;
        }
        throw new ChangelogError(`${where} 有读不懂的一行：“${line}”（只认 ### 分类、- 条目与条目下缩进的续行）`);
    }
    return section;
}

/** 解析整份变更记录。要有 `## [Unreleased]`，且它在所有版本段之前；版本段从新到旧、版本号不重复。 */
export function parseChangelog(text: string, name = "CHANGELOG.md"): Changelog {
    const lines = text.replace(/\r\n/gu, "\n").split("\n");
    const headings = lines.flatMap((line, index) => (line.startsWith("## ") ? [index] : []));
    if (headings.length === 0 || lines[headings[0] as number] !== UNRELEASED) throw new ChangelogError(`${name} 的第一个 ## 标题要是 ${UNRELEASED}`);
    let unreleased: Section = new Map();
    const releases: Release[] = [];
    headings.forEach((start, position) => {
        const heading = lines[start] as string;
        const body = lines.slice(start + 1, headings[position + 1] ?? lines.length);
        if (position === 0) {
            unreleased = parseSection(body, `${name} 的 [Unreleased]`);
            return;
        }
        const match = RELEASE_HEADING.exec(heading);
        if (match === null) throw new ChangelogError(`${name} 的标题“${heading}”不是 ## [<版本>] - <YYYY-MM-DD>`);
        const [, version, date] = match as unknown as [string, string, string];
        if (releases.some((release) => release.version === version)) throw new ChangelogError(`${name} 里 [${version}] 出现了两次`);
        const newer = releases.at(-1);
        if (newer !== undefined && compareVersions(version, newer.version) > 0) throw new ChangelogError(`${name} 的版本段要从新到旧：[${version}] 排在 [${newer.version}] 下面`);
        releases.push({version, date, section: parseSection(body, `${name} 的 [${version}]`)});
    });
    return {unreleased, releases};
}

export function isEmpty(section: Section): boolean {
    return section.size === 0;
}

/**
 * 发版时定稿：`[Unreleased]` 改成 `[<版本>] - <日期>`，上方补一个空的 `[Unreleased]`。
 * `[Unreleased]` 没有条目、或这个版本已有段落时抛出：前者是漏写了变更，后者是版本号没提。
 */
export function finalizeUnreleased(text: string, version: string, date: string, name = "CHANGELOG.md"): string {
    const parsed = parseChangelog(text, name);
    if (isEmpty(parsed.unreleased)) throw new ChangelogError(`${name} 的 [Unreleased] 没有条目，没法定稿成 ${version}`);
    if (parsed.releases.some((release) => release.version === version)) throw new ChangelogError(`${name} 已经有 [${version}]：版本号要先提高`);
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(newline);
    const index = lines.indexOf(UNRELEASED);
    lines.splice(index, 1, UNRELEASED, "", `## [${version}] - ${date}`);
    const result = lines.join(newline);
    parseChangelog(result, name);
    return result;
}

/**
 * 把几个版本段并成一段，用于 Release 说明（中间的版本没发出 Release 时，它的条目并进下一次）。`sections` 从新到旧给；
 * 同一条目（文字相同）在几个版本里都出现时只留最新的那条（omp 的 ci-release-notes 同样按文字去重）。
 */
export function mergeSections(sections: readonly Section[]): Section {
    const merged = new Map<Category, string[]>();
    const seen = new Set<string>();
    for (const section of sections) {
        for (const category of CATEGORIES) {
            for (const entry of section.get(category) ?? []) {
                const key = entry.trim();
                if (seen.has(key)) continue;
                seen.add(key);
                merged.set(category, [...(merged.get(category) ?? []), entry]);
            }
        }
    }
    // 按 CATEGORIES 的次序重排：较新的版本只有“修复”、较旧的有“新增”时，“新增”仍在前。
    return new Map(CATEGORIES.flatMap((category) => (merged.has(category) ? [[category, merged.get(category) as string[]] as const] : [])));
}
