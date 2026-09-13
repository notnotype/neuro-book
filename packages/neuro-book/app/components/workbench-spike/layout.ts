/**
 * 验证台的布局状态 = 几何（原语的 grid 快照）+ 界面态（收起、活动容器、视图位置覆盖）。
 *
 * 三类界面态都放在布局层而不是树里：
 * - 树只拥有几何与拓扑（原语契约，本次不改）；
 * - 收起**不**写进树的尺寸——把 `size` 夹到 0 会丢掉用户原来的宽度，也说不清「展开回多宽」，
 *   所以记在 `collapsed` 里，渲染时把该叶从分支的 children 里过滤掉，展开即重新插入；
 * - 视图位置覆盖记「用户把它挪到哪了」，默认位置仍由 descriptor 决定（覆盖优先，见 placementOf）。
 *
 * 本文件不认识注册表：可用视图与容器由调用方按 `SpikeCatalog` 注入（组装根见 WorkbenchSpike.vue）。
 * 快照版本与恢复规则（版本不符 / 未知 ref / 非法根 / 覆盖失效 / 收起失效 / 活动容器回落的 issue）都收敛在本文件。
 */
import {createGrid, type GridLeaf, type GridNode, type GridRestoreResult, type GridSnapshot} from "@notnotype/nb-ui/components";
import type {SpikeContainerDescriptor, SpikeViewDescriptor} from "./descriptors";

export type SpikeLocation = "sidebar-left" | "sidebar-right" | "panel";
export type ViewPlacement = {containerId: string; order: number};
export type SpikeLayoutState = {
    layoutVersion: 1;
    grid: GridSnapshot;
    collapsed: string[];
    activeContainer: Record<SpikeLocation, string>;
    viewPlacements: Record<string, ViewPlacement>;
};

/** 状态层需要的全部外部知识：可用视图与容器。由组装根注入，状态层不 import 注册表。 */
export type SpikeCatalog = {views: SpikeViewDescriptor[]; containers: SpikeContainerDescriptor[]};

export const SPIKE_LAYOUT_VERSION = 1;

/** 位置枚举的声明顺序即界面顺序（活动栏分组、状态栏摘要）。 */
const SPIKE_LOCATIONS: SpikeLocation[] = ["sidebar-left", "sidebar-right", "panel"];

/** 只有这三个叶子可收起：活动栏、编辑区、状态栏是工作台的固定骨架。 */
const COLLAPSIBLE_LEAVES: string[] = SPIKE_LOCATIONS;

function leaf(id: string, size: number, minimumSize = 80, maximumSize = 900): GridLeaf<string> {
    return {kind: "leaf", id, ref: id, minimumSize, maximumSize, size};
}

/** 初始拓扑：面板在编辑器中列（嵌套），可被移到整行（跨全宽）。 */
function defaultTree(): GridNode<string> {
    return {
        kind: "branch",
        id: "root",
        orientation: "vertical",
        children: [
            {
                kind: "branch",
                id: "main",
                orientation: "horizontal",
                children: [
                    leaf("activity", 64, 48, 96),
                    leaf("sidebar-left", 280, 180, 520),
                    {kind: "branch", id: "center", orientation: "vertical", children: [leaf("editor", 520, 240, 1200), leaf("panel", 200, 120, 600)]},
                    leaf("sidebar-right", 300, 180, 520),
                ],
            },
            leaf("statusbar", 40, 32, 64),
        ],
    };
}

/** 每个位置首个声明的容器即默认活动容器。 */
function defaultActiveContainers(catalog: SpikeCatalog): Record<SpikeLocation, string> {
    const active = {} as Record<SpikeLocation, string>;
    for (const location of SPIKE_LOCATIONS) {
        active[location] = catalog.containers.find((container) => container.location === location)?.id ?? "";
    }
    return active;
}

export function createDefaultLayout(catalog: SpikeCatalog): SpikeLayoutState {
    return {
        layoutVersion: SPIKE_LAYOUT_VERSION,
        grid: createGrid(defaultTree()).serialize(),
        collapsed: [],
        activeContainer: defaultActiveContainers(catalog),
        viewPlacements: {},
    };
}

export function serializeLayout(state: SpikeLayoutState): string {
    return JSON.stringify(state, null, 1);
}

export function liveLeafIds(root: GridNode<string> | null | undefined): string[] {
    if (!root) {
        return [];
    }
    return root.kind === "leaf" ? [root.id] : root.children.flatMap((child) => liveLeafIds(child));
}

/** 默认树的全部节点 id（分支 + 叶）：恢复白名单里的骨架部分。 */
function treeIds(root: GridNode<string>): string[] {
    return root.kind === "leaf" ? [root.id] : [root.id, ...root.children.flatMap((child) => treeIds(child))];
}

/**
 * 原语**不做**的那些校验：节点 id（白名单、全树唯一、与叶子 ref 对齐）与叶子尺寸
 * （有限、非负、min ≤ max）。原语只按 ref 去重，会把非法字段原样 spread 进树，下游 layout()/
 * resize() 的 Math.max 与百分比换算就会产出 NaN。
 */
function nodeProblems(root: GridNode<string>, allowed: string[]): string[] {
    const seen = new Set<string>();
    const problems: string[] = [];
    const walk = (node: GridNode<string>) => {
        if (!allowed.includes(node.id) || seen.has(node.id)) {
            problems.push(`节点 id 非法或重复：${node.id}`);
        }
        seen.add(node.id);
        if (node.kind === "branch") {
            if (node.orientation !== "horizontal" && node.orientation !== "vertical") {
                problems.push(`分支方向非法：${node.id}`);
            }
            node.children.forEach(walk);
            return;
        }
        if (node.ref !== node.id) {
            problems.push(`叶子 id 与 ref 不一致：${node.id}(ref=${node.ref})`);
        }
        for (const [name, value] of [["size", node.size], ["minimumSize", node.minimumSize], ["maximumSize", node.maximumSize]] as const) {
            if (!Number.isFinite(value) || value < 0) {
                problems.push(`叶子尺寸非法：${node.id}（${name}=${String(value)}）`);
            }
        }
        if (node.minimumSize > node.maximumSize) {
            problems.push(`叶子尺寸非法：${node.id}（minimumSize > maximumSize）`);
        }
    };
    walk(root);
    return problems;
}

/**
 * 恢复路径的**唯一入口**（restoreLayout / 场景注入 / 重置都走它）：先用原语走一遍快照，
 * 再把原语不做或做不干净的校验一次做完——
 * ① 根必须是非空分支（单叶根在渲染侧没有 children）；
 * ② 节点 id 白名单、全树唯一、与 ref 对齐；③ ref 白名单（未知 ref 由 resolver 丢弃并转 issue）；
 * ④ 叶子尺寸有限、非负、min ≤ max；⑤ 原语的 dropped / clamped / reason 逐条转 issue。
 * 任一项不合法 → **整树**回退默认布局，不做「半合法半非法」的接受。
 */
function validateAndNormalizeGrid(raw: unknown, catalog: SpikeCatalog): {ok: true; grid: GridSnapshot; issues: string[]} | {ok: false; fallback: string; issues: string[]} {
    if (!raw || typeof raw !== "object") {
        return {ok: false, fallback: "布局快照缺少树，已回退默认布局", issues: ["快照缺少树"]};
    }
    // 快照里的 ref 必须命中骨架节点、容器或视图，其余一律当作未知引用。
    // 身份 resolver（`(ref) => ref`）会让任意 ref 通过，未知引用的叶于是静默留在树里。
    const knownRefs = [...treeIds(defaultTree()), ...catalog.containers.map((container) => container.id), ...catalog.views.map((view) => view.id)];
    const probe = createGrid<string>(null);
    let result: GridRestoreResult;
    try {
        result = probe.restore(raw, (ref) => (knownRefs.includes(ref) ? ref : null));
    } catch (error) {
        // 原语对结构错乱的 children（例如字符串）会直接抛错，恢复路径不能因此中断。
        return {ok: false, fallback: "布局快照无法解析，已回退默认布局", issues: [`布局快照无法解析：${error instanceof Error ? error.message : String(error)}`]};
    }
    const issues = result.dropped.map((item) => `布局快照丢弃了未知引用「${item.ref}」（${item.reason}）`);
    if (result.clamped.length > 0) {
        issues.push(`布局快照的叶子尺寸越界，已夹取：${result.clamped.join("、")}`);
    }
    if (!result.ok) {
        issues.push(`布局快照里的树无效：${String(result.reason ?? "未知结构")}`);
        return {ok: false, fallback: "布局快照里的树无效，已回退默认布局", issues};
    }
    const root = probe.root();
    if (!root || root.kind !== "branch" || root.children.length === 0) {
        return {ok: false, fallback: "布局快照包含非法根节点，已回退默认布局", issues: [...issues, "布局快照的根不是非空分支"]};
    }
    const problems = nodeProblems(root, knownRefs);
    if (problems.length > 0) {
        return {ok: false, fallback: "布局快照包含非法节点，已回退默认布局", issues: [...issues, ...problems]};
    }
    return {ok: true, grid: probe.serialize(), issues};
}

/**
 * 顶层界面态字段的读取：字段**缺省**是「本来就没有状态」，不报；**存在但类型不符**是快照损坏，
 * 记一条 issue 再按空值处理——静默吞掉会让人分不清这两种情况。
 */
function fieldList(value: unknown, name: string, issues: string[]): unknown[] {
    if (value === undefined) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    issues.push(`布局快照的 ${name} 字段类型非法，已忽略`);
    return [];
}

function fieldRecord(value: unknown, name: string, issues: string[]): Record<string, unknown> {
    if (value === undefined) {
        return {};
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    issues.push(`布局快照的 ${name} 字段类型非法，已忽略`);
    return {};
}

export function restoreLayout(raw: unknown, catalog: SpikeCatalog): {state: SpikeLayoutState; issues: string[]} {
    if (!raw || typeof raw !== "object") {
        return {state: createDefaultLayout(catalog), issues: ["布局快照不是对象"]};
    }
    const candidate = raw as {layoutVersion?: unknown; grid?: unknown; collapsed?: unknown; activeContainer?: unknown; viewPlacements?: unknown};
    if (candidate.layoutVersion !== SPIKE_LAYOUT_VERSION) {
        return {state: createDefaultLayout(catalog), issues: [`布局快照版本 ${String(candidate.layoutVersion)} 不受支持`]};
    }

    const issues: string[] = [];
    const fallback = createDefaultLayout(catalog);
    const grid = validateAndNormalizeGrid(candidate.grid, catalog);
    issues.push(...grid.issues);
    if (!grid.ok) {
        issues.push(grid.fallback);
    }
    const state: SpikeLayoutState = {
        layoutVersion: SPIKE_LAYOUT_VERSION,
        grid: grid.ok ? grid.grid : fallback.grid,
        collapsed: [],
        activeContainer: {...fallback.activeContainer},
        viewPlacements: {},
    };

    const ids = new Set(liveLeafIds(state.grid.root));
    for (const id of fieldList(candidate.collapsed, "collapsed", issues)) {
        if (typeof id === "string" && ids.has(id) && COLLAPSIBLE_LEAVES.includes(id)) {
            state.collapsed.push(id);
        } else {
            issues.push(`收起列表里的叶子不存在或不可收起：${String(id)}`);
        }
    }

    for (const [viewId, rawPlacement] of Object.entries(fieldRecord(candidate.viewPlacements, "viewPlacements", issues))) {
        const placement = rawPlacement as Partial<ViewPlacement> | null;
        if (!catalog.views.some((view) => view.id === viewId)
            || typeof placement?.containerId !== "string"
            || !catalog.containers.some((container) => container.id === placement.containerId)
            || typeof placement.order !== "number"
            || !Number.isFinite(placement.order)) {
            issues.push(`视图位置覆盖引用了不存在的容器/视图：${viewId}`);
            continue;
        }
        state.viewPlacements[viewId] = {containerId: placement.containerId, order: placement.order};
    }

    const active = fieldRecord(candidate.activeContainer, "activeContainer", issues);
    for (const location of SPIKE_LOCATIONS) {
        const requested = active[location];
        if (typeof requested === "string" && catalog.containers.some((container) => container.id === requested && container.location === location)) {
            state.activeContainer[location] = requested;
            continue;
        }
        if (requested !== undefined) {
            issues.push(`活动容器不存在或不属于位置 ${location}：${String(requested)}`);
        }
        state.activeContainer[location] = fallback.activeContainer[location];
    }

    return {state, issues};
}

/**
 * 覆盖优先，没有覆盖时回落到 catalog 里 descriptor 的默认位置。
 * 读路径同样要对非法覆盖值兜底：覆盖只有「视图仍在 catalog、容器仍在 catalog、
 * order 是有限非负数」时才生效，其余（旧版本写入、外部构造）一律回落默认位置。
 */
export function placementOf(viewId: string, state: SpikeLayoutState, catalog: SpikeCatalog): ViewPlacement {
    const view = catalog.views.find((item) => item.id === viewId);
    const fallback: ViewPlacement = {containerId: view?.container ?? "", order: view?.order ?? 0};
    const override = state.viewPlacements[viewId];
    if (!view || !override
        || !Number.isFinite(override.order)
        || override.order < 0
        || !catalog.containers.some((container) => container.id === override.containerId)) {
        return fallback;
    }
    return override;
}

/**
 * 记一条位置覆盖，这是视图拖拽的共享落账路径。
 * 视图 / 容器必须在 catalog 里、order 必须是有限数，否则原 state 不变（与落点判定的「无操作」语义一致）；
 * 合法的 order 归一为**非负整数**（负数夹到 0，小数取整），不让非法值进快照。
 */
export function placeView(viewId: string, containerId: string, order: number, state: SpikeLayoutState, catalog: SpikeCatalog): SpikeLayoutState {
    if (!catalog.views.some((view) => view.id === viewId)
        || !catalog.containers.some((container) => container.id === containerId)
        || !Number.isFinite(order)) {
        return state;
    }
    const normalOrder = Math.max(0, Math.round(order));
    return {...state, viewPlacements: {...state.viewPlacements, [viewId]: {containerId, order: normalOrder}}};
}

/** 该容器当前该显示的视图：按覆盖后的 order 排序，同值按 id 稳定排序。 */
export function viewsOfContainer(containerId: string, state: SpikeLayoutState, catalog: SpikeCatalog): SpikeViewDescriptor[] {
    return catalog.views
        .filter((view) => placementOf(view.id, state, catalog).containerId === containerId)
        .sort((left, right) => {
            const a = placementOf(left.id, state, catalog).order;
            const b = placementOf(right.id, state, catalog).order;
            if (a !== b) {
                return a - b;
            }
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });
}
