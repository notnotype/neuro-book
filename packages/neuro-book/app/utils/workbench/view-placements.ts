/**
 * 工具视图与容器位置（placement）的纯模型：默认落位、记录覆盖、排序、移动/选择/尺寸/整组并入意图。
 *
 * 位置有四个概念，别混（提案「位置与意图」）：Part 位置归布局层、容器与视图的**默认**落位归
 * descriptor（`containers.ts` / `product-catalog.ts`）、容器与视图**实际**的落位与顺序归这里消费的
 * `workbench.views/customizations`、View 的**双轴尺寸意图**同样归这条记录（按 viewId 保存）。
 * 本模块只做纯计算：不 import Vue、不读 Storage、不发请求、不 import 任何 Lab / spike 代码。
 *
 * 整组并入（`merge-container`）是唯一让容器"消失"的路径：源容器的全部已登记生效成员按冻结顺序
 * 并进目标，源只写一个抑制标记（不删 descriptor、落位、尺寸）。抑制**是否生效**还要看它有没有成员，
 * 因此 `reopen-container`（只清抑制）与 `restore-container-placement`（恢复默认落位）是两件事。
 *
 * 拖放自建的容器活在**同一条记录**里（`customContainers`，键是会话边界生成一次的稳定 id）：`detach-view`
 * 一次合成就把"建容器 + 搬成员 + 选中目标 Part"写完，成员归零时同次收口删掉（静态容器只退出呈现，
 * 注册定义永远保留）。实际成员数为 0 的容器没有导航入口，`hidden` 与 `collapsed` 都算成员。
 *
 * 边缘并入的**半区分配**（`split`）与归属移动在同一次合成里落账：命中叶取一半，拖入的可见成员按
 * 来源份额分另一半（`ViewSplitPlacement`），隐藏成员只改归属；任何一项校验不过整条不写。
 *
 * 覆盖记录里同时存"当前落位 + 保存时所基于的默认落位与序号"（默认指纹）。读取规则：
 * - 指纹与当前产品默认不符 → 该覆盖失效，回**新**默认落位，只过滤这一个覆盖并报 issue；
 * - 目标容器未登记 / 位置字面量未支持（例如预留的 `window`）→ 同样只过滤这一个覆盖；
 * - 视图声明 `canMoveView: false` → 覆盖一律不生效（产品说它不能移动）。
 *
 * View 尺寸**不设指纹**：它按 viewId 保存，换容器位置或换序都不该丢掉用户高度，因此不能拿
 * 默认序号当指纹（序号会因换序而变）。
 *
 * 移动与选择意图在命令边界校验（未知实体 / 不可移动 / 当前上下文不可见 / 来源与生效落位不符 /
 * 锚点不属于目标集合 / 目标位置不可落位），通过后只产出"把 X 放到 Y、插在 Z 之前"的意图；
 * 目标位置序号在**合成时的最新底本**上算，不带着较早算出的 order 覆盖整条记录。
 * 补丁保留来源与锚点直到合成，因此 CAS 冲突重读重放时能重新校验一次（见 `composeViewPlacements`）。
 */

import type {WorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import type {LayoutRecordIntent} from "nbook/app/utils/workbench/layout-session";
// 只借"Part → 容器内部轴"这一份判据（半区分配的轴与呈现同源）；反向只有 `import type`，运行期没有环。
import {containerAxis} from "nbook/app/utils/workbench/view-container-layout";
import {
    isHorizontalPanelPosition,
    resolvePanelPreferences,
    type ShellPanelAlignment,
    type ShellPanelPosition,
    type WorkbenchPanelPreferences,
} from "nbook/app/utils/workbench/panel-state";
import {
    WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT,
    WORKBENCH_VIEW_CUSTOMIZATIONS_SCHEMA_VERSION,
    isWorkbenchViewSize,
    type ContainerPlacementRecord,
    type CustomViewContainerRecord,
    type ViewSizeRecord,
    type WorkbenchViewCustomizationsRecord,
    type WorkbenchViewPlacementRecord,
} from "nbook/shared/storage/workbench-views";

// ── 工具 Part 与位置字面量 ───────────────────────────────────────────────────

/**
 * 能承载容器的 Part。`titlebar` / `activity` / `editor` / `statusbar` 是外壳骨架，
 * 不接收容器与视图，因此不属于这里的取值域。
 */
export const TOOL_PART_IDS = ["left", "right", "panel"] as const;

export type ToolPartId = (typeof TOOL_PART_IDS)[number];

/** 取值域成员表：静态字面量用 Record（不建 Set）。 */
const TOOL_PARTS: Record<string, true> = Object.fromEntries(TOOL_PART_IDS.map((id) => [id, true]));

export function isToolPartId(value: unknown): value is ToolPartId {
    return typeof value === "string" && TOOL_PARTS[value] === true;
}

/** 可落位的容器位置字面量；预留的 `window` **不**包含在内（已识别但不可呈现）。 */
export const TOOL_PART_LOCATIONS = ["sidebar-left", "sidebar-right", "panel"] as const;

export type ToolPartLocation = (typeof TOOL_PART_LOCATIONS)[number];

const PART_OF_LOCATION: Record<string, ToolPartId> = {
    "sidebar-left": "left",
    "sidebar-right": "right",
    panel: "panel",
};

/** 位置字面量 → 承载它的 Part；`window` 与未登记位置都返回 null（不可落位）。 */
export function toolPartOfLocation(location: string): ToolPartId | null {
    return Object.hasOwn(PART_OF_LOCATION, location) ? PART_OF_LOCATION[location]! : null;
}

export function isToolPartLocation(value: unknown): value is ToolPartLocation {
    return typeof value === "string" && toolPartOfLocation(value) !== null;
}

// ── 目录 ─────────────────────────────────────────────────────────────────────

/** 产品侧的默认落位表：进程内不变（注册表构造一次），测试可另给一份。 */
export type PlacementCatalog = {
    /** 已登记视图 → 默认容器 + 默认序号 + 可否跨容器移动。 */
    readonly views: Readonly<Record<string, ViewPlacementDefaults>>;
    /** 可接收视图与容器的落点（注册表里位置求值通过的容器，按 (order, id) 排好）。 */
    readonly containers: readonly string[];
    /** 全部已登记容器的默认落位（含位置求值不通过的，用于给覆盖报"不可落位"诊断）。 */
    readonly containerDefaults: Readonly<Record<string, ContainerPlacementDefaults>>;
};

export type ViewPlacementDefaults = {
    readonly containerId: string;
    readonly order: number;
    readonly movable: boolean;
};

export type ContainerPlacementDefaults = {
    /** descriptor 里声明的默认落位（可能是不可呈现的 `window`）。 */
    readonly location: string;
    readonly order: number;
    /** 未声明按可移动处理；明确 false 的容器不提供移动入口，也不作为容器移动的落点。 */
    readonly movable: boolean;
};

let catalogSource: WorkbenchRegistry | null = null;
let catalogCache: PlacementCatalog | null = null;

/**
 * 从注册表摘出位置求值需要的三份表：本模块不 import 具体产品目录。
 *
 * 落点清单用注册表求值过的容器（注册表在构造时就拒绝了位置枚举求不出来的容器），
 * 再按位置字面量过滤一次 `window`——求值层与呈现层的判据保持同一份。
 *
 * 按注册表**身份**记忆一次：注册表构造一次就不再变（声明不随运行期变化），而位置求值在每次呈现
 * 求值时都会被调用，重复重建这三张表没有意义。
 */
export function placementCatalogOf(registry: WorkbenchRegistry): PlacementCatalog {
    if (catalogSource === registry && catalogCache !== null) {
        return catalogCache;
    }
    const views: Record<string, ViewPlacementDefaults> = {};
    for (const view of registry.views()) {
        views[view.id] = {containerId: view.container, order: view.order, movable: view.canMoveView};
    }
    const containers: string[] = [];
    const containerDefaults: Record<string, ContainerPlacementDefaults> = {};
    for (const container of registry.containers()) {
        containerDefaults[container.id] = {
            location: container.location,
            order: container.order,
            movable: container.canMoveContainer !== false,
        };
        if (toolPartOfLocation(container.location) !== null) {
            containers.push(container.id);
        }
    }
    const catalog: PlacementCatalog = {views, containers, containerDefaults};
    catalogSource = registry;
    catalogCache = catalog;
    return catalog;
}

/**
 * 把记录里的**自建容器**合进静态目录：静态目录是注册表的事实，自建容器是同一条位置记录里的事实。
 *
 * 合成出来的目录只多出两类事实，静态部分一个字节都不改：
 * - `containerDefaults`：每个自建容器按它的默认事实（`location` / `order`）登记，`movable` 一律为真
 *   ——自建容器没有 descriptor，用户自己建出来的容器就该能再搬；
 * - `containers`（可落点清单）：只加**落位可呈现**的自建容器；位置不可落位（例如预留的 `window`）
 *   的自建容器只登记默认事实、不进落点清单，与 `placementCatalogOf` 对静态容器的口径一致。
 *
 * 撞上静态 id 的自建记录被忽略（静态优先）；没有自建容器时**返回原对象**，调用方不用在热路径上判断。
 * 它不修改注册表，也不改变任何一个 descriptor。
 */
export function placementCatalogWithContainers(
    catalog: PlacementCatalog,
    customContainers: WorkbenchViewCustomizationsRecord["customContainers"],
): PlacementCatalog {
    const ids = Object.keys(customContainers ?? {})
        .filter((containerId) => !Object.hasOwn(catalog.containerDefaults, containerId));
    if (ids.length === 0) {
        return catalog;
    }
    const containerDefaults: Record<string, ContainerPlacementDefaults> = {...catalog.containerDefaults};
    const placeable: string[] = [];
    for (const containerId of ids) {
        const record = customContainers![containerId]!;
        containerDefaults[containerId] = {location: record.location, order: record.order, movable: true};
        if (toolPartOfLocation(record.location) !== null) {
            placeable.push(containerId);
        }
    }
    const containers = [...catalog.containers, ...placeable].sort((left, right) => compareContainerPlacements(
        {containerId: left, order: containerDefaults[left]!.order},
        {containerId: right, order: containerDefaults[right]!.order},
    ));
    return {views: catalog.views, containers, containerDefaults};
}

// ── 视图位置读取 ─────────────────────────────────────────────────────────────

export type ViewPlacementSource = "record" | "default";

/** 一个视图的生效位置。 */
export type EffectiveViewPlacement = {
    readonly viewId: string;
    readonly containerId: string;
    readonly order: number;
    /** `record` = 用户覆盖生效；`default` = 按产品默认（含覆盖被过滤的情形）。 */
    readonly source: ViewPlacementSource;
};

/** 被过滤的覆盖（原件保留、只不参与呈现）与原因。 */
export type ViewPlacementProblem = {
    readonly viewId: string;
    readonly diagnosis: string;
};

export type ViewPlacementReading = {
    readonly placements: readonly EffectiveViewPlacement[];
    readonly problems: readonly ViewPlacementProblem[];
};

/** 位置顺序：`order` 升序，同值按 id 稳定排序（与注册表的容器内排序同一口径）。 */
export function comparePlacements(left: {readonly viewId: string; readonly order: number}, right: {readonly viewId: string; readonly order: number}): number {
    if (left.order !== right.order) {
        return left.order - right.order;
    }
    return left.viewId < right.viewId ? -1 : left.viewId > right.viewId ? 1 : 0;
}

/** 容器顺序：与视图同一口径（`order` 升序，同值按 id 稳定排序）。 */
export function compareContainerPlacements(left: {readonly containerId: string; readonly order: number}, right: {readonly containerId: string; readonly order: number}): number {
    if (left.order !== right.order) {
        return left.order - right.order;
    }
    return left.containerId < right.containerId ? -1 : left.containerId > right.containerId ? 1 : 0;
}

/**
 * 读取生效位置：覆盖优先，其次产品默认。
 *
 * 每个视图恰好一条结果（`placements` 与注册表的视图集合一一对应），被过滤的覆盖在 `problems` 里
 * 逐条说明。记录里指向**未登记视图**的条目同样只报 issue：原件由记录会话原样保留。
 */
export function readViewPlacements(
    catalog: PlacementCatalog,
    overrides: Readonly<Record<string, WorkbenchViewPlacementRecord>> | null | undefined,
): ViewPlacementReading {
    const placements: EffectiveViewPlacement[] = [];
    const problems: ViewPlacementProblem[] = [];
    for (const viewId of Object.keys(catalog.views)) {
        const defaults = catalog.views[viewId]!;
        const override = overrides?.[viewId];
        if (override === undefined) {
            placements.push({viewId, containerId: defaults.containerId, order: defaults.order, source: "default"});
            continue;
        }
        const diagnosis = overrideDiagnosis(catalog, viewId, defaults, override);
        if (diagnosis !== null) {
            problems.push({viewId, diagnosis});
            placements.push({viewId, containerId: defaults.containerId, order: defaults.order, source: "default"});
            continue;
        }
        placements.push({viewId, containerId: override.containerId, order: override.order, source: "record"});
    }
    for (const viewId of Object.keys(overrides ?? {})) {
        if (!Object.hasOwn(catalog.views, viewId)) {
            problems.push({viewId, diagnosis: `记录里有未登记视图 ${viewId} 的位置覆盖，已忽略（原件保留）`});
        }
    }
    return {placements, problems};
}

function overrideDiagnosis(
    catalog: PlacementCatalog,
    viewId: string,
    defaults: ViewPlacementDefaults,
    override: WorkbenchViewPlacementRecord,
): string | null {
    if (!defaults.movable) {
        return `视图 ${viewId} 声明不可跨容器移动，记录里的位置覆盖被忽略`;
    }
    if (override.defaultContainerId !== defaults.containerId || override.defaultOrder !== defaults.order) {
        return `视图 ${viewId} 的默认位置已变（记录基于 ${override.defaultContainerId}#${override.defaultOrder}），覆盖失效并回到新默认位置`;
    }
    if (!catalog.containers.includes(override.containerId)) {
        return `视图 ${viewId} 的位置覆盖指向不可落位的容器 ${override.containerId}，已忽略`;
    }
    return null;
}

/** 某个容器里的生效视图，按 (order, id) 排好。 */
export function placementsOfContainer(
    reading: ViewPlacementReading,
    containerId: string,
): readonly EffectiveViewPlacement[] {
    return reading.placements.filter((placement) => placement.containerId === containerId).sort(comparePlacements);
}

// ── 容器落位读取 ─────────────────────────────────────────────────────────────

/** 一个容器的生效落位。 */
export type EffectiveContainerPlacement = {
    readonly containerId: string;
    readonly location: string;
    readonly order: number;
    readonly source: ViewPlacementSource;
};

export type ContainerPlacementProblem = {
    readonly containerId: string;
    readonly diagnosis: string;
};

export type ContainerPlacementReading = {
    readonly placements: readonly EffectiveContainerPlacement[];
    readonly problems: readonly ContainerPlacementProblem[];
};

/**
 * 读取容器生效落位：覆盖优先，其次 descriptor 默认。
 *
 * 与视图同一口径：每个已登记容器恰好一条结果；指纹不符、位置不可落位、未登记容器都只过滤呈现
 * 并报 issue，原件保留。位置字面量"格式合法但当前不支持"（例如预留的 `window`）只过滤，
 * 不清理未来数据。
 */
export function readContainerPlacements(
    catalog: PlacementCatalog,
    overrides: Readonly<Record<string, ContainerPlacementRecord>> | null | undefined,
): ContainerPlacementReading {
    const placements: EffectiveContainerPlacement[] = [];
    const problems: ContainerPlacementProblem[] = [];
    for (const containerId of Object.keys(catalog.containerDefaults)) {
        const defaults = catalog.containerDefaults[containerId]!;
        const override = overrides?.[containerId];
        if (override === undefined) {
            placements.push({containerId, location: defaults.location, order: defaults.order, source: "default"});
            continue;
        }
        const diagnosis = containerOverrideDiagnosis(containerId, defaults, override);
        if (diagnosis !== null) {
            problems.push({containerId, diagnosis});
            placements.push({containerId, location: defaults.location, order: defaults.order, source: "default"});
            continue;
        }
        placements.push({containerId, location: override.location, order: override.order, source: "record"});
    }
    for (const containerId of Object.keys(overrides ?? {})) {
        if (!Object.hasOwn(catalog.containerDefaults, containerId)) {
            problems.push({containerId, diagnosis: `记录里有未登记容器 ${containerId} 的落位覆盖，已忽略（原件保留）`});
        }
    }
    return {placements, problems};
}

function containerOverrideDiagnosis(
    containerId: string,
    defaults: ContainerPlacementDefaults,
    override: ContainerPlacementRecord,
): string | null {
    if (override.defaultLocation !== defaults.location || override.defaultOrder !== defaults.order) {
        return `容器 ${containerId} 的默认落位已变（记录基于 ${override.defaultLocation}#${override.defaultOrder}），覆盖失效并回到新默认落位`;
    }
    if (toolPartOfLocation(override.location) === null) {
        return `容器 ${containerId} 的落位覆盖指向不可落位的位置 ${override.location}，已忽略`;
    }
    return null;
}

/** 某个 Part 里的生效容器，按 (order, id) 排好；不可落位的位置不属于任何 Part。 */
export function containersOfPart(
    reading: ContainerPlacementReading,
    partId: ToolPartId,
): readonly EffectiveContainerPlacement[] {
    return reading.placements
        .filter((placement) => toolPartOfLocation(placement.location) === partId)
        .sort(compareContainerPlacements);
}

/** 某个落位上的生效容器，按 (order, id) 排好；容器移动的插入点用它。 */
export function containersAtLocation(
    reading: ContainerPlacementReading,
    location: string,
): readonly EffectiveContainerPlacement[] {
    return reading.placements
        .filter((placement) => placement.location === location)
        .sort(compareContainerPlacements);
}

// ── 源容器消失与恢复 ─────────────────────────────────────────────────────────

/**
 * 抑制求值需要的三张表：**记录**或**合成过程中的中间表**都满足它。
 *
 * 记录态用 `record` 直接传；纯合成在候选表上求值（它自己的中间状态才是重放的真相）。
 */
export type ContainerSuppressionInput = Readonly<{
    readonly placements: Readonly<Record<string, WorkbenchViewPlacementRecord>>;
    readonly containerPlacements?: Readonly<Record<string, ContainerPlacementRecord>>;
    readonly suppressedContainers?: Readonly<Record<string, boolean>>;
}>;

/**
 * 生效抑制的容器：标记 `true` **且**没有任何已登记生效成员（hidden 也算成员）。
 *
 * 只读求值**不**因为容器又有成员而清理标记：那会让"未来 View 重新落回源容器"变成一次写盘。
 * 一次成员扫描求出整个集合，调用方不要逐容器重算（`product-catalog` 的读集合也复用这一份核心）。
 */
export function suppressedContainerIds(
    catalog: PlacementCatalog,
    record: ContainerSuppressionInput,
): Readonly<Record<string, true>> {
    const markers = record.suppressedContainers;
    if (markers === undefined) {
        return {};
    }
    const members: Record<string, true> = {};
    for (const placement of readViewPlacements(catalog, record.placements).placements) {
        members[placement.containerId] = true;
    }
    const suppressed: Record<string, true> = {};
    for (const [containerId, marked] of Object.entries(markers)) {
        if (marked === true && members[containerId] !== true && catalog.containerDefaults[containerId] !== undefined) {
            suppressed[containerId] = true;
        }
    }
    return suppressed;
}

/** 一个容器此刻是否被抑制（标记为真且没有成员）；未知容器的标记不参与呈现，但原件保留。 */
export function isContainerSuppressed(
    catalog: PlacementCatalog,
    record: ContainerSuppressionInput,
    containerId: string,
): boolean {
    return suppressedContainerIds(catalog, record)[containerId] === true;
}

/**
 * 记录态里**参与呈现**的容器落位：抑制生效的容器不在里面（也不在任何 Part 的活动清单里）。
 *
 * 命令校验与宿主都消费这一份，不要在每个 UI 里各自过滤。
 */
export function readEffectiveContainerPlacements(
    catalog: PlacementCatalog,
    record: ContainerSuppressionInput,
): ContainerPlacementReading {
    const reading = readContainerPlacements(catalog, record.containerPlacements);
    const suppressed = suppressedContainerIds(catalog, record);
    return {
        placements: reading.placements.filter((placement) => suppressed[placement.containerId] !== true),
        problems: reading.problems,
    };
}

/** 某个容器里**全部**已登记生效成员，按 (order, id) 排好（hidden 与 collapsed 也算成员）。 */
export function membersOfContainer(
    reading: ViewPlacementReading,
    containerId: string,
): readonly OrderedMember[] {
    return placementsOfContainer(reading, containerId).map((placement) => ({id: placement.viewId, order: placement.order}));
}

// ── Part 显隐偏好 ─────────────────────────────────────────────────────────────

/**
 * Part 的**显式**隐藏：只有 left/right 认 `hiddenSidebars`，Panel 的隐藏归 `panelHidden`
 * （由 `resolvePanelPreferences` 求值）。记录的键是未知 Part 或取值不是 true 时一律不隐藏——
 * 未知记录保留原件，但不参与呈现。
 */
export function isSidebarExplicitlyHidden(
    record: Pick<WorkbenchViewCustomizationsRecord, "hiddenSidebars">,
    partId: ToolPartId,
): boolean {
    return (partId === "left" || partId === "right") && record.hiddenSidebars?.[partId] === true;
}

/** Part 的拖到零收起：left/right/panel 都认（它保留 1px 恢复边界，不是"移出布局"）。 */
export function isPartDragCollapsed(
    record: Pick<WorkbenchViewCustomizationsRecord, "dragCollapsedParts">,
    partId: ToolPartId,
): boolean {
    return record.dragCollapsedParts?.[partId] === true;
}

// ── 插入序号 ─────────────────────────────────────────────────────────────────

/** 目标集合里的一个成员（id + 当前生效序号）。 */
export type OrderedMember = {readonly id: string; readonly order: number};

/** 重排步长：精度耗尽时按它把本次目标集合铺开，给后续中点插入留出空间。 */
const ORDER_STEP = 10;

/** 位置序号的上限；与 `shared/storage/workbench-views.ts` 的形状校验同一口径。 */
const ORDER_MAX = 1_000_000;

export type InsertionPlan =
    | {readonly ok: true; readonly order: number; readonly rerank: Readonly<Record<string, number>>}
    | {readonly ok: false; readonly diagnosis: string};

/**
 * 在目标集合（已按 (order,id) 排好、且已排除被移动的那一个）里求插入序号。
 *
 * `beforeId` 是插入点之后的那个成员；没给就是追加到末尾（最大序号 + 1）。
 * 相邻中点浮点精度用尽、序号越界或集合已经密到没法重排时，**只**把本次目标集合重排为
 * 10 的倍数（其它集合、其它容器与未知条目原样保留），重排后插入序号取中点。
 */
export function resolveInsertion(members: readonly OrderedMember[], beforeId: string | undefined): InsertionPlan {
    const index = beforeId === undefined ? members.length : members.findIndex((member) => member.id === beforeId);
    // 锚点不在集合里（合成时被第三方带走）：按追加处理，命令边界已经拒绝过这种情况。
    const at = index === -1 ? members.length : index;
    const lower = at > 0 ? members[at - 1] : undefined;
    const upper = at < members.length ? members[at] : undefined;
    if (lower === undefined && upper === undefined) {
        return {ok: true, order: ORDER_STEP, rerank: {}};
    }
    if (upper === undefined) {
        const order = lower!.order + 1;
        return order <= ORDER_MAX
            ? {ok: true, order, rerank: {}}
            : rerankInsertion(members, at);
    }
    if (lower === undefined) {
        // 插入到集合最前：取它的一半，0 附近再插就得重排。
        const order = upper.order / 2;
        return order > 0 ? {ok: true, order, rerank: {}} : rerankInsertion(members, at);
    }
    const order = (lower.order + upper.order) / 2;
    return order > lower.order && order < upper.order
        ? {ok: true, order, rerank: {}}
        : rerankInsertion(members, at);
}

/** 精度用尽时的兜底：本次目标集合铺成 10/20/30…，插入序号取重排后的中点。 */
function rerankInsertion(members: readonly OrderedMember[], at: number): InsertionPlan {
    if ((members.length + 1) * ORDER_STEP > ORDER_MAX) {
        return {ok: false, diagnosis: "目标集合的序号已经排满，无法在不重建整份记录的前提下插入"};
    }
    const rerank: Record<string, number> = {};
    members.forEach((member, index) => {
        rerank[member.id] = (index + 1) * ORDER_STEP;
    });
    return {ok: true, order: at * ORDER_STEP + ORDER_STEP / 2, rerank};
}

// ── 移动意图与命令边界 ───────────────────────────────────────────────────────

/**
 * 一次边缘并入的**半区分配**：命中的 View 窗格一分为二，拖入的可见成员按来源份额拿另一半。
 *
 * 两张表都是"释放那一刻**有效可见叶**的主轴 CSS px"（隐藏成员不出现在任何一张表里：它们只改归属，
 * 不凭空占几何）：
 * - `targetSizes`：**目标**容器的可见叶（含命中叶）。跨容器时表里除命中叶以外的成员份额不因这次局部分屏重置；
 * - `sourceSizes`：拖入成员的来源份额。跨容器时是**来源**容器的可见叶；跨轴并入时它只当相对比例用，
 *   绝不把来源那一轴的像素写进目标轴（见「半区分配与来源比例」）。
 *
 * 尺寸意图只用于**跨容器**并入：命中叶取一半，另一半按 `sourceSizes` 比例分给拖入的可见成员。
 * 同一容器内的边缘落点只改变成员顺序，所有 View 保留原尺寸；任一校验不过**整条不写**。
 */
export type ViewSplitPlacement = {
    /** 命中叶：必须是目标容器的生效成员，且不是本次拖进来的那个 View。 */
    readonly targetViewId: string;
    /** 拖入成员接在命中叶的哪一侧：容器顺序里的 before / after。 */
    readonly side: "before" | "after";
    /** 容器内部的编排轴（left/right 上下排用 height、panel 左右排用 width）；与目标容器不符即拒绝。 */
    readonly axis: "width" | "height";
    readonly targetSizes: Readonly<Record<string, number>>;
    readonly sourceSizes: Readonly<Record<string, number>>;
};

/** 一次 View 移动请求：`sourceContainerId` 是发起时界面认为的来源（拖动载荷 / 菜单上下文）。 */
export type ViewMoveRequest = {
    readonly viewId: string;
    readonly sourceContainerId: string;
    readonly targetContainerId: string;
    /** 插到这个成员之前；缺省追加到目标集合末尾。带 `split` 时插入点由命中叶与 `side` 求得。 */
    readonly beforeViewId?: string;
    /** 边缘落点：同一次合成里连半区尺寸一起落账；缺省是纯归属移动（Switcher 插入位 / 菜单）。 */
    readonly split?: ViewSplitPlacement;
};

/**
 * 一次 View 拖出：把单个 View 从来源容器搬进**一个自建容器**，落位由落点决定。
 *
 * 它没有 `targetContainerId`——容器的 id 由会话边界生成一次（`ViewDetachIntent.containerId`），
 * resolver 不生成随机 id；因此这里也不带 `split`（新容器只有这一个成员，它填满内容区）。
 */
export type ViewDetachRequest = {
    readonly viewId: string;
    readonly sourceContainerId: string;
    readonly targetLocation: ToolPartLocation;
    /** 新容器插到这个容器之前；缺省追加到目标落位末尾。 */
    readonly beforeContainerId?: string;
    /** 发起时的工作面代际：与 `set-view-sizes` 同一口径，跨工作面到达的请求整组拒绝。 */
    readonly contextKey: string;
};

export type ViewMoveDecision =
    | {
        readonly kind: "move";
        readonly viewId: string;
        readonly targetContainerId: string;
        readonly beforeViewId?: string;
        readonly split?: ViewSplitPlacement;
    }
    | {readonly kind: "noop"; readonly diagnosis: string}
    | {readonly kind: "rejected"; readonly diagnosis: string};

/** 一次容器移动请求：`sourceLocation` 同样是发起时的界面事实。 */
export type ContainerMoveRequest = {
    readonly containerId: string;
    readonly sourceLocation: string;
    readonly targetLocation: ToolPartLocation;
    /** 插到这个容器之前；缺省追加到目标落位末尾。 */
    readonly beforeContainerId?: string;
};

export type ContainerMoveDecision =
    | {readonly kind: "move"; readonly containerId: string; readonly targetLocation: ToolPartLocation; readonly beforeContainerId?: string}
    | {readonly kind: "noop"; readonly diagnosis: string}
    | {readonly kind: "rejected"; readonly diagnosis: string};

/**
 * View 移动意图的命令边界：任一不成立都**拒绝且不改变当前状态**。
 *
 * `visibleViewIds` 由调用方按当前上下文求值（`resolveViewPresentation` 的同一口径）——
 * 不在其中说明这次意图基于过期的界面（例如切走工作面之后的迟到回调）。锚点必须是目标集合的成员
 * 且不是自己；同容器同位置就是无操作，不改任何记录。
 *
 * 带 `split`（边缘并入）时锚点与"同位置无操作"都不参与：落点由命中叶与 `side` 决定，同容器的边缘
 * 落点也**不能**被旧的顺序判定当成无操作吞掉——它的几何结果由合成校验与落账。
 */
export function resolveViewMove(input: {
    readonly catalog: PlacementCatalog;
    readonly reading: ViewPlacementReading;
    readonly request: ViewMoveRequest;
    readonly visibleViewIds: readonly string[];
}): ViewMoveDecision {
    const {catalog, reading, request} = input;
    const defaults = catalog.views[request.viewId];
    if (defaults === undefined) {
        return {kind: "rejected", diagnosis: `未登记的视图 ${request.viewId}，拒绝移动`};
    }
    if (!defaults.movable) {
        return {kind: "rejected", diagnosis: `视图 ${request.viewId} 声明不可跨容器移动`};
    }
    if (!input.visibleViewIds.includes(request.viewId)) {
        return {kind: "rejected", diagnosis: `视图 ${request.viewId} 在当前上下文里不可见，拒绝这次移动`};
    }
    if (!catalog.containers.includes(request.targetContainerId)) {
        return {kind: "rejected", diagnosis: `目标容器 ${request.targetContainerId} 未登记或不可落位，拒绝移动`};
    }
    const current = reading.placements.find((placement) => placement.viewId === request.viewId);
    if (current === undefined) {
        return {kind: "rejected", diagnosis: `视图 ${request.viewId} 没有生效位置，拒绝移动`};
    }
    if (current.containerId !== request.sourceContainerId) {
        return {
            kind: "rejected",
            diagnosis: `来源容器 ${request.sourceContainerId} 与视图 ${request.viewId} 的当前容器 ${current.containerId} 不一致，拒绝移动`,
        };
    }
    const split = request.split;
    const anchor = split === undefined ? request.beforeViewId : undefined;
    if (anchor !== undefined) {
        if (anchor === request.viewId) {
            return {kind: "rejected", diagnosis: `视图 ${request.viewId} 不能插到自己之前，拒绝移动`};
        }
        if (!placementsOfContainer(reading, request.targetContainerId).some((placement) => placement.viewId === anchor)) {
            return {kind: "rejected", diagnosis: `锚点 ${anchor} 不在目标容器 ${request.targetContainerId} 里，拒绝移动`};
        }
    }
    if (split === undefined && current.containerId === request.targetContainerId) {
        const others = placementsOfContainer(reading, request.targetContainerId)
            .filter((placement) => placement.viewId !== request.viewId);
        const at = anchor === undefined ? others.length : others.findIndex((placement) => placement.viewId === anchor);
        const rank = placementsOfContainer(reading, request.targetContainerId)
            .findIndex((placement) => placement.viewId === request.viewId);
        if (rank === at) {
            return {
                kind: "noop",
                diagnosis: `视图 ${request.viewId} 已经在 ${request.targetContainerId} 的这个位置，不产生变更`,
            };
        }
    }
    if (split !== undefined) {
        return {kind: "move", viewId: request.viewId, targetContainerId: request.targetContainerId, split};
    }
    return anchor === undefined
        ? {kind: "move", viewId: request.viewId, targetContainerId: request.targetContainerId}
        : {kind: "move", viewId: request.viewId, targetContainerId: request.targetContainerId, beforeViewId: anchor};
}

/**
 * 容器移动意图的命令边界：与 View 同一套判据，只是"落位"是位置字面量、锚点是容器。
 *
 * 容器整体移动**不**递归搬动它的视图：归属、顺序、高度与实例都由容器自己的落位表达。
 */
export function resolveContainerMove(input: {
    readonly catalog: PlacementCatalog;
    readonly reading: ContainerPlacementReading;
    readonly request: ContainerMoveRequest;
}): ContainerMoveDecision {
    const {catalog, reading, request} = input;
    const defaults = catalog.containerDefaults[request.containerId];
    if (defaults === undefined) {
        return {kind: "rejected", diagnosis: `未登记的容器 ${request.containerId}，拒绝移动`};
    }
    if (!defaults.movable) {
        return {kind: "rejected", diagnosis: `容器 ${request.containerId} 声明不可移动`};
    }
    if (toolPartOfLocation(request.targetLocation) === null) {
        return {kind: "rejected", diagnosis: `目标位置 ${request.targetLocation} 不可落位，拒绝移动`};
    }
    const current = reading.placements.find((placement) => placement.containerId === request.containerId);
    if (current === undefined) {
        return {kind: "rejected", diagnosis: `容器 ${request.containerId} 没有生效落位，拒绝移动`};
    }
    if (current.location !== request.sourceLocation) {
        return {
            kind: "rejected",
            diagnosis: `来源位置 ${request.sourceLocation} 与容器 ${request.containerId} 的当前位置 ${current.location} 不一致，拒绝移动`,
        };
    }
    const anchor = request.beforeContainerId;
    if (anchor !== undefined) {
        if (anchor === request.containerId) {
            return {kind: "rejected", diagnosis: `容器 ${request.containerId} 不能插到自己之前，拒绝移动`};
        }
        if (!containersAtLocation(reading, request.targetLocation).some((placement) => placement.containerId === anchor)) {
            return {kind: "rejected", diagnosis: `锚点容器 ${anchor} 不在目标位置 ${request.targetLocation} 里，拒绝移动`};
        }
    }
    if (current.location === request.targetLocation) {
        const others = containersAtLocation(reading, request.targetLocation)
            .filter((placement) => placement.containerId !== request.containerId);
        const at = anchor === undefined ? others.length : others.findIndex((placement) => placement.containerId === anchor);
        const rank = containersAtLocation(reading, request.targetLocation)
            .findIndex((placement) => placement.containerId === request.containerId);
        if (rank === at) {
            return {
                kind: "noop",
                diagnosis: `容器 ${request.containerId} 已经在 ${request.targetLocation} 的这个位置，不产生变更`,
            };
        }
    }
    return anchor === undefined
        ? {kind: "move", containerId: request.containerId, targetLocation: request.targetLocation}
        : {kind: "move", containerId: request.containerId, targetLocation: request.targetLocation, beforeContainerId: anchor};
}

// ── 整组并入（源容器消失） ───────────────────────────────────────────────────

/**
 * 一次整组并入请求：把源容器的**全部已登记生效成员**按冻结顺序并进目标容器。
 *
 * `sourceViewIds` 是开始拖动/选择合并命令时源容器的完整成员快照（含 hidden 与 collapsed），
 * **不是**正在渲染的那部分：提交时核对工作面与两端落位，纯合成/CAS 重放再核对完整成员与顺序。
 */
export type ContainerMergeRequest = Readonly<{
    readonly sourceContainerId: string;
    readonly sourceLocation: ToolPartLocation;
    readonly targetContainerId: string;
    readonly targetLocation: ToolPartLocation;
    readonly sourceViewIds: readonly string[];
    /** 插到这个目标成员之前；缺省追加到目标成员末尾。带 `split` 时插入点由命中叶与 `side` 求得。 */
    readonly beforeViewId?: string;
    /** 边缘落点：同一次合成里连半区尺寸一起落账（命中叶取一半，整组按来源比例分另一半）。 */
    readonly split?: ViewSplitPlacement;
    /** 发起时的工作面代际：与 `set-view-sizes` 同一口径，跨工作面到达的请求整组拒绝。 */
    readonly contextKey: string;
}>;

export type ContainerMergeDecision =
    | {
        readonly kind: "merge";
        readonly sourceContainerId: string;
        readonly targetContainerId: string;
        readonly sourceViewIds: readonly string[];
        readonly beforeViewId?: string;
        readonly split?: ViewSplitPlacement;
    }
    | {readonly kind: "noop"; readonly diagnosis: string}
    | {readonly kind: "rejected"; readonly diagnosis: string};

/** 源容器整组是否可搬：容器可移动 + 每个成员可移动；返回阻止成员（空数组表示放行）。 */
function mergeBlockers(
    catalog: PlacementCatalog,
    sourceContainerId: string,
    sourceViewIds: readonly string[],
): readonly string[] {
    if (catalog.containerDefaults[sourceContainerId]?.movable === false) {
        return [sourceContainerId];
    }
    return sourceViewIds.filter((viewId) => catalog.views[viewId]?.movable === false);
}

/**
 * 整组并入的命令边界：源与目标都要已登记、可落位、未被抑制，源成员快照要与当前成员一致。
 *
 * 与 View 移动同一套判据，但三条不同：
 * - **目标是否可移动不限制它接收 View**（合并只改源侧的归属与抑制）；
 * - 成员快照覆盖**全部已登记生效成员**，不是"可见的那部分"；
 * - 锚点必须是**目标可见成员**：锚点已经消失或不再可见时整组拒绝，不降级成追加。
 *
 * 任一不成立都拒绝且**不改变当前状态**；同源同目标、空源都是无操作。
 */
export function resolveContainerMerge(input: {
    readonly catalog: PlacementCatalog;
    readonly containers: ContainerPlacementReading;
    readonly views: ViewPlacementReading;
    readonly suppressed: Readonly<Record<string, true>>;
    readonly request: ContainerMergeRequest;
    readonly currentContextKey: string;
    readonly visibleViewIds: readonly string[];
}): ContainerMergeDecision {
    const {catalog, request} = input;
    if (request.contextKey !== input.currentContextKey) {
        return {kind: "rejected", diagnosis: "工作面已经切换，这次整组并入没有落账"};
    }
    if (catalog.containerDefaults[request.sourceContainerId] === undefined) {
        return {kind: "rejected", diagnosis: `源容器 ${request.sourceContainerId} 未登记，拒绝整组并入`};
    }
    if (!catalog.containers.includes(request.targetContainerId)) {
        return {kind: "rejected", diagnosis: `目标容器 ${request.targetContainerId} 未登记或不可落位，拒绝整组并入`};
    }
    if (request.sourceContainerId === request.targetContainerId) {
        return {kind: "noop", diagnosis: "源容器与目标容器是同一个，不产生变更"};
    }
    if (input.suppressed[request.sourceContainerId] === true) {
        return {kind: "rejected", diagnosis: `源容器 ${request.sourceContainerId} 已经被合并掉，不能再次并入`};
    }
    if (input.suppressed[request.targetContainerId] === true) {
        return {kind: "rejected", diagnosis: `目标容器 ${request.targetContainerId} 已经被合并掉，不能接收视图`};
    }
    const source = input.containers.placements.find((entry) => entry.containerId === request.sourceContainerId);
    if (source === undefined || source.location !== request.sourceLocation) {
        return {
            kind: "rejected",
            diagnosis: `来源位置 ${request.sourceLocation} 与容器 ${request.sourceContainerId} 的当前位置不一致，拒绝整组并入`,
        };
    }
    const target = input.containers.placements.find((entry) => entry.containerId === request.targetContainerId);
    if (target === undefined || target.location !== request.targetLocation) {
        return {
            kind: "rejected",
            diagnosis: `目标位置 ${request.targetLocation} 与容器 ${request.targetContainerId} 的当前位置不一致，拒绝整组并入`,
        };
    }
    const members = membersOfContainer(input.views, request.sourceContainerId).map((member) => member.id);
    if (!sameIdSequence(members, request.sourceViewIds)) {
        return {
            kind: "rejected",
            diagnosis: `容器 ${request.sourceContainerId} 的成员已经变化（本次意图基于 ${request.sourceViewIds.length} 个视图），拒绝整组并入`,
        };
    }
    if (members.length === 0) {
        return {kind: "noop", diagnosis: `容器 ${request.sourceContainerId} 已经没有成员，不产生变更`};
    }
    const blockers = mergeBlockers(catalog, request.sourceContainerId, members);
    if (blockers.length > 0) {
        return {
            kind: "rejected",
            diagnosis: `容器 ${request.sourceContainerId} 的整组并入被 ${blockers.join("、")} 声明为不可移动，拒绝执行`,
        };
    }
    const split = request.split;
    const anchor = split === undefined ? request.beforeViewId : undefined;
    if (anchor !== undefined) {
        const inTarget = placementsOfContainer(input.views, request.targetContainerId)
            .some((placement) => placement.viewId === anchor);
        if (!inTarget) {
            return {kind: "rejected", diagnosis: `锚点视图 ${anchor} 不在目标容器 ${request.targetContainerId} 里，拒绝整组并入`};
        }
        if (!input.visibleViewIds.includes(anchor)) {
            return {kind: "rejected", diagnosis: `锚点视图 ${anchor} 在当前上下文里不可见，拒绝整组并入`};
        }
    }
    if (split !== undefined) {
        return {
            kind: "merge",
            sourceContainerId: request.sourceContainerId,
            targetContainerId: request.targetContainerId,
            sourceViewIds: members,
            split,
        };
    }
    return anchor === undefined
        ? {kind: "merge", sourceContainerId: request.sourceContainerId, targetContainerId: request.targetContainerId, sourceViewIds: members}
        : {
            kind: "merge",
            sourceContainerId: request.sourceContainerId,
            targetContainerId: request.targetContainerId,
            sourceViewIds: members,
            beforeViewId: anchor,
        };
}

/** 两个 id 序列是否逐一相同（顺序是权威：成员换序也算"已经变化"）。 */
function sameIdSequence(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * 冻结成员是否已经**完整**落在目标序列里：逐一出现且保持相对顺序；给了锚点时它必须还在整组之后。
 *
 * 不要求相邻——落账之后用户仍可能往组中间插 View，那不是"没达成"。
 */
function mergeLanded(targetIds: readonly string[], frozen: readonly string[], beforeViewId: string | undefined): boolean {
    let last = -1;
    for (const viewId of frozen) {
        const at = targetIds.indexOf(viewId, last + 1);
        if (at < 0) {
            return false;
        }
        last = at;
    }
    if (beforeViewId === undefined) {
        return true;
    }
    const anchor = targetIds.indexOf(beforeViewId);
    return anchor > last;
}

// ── 边缘并入的半区分配 ───────────────────────────────────────────────────────

/** 半区分配的合成结果：逐视图的尺寸意图（键是 viewId），或整条拒绝的诊断。 */
type SplitSizesResult =
    | {readonly ok: true; readonly sizes: Readonly<Record<string, number>>}
    | {readonly ok: false; readonly diagnosis: string};

/**
 * 一次**跨容器**边缘并入的尺寸意图：命中叶取一半，拖入的可见成员按来源份额分另一半。
 *
 * 目标容器的其余可见叶保持快照尺寸，命中叶取 `S/2`，拖入的可见成员分另外的 `S/2`
 * ——`S/2 × rᵢ / Σr`（`r` 是 `sourceSizes`；跨轴并入时它只当相对比例，不把来源轴的像素写进目标轴）。
 * 同一容器的移动不调用本函数：它只换序，不重算尺寸。隐藏成员不出现在任何一张表里，因此不产生尺寸写入。
 *
 * 校验任何一项不过都返回失败，调用方**整条不写**（连归属移动一起丢弃）：轴必须与目标容器一致、
 * 命中叶必须是目标容器成员且不是被拖进来的那个、两张表的键必须各属于对应容器、所有尺寸必须正有限。
 */
function resolveSplitSizes(input: {
    readonly split: ViewSplitPlacement;
    readonly axis: "width" | "height";
    readonly targetViews: readonly string[];
    readonly sourceViews: readonly string[];
    readonly incomingViewIds: readonly string[];
}): SplitSizesResult {
    const {split} = input;
    if (split.side !== "before" && split.side !== "after") {
        return {ok: false, diagnosis: "半区分配方向不是 before 或 after"};
    }
    if (split.axis !== input.axis) {
        return {ok: false, diagnosis: `半区分配的轴 ${split.axis} 与目标容器的轴 ${input.axis} 不符`};
    }
    const invalid = [...Object.entries(split.targetSizes), ...Object.entries(split.sourceSizes)]
        .find(([, size]) => !isWorkbenchViewSize(size));
    if (invalid !== undefined) {
        return {ok: false, diagnosis: `半区分配的尺寸 ${invalid[0]} = ${String(invalid[1])} 不是正有限数`};
    }
    const hitSize = split.targetSizes[split.targetViewId];
    if (hitSize === undefined || !input.targetViews.includes(split.targetViewId)) {
        return {ok: false, diagnosis: `命中叶 ${split.targetViewId} 不是目标容器的几何快照成员`};
    }
    if (input.incomingViewIds.includes(split.targetViewId)) {
        return {ok: false, diagnosis: `命中叶 ${split.targetViewId} 就是本次拖进来的视图本身`};
    }
    const stranger = Object.keys(split.targetSizes).find((viewId) => !input.targetViews.includes(viewId))
        ?? Object.keys(split.sourceSizes).find((viewId) => !input.sourceViews.includes(viewId));
    if (stranger !== undefined) {
        return {ok: false, diagnosis: `半区分配的尺寸表里有不属于目标/来源容器的视图 ${stranger}`};
    }
    const shareOf = (viewId: string): number | undefined => split.sourceSizes[viewId];
    const incomingIds = input.incomingViewIds;
    const visible = incomingIds.filter((viewId) => shareOf(viewId) !== undefined);
    if (visible.length === 0) {
        // 拖进来的成员一个都没有当前几何（全都隐藏）：只改归属，不凭空占几何，也不切开命中叶
        // ——切开却没人接另一半就不是"总量守恒"的分屏了。
        return {ok: true, sizes: {}};
    }
    const sizes: Record<string, number> = {};
    for (const [viewId, size] of Object.entries(split.targetSizes)) {
        sizes[viewId] = viewId === split.targetViewId ? size / 2 : size;
    }
    const half = sizes[split.targetViewId] ?? 0;
    const shareTotal = visible.reduce((sum, viewId) => sum + (shareOf(viewId) ?? 0), 0);
    for (const viewId of visible) {
        sizes[viewId] = half * (shareOf(viewId) ?? 0) / shareTotal;
    }
    const outOfRange = Object.entries(sizes).find(([, size]) => !isWorkbenchViewSize(size));
    if (outOfRange !== undefined) {
        return {ok: false, diagnosis: `半区分配算出的尺寸 ${outOfRange[0]} = ${String(outOfRange[1])} 不是正有限数`};
    }
    return {ok: true, sizes};
}

// ── 补丁 ─────────────────────────────────────────────────────────────────────

/** 把某个视图放到目标容器（可选插在某个成员之前）。来源与锚点保留到合成时重放。 */
export type ViewMoveIntent = {
    readonly kind: "move-view";
    readonly viewId: string;
    readonly sourceContainerId: string;
    readonly targetContainerId: string;
    readonly beforeViewId?: string;
    /** 边缘并入的半区分配：与归属移动同一次合成落账；缺省是纯归属移动（菜单 / Switcher 插入位）。 */
    readonly split?: ViewSplitPlacement;
};

/**
 * 把一个 View 搬进**新开的自建容器**（拖出到空内容区 / Switcher 插入位）。
 *
 * `containerId` 是稳定唯一 id，由会话边界生成一次：CAS 冲突重读重放时还是同一个 id，因此重放要么
 * 认出"已经搬进去了"（幂等），要么按来源重放一次，绝不凭空再造第二个容器。resolver 不生成随机 id。
 */
export type ViewDetachIntent = {
    readonly kind: "detach-view";
    readonly viewId: string;
    readonly sourceContainerId: string;
    readonly targetLocation: ToolPartLocation;
    readonly beforeContainerId?: string;
    readonly containerId: string;
};

/** 把某个容器整体移到目标落位（可选插在某个容器之前）。 */
export type ContainerMoveIntent = {
    readonly kind: "move-container";
    readonly containerId: string;
    readonly sourceLocation: string;
    readonly targetLocation: ToolPartLocation;
    readonly beforeContainerId?: string;
};

/** 删除某个视图的位置覆盖（"恢复默认位置"）：只删这一个，不动其它视图的记录。 */
export type ViewRestoreIntent = {
    readonly kind: "restore-view-placement";
    readonly viewId: string;
};

/** 删除某个容器的落位覆盖（"恢复默认落位"）：只删这一个，同次清掉它的抑制标记。 */
export type ContainerRestoreIntent = {
    readonly kind: "restore-container-placement";
    readonly containerId: string;
};

/**
 * 把源容器的全部成员并进目标容器，随后源容器消失（写抑制标记）。
 *
 * 意图里保存**发起时的成员快照**与两端落位：重放时先看"完整目标已达成"（幂等），再看来源是否还是那个形状。
 */
export type MergeContainerIntent = {
    readonly kind: "merge-container";
    readonly sourceContainerId: string;
    readonly sourceLocation: ToolPartLocation;
    readonly targetContainerId: string;
    readonly targetLocation: ToolPartLocation;
    readonly sourceViewIds: readonly string[];
    readonly beforeViewId?: string;
    /** 边缘并入的半区分配：整组的归属、顺序与尺寸一次落账（隐藏成员只改归属）。 */
    readonly split?: ViewSplitPlacement;
};

/**
 * 重新打开一个被合并掉的容器：只清抑制标记，不把已经并走的 View 拉回来。
 *
 * 实际成员数为 0 的容器没有导航入口，因此这里不再"选中并打开一个空容器"（旧语义会留下一个没有
 * 内容的 Tab）；有成员时照旧选中并把它的落位打开。成员回来时容器自动重新可见。
 */
export type ReopenContainerIntent = {
    readonly kind: "reopen-container";
    readonly containerId: string;
};

/** 选择某个 Part 的活动容器，并显式打开该 Part（清显式隐藏与拖收起）。 */
export type ContainerSelectIntent = {
    readonly kind: "select-container";
    readonly partId: ToolPartId;
    readonly containerId: string;
};

/** 一个 View 的尺寸意图：只带本次真正改变的字段，两轴各自独立。 */
export type ViewSizePatch = {
    readonly viewId: string;
    /** 展开宽度意图（正有限，CSS px）；左右排的容器用它。 */
    readonly width?: number;
    /** 展开高度意图（正有限，CSS px）；上下排的容器用它。 */
    readonly height?: number;
    /** 内容收起（保留 Section 标题头）。 */
    readonly collapsed?: boolean;
};

/**
 * 一场手势里所有直接改变 View 的尺寸意图：同一次合成、整批接纳或整批拒绝。
 *
 * - `sourceLocation` 是**发起手势时**容器的生效落位：容器换 Part（= 换轴）或换位置后到达的批整批
 *   拒绝，不把上下排记下的高度写进左右排的宽度；
 * - 成员集合在合成时按**最新底本**重算：某个 View 已经不在这个容器里，整批不写（不保存一半）。
 */
export type ViewSizesIntent = {
    readonly kind: "set-view-sizes";
    readonly containerId: string;
    readonly sourceLocation: ToolPartLocation;
    /**
     * 发起手势时的工作面代际：排队执行、CAS 重放与显式重试前都要复核它，
     * 已经切走的批次**终态拒绝**，不沿新工作面重放（上下排记下的高度不该写进另一张工作面的记录）。
     */
    readonly contextKey: string;
    readonly patches: readonly ViewSizePatch[];
};

/**
 * 某个 Part 的显隐偏好：`hidden` 是**显式**隐藏（零占用、无边界，只有 left/right）；
 * `dragCollapsed` 是拖到零收起（保留 1px 恢复边界，left/right/panel 都可以）。
 */
export type PartVisibilityIntent = {
    readonly kind: "set-part-visibility";
    readonly partId: ToolPartId;
    readonly hidden?: boolean;
    readonly dragCollapsed?: boolean;
};

/** 显式揭示某个视图：选中它生效的容器、打开目标 Part、清掉 View 与 Panel 的内容收起。 */
export type RevealViewIntent = {
    readonly kind: "reveal-view";
    readonly viewId: string;
};

/**
 * 面板的位置 / 对齐 / 显隐 / 收起的**显式**偏好（UI 字段名，与 `WorkbenchPanelState` 同名）。
 *
 * 只带本次真正改变的字段：缺省字段保持当前生效值，缺字段的记录值（产品默认）不因一次无关动作
 * 被补写进记录。收起只对水平位置有意义，命令边界负责不适用时拒绝；切到侧向位置时同一次补丁
 * 会把收起清掉（见合成）。
 */
export type PanelStateIntent = {
    readonly kind: "set-panel-state";
    readonly position?: ShellPanelPosition;
    readonly alignment?: ShellPanelAlignment;
    readonly hidden?: boolean;
    readonly collapsed?: boolean;
};

/**
 * 一条位置记录补丁。补丁是**可重放**的：冲突重读后按最新底本重新合成一遍，
 * 因此补丁里不携带算好的 order（那个序号属于某一次底本），来源与锚点则必须保留到那时。
 */
export type ViewPlacementsPatch =
    | ViewMoveIntent
    | ViewDetachIntent
    | ContainerMoveIntent
    | ContainerSelectIntent
    | ViewRestoreIntent
    | ContainerRestoreIntent
    | MergeContainerIntent
    | ReopenContainerIntent
    | ViewSizesIntent
    | PartVisibilityIntent
    | RevealViewIntent
    | PanelStateIntent;

// ── 合成 ─────────────────────────────────────────────────────────────────────

/**
 * 一次实际重放的产物：记录意图 + **该次重放真正被跳过的那几条**的诊断。
 *
 * 冲突不再由"保存后拿新底本又演一遍历史"推断（那种二次求值只看每条意图的净结果，会漏掉跨字段与
 * 整组合并的冲突）；它就是本次合成的产物本身。
 */
export type ViewPlacementsComposition = LayoutRecordIntent<WorkbenchViewCustomizationsRecord> & {
    readonly conflicts: readonly string[];
};

/**
 * 把补丁列表合成到**已确认记录**上。
 *
 * 补丁按顺序重放：同一条移动重放时，先按最新底本重算生效落位，再决定是"已经达到目标（幂等，
 * 不重算序号）"、"来源未变（按本次底本插入）"还是"第三方已经把它挪到别处（冲突，跳过并报诊断，
 * 不盲覆本地较早的位置）"。没有已确认记录时按空覆盖合成，只写出本次主动的字段。
 */
export function composeViewPlacements(
    catalog: PlacementCatalog,
    base: WorkbenchViewCustomizationsRecord | null,
    patches: readonly ViewPlacementsPatch[],
): ViewPlacementsComposition {
    return composeDetailed(catalog, base, patches);
}

function composeDetailed(
    catalog: PlacementCatalog,
    base: WorkbenchViewCustomizationsRecord | null,
    patches: readonly ViewPlacementsPatch[],
): ViewPlacementsComposition {
    const source = base ?? WORKBENCH_VIEW_CUSTOMIZATIONS_DEFAULT;
    let placements: Record<string, WorkbenchViewPlacementRecord> = {...source.placements};
    let containerPlacements: Record<string, ContainerPlacementRecord> = {...source.containerPlacements};
    let activeContainerByPart: Record<string, string> = {...source.activeContainerByPart};
    let viewSizes: Record<string, ViewSizeRecord> = {...source.viewSizes};
    let dragCollapsedParts: Record<string, boolean> = {...source.dragCollapsedParts};
    let hiddenSidebars: Record<string, boolean> = {...source.hiddenSidebars};
    let suppressedContainers: Record<string, boolean> = {...source.suppressedContainers};
    let customContainers: Record<string, CustomViewContainerRecord> = {...source.customContainers};
    /** 本次合成要写的 panel 字段（只含有效值真正改变的字段，缺省的默认值不补写）。 */
    let panelWrites: Record<string, unknown> = {};
    let panelState: WorkbenchPanelPreferences = resolvePanelPreferences({
        position: source.panelPosition,
        alignment: source.panelAlignment,
        hidden: source.panelHidden,
        collapsed: source.panelCollapsed,
    });
    let changed = false;
    const conflicts: string[] = [];
    /** 本次合成可能被搬空的来源容器：只有**真的**归零才收口，仍有成员（含隐藏）的容器一律保留。 */
    const emptiedContainers = new Set<string>();

    /**
     * 候选表上的目录：本次合成刚写下的自建容器也在里面。
     *
     * 合成必须按**自己的中间状态**求值——同一条补丁序列里先建的自建容器，后面的补丁要能指向它；
     * 而调用方给的是静态目录（注册表事实），自建容器只活在这条记录里。没有自建容器时它就是原对象。
     */
    function candidateCatalog(): PlacementCatalog {
        return placementCatalogWithContainers(catalog, customContainers);
    }

    /** 移动、选择与揭示共用的 Panel 字段合成：只写真正改变的字段，侧向位置清掉收起。 */
    function applyPanel(patch: Omit<PanelStateIntent, "kind">): void {
        const before = panelState;
        let next: WorkbenchPanelPreferences = {
            position: patch.position ?? before.position,
            alignment: patch.alignment ?? before.alignment,
            hidden: patch.hidden ?? before.hidden,
            collapsed: patch.collapsed ?? before.collapsed,
        };
        if (patch.position !== undefined && !isHorizontalPanelPosition(next.position)) {
            // 收起只对水平位置有意义：切到侧向位置时同一次补丁清掉它（不留一个"侧向还收着"的记录）。
            next = {...next, collapsed: false};
        }
        const writes = [
            {key: "panelPosition", changedField: before.position !== next.position, value: next.position},
            {key: "panelAlignment", changedField: before.alignment !== next.alignment, value: next.alignment},
            {key: "panelHidden", changedField: before.hidden !== next.hidden, value: next.hidden},
            {key: "panelCollapsed", changedField: before.collapsed !== next.collapsed, value: next.collapsed},
        ];
        for (const write of writes) {
            if (!write.changedField) {
                continue;
            }
            panelWrites = {...panelWrites, [write.key]: write.value};
            changed = true;
        }
        panelState = next;
    }

    /** 打开一个 Part：清掉它的显式隐藏（Panel 的隐藏归 panel 字段）与拖收起。 */
    function openPart(partId: ToolPartId): void {
        if (partId === "panel") {
            if (panelState.hidden) {
                applyPanel({hidden: false});
            }
        } else if (hiddenSidebars[partId] === true) {
            hiddenSidebars = {...hiddenSidebars, [partId]: false};
            changed = true;
        }
        if (dragCollapsedParts[partId] === true) {
            dragCollapsedParts = {...dragCollapsedParts, [partId]: false};
            changed = true;
        }
    }

    function selectContainer(partId: ToolPartId, containerId: string): void {
        if (activeContainerByPart[partId] !== containerId) {
            activeContainerByPart = {...activeContainerByPart, [partId]: containerId};
            changed = true;
        }
        openPart(partId);
    }

    /** 把视图/容器送进 Panel 时同时清掉 Panel 的 32px 标题头收起（否则内容还停在收起态）。 */
    function openPanelFor(partId: ToolPartId): void {
        if (partId === "panel" && panelState.collapsed) {
            applyPanel({collapsed: false});
        }
    }

    /** 容器移动、选择与揭示共用的落点求值：容器不可落位时不写任何字段。 */
    function partOfContainer(containerId: string): ToolPartId | null {
        const placement = readContainerPlacements(candidateCatalog(), containerPlacements).placements
            .find((entry) => entry.containerId === containerId);
        return placement === undefined ? null : toolPartOfLocation(placement.location);
    }

    /** 候选表上的视图生效位置：合成里每一处判断都读它，不读静态目录上的那一份。 */
    function viewReading(): ViewPlacementReading {
        return readViewPlacements(candidateCatalog(), placements);
    }

    /** 合成中间态的生效抑制：重放里"目标是否已经被合并掉"必须看**候选表**，不是记录原文。 */
    function suppressedNow(): Readonly<Record<string, true>> {
        return suppressedContainerIds(candidateCatalog(), {placements, suppressedContainers});
    }

    /** 候选表上的生效容器落位：被合并掉的容器不在里面（锚点与序号都按它求值）。 */
    function effectiveContainerReading(): ContainerPlacementReading {
        return readEffectiveContainerPlacements(candidateCatalog(), {placements, containerPlacements, suppressedContainers});
    }

    /** 清掉一个容器的抑制标记（只清这一个）；`false` 不落盘，清抑制靠删键。 */
    function clearSuppression(containerId: string): void {
        if (suppressedContainers[containerId] !== true) {
            return;
        }
        const next = {...suppressedContainers};
        delete next[containerId];
        suppressedContainers = next;
        changed = true;
    }

    /** 一个 Part 的活动容器：值相同不写，`undefined` 表示删掉这个选择键（不隐藏 Part）。 */
    function setActiveContainer(partId: ToolPartId, containerId: string | undefined): void {
        if (activeContainerByPart[partId] === containerId) {
            return;
        }
        if (containerId === undefined) {
            const next = {...activeContainerByPart};
            delete next[partId];
            activeContainerByPart = next;
        } else {
            activeContainerByPart = {...activeContainerByPart, [partId]: containerId};
        }
        changed = true;
    }

    /** 容器在**候选表**上的落位（含本次合成刚写下的落位覆盖）：源 Part 选择回退与锚点核对用它。 */
    function locationOf(containerId: string): string | undefined {
        return readContainerPlacements(candidateCatalog(), containerPlacements).placements
            .find((entry) => entry.containerId === containerId)?.location;
    }

    /** 半区分配的尺寸写入：逐视图只改当前轴，另一轴与 `collapsed`、未知字段原样保留。 */
    function applyViewSizes(sizes: Readonly<Record<string, number>>, axis: "width" | "height"): void {
        for (const [viewId, size] of Object.entries(sizes)) {
            const next: ViewSizeRecord = {...viewSizes[viewId], [axis]: size};
            if (sameRecordValues(viewSizes[viewId], next)) {
                continue;
            }
            viewSizes = {...viewSizes, [viewId]: next};
            changed = true;
        }
    }

    /**
     * 自建容器在**成员归零**后的收口：连同它的落位覆盖、抑制标记与 Part 活动选择一起删掉。
     *
     * 只收口本次合成真正搬空的那几个容器：仍有成员（含 hidden / collapsed）的一律保留，静态容器
     * 不在这里处理——它没有可删的定义，实际没有成员时由呈现层过滤，注册定义与落位原件永远保留。
     */
    function retireEmptiedCustomContainers(): void {
        if (emptiedContainers.size === 0 || Object.keys(customContainers).length === 0) {
            return;
        }
        const occupied: Record<string, true> = {};
        for (const placement of viewReading().placements) {
            occupied[placement.containerId] = true;
        }
        for (const containerId of emptiedContainers) {
            if (customContainers[containerId] === undefined || occupied[containerId] === true) {
                continue;
            }
            const rest = {...customContainers};
            delete rest[containerId];
            customContainers = rest;
            changed = true;
            if (containerPlacements[containerId] !== undefined) {
                const withoutPlacement = {...containerPlacements};
                delete withoutPlacement[containerId];
                containerPlacements = withoutPlacement;
            }
            clearSuppression(containerId);
            for (const [partId, chosen] of Object.entries(activeContainerByPart)) {
                if (chosen === containerId) {
                    setActiveContainer(partId as ToolPartId, undefined);
                }
            }
        }
    }

    /**
     * 整组并入的重放，顺序固定为：形状/登记身份 → **完整目标已达成**（幂等）→ 源未抑制且成员快照仍匹配。
     *
     * 顺序不能颠倒：本批上一次成功写下的源抑制正是"已经做完"的证据，先执行会永远落在"源已被抑制"上。
     * 只满足一半（源消失但成员没全到 / 成员到了但源还在）都只报冲突，不挪剩余成员补齐。
     */
    function mergeGroup(patch: MergeContainerIntent): void {
        const effective = candidateCatalog();
        if (effective.containerDefaults[patch.targetContainerId] === undefined
            || !effective.containers.includes(patch.targetContainerId)) {
            conflicts.push(`容器 ${patch.sourceContainerId} → ${patch.targetContainerId} 的整组并入不可执行（容器未登记或目标不可落位）`);
            return;
        }
        const reading = viewReading();
        const suppressed = suppressedNow();
        const targetPart = toolPartOfLocation(patch.targetLocation);
        const targetIds = membersOfContainer(reading, patch.targetContainerId).map((member) => member.id);
        const containers = effectiveContainerReading();
        const target = containers.placements.find((entry) => entry.containerId === patch.targetContainerId);
        if (target === undefined || target.location !== patch.targetLocation || suppressed[patch.targetContainerId] === true) {
            conflicts.push(`目标位置 ${patch.targetLocation} 与容器 ${patch.targetContainerId} 的当前位置不一致，这次整组并入没有落账`);
            return;
        }
        const sourceMissing = effective.containerDefaults[patch.sourceContainerId] === undefined;
        if (sourceMissing || suppressed[patch.sourceContainerId] === true) {
            let complete = patch.sourceViewIds.length > 0
                && membersOfContainer(reading, patch.sourceContainerId).length === 0
                && mergeLanded(targetIds, patch.sourceViewIds, patch.split === undefined ? patch.beforeViewId : undefined);
            if (patch.split !== undefined && targetPart !== null) {
                const split = patch.split;
                const hitAt = targetIds.indexOf(split.targetViewId);
                complete &&= hitAt >= 0 && patch.sourceViewIds.every((viewId) => split.side === "before"
                    ? targetIds.indexOf(viewId) < hitAt : targetIds.indexOf(viewId) > hitAt);
                const sizes = resolveSplitSizes({
                    split, axis: containerAxis(targetPart),
                    targetViews: targetIds, sourceViews: patch.sourceViewIds, incomingViewIds: patch.sourceViewIds,
                });
                complete &&= sizes.ok && Object.entries(sizes.sizes)
                    .every(([viewId, size]) => viewSizes[viewId]?.[split.axis] === size);
            }
            if (!complete) {
                conflicts.push(`容器 ${patch.sourceContainerId} 已经消失或被合并掉，但目标尚未完整达成：这次整组并入没有落账`);
                return;
            }
            // 自建源收口后不再有登记或抑制记录，完整成员、方向和尺寸共同证明本批已落账。
            if (targetPart !== null) {
                selectContainer(targetPart, patch.targetContainerId);
                openPanelFor(targetPart);
            }
            return;
        }
        const members = membersOfContainer(reading, patch.sourceContainerId).map((member) => member.id);
        if (!sameIdSequence(members, patch.sourceViewIds)) {
            conflicts.push(`容器 ${patch.sourceContainerId} 的成员已经变化（本次意图基于 ${patch.sourceViewIds.length} 个视图），这次整组并入没有落账`);
            return;
        }
        if (members.length === 0) {
            conflicts.push(`容器 ${patch.sourceContainerId} 已经没有成员，这次整组并入没有可移动的视图`);
            return;
        }
        const blockers = mergeBlockers(effective, patch.sourceContainerId, members);
        if (blockers.length > 0) {
            conflicts.push(`容器 ${patch.sourceContainerId} 的整组并入被 ${blockers.join("、")} 声明为不可移动，整组没有落账`);
            return;
        }
        const source = containers.placements.find((entry) => entry.containerId === patch.sourceContainerId);
        if (source === undefined || source.location !== patch.sourceLocation) {
            conflicts.push(`来源位置 ${patch.sourceLocation} 与容器 ${patch.sourceContainerId} 的当前位置不一致，这次整组并入没有落账`);
            return;
        }
        const landed = patch.sourceViewIds.filter((viewId) => targetIds.includes(viewId));
        if (landed.length > 0) {
            conflicts.push(`视图 ${landed.join("、")} 已经在目标容器 ${patch.targetContainerId} 里，而源容器还有成员：这次整组并入没有落账`);
            return;
        }
        // 带 split 时插入点由命中叶与 `side` 求得（整组落在命中叶的前/后侧），锚点字段不参与。
        const split = patch.split;
        let beforeViewId = patch.beforeViewId;
        if (split !== undefined) {
            const hitAt = targetIds.indexOf(split.targetViewId);
            if (hitAt === -1) {
                conflicts.push(`命中叶 ${split.targetViewId} 已经不在目标容器 ${patch.targetContainerId} 里，这次整组并入没有落账`);
                return;
            }
            beforeViewId = split.side === "before" ? split.targetViewId : targetIds[hitAt + 1];
        }
        if (beforeViewId !== undefined && !targetIds.includes(beforeViewId)) {
            conflicts.push(`锚点视图 ${beforeViewId} 已经不在目标容器 ${patch.targetContainerId} 里，这次整组并入没有落账`);
            return;
        }
        // 半区尺寸在动归属之前先算出来：任何一项校验不过就整条不写（不留"搬了成员但没分尺寸"的半状态）。
        let splitSizes: Readonly<Record<string, number>> | null = null;
        if (split !== undefined) {
            if (targetPart === null) {
                conflicts.push(`目标容器 ${patch.targetContainerId} 当前不可落位，这次整组并入没有落账`);
                return;
            }
            const sizes = resolveSplitSizes({
                split,
                axis: containerAxis(targetPart),
                targetViews: targetIds,
                sourceViews: members,
                incomingViewIds: patch.sourceViewIds,
            });
            if (!sizes.ok) {
                conflicts.push(`${sizes.diagnosis}：容器 ${patch.sourceContainerId} 的整组并入没有落账`);
                return;
            }
            splitSizes = sizes.sizes;
        }
        // 先在新底本上把整组的序号全部算出来（含必要重排），再一次性落账：任何一步失败都不留半组成员。
        const planned = membersOfContainer(reading, patch.targetContainerId)
            .map((member) => ({id: member.id, order: member.order}));
        const reranks: Readonly<Record<string, number>>[] = [];
        for (const viewId of patch.sourceViewIds) {
            const at = beforeViewId === undefined
                ? planned.length
                : planned.findIndex((member) => member.id === beforeViewId);
            const plan = resolveInsertion(planned, beforeViewId);
            if (!plan.ok) {
                conflicts.push(`${plan.diagnosis}：容器 ${patch.sourceContainerId} 的整组并入没有落账`);
                return;
            }
            if (Object.keys(plan.rerank).length > 0) {
                reranks.push(plan.rerank);
                for (const member of planned) {
                    const order = plan.rerank[member.id];
                    if (order !== undefined) {
                        member.order = order;
                    }
                }
            }
            // 插进它在序号上真正属于的那一格：下一个成员的插入点要按"排好序的成员序列"求。
            planned.splice(at < 0 ? planned.length : at, 0, {id: viewId, order: plan.order});
        }
        for (const rerank of reranks) {
            // 精度用尽时的重排本身改写了目标集合里的其它成员，必须落账。
            placements = rerankPlacements(effective, placements, rerank, patch.targetContainerId);
            changed = true;
        }
        for (const viewId of patch.sourceViewIds) {
            const defaults = effective.views[viewId];
            const order = planned.find((member) => member.id === viewId)?.order;
            if (defaults === undefined || order === undefined) {
                continue;
            }
            const next: WorkbenchViewPlacementRecord = {
                ...placements[viewId],
                containerId: patch.targetContainerId,
                order,
                defaultContainerId: defaults.containerId,
                defaultOrder: defaults.order,
            };
            if (!sameRecordValues(placements[viewId], next)) {
                placements = {...placements, [viewId]: next};
                changed = true;
            }
        }
        if (splitSizes !== null && split !== undefined) {
            applyViewSizes(splitSizes, split.axis);
        }
        if (suppressedContainers[patch.sourceContainerId] !== true) {
            suppressedContainers = {...suppressedContainers, [patch.sourceContainerId]: true};
            changed = true;
        }
        emptiedContainers.add(patch.sourceContainerId);
        // 源若是**另一个** Part 的当前容器：改选那个 Part 剩余列表的第一项，没有则删掉这个选择键。
        const sourcePart = toolPartOfLocation(source.location);
        if (sourcePart !== null && sourcePart !== targetPart && activeContainerByPart[sourcePart] === patch.sourceContainerId) {
            setActiveContainer(sourcePart, containersOfPart(effectiveContainerReading(), sourcePart)[0]?.containerId);
        }
        if (targetPart !== null) {
            selectContainer(targetPart, patch.targetContainerId);
            openPanelFor(targetPart);
        }
    }

    for (const patch of patches) {
        switch (patch.kind) {
            case "move-view": {
                const effective = candidateCatalog();
                const defaults = effective.views[patch.viewId];
                if (defaults === undefined || !effective.containers.includes(patch.targetContainerId)) {
                    // 命令边界已经拒绝过；重放时声明变了就跳过这一条，不让它污染其它补丁。
                    continue;
                }
                if (suppressedNow()[patch.targetContainerId] === true) {
                    // 目标容器已经被合并掉：过期抑制目标不接收普通移动（重放时也不补救）。
                    conflicts.push(`目标容器 ${patch.targetContainerId} 已经被合并掉，视图 ${patch.viewId} 的移动没有落账`);
                    continue;
                }
                const reading = viewReading();
                const current = reading.placements.find((placement) => placement.viewId === patch.viewId);
                const at = current?.containerId;
                if (at === undefined) {
                    continue;
                }
                if (at !== patch.targetContainerId && at !== patch.sourceContainerId) {
                    // 第三方已经把它搬到别处：不盲覆本地较早的位置，只报诊断。
                    conflicts.push(`视图 ${patch.viewId} 已被移到 ${at}（本次意图基于 ${patch.sourceContainerId}），跳过这次移动`);
                    continue;
                }
                const part = partOfContainer(patch.targetContainerId);
                const others: OrderedMember[] = placementsOfContainer(reading, patch.targetContainerId)
                    .filter((placement) => placement.viewId !== patch.viewId)
                    .map((placement) => ({id: placement.viewId, order: placement.order}));
                // 带 split 时插入点由命中叶与 `side` 求得：命中叶之前，或"命中叶的下一个成员"之前
                // （命中叶是末尾就是追加）；锚点字段不参与。跨容器的半区尺寸也在这里先算出来：
                // 校验不过整条不写。同一容器只换序，尺寸快照不参与计算。
                const split = patch.split;
                const sameContainer = patch.sourceContainerId === patch.targetContainerId;
                let beforeViewId = patch.beforeViewId;
                let splitSizes: Readonly<Record<string, number>> | null = null;
                if (split !== undefined) {
                    const hitAt = others.findIndex((member) => member.id === split.targetViewId);
                    if (hitAt === -1) {
                        conflicts.push(`命中叶 ${split.targetViewId} 已经不在目标容器 ${patch.targetContainerId} 里，跳过这次移动`);
                        continue;
                    }
                    beforeViewId = split.side === "before" ? split.targetViewId : others[hitAt + 1]?.id;
                    if (part === null) {
                        conflicts.push(`目标容器 ${patch.targetContainerId} 当前不可落位，视图 ${patch.viewId} 的移动没有落账`);
                        continue;
                    }
                    const sizes = resolveSplitSizes({
                        split,
                        axis: containerAxis(part),
                        targetViews: placementsOfContainer(reading, patch.targetContainerId)
                            .map((placement) => placement.viewId),
                        sourceViews: placementsOfContainer(reading, at).map((placement) => placement.viewId),
                        incomingViewIds: [patch.viewId],
                    });
                    if (!sizes.ok) {
                        conflicts.push(`${sizes.diagnosis}：视图 ${patch.viewId} 的移动没有落账`);
                        continue;
                    }
                    if (!sameContainer) {
                        splitSizes = sizes.sizes;
                    }
                }
                const atIndex = beforeViewId === undefined
                    ? others.length
                    : others.findIndex((member) => member.id === beforeViewId);
                if (beforeViewId !== undefined && atIndex === -1) {
                    // 锚点已被第三方带走：不按"追加"糊过去，只报诊断。
                    conflicts.push(`锚点视图 ${beforeViewId} 已经不在目标容器 ${patch.targetContainerId} 里，跳过这次移动`);
                    continue;
                }
                if (at === patch.targetContainerId) {
                    const rank = placementsOfContainer(reading, patch.targetContainerId)
                        .findIndex((placement) => placement.viewId === patch.viewId);
                    if (split !== undefined && patch.sourceContainerId !== patch.targetContainerId
                        && (rank !== atIndex || splitSizes === null
                            || Object.entries(splitSizes).some(([viewId, size]) => viewSizes[viewId]?.[split.axis] !== size))) {
                        conflicts.push(`视图 ${patch.viewId} 已被移入目标，但本次半区分配尚未完整达成，拒绝覆盖部分落账`);
                        continue;
                    }
                    if (rank === atIndex) {
                        // 已经在这个位置：序号不重算。半区尺寸是快照算出来的绝对值，因此同一批重放再写一次
                        // 也是同一个值（真的一致就是无变更）；"落点在原位但几何还没分"的第一次落账靠这里补上。
                        if (splitSizes !== null && split !== undefined) {
                            applyViewSizes(splitSizes, split.axis);
                        }
                        if (part !== null) {
                            selectContainer(part, patch.targetContainerId);
                            openPanelFor(part);
                        }
                        continue;
                    }
                }
                const plan = resolveInsertion(others, beforeViewId);
                if (!plan.ok) {
                    conflicts.push(`${plan.diagnosis}：视图 ${patch.viewId} 的移动没有落账`);
                    continue;
                }
                if (Object.keys(plan.rerank).length > 0) {
                    // 精度用尽时的重排本身改写了目标集合里的其它成员，必须落账。
                    placements = rerankPlacements(effective, placements, plan.rerank, patch.targetContainerId);
                    changed = true;
                }
                const next: WorkbenchViewPlacementRecord = {
                    ...placements[patch.viewId],
                    containerId: patch.targetContainerId,
                    order: plan.order,
                    defaultContainerId: defaults.containerId,
                    defaultOrder: defaults.order,
                };
                if (!sameRecordValues(placements[patch.viewId], next)) {
                    placements = {...placements, [patch.viewId]: next};
                    changed = true;
                }
                if (splitSizes !== null && split !== undefined) {
                    applyViewSizes(splitSizes, split.axis);
                }
                emptiedContainers.add(patch.sourceContainerId);
                if (part !== null) {
                    selectContainer(part, patch.targetContainerId);
                    openPanelFor(part);
                }
                break;
            }
            case "detach-view": {
                // 拖出一个 View：在目标落位上新建一个自建容器并把它搬进去。
                const effective = candidateCatalog();
                const defaults = effective.views[patch.viewId];
                const part = toolPartOfLocation(patch.targetLocation);
                if (defaults === undefined || part === null) {
                    // 命令边界已经拒绝过；重放时声明变了就跳过这一条，不让它污染其它补丁。
                    continue;
                }
                if (!defaults.movable) {
                    conflicts.push(`视图 ${patch.viewId} 声明不可移动，这次拖出没有落账`);
                    continue;
                }
                const reading = viewReading();
                const current = reading.placements.find((placement) => placement.viewId === patch.viewId);
                if (current === undefined) {
                    continue;
                }
                if (current.containerId === patch.containerId) {
                    const container = effectiveContainerReading().placements.find((entry) => entry.containerId === patch.containerId);
                    const anchor = patch.beforeContainerId === undefined ? undefined
                        : effectiveContainerReading().placements.find((entry) => entry.containerId === patch.beforeContainerId);
                    if (container?.location !== patch.targetLocation
                        || (patch.beforeContainerId !== undefined
                            && (anchor?.location !== patch.targetLocation || anchor.order <= container.order))) {
                        conflicts.push(`自建容器 ${patch.containerId} 的位置或锚点已变化，跳过这次拖出重放`);
                        continue;
                    }
                    // 已经搬进这个自建容器：幂等成功，同一次意图仍然选中并打开目标 Part。
                    selectContainer(part, patch.containerId);
                    openPanelFor(part);
                    continue;
                }
                if (current.containerId !== patch.sourceContainerId) {
                    // 第三方已经把它搬到别处：不盲覆本地较早的位置，只报诊断。
                    conflicts.push(`视图 ${patch.viewId} 已被移到 ${current.containerId}（本次意图基于 ${patch.sourceContainerId}），跳过这次拖出`);
                    continue;
                }
                if (customContainers[patch.containerId] !== undefined || effective.containerDefaults[patch.containerId] !== undefined) {
                    // id 是会话边界生成一次的：撞上别的容器说明这次意图已经不属于当前底本。
                    conflicts.push(`容器 ${patch.containerId} 已经是别的容器，视图 ${patch.viewId} 的拖出没有落账`);
                    continue;
                }
                // 新容器插在目标落位上的哪个位置：锚点必须已经在那条落位上，否则整条不写（不降级成追加）。
                // 与整容器移动同一口径：锚点与序号按**生效**容器求值（被合并掉的容器不在清单里）。
                const atLocation: OrderedMember[] = containersAtLocation(
                    effectiveContainerReading(),
                    patch.targetLocation,
                ).map((placement) => ({id: placement.containerId, order: placement.order}));
                const atIndex = patch.beforeContainerId === undefined
                    ? atLocation.length
                    : atLocation.findIndex((member) => member.id === patch.beforeContainerId);
                if (patch.beforeContainerId !== undefined && atIndex === -1) {
                    conflicts.push(`锚点容器 ${patch.beforeContainerId} 已经不在 ${patch.targetLocation} 里，视图 ${patch.viewId} 的拖出没有落账`);
                    continue;
                }
                const plan = resolveInsertion(atLocation, patch.beforeContainerId);
                if (!plan.ok) {
                    conflicts.push(`${plan.diagnosis}：视图 ${patch.viewId} 的拖出没有落账`);
                    continue;
                }
                if (Object.keys(plan.rerank).length > 0) {
                    // 精度用尽时的重排本身改写了目标落位上的其它容器，必须落账。
                    containerPlacements = rerankContainers(effective, containerPlacements, plan.rerank, patch.targetLocation);
                    changed = true;
                }
                customContainers = {
                    ...customContainers,
                    [patch.containerId]: {
                        originViewId: patch.viewId,
                        location: patch.targetLocation,
                        order: plan.order,
                    },
                };
                changed = true;
                const next: WorkbenchViewPlacementRecord = {
                    ...placements[patch.viewId],
                    containerId: patch.containerId,
                    order: ORDER_STEP,
                    defaultContainerId: defaults.containerId,
                    defaultOrder: defaults.order,
                };
                if (!sameRecordValues(placements[patch.viewId], next)) {
                    placements = {...placements, [patch.viewId]: next};
                    changed = true;
                }
                emptiedContainers.add(patch.sourceContainerId);
                // 来源 Part 还选着被搬空的那个容器时：自建容器会被收口删掉（选择键也一起清），
                // 静态容器交给呈现层回落，记录里的选择原件保留。
                selectContainer(part, patch.containerId);
                openPanelFor(part);
                break;
            }
            case "move-container": {
                const effective = candidateCatalog();
                const defaults = effective.containerDefaults[patch.containerId];
                if (defaults === undefined || toolPartOfLocation(patch.targetLocation) === null) {
                    continue;
                }
                // 锚点与序号按**生效**容器求值（被合并掉的容器不出现在移动目标清单里）。
                const reading = effectiveContainerReading();
                const current = reading.placements.find((placement) => placement.containerId === patch.containerId);
                if (current === undefined) {
                    if (suppressedNow()[patch.containerId] === true) {
                        conflicts.push(`容器 ${patch.containerId} 已经被合并掉，这次整容器移动没有落账`);
                    }
                    continue;
                }
                if (current.location !== patch.targetLocation && current.location !== patch.sourceLocation) {
                    // 第三方已经把它搬到别处：不盲覆本地较早的位置，只报诊断。
                    conflicts.push(`容器 ${patch.containerId} 已被移到 ${current.location}（本次意图基于 ${patch.sourceLocation}），跳过这次移动`);
                    continue;
                }
                const part = toolPartOfLocation(patch.targetLocation);
                const others: OrderedMember[] = containersAtLocation(reading, patch.targetLocation)
                    .filter((placement) => placement.containerId !== patch.containerId)
                    .map((placement) => ({id: placement.containerId, order: placement.order}));
                const atIndex = patch.beforeContainerId === undefined
                    ? others.length
                    : others.findIndex((member) => member.id === patch.beforeContainerId);
                if (patch.beforeContainerId !== undefined && atIndex === -1) {
                    conflicts.push(`锚点容器 ${patch.beforeContainerId} 已经不在目标位置 ${patch.targetLocation} 里，跳过这次移动`);
                    continue;
                }
                if (current.location === patch.targetLocation) {
                    const rank = containersAtLocation(reading, patch.targetLocation)
                        .findIndex((placement) => placement.containerId === patch.containerId);
                    if (rank === atIndex) {
                        if (part !== null) {
                            selectContainer(part, patch.containerId);
                        }
                        continue;
                    }
                }
                const plan = resolveInsertion(others, patch.beforeContainerId);
                if (!plan.ok) {
                    conflicts.push(`${plan.diagnosis}：容器 ${patch.containerId} 的移动没有落账`);
                    continue;
                }
                if (Object.keys(plan.rerank).length > 0) {
                    // 精度用尽时的重排本身改写了目标位置上的其它容器，必须落账。
                    containerPlacements = rerankContainers(effective, containerPlacements, plan.rerank, patch.targetLocation);
                    changed = true;
                }
                const next: ContainerPlacementRecord = {
                    ...containerPlacements[patch.containerId],
                    location: patch.targetLocation,
                    order: plan.order,
                    defaultLocation: defaults.location,
                    defaultOrder: defaults.order,
                };
                if (!sameRecordValues(containerPlacements[patch.containerId], next)) {
                    containerPlacements = {...containerPlacements, [patch.containerId]: next};
                    changed = true;
                }
                // 来源 Part 仍选着被搬走的容器时，按新落位表回退到剩余容器；没有剩余容器就删除选择键，
                // 让 Part 呈现空态。目标 Part 再选中刚搬来的容器，避免 Teleport 留在无主的旧挂载点。
                const sourcePart = toolPartOfLocation(patch.sourceLocation);
                if (sourcePart !== null && sourcePart !== part && activeContainerByPart[sourcePart] === patch.containerId) {
                    setActiveContainer(sourcePart, containersOfPart(effectiveContainerReading(), sourcePart)[0]?.containerId);
                }
                if (part !== null) {
                    selectContainer(part, patch.containerId);
                    openPanelFor(part);
                }
                break;
            }
            case "select-container": {
                if (!candidateCatalog().containers.includes(patch.containerId)) {
                    continue;
                }
                if (suppressedNow()[patch.containerId] === true) {
                    // 过期抑制目标不接收普通选择（要重新打开它得走 reopen-container）。
                    conflicts.push(`容器 ${patch.containerId} 已经被合并掉，不能选为活动容器`);
                    continue;
                }
                if (partOfContainer(patch.containerId) === patch.partId) {
                    selectContainer(patch.partId, patch.containerId);
                }
                break;
            }
            case "restore-view-placement": {
                // 恢复之前先记住它此刻在哪个容器：这条覆盖删掉后读投影就看不到它了。
                const leftFrom = viewReading().placements
                    .find((placement) => placement.viewId === patch.viewId)?.containerId;
                if (placements[patch.viewId] !== undefined) {
                    const next = {...placements};
                    delete next[patch.viewId];
                    placements = next;
                    changed = true;
                    if (leftFrom !== undefined) {
                        // 视图从自建容器里搬走可能把它搬空：同一次合成收口（仍有成员的一律保留）。
                        emptiedContainers.add(leftFrom);
                    }
                }
                // 视图回到默认位置后可能正好落在被抑制的容器里：同一次清掉抑制，避免它不可达。
                const restored = viewReading().placements
                    .find((placement) => placement.viewId === patch.viewId);
                if (restored !== undefined) {
                    clearSuppression(restored.containerId);
                }
                break;
            }
            case "restore-container-placement": {
                if (containerPlacements[patch.containerId] !== undefined) {
                    const next = {...containerPlacements};
                    delete next[patch.containerId];
                    containerPlacements = next;
                    changed = true;
                }
                // "恢复默认落位"与"重新打开"是两件事：它同时清抑制，让容器以默认落位重新出现。
                clearSuppression(patch.containerId);
                break;
            }
            case "merge-container": {
                mergeGroup(patch);
                break;
            }
            case "reopen-container": {
                if (candidateCatalog().containerDefaults[patch.containerId] === undefined) {
                    continue;
                }
                // 只清抑制：不把已经并走的 View 拉回来，也不改它们的归属。
                clearSuppression(patch.containerId);
                // 实际没有成员的容器不进导航：重新打开它不该把 Part 指到一个没有入口的空容器上
                // （旧语义会"打开一个空 Tab"，那正是这次要清掉的行为）；成员回来时它自动可见。
                if (membersOfContainer(viewReading(), patch.containerId).length === 0) {
                    break;
                }
                const location = locationOf(patch.containerId);
                const part = location === undefined ? null : toolPartOfLocation(location);
                if (part !== null) {
                    selectContainer(part, patch.containerId);
                    openPanelFor(part);
                }
                break;
            }
            case "set-view-sizes": {
                const sizes = resolveViewSizes(candidateCatalog(), placements, viewSizes, containerPlacements, patch);
                if (!sizes.ok) {
                    conflicts.push(sizes.diagnosis);
                    continue;
                }
                for (const [viewId, record] of Object.entries(sizes.sizes)) {
                    if (sameRecordValues(viewSizes[viewId], record)) {
                        continue;
                    }
                    viewSizes = {...viewSizes, [viewId]: record};
                    changed = true;
                }
                break;
            }
            case "set-part-visibility": {
                if (!isToolPartId(patch.partId)) {
                    continue;
                }
                if (patch.hidden !== undefined) {
                    if (patch.partId === "panel") {
                        // 命令边界已经拒绝；重放时也**不**把 panel 的隐藏写进侧栏字段。
                        conflicts.push("Panel 的显隐归 set-panel-state 意图，hiddenSidebars 只记 left/right");
                    } else if (hiddenSidebars[patch.partId] !== patch.hidden) {
                        hiddenSidebars = {...hiddenSidebars, [patch.partId]: patch.hidden};
                        changed = true;
                    }
                }
                if (patch.dragCollapsed !== undefined && dragCollapsedParts[patch.partId] !== patch.dragCollapsed) {
                    dragCollapsedParts = {...dragCollapsedParts, [patch.partId]: patch.dragCollapsed};
                    changed = true;
                }
                break;
            }
            case "reveal-view": {
                const reading = viewReading();
                const current = reading.placements.find((placement) => placement.viewId === patch.viewId);
                if (current === undefined) {
                    continue;
                }
                const part = partOfContainer(current.containerId);
                if (part === null) {
                    conflicts.push(`视图 ${patch.viewId} 的容器 ${current.containerId} 当前不可落位，无法揭示`);
                    continue;
                }
                // 明确指向这个容器的意图同时清它的抑制：否则合并过的容器在被揭示时仍然不可达。
                clearSuppression(current.containerId);
                selectContainer(part, current.containerId);
                const size = viewSizes[patch.viewId];
                if (size?.collapsed === true) {
                    viewSizes = {...viewSizes, [patch.viewId]: {...size, collapsed: false}};
                    changed = true;
                }
                openPanelFor(part);
                break;
            }
            case "set-panel-state": {
                applyPanel(patch);
                break;
            }
        }
    }

    // 成员归零的自建容器在同一次合成里收口：批量重放里先搬空、后来又搬回来的容器因为有成员而保留。
    retireEmptiedCustomContainers();

    const value: WorkbenchViewCustomizationsRecord & Record<string, unknown> = {
        ...source,
        version: source.version ?? WORKBENCH_VIEW_CUSTOMIZATIONS_SCHEMA_VERSION,
        placements,
        ...panelWrites,
    };
    // 缺省不落盘：空表不写字段，同时把原件里现在已空的同名字段去掉——
    // `...source` 会带着旧值过来，光靠"非空才覆盖"删不掉它（否则恢复默认落位会被原件顶回去）。
    const tables: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
        containerPlacements,
        activeContainerByPart,
        viewSizes,
        dragCollapsedParts,
        hiddenSidebars,
        suppressedContainers,
        customContainers,
    };
    for (const [key, table] of Object.entries(tables)) {
        if (Object.keys(table).length === 0) {
            delete value[key];
        } else {
            value[key] = table;
        }
    }
    return conflicts.length > 0
        ? {value, changed, diagnosis: conflicts.join("；"), conflicts}
        : changed
            ? {value, changed: true, diagnosis: "", conflicts}
            : {value, changed: false, diagnosis: "位置意图与已确认记录相同，未写盘", conflicts};
}

/** 移动后把目标集合里需要重排的成员写到覆盖上：其它集合与未知条目原样保留。 */
function rerankPlacements(
    catalog: PlacementCatalog,
    placements: Record<string, WorkbenchViewPlacementRecord>,
    rerank: Readonly<Record<string, number>>,
    containerId: string,
): Record<string, WorkbenchViewPlacementRecord> {
    const next = {...placements};
    for (const [viewId, order] of Object.entries(rerank)) {
        const defaults = catalog.views[viewId];
        if (defaults === undefined) {
            continue;
        }
        next[viewId] = {
            ...next[viewId],
            containerId,
            order,
            defaultContainerId: defaults.containerId,
            defaultOrder: defaults.order,
        };
    }
    return next;
}

/** 容器移动后的重排：只碰本次目标落位上的成员。 */
function rerankContainers(
    catalog: PlacementCatalog,
    containerPlacements: Record<string, ContainerPlacementRecord>,
    rerank: Readonly<Record<string, number>>,
    location: string,
): Record<string, ContainerPlacementRecord> {
    const next = {...containerPlacements};
    for (const [containerId, order] of Object.entries(rerank)) {
        const defaults = catalog.containerDefaults[containerId];
        if (defaults === undefined) {
            continue;
        }
        next[containerId] = {
            ...next[containerId],
            location,
            order,
            defaultLocation: defaults.location,
            defaultOrder: defaults.order,
        };
    }
    return next;
}

/**
 * 一场手势的 View 尺寸整批校验：来源落位、成员集合、每个字段的形状都要成立，否则**整批不写**。
 *
 * 校验先看来源是不是**发起时那个落位**（容器跨 Part 换轴后到达的批整批拒绝，不把高度当宽度），
 * 再看成员集合按**最新底本**重算的结果（某个 View 已经不在这个容器里，这批尺寸属于过期布局）。
 * 通过后逐字段合成：`{...旧条目, ...本次提供的字段}`——另一轴的意图与未知字段原样保留，
 * 空批不造记录、不写 0。
 */
function resolveViewSizes(
    catalog: PlacementCatalog,
    placements: Readonly<Record<string, WorkbenchViewPlacementRecord>>,
    sizes: Readonly<Record<string, ViewSizeRecord>>,
    containerPlacements: Readonly<Record<string, ContainerPlacementRecord>>,
    patch: ViewSizesIntent,
): {readonly ok: true; readonly sizes: Readonly<Record<string, ViewSizeRecord>>} | {readonly ok: false; readonly diagnosis: string} {
    if (patch.patches.length === 0) {
        return {ok: true, sizes: {}};
    }
    if (!catalog.containers.includes(patch.containerId)) {
        return {ok: false, diagnosis: `容器 ${patch.containerId} 未登记或不可落位，这批 View 尺寸没有落账`};
    }
    const location = readContainerPlacements(catalog, containerPlacements).placements
        .find((entry) => entry.containerId === patch.containerId)?.location;
    if (location !== patch.sourceLocation) {
        return {
            ok: false,
            diagnosis: `容器 ${patch.containerId} 已经不在 ${patch.sourceLocation}（换 Part 会换轴），这批 View 尺寸没有落账`,
        };
    }
    const reading = readViewPlacements(catalog, placements);
    const next: Record<string, ViewSizeRecord> = {};
    for (const entry of patch.patches) {
        if (Object.hasOwn(next, entry.viewId)) {
            return {ok: false, diagnosis: `同一批 View 尺寸里重复出现 ${entry.viewId}，整批没有落账`};
        }
        if (entry.width !== undefined && !isWorkbenchViewSize(entry.width)) {
            return {ok: false, diagnosis: `视图 ${entry.viewId} 的宽度意图不是正有限数：${String(entry.width)}，整批没有落账`};
        }
        if (entry.height !== undefined && !isWorkbenchViewSize(entry.height)) {
            return {ok: false, diagnosis: `视图 ${entry.viewId} 的高度意图不是正有限数：${String(entry.height)}，整批没有落账`};
        }
        if (entry.collapsed !== undefined && typeof entry.collapsed !== "boolean") {
            return {ok: false, diagnosis: `视图 ${entry.viewId} 的收起标记不是布尔值：${String(entry.collapsed)}，整批没有落账`};
        }
        const current = reading.placements.find((placement) => placement.viewId === entry.viewId);
        if (current === undefined || current.containerId !== patch.containerId) {
            return {
                ok: false,
                diagnosis: `视图 ${entry.viewId} 已经不在容器 ${patch.containerId} 里，这批尺寸基于过期布局，整批没有落账`,
            };
        }
        next[entry.viewId] = {
            ...sizes[entry.viewId],
            ...(entry.width === undefined ? {} : {width: entry.width}),
            ...(entry.height === undefined ? {} : {height: entry.height}),
            ...(entry.collapsed === undefined ? {} : {collapsed: entry.collapsed}),
        };
    }
    return {ok: true, sizes: next};
}

/**
 * 记录值的浅比较：未知字段也参与（数量不同或任一取值不同就不算"没变化"），
 * 否则重放会静默丢掉原件的额外字段，或把没有变化的写入当成变更。
 */
function sameRecordValues<T>(left: T | undefined, right: T): boolean {
    if (left === undefined) {
        return false;
    }
    const leftKeys = Object.keys(left as Record<string, unknown>);
    const rightKeys = Object.keys(right as Record<string, unknown>);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (const key of leftKeys) {
        if ((left as Record<string, unknown>)[key] !== (right as Record<string, unknown>)[key]) {
            return false;
        }
    }
    return true;
}

// ── 内存后置条件 ─────────────────────────────────────────────────────────────

/** 记录里的叶表：键是 View / 容器 / Part id，值是这一条的表值。 */
type WorkbenchViewTableValues = {
    readonly placements: WorkbenchViewPlacementRecord;
    readonly containerPlacements: ContainerPlacementRecord;
    readonly activeContainerByPart: string;
    readonly viewSizes: ViewSizeRecord;
    readonly dragCollapsedParts: boolean;
    readonly hiddenSidebars: boolean;
    readonly suppressedContainers: boolean;
    readonly customContainers: CustomViewContainerRecord;
};

type WorkbenchViewTable = keyof WorkbenchViewTableValues;

const WORKBENCH_VIEW_TABLES = [
    "placements",
    "containerPlacements",
    "activeContainerByPart",
    "viewSizes",
    "dragCollapsedParts",
    "hiddenSidebars",
    "suppressedContainers",
    "customContainers",
] as const;

const WORKBENCH_PANEL_FIELDS = ["panelPosition", "panelAlignment", "panelHidden", "panelCollapsed"] as const;

/** 缺省表的比较基准：缺字段与空表是同一件事（都不承载任何叶）。 */
const EMPTY_TABLE: Readonly<Record<string, never>> = {};

/**
 * 一次实际合成**改写或删除**的一个叶字段：类型化路径 + 最终值（`undefined` = 该叶被删掉）。
 *
 * 它是"请求已保存但应答丢失"时的核对口径：重读后如果这些叶字段全都已经是这个值，本批就已经达成。
 * 只覆盖产品字段（含抑制与尺寸），不含未知旁路字段——那些不参与变更判定，也不该被当成后置条件。
 */
export type ViewPlacementPostcondition =
    | {readonly [K in WorkbenchViewTable]: Readonly<{table: K; id: string; value: WorkbenchViewTableValues[K] | undefined}>}[WorkbenchViewTable]
    | {readonly field: "panelPosition"; readonly value: ShellPanelPosition | undefined}
    | {readonly field: "panelAlignment"; readonly value: ShellPanelAlignment | undefined}
    | {readonly field: "panelHidden"; readonly value: boolean | undefined}
    | {readonly field: "panelCollapsed"; readonly value: boolean | undefined};

/** 一条叶字段是否被改写/删除：未知字段也参与，与"有没有变更"用同一份比较口径。 */
function entryChanged(before: unknown, after: unknown): boolean {
    if (before === undefined || after === undefined) {
        return before !== after;
    }
    if (typeof before === "object" && typeof after === "object") {
        return !sameRecordValues(before as Record<string, unknown>, after as Record<string, unknown>);
    }
    return before !== after;
}

/** `base`（没有已确认记录时按空表）→ `composed` 的差异：本批实际改写/删除的叶字段与最终值。 */
export function viewPlacementPostconditions(
    base: WorkbenchViewCustomizationsRecord | null,
    composed: WorkbenchViewCustomizationsRecord,
): readonly ViewPlacementPostcondition[] {
    const writes: ViewPlacementPostcondition[] = [];
    for (const table of WORKBENCH_VIEW_TABLES) {
        const before = recordTable(base, table);
        const after = recordTable(composed, table);
        const ids = Object.keys(after);
        for (const id of Object.keys(before)) {
            if (!Object.hasOwn(after, id)) {
                ids.push(id);
            }
        }
        for (const id of ids) {
            if (!entryChanged(before[id], after[id])) {
                continue;
            }
            writes.push({table, id, value: after[id]} as ViewPlacementPostcondition);
        }
    }
    for (const field of WORKBENCH_PANEL_FIELDS) {
        if (!entryChanged(base?.[field], composed[field])) {
            continue;
        }
        writes.push({field, value: composed[field]} as ViewPlacementPostcondition);
    }
    return writes;
}

/** 记录里某张叶表（缺字段即空表）：比较与后置条件核对都用它，取的是同一种可比视图。 */
function recordTable(
    base: WorkbenchViewCustomizationsRecord | null,
    table: WorkbenchViewTable,
): Readonly<Record<string, unknown>> {
    return base?.[table] ?? EMPTY_TABLE;
}

/**
 * 这些后置条件在给定底本上是否**全部**成立（`undefined` 表示该叶必须缺失）。
 *
 * 空写集恒真——调用方只有在本次合成确实写过东西时才该用它做"已经达成"的判定。
 */
export function viewPlacementPostconditionsHold(
    postconditions: readonly ViewPlacementPostcondition[],
    base: WorkbenchViewCustomizationsRecord | null,
): boolean {
    return postconditions.every((postcondition) => "table" in postcondition
        ? !entryChanged(recordTable(base, postcondition.table)[postcondition.id], postcondition.value)
        : !entryChanged(base?.[postcondition.field], postcondition.value));
}
