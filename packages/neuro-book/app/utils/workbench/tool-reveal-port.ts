/**
 * 工具揭示端口：Agent（客户端变量 patch）与真实工作台之间**唯一**的写入口。
 *
 * `client.ide.activePanel` 的写入不是"改一个 store 字段"：它要选中工具 View 生效的容器、打开目标 Part、
 * 清掉内容收起，再按真实可见性发布工具焦点。这些只有页面级的位置会话（`view-placements-session`）能做，
 * 因此页面登记一个端口，两个写者（`AgentChatSurface`、`useInlineEditorAgentController`）通过它写入——
 * 组件不再自己改 store，也不再留下第二套"活动页签"状态。
 *
 * 端口按**生命周期**登记/释放：页面重建时旧宿主的 cleanup 只摘掉自己那一次登记，不会摘掉新宿主的端口。
 * 未登记时调用显式失败（`unregistered`），绝不静默当成功。
 */

import type {NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {ToolPartId} from "nbook/app/utils/workbench/view-placements";

/**
 * 一次揭示的回执。
 *
 * `persisted` 只表达位置记录的落盘结果：`pending` 是"UI 已应用、保存还没确认"，
 * 调用方据此确认已应用的 UI 状态，但**不得**把它说成已保存。
 */
export type WorkbenchToolRevealOutcome =
    | {
        readonly status: "revealed";
        readonly partId: ToolPartId;
        readonly viewId: string;
        readonly persisted: "saved" | "unchanged" | "pending";
    }
    | {readonly status: "cleared"}
    | {readonly status: "rejected"; readonly diagnosis: string};

/**
 * 页面登记的工具揭示端口。
 *
 * - `capability()`：本宿主**真实**能揭示的页签（来自已登记的 View，不是静态词表）；
 * - `reveal(panel)`：揭示页签；`null` 只清工具焦点上下文，不动任何 Part 的显隐。
 */
export type WorkbenchToolRevealPort = {
    capability(): readonly NovelIdeTab[];
    reveal(panel: NovelIdeTab | null): Promise<WorkbenchToolRevealOutcome>;
};

let currentPort: WorkbenchToolRevealPort | null = null;

/** 登记当前页面唯一的揭示端口，返回按生命周期释放的句柄。 */
export function registerWorkbenchToolRevealPort(port: WorkbenchToolRevealPort): () => void {
    currentPort = port;
    return () => {
        if (currentPort === port) {
            currentPort = null;
        }
    };
}

/** 当前登记的端口；没有宿主时是 `null`（调用方必须显式拒绝）。 */
export function workbenchToolRevealPort(): WorkbenchToolRevealPort | null {
    return currentPort;
}

/** 统一调用入口：未登记返回 `unregistered` 这个**单独**的失败形态，由调用方转成用户可读的 ack。 */
export async function revealWorkbenchToolPanel(
    panel: NovelIdeTab | null,
): Promise<WorkbenchToolRevealOutcome | {readonly status: "unregistered"}> {
    const port = currentPort;
    if (port === null) {
        return {status: "unregistered"};
    }
    return await port.reveal(panel);
}
