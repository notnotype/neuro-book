/**
 * 一次修订“带来的变化”（canon.revisions 输出 6）写成给作者看的几句：多了、少了几条待处理，哪些值跟着变了，几条情节套不上了
 * （docs/specs/canon/author-ui.md 输出 16 的预览、输出 20 的回执、输出 22 的还原）。三处共用这一份写法。改动记录的一行只写一句
 * 摘要（输出 24），也在这里。
 */

import type {Impact} from "@notnotype/nb-canon";

import type {CanonBoundText} from "./positions";
import {shownValue} from "./rows";

export interface ImpactOptions {
    /** 一个地址写成什么（“存款”“星瑕的存款”）。 */
    readonly address: (at: {readonly entry: string; readonly path: string}) => string;
    /** 不写的值（就地改的预览不重复写正在改的那个）。 */
    readonly skip?: (at: {readonly entry: string; readonly path: string}) => boolean;
    /** `follows` 写“跟着变成 X”（预览），`change` 写“X → Y”（回执、还原）。 */
    readonly values: "follows" | "change";
}

/** 除了 `skip` 掉的值，这次修订没有带来别的变化（`impactLines` 只会写那一句“别的都不变”）。 */
export function impactIsQuiet(impact: Impact, skip?: ImpactOptions["skip"]): boolean {
    return impact.pendingAdded.length === 0 && impact.pendingResolved.length === 0 && impact.broken.length + (impact.brokenOn?.length ?? 0) === 0
        && impact.values.every((value) => skip?.(value.at) === true);
}

export function impactLines(impact: Impact, options: ImpactOptions, text: CanonBoundText): string[] {
    const lines: string[] = [];
    if (impact.pendingAdded.length > 0) lines.push(text("edit.pendingAdded", {count: impact.pendingAdded.length}));
    if (impact.pendingResolved.length > 0) lines.push(text("edit.pendingResolved", {count: impact.pendingResolved.length}));
    for (const value of impact.values) {
        if (options.skip?.(value.at) === true) continue;
        const label = options.address(value.at);
        // 主文字的块：值是带字段引用的源文，不写给作者，只说改了。
        if (value.at.path.startsWith("text[")) {
            lines.push(text("impact.textChanged", {label}));
            continue;
        }
        lines.push(options.values === "follows"
            ? text("edit.valueFollows", {label, value: shownValue(value.after, text)})
            : text("impact.value", {label, before: shownValue(value.before, text), after: shownValue(value.after, text)}));
    }
    const broken = impact.broken.length + (impact.brokenOn?.length ?? 0);
    if (broken > 0) lines.push(text("impact.broken", {count: broken}));
    if (lines.length === 0) lines.push(text("edit.noImpact"));
    return lines;
}

/**
 * 改动记录一行里的一句摘要（输出 24）：几处值变了、多了或少了几条待处理、几条套不上了。主文字的几块算一处（回执里也只写“改了”），
 * 都没有时写“没有带来别的变化”。
 */
export function impactSummary(impact: Impact, text: CanonBoundText): string {
    const texts = new Set(impact.values.filter((value) => value.at.path.startsWith("text[")).map((value) => value.at.entry));
    const values = impact.values.filter((value) => !value.at.path.startsWith("text[")).length + texts.size;
    const parts: string[] = [];
    if (values > 0) parts.push(text("revisions.values", {count: values}));
    if (impact.pendingAdded.length > 0) parts.push(text("edit.pendingAdded", {count: impact.pendingAdded.length}));
    if (impact.pendingResolved.length > 0) parts.push(text("edit.pendingResolved", {count: impact.pendingResolved.length}));
    const broken = impact.broken.length + (impact.brokenOn?.length ?? 0);
    if (broken > 0) parts.push(text("impact.broken", {count: broken}));
    return parts.length === 0 ? text("revisions.noImpact") : parts.join(text("revisions.separator"));
}
