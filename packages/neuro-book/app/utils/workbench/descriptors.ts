/**
 * Workbench 领域模型：Part / Container / View 的 descriptor 与注册表。
 *
 * 字段与语义取自 `docs/proposals/workbench-view-host.md` 的 descriptor 表。本文件只做**声明与校验**：
 * 不实例化组件、不读存储、不发请求，也不依赖 Vue。
 *
 * 取值域的闭合规则：每个枚举取值都必须在本文件有对应的求值/判别函数——登记表用
 * `satisfies Record<联合类型, …>` 闭合，往联合里加取值而忘了加函数会直接编译失败；
 * 运行时遇到未登记取值一律返回失败（`{ok: false}`）而不是静默放行，
 * 因为 L2 声明式 descriptor 里的字符串不受类型检查保护。
 */

import {
    evaluateContextWhen,
    validateWhen,
    type ContextValues,
    type ContextKey,
} from "nbook/app/utils/workbench/context-keys";
// 声明层只消费 View 标题动作的纯合同：贡献类型与校验都在那一份里，descriptor 不复制一套字段规则。
import {titleActionProblems, type ViewTitleActionContribution} from "nbook/app/utils/workbench/view-title-actions";
// 尺寸约束的默认值与有效范围只有一份实现（在容器布局的纯映射里）；校验与呈现必须同一口径。
import {effectiveViewMinimumSize} from "nbook/app/utils/workbench/view-container-layout";

/** 统一结果合同：失败带原因，调用方据此产出 view 级 issue；本层不抛未捕获异常。 */
export type DescriptorResult<T> = {ok: true; value: T} | {ok: false; reason: string};

function ok<T>(value: T): DescriptorResult<T> {
    return {ok: true, value};
}

function fail<T>(reason: string): DescriptorResult<T> {
    return {ok: false, reason};
}

/** 取值域查表：只认登记过的键（未登记返回 null，由调用方转成失败）。 */
function registered<T>(table: Readonly<Record<string, T>>, key: string): T | null {
    return Object.hasOwn(table, key) ? table[key]! : null;
}

// ── Part ─────────────────────────────────────────────────────────────────────

/** 工作台的大区域。它在布局树上的位置归布局层，不在 descriptor 里。 */
export const WORKBENCH_PART_IDS = ["titlebar", "activity", "left", "editor", "right", "panel", "statusbar"] as const;

export type WorkbenchPartId = (typeof WORKBENCH_PART_IDS)[number];

/** 取值域成员表：静态字面量用 Record（不建 Set）。 */
const PART_IDS: Record<string, true> = Object.fromEntries(WORKBENCH_PART_IDS.map((id) => [id, true]));

export type PartDescriptor = {
    id: WorkbenchPartId;
    /** i18n key：注册表只存 key，宿主渲染时解析（提案开放问题 1 取值 b）。 */
    titleKey: string;
    icon?: string;
    /** 用户可否从界面收起 / 展开该 Part。 */
    canToggleVisibility: boolean;
    /** 可见性谓词：不满足时不渲染该 Part（例如 B/S 下没有 titlebar）。 */
    when?: ViewWhen;
};

// ── 容器 ─────────────────────────────────────────────────────────────────────

/**
 * 容器**默认**落位（提案「位置与意图」表：容器位置归 descriptor，用户覆盖另存
 * `workbench.views.customizations`）。`window` 只在枚举里预留，其真实行为研究未验证。
 */
export const CONTAINER_LOCATIONS = ["sidebar-left", "sidebar-right", "panel", "window"] as const;

export type ContainerLocation = (typeof CONTAINER_LOCATIONS)[number];

export type ContainerDescriptor = {
    id: string;
    titleKey: string;
    icon: string;
    location: ContainerLocation;
    /** 同一落位内容器清单的顺序；同值按 id 稳定排序。 */
    order: number;
    /**
     * 容器整体可否被用户搬到别的落位。**未声明按可移动处理**，只有明确 false 才不提供移动入口
     * （也不作为别的容器移动的落点）；它不改变容器自己的容器内落位呈现。
     */
    canMoveContainer?: boolean;
};

/** 容器位置 → 承载它的 Part。`window` 是预留值：求值失败，不当作既有位置放行。 */
const CONTAINER_LOCATION_PARTS: Record<string, DescriptorResult<WorkbenchPartId>> = {
    "sidebar-left": ok("left"),
    "sidebar-right": ok("right"),
    panel: ok("panel"),
    window: fail("容器位置 window 是预留值：第一版未验证其行为，不落位"),
} satisfies Record<ContainerLocation, DescriptorResult<WorkbenchPartId>>;

export function resolveLocationPart(location: string): DescriptorResult<WorkbenchPartId> {
    return registered(CONTAINER_LOCATION_PARTS, location) ?? fail(`未登记的容器位置：${location}`);
}

// ── 视图 ─────────────────────────────────────────────────────────────────────

export const VIEW_LAYOUT_MODES = ["scroll", "fill"] as const;

export type ViewLayoutMode = (typeof VIEW_LAYOUT_MODES)[number];

/**
 * `layout` 的组合合同（口径同设置外壳 `NovelIdeSettingsView.types.ts` 的 layout 注释）：
 * `scroll` 外壳给内边距并拥有滚动；`fill` 视图自己占满内容区、管理内部滚动。
 */
export type ViewLayoutContract = {
    mode: ViewLayoutMode;
    shellPadsContent: boolean;
    shellOwnsScroll: boolean;
};

const VIEW_LAYOUT_CONTRACTS: Record<string, ViewLayoutContract> = {
    scroll: {mode: "scroll", shellPadsContent: true, shellOwnsScroll: true},
    fill: {mode: "fill", shellPadsContent: false, shellOwnsScroll: false},
} satisfies Record<ViewLayoutMode, ViewLayoutContract>;

/**
 * 没指定 `layout` 时的呈现合同（= `scroll`：外壳给内边距并拥有滚动）。
 * 「还没有活动视图」的容器与宿主取默认值都用它——默认值只有这一份，调用方不各写一份字面量。
 */
export const DEFAULT_VIEW_LAYOUT_CONTRACT: ViewLayoutContract = VIEW_LAYOUT_CONTRACTS.scroll!;

export function resolveViewLayout(layout: string): DescriptorResult<ViewLayoutContract> {
    const contract = registered(VIEW_LAYOUT_CONTRACTS, layout);
    return contract ? ok(contract) : fail(`未登记的 layout 取值：${layout}`);
}

/**
 * `when.requires` 的取值域＝共享上下文键登记表。可见性**只**决定看不看得见，永远不等于权限。
 * 未知键在注册期失败、求值期当失败处理，都不放行。
 */
export type ViewWhen = {requires?: readonly ContextKey[]};

/** `requiredAuthority` 取值域；多个为 **allOf**，不可用时视图仍可见、只是动作不可执行。 */
export const VIEW_AUTHORITIES = ["project", "session", "job", "files"] as const;

export type ViewAuthority = (typeof VIEW_AUTHORITIES)[number];

/** `stateScope` 取值域：该视图的 memento 落在 User Storage 或 Project Storage。 */
export const VIEW_STATE_SCOPES = ["user", "project"] as const;

export type ViewStateScope = (typeof VIEW_STATE_SCOPES)[number];

/** memento 的归属层；不持久化的瞬时状态不通过 stateScope 表达。 */
export type ViewStateLayer =
    | {scope: "user"}
    | {scope: "project"; projectRoot: string};

/** 宿主注入的环境事实。本层不 import store、不读 window——谁持有事实谁填。 */
export type WorkbenchContext = Readonly<{
    /** 是否打开了 Project。 */
    project: boolean;
    /** 是否有选中条目（当前选中的文件 / 角色等）。 */
    selection: boolean;
    /** 是否处于用户资产工作区。 */
    "user-assets": boolean;
    /** 桌面外壳（Electron bridge）是否可用。 */
    desktop: boolean;
    /** 各 authority 的可用性，由持有该 authority 的宿主服务填。 */
    authorities: Readonly<Record<ViewAuthority, boolean>>;
    /** 当前 Project 根；`stateScope=project` 的 memento 需要它。 */
    projectRoot: string | null;
}> & ContextValues;

type ContextCheck = {available: (context: WorkbenchContext) => boolean; reason: string};

const AUTHORITY_CHECKS: Record<string, ContextCheck> = {
    project: {available: (context) => context.authorities.project, reason: "需要打开 Project"},
    session: {available: (context) => context.authorities.session, reason: "需要活动会话"},
    job: {available: (context) => context.authorities.job, reason: "需要任务 authority 可用"},
    files: {available: (context) => context.authorities.files, reason: "需要工作区文件 authority"},
} satisfies Record<ViewAuthority, ContextCheck>;

type StateLayerContext = Pick<WorkbenchContext, "projectRoot">;

const STATE_SCOPE_RESOLVERS: Record<string, (context: StateLayerContext) => DescriptorResult<ViewStateLayer>> = {
    user: () => ok({scope: "user"}),
    project: (context) => context.projectRoot === null
        ? fail("stateScope=project 需要当前 Project 根")
        : ok({scope: "project", projectRoot: context.projectRoot}),
} satisfies Record<ViewStateScope, (context: StateLayerContext) => DescriptorResult<ViewStateLayer>>;

/** 可见性求值结果：原因供容器内展示（可见性永远不是权限）。 */
export type VisibilityEvaluation = {visible: boolean; reasons: string[]};

export function evaluateWhen(when: ViewWhen | undefined, context: WorkbenchContext): DescriptorResult<VisibilityEvaluation> {
    const evaluation = evaluateContextWhen(when, context);
    if (!evaluation.ok) {
        return fail(evaluation.reason);
    }
    return ok({visible: evaluation.value.matches, reasons: evaluation.value.reasons});
}

/** 可执行性求值结果：多个 authority 为 allOf，缺失的全部上报。 */
export type ActionabilityEvaluation = {actionable: boolean; reasons: string[]};

export function evaluateAuthorities(required: readonly string[] | undefined, context: WorkbenchContext): DescriptorResult<ActionabilityEvaluation> {
    const reasons: string[] = [];
    for (const authority of required ?? []) {
        const check = registered(AUTHORITY_CHECKS, authority);
        if (!check) {
            return fail(`未登记的 requiredAuthority 取值：${authority}`);
        }
        if (!check.available(context)) {
            reasons.push(check.reason);
        }
    }
    return ok({actionable: reasons.length === 0, reasons});
}

export function resolveViewStateLayer(scope: string, context: StateLayerContext): DescriptorResult<ViewStateLayer> {
    const resolver = registered(STATE_SCOPE_RESOLVERS, scope);
    return resolver ? resolver(context) : fail(`未登记的 stateScope 取值：${scope}`);
}

/**
 * 双轴尺寸约束声明（`{width, height}` 的 `Partial`）：与 Grid 的 `minimumSize` / `maximumSize` 同名同义。
 *
 * 只声明一根轴时另一轴按缺省走；声明值必须正有限（0 不是"不限"——不限就是不声明），
 * 且上限的那个轴不得低于该轴的有效最小尺寸 `max(33, minimumSize ?? 64)`，否则注册失败：
 * 静默丢掉一个装不下的上限会让"声明了上限"变成谎话。
 */
export type ViewSizeConstraint = Readonly<Partial<{width: number; height: number}>>;

export type ViewDescriptor = {
    id: string;
    titleKey: string;
    icon: string;
    /** 归属容器 id：校验期必须能在 catalog 里求值（悬空引用被拒绝）。 */
    container: string;
    layout: ViewLayoutMode;
    when?: ViewWhen;
    requiredAuthority?: readonly ViewAuthority[];
    /** 同容器内顺序；同值按 id 稳定排序。 */
    order: number;
    /** 同容器内归一化的初始尺寸比例；用户保存的绝对尺寸优先。 */
    weight?: number;
    /**
     * 展开时的双轴最小尺寸（CSS px）；缺省主轴 64、交叉轴不限制。
     *
     * 只有**当前主轴**的约束会交给容器分支（左右排看 `width`、上下排看 `height`），有效值不低于
     * `max(33, 声明值)`（33 = 收起标题 32 + 1，Grid 的收起策略要求它严格小于展开最小）。
     */
    minimumSize?: ViewSizeConstraint;
    /** 展开时的双轴最大尺寸（CSS px）；缺省该轴无界，声明值不得低于该轴的有效最小尺寸。 */
    maximumSize?: ViewSizeConstraint;
    canToggleVisibility: boolean;
    canMoveView: boolean;
    /**
     * View 自己的标题动作（primary 直接成按钮、secondary 收进「更多」）。
     * 只写 `id` + `commandId` + 位置与顺序：标题 / 图标取 canonical 命令元数据，不在这里重写文案。
     */
    titleActions?: readonly ViewTitleActionContribution[];
    /** 宿主白名单解析器的键：不存组件、不存模块路径与 HTML。 */
    factoryKey: string;
    stateScope: ViewStateScope;
};

// ── 注册表 ───────────────────────────────────────────────────────────────────

/** 组装根注入的声明清单（内置项与将来的插件项走同一条注册路径）。 */
export type WorkbenchCatalog = {
    parts: readonly PartDescriptor[];
    containers: readonly ContainerDescriptor[];
    views: readonly ViewDescriptor[];
};

/**
 * 校验后的只读注册表。所有查表都走求值：未登记 id 返回失败，不返回 undefined。
 * 清单顺序：容器与视图按 (order, id) 排序，Part 按声明顺序（Part 没有 order，位置归布局树）。
 */
export type WorkbenchRegistry = {
    parts(): readonly PartDescriptor[];
    containers(): readonly ContainerDescriptor[];
    views(): readonly ViewDescriptor[];
    resolvePart(id: string): DescriptorResult<PartDescriptor>;
    resolveContainer(id: string): DescriptorResult<ContainerDescriptor>;
    resolveView(id: string): DescriptorResult<ViewDescriptor>;
    /** 容器内视图：`order` 升序、同值按 id 稳定排序；容器未登记直接失败。 */
    viewsOf(containerId: string): DescriptorResult<readonly ViewDescriptor[]>;
};

/** id 必须命名空间化（内置 `nbook.*`，插件 `<publisher>.<name>`）：空串、无命名空间、大写一律拒绝。 */
const NAMESPACED_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

function duplicateProblems(kind: string, ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const id of ids) {
        if (seen.has(id)) {
            problems.push(`${kind} id 重复：${id}`);
        }
        seen.add(id);
    }
    return problems;
}

function whenProblems(owner: string, when: ViewWhen | undefined): string[] {
    const problems: string[] = [];
    for (const requirement of (when?.requires ?? []) as readonly string[]) {
        if (!validateWhen({requires: [requirement as ContextKey]}).ok) {
            problems.push(`${owner} 的 when 取值未登记：${requirement}`);
        }
    }
    return problems;
}

function authorityProblems(owner: string, required: readonly string[] | undefined): string[] {
    const problems: string[] = [];
    for (const authority of required ?? []) {
        if (!registered(AUTHORITY_CHECKS, authority)) {
            problems.push(`${owner} 的 requiredAuthority 未登记：${authority}`);
        }
    }
    return problems;
}

/** 声明的尺寸必须是正有限数：0 / 负 / NaN / Infinity 都不是"不限"，不限就是不声明。 */
function isDeclaredSize(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 双轴尺寸约束的注册校验：两轴各自独立。
 *
 * 有效最小尺寸是 `max(33, minimumSize[axis] ?? 64)`（33 = 收起标题 32 + 1）；声明的上限低于它时
 * 注册失败，而不是在呈现时静默丢掉上限——那会让"声明了上限"变成谎话。
 */
function viewSizeProblems(view: ViewDescriptor): string[] {
    const problems: string[] = [];
    for (const axis of ["width", "height"] as const) {
        const minimum = view.minimumSize?.[axis];
        const maximum = view.maximumSize?.[axis];
        if (minimum !== undefined && !isDeclaredSize(minimum)) {
            problems.push(`视图 ${view.id} 的 minimumSize.${axis} 不是正有限数：${String(minimum)}`);
        }
        if (maximum !== undefined && !isDeclaredSize(maximum)) {
            problems.push(`视图 ${view.id} 的 maximumSize.${axis} 不是正有限数：${String(maximum)}`);
        }
        const effectiveMinimum = effectiveViewMinimumSize(minimum);
        if (maximum !== undefined && isDeclaredSize(maximum) && maximum < effectiveMinimum) {
            problems.push(`视图 ${view.id} 的 maximumSize.${axis}（${maximum}）低于有效最小尺寸 ${effectiveMinimum}`);
        }
    }
    return problems;
}

/** 全量校验：一次性给全所有问题（不做「发现第一个就退出」，诊断信息不丢）。 */
function collectProblems(catalog: WorkbenchCatalog): string[] {
    const problems: string[] = [];
    const containerIds = new Set(catalog.containers.map((container) => container.id));

    for (const part of catalog.parts) {
        if (!PART_IDS[part.id]) {
            problems.push(`Part id 未登记：${String(part.id)}`);
        }
        problems.push(...whenProblems(`Part ${part.id}`, part.when));
    }
    problems.push(...duplicateProblems("Part", catalog.parts.map((part) => part.id)));

    for (const container of catalog.containers) {
        if (!NAMESPACED_ID.test(container.id)) {
            problems.push(`容器 id 未命名空间化：${container.id}`);
        }
        const part = resolveLocationPart(container.location);
        if (!part.ok) {
            problems.push(`容器 ${container.id}：${part.reason}`);
        }
        if (!Number.isFinite(container.order)) {
            problems.push(`容器 ${container.id} 的 order 不是有限数：${String(container.order)}`);
        }
    }
    problems.push(...duplicateProblems("容器", catalog.containers.map((container) => container.id)));

    for (const view of catalog.views) {
        if (!NAMESPACED_ID.test(view.id)) {
            problems.push(`视图 id 未命名空间化：${view.id}`);
        }
        if (!containerIds.has(view.container)) {
            problems.push(`视图 ${view.id} 的 container 未求值：${view.container}`);
        }
        if (!registered(VIEW_LAYOUT_CONTRACTS, view.layout)) {
            problems.push(`视图 ${view.id} 的 layout 未登记：${String(view.layout)}`);
        }
        if (!registered(STATE_SCOPE_RESOLVERS, view.stateScope)) {
            problems.push(`视图 ${view.id} 的 stateScope 未登记：${String(view.stateScope)}`);
        }
        if (!Number.isFinite(view.order)) {
            problems.push(`视图 ${view.id} 的 order 不是有限数：${String(view.order)}`);
        }
        if (view.weight !== undefined && (!Number.isFinite(view.weight) || view.weight < 0)) {
            problems.push(`视图 ${view.id} 的 weight 非法：${String(view.weight)}`);
        }
        problems.push(...whenProblems(`视图 ${view.id}`, view.when));
        problems.push(...authorityProblems(`视图 ${view.id}`, view.requiredAuthority));
        problems.push(...titleActionProblems(`视图 ${view.id}`, view.titleActions));
        problems.push(...viewSizeProblems(view));
    }
    problems.push(...duplicateProblems("视图", catalog.views.map((view) => view.id)));

    return problems;
}

/** 同值按 id 稳定排序（提案 order 字段语义），避免声明顺序影响界面顺序。 */
function byOrderThenId<T extends {id: string; order: number}>(left: T, right: T): number {
    if (left.order !== right.order) {
        return left.order - right.order;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function createWorkbenchRegistry(catalog: WorkbenchCatalog): DescriptorResult<WorkbenchRegistry> {
    const problems = collectProblems(catalog);
    if (problems.length > 0) {
        return fail(problems.join("；"));
    }

    const parts = [...catalog.parts];
    const containers = [...catalog.containers].sort(byOrderThenId);
    const views = [...catalog.views].sort(byOrderThenId);
    const partsById = new Map(parts.map((part) => [part.id, part] as const));
    const containersById = new Map(containers.map((container) => [container.id, container] as const));
    const viewsById = new Map(views.map((view) => [view.id, view] as const));
    const viewsByContainer = new Map<string, ViewDescriptor[]>();
    for (const view of views) {
        const bucket = viewsByContainer.get(view.container);
        if (bucket) {
            bucket.push(view);
        } else {
            viewsByContainer.set(view.container, [view]);
        }
    }

    const resolve = <T>(table: ReadonlyMap<string, T>, kind: string, id: string): DescriptorResult<T> => {
        const hit = table.get(id);
        return hit ? ok(hit) : fail(`${kind} id 未登记：${id}`);
    };

    return ok({
        parts: () => parts,
        containers: () => containers,
        views: () => views,
        resolvePart: (id) => resolve(partsById, "Part", id),
        resolveContainer: (id) => resolve(containersById, "容器", id),
        resolveView: (id) => resolve(viewsById, "视图", id),
        viewsOf: (containerId) => {
            const container = resolve(containersById, "容器", containerId);
            return container.ok ? ok(viewsByContainer.get(containerId) ?? []) : container;
        },
    });
}
