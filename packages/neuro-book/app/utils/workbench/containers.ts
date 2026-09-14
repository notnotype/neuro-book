/**
 * 外壳的容器声明（产品侧的 descriptor 取值）。
 *
 * #192 阶段 1 只落左右两个**容器部件**：它们承载的视图（文件树 / 角色 / 情节、Agent 会话与对话面）
 * 在后续批次按提案的迁移顺序迁入；本批内容区留演示文案，不挂业务视图，也不动现有固定槽位。
 *
 * `location` 是容器的**默认**落位，不是实际位置：`resolveLocationPart` 把它求值成承载它的 Part
 * （`sidebar-left` → `left`、`sidebar-right` → `right`），与 `WorkbenchShell` 的叶、`index.vue`
 * 的槽位一一对应。用户覆盖（`workbench.views.customizations`）与布局快照是后续阶段的事。
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
