/**
 * 产品侧的 Workbench 声明清单与注册表（L1 内置注册路径的组装点）。
 *
 * 本文件是容器 / 视图声明的**唯一产品来源**：`containers.ts` 放容器，视图在这里登记；
 * 注册表按静态清单构造一次（声明不随运行期变化），查表一律走 `createWorkbenchRegistry` 的求值，
 * 不在调用方各写一份 `find` / 字面量。
 *
 * 迁移位置：`files` 视图是提案迁移顺序的第 3 步（[workbench-view-host](../../../../packages/neuro-book/docs/proposals/workbench-view-host.md):247），
 * 角色 / 情节 / 编辑器叶仍未迁入；叶的几何仍是外壳的固定骨架，所以 Part descriptor 暂为空。
 */

import {
    createWorkbenchRegistry,
    DEFAULT_VIEW_LAYOUT_CONTRACT,
    evaluateWhen,
    resolveViewLayout,
    type DescriptorResult,
    type ViewDescriptor,
    type ViewLayoutContract,
    type WorkbenchCatalog,
    type WorkbenchContext,
    type WorkbenchRegistry,
} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";

/**
 * `files` 视图：左容器里的工作区文件树。
 *
 * - `when.requires: ["project"]`：只有 Project 打开时才渲染（书架 / 用户资产工作面没有文件树语义，
 *   与接入前 `NovelIdeActivityBar` 对 `files` 入口的判据同源）；
 * - `requiredAuthority: ["files"]`：动作可用性看 `/api/workspace-files/*` 这条 authority，与可见性分开；
 * - `layout: "fill"`：文件面板自己占满内容区并管内部滚动（外壳不给留白、不代管滚动）；
 * - `stateScope: "user"`：展开项等 memento 归 User Storage（`persistence.md:98`）。
 *
 * `canToggleVisibility` / `canMoveView` 按**当前真实能力**声明：视图可见性开关与跨容器移动都还没有
 * 消费者（第一版宿主只渲染，不做拖动与隐藏落账），因此不声明做不到的能力。
 */
export const SHELL_FILES_VIEW: ViewDescriptor = {
    id: "nbook.files",
    titleKey: "ide.toolPanel.files",
    icon: "i-lucide-files",
    container: SHELL_LEFT_CONTAINER.id,
    layout: "fill",
    when: {requires: ["project"]},
    requiredAuthority: ["files"],
    order: 10,
    weight: 1,
    canToggleVisibility: false,
    canMoveView: false,
    factoryKey: "nbook.view.files",
    stateScope: "user",
};

const PRODUCT_CATALOG: WorkbenchCatalog = {
    /** 叶仍是外壳的固定骨架（`WorkbenchShell.vue`）：没有消费者前不声明 Part descriptor。 */
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER],
    views: [SHELL_FILES_VIEW],
};

let productRegistry: DescriptorResult<WorkbenchRegistry> | null = null;

/** 产品注册表；清单非法时保留失败原因（调用方把它显示出来，不吞成空白容器）。 */
export function productWorkbenchRegistry(): DescriptorResult<WorkbenchRegistry> {
    productRegistry ??= createWorkbenchRegistry(PRODUCT_CATALOG);
    return productRegistry;
}

/** 容器内视图的求值结果：可见的、求值失败的、以及不可见的原因，三类都交回调用方。 */
export type ContainerViewResolution = {
    readonly views: readonly ViewDescriptor[];
    /** 求值失败（未登记的 `when` 取值一类）：视图不渲染，但原因必须可见。 */
    readonly problems: readonly string[];
    /** 不可见视图的 `when.requires` 原因；空状态用它说明"为什么这里没有内容"。 */
    readonly hidden: readonly {readonly id: string; readonly reasons: readonly string[]}[];
};

/** 按 `when` 求值容器内视图：可见性只决定看不看得见，不参与权限判断。 */
export function resolveContainerViews(
    registry: WorkbenchRegistry,
    containerId: string,
    context: WorkbenchContext,
): ContainerViewResolution {
    const resolved = registry.viewsOf(containerId);
    if (!resolved.ok) {
        return {views: [], problems: [resolved.reason], hidden: []};
    }
    const views: ViewDescriptor[] = [];
    const problems: string[] = [];
    const hidden: {id: string; reasons: readonly string[]}[] = [];
    for (const view of resolved.value) {
        const evaluation = evaluateWhen(view.when, context);
        if (!evaluation.ok) {
            problems.push(`${view.id}：${evaluation.reason}`);
            continue;
        }
        if (evaluation.value.visible) {
            views.push(view);
        } else {
            hidden.push({id: view.id, reasons: evaluation.value.reasons});
        }
    }
    return {views, problems, hidden};
}

/** 内容区合同：第一个可见视图的 `layout`；没有可见视图时用默认合同（外壳给留白、拥有滚动）。 */
export function layoutContractOfViews(views: readonly ViewDescriptor[]): ViewLayoutContract {
    const first = views[0];
    if (first === undefined) {
        return DEFAULT_VIEW_LAYOUT_CONTRACT;
    }
    const resolved = resolveViewLayout(first.layout);
    return resolved.ok ? resolved.value : DEFAULT_VIEW_LAYOUT_CONTRACT;
}
