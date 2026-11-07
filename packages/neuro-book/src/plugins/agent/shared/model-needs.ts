/**
 * Profile 声明的模型能力与解析到的模型比（docs/specs/agent/profile-settings.md 输出 9，conversation.md 输出 32）。只提示，不拦：设置页与
 * 对话的输入框上方共用这一份，同一个模型两处说法一样。
 */

import type {AgentProfileDeclaration} from "./points";

export interface ModelCapabilities {
    readonly vision: boolean;
    readonly reasoning: boolean;
    /** 未知（自定义模型没写）时不算小于。 */
    readonly contextWindow: number | null;
}

export type ModelNeedGap =
    | {readonly kind: "vision"}
    | {readonly kind: "thinking"}
    | {readonly kind: "context"; readonly need: number; readonly have: number};

export function modelNeedGaps(needs: AgentProfileDeclaration["modelNeeds"], model: ModelCapabilities): ModelNeedGap[] {
    const gaps: ModelNeedGap[] = [];
    if (needs?.vision === true && !model.vision) gaps.push({kind: "vision"});
    if (needs?.thinking === true && !model.reasoning) gaps.push({kind: "thinking"});
    if (needs?.minContext !== undefined && model.contextWindow !== null && model.contextWindow < needs.minContext) gaps.push({kind: "context", need: needs.minContext, have: model.contextWindow});
    return gaps;
}
