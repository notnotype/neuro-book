/**
 * 选择器的思考档状态：宿主给了 `effort` 就用它；旧宿主只有 `thinkingLevels` 与 `thinking`，按下面的规则推出（缺省
 * 行为与以前一致：多于一档才有控件）。
 */

import type {ComposerEffortView, ComposerView} from "./types";

export function effortViewOf(composer: Pick<ComposerView, "effort" | "thinkingLevels" | "thinking">): ComposerEffortView {
    if (composer.effort !== undefined) return composer.effort;
    const canOff = composer.thinkingLevels.includes("off");
    const levels = composer.thinkingLevels.filter((level) => level !== "off");
    const kind = composer.thinkingLevels.length === 0 ? "none" : composer.thinkingLevels.length === 1 ? "fixed" : "levels";
    return {kind, levels, canOff, verified: true, value: composer.thinking, source: composer.thinking === null ? null : "session", follow: null};
}
