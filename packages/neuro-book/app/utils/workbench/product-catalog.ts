/**
 * 产品侧的 Workbench 声明清单与注册表（L1 内置注册路径的组装点）。
 *
 * 本文件是容器 / 视图声明的**唯一产品来源**：`containers.ts` 放容器，视图在这里登记；
 * 注册表按静态清单构造一次（声明不随运行期变化），查表一律走 `createWorkbenchRegistry` 的求值，
 * 不在调用方各写一份 `find` / 字面量。
 *
 * 呈现求值（`resolveViewPresentation`）是**位置 + 可见性 + 动作可用性**的统一出口：
 * 容器与视图的位置都来自 `view-placements.ts`（覆盖 + 默认回落），可见性来自 descriptor 的 `when`，
 * 动作可用性来自 `requiredAuthority`。宿主拿 `part(partId)` 的切片渲染——一个 Part 的容器清单、
 * 每个容器里的可见 / 不可见视图、活动容器与两份落点清单（View 落点、容器落点）都在里面，
 * 不需要再碰注册表或位置记录，也不各自建一份位置会话（会话归页面，见 `view-placements-session.ts`）。
 */

import {
    createWorkbenchRegistry,
    DEFAULT_VIEW_LAYOUT_CONTRACT,
    evaluateAuthorities,
    evaluateWhen,
    resolveViewLayout,
    type DescriptorResult,
    type ViewDescriptor,
    type ViewLayoutContract,
    type WorkbenchCatalog,
    type WorkbenchContext,
    type WorkbenchRegistry,
} from "nbook/app/utils/workbench/descriptors";
import {
    SHELL_LEFT_CONTAINER,
    SHELL_PANEL_CONTAINER,
    SHELL_RIGHT_CONTAINER,
} from "nbook/app/utils/workbench/containers";
import {
    containerOrientation,
    viewContainerModeOf,
    type ViewContainerMode,
} from "nbook/app/utils/workbench/view-container-layout";
import type {GridOrientation} from "@notnotype/nb-ui/layout";
import {SHELL_VIEW_COMMAND_IDS} from "nbook/app/utils/workbench/workbench-shell-commands";
import {
    comparePlacements,
    containersOfPart,
    isToolPartId,
    placementCatalogOf,
    readContainerPlacements,
    readEffectiveContainerPlacements,
    readViewPlacements,
    TOOL_PART_LOCATIONS,
    toolPartOfLocation,
    type ContainerPlacementReading,
    type EffectiveViewPlacement,
    type ToolPartId,
    type ToolPartLocation,
    type ViewPlacementSource,
} from "nbook/app/utils/workbench/view-placements";
import type {
    ContainerPlacementRecord,
    WorkbenchViewPlacementRecord,
} from "nbook/shared/storage/workbench-views";

/**
 * `files` 视图：左容器里的工作区文件树（默认落位；用户可把它移到右栏或底部面板）。
 *
 * - `when.requires: ["project"]`：只有 Project 打开时才渲染（书架 / 用户资产工作面没有文件树语义，
 *   与接入前 `NovelIdeActivityBar` 对 `files` 入口的判据同源）；
 * - `requiredAuthority: ["files"]`：动作可用性看 `/api/workspace-files/*` 这条 authority，与可见性分开；
 * - `layout: "fill"`：文件面板自己占满内容区并管内部滚动（外壳不给留白、不代管滚动）；
 * - `stateScope: "user"`：展开项等 memento 归 User Storage（`persistence.md:98`）；
 * - `canMoveView: true`：它是本轮验证"工具 View 跨左 / 右 / 底部移动"的真实视图。
 *
 * `canToggleVisibility` 仍按**当前真实能力**声明：视图可见性开关还没有落账通道（记录里只有
 * 容器/Part 显隐与内容收起），因此不声明做不到的能力。
 *
 * `titleActions` 是**首个真实生产贡献**：文件树把已有的 `refreshTree()` 经句柄交给宿主，
 * 命令 `nbook.view.refresh-files` 只做参数与代际传递；内容头的重复刷新按钮已删除。
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
    canMoveView: true,
    titleActions: [{
        id: "refresh",
        commandId: SHELL_VIEW_COMMAND_IDS.refreshFiles,
        placement: "primary",
        order: 10,
    }],
    factoryKey: "nbook.view.files",
    stateScope: "user",
};

const PRODUCT_CATALOG: WorkbenchCatalog = {
    /** 叶仍是外壳的固定骨架（`WorkbenchShell.vue`）：没有消费者前不声明 Part descriptor。 */
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER],
    views: [SHELL_FILES_VIEW],
};

let productRegistry: DescriptorResult<WorkbenchRegistry> | null = null;

/** 产品注册表；清单非法时保留失败原因（调用方把它显示出来，不吞成空白容器）。 */
export function productWorkbenchRegistry(): DescriptorResult<WorkbenchRegistry> {
    productRegistry ??= createWorkbenchRegistry(PRODUCT_CATALOG);
    return productRegistry;
}

/** 一个视图的呈现条目：位置、可见性与动作可用性一次算完。 */
export type WorkbenchViewEntry = {
    readonly view: ViewDescriptor;
    /** 已解析的视图标题（注册表只存 key，解析归页面；宿主不做 i18n）。 */
    readonly title: string;
    readonly containerId: string;
    readonly order: number;
    readonly source: ViewPlacementSource;
    /** 可见性：`when` 的求值结果（看不见 ≠ 不可用）。 */
    readonly visible: boolean;
    readonly visibilityReasons: readonly string[];
    /** 动作可用性：`requiredAuthority` 的求值结果；不可用时视图仍在、只是受限动作禁用。 */
    readonly actionable: boolean;
    readonly authorityReasons: readonly string[];
};

/** 一个可投递的 **View** 落点：菜单与拖放共用（不含视图自己的容器）。 */
export type ViewMoveTarget = {
    readonly containerId: string;
    readonly title: string;
};

/** 一个可投递的**容器**落点：位置字面量，不是某个容器（容器移动换的是整个容器的落位）。 */
export type ContainerMoveTarget = {
    readonly location: ToolPartLocation;
    readonly partId: ToolPartId;
    readonly title: string;
};

/** 一个容器的呈现切片：宿主拿它渲染，不需要再碰注册表或位置记录。 */
export type ContainerViewPresentation = {
    readonly containerId: string;
    readonly title: string;
    readonly icon: string;
    /** 生效落位（`window` 一类不可呈现的落位不会出现在任何 Part 的切片里）。 */
    readonly location: ToolPartLocation;
    /** 生效落位求值出的 Part；与所属 `PartContainerPresentation.partId` 一致。 */
    readonly partId: ToolPartId;
    /** 同一落位内的顺序（已按 (order, id) 排好）。 */
    readonly order: number;
    /**
     * 容器整体是否可以移动/重排（`ContainerDescriptor.canMoveContainer !== false`）。
     * 与 `view-placements` 的 `movable` 同一口径：拖放求重排锚点时也要用它，落点模块不另算一份。
     */
    readonly canMoveContainer: boolean;
    /** 容器内部编排方向：left/right 上下排、panel 左右排（与 Panel 外壳停靠位置无关）。 */
    readonly orientation: GridOrientation;
    /** 呈现模板：按**可见**成员数求值（隐藏不计入、折叠仍计入）。 */
    readonly mode: ViewContainerMode;
    /** `single` 时动作上提到容器右上角的那个 View；`empty` / `multiple` 是 `null`。 */
    readonly singleViewId: string | null;
    /**
     * 全部已登记生效成员的完整顺序快照（含 hidden 与 collapsed）：拖动源与合并请求用它，
     * 不要用 `views` + `hidden` 现场拼一份出来。
     */
    readonly memberViewIds: readonly string[];
    /** 该容器里可见的视图，已按 (order, id) 排好。 */
    readonly views: readonly WorkbenchViewEntry[];
    /** 不可见视图（含原因；有可见视图时不占内容区，无可见视图时作为空态说明）。 */
    readonly hidden: readonly WorkbenchViewEntry[];
    readonly moveTargets: readonly ViewMoveTarget[];
    readonly containerMoveTargets: readonly ContainerMoveTarget[];
    /** 全局位置问题 + 本容器的求值问题（都不静默吞）。 */
    readonly problems: readonly string[];
};

/** 一个 Part 的呈现切片：容器清单（已排序）+ 活动容器。 */
export type PartContainerPresentation = {
    readonly partId: ToolPartId;
    /**
     * 这个 Part 里的容器，按 (order, id) 排好。
     *
     * 每个 Part 只显示一个活动容器；**不**自动删除容器，也没有可接收容器的空态落点之外的语义。
     */
    readonly containers: readonly ContainerViewPresentation[];
    /**
     * 活动容器：记录里的选择，或它无效时排序第一项；没有容器时是 `null`。
     *
     * 记录里的无效选择只影响呈现，不写回默认、不删除原件。
     */
    readonly activeContainerId: string | null;
    readonly problems: readonly string[];
};

export type ViewPresentationOptions = {
    readonly registry: WorkbenchRegistry;
    /** 环境事实：`when` 与 `requiredAuthority` 的唯一输入。 */
    readonly context: WorkbenchContext;
    /** 视图位置覆盖（同一记录的 `placements`）；缺省全部按 descriptor 默认落位。 */
    readonly overrides?: Readonly<Record<string, WorkbenchViewPlacementRecord>>;
    /** 容器落位覆盖（同一记录的 `containerPlacements`）；缺省全部按 descriptor 默认落位。 */
    readonly containerOverrides?: Readonly<Record<string, ContainerPlacementRecord>>;
    /** 整组并入写下的抑制标记；只影响导航/普通落点，不销毁 resident 实例。 */
    readonly suppressedContainers?: Readonly<Record<string, boolean>>;
    /** 每个 Part 的活动容器（同一记录的 `activeContainerByPart`）。 */
    readonly activeContainerByPart?: Readonly<Record<string, string>>;

    /** 标题解析（i18n 归页面）；缺省用 `titleKey`（Lab 与测试可以另给一份）。 */
    readonly titleOf?: (descriptor: {readonly titleKey: string}) => string;
    /** Part 标题解析（容器移动菜单用）；缺省直接用 partId，本层不发明 i18n key。 */
    readonly partTitleOf?: (partId: ToolPartId) => string;
};

export type WorkbenchViewPresentation = {
    readonly entries: readonly WorkbenchViewEntry[];
    readonly issues: readonly string[];
    /** 指定容器的切片；未登记或被抑制的容器没有呈现，返回 `null`（调用方必须显式处理）。 */
    container(containerId: string): ContainerViewPresentation | null;
    /**
     * 全部**已登记且可落位**容器的切片，包含当前被抑制（不进导航）的那些。
     *
     * 实例层按它泊车与挂载：导航过滤只决定「能不能选到」，绝不驱动实例销毁。
     */
    readonly residentContainers: readonly ContainerViewPresentation[];
    /** 指定 Part 的切片；未登记的 Part 返回只有诊断的空切片（宿主照画，不静默空白）。 */
    part(partId: ToolPartId): PartContainerPresentation;
};

/**
 * 统一呈现求值：容器落位、视图位置、可见性、动作可用性与活动容器。
 *
 * 位置被过滤的覆盖（默认指纹不符 / 目标容器不可落位 / 不可移动视图 / 未支持的位置字面量）
 * 只影响那一个容器或视图的呈现，记录原件不动；这些原因进全局 `issues`，并按"受影响对象的生效落点"
 * 进对应切片的 `problems`，让每个宿主只显示与自己有关的那几条（不会各显示一遍同一条全局诊断）。
 */
export function resolveViewPresentation(options: ViewPresentationOptions): WorkbenchViewPresentation {
    const {registry, context} = options;
    const titleOf = options.titleOf ?? ((descriptor: {readonly titleKey: string}) => descriptor.titleKey);
    const partTitleOf = options.partTitleOf ?? ((partId: ToolPartId) => partId);
    const catalog = placementCatalogOf(registry);
    const reading = readViewPlacements(catalog, options.overrides);
    const allContainers = readContainerPlacements(catalog, options.containerOverrides);
    const effectiveContainers = readEffectiveContainerPlacements(catalog, {
        placements: options.overrides ?? {},
        containerPlacements: options.containerOverrides,
        suppressedContainers: options.suppressedContainers,
    });
    const containersById = new Map(registry.containers().map((container) => [container.id, container] as const));

    const placementByView: Record<string, EffectiveViewPlacement> = {};
    for (const placement of reading.placements) {
        placementByView[placement.viewId] = placement;
    }

    const issues: string[] = [];
    const problemsByContainer: Record<string, string[]> = {};
    for (const problem of reading.problems) {
        issues.push(problem.diagnosis);
        const placement = placementByView[problem.viewId];
        if (placement !== undefined) {
            noteProblem(problemsByContainer, placement.containerId, problem.diagnosis);
        }
    }
    for (const problem of allContainers.problems) {
        issues.push(problem.diagnosis);
        noteProblem(problemsByContainer, problem.containerId, problem.diagnosis);
    }

    const entries: WorkbenchViewEntry[] = [];
    for (const view of registry.views()) {
        const placement = placementByView[view.id]!;
        const visibility = evaluateWhen(view.when, context);
        const authority = evaluateAuthorities(view.requiredAuthority, context);
        if (!visibility.ok) {
            issues.push(`${view.id}：${visibility.reason}`);
            noteProblem(problemsByContainer, placement.containerId, `${view.id}：${visibility.reason}`);
        }
        if (!authority.ok) {
            issues.push(`${view.id}：${authority.reason}`);
            noteProblem(problemsByContainer, placement.containerId, `${view.id}：${authority.reason}`);
        }
        entries.push({
            view,
            title: titleOf(view),
            containerId: placement.containerId,
            order: placement.order,
            source: placement.source,
            visible: visibility.ok && visibility.value.visible,
            visibilityReasons: visibility.ok ? visibility.value.reasons : [],
            actionable: authority.ok && authority.value.actionable,
            authorityReasons: authority.ok ? authority.value.reasons : [],
        });
    }

    /** View 落点：其它当前参与呈现的容器（不含自己）。 */
    const viewTargetsOf = (selfId: string): ViewMoveTarget[] => effectiveContainers.placements
        .filter((placement) => placement.containerId !== selfId)
        .map((placement) => ({containerId: placement.containerId, title: titleOf(containersById.get(placement.containerId)!)}));

    /** 容器落点：位置字面量，不是某个容器（容器移动换的是整个容器的落位）。 */
    const containerTargetsOf = (selfLocation: ToolPartLocation): ContainerMoveTarget[] => TOOL_PART_LOCATIONS
        .filter((location) => location !== selfLocation)
        .map((location) => ({location, partId: toolPartOfLocation(location)!, title: partTitleOf(toolPartOfLocation(location)!)}));

    const sliceOf = (containerId: string, source: ContainerPlacementReading): ContainerViewPresentation | null => {
        const placement = source.placements.find((entry) => entry.containerId === containerId);
        const descriptor = containersById.get(containerId);
        if (placement === undefined || descriptor === undefined) {
            return null;
        }
        const partId = toolPartOfLocation(placement.location);
        if (partId === null) {
            return null;
        }
        const own = entries.filter((entry) => entry.containerId === containerId).sort(compareEntries);
        const visible = own.filter((entry) => entry.visible);
        const mode = viewContainerModeOf(visible.length);
        const leader = visible[0];
        return {
            containerId,
            title: leader === undefined ? titleOf(descriptor) : titleOf(leader.view),
            icon: leader === undefined ? descriptor.icon : leader.view.icon,
            location: placement.location as ToolPartLocation,
            partId,
            order: placement.order,
            canMoveContainer: descriptor.canMoveContainer !== false,
            orientation: containerOrientation(partId),
            mode,
            singleViewId: mode === "single" ? visible[0]!.view.id : null,
            memberViewIds: own.map((entry) => entry.view.id),
            views: visible,
            hidden: own.filter((entry) => !entry.visible),
            moveTargets: viewTargetsOf(containerId),
            containerMoveTargets: containerTargetsOf(placement.location as ToolPartLocation),
            problems: problemsByContainer[containerId] ?? [],
        };
    };

    /** 全部已登记且可落位的容器（含当前不参与导航的那些）：实例层按它泊车。 */
    const residentContainers: ContainerViewPresentation[] = [];
    for (const placement of allContainers.placements) {
        const slice = sliceOf(placement.containerId, allContainers);
        if (slice !== null) {
            residentContainers.push(slice);
        }
    }

    return {
        entries,
        issues,
        residentContainers,
        container: (containerId: string): ContainerViewPresentation | null => sliceOf(containerId, effectiveContainers),
        part: (partId: ToolPartId): PartContainerPresentation => {
            if (!isToolPartId(partId)) {
                return {
                    partId,
                    containers: [],
                    activeContainerId: null,
                    problems: [`未登记的工具 Part：${String(partId)}`],
                };
            }
            const slices = containersOfPart(effectiveContainers, partId)
                .map((placement) => sliceOf(placement.containerId, effectiveContainers))
                .filter((slice): slice is ContainerViewPresentation => slice !== null);
            const chosen = options.activeContainerByPart?.[partId];
            const activeContainerId = slices.some((slice) => slice.containerId === chosen)
                ? chosen!
                : slices[0]?.containerId ?? null;
            return {partId, containers: slices, activeContainerId, problems: []};
        },
    };
}

function noteProblem(problemsByContainer: Record<string, string[]>, containerId: string, diagnosis: string): void {
    const bucket = problemsByContainer[containerId];
    if (bucket === undefined) {
        problemsByContainer[containerId] = [diagnosis];
    } else {
        bucket.push(diagnosis);
    }
}

function compareEntries(left: WorkbenchViewEntry, right: WorkbenchViewEntry): number {
    return comparePlacements(
        {viewId: left.view.id, order: left.order},
        {viewId: right.view.id, order: right.order},
    );
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
