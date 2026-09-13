/**
 * 验证台的布局状态 = 几何（原语的 grid 快照）+ 界面态（收起、活动容器、视图位置覆盖）。
 *
 * 三类界面态都放在布局层而不是树里：
 * - 树只拥有几何与拓扑（原语契约，本次不改）；
 * - 收起**不**写进树的尺寸——把 `size` 夹到 0 会丢掉用户原来的宽度，也说不清「展开回多宽」，
 *   所以记在 `collapsed` 里，渲染时把该叶从分支的 children 里过滤掉，展开即重新插入；
 * - 视图位置覆盖记「用户把它挪到哪了」，默认位置仍由 descriptor 决定（覆盖优先，见 placementOf）。
 *
 * 快照版本与恢复规则（版本不符 / 覆盖失效 / 收起失效 / 活动容器回落的 issue）都收敛在本文件。
 */
import {createGrid, type GridLeaf, type GridNode, type GridSnapshot} from "@notnotype/nb-ui/components";
import {SPIKE_CONTAINERS, SPIKE_VIEWS, type SpikeViewDescriptor} from "./descriptors";

export type SpikeLocation = "sidebar-left" | "sidebar-right" | "panel";
export type ViewPlacement = {containerId: string; order: number};
export type SpikeLayoutState = {
    layoutVersion: 1;
    grid: GridSnapshot;
    collapsed: string[];
    activeContainer: Record<SpikeLocation, string>;
    viewPlacements: Record<string, ViewPlacement>;
};

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
function defaultActiveContainers(): Record<SpikeLocation, string> {
    const active = {} as Record<SpikeLocation, string>;
    for (const location of SPIKE_LOCATIONS) {
        active[location] = SPIKE_CONTAINERS.find((container) => container.location === location)?.id ?? "";
    }
    return active;
}

export function createDefaultLayout(): SpikeLayoutState {
    return {
        layoutVersion: SPIKE_LAYOUT_VERSION,
        grid: createGrid(defaultTree()).serialize(),
        collapsed: [],
        activeContainer: defaultActiveContainers(),
        viewPlacements: {},
    };
}

export function serializeLayout(state: SpikeLayoutState): string {
    return JSON.stringify(state, null, 1);
}

function leafIds(root: GridNode<string> | null | undefined): string[] {
    if (!root) {
        return [];
    }
    return root.kind === "leaf" ? [root.id] : root.children.flatMap((child) => leafIds(child));
}

/**
 * 用原语把快照里的树走一遍：未知结构 / 版本不符 / 重复 ref 一律由它拒绝，
 * 通过后用 `serialize()` 归一化，保证状态里存的永远是原语认可的树。
 */
function normalizeGrid(raw: unknown): {ok: true; grid: GridSnapshot} | {ok: false; reason: string} {
    if (!raw || typeof raw !== "object") {
        return {ok: false, reason: "快照缺少树"};
    }
    const probe = createGrid<string>(null);
    const result = probe.restore(raw, (ref) => ref);
    return result.ok ? {ok: true, grid: probe.serialize()} : {ok: false, reason: String(result.reason ?? "树无效")};
}

export function restoreLayout(raw: unknown): {state: SpikeLayoutState; issues: string[]} {
    if (!raw || typeof raw !== "object") {
        return {state: createDefaultLayout(), issues: ["布局快照不是对象"]};
    }
    const candidate = raw as {layoutVersion?: unknown; grid?: unknown; collapsed?: unknown; activeContainer?: unknown; viewPlacements?: unknown};
    if (candidate.layoutVersion !== SPIKE_LAYOUT_VERSION) {
        return {state: createDefaultLayout(), issues: [`布局快照版本 ${String(candidate.layoutVersion)} 不受支持`]};
    }

    const issues: string[] = [];
    const fallback = createDefaultLayout();
    const grid = normalizeGrid(candidate.grid);
    if (!grid.ok) {
        issues.push(`布局快照里的树无效：${grid.reason}`);
    }
    const state: SpikeLayoutState = {
        layoutVersion: SPIKE_LAYOUT_VERSION,
        grid: grid.ok ? grid.grid : fallback.grid,
        collapsed: [],
        activeContainer: {...fallback.activeContainer},
        viewPlacements: {},
    };

    const ids = new Set(leafIds(state.grid.root));
    for (const id of Array.isArray(candidate.collapsed) ? candidate.collapsed as unknown[] : []) {
        if (typeof id === "string" && ids.has(id) && COLLAPSIBLE_LEAVES.includes(id)) {
            state.collapsed.push(id);
        } else {
            issues.push(`收起列表里的叶子不存在或不可收起：${String(id)}`);
        }
    }

    const placements = candidate.viewPlacements;
    if (placements && typeof placements === "object") {
        for (const [viewId, rawPlacement] of Object.entries(placements as Record<string, unknown>)) {
            const placement = rawPlacement as Partial<ViewPlacement> | null;
            if (!SPIKE_VIEWS.some((view) => view.id === viewId)
                || typeof placement?.containerId !== "string"
                || !SPIKE_CONTAINERS.some((container) => container.id === placement.containerId)
                || typeof placement.order !== "number"
                || !Number.isFinite(placement.order)) {
                issues.push("视图位置覆盖引用了不存在的容器/视图");
                continue;
            }
            state.viewPlacements[viewId] = {containerId: placement.containerId, order: placement.order};
        }
    }

    const active = (candidate.activeContainer ?? {}) as Record<string, unknown>;
    for (const location of SPIKE_LOCATIONS) {
        const requested = active[location];
        if (typeof requested === "string" && SPIKE_CONTAINERS.some((container) => container.id === requested && container.location === location)) {
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

/** 覆盖优先，没有覆盖时回落到 descriptor 的默认位置。 */
export function placementOf(viewId: string, state: SpikeLayoutState): ViewPlacement {
    const override = state.viewPlacements[viewId];
    if (override) {
        return override;
    }
    const view = SPIKE_VIEWS.find((item) => item.id === viewId);
    return {containerId: view?.container ?? "", order: view?.order ?? 0};
}

/** 记一条位置覆盖；未知视图原样返回（调用方按引用相等判断无变化）。 */
export function placeView(viewId: string, containerId: string, order: number, state: SpikeLayoutState): SpikeLayoutState {
    if (!SPIKE_VIEWS.some((view) => view.id === viewId)) {
        return state;
    }
    return {...state, viewPlacements: {...state.viewPlacements, [viewId]: {containerId, order}}};
}

/** 该容器当前该显示的视图：按覆盖后的 order 排序，同值按 id 稳定排序。 */
export function viewsOfContainer(containerId: string, state: SpikeLayoutState): SpikeViewDescriptor[] {
    return SPIKE_VIEWS
        .filter((view) => placementOf(view.id, state).containerId === containerId)
        .sort((left, right) => {
            const a = placementOf(left.id, state).order;
            const b = placementOf(right.id, state).order;
            if (a !== b) {
                return a - b;
            }
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });
}
