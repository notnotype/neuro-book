/**
 * View 标题动作（title actions）的纯合同与求值。
 *
 * 三层职责，别混（本计划「标题操作：框架、容器、View 三层」）：
 * - **框架层**（Panel 位置 / 对齐 / 最大化 / 隐藏）由外壳命令目录给出，见 `workbench-shell-commands.ts`；
 * - **容器层**（跨容器移动）由宿主从 `moveTargets` 合成，归 `WorkbenchViewHost.vue`；
 * - **View 层**（本文件）是 View 在自己的 descriptor 里声明的那几个动作：贡献只写 `id` +
 *   `commandId` + 位置与顺序，标题 / 图标 / 说明一律取 canonical 命令元数据——同一个动作不在
 *   View 与命令两处各写一份文案。
 *
 * 求值是**纯函数**：不 import Vue、不读注册表、不发请求。命令解析、命令可用性与 View 实例上报的
 * 运行时状态都由调用方（`useWorkbenchViewActions.ts`）喂进来，因此这里能对「未知命令、缺句柄、
 * busy、authority 不足」逐条断言，而不用挂组件。
 *
 * 本模块只依赖 `context-keys`（谓词语义）与 `commands` 的类型：descriptor 的声明层反过来 import
 * 这里的贡献类型与校验，依赖只有一个方向，不构成运行时环。
 */
import {
    evaluateContextWhen,
    validateWhen,
    type ContextKey,
    type ContextValues,
} from "nbook/app/utils/workbench/context-keys";
import type {CommandMetadata, CommandResult} from "nbook/app/utils/workbench/commands";

/**
 * 一条 View 标题动作贡献（descriptor 字段 `ViewDescriptor.titleActions`）。
 *
 * `when` 与 `ViewWhen` 同形（本模块不 import 声明层）：多个键是 all-of，不满足即**隐藏**
 * （和 View 可见性同一套语义——看不见不等于没权限）。
 */
export type ViewTitleActionContribution = Readonly<{
    /** View 内唯一、不为空；也是运行时状态与 `runAction(actionId)` 的键。 */
    id: string;
    /** 已有 canonical 命令体系里的命令 id；命令未登记时动作可见但禁用。 */
    commandId: string;
    placement: "primary" | "secondary";
    /** 同序按 id 稳定排序。 */
    order: number;
    /** 按住 Alt 时，图标按钮临时切换到另一条命令；菜单项不使用它。 */
    alternate?: Readonly<{modifier: "alt"; commandId: string}>;
    when?: Readonly<{requires?: readonly ContextKey[]}>;
}>;

/**
 * View 实例上报的动作运行时状态。
 *
 * 只描述**这次实例**此刻的事实：`enabled=false` 时给原因；`busy` 表示该动作正在执行；
 * `checked` 只给 View 自有的切换动作（不是工具栏用户配置）。
 */
export type ViewTitleActionState = Readonly<{
    id: string;
    enabled: boolean;
    reason?: string;
    checked?: boolean;
    busy?: boolean;
}>;

/** View 实例暴露给宿主的执行句柄：只回答「执行我这个实例的这个动作」。 */
export type WorkbenchViewActionHandle = Readonly<{
    runAction(actionId: string): Promise<CommandResult<unknown>>;
}>;

/** 动作目标：视图 id + 实例代际。迟到的回执靠代际识别，不作用到新实例上。 */
export type ViewActionTarget = Readonly<{viewId: string; generation: number}>;

/**
 * 已经求值好的一条展示项：只带渲染与无障碍需要的事实。
 *
 * **不带 `commandId`、不带 `run`**：呈现组件不许自己执行命令，点击只回传 `id`，由宿主决定
 * 它对应哪个命令（View 动作经 `useWorkbenchViewActions`，框架动作经 `executePanelActionItem`）。
 */
export type WorkbenchTitleActionItem = Readonly<{
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
    /** 禁用原因：可见地告诉用户「为什么不能点」，而不是把按钮藏起来。 */
    reason?: string;
    busy?: boolean;
    checked?: boolean;
    type?: "item" | "radio" | "checkbox";
    /** radio 的同层同组标识（组内互斥由 `checked` 受控）。 */
    group?: string;
    /** 一层子菜单；带 children 的项自己不执行。 */
    children?: readonly WorkbenchTitleActionItem[];
    /** 按住 Alt 时图标按钮显示的备用动作；`id` 是备用命令 id。 */
    alternate?: Readonly<{modifier: "alt"; id: string; label: string; icon?: string}>;
}>;

/** 一组标题动作：直接给按钮的 `primary` 与折叠进「更多」的 `secondary`。 */
export type WorkbenchTitleActionItems = Readonly<{
    primary: readonly WorkbenchTitleActionItem[];
    secondary: readonly WorkbenchTitleActionItem[];
}>;

/** 一个 View 的已求值标题动作：target 与两项清单一起给出（渲染时捕获，迟到选择不重猜）。 */
export type WorkbenchViewTitleActions = WorkbenchTitleActionItems & Readonly<{target: ViewActionTarget}>;

/** 宿主传给 `WorkbenchViewHost` 的已求值映射（按 viewId 索引）。 */
export type WorkbenchTitleActionsByView = Readonly<Record<string, WorkbenchViewTitleActions>>;

/** 容器标题动作的目标：容器整体（移动 / 恢复默认落位一类）。 */
export type ContainerActionTarget = Readonly<{containerId: string}>;

/**
 * 标题动作的点击事件（宿主 `WorkbenchViewHost` / `WorkbenchPartHost` 的统一 emit 之一）。
 *
 * View 动作带上**渲染时捕获**的 target（迟到的点选不会落到后来换上的实例）；
 * 框架动作只带 `actionId`（它不属于任何 View，参数映射归 `workbench-shell-commands.ts`）；
 * 容器动作带容器 id——同一个 Part 会换活动容器，晚到的点选必须作用在它当时看到的容器上。
 */
export type WorkbenchTitleActionEvent =
    | Readonly<{scope: "view"; target: ViewActionTarget; actionId: string}>
    | Readonly<{scope: "panel"; actionId: string}>
    | Readonly<{scope: "container"; target: ContainerActionTarget; actionId: string}>;

/** 缺句柄或缺状态时的统一说法：动作此刻跑不了，原因不是用户做错了什么。 */
const NOT_READY_REASON = "视图操作尚未就绪";
const BUSY_REASON = "视图操作正在执行";
const IDLE_REASON = "视图操作当前不可用";

function byOrderThenId(left: {readonly id: string; readonly order: number}, right: {readonly id: string; readonly order: number}): number {
    if (left.order !== right.order) {
        return left.order - right.order;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * 贡献的**注册期**校验：一次性给全所有问题（不发现第一个就退出）。
 *
 * 空 id / 重复 id / 非法 placement / 非有限 order / 未登记的 when 键都在这里拒绝——
 * L2 声明式 descriptor 里的字符串不受类型检查保护，只能在声明层拦。
 */
export function titleActionProblems(owner: string, contributions: readonly ViewTitleActionContribution[] | undefined): string[] {
    const problems: string[] = [];
    if (contributions === undefined) {
        return problems;
    }
    const seen = new Set<string>();
    for (const contribution of contributions) {
        const label = `${owner} 的标题动作`;
        if (typeof contribution.id !== "string" || contribution.id.trim() === "") {
            problems.push(`${label} id 不能为空`);
        } else if (seen.has(contribution.id)) {
            problems.push(`${label} id 重复：${contribution.id}`);
        } else {
            seen.add(contribution.id);
        }
        if (typeof contribution.commandId !== "string" || contribution.commandId.trim() === "") {
            problems.push(`${label} ${String(contribution.id)} 的 commandId 不能为空`);
        }
        if (contribution.placement !== "primary" && contribution.placement !== "secondary") {
            problems.push(`${label} ${String(contribution.id)} 的 placement 必须是 primary 或 secondary：${String(contribution.placement)}`);
        }
        if (!Number.isFinite(contribution.order)) {
            problems.push(`${label} ${String(contribution.id)} 的 order 不是有限数：${String(contribution.order)}`);
        }
        for (const key of (contribution.when?.requires ?? []) as readonly string[]) {
            if (!validateWhen({requires: [key as ContextKey]}).ok) {
                problems.push(`${label} ${String(contribution.id)} 的 when 取值未登记：${key}`);
            }
        }
        if (contribution.alternate !== undefined) {
            if (contribution.alternate.modifier !== "alt") {
                problems.push(`${label} ${String(contribution.id)} 的备用修饰键只接受 alt`);
            }
            if (typeof contribution.alternate.commandId !== "string" || contribution.alternate.commandId.trim() === "") {
                problems.push(`${label} ${String(contribution.id)} 的备用 commandId 不能为空`);
            } else if (contribution.alternate.commandId === contribution.commandId) {
                problems.push(`${label} ${String(contribution.id)} 的备用命令不能与主动作相同`);
            }
        }
    }
    return problems;
}

/** 求值输入：View 层事实、环境事实、命令解析与实例状态分开给，谁都不需要再猜。 */
export type ViewTitleActionEvaluationInput = Readonly<{
    /** 只为诊断文案（「哪个 View 上报了未登记的状态」）。 */
    viewId: string;
    contributions: readonly ViewTitleActionContribution[];
    /** View 可见性（`when`）；不可见就不该有标题动作。 */
    visible: boolean;
    /** View 的 `requiredAuthority` 求值结果。 */
    actionable: boolean;
    authorityReasons: readonly string[];
    /** 环境事实：贡献自身的 `when` 用它求值。 */
    context: ContextValues;
    /** 命令解析；`null` = 未登记（可见但禁用，诊断标签用 action.id）。 */
    commandOf: (commandId: string) => CommandMetadata | null;
    /** 命令级不可用原因（`when` 不满足等）；`null` = 可用。 */
    commandUnavailableReason: (commandId: string) => string | null;
    /** 该实例上报的状态；没上报的动作按「尚未就绪」处理。 */
    states: readonly ViewTitleActionState[];
    hasHandle: boolean;
    /** 标题解析（i18n 归宿主）；缺省用 `titleKey`（Lab 与测试可以另给一份）。 */
    titleOf?: (metadata: {readonly titleKey: string}) => string;
}>;

export type ViewTitleActionEvaluation = Readonly<{
    primary: readonly WorkbenchTitleActionItem[];
    secondary: readonly WorkbenchTitleActionItem[];
    /** 求值期诊断（未知命令、未登记的状态 id）：宿主一次展示，不在 View / 工具栏重复报。 */
    problems: readonly string[];
}>;

/**
 * 把「贡献 × 可见性 × authority × 命令 when × 运行时状态」合成为展示项。
 *
 * 判定顺序（先到先得，后面的原因不覆盖前面的）：
 * 贡献 `when` 不满足 → **隐藏**；命令未登记 → 禁用且诊断；缺句柄 / 缺状态 → 「尚未就绪」；
 * `busy` → 「正在执行」；`enabled=false` → 用它自己的原因；authority 不足 → 用它自己的原因。
 *
 * 结果按 `placement` 分到两份清单：`primary` 直接渲染成按钮，`secondary` 收进「更多」。
 * 没有图标的 primary 降级进 `secondary`——标题条上不该出现「空白按钮」。
 */
export function resolveViewTitleActions(input: ViewTitleActionEvaluationInput): ViewTitleActionEvaluation {
    const problems: string[] = [];
    if (!input.visible) {
        return {primary: [], secondary: [], problems};
    }
    const titleOf = input.titleOf ?? ((metadata: {readonly titleKey: string}) => metadata.titleKey);
    const stateById = new Map(input.states.map((state) => [state.id, state] as const));
    const declared = new Set(input.contributions.map((contribution) => contribution.id));
    for (const state of input.states) {
        if (!declared.has(state.id)) {
            problems.push(`${input.viewId} 上报了未登记标题动作的状态：${state.id}`);
        }
    }

    const primary: WorkbenchTitleActionItem[] = [];
    const secondary: WorkbenchTitleActionItem[] = [];
    for (const contribution of [...input.contributions].sort(byOrderThenId)) {
        const when = evaluateContextWhen(contribution.when, input.context);
        if (!when.ok || !when.value.matches) {
            // 谓词求值不了（未登记的键）也不放行：声明期已经拒绝过，这里是运行期的兜底。
            continue;
        }
        const metadata = input.commandOf(contribution.commandId);
        if (metadata === null) {
            problems.push(`${input.viewId} 的标题动作 ${contribution.id} 指向未登记的命令：${contribution.commandId}`);
            secondary.push({
                id: contribution.id,
                label: contribution.id,
                disabled: true,
                reason: `未登记的命令：${contribution.commandId}`,
            });
            continue;
        }

        const state = stateById.get(contribution.id);
        const disabledReason = disabledReasonOf(input, state, contribution.commandId);
        const placement = contribution.placement === "primary" && metadata.icon !== undefined ? "primary" : "secondary";
        const alternate = placement === "primary" ? alternateOf(input, contribution, titleOf) : null;
        const item: WorkbenchTitleActionItem = {
            id: contribution.id,
            label: titleOf(metadata).trim() || contribution.id,
            ...(metadata.icon === undefined ? {} : {icon: metadata.icon}),
            ...(disabledReason === null ? {} : {disabled: true, reason: disabledReason}),
            ...(state?.busy === true ? {busy: true} : {}),
            ...(state?.checked === undefined ? {} : {checked: state.checked, type: "checkbox" as const}),
            ...(alternate === null ? {} : {alternate}),
        };
        (placement === "primary" ? primary : secondary).push(item);
    }
    return {primary, secondary, problems};
}

/** 图标按钮的 Alt 备用动作；无效备用项静默忽略，主动作保持可用。 */
function alternateOf(
    input: ViewTitleActionEvaluationInput,
    contribution: ViewTitleActionContribution,
    titleOf: (metadata: {readonly titleKey: string}) => string,
): NonNullable<WorkbenchTitleActionItem["alternate"]> | null {
    const alternate = contribution.alternate;
    if (alternate === undefined || alternate.modifier !== "alt" || alternate.commandId === contribution.commandId) {
        return null;
    }
    const when = evaluateContextWhen(contribution.when, input.context);
    if (!when.ok || !when.value.matches) {
        return null;
    }
    const metadata = input.commandOf(alternate.commandId);
    if (metadata?.icon === undefined) {
        return null;
    }
    return {
        modifier: "alt",
        id: alternate.commandId,
        label: titleOf(metadata).trim() || alternate.commandId,
        icon: metadata.icon,
    };
}
/** 禁用原因；`null` 表示这一条可以执行。 */
function disabledReasonOf(
    input: ViewTitleActionEvaluationInput,
    state: ViewTitleActionState | undefined,
    commandId: string,
): string | null {
    if (!input.hasHandle || state === undefined) {
        return NOT_READY_REASON;
    }
    if (state.busy === true) {
        return BUSY_REASON;
    }
    if (state.enabled !== true) {
        return state.reason?.trim() ? state.reason : IDLE_REASON;
    }
    if (!input.actionable) {
        return input.authorityReasons.join("；") || "缺少执行该动作的 authority";
    }
    return input.commandUnavailableReason(commandId);
}

/**
 * `primary` 里放得下几个按钮：放不下的收进「更多」（**必须**保留更多触发器，它是唯一入口）。
 *
 * 判定只看宽度：按钮是同一控件同一尺寸（`IconButton size="sm"`），一个宽度就够；
 * 可用宽度未知（`<= 0`，例如还没测量或容器被隐藏）时**不折叠**——不能因为量不到就把按钮藏起来。
 */
export function foldTitleActionCount(input: Readonly<{
    count: number;
    itemWidth: number;
    moreWidth: number;
    gap: number;
    availableWidth: number;
    /** 是否本来就有 secondary 项（更多触发器必须存在）。 */
    hasSecondary: boolean;
}>): number {
    if (!(input.availableWidth > 0) || input.count <= 0) {
        return Math.max(0, input.count);
    }
    let visible = 0;
    for (let n = input.count; n >= 0; n -= 1) {
        const primaryWidth = n * input.itemWidth + Math.max(0, n - 1) * input.gap;
        const moreWidth = input.hasSecondary || n < input.count ? input.moreWidth + input.gap : 0;
        if (primaryWidth + moreWidth <= input.availableWidth) {
            visible = n;
            break;
        }
    }
    return visible;
}

/** 菜单内容的稳定指纹：内容变了就关掉旧菜单，不让残留项指向已经变化的状态。 */
export function titleActionsSignature(items: WorkbenchTitleActionItems): string {
    const write = (list: readonly WorkbenchTitleActionItem[]): string => list
        .map((item) => [
            item.id,
            item.disabled === true ? "1" : "0",
            item.checked === true ? "1" : "0",
            item.busy === true ? "1" : "0",
            item.label,
            item.alternate?.id ?? "",
            item.alternate?.label ?? "",
            item.alternate?.icon ?? "",
            write(item.children ?? []),
        ].join("~"))
        .join("|");
    return `${write(items.primary)}#${write(items.secondary)}`;
}
