/**
 * 工作台工具视图位置记录的产品定义（Nitro 与浏览器共用）。
 *
 * 一条 user/local 单例记录承载跨 Project 的界面定制，它们必须一起移动：
 * - `placements`：每个 View 的容器覆盖（含**保存时所基于的默认位置**，用于默认指纹变化时回落）；
 * - `containerPlacements`：每个容器的落位与顺序覆盖（同样带默认落位指纹）；
 * - `activeContainerByPart`：每个 Part 的活动容器（恢复"上次看的是哪个容器"）；
 * - `viewSizes`：View 的**双轴**尺寸意图与内容收起（跨容器移动不丢尺寸）；
 * - `dragCollapsedParts`：拖到零收起的 Part（保留可拉回边界）；
 * - `hiddenSidebars`：侧栏的显式隐藏（零占用、无边界）；
 * - `suppressedContainers`：被整组合并掉的源容器（标记只是证据，生效与否还要看它有没有成员）；
 * - `customContainers`：拖放里**自建**的容器（来源 View + 落位与顺序），成员归零即随记录一起收口；
 * - `panelPosition` / `panelAlignment` / `panelHidden` / `panelCollapsed`：面板的位置、对齐、
 *   完全隐藏与显式收起。
 *
 * 位置是跨 Project 的界面定制：用户在左栏/右栏/底部之间搬动工具后，换 Project 仍应保持。
 * 因此 scope 是 `user` 而不是 `project`；面板**尺寸**是 Project 属性，见 `workbench-panel-size.ts`。
 *
 * 除了 `version` 与 `placements`，其余字段都可缺省：缺省即产品默认，消费者按默认呈现，
 * **不为了补齐默认值写记录**。取值的语义判定（枚举成员、对齐是否适用、Part 取值域）在
 * `app/utils/workbench/{panel-state,view-placements}.ts`，这里只声明形状。
 *
 * 未知字段、未登记 id、未支持的位置字面量与旧字段的原件条目都保留：读取侧只过滤呈现，
 * 不把未知条目当损坏，也不清理"未来才有意义"的数据；坏的新字段则整条记录判为不可用
 * （保留原件、阻断普通覆盖），与既有字段同一规则。
 */

import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";

/** 工具位置记录的 owner。 */
export const WORKBENCH_VIEWS_OWNER = "workbench.views";

/** 位置与面板选择记录键；跨 Project 恢复的 user/local 单例。 */
export const WORKBENCH_VIEW_CUSTOMIZATIONS_KEY = "customizations";

export const WORKBENCH_VIEW_CUSTOMIZATIONS_SCHEMA_VERSION = 1;

/** 位置序号的最大值：只在拒绝明显无意义数值时使用，不是产品策略。 */
const VIEW_ORDER_MAX = 1_000_000;

/** 尺寸意图的上限（CSS px）：只在拒绝明显无意义数值时使用，不是产品策略。 */
const VIEW_SIZE_MAX = 1_000_000;

/**
 * 记录里的面板取值域。
 *
 * 与 `app/utils/workbench/panel-state.ts` 的 `SHELL_PANEL_POSITIONS` / `SHELL_PANEL_ALIGNMENTS`
 * 同源：这里声明一份是因为定义要能被 Nitro 打包（不能 import app 模块），漂移由
 * `shell-layout.test.ts` 的交叉断言挡住。
 */
export const WORKBENCH_PANEL_POSITIONS = ["bottom", "top", "left", "right"] as const;

export const WORKBENCH_PANEL_ALIGNMENTS = ["center", "left", "right", "justify"] as const;

type WorkbenchPanelPosition = (typeof WORKBENCH_PANEL_POSITIONS)[number];

type WorkbenchPanelAlignment = (typeof WORKBENCH_PANEL_ALIGNMENTS)[number];

/** 取值域成员表：静态字面量用 Record（不建 Set）。 */
const PANEL_POSITIONS: Record<string, true> = Object.fromEntries(WORKBENCH_PANEL_POSITIONS.map((id) => [id, true]));

const PANEL_ALIGNMENTS: Record<string, true> = Object.fromEntries(WORKBENCH_PANEL_ALIGNMENTS.map((id) => [id, true]));

export function isWorkbenchPanelPosition(value: unknown): value is WorkbenchPanelPosition {
    return typeof value === "string" && PANEL_POSITIONS[value] === true;
}

export function isWorkbenchPanelAlignment(value: unknown): value is WorkbenchPanelAlignment {
    return typeof value === "string" && PANEL_ALIGNMENTS[value] === true;
}

/** 一个 View 的位置覆盖：当前容器 + 保存时所基于的默认容器（默认指纹）。 */
export type WorkbenchViewPlacementRecord = {
    readonly containerId: string;
    readonly order: number;
    readonly defaultContainerId: string;
    readonly defaultOrder: number;
    readonly [field: string]: unknown;
};

/**
 * 一个容器的落位覆盖：当前位置 + 保存时所基于的默认位置（默认指纹）。
 *
 * `location` 是格式合法的字符串（含预留的 `window`）；**支持与否是求值层的事**，不是形状校验的事：
 * 记录里出现当前不支持的位置只过滤呈现，不做数据清理。
 */
export type ContainerPlacementRecord = {
    readonly location: string;
    readonly order: number;
    readonly defaultLocation: string;
    readonly defaultOrder: number;
    readonly [field: string]: unknown;
};

/**
 * 一个 View 的尺寸意图。
 *
 * `width` / `height` 都是**正有限**的展开尺寸意图（CSS px），不是降级后的实际尺寸；两轴各自独立，
 * 只在容器当前那一轴上呈现（左右排用 width、上下排用 height），换 Part 换轴时**不换算**数值，
 * 另一轴的意图原样留着。`collapsed` 是内容收起（保留 Section 标题头）。它按 viewId 保存、
 * 跨容器移动与换序都保留，因此**不存默认序号指纹**。
 */
export type ViewSizeRecord = {
    /** 展开宽度意图（CSS px）；左右排的内部分栏用它。 */
    readonly width?: number;
    /** 展开高度意图（CSS px）；上下排的内部分栏用它。 */
    readonly height?: number;
    readonly collapsed?: boolean;
    readonly [field: string]: unknown;
};

/**
 * 一个**自建容器**的默认事实：用户拖放时新建的容器没有 descriptor，它的事实就活在这条记录里。
 *
 * - `originViewId` 是创建时搬进来的那个 View：容器里没有可见成员时，标题与图标按它回落
 *   （有可见成员时仍跟随第一个可见 View，与静态容器同一口径）；
 * - `location` / `order` 是这个容器的**默认**落位与顺序：它和静态容器一样可以再被搬动，
 *   搬动写进同一条记录的 `containerPlacements`（默认指纹就是这里这两个值）；
 * - 成员归属照旧写在 `placements` 里，这里不复制成员表：实际成员归零的容器由写者收口删掉，
 *   不留一个没有入口的空容器。
 *
 * 与其它记录一样，位置只校验"非空字符串"（支持与否归求值层），未知字段保留。
 */
export type CustomViewContainerRecord = {
    readonly originViewId: string;
    readonly location: string;
    readonly order: number;
    readonly [field: string]: unknown;
};

export type WorkbenchViewCustomizationsRecord = {
    readonly version: number;
    readonly placements: Readonly<Record<string, WorkbenchViewPlacementRecord>>;
    /** 容器落位与顺序覆盖；缺省即 descriptor 里的默认落位。 */
    readonly containerPlacements?: Readonly<Record<string, ContainerPlacementRecord>>;
    /** 每个工具 Part 的活动容器；缺省按生效顺序第一项，记录选择无效时同样回落不写回。 */
    readonly activeContainerByPart?: Readonly<Record<string, string>>;
    /** View 的双轴尺寸意图与内容收起；缺省按 descriptor 的 `weight` 分配 `240 * weight`。 */
    readonly viewSizes?: Readonly<Record<string, ViewSizeRecord>>;
    /** 拖到零收起的 Part（保留 1px 恢复边界）；缺省 false。 */
    readonly dragCollapsedParts?: Readonly<Record<string, boolean>>;
    /** 侧栏的**显式**隐藏（零占用、无边界）；缺省 false。只有 left/right 会被消费。 */
    readonly hiddenSidebars?: Readonly<Record<string, boolean>>;
    /**
     * 被显式合并掉的源容器（整组并入目标后源不再呈现）；缺省 false。
     *
     * 只写 `true`（`false` 不是本字段的取值），清抑制靠**删键**。标记只是"用户合并过它"的证据，
     * **是否生效还要看它有没有已登记生效成员**：未来有 View 重新登记或落回该容器时容器自动回来，
     * 只读求值不为这种自动恢复清理记录（见 `view-placements.ts` 的 `isContainerSuppressed`）。
     */
    readonly suppressedContainers?: Readonly<Record<string, boolean>>;
    /**
     * 拖放里自建的容器（键是容器 id，由会话边界生成一次）：缺省即"没有自建容器"。
     *
     * 它只声明**容器自己的默认事实**，成员归属仍写在 `placements` 里；实际成员归零的容器由写者
     * 同次删掉（登记定义留在记录里会变成一个永远不可达的空容器）。
     */
    readonly customContainers?: Readonly<Record<string, CustomViewContainerRecord>>;
    /** 面板位置（bottom/top/left/right）；缺省按产品默认 bottom 呈现。 */
    readonly panelPosition?: WorkbenchPanelPosition;
    /** 面板对齐（center/left/right/justify）；只在水平位置生效，缺省按默认 center 呈现。 */
    readonly panelAlignment?: WorkbenchPanelAlignment;
    /** 面板是否完全隐藏（零占用）；缺省按默认 false 呈现。 */
    readonly panelHidden?: boolean;
    /** 水平面板的显式收起（只留 32px 标题头）；缺省按默认 false 呈现。 */
    readonly panelCollapsed?: boolean;
    readonly [field: string]: unknown;
};

function isRecordObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isOrder(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= VIEW_ORDER_MAX;
}

/**
 * 一个轴上的尺寸意图：正有限数且不超过上限。
 *
 * 0 与负数是"降级/收起"，不是意图（收起走 `collapsed`）；`width` 与 `height` 用同一份判据。
 */
export function isWorkbenchViewSize(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= VIEW_SIZE_MAX;
}

/** 位置覆盖：四个字段齐全；默认容器可以等于当前容器（未移动过但仍记录指纹）。 */
export function isWorkbenchViewPlacementRecord(value: unknown): value is WorkbenchViewPlacementRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {
        readonly containerId?: unknown;
        readonly order?: unknown;
        readonly defaultContainerId?: unknown;
        readonly defaultOrder?: unknown;
    };
    return isIdentifier(candidate.containerId)
        && isOrder(candidate.order)
        && isIdentifier(candidate.defaultContainerId)
        && isOrder(candidate.defaultOrder);
}

/** 容器落位覆盖：四个字段齐全；位置只校验"非空字符串"（支持与否归求值层）。 */
export function isContainerPlacementRecord(value: unknown): value is ContainerPlacementRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {
        readonly location?: unknown;
        readonly order?: unknown;
        readonly defaultLocation?: unknown;
        readonly defaultOrder?: unknown;
    };
    return isIdentifier(candidate.location)
        && isOrder(candidate.order)
        && isIdentifier(candidate.defaultLocation)
        && isOrder(candidate.defaultOrder);
}

/** 自建容器：三个字段齐全；位置只校验"非空字符串"（支持与否归求值层）。 */
export function isCustomViewContainerRecord(value: unknown): value is CustomViewContainerRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {
        readonly originViewId?: unknown;
        readonly location?: unknown;
        readonly order?: unknown;
    };
    return isIdentifier(candidate.originViewId)
        && isIdentifier(candidate.location)
        && isOrder(candidate.order);
}

/** 尺寸意图：三个字段都可缺省；空对象合法（等于"没有意图"）。 */
export function isViewSizeRecord(value: unknown): value is ViewSizeRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {readonly width?: unknown; readonly height?: unknown; readonly collapsed?: unknown};
    return (candidate.width === undefined || isWorkbenchViewSize(candidate.width))
        && (candidate.height === undefined || isWorkbenchViewSize(candidate.height))
        && (candidate.collapsed === undefined || typeof candidate.collapsed === "boolean");
}

/** 已知形状的"字符串 → 值"表：键必须是非空 id，值交给调用方给的判定函数。 */
function isTable(value: unknown, entryOk: (entry: unknown) => boolean): value is Readonly<Record<string, unknown>> {
    if (!isRecordObject(value)) {
        return false;
    }
    for (const [key, entry] of Object.entries(value)) {
        if (!isIdentifier(key) || !entryOk(entry)) {
            return false;
        }
    }
    return true;
}

/**
 * 记录形状：`placements` 与四个 panel 字段沿用原归属，其余扩展字段都可缺省。
 *
 * 旧字段 `activeViewByContainer` **不再是已知字段**：它只通过顶层 `...source` 原样透传
 * （保留原件、不参与变更判定），因此这里既不要求它存在，也不校验它的取值。
 */
export function isWorkbenchViewCustomizationsRecord(value: unknown): value is WorkbenchViewCustomizationsRecord {
    if (!isRecordObject(value)) {
        return false;
    }
    const candidate = value as {
        readonly placements?: unknown;
        readonly containerPlacements?: unknown;
        readonly activeContainerByPart?: unknown;
        readonly viewSizes?: unknown;
        readonly dragCollapsedParts?: unknown;
        readonly hiddenSidebars?: unknown;
        readonly suppressedContainers?: unknown;
        readonly customContainers?: unknown;
        readonly panelPosition?: unknown;
        readonly panelAlignment?: unknown;
        readonly panelHidden?: unknown;
        readonly panelCollapsed?: unknown;
    };
    if (!isTable(candidate.placements, isWorkbenchViewPlacementRecord)) {
        return false;
    }
    if (candidate.containerPlacements !== undefined && !isTable(candidate.containerPlacements, isContainerPlacementRecord)) {
        return false;
    }
    if (candidate.activeContainerByPart !== undefined && !isTable(candidate.activeContainerByPart, isIdentifier)) {
        return false;
    }
    if (candidate.viewSizes !== undefined && !isTable(candidate.viewSizes, isViewSizeRecord)) {
        return false;
    }
    if (candidate.dragCollapsedParts !== undefined && !isTable(candidate.dragCollapsedParts, (entry) => typeof entry === "boolean")) {
        return false;
    }
    if (candidate.hiddenSidebars !== undefined && !isTable(candidate.hiddenSidebars, (entry) => typeof entry === "boolean")) {
        return false;
    }
    if (candidate.suppressedContainers !== undefined && !isTable(candidate.suppressedContainers, (entry) => typeof entry === "boolean")) {
        return false;
    }
    if (candidate.customContainers !== undefined && !isTable(candidate.customContainers, isCustomViewContainerRecord)) {
        return false;
    }
    return (candidate.panelPosition === undefined || isWorkbenchPanelPosition(candidate.panelPosition))
        && (candidate.panelAlignment === undefined || isWorkbenchPanelAlignment(candidate.panelAlignment))
        && (candidate.panelHidden === undefined || typeof candidate.panelHidden === "boolean")
        && (candidate.panelCollapsed === undefined || typeof candidate.panelCollapsed === "boolean");
}

/**
 * 缺失记录时的显示回落：空覆盖表示"全部按产品默认位置"。
 *
 * 它不是一条会被写出的记录：消费者在缺失时按默认值渲染，只在用户显式移动/收起后才保存；
 * 也只声明当前理解的字段（退役字段不回写）。
 */
export const WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT: WorkbenchViewCustomizationsRecord = Object.freeze({
    version: WORKBENCH_VIEW_CUSTOMIZATIONS_SCHEMA_VERSION,
    placements: {},
} as WorkbenchViewCustomizationsRecord);

/** 建立工具位置定义（user/local，单例）。 */
export function defineWorkbenchViewCustomizationsState(): DefinedStorageState<WorkbenchViewCustomizationsRecord> {
    return defineStorageState<WorkbenchViewCustomizationsRecord>({
        owner: WORKBENCH_VIEWS_OWNER,
        key: WORKBENCH_VIEW_CUSTOMIZATIONS_KEY,
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_VIEW_CUSTOMIZATIONS_SCHEMA_VERSION,
        defaultValue: WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT,
        validate: isWorkbenchViewCustomizationsRecord,
    });
}
