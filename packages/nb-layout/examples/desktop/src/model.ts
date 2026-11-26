/**
 * 桌面的模型：一棵 nb-layout 的网格，加四扇窗各自的状态。
 *
 * 分工：网格只管“贴边平铺”的那部分，也就是桌面叶、底栏叶和平铺进来的窗叶；浮动的窗不在树里，
 * 它们的矩形由这个模型记着、界面交给 `NestedGrid` 的 `floats`。窗在两边之间来回时，叶的 id 不变，都是窗的 id，
 * 库据此把同一个窗从浮动的位置飞进树里（或飞出来）。
 *
 * 状态：每扇窗一个模式（`Mode`），外加“最后一次浮动的矩形”`floatRect`：关闭、取消平铺、读档回来都用它。
 * 操作与模式的对应见 `DesktopLayout` 里各个方法；不能做的格子交回失败、模型不变。
 *
 * 这个文件不依赖 Vue，也不碰 DOM：操作都是同步的，界面在操作成功之后自己通知网格（`host.invalidate()`）并保存。
 * 几何函数把设备像素比当参数收：Bun 里没有 `window`。
 */
import {createGrid, placeGrid, restoreGrid} from "@notnotype/nb-layout";
import type {Grid, GridExtent, GridLayoutResult, GridLeafInput, GridNode, GridRect, GridRefResolution, GridSnapshot, LayoutFloatResize} from "@notnotype/nb-layout";

/** 分隔线的宽度（CSS px）。建树与读档都要给：它不在快照里，缺省是 0，0 的分隔线拖不动。 */
export const SASH_SIZE = 4;
export const ROOT = "root";
export const DESKTOP = "desktop";
export const DOCK = "dock";
export const DOCK_HEIGHT = 56;
/** 标题栏的高度（CSS px）：标题栏的样式与内容层的 `insetTop` 读同一个数。库不量面板头，内容层从叶的顶上往下让出这么多。 */
export const TITLE_BAR_HEIGHT = 39;
/** 桌面叶与窗（浮动的、平铺的）的最小尺寸。 */
export const WINDOW_MIN: GridExtent = {width: 240, height: 160};

export const WINDOW_IDS = ["notes", "calc", "clock", "files"] as const;
export type WindowId = (typeof WINDOW_IDS)[number];
export const TITLES: Readonly<Record<WindowId, string>> = {notes: "Notes", calc: "Calculator", clock: "Clock", files: "Files"};

export type Side = "left" | "right";
/** 窗在桌面上的几种样子；最小化之前的模式只能是这四种之一。 */
export type PlacedMode = "floating" | "maximized" | "tiled-left" | "tiled-right";
export type Mode = PlacedMode | "minimized" | "closed";
export const MODES: readonly Mode[] = ["floating", "maximized", "tiled-left", "tiled-right", "minimized", "closed"];
const PLACED_MODES: readonly PlacedMode[] = ["floating", "maximized", "tiled-left", "tiled-right"];

export const isWindowId = (value: string | undefined): value is WindowId => WINDOW_IDS.some((id) => id === value);
const sideOf = (mode: Mode): Side | null => (mode === "tiled-left" ? "left" : mode === "tiled-right" ? "right" : null);

/** `floatRect` 是最后一次浮动的矩形（相对网格根）；`before` 只在最小化时有值：回来时回到哪个模式。 */
export type WindowState = {readonly mode: Mode; readonly floatRect: GridRect; readonly before: PlacedMode | null};

/** 缺省都浮动；层叠次序同这个顺序（files 在最上）。 */
const DEFAULT_RECTS: Readonly<Record<WindowId, GridRect>> = {
    notes: {x: 40, y: 40, width: 420, height: 300},
    calc: {x: 500, y: 80, width: 320, height: 360},
    clock: {x: 860, y: 60, width: 300, height: 220},
    files: {x: 200, y: 400, width: 480, height: 300},
};

/** 操作的结果，与库的失败同一个形状：`code` 给程序分支，`message` 给人看。 */
export type Failure = {readonly ok: false; readonly code: string; readonly message: string};
export type Result = {readonly ok: true} | Failure;
const OK: Result = {ok: true};
const failure = (code: string, message: string): Failure => ({ok: false, code, message});

/**
 * 每个 ref 的运行期策略只有这一个出处。快照只存结构与尺寸意图，保留像素、最小尺寸都不在里面：
 * 建树、平铺进新叶、读档，三处都从这里取，所以载入前后同一块叶的约束相同（复制用 `grid.clone()`，策略跟着树走）。
 * 漏给的话叶会变成没有最小尺寸，而且库不会报任何诊断。
 */
function policyFor(ref: string): Omit<GridRefResolution<string>, "ref"> {
    if (ref === DOCK) return {sizing: "fixed", minimumSize: {width: 0, height: DOCK_HEIGHT}};
    return {minimumSize: WINDOW_MIN};
}

const windowLeaf = (id: WindowId): GridLeafInput<string> => ({kind: "leaf", id, ref: id, ...policyFor(id)});
const isKnownRef = (ref: string): boolean => ref === DESKTOP || ref === DOCK || isWindowId(ref);

/** 树序的全部节点。 */
function* walk(node: GridNode<string> | null): Generator<GridNode<string>> {
    if (node === null) return;
    yield node;
    if (node.kind === "branch") for (const child of node.children) yield* walk(child);
}

function parentOf(root: GridNode<string> | null, id: string): Extract<GridNode<string>, {kind: "branch"}> | null {
    for (const node of walk(root)) if (node.kind === "branch" && node.children.some((child) => child.id === id)) return node;
    return null;
}

/**
 * 某块叶相对网格根的矩形，按给的树与布局摆一遍。只给试平铺的副本用：副本不在网格上画，没有 `NestedGrid` 的 `leafRect` 可读，只能自己摆。
 * `dpr` 要与 NestedGrid 用的一致，取整才相同。
 */
export function leafRect(root: GridNode<string> | null, layout: GridLayoutResult, extent: GridExtent, dpr: number, id: string): GridRect | null {
    if (root === null) return null;
    for (const item of placeGrid(root, layout, extent, dpr).items) if (item.kind === "leaf" && item.node.id === id) return item.rect;
    return null;
}

/** 按边取整，不是 x 与宽度各取各的：后者会让右缘差一个像素。 */
export function roundRect(rect: GridRect): GridRect {
    const left = Math.round(rect.x);
    const top = Math.round(rect.y);
    return {x: left, y: top, width: Math.round(rect.x + rect.width) - left, height: Math.round(rect.y + rect.height) - top};
}

const overConstrained = (layout: DesktopLayout, extent: GridExtent): boolean => layout.grid.layout(extent).issues.some((issue) => issue.code === "over-constrained");

/** 试平铺的结果：`result` 是做不做得成，`area` 是新叶的矩形（相对网格根；树操作被拒时没有）。 */
export type TilePreview = {readonly result: Result; readonly area: GridRect | null};

export class DesktopLayout {
    readonly grid: Grid<string>;
    /** 窗 id 到它的状态。值整个替换，不原地改，界面按引用就能看出谁变了。 */
    readonly windows: Map<WindowId, WindowState>;
    /** 层叠次序，从下到上，四个 id 的一个排列。平铺、最小化的窗也在里面：回到浮动时还在它原来的层上。 */
    private order: WindowId[];

    private constructor(grid: Grid<string>, windows: Map<WindowId, WindowState>, order: WindowId[]) {
        this.grid = grid;
        this.windows = windows;
        this.order = order;
    }

    /** 缺省布局：桌面加底栏，四扇窗都浮动。 */
    static createDefault(): DesktopLayout {
        const grid = createGrid<string>({
            kind: "branch",
            id: ROOT,
            orientation: "vertical",
            children: [
                // 按比例分的叶的 size 是兄弟之间的份额；保留像素的叶的 size 是像素。
                {kind: "leaf", id: DESKTOP, ref: DESKTOP, size: {width: 0, height: 1}, ...policyFor(DESKTOP)},
                {kind: "leaf", id: DOCK, ref: DOCK, size: {width: 0, height: DOCK_HEIGHT}, ...policyFor(DOCK)},
            ],
        }, {sashSize: SASH_SIZE});
        const windows = new Map(WINDOW_IDS.map((id) => [id, {mode: "floating" as const, floatRect: DEFAULT_RECTS[id], before: null}]));
        return new DesktopLayout(grid, windows, [...WINDOW_IDS]);
    }

    mode(id: WindowId): Mode {
        return this.windows.get(id)!.mode;
    }

    /** 画成浮动窗的那些（浮动与最大化的），从下到上：就是交给 `NestedGrid` 的 `floats` 的次序。 */
    floating(): WindowId[] {
        return this.order.filter((id) => this.mode(id) === "floating" || this.mode(id) === "maximized");
    }

    tiledOn(side: Side): WindowId | undefined {
        return WINDOW_IDS.find((id) => sideOf(this.mode(id)) === side);
    }

    /** 层叠次序的副本，从下到上。 */
    stack(): WindowId[] {
        return [...this.order];
    }

    /** 拖动标题栏移动：只有浮动的（没最大化的）窗能动。只写 `x`、`y`，宽高不动：画着的宽高可能是夹过的（窗比桌面大），写回去视口变大后也回不来。 */
    move(id: WindowId, x: number, y: number): Result {
        if (this.mode(id) !== "floating") return this.wrongMode(id, "be moved");
        const state = this.windows.get(id)!;
        this.windows.set(id, {...state, floatRect: {...state.floatRect, x, y}});
        return OK;
    }

    /**
     * 缩放的结果（手柄已按桌面夹过、调用方取了整）。只写这次动了的那一轴（`direction` 不为 0）：手柄从画着的矩形算起，
     * 窗被夹着时没动的那一轴是夹过的值，写回去视口变大后也回不来。宽高再夹到最小尺寸以上：桌面叶比最小尺寸还小时（视口很矮），
     * 手柄给的会小于它，而读档拒收小于最小尺寸的矩形，写进去就是下次载入读不了的存档。画的时候仍会被夹进桌面。
     */
    resize(id: WindowId, rect: GridRect, direction: LayoutFloatResize): Result {
        if (this.mode(id) !== "floating") return this.wrongMode(id, "be resized");
        const record = this.windows.get(id)!.floatRect;
        const [x, width] = direction.width === 0 ? [record.x, record.width] : [rect.x, rect.width];
        const [y, height] = direction.height === 0 ? [record.y, record.height] : [rect.y, rect.height];
        const floatRect = {x, y, width: Math.max(width, WINDOW_MIN.width), height: Math.max(height, WINDOW_MIN.height)};
        this.windows.set(id, {...this.windows.get(id)!, floatRect});
        return OK;
    }

    /** 挪到最上面。 */
    raise(id: WindowId): Result {
        const mode = this.mode(id);
        if (mode !== "floating" && mode !== "maximized") return this.wrongMode(id, "be raised");
        this.toTop(id);
        return OK;
    }

    toggleMaximize(id: WindowId): Result {
        const mode = this.mode(id);
        if (mode !== "floating" && mode !== "maximized") return this.wrongMode(id, "be maximized");
        this.windows.set(id, {...this.windows.get(id)!, mode: mode === "floating" ? "maximized" : "floating"});
        return OK;
    }

    /** 最小化：内容留着（界面里 `active: false` 停放），记着来自哪个模式。平铺的先出树。 */
    minimize(id: WindowId): Result {
        const mode = this.mode(id);
        if (mode === "minimized" || mode === "closed") return this.wrongMode(id, "be minimized");
        const left = this.leaveTree(id);
        if (!left.ok) return left;
        this.windows.set(id, {...this.windows.get(id)!, mode: "minimized", before: mode});
        return OK;
    }

    /** 关闭：窗从内容层拿掉，打的字没了；`floatRect` 留着，重新打开时用。 */
    close(id: WindowId): Result {
        const mode = this.mode(id);
        if (mode === "minimized" || mode === "closed") return this.wrongMode(id, "be closed");
        const left = this.leaveTree(id);
        if (!left.ok) return left;
        this.windows.set(id, {...this.windows.get(id)!, mode: "closed", before: null});
        return OK;
    }

    /** 取消平铺：出树，浮动在 `floatRect`，在最上面。 */
    untile(id: WindowId): Result {
        if (sideOf(this.mode(id)) === null) return this.wrongMode(id, "be untiled");
        const left = this.leaveTree(id);
        if (!left.ok) return left;
        this.windows.set(id, {...this.windows.get(id)!, mode: "floating"});
        this.toTop(id);
        return OK;
    }

    /**
     * 点底栏上这扇窗的按钮。浮动的挪到最上；平铺的什么都不改（界面把焦点给它的正文）；
     * 最小化的回到来时的模式，来自平铺而那一侧已被占了就浮动在 `floatRect`；关闭的重新打开，浮动在 `floatRect`。
     * 回到平铺要先试一遍放得下放不下：放不下时同样浮动在 `floatRect`，不留在最小化里：
     * 最小化是用户主动收起的，卡在里面、只能等别处腾出地方，比降级成浮动更糟。
     */
    dockClick(id: WindowId, extent: GridExtent): Result {
        const state = this.windows.get(id)!;
        if (state.mode === "floating" || state.mode === "maximized") {
            this.toTop(id);
            return OK;
        }
        if (state.mode === "closed") {
            this.windows.set(id, {...state, mode: "floating"});
            this.toTop(id);
            return OK;
        }
        if (state.mode !== "minimized") return OK;
        const before = state.before!;
        const side = sideOf(before);
        // 来自平铺的窗，那一侧被占了或此刻平铺不下（先在复制的树上试），都浮动在 `floatRect`。
        const tileable = side !== null && this.tiledOn(side) === undefined && this.previewTile(id, side, extent, 1).result.ok;
        if (side === null || !tileable) {
            this.windows.set(id, {...state, mode: side === null ? before : "floating", before: null});
            this.toTop(id);
            return OK;
        }
        return this.applyTile(id, side);
    }

    /** 一扇浮动窗贴到桌面的一侧：这一侧已有平铺窗时换下它，被换下的浮动在自己的 `floatRect`、在最上面。 */
    tile(id: WindowId, side: Side, extent: GridExtent): Result {
        if (this.mode(id) !== "floating") return this.wrongMode(id, "be tiled");
        const preview = this.previewTile(id, side, extent, 1);
        return preview.result.ok ? this.applyTile(id, side) : preview.result;
    }

    canTile(id: WindowId, side: Side, extent: GridExtent): Result {
        return this.mode(id) === "floating" ? this.previewTile(id, side, extent, 1).result : this.wrongMode(id, "be tiled");
    }

    /**
     * 在复制的树上照平铺的步骤做一遍：库拆或加到放不下时不拒绝，只按约束压缩并在布局结果里报 `over-constrained`，
     * 想在落点上就告诉用户，只能试一次再看布局。原来就放不下（窗口太窄）的不算这次平铺的错。
     * 新叶的矩形也在这里取：它就是落点反馈要画的区域（第二扇时三块平分，不是“半屏”）。
     */
    previewTile(id: WindowId, side: Side, extent: GridExtent, dpr: number): TilePreview {
        const trial = this.clone();
        const done = trial.applyTile(id, side);
        if (!done.ok) return {result: done.code === "limit-exceeded" ? failure("limit-exceeded", "Too deeply nested") : done, area: null};
        const area = leafRect(trial.grid.root(), trial.grid.layout(extent), extent, dpr, id);
        const blocked = overConstrained(trial, extent) && !overConstrained(this, extent);
        return {result: blocked ? failure("no-room", "Not enough room") : OK, area};
    }

    /** 复制一份：网格连同策略（保留像素、最小尺寸）与分隔线宽度一起复制。 */
    clone(): DesktopLayout {
        return new DesktopLayout(this.grid.clone(), new Map(this.windows), [...this.order]);
    }

    /**
     * 平铺的树操作：在桌面叶的那一侧拆出窗叶。桌面叶的父已经是横向的一排时，`splitLeaf` 把窗并进这一排，否则包一层新的横向分支；
     * `ratio: "even"` 让窗与这一排的兄弟平分（第二扇时三块平分，不是把桌面对半）。
     * 这一侧已有平铺窗时先拆出新的、再删旧的：先做会被拒的那一步，成功了才删旧的、才改窗的模式；被拒时树与模式都没动。
     */
    private applyTile(id: WindowId, side: Side): Result {
        const occupant = this.tiledOn(side);
        const placed = this.grid.splitLeaf(DESKTOP, {branchId: this.nextBranchId(), orientation: "horizontal", side: side === "left" ? "before" : "after", leaf: windowLeaf(id), ratio: "even"});
        if (!placed.ok) return placed;
        if (occupant !== undefined) {
            const removed = this.grid.removeLeaf(occupant);
            // 叶在树里，删它不会被拒：做不到是模型与树对不上了。
            if (!removed.ok) throw new Error(`Removing the tiled window failed: ${removed.message}`);
            this.windows.set(occupant, {...this.windows.get(occupant)!, mode: "floating"});
            this.toTop(occupant);
        }
        this.windows.set(id, {...this.windows.get(id)!, mode: side === "left" ? "tiled-left" : "tiled-right", before: null});
        return OK;
    }

    /** 平铺的窗离开树；不在树里的窗什么都不用做。 */
    private leaveTree(id: WindowId): Result {
        if (sideOf(this.mode(id)) === null) return OK;
        return this.grid.removeLeaf(id);
    }

    private toTop(id: WindowId): void {
        this.order = [...this.order.filter((each) => each !== id), id];
    }

    private wrongMode(id: WindowId, action: string): Failure {
        return failure("wrong-mode", `A window that is ${this.mode(id)} cannot ${action}`);
    }

    /**
     * 新分支的 id 取现有同类 id 的最大序号加一，每次现算。用模块里的计数器的话，重新载入后它从头数，
     * 第一次平铺就和存档里的 id 撞上，库回 `duplicate-id`。
     */
    private nextBranchId(): string {
        let max = 0;
        for (const node of walk(this.grid.root())) {
            const match = /^tile-(\d+)$/u.exec(node.id);
            if (match !== null) max = Math.max(max, Number(match[1]));
        }
        return `tile-${max + 1}`;
    }

    toSaved(): SavedLayout {
        return {version: 1, grid: this.grid.serialize(), windows: Object.fromEntries(this.windows) as Record<WindowId, WindowState>, order: [...this.order]};
    }

    /** 读档：形状、快照、树的锚点、模式与树是否一致，全部通过才交回；任何一项不对就是存档坏了，交回原因，不悄悄修。 */
    static fromSaved(raw: unknown): {readonly ok: true; readonly layout: DesktopLayout} | Failure {
        if (!isSavedShape(raw)) return failure("bad-shape", "Unrecognised save format");
        // 不认识的 ref 交回 null：库把它报进 dropped。这里把 dropped 非空也当坏：丢了一块，用户的窗就跟着丢了。
        const restored = restoreGrid<string>(raw.grid, (ref) => (isKnownRef(ref) ? {ref, ...policyFor(ref)} : null), {sashSize: SASH_SIZE});
        if (!restored.ok) return failure("bad-grid", restored.message);
        if (restored.dropped.length > 0) return failure("bad-grid", "The saved layout refers to unknown panes");
        const grid = restored.grid;
        // 窗状态只取认识的字段重建：存档里多出来的字段不收，也就不会在下次保存时写回。
        const windows = new Map(WINDOW_IDS.map((id) => {
            const {mode, floatRect, before} = raw.windows[id];
            return [id, {mode, floatRect: {x: floatRect.x, y: floatRect.y, width: floatRect.width, height: floatRect.height}, before}] as const;
        }));
        const checked = checkTree(grid, windows);
        if (!checked.ok) return checked;
        return {ok: true, layout: new DesktopLayout(grid, windows, [...raw.order])};
    }
}

/**
 * 树的锚点，以及模式与树是否对得上。逐条：
 * - 叶的 id 与 ref 相同；`desktop`、`dock` 各正好一块；底栏的高度等于 `DOCK_HEIGHT`；
 * - 根是竖向、`dock` 是它的最后一个孩子；除这两块以外的叶都是平铺的窗，且都是桌面叶所在那个横向分支的直接孩子；
 * - 模式是平铺的窗正好就是这些叶；`tiled-left` 的在桌面叶左边、`tiled-right` 的在右边；同一侧不超过一扇。
 */
function checkTree(grid: Grid<string>, windows: ReadonlyMap<WindowId, WindowState>): Result {
    const root = grid.root();
    const leaves = [...walk(root)].filter((node) => node.kind === "leaf");
    if (leaves.some((leaf) => leaf.id !== leaf.ref)) return failure("bad-grid", "Leaf ids and refs differ");
    if (leaves.filter((leaf) => leaf.id === DESKTOP).length !== 1 || leaves.filter((leaf) => leaf.id === DOCK).length !== 1) return failure("bad-grid", "The desktop or the dock is missing or duplicated");
    // 底栏的高度是锚点的一部分：它的分隔线被禁用，存档里的坏值在界面上没有办法改回来；示例改了 `DOCK_HEIGHT` 之后，老存档里的旧高度也要判坏。
    if (grid.find(DOCK)?.size.height !== DOCK_HEIGHT) return failure("bad-grid", "The dock has an unexpected height");
    if (root?.kind !== "branch" || root.orientation !== "vertical" || root.children.at(-1)?.id !== DOCK) return failure("bad-grid", "The dock is not the last row");
    const row = parentOf(root, DESKTOP)!;
    const tiledLeaves = leaves.filter((leaf) => leaf.id !== DESKTOP && leaf.id !== DOCK).map((leaf) => leaf.id);
    if (tiledLeaves.length === 0) {
        if (row !== root || root.children.length !== 2) return failure("bad-grid", "The desktop is not directly above the dock");
    } else if (row.orientation !== "horizontal" || row !== root.children[0] || root.children.length !== 2 || tiledLeaves.some((id) => !row.children.some((child) => child.id === id))) {
        return failure("bad-grid", "The tiled windows are not beside the desktop");
    }
    const modes = WINDOW_IDS.flatMap((id) => (sideOf(windows.get(id)!.mode) === null ? [] : [id]));
    if (modes.length !== tiledLeaves.length || modes.some((id) => !tiledLeaves.includes(id))) return failure("bad-modes", "The tiled windows and the tree do not match");
    const deskIndex = row.children.findIndex((child) => child.id === DESKTOP);
    for (const side of ["left", "right"] as const) {
        const onSide = modes.filter((id) => sideOf(windows.get(id)!.mode) === side);
        if (onSide.length > 1) return failure("bad-modes", `Two windows are tiled on the ${side}`);
        for (const id of onSide) {
            const index = row.children.findIndex((child) => child.id === id);
            if (side === "left" ? index >= deskIndex : index <= deskIndex) return failure("bad-modes", `A window tiled on the ${side} is on the other side of the desktop`);
        }
    }
    return OK;
}

export type SavedLayout = {
    readonly version: 1;
    readonly grid: GridSnapshot;
    readonly windows: Readonly<Record<WindowId, WindowState>>;
    readonly order: readonly WindowId[];
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isSavedRect(value: unknown): value is GridRect {
    const rect = value as Record<string, unknown> | null;
    return typeof rect === "object" && rect !== null && finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height) && rect.width >= WINDOW_MIN.width && rect.height >= WINDOW_MIN.height;
}

/** 存档的形状：窗正好四扇、id 都认识；模式是六个取值之一；层叠次序是四个 id 的一个排列；矩形是有限数、宽高不小于最小尺寸。 */
function isSavedShape(value: unknown): value is SavedLayout {
    if (typeof value !== "object" || value === null) return false;
    const saved = value as Record<string, unknown>;
    if (saved.version !== 1 || typeof saved.windows !== "object" || saved.windows === null || !Array.isArray(saved.order)) return false;
    const windows = saved.windows as Record<string, unknown>;
    const keys = Object.keys(windows);
    if (keys.length !== WINDOW_IDS.length || !WINDOW_IDS.every((id) => keys.includes(id))) return false;
    const order = saved.order as unknown[];
    if (order.length !== WINDOW_IDS.length || !WINDOW_IDS.every((id) => order.includes(id))) return false;
    return WINDOW_IDS.every((id) => {
        const state = windows[id] as Record<string, unknown> | null;
        if (typeof state !== "object" || state === null || !isSavedRect(state.floatRect)) return false;
        if (!MODES.some((mode) => mode === state.mode)) return false;
        // 最小化的窗要记着回哪个模式，别的模式不带。
        return state.mode === "minimized" ? PLACED_MODES.some((mode) => mode === state.before) : state.before === null;
    });
}

/** 存档用到的那两个方法：浏览器里是 `localStorage`，测试里可以换成内存里的一份。 */
export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export const STORAGE_KEY = "nb-layout-example:desktop";
/** 读不了的存档原样搬到这里，不拿缺省布局覆盖它：等程序修好了还能再读。 */
export const BACKUP_KEY = `${STORAGE_KEY}:backup`;

/**
 * 读档的结果。`keep` 为假时这一页不要再保存：存档读不了、备份也写不进去，原件只剩主键那一份，
 * 再存就拿缺省布局把它覆盖了。
 */
export type Loaded = {readonly layout: DesktopLayout; readonly notice: string | null; readonly keep: boolean};

/** 读档。没有存档时用缺省布局；存档坏了也用缺省布局，原件留在备份键里，`notice` 告诉用户。 */
export function loadLayout(storage: LayoutStorage | null): Loaded {
    if (storage === null) return {layout: DesktopLayout.createDefault(), notice: "Storage is unavailable; changes will not be kept", keep: false};
    let raw: string | null;
    try {
        raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
        console.warn("Reading the saved layout failed", error);
        return {layout: DesktopLayout.createDefault(), notice: "Storage is unavailable; changes will not be kept", keep: false};
    }
    if (raw === null) return {layout: DesktopLayout.createDefault(), notice: null, keep: true};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.warn("Parsing the saved layout failed", error);
        return keepOriginal(storage, raw, "The saved layout is not valid JSON");
    }
    const loaded = DesktopLayout.fromSaved(parsed);
    return loaded.ok ? {layout: loaded.layout, notice: null, keep: true} : keepOriginal(storage, raw, loaded.message);
}

function keepOriginal(storage: LayoutStorage, raw: string, reason: string): Loaded {
    try {
        storage.setItem(BACKUP_KEY, raw);
    } catch (error) {
        console.warn("Backing up the unreadable layout failed", error);
        return {layout: DesktopLayout.createDefault(), notice: `${reason}; the default layout is used and changes will not be kept, so the original stays untouched`, keep: false};
    }
    return {layout: DesktopLayout.createDefault(), notice: `${reason}; the default layout is used and the original is kept as a backup`, keep: true};
}

/** 保存。存储满了、被浏览器禁用时交回原因，界面显示出来；布局照常用。 */
export function saveLayout(storage: LayoutStorage | null, layout: DesktopLayout): string | null {
    if (storage === null) return null;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(layout.toSaved()));
        return null;
    } catch (error) {
        console.warn("Saving the layout failed", error);
        return "Saving the layout failed";
    }
}
