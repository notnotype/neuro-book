/**
 * 停靠区借用向导的外框（`AgentWizardFrame` 的停靠变体）：审批、提问、模式切换三种向导照常画自己的内容，外框从这里读停靠区的标题行——
 * 来源（图标换成子代理的、标题写“子代理「名字」”）、“第 n / m 个”、上一个、下一个、打开子会话。只有 `AgentDock` 提供它，
 * 同步向导里读到的是 null。
 */

import type {ComputedRef, InjectionKey} from "vue";

export type DockFrame = {
    readonly source?: {readonly sessionId: string; readonly name: string; readonly icon: string};
    /** “第 n / m 个”；只有一个时不给。 */
    readonly count?: string;
    /** 不可用时不给。 */
    readonly previous?: () => void;
    readonly next?: () => void;
    readonly open?: () => void;
};

export const dockFrameKey: InjectionKey<ComputedRef<DockFrame>> = Symbol("nb-agent-ui/dock-frame");
