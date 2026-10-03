/**
 * 工作台外壳的命令目录：**框架层**标题操作 + View 标题动作的路由。
 *
 * 三层标题操作里，本文件管两头：
 * - 框架层（Panel 位置 / 对齐 / 隐藏 / 收起 / 最大化、工具 View 移动）在这里注册成 canonical 命令，
 *   菜单只是它们的第二入口——可用性判定 `evaluatePanelAction` 被命令 `run` 与菜单求值**共用一份**，
 *   不给菜单另写一套「什么时候能点」。
 * - View 层（`nbook.view.refresh-files` 这类）由 `registerViewTitleCommands` 按宿主白名单注册：
 *   命令只做参数校验与代际传递，真正的执行命中的是 View 实例给的句柄（`port.runAction`），
 *   不在注册表里再建一条执行总线。
 *
 * 端口是**结构化**的：本模块不 import 位置会话 / 布局会话的实现（那些归各自的 owner），
 * 只声明自己需要的那几个方法，页面与 Lab 用谁实现都行。
 *
 * 保存语义在全模块只有一条：`saved` / `unchanged` 才是已确认的落盘结果；`pending` 是**已接纳但未保存**，
 * 按成功返回值带回原诊断（会话提示与 retry/abandon 仍归会话）；`rejected` 一律转成 `unavailable`，
 * 绝不把没保存的操作报成成功。同值操作先比对，no-op 不产生写入。
 */
import {Type, type TSchema} from "typebox";
import type {CommandDescriptor, CommandRegistry, CommandResult, Release} from "nbook/app/utils/workbench/commands";
import {
    isHorizontalPanelPosition,
    isShellPanelAlignment,
    isShellPanelPosition,
    panelAlignmentApplies,
    panelMaximizable,
    SHELL_PANEL_ALIGNMENTS,
    SHELL_PANEL_POSITIONS,
    type ShellPanelAlignment,
    type ShellPanelPosition,
    type WorkbenchPanelPreferences,
    type WorkbenchPanelState,
} from "nbook/app/utils/workbench/panel-state";
import type {ViewActionTarget, WorkbenchTitleActionItem, WorkbenchTitleActionItems} from "nbook/app/utils/workbench/view-title-actions";
// 只取类型（编译期擦除）：命令层与位置模型不构成运行时依赖，请求形状却只有一份。
import type {
    ContainerMergeRequest,
    ContainerMoveRequest,
    ToolPartId,
    ViewMoveRequest,
} from "nbook/app/utils/workbench/view-placements";

/** 工作台 Part：`window` 是已识别但当前不可呈现的位置，不在这里。 */
const PART_IDS = ["left", "right", "panel"] as const;

/** 框架层命令 id（唯一清单：菜单、宿主与 smoke 都从这里取）。 */
export const SHELL_PANEL_COMMAND_IDS = {
    setPosition: "nbook.view.set-panel-position",
    setAlignment: "nbook.view.set-panel-alignment",
    setHidden: "nbook.view.set-panel-hidden",
    setCollapsed: "nbook.view.set-panel-collapsed",
    toggleMaximized: "nbook.view.toggle-panel-maximized",
    moveView: "nbook.view.move-view",
} as const;

/**
 * 容器层命令 id（唯一清单：菜单、宿主与 smoke 都从这里取）。
 *
 * 容器整体移动、**整组并入（源容器消失）**、Part 活动容器选择、恢复默认落点、重新打开被合并掉的容器、
 * Part 显隐/拖收起、按 View 揭示都走同一条
 * `ShellCommandOutcome` 门禁：调用前重新求值 ready / 来源 / 目标是否存在，不靠点击才发现。
 */
export const SHELL_CONTAINER_COMMAND_IDS = {
    move: "nbook.view.move-container",
    /** 整组并入：源容器的全部成员并进目标，源容器随之消失（一次原子意图）。 */
    merge: "nbook.view.merge-container",
    select: "nbook.view.select-container",
    restore: "nbook.view.restore-container-placement",
    /** 重新打开被合并掉的容器：只清抑制并选中打开原落位。 */
    reopen: "nbook.view.reopen-container",
    setPartVisibility: "nbook.view.set-part-visibility",
    revealView: "nbook.view.reveal-view",
    restoreView: "nbook.view.restore-view-placement",
} as const;

/** 一次保存类调用的回执（结构化端口合同：页面用自己的会话实现它，本模块不认识会话本身）。 */
export type ShellCommandOutcome = Readonly<{
    status: "saved" | "unchanged" | "pending" | "rejected";
    diagnosis: string;
}>;

/**
 * 命令的成功值：`saved` / `unchanged` 是已确认的落盘结果，`pending` 是已接纳但未保存。
 * 瞬时操作（最大化）没有存储写入，回执按 `unchanged`——它从不是 `saved`。
 */
export type ShellCommandValue = Readonly<{
    status: "saved" | "unchanged" | "pending";
    diagnosis: string;
}>;

/**
 * 外壳命令的宿主端口。**`panel` 是完整状态**（含宿主内存里的 `maximized`）：
 * 最大化切换必须读得到当前值，否则 `toggle-panel-maximized` 只能靠猜。
 * `mode` 是当前生效的布局模式（紧凑模式下位置 / 对齐 / 最大化不可用）。
 *
 * 容器层命令（移动 / 选择 / 恢复默认落点 / Part 显隐 / 揭示 View）走同一份端口：命令层只做
 * 「就绪门禁 + 转发」，来源是否已变、锚点是否还在、目标是否可落位都由位置会话在动作边界重新求值。
 */
export type WorkbenchShellCommandPort = Readonly<{
    state(): Readonly<{panel: WorkbenchPanelState; mode: "split" | "compact"; ready: boolean}>;
    setPanelState(patch: Partial<WorkbenchPanelPreferences>): Promise<ShellCommandOutcome>;
    setMaximized(maximized: boolean): void;
    moveView(request: ViewMoveRequest): Promise<ShellCommandOutcome>;
    /** 整体移动一个容器（视图归属、顺序与高度都不变）；来源与锚点由位置会话在动作边界重新求值。 */
    moveContainer(request: ContainerMoveRequest): Promise<ShellCommandOutcome>;
    /** 把源容器的全部成员并进目标容器（一次原子意图，源容器随之消失）。 */
    mergeContainer(request: ContainerMergeRequest): Promise<ShellCommandOutcome>;
    /** 重新打开一个被合并掉的容器：只清抑制并选中打开它的原落位。 */
    reopenContainer(containerId: string): Promise<ShellCommandOutcome>;
    /** 选择一个 Part 的活动容器（同一次合成里显式打开该 Part）。 */
    selectContainer(partId: ToolPartId, containerId: string): Promise<ShellCommandOutcome>;
    /** 恢复某个容器的默认落位（删除它的落位覆盖）。 */
    restoreContainerPlacement(containerId: string): Promise<ShellCommandOutcome>;
    /** 恢复某个 View 的默认位置（删除它的位置覆盖）。 */
    restoreViewPlacement(viewId: string): Promise<ShellCommandOutcome>;
    /** 某个 Part 的显式隐藏（left/right）与拖收起（left/right/panel）。 */
    setPartVisibility(input: Readonly<{partId: ToolPartId; hidden?: boolean; dragCollapsed?: boolean}>): Promise<ShellCommandOutcome>;
    /** 揭示一个 View：选中它生效的容器、打开目标 Part、清掉 View 与 Panel 的内容收起。 */
    revealView(viewId: string): Promise<ShellCommandOutcome>;
}>;

/** View 标题命令的执行端口：命中某个**精确实例**的句柄（代际由 target 携带）。 */
export type WorkbenchViewCommandPort = Readonly<{
    runAction(target: ViewActionTarget, actionId: string): Promise<CommandResult<unknown>>;
}>;

// ── 参数 schema（严格：additionalProperties 关闭，缺字段就是失败） ────────────────

const SET_POSITION_ARGS = Type.Object({
    position: Type.Union(SHELL_PANEL_POSITIONS.map((position) => Type.Literal(position))),
}, {additionalProperties: false});

const SET_ALIGNMENT_ARGS = Type.Object({
    alignment: Type.Union(SHELL_PANEL_ALIGNMENTS.map((alignment) => Type.Literal(alignment))),
}, {additionalProperties: false});

const SET_HIDDEN_ARGS = Type.Object({hidden: Type.Boolean()}, {additionalProperties: false});

const SET_COLLAPSED_ARGS = Type.Object({collapsed: Type.Boolean()}, {additionalProperties: false});

const NO_ARGUMENTS = Type.Object({}, {additionalProperties: false});

const MOVE_VIEW_ARGS = Type.Object({
    viewId: Type.String(),
    sourceContainerId: Type.String(),
    targetContainerId: Type.String(),
    /** 目标容器内的插入锚点；缺省追加到末尾。 */
    beforeViewId: Type.Optional(Type.String()),
}, {additionalProperties: false});

/** 三个可落位的 Part 字面量：与 `ToolPartId` 同源（`window` 只是已识别、不可落位）。 */
const PART_LOCATIONS = ["sidebar-left", "sidebar-right", "panel"] as const;

const MOVE_CONTAINER_ARGS = Type.Object({
    containerId: Type.String(),
    sourceLocation: Type.String(),
    targetLocation: Type.Union(PART_LOCATIONS.map((location) => Type.Literal(location))),
    beforeContainerId: Type.Optional(Type.String()),
}, {additionalProperties: false});

/** 整组并入的参数：与 `ContainerMergeRequest` 逐字段对应，多一个键都不接受。 */
const MERGE_CONTAINER_ARGS = Type.Object({
    sourceContainerId: Type.String(),
    sourceLocation: Type.Union(PART_LOCATIONS.map((location) => Type.Literal(location))),
    targetContainerId: Type.String(),
    targetLocation: Type.Union(PART_LOCATIONS.map((location) => Type.Literal(location))),
    /** 发起时源容器的**全部**已登记生效成员（含 hidden 与 collapsed），顺序是权威。 */
    sourceViewIds: Type.Array(Type.String()),
    beforeViewId: Type.Optional(Type.String()),
    contextKey: Type.String(),
}, {additionalProperties: false});

const REOPEN_CONTAINER_ARGS = Type.Object({containerId: Type.String()}, {additionalProperties: false});

const SELECT_CONTAINER_ARGS = Type.Object({
    partId: Type.Union(PART_IDS.map((part) => Type.Literal(part))),
    containerId: Type.String(),
}, {additionalProperties: false});

const RESTORE_CONTAINER_ARGS = Type.Object({containerId: Type.String()}, {additionalProperties: false});

const SET_PART_VISIBILITY_ARGS = Type.Object({
    partId: Type.Union(PART_IDS.map((part) => Type.Literal(part))),
    hidden: Type.Optional(Type.Boolean()),
    dragCollapsed: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

const REVEAL_VIEW_ARGS = Type.Object({viewId: Type.String()}, {additionalProperties: false});

const RESTORE_VIEW_ARGS = Type.Object({viewId: Type.String()}, {additionalProperties: false});

/**
 * View 标题命令的参数：`{viewId, generation}` 固定形状。
 *
 * 代际由宿主在点击时捕获、经命令原样传给执行端口，因此「切走 View 之后迟到的点击」在句柄层被拒，
 * 而不是作用到新实例上。
 */
export const CONTAINER_COMMAND_ARGS_SCHEMAS = {
    [SHELL_CONTAINER_COMMAND_IDS.move]: MOVE_CONTAINER_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.merge]: MERGE_CONTAINER_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.select]: SELECT_CONTAINER_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.restore]: RESTORE_CONTAINER_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.reopen]: REOPEN_CONTAINER_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.setPartVisibility]: SET_PART_VISIBILITY_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.revealView]: REVEAL_VIEW_ARGS,
    [SHELL_CONTAINER_COMMAND_IDS.restoreView]: RESTORE_VIEW_ARGS,
} as const;

export const VIEW_ACTION_ARGS_SCHEMA = Type.Object({
    viewId: Type.String(),
    generation: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
}, {additionalProperties: false});

// ── 框架动作的可用性（命令 run 与菜单求值共用） ────────────────────────────────

export type PanelActionAvailability = Readonly<
    {available: true}
    | {available: false; reasonKey: string; reason: string}
>;

/**
 * 菜单文案的 i18n key（取值域 → key）。键名与主页 i18n 是同一套：命令 titleKey、子菜单、位置 / 对齐项
 * 与禁用原因都从这里取，宿主只负责把 key 解析成文案。中文短名（`POSITION_LABELS`）只用于命令诊断。
 */
export const PANEL_ACTION_KEYS = {
    position: "ide.workbench.panel.command.position",
    alignment: "ide.workbench.panel.command.alignment",
    hide: "ide.workbench.panel.command.hide",
    show: "ide.workbench.panel.command.show",
    collapse: "ide.workbench.panel.command.collapse",
    expand: "ide.workbench.panel.command.expand",
    maximize: "ide.workbench.panel.command.maximize",
    restore: "ide.workbench.panel.command.restore",
    more: "ide.workbench.panel.more",
    positionBottom: "ide.workbench.panel.position.bottom",
    positionTop: "ide.workbench.panel.position.top",
    positionLeft: "ide.workbench.panel.position.left",
    positionRight: "ide.workbench.panel.position.right",
    alignCenter: "ide.workbench.panel.alignment.center",
    alignLeft: "ide.workbench.panel.alignment.left",
    alignRight: "ide.workbench.panel.alignment.right",
    alignJustify: "ide.workbench.panel.alignment.justify",
    reasonNotReady: "ide.workbench.panel.notReady",
    reasonCompact: "ide.workbench.panel.compactDisabled",
    reasonNeedsCenter: "ide.workbench.panel.alignmentNeedsCenter",
    reasonSideAlignment: "ide.workbench.panel.sideHasNoAlignment",
    reasonSideCollapse: "ide.workbench.panel.sideHasNoCollapse",
} as const;

/**
 * 容器层命令的文案 key（与主页 i18n 同一套）。
 *
 * 命令 titleKey、容器动作组名称与「记录未就绪」的原因都在这一份里；位置会话给出的拒绝诊断
 * 直接进 `ShellCommandValue.diagnosis`，不另造一套文案。
 */
export const CONTAINER_ACTION_KEYS = {
    move: "ide.workbench.container.command.move",
    merge: "ide.workbench.container.command.merge",
    select: "ide.workbench.container.command.select",
    restore: "ide.workbench.container.command.restore",
    reopen: "ide.workbench.container.command.reopen",
    setPartVisibility: "ide.workbench.container.command.setPartVisibility",
    revealView: "ide.workbench.container.command.revealView",
    restoreView: "ide.workbench.container.command.restoreView",
    moveTo: "ide.workbench.container.command.moveTo",
    actions: "ide.workbench.container.actions",
    notReady: "ide.workbench.container.notReady",
} as const;

/**
 * 一个 Panel 框架动作此刻能不能执行。
 *
 * 判据按「用户能理解的原因」排序：首读门禁 → 紧凑模式 → 位置适用范围（对齐 / 收起 / 最大化）。
 * 菜单显示 `reasonKey` 解析出的文案，命令把同一条 `reason` 当 `unavailable` 的原因——
 * 「看得见的禁用」与「真按下去被拒」不会是两套说法。
 */
export function evaluatePanelAction(input: Readonly<{
    commandId: string;
    state: WorkbenchPanelState;
    mode: "split" | "compact";
    ready: boolean;
}>): PanelActionAvailability {
    const {commandId, state, mode} = input;
    if (!input.ready) {
        return {
            available: false,
            reasonKey: PANEL_ACTION_KEYS.reasonNotReady,
            reason: "工具位置记录还没完成首次读取，面板操作暂不可用",
        };
    }
    if (mode === "compact") {
        if (commandId === SHELL_PANEL_COMMAND_IDS.setPosition
            || commandId === SHELL_PANEL_COMMAND_IDS.setAlignment
            || commandId === SHELL_PANEL_COMMAND_IDS.toggleMaximized) {
            return {
                available: false,
                reasonKey: PANEL_ACTION_KEYS.reasonCompact,
                reason: "紧凑呈现下不可用：退出紧凑模式再操作面板位置、对齐或最大化",
            };
        }
    }
    if (commandId === SHELL_PANEL_COMMAND_IDS.setAlignment && !panelAlignmentApplies(state.position)) {
        return {
            available: false,
            reasonKey: PANEL_ACTION_KEYS.reasonSideAlignment,
            reason: "左右位置的 Panel 只有一种跨度：切回底部或顶部再调整对齐",
        };
    }
    if (commandId === SHELL_PANEL_COMMAND_IDS.setCollapsed && !isHorizontalPanelPosition(state.position)) {
        return {
            available: false,
            reasonKey: PANEL_ACTION_KEYS.reasonSideCollapse,
            reason: "只有水平面板（底部 / 顶部）可以收起为标题头",
        };
    }
    if (commandId === SHELL_PANEL_COMMAND_IDS.toggleMaximized && !panelMaximizable(state.position, state.alignment)) {
        return {
            available: false,
            reasonKey: PANEL_ACTION_KEYS.reasonNeedsCenter,
            reason: "居中对齐后可最大化：当前对齐不支持",
        };
    }
    return {available: true};
}

/** 中文短名只进**诊断文案**；菜单文案走 i18n key（同一取值域两张表，别混用）。 */
const POSITION_LABELS: Record<ShellPanelPosition, string> = {
    bottom: "底部",
    top: "顶部",
    left: "左侧",
    right: "右侧",
};

const ALIGNMENT_LABELS: Record<ShellPanelAlignment, string> = {
    center: "居中",
    left: "左对齐",
    right: "右对齐",
    justify: "两端对齐",
};

function reportOutcome(outcome: ShellCommandOutcome): CommandResult<ShellCommandValue> {
    if (outcome.status === "rejected") {
        return {ok: false, code: "unavailable", reason: outcome.diagnosis};
    }
    return {ok: true, value: {status: outcome.status, diagnosis: outcome.diagnosis}};
}

function gateOf(port: WorkbenchShellCommandPort, commandId: string): PanelActionAvailability {
    const state = port.state();
    return evaluatePanelAction({commandId, state: state.panel, mode: state.mode, ready: state.ready});
}

/**
 * 注册框架层命令（位置 / 对齐 / 隐藏 / 收起 / 最大化 / 移动视图）。
 *
 * 任何一条注册失败就先把已注册的撤掉再回报失败，不留「注册了一半」的注册表（同编辑命令域的写法）。
 */
export function registerWorkbenchShellCommands(
    registry: CommandRegistry,
    port: WorkbenchShellCommandPort,
): CommandResult<Release> {
    const registered: Release[] = [];

    const setPosition: CommandDescriptor<typeof SET_POSITION_ARGS, ShellCommandValue> = {
        id: SHELL_PANEL_COMMAND_IDS.setPosition,
        titleKey: PANEL_ACTION_KEYS.position,
        description: "Move the shell panel to another workbench position.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-panel-bottom",
        argsSchema: SET_POSITION_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => {
            const gate = gateOf(port, SHELL_PANEL_COMMAND_IDS.setPosition);
            if (!gate.available) {
                return {ok: false, code: "unavailable", reason: gate.reason};
            }
            const state = port.state();
            if (state.panel.position === args.position) {
                return {ok: true, value: {status: "unchanged", diagnosis: `面板已经在${POSITION_LABELS[args.position]}`}};
            }
            // 切到侧向位置时同次补丁清 `collapsed`：侧向位置没有 32px 标题头这回事，
            // 保存值留着会让「切回来时莫名其妙是收起的」。
            return reportOutcome(await port.setPanelState({
                position: args.position,
                ...(isHorizontalPanelPosition(args.position) ? {} : {collapsed: false}),
            }));
        },
    };

    const setAlignment: CommandDescriptor<typeof SET_ALIGNMENT_ARGS, ShellCommandValue> = {
        id: SHELL_PANEL_COMMAND_IDS.setAlignment,
        titleKey: PANEL_ACTION_KEYS.alignment,
        description: "Set how far the horizontal shell panel spans.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-align-horizontal-justify-center",
        argsSchema: SET_ALIGNMENT_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => {
            const gate = gateOf(port, SHELL_PANEL_COMMAND_IDS.setAlignment);
            if (!gate.available) {
                return {ok: false, code: "unavailable", reason: gate.reason};
            }
            if (port.state().panel.alignment === args.alignment) {
                return {ok: true, value: {status: "unchanged", diagnosis: `面板对齐已经是${ALIGNMENT_LABELS[args.alignment]}`}};
            }
            return reportOutcome(await port.setPanelState({alignment: args.alignment}));
        },
    };

    const setHidden: CommandDescriptor<typeof SET_HIDDEN_ARGS, ShellCommandValue> = {
        id: SHELL_PANEL_COMMAND_IDS.setHidden,
        titleKey: PANEL_ACTION_KEYS.hide,
        description: "Hide or show the shell panel.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-eye-off",
        argsSchema: SET_HIDDEN_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => {
            const gate = gateOf(port, SHELL_PANEL_COMMAND_IDS.setHidden);
            if (!gate.available) {
                return {ok: false, code: "unavailable", reason: gate.reason};
            }
            const panel = port.state().panel;
            if (args.hidden) {
                if (panel.hidden) {
                    return {ok: true, value: {status: "unchanged", diagnosis: "面板已经隐藏"}};
                }
                // 隐藏清最大化：不可见的 Panel 不该留着「还原回最大化」的瞬时状态。
                port.setMaximized(false);
                return reportOutcome(await port.setPanelState({hidden: true}));
            }
            // 显示同时清 hidden 与 collapsed（状态栏「显示面板」与菜单里的是同一条命令）。
            if (!panel.hidden && !panel.collapsed) {
                return {ok: true, value: {status: "unchanged", diagnosis: "面板已经显示"}};
            }
            return reportOutcome(await port.setPanelState({hidden: false, collapsed: false}));
        },
    };

    const setCollapsed: CommandDescriptor<typeof SET_COLLAPSED_ARGS, ShellCommandValue> = {
        id: SHELL_PANEL_COMMAND_IDS.setCollapsed,
        titleKey: PANEL_ACTION_KEYS.collapse,
        description: "Collapse the horizontal shell panel to its title header.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-chevrons-down-up",
        argsSchema: SET_COLLAPSED_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => {
            const gate = gateOf(port, SHELL_PANEL_COMMAND_IDS.setCollapsed);
            if (!gate.available) {
                return {ok: false, code: "unavailable", reason: gate.reason};
            }
            const panel = port.state().panel;
            if (panel.collapsed === args.collapsed) {
                return {
                    ok: true,
                    value: {status: "unchanged", diagnosis: args.collapsed ? "面板已经收起" : "面板已经展开"},
                };
            }
            if (args.collapsed) {
                // 最大化时先还原再收起（同一个动作只产生一个瞬时状态）。
                port.setMaximized(false);
            }
            return reportOutcome(await port.setPanelState({collapsed: args.collapsed}));
        },
    };

    const toggleMaximized: CommandDescriptor<typeof NO_ARGUMENTS, ShellCommandValue> = {
        id: SHELL_PANEL_COMMAND_IDS.toggleMaximized,
        titleKey: PANEL_ACTION_KEYS.maximize,
        description: "Toggle the shell panel between maximized and its previous size.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-maximize-2",
        argsSchema: NO_ARGUMENTS,
        effect: "write",
        expose: {agent: "never"},
        run: () => {
            const gate = gateOf(port, SHELL_PANEL_COMMAND_IDS.toggleMaximized);
            if (!gate.available) {
                return {ok: false, code: "unavailable", reason: gate.reason};
            }
            port.setMaximized(port.state().panel.maximized !== true);
            // 瞬时状态：没有存储写入，回执按 `unchanged`（不是 `saved`），诊断留空。
            return {ok: true, value: {status: "unchanged", diagnosis: ""}};
        },
    };

    const moveView: CommandDescriptor<typeof MOVE_VIEW_ARGS, ShellCommandValue> = {
        id: SHELL_PANEL_COMMAND_IDS.moveView,
        titleKey: "ide.workbench.view.moveTo",
        description: "Move a workbench view to another container.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-corner-up-right",
        argsSchema: MOVE_VIEW_ARGS,
        effect: "write",
        expose: {agent: "never"},
        // 排序、越界拒绝与「同位置不写」都在位置会话里（唯一写者），命令只做转发。
        run: async (args) => reportOutcome(await port.moveView(args)),
    };

    /**
     * 容器层命令的门禁：只门禁**首读**。
     *
     * 来源是否已变、锚点是否还在、目标是否可落位都由位置会话在动作边界用最新底本重新求值——
     * 命令层再猜一遍只会多出第二套判据。未就绪时明确 unavailable，绝不谎报成功。
     */
    const containerGate = (): CommandResult<ShellCommandValue> | null => port.state().ready
        ? null
        : {ok: false, code: "unavailable", reason: "工具位置记录还没完成首次读取，本次调整没有保存"};

    const moveContainer: CommandDescriptor<typeof MOVE_CONTAINER_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.move,
        titleKey: CONTAINER_ACTION_KEYS.move,
        description: "Move a whole workbench container to another part.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-corner-up-right",
        argsSchema: MOVE_CONTAINER_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => containerGate() ?? reportOutcome(await port.moveContainer(args)),
    };

    const mergeContainer: CommandDescriptor<typeof MERGE_CONTAINER_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.merge,
        titleKey: CONTAINER_ACTION_KEYS.merge,
        description: "Merge every view of a source container into a target container and retire the source.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-merge",
        argsSchema: MERGE_CONTAINER_ARGS,
        effect: "write",
        expose: {agent: "never"},
        // 成员快照与两端落位由位置会话在动作边界重新核对：命令层不猜第二套判据。
        run: async (args) => containerGate() ?? reportOutcome(await port.mergeContainer(args)),
    };

    const reopenContainer: CommandDescriptor<typeof REOPEN_CONTAINER_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.reopen,
        titleKey: CONTAINER_ACTION_KEYS.reopen,
        description: "Reopen a merged-away container at its original location.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-rotate-ccw",
        argsSchema: REOPEN_CONTAINER_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => containerGate() ?? reportOutcome(await port.reopenContainer(args.containerId)),
    };

    const selectContainer: CommandDescriptor<typeof SELECT_CONTAINER_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.select,
        titleKey: CONTAINER_ACTION_KEYS.select,
        description: "Select the active container of a workbench part.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-layout-panel-left",
        argsSchema: SELECT_CONTAINER_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => containerGate() ?? reportOutcome(await port.selectContainer(args.partId, args.containerId)),
    };

    const restoreContainer: CommandDescriptor<typeof RESTORE_CONTAINER_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.restore,
        titleKey: CONTAINER_ACTION_KEYS.restore,
        description: "Restore the default location of a workbench container.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-rotate-ccw",
        argsSchema: RESTORE_CONTAINER_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => containerGate() ?? reportOutcome(await port.restoreContainerPlacement(args.containerId)),
    };

    const restoreView: CommandDescriptor<typeof RESTORE_VIEW_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.restoreView,
        titleKey: CONTAINER_ACTION_KEYS.restoreView,
        description: "Restore the default placement of a workbench view.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-rotate-ccw",
        argsSchema: RESTORE_VIEW_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => containerGate() ?? reportOutcome(await port.restoreViewPlacement(args.viewId)),
    };

    const setPartVisibility: CommandDescriptor<typeof SET_PART_VISIBILITY_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.setPartVisibility,
        titleKey: CONTAINER_ACTION_KEYS.setPartVisibility,
        description: "Set the explicit hidden flag or the drag-collapsed flag of a workbench part.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-eye-off",
        argsSchema: SET_PART_VISIBILITY_ARGS,
        effect: "write",
        expose: {agent: "never"},
        // Panel 的 hidden 由命令层明确拒绝（归 `set-panel-state`）：会话只对 left/right 记 hiddenSidebars。
        run: async (args) => containerGate() ?? reportOutcome(await port.setPartVisibility({
            partId: args.partId,
            ...(args.hidden === undefined ? {} : {hidden: args.hidden}),
            ...(args.dragCollapsed === undefined ? {} : {dragCollapsed: args.dragCollapsed}),
        })),
    };

    const revealView: CommandDescriptor<typeof REVEAL_VIEW_ARGS, ShellCommandValue> = {
        id: SHELL_CONTAINER_COMMAND_IDS.revealView,
        titleKey: CONTAINER_ACTION_KEYS.revealView,
        description: "Reveal a workbench view in its effective container.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-eye",
        argsSchema: REVEAL_VIEW_ARGS,
        effect: "write",
        expose: {agent: "never"},
        run: async (args) => containerGate() ?? reportOutcome(await port.revealView(args.viewId)),
    };

    /** 逐条注册（每次调用各自泛型实例化）：异构 schema 的 descriptor 混在一个数组里会因为参数逆变而报错。 */
    const step = <S extends TSchema, R>(descriptor: CommandDescriptor<S, R>): string | null => {
        const result = registry.registerCommand(descriptor);
        if (!result.ok) {
            return `${descriptor.id}：${result.reason}`;
        }
        registered.push(result.value);
        return null;
    };

    const failure = step(setPosition)
        ?? step(setAlignment)
        ?? step(setHidden)
        ?? step(setCollapsed)
        ?? step(toggleMaximized)
        ?? step(moveView)
        ?? step(moveContainer)
        ?? step(mergeContainer)
        ?? step(selectContainer)
        ?? step(restoreContainer)
        ?? step(reopenContainer)
        ?? step(restoreView)
        ?? step(setPartVisibility)
        ?? step(revealView);
    if (failure !== null) {
        for (const release of registered.splice(0)) {
            release();
        }
        return {ok: false, code: "invalid-args", reason: `外壳命令注册失败：${failure}`};
    }

    return {
        ok: true,
        value: () => {
            for (const release of registered.splice(0)) {
                release();
            }
        },
    };
}

// ── View 标题命令 ────────────────────────────────────────────────────────────

/**
 * 宿主白名单的一条：canonical 命令元数据 + 它命中的 View 内 `actionId`。
 *
 * `command.argsSchema` 固定是 `VIEW_ACTION_ARGS_SCHEMA`：View 动作的参数形状只有这一份，
 * 宿主想加个字段就会在类型层被拦下。
 */
export type ViewTitleCommandContribution = Readonly<{
    command: Omit<CommandDescriptor<typeof VIEW_ACTION_ARGS_SCHEMA, never>, "run">;
    actionId: string;
}>;

/**
 * 注册 View 标题命令：`run` 闭包把 `{viewId, generation}` 原样交给执行端口。
 *
 * 命令不自己找 View、不查可见性、不判代际——那些都是宿主（`useWorkbenchViewActions`）的事；
 * 这里只保证「点的是哪条命令、作用于哪个实例」在参数里不丢。
 */
export function registerViewTitleCommands(
    registry: CommandRegistry,
    contributions: readonly ViewTitleCommandContribution[],
    port: WorkbenchViewCommandPort,
): CommandResult<Release> {
    const registered: Release[] = [];
    for (const contribution of contributions) {
        const result = registry.registerCommand({
            ...contribution.command,
            run: (args: {viewId: string; generation: number}) =>
                port.runAction({viewId: args.viewId, generation: args.generation}, contribution.actionId),
        });
        if (!result.ok) {
            for (const release of registered.splice(0)) {
                release();
            }
            return {ok: false, code: result.code, reason: `View 标题命令注册失败：${contribution.command.id}：${result.reason}`};
        }
        registered.push(result.value);
    }
    return {
        ok: true,
        value: () => {
            for (const release of registered.splice(0)) {
                release();
            }
        },
    };
}

/** View 层命令 id（与 View 的 `titleActions.commandId` 共用一份：声明与注册不许各写一遍）。 */
export const SHELL_VIEW_COMMAND_IDS = {
    refreshFiles: "nbook.view.refresh-files",
} as const;

/**
 * 产品侧第一条 View 标题命令：`nbook.files` 的 refresh（主页把它交给 `registerViewTitleCommands`）。
 * 参数、effect 与执行路由都在这一份里，主页只提供「哪个 View 的哪个 actionId 用它」。
 */
export const SHELL_FILES_REFRESH_COMMAND: ViewTitleCommandContribution = {
    actionId: "refresh",
    command: {
        id: SHELL_VIEW_COMMAND_IDS.refreshFiles,
        titleKey: "ide.workbench.view.refreshFiles",
        description: "Refresh the workspace file tree of the target view instance.",
        categoryKey: "workbenchCommands.category.view",
        icon: "i-lucide-refresh-cw",
        argsSchema: VIEW_ACTION_ARGS_SCHEMA,
        effect: "read",
        expose: {agent: "never"},
    },
};

// ── Panel 标题菜单（框架层）的求值 ────────────────────────────────────────────

/** 菜单项 id：`命令 id` 或 `命令 id:取值`；宿主回传 id，参数映射只有一份（见下）。 */
export function panelActionItemId(commandId: string, value?: string | boolean): string {
    return value === undefined ? commandId : `${commandId}:${String(value)}`;
}

export type PanelActionRequest = Readonly<{commandId: string; args: Record<string, unknown>}>;

/**
 * 菜单项 id → 命令调用。
 *
 * 菜单只回传字符串 id（呈现层不许携带 `run` 函数），所以这份映射必须存在，且只能有一份：
 * 拼 id 与解 id 都走本模块，宿主不自己拆字符串。非法取值返回 `null`（转成 `unknown-command`）。
 */
export function resolvePanelActionItem(itemId: string): PanelActionRequest | null {
    const separator = itemId.indexOf(":");
    const commandId = separator < 0 ? itemId : itemId.slice(0, separator);
    const value = separator < 0 ? null : itemId.slice(separator + 1);
    switch (commandId) {
        case SHELL_PANEL_COMMAND_IDS.setPosition:
            return isShellPanelPosition(value) ? {commandId, args: {position: value}} : null;
        case SHELL_PANEL_COMMAND_IDS.setAlignment:
            return isShellPanelAlignment(value) ? {commandId, args: {alignment: value}} : null;
        case SHELL_PANEL_COMMAND_IDS.setHidden:
            return value === "true" || value === "false" ? {commandId, args: {hidden: value === "true"}} : null;
        case SHELL_PANEL_COMMAND_IDS.setCollapsed:
            return value === "true" || value === "false" ? {commandId, args: {collapsed: value === "true"}} : null;
        case SHELL_PANEL_COMMAND_IDS.toggleMaximized:
            return value === null ? {commandId, args: {}} : null;
        default:
            return null;
    }
}

/** 宿主入口：把菜单回传的 id 直接执行成命令（失败码沿用注册表口径）。 */
export function executePanelActionItem(registry: CommandRegistry, itemId: string): Promise<CommandResult<unknown>> {
    const request = resolvePanelActionItem(itemId);
    if (request === null) {
        return Promise.resolve({ok: false, code: "unknown-command", reason: `未登记的面板动作：${itemId}`});
    }
    return registry.executeCommand(request.commandId, request.args);
}

const POSITION_TITLE_KEYS: Record<ShellPanelPosition, string> = {
    bottom: PANEL_ACTION_KEYS.positionBottom,
    top: PANEL_ACTION_KEYS.positionTop,
    left: PANEL_ACTION_KEYS.positionLeft,
    right: PANEL_ACTION_KEYS.positionRight,
};

const POSITION_ICONS: Record<ShellPanelPosition, string> = {
    bottom: "i-lucide-panel-bottom",
    top: "i-lucide-panel-top",
    left: "i-lucide-panel-left",
    right: "i-lucide-panel-right",
};

const ALIGNMENT_TITLE_KEYS: Record<ShellPanelAlignment, string> = {
    center: PANEL_ACTION_KEYS.alignCenter,
    left: PANEL_ACTION_KEYS.alignLeft,
    right: PANEL_ACTION_KEYS.alignRight,
    justify: PANEL_ACTION_KEYS.alignJustify,
};

/** View 标题动作组的无障碍名称 key（框架那一组用 `PANEL_ACTION_KEYS.more`）。 */
export const VIEW_ACTION_GROUP_KEY = "ide.workbench.view.actions";

export type PanelTitleActionOptions = Readonly<{
    /** 当前 Panel 状态（含瞬时的 `maximized`）。 */
    state: WorkbenchPanelState;
    mode: "split" | "compact";
    ready: boolean;
    /** 命令 titleKey → 展示文案（i18n 归宿主）。 */
    titleOf: (titleKey: string) => string;
}>;

/**
 * 求值 Panel 框架操作的展示项。
 *
 * `primary` 是直接给按钮的两条（最大化 / 还原、隐藏 / 显示）；`secondary` 是框架「更多」里的全部
 * （位置子菜单、对齐子菜单、收起、最大化、隐藏——同一操作可从菜单到达，不另设自定义按钮排序）。
 *
 * 禁用与原因取 `evaluatePanelAction`：菜单里看的与命令 `run` 判的是同一条规则，
 * 因此「最大化不可用」永远是同一个原因，而不是菜单禁用、点了却又执行。
 */
export function resolvePanelTitleActions(options: PanelTitleActionOptions): WorkbenchTitleActionItems {
    const {state, mode, ready, titleOf} = options;
    const reasonOf = (commandId: string): {disabled?: true; reason?: string} => {
        const gate = evaluatePanelAction({commandId, state, mode, ready});
        // 菜单显示的是**解析后的文案**（禁用原因也走 i18n）；命令那边用同一条判据的中文 `reason`。
        return gate.available ? {} : {disabled: true, reason: titleOf(gate.reasonKey)};
    };

    const maximized = state.maximized === true;
    const maximizeItem = (): WorkbenchTitleActionItem => ({
        id: panelActionItemId(SHELL_PANEL_COMMAND_IDS.toggleMaximized),
        label: titleOf(maximized ? PANEL_ACTION_KEYS.restore : PANEL_ACTION_KEYS.maximize),
        icon: maximized ? "i-lucide-minimize-2" : "i-lucide-maximize-2",
        ...reasonOf(SHELL_PANEL_COMMAND_IDS.toggleMaximized),
    });
    const hiddenItem = (): WorkbenchTitleActionItem => ({
        id: panelActionItemId(SHELL_PANEL_COMMAND_IDS.setHidden, !state.hidden),
        label: titleOf(state.hidden ? PANEL_ACTION_KEYS.show : PANEL_ACTION_KEYS.hide),
        icon: state.hidden ? "i-lucide-eye" : "i-lucide-eye-off",
        ...reasonOf(SHELL_PANEL_COMMAND_IDS.setHidden),
    });

    const radioChildren = <T extends string>(
        values: readonly T[],
        titleKeys: Record<T, string>,
        icons: Partial<Record<T, string>>,
        current: T,
        group: string,
    ): readonly WorkbenchTitleActionItem[] => values.map((value) => ({
        id: panelActionItemId(
            group === "panel-position" ? SHELL_PANEL_COMMAND_IDS.setPosition : SHELL_PANEL_COMMAND_IDS.setAlignment,
            value,
        ),
        label: titleOf(titleKeys[value]),
        ...(icons[value] === undefined ? {} : {icon: icons[value]}),
        type: "radio" as const,
        group,
        checked: current === value,
    }));

    const secondary: WorkbenchTitleActionItem[] = [
        {
            id: SHELL_PANEL_COMMAND_IDS.setPosition,
            label: titleOf(PANEL_ACTION_KEYS.position),
            icon: "i-lucide-panel-bottom",
            ...reasonOf(SHELL_PANEL_COMMAND_IDS.setPosition),
            children: radioChildren(SHELL_PANEL_POSITIONS, POSITION_TITLE_KEYS, POSITION_ICONS, state.position, "panel-position"),
        },
        {
            id: SHELL_PANEL_COMMAND_IDS.setAlignment,
            label: titleOf(PANEL_ACTION_KEYS.alignment),
            icon: "i-lucide-align-horizontal-justify-center",
            ...reasonOf(SHELL_PANEL_COMMAND_IDS.setAlignment),
            children: radioChildren(SHELL_PANEL_ALIGNMENTS, ALIGNMENT_TITLE_KEYS, {}, state.alignment, "panel-alignment"),
        },
        {
            id: panelActionItemId(SHELL_PANEL_COMMAND_IDS.setCollapsed, !state.collapsed),
            label: titleOf(state.collapsed ? PANEL_ACTION_KEYS.expand : PANEL_ACTION_KEYS.collapse),
            icon: state.collapsed ? "i-lucide-chevrons-up-down" : "i-lucide-chevrons-down-up",
            ...reasonOf(SHELL_PANEL_COMMAND_IDS.setCollapsed),
        },
        maximizeItem(),
        hiddenItem(),
    ];

    return {primary: [maximizeItem(), hiddenItem()], secondary};
}
