/**
 * 命令面板的查询解析与匹配：前缀路由、子序列评分与 UTF-16 命中片段。
 *
 * 纯函数：不读 store、不碰 DOM，候选从哪来、activeId 与执行时机都归宿主。
 * 扫描按 Unicode code point 做，range 映回 UTF-16 —— 代理对不能被劈开，否则标亮会把一个
 * 字符渲染成半个。
 */
import type {QuickInputItem} from "@notnotype/nb-ui/components";
import type {CommandMetadata} from "nbook/app/utils/workbench/commands";

type QueryMode = "commands" | "line";

type ParsedQuery = Readonly<{mode: QueryMode; text: string}>;

/** 面板只有两种模式：`>` 命令（可省略）、`:` 行号。其它符号（含 `@`）都是普通命令文本。 */
export function parseCommandQuery(query: string): ParsedQuery {
    if (query.startsWith(">")) {
        return {mode: "commands", text: query.slice(1).trim()};
    }
    if (query.startsWith(":")) {
        return {mode: "line", text: query.slice(1).trim()};
    }
    return {mode: "commands", text: query.trim()};
}

/** 行号文本 → 行号：只认十进制正整数，且必须是 safe integer。空串交给调用方给提示。 */
export function parseLineNumber(text: string): number | null {
    if (!/^[1-9]\d*$/u.test(text)) {
        return null;
    }
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
}

type TextMatch = Readonly<{score: number; ranges: readonly (readonly [number, number])[]}>;

/** code point 列表与每个 code point 的 UTF-16 起始偏移（最后一项是总长度）。 */
function splitCodePoints(value: string): {points: string[]; offsets: number[]} {
    const points = Array.from(value);
    const offsets: number[] = [0];
    for (const point of points) {
        offsets.push(offsets[offsets.length - 1]! + point.length);
    }
    return {points, offsets};
}

function samePoint(left: string, right: string): boolean {
    return left === right || left.toLowerCase() === right.toLowerCase();
}

/** 把连续位置合并成命中的 UTF-16 区段。 */
function runsToRanges(positions: readonly number[], offsets: readonly number[]): readonly (readonly [number, number])[] {
    const ranges: (readonly [number, number])[] = [];
    let start = positions[0]!;
    let end = start;
    for (let index = 1; index < positions.length; index += 1) {
        const position = positions[index]!;
        if (position === end + 1) {
            end = position;
            continue;
        }
        ranges.push([offsets[start]!, offsets[end + 1]!]);
        start = position;
        end = position;
    }
    ranges.push([offsets[start]!, offsets[end + 1]!]);
    return ranges;
}

/**
 * 子序列匹配。分数越小越靠前：精确 0、前缀 1、连续包含 2+起点、非连续 100+10×间隔数+起点。
 * 未命中返回 null；空查询对任何文本都命中（分数 0、无片段）。
 */
export function matchCommandText(text: string, query: string): TextMatch | null {
    if (query === "") {
        return {score: 0, ranges: []};
    }
    const target = splitCodePoints(text);
    const needle = splitCodePoints(query).points;
    if (needle.length > target.points.length) {
        return null;
    }

    if (needle.length === target.points.length && needle.every((point, index) => samePoint(point, target.points[index]!))) {
        return {score: 0, ranges: [[0, text.length]]};
    }
    if (needle.every((point, index) => samePoint(point, target.points[index]!))) {
        return {score: 1, ranges: [[0, target.offsets[needle.length]!]]};
    }
    for (let start = 1; start + needle.length <= target.points.length; start += 1) {
        if (needle.every((point, index) => samePoint(point, target.points[start + index]!))) {
            return {
                score: 2 + start,
                ranges: [[target.offsets[start]!, target.offsets[start + needle.length]!]],
            };
        }
    }

    const positions: number[] = [];
    let cursor = 0;
    for (const point of needle) {
        let found = -1;
        for (let index = cursor; index < target.points.length; index += 1) {
            if (samePoint(point, target.points[index]!)) {
                found = index;
                break;
            }
        }
        if (found === -1) {
            return null;
        }
        positions.push(found);
        cursor = found + 1;
    }
    let gaps = 0;
    for (let index = 1; index < positions.length; index += 1) {
        if (positions[index]! !== positions[index - 1]! + 1) {
            gaps += 1;
        }
    }
    return {score: 100 + 10 * gaps + positions[0]!, ranges: runsToRanges(positions, target.offsets)};
}

/** 同分时按 id 的 Unicode code point 升序（与 UTF-16 码元序在代理对上不同）。 */
function compareCodePoints(left: string, right: string): number {
    const leftPoints = Array.from(left);
    const rightPoints = Array.from(right);
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
        const leftValue = leftPoints[index]!.codePointAt(0)!;
        const rightValue = rightPoints[index]!.codePointAt(0)!;
        if (leftValue !== rightValue) {
            return leftValue < rightValue ? -1 : 1;
        }
    }
    return leftPoints.length - rightPoints.length;
}

/**
 * 把候选命令折成 QuickInput 项：标题与 id 都参与匹配、取较低分，只有标题命中才渲染片段；
 * 排序为「匹配分为主、MRU 为次、同分 id 升序」，空查询因此只按 MRU/id 排。
 * 调用方（宿主）先过滤 human!=false 与 when，本函数不解释可见性。
 */
export function searchCommands(
    commands: readonly CommandMetadata[],
    query: string,
    titleOf: (key: string) => string,
    recent: readonly string[],
): readonly QuickInputItem[] {
    const scored: {item: QuickInputItem; score: number; mru: number}[] = [];

    for (const command of commands) {
        const title = titleOf(command.titleKey);
        const titleMatch = matchCommandText(title, query);
        const idMatch = matchCommandText(command.id, query);
        const titleWins = titleMatch !== null && (idMatch === null || titleMatch.score <= idMatch.score);
        const match = titleWins ? titleMatch : idMatch;
        if (match === null) {
            continue;
        }
        scored.push({
            item: {
                id: command.id,
                label: title,
                description: command.description,
                category: command.categoryKey === undefined ? undefined : titleOf(command.categoryKey),
                iconClass: command.icon,
                shortcut: command.defaultKeybinding,
                labelMatches: titleWins ? match.ranges : undefined,
            },
            score: match.score,
            mru: recent.indexOf(command.id),
        });
    }

    scored.sort((left, right) => left.score - right.score
        || compareMru(left.mru, right.mru)
        || compareCodePoints(left.item.id, right.item.id));
    return scored.map((entry) => entry.item);
}

/** MRU 缺失（-1）排在所有命中之后。 */
function compareMru(left: number, right: number): number {
    if (left === right) {
        return 0;
    }
    if (left === -1) {
        return 1;
    }
    if (right === -1) {
        return -1;
    }
    return left - right;
}
