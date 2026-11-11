/**
 * 一次修订“带来的变化”（canon.revisions 输出 6）写成给作者看的几句：多了、少了几条待处理，哪些值跟着变了，几条情节套不上了
 * （docs/specs/canon/author-ui.md 输出 16 的预览、输出 20 的回执、输出 22 的还原）。三处共用这一份写法。
 */

import {displayText} from "@notnotype/nb-canon/schema";
import type {Impact} from "@notnotype/nb-canon";

import type {CanonBoundText} from "./positions";

export interface ImpactOptions {
    /** 一个地址写成什么（“存款”“星瑕的存款”）。 */
    readonly address: (at: {readonly entry: string; readonly path: string}) => string;
    /** 不写的值（就地改的预览不重复写正在改的那个）。 */
    readonly skip?: (at: {readonly entry: string; readonly path: string}) => boolean;
    /** `follows` 写“跟着变成 X”（预览），`change` 写“X → Y”（回执、还原）。 */
    readonly values: "follows" | "change";
}

export function impactLines(impact: Impact, options: ImpactOptions, text: CanonBoundText): string[] {
    const lines: string[] = [];
    if (impact.pendingAdded.length > 0) lines.push(text("edit.pendingAdded", {count: impact.pendingAdded.length}));
    if (impact.pendingResolved.length > 0) lines.push(text("edit.pendingResolved", {count: impact.pendingResolved.length}));
    for (const value of impact.values) {
        if (options.skip?.(value.at) === true) continue;
        const label = options.address(value.at);
        lines.push(options.values === "follows"
            ? text("edit.valueFollows", {label, value: displayText(value.after)})
            : text("impact.value", {label, before: displayText(value.before), after: displayText(value.after)}));
    }
    const broken = impact.broken.length + (impact.brokenOn?.length ?? 0);
    if (broken > 0) lines.push(text("impact.broken", {count: broken}));
    if (lines.length === 0) lines.push(text("edit.noImpact"));
    return lines;
}
