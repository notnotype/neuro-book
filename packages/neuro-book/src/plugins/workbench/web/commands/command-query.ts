/**
 * 命令面板的查询解析与匹配：前缀路由、子序列评分与 UTF-16 命中片段（workbench.quick-open）。
 *
 * 纯函数：候选从哪来、当前选中项与执行时机都归面板。扫描按 Unicode code point 做、区段映回 UTF-16：
 * 代理对不能被劈开，否则标亮会把一个字符渲染成半个。
 */

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {CommandMetadata} from "nbook/plugins/commands/shared/contracts";

import type {QuickPickItem} from "../../shared/contracts";

type QueryMode = "commands" | "line";

type ParsedQuery = Readonly<{mode: QueryMode; text: string}>;

/** 面板只有两种模式：`>` 命令（可省略）、`:` 行号。其它符号（含 `@`）都是普通命令文本。 */
export function parseCommandQuery(query: string): ParsedQuery {
    if (query.startsWith(">")) return {mode: "commands", text: query.slice(1).trim()};
    if (query.startsWith(":")) return {mode: "line", text: query.slice(1).trim()};
    return {mode: "commands", text: query.trim()};
}

/** 行号文本 → 行号：只认十进制正整数，且必须是 safe integer。空串交给调用方给提示。 */
export function parseLineNumber(text: string): number | null {
    if (!/^[1-9]\d*$/u.test(text)) return null;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
}

type Range = readonly [number, number];

/**
 * 面板的一项，与 nb-ui `QuickInputItem` 同形（面板组件原样交给 QuickInput，vue-tsc 检查两者一致）。
 * 不直接引用那个类型：它定义在 `.vue` 里，本模块要能被 `bun test` 与后端的 tsc 直接加载。
 */
export type PaletteItem = Readonly<{
    id: string;
    label: string;
    description?: string;
    category?: string;
    shortcut?: string;
    /** 标签里命中的 UTF-16 区段 `[start, endExclusive)`。 */
    labelMatches?: readonly Range[];
}>;

type TextMatch = Readonly<{score: number; ranges: readonly Range[]}>;

/** code point 列表与每个 code point 的 UTF-16 起始偏移（最后一项是总长度）。 */
function splitCodePoints(value: string): {points: string[]; offsets: number[]} {
    const points = Array.from(value);
    const offsets: number[] = [0];
    for (const point of points) offsets.push((offsets[offsets.length - 1] as number) + point.length);
    return {points, offsets};
}

function samePoint(left: string, right: string | undefined): boolean {
    return right !== undefined && (left === right || left.toLowerCase() === right.toLowerCase());
}

/** 把连续位置合并成命中的 UTF-16 区段。 */
function runsToRanges(positions: readonly number[], offsets: readonly number[]): readonly Range[] {
    const ranges: Range[] = [];
    let start = positions[0] as number;
    let end = start;
    for (const position of positions.slice(1)) {
        if (position === end + 1) {
            end = position;
            continue;
        }
        ranges.push([offsets[start] as number, offsets[end + 1] as number]);
        start = position;
        end = position;
    }
    ranges.push([offsets[start] as number, offsets[end + 1] as number]);
    return ranges;
}

/**
 * 子序列匹配。分数越小越靠前：精确 0、前缀 1、连续包含 2+起点、非连续 100+10×间隔数+起点。
 * 未命中返回 null；空查询对任何文本都命中（分数 0、无片段）。
 */
export function matchCommandText(text: string, query: string): TextMatch | null {
    if (query === "") return {score: 0, ranges: []};
    const target = splitCodePoints(text);
    const needle = splitCodePoints(query).points;
    if (needle.length > target.points.length) return null;
    const matchesAt = (start: number): boolean => needle.every((point, index) => samePoint(point, target.points[start + index]));

    if (matchesAt(0)) {
        return needle.length === target.points.length ? {score: 0, ranges: [[0, text.length]]} : {score: 1, ranges: [[0, target.offsets[needle.length] as number]]};
    }
    for (let start = 1; start + needle.length <= target.points.length; start += 1) {
        if (matchesAt(start)) return {score: 2 + start, ranges: [[target.offsets[start] as number, target.offsets[start + needle.length] as number]]};
    }

    const positions: number[] = [];
    let cursor = 0;
    for (const point of needle) {
        const found = target.points.findIndex((candidate, index) => index >= cursor && samePoint(point, candidate));
        if (found === -1) return null;
        positions.push(found);
        cursor = found + 1;
    }
    const gaps = positions.filter((position, index) => index > 0 && position !== (positions[index - 1] as number) + 1).length;
    return {score: 100 + 10 * gaps + (positions[0] as number), ranges: runsToRanges(positions, target.offsets)};
}

/** 同分时按 id 的 Unicode code point 升序（与 UTF-16 码元序在代理对上不同）。 */
function compareCodePoints(left: string, right: string): number {
    const leftPoints = Array.from(left);
    const rightPoints = Array.from(right);
    for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
        const leftValue = (leftPoints[index] as string).codePointAt(0) as number;
        const rightValue = (rightPoints[index] as string).codePointAt(0) as number;
        if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
    }
    return leftPoints.length - rightPoints.length;
}

/** 不在 MRU 里（-1）的排在所有 MRU 命中之后。 */
function compareMru(left: number, right: number): number {
    if (left === right) return 0;
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
}

/**
 * 把候选命令折成 QuickInput 的项：标题与 id 都参与匹配、取较低分，只有标题命中才渲染片段；
 * 排序为“匹配分为主、MRU 为次、同分按 id”，空查询因此只按 MRU 与 id 排。
 * 调用方先过滤掉 `expose.human === false` 与当前不可用的命令，本函数不解释可见性。
 */
export function searchCommands(commands: readonly CommandMetadata[], query: string, recent: readonly string[], locale: DisplayLocale): readonly PaletteItem[] {
    const scored: {item: PaletteItem; score: number; mru: number}[] = [];
    for (const command of commands) {
        const title = localize(command.title, locale);
        const titleMatch = matchCommandText(title, query);
        const idMatch = matchCommandText(command.id, query);
        const titleWins = titleMatch !== null && (idMatch === null || titleMatch.score <= idMatch.score);
        const match = titleWins ? titleMatch : idMatch;
        if (match === null) continue;
        scored.push({
            item: {
                id: command.id,
                label: title,
                description: command.description,
                category: command.category === undefined ? undefined : localize(command.category, locale),
                shortcut: command.keybinding,
                labelMatches: titleWins ? match.ranges : undefined,
            },
            score: match.score,
            mru: recent.indexOf(command.id),
        });
    }
    scored.sort((left, right) => left.score - right.score || compareMru(left.mru, right.mru) || compareCodePoints(left.item.id, right.item.id));
    return scored.map((entry) => entry.item);
}

/**
 * 选择模式的候选：标签与说明都参与匹配、取较低分，只有标签命中才渲染片段；按匹配分排，同分保持请求里的次序
 * （请求方已经排好，例如登记顺序）。
 */
export function searchPickItems(items: ReadonlyArray<QuickPickItem>, query: string): readonly PaletteItem[] {
    const scored: {item: PaletteItem; score: number; index: number}[] = [];
    items.forEach((candidate, index) => {
        const labelMatch = matchCommandText(candidate.label, query);
        const detailMatch = candidate.detail === undefined ? null : matchCommandText(candidate.detail, query);
        const labelWins = labelMatch !== null && (detailMatch === null || labelMatch.score <= detailMatch.score);
        const match = labelWins ? labelMatch : detailMatch;
        if (match === null) return;
        scored.push({item: {id: candidate.id, label: candidate.label, description: candidate.detail, labelMatches: labelWins ? match.ranges : undefined}, score: match.score, index});
    });
    scored.sort((left, right) => left.score - right.score || left.index - right.index);
    return scored.map((entry) => entry.item);
}
