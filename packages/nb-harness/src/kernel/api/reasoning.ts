/**
 * 一次请求实际用哪一档（纯函数，不依赖 OMP，前后端的宿主都能用）。模型能做什么见 `model/reasoning.ts` 的 `reasoningOf`。
 * 行为规则见 docs/specs/models/service.md 的“角色的思考档”与 docs/specs/harness/models.md。
 */

import type {EffortSource, ModelInfo} from "./model.js";

/** 从低到高；同 OMP 的 `THINKING_EFFORTS`，夹取要按它的顺序。 */
const ORDER: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** 一次请求用的档，以及界面“跟随”态要写的那一档。 */
export interface RequestEffort {
    /** 交给适配器的档；不指定时不写。 */
    readonly effort?: string;
    /** 显式关掉思考；只在 `reasoning.off === "disable"` 且选了关闭时。 */
    readonly disableReasoning?: true;
    /** 夹取之后的有效档：`off`、档位，或 null（不指定且模型没有默认档）。 */
    readonly effective: string | null;
    readonly source: EffortSource | null;
}

/**
 * 请求的档位优先级：会话里明确选的，其次解析到的角色的默认档，都没有就不发（模型按自己的默认）。
 * 选的档不在模型的档里时夹到不高于它的最近一档，没有就取最低档（同 OMP 的 `clampThinkingLevelForModel`）。
 * 端口没给 `reasoning` 时照旧：选了什么发什么，由适配器夹取。
 */
export function requestEffort(session: string | null, resolution: {readonly info: ModelInfo; readonly defaultEffort?: string}): RequestEffort {
    const chosen = session ?? resolution.defaultEffort ?? null;
    const source: EffortSource | null = session !== null ? "session" : resolution.defaultEffort !== undefined ? "role" : null;
    const reasoning = resolution.info.reasoning;
    if (reasoning === undefined) return chosen === null ? {effective: null, source: null} : {effort: chosen, effective: chosen, source};
    if (reasoning.kind !== "levels") return {effective: null, source: null};
    if (chosen === null) return {effective: reasoning.unset, source: reasoning.unset === null ? null : "model"};
    if (chosen === "off" && reasoning.off === "disable") return {disableReasoning: true, effective: "off", source};
    // 选了关闭但不能真关：落到 OMP 在强制思考时垫的那一档（`unset`），没有就是最低档。
    const floor = reasoning.unset !== null && reasoning.unset !== "off" ? reasoning.unset : reasoning.levels[0]!;
    const level = clamp(reasoning.levels, chosen === "off" ? floor : chosen);
    return level === undefined ? {effective: null, source: null} : {effort: level, effective: level, source};
}

function clamp(levels: readonly string[], requested: string): string | undefined {
    if (levels.includes(requested)) return requested;
    const index = ORDER.indexOf(requested);
    if (index === -1) return undefined;
    let found: string | undefined;
    for (const level of levels) {
        if (ORDER.indexOf(level) > index) break;
        found = level;
    }
    return found ?? levels[0];
}
