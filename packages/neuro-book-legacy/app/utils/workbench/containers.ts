/**
 * 外壳的容器声明（产品侧的 descriptor 取值）。
 *
 * 三个**容器部件**各承载一类工具视图：左栏工具（文件树 / 角色 / 情节）、右栏（Agent 会话与对话面，
 * 视图迁入见提案的迁移顺序）、底部面板（本轮新增，与左右栏同为可接收工具视图的落点）。
 *
 * `location` 是容器的**默认**落位，不是实际位置：`resolveLocationPart` 把它求值成承载它的 Part
 * （`sidebar-left` → `left`、`sidebar-right` → `right`、`panel` → `panel`），与 `WorkbenchShell`
 * 的叶、`index.vue` 的槽位一一对应。用户把整个容器搬到别的落位后，实际落位记在
 * `workbench.views/customizations` 的 `containerPlacements`（见 `view-placements.ts`）：
 * 容器移动**不**递归搬动它承载的视图，视图归属仍是同一份记录里的 `placements`。
 *
 * 三个容器都没有声明 `canMoveContainer: false`：它们都可以被用户整体搬到别的落位。
 * 声明 false 只用于"产品上钉死"的容器——那种容器不出现在容器移动入口与别的容器的落点清单里。
 *
 * 标题只存 key（提案开放问题 1 取值 b）：解析归宿主，这里不存译文——
 * `index.vue` 用 `t(titleKey)` 解析后传给容器部件。
 */
import type {ContainerDescriptor} from "nbook/app/utils/workbench/descriptors";

/** 主侧栏容器：承载文件树 / 角色 / 情节这类工具视图（后续批次迁入）。 */
export const SHELL_LEFT_CONTAINER: ContainerDescriptor = {
    id: "nbook.tools",
    titleKey: "ide.workbench.container.tools",
    icon: "i-lucide-files",
    location: "sidebar-left",
    order: 10,
};

/** 右侧栏容器：承载 Agent 会话与对话面（后续批次迁入）。 */
export const SHELL_RIGHT_CONTAINER: ContainerDescriptor = {
    id: "nbook.agent",
    titleKey: "ide.workbench.container.agent",
    icon: "i-lucide-bot",
    location: "sidebar-right",
    order: 20,
};

/**
 * 底部面板容器：承载可停放在底部的工具视图（本轮先从左右栏移入文件树验证这条通道）。
 *
 * 默认**不放假终端/假日志**：面板里没有可见视图时显示的是"这里可以接收工具视图"的空态，
 * 而不是一个看起来能用、实际没有数据来源的演示面板。
 */
export const SHELL_PANEL_CONTAINER: ContainerDescriptor = {
    id: "nbook.panel",
    titleKey: "ide.workbench.container.panel",
    icon: "i-lucide-panel-bottom",
    location: "panel",
    order: 30,
};
