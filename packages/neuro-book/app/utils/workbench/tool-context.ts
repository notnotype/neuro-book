/**
 * 工具视图焦点与 Agent 客户端上下文（纯逻辑）。
 *
 * 工作台里的 **View** 才可能是 Agent 能看见的工具：`WorkbenchToolViewFocus` 记录"当前哪个 Part 的
 * 哪个工具 View 真实可见"，`resolveClientActivePanel` 是它到 DTO `client.ide.activePanel` 的**唯一映射**。
 *
 * 两条边界：
 * - 映射只认登记表里的 View id（目前只有 `nbook.files` → `files`）。`characters` / `plot` 是旧页签词表里的
 *   名字，工作台没有对应 View，因此映射成 `null`，**不**靠静态词表谎报它们可用；
 * - 映射**不**限制 View 当前落在哪个 Part：文件工具被搬到右栏或底部面板，对 Agent 依然是 `files`。
 *
 * 本文件不 import Vue、不读 store：真实可见性由页面求值后传进来（`product-catalog` 的类型只在类型位置使用）。
 */

import type {NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {WorkbenchViewPresentation} from "nbook/app/utils/workbench/product-catalog";
import {TOOL_PART_IDS, type ToolPartId} from "nbook/app/utils/workbench/view-placements";

/**
 * 工具视图焦点：Part + View id；`null` 表示当前没有对 Agent 可见的工具。
 *
 * 它是**运行期**事实（非持久）：页面按实际呈现发布，卸载或切工作面后清空。
 */
export type WorkbenchToolViewFocus = Readonly<{partId: ToolPartId; viewId: string}> | null;

/**
 * View id → 客户端变量里的工具页签名。**唯一**映射表。
 *
 * 加一条就等于"这个 View 接入 Agent 上下文"：没有条目的 View 对 Agent 不可见，
 * 因此不在这里登记任何还未接入业务的工具名。
 */
const CLIENT_TOOL_PANELS: Readonly<Record<string, NovelIdeTab>> = {"nbook.files": "files"};

/** 当前接入 Agent 上下文的工具页签（揭示端口的能力口径）。 */
export function clientToolPanels(): readonly NovelIdeTab[] {
    return Object.values(CLIENT_TOOL_PANELS);
}

/** View id → 页签名；未登记返回 `null`（不猜 characters/plot）。 */
export function clientPanelOfToolView(viewId: string): NovelIdeTab | null {
    return Object.hasOwn(CLIENT_TOOL_PANELS, viewId) ? CLIENT_TOOL_PANELS[viewId]! : null;
}

/** 页签名 → View id；没有接入的页签返回 `null`（揭示命令的反查）。 */
export function clientToolViewIdOf(panel: NovelIdeTab): string | null {
    for (const [viewId, mapped] of Object.entries(CLIENT_TOOL_PANELS)) {
        if (mapped === panel) {
            return viewId;
        }
    }
    return null;
}

/**
 * 焦点 → DTO `client.ide.activePanel`。三处读者（Agent 侧栏、内联控制器、Profile 可视化编辑器）
 * 共用这一份换算，不各写一份 `isNovelIdeTab` 判断。
 */
export function resolveClientActivePanel(focus: WorkbenchToolViewFocus): NovelIdeTab | null {
    return focus === null ? null : clientPanelOfToolView(focus.viewId);
}

/** 焦点是否指向同一个工具（含双方都为 `null`）：发布前用它避免同一语义重复写 store。 */
export function sameToolFocus(left: WorkbenchToolViewFocus, right: WorkbenchToolViewFocus): boolean {
    if (left === null || right === null) {
        return left === right;
    }
    return left.partId === right.partId && left.viewId === right.viewId;
}

/**
 * 从真实呈现求当前工具焦点：按固定 Part 顺序（left → right → panel）取**活动容器**里第一个可见、
 * 且已登记到客户端上下文的 View。
 *
 * 不算"真实可见"的三种情况：View 被 `when` 藏起来（不在 `container.views` 里）、它的容器不是该 Part 的
 * 活动容器（屏幕上显示的是另一个容器）、Part 的内容不在屏幕上（书架遮罩 / 显式隐藏 / 拖收起，
 * 由调用方通过 `unavailableParts` 传入）。
 */
export function resolveActiveToolView(input: {
    readonly presentation: WorkbenchViewPresentation | null;
    readonly unavailableParts?: readonly ToolPartId[];
}): WorkbenchToolViewFocus {
    const {presentation} = input;
    if (presentation === null) {
        return null;
    }
    const unavailable = input.unavailableParts ?? [];
    for (const partId of TOOL_PART_IDS) {
        if (unavailable.includes(partId)) {
            continue;
        }
        const activeContainerId = presentation.part(partId).activeContainerId;
        if (activeContainerId === null) {
            continue;
        }
        const container = presentation.container(activeContainerId);
        if (container === null) {
            continue;
        }
        const entry = container.views.find((candidate) => clientPanelOfToolView(candidate.view.id) !== null);
        if (entry !== undefined) {
            return {partId, viewId: entry.view.id};
        }
    }
    return null;
}
