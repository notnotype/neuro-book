/**
 * 标签编组的模型：一棵 nb-layout 的网格，加一张“编组里有哪些标签、选中哪个”的表。
 *
 * 分工：网格只管矩形（哪块叶在哪、多大），它不知道标签；标签归这张表。两者用叶的 id 对上：
 * 每个编组是网格里的一块叶，叶的 id 与它的 `ref` 都是编组 id；侧栏那块叶的 id 与 `ref` 都是 `"explorer"`。
 * 这条约定让存档、试拆、读档都只需要一个“按 ref 给策略”的函数。
 *
 * 这个文件不依赖 Vue，也不碰 DOM：操作都是同步的，界面在操作成功之后自己通知网格（`host.invalidate()`）并保存。
 */
import {createGrid, restoreGrid} from "@notnotype/nb-layout";
import type {Grid, GridExtent, GridLeafInput, GridNode, GridRefResolution, GridSnapshot} from "@notnotype/nb-layout";

/** 分隔线的宽度（CSS px）。建树与读档都要给：它不在快照里，缺省是 0，0 的分隔线拖不动。 */
export const SASH_SIZE = 4;
export const EXPLORER = "explorer";

/** 编组的最小尺寸：标签条放得下两个标签的宽、标签条加几行正文的高。 */
const GROUP_MINIMUM = {width: 160, height: 120};

export type Group = {readonly tabs: readonly string[]; readonly active: string};
export type Side = "left" | "right" | "top" | "bottom";
/** 操作的结果，与库的失败同一个形状：`code` 给程序分支，`message` 给人看。 */
export type Failure = {readonly ok: false; readonly code: string; readonly message: string};
export type Result = {readonly ok: true} | Failure;

/** 侧栏收起的记录：收起状态不在网格快照里，要宿主另存。展开回到快照里的宽度意图，所以不用另存收起前的宽度。 */
type ExplorerState = {readonly collapsed: boolean};

/**
 * 每个 ref 的运行期策略只有这一个出处。快照只存结构与尺寸意图，保留像素、最小尺寸、收起策略都不在里面：
 * 建树、拆分出新编组、读档，三处都从这里取，所以载入前后同一块叶的约束相同（复制用 `grid.clone()`，策略跟着树走）。
 * 漏给的话叶会变成按比例分、没有最小尺寸，而且库不会报任何诊断。
 */
function policyFor(ref: string, explorer: ExplorerState): Omit<GridRefResolution<string>, "ref"> {
    if (ref === EXPLORER) {
        return {
            sizing: "fixed",
            minimumSize: {width: 160, height: 0},
            collapse: {collapsed: explorer.collapsed, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24},
        };
    }
    return {minimumSize: GROUP_MINIMUM};
}

function groupLeaf(id: string): GridLeafInput<string> {
    return {kind: "leaf", id, ref: id, ...policyFor(id, {collapsed: false})};
}

/** 树序的全部节点。 */
function* walk(node: GridNode<string> | null): Generator<GridNode<string>> {
    if (node === null) return;
    yield node;
    if (node.kind === "branch") for (const child of node.children) yield* walk(child);
}

const SPLIT_SHAPE: Readonly<Record<Side, {orientation: "horizontal" | "vertical"; side: "before" | "after"}>> = {
    left: {orientation: "horizontal", side: "before"},
    right: {orientation: "horizontal", side: "after"},
    top: {orientation: "vertical", side: "before"},
    bottom: {orientation: "vertical", side: "after"},
};

const failure = (code: string, message: string): Failure => ({ok: false, code, message});

export class TabbedLayout {
    readonly grid: Grid<string>;
    /** 编组 id 到它的标签。值整个替换，不原地改，界面按引用就能看出谁变了。 */
    readonly groups: Map<string, Group>;

    private constructor(grid: Grid<string>, groups: Map<string, Group>) {
        this.grid = grid;
        this.groups = groups;
    }

    /** 缺省布局：侧栏保留 240 像素、可以收起，右边三个编组等分。 */
    static createDefault(): TabbedLayout {
        const groups = new Map<string, Group>([
            ["group-1", {tabs: ["README.md", "main.ts", "App.vue", "model.ts"], active: "README.md"}],
            ["group-2", {tabs: ["notes.txt", "todo.txt"], active: "notes.txt"}],
            ["group-3", {tabs: ["styles.css", "index.html"], active: "styles.css"}],
        ]);
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                // 保留像素的叶的 size 是像素；按比例分的叶的 size 是兄弟之间的份额，三个都给 1 就是等分。
                {kind: "leaf", id: EXPLORER, ref: EXPLORER, size: {width: 240, height: 0}, ...policyFor(EXPLORER, {collapsed: false})},
                ...[...groups.keys()].map((id) => ({...groupLeaf(id), size: {width: 1, height: 0}})),
            ],
        }, {sashSize: SASH_SIZE});
        return new TabbedLayout(grid, groups);
    }

    /** 编组 id，按树序（读屏与 F6 的顺序也是它）。 */
    groupIds(): string[] {
        return [...walk(this.grid.root())].filter((node) => node.kind === "leaf" && node.id !== EXPLORER).map((node) => node.id);
    }

    groupOf(tab: string): string | undefined {
        for (const [id, group] of this.groups) if (group.tabs.includes(tab)) return id;
        return undefined;
    }

    explorerState(): ExplorerState {
        const collapse = this.grid.find(EXPLORER)?.collapse;
        return {collapsed: collapse?.collapsed === true};
    }

    activate(tab: string): Result {
        const id = this.groupOf(tab);
        if (id === undefined) return failure("unknown-tab", `No tab ${tab}`);
        this.groups.set(id, {...this.groups.get(id)!, active: tab});
        return {ok: true};
    }

    /** 最后一个编组的最后一个标签不能关：只剩侧栏时它会被拉满整个宽度，存档之后就回不到有编组的样子。 */
    canClose(tab: string): boolean {
        const id = this.groupOf(tab);
        return id !== undefined && !(this.groups.size === 1 && this.groups.get(id)!.tabs.length === 1);
    }

    closeTab(tab: string): Result {
        if (this.groupOf(tab) === undefined) return failure("unknown-tab", `No tab ${tab}`);
        if (!this.canClose(tab)) return failure("last-tab", "The last tab cannot be closed");
        this.takeOut(tab);
        return {ok: true};
    }

    /**
     * 把标签挪进一个编组，插在 `before` 前面（`null` 是排到最后），并成为那里的选中。同一个编组里就是换位置。
     * 不改树的结构，只有来源编组空了才删它的叶；删叶不会被拒（叶总在树里），所以这一步不会做到一半。
     */
    moveTab(tab: string, to: string, before: string | null): Result {
        const from = this.groupOf(tab);
        if (from === undefined) return failure("unknown-tab", `No tab ${tab}`);
        if (!this.groups.has(to)) return failure("unknown-group", `No group ${to}`);
        const target = this.groups.get(to)!;
        const rest = target.tabs.filter((each) => each !== tab);
        const at = before === null ? rest.length : rest.indexOf(before);
        // 插入位不在目标编组里（或就是自己）时不悄悄退成“排到最后”：那是另一个动作，界面显示的不是它。
        if (at < 0) return failure("bad-position", `No tab ${before} in ${to}`);
        if (from !== to) this.takeOut(tab);
        rest.splice(at, 0, tab);
        this.groups.set(to, {tabs: rest, active: tab});
        return {ok: true};
    }

    /**
     * 拆出一个新编组放这个标签，在目标编组的 `side` 那一边。
     * 先做会被拒的那一步：先 `splitLeaf`（深度、节点数超限时库会拒绝），成功了才挪标签、删空了的来源叶。
     * 反过来先删来源再拆，拆分被拒时标签就丢了。
     */
    splitWithTab(tab: string, target: string, side: Side): Result {
        const from = this.groupOf(tab);
        if (from === undefined) return failure("unknown-tab", `No tab ${tab}`);
        if (!this.groups.has(target)) return failure("unknown-group", `No group ${target}`);
        if (from === target && this.groups.get(from)!.tabs.length === 1) return failure("self", "A group cannot be split by its only tab");
        const id = this.nextId("group");
        const {orientation, side: splitSide} = SPLIT_SHAPE[side];
        const split = this.grid.splitLeaf(target, {branchId: this.nextId("split"), orientation, side: splitSide, leaf: groupLeaf(id)});
        if (!split.ok) return split;
        this.takeOut(tab);
        this.groups.set(id, {tabs: [tab], active: tab});
        return {ok: true};
    }

    /**
     * 这次拆分做不做得成。库拆到放不下时不拒绝，只按约束压缩、在布局结果里报 `over-constrained`；
     * 想在落点上就告诉用户，只能在一棵复制的树上照做一遍再看布局。原来就放不下（窗口太窄）的不算这次拆分的错。
     */
    canSplit(tab: string, target: string, side: Side, extent: GridExtent): Result {
        const trial = this.clone();
        const done = trial.splitWithTab(tab, target, side);
        if (!done.ok) return done.code === "limit-exceeded" ? failure("limit-exceeded", "Too deeply nested") : done;
        const overConstrained = (layout: TabbedLayout) => layout.grid.layout(extent).issues.some((issue) => issue.code === "over-constrained");
        if (overConstrained(trial) && !overConstrained(this)) return failure("no-room", "Not enough room");
        return {ok: true};
    }

    /** 复制一份：网格连同策略（保留像素、最小尺寸、收起状态）与分隔线宽度一起复制。 */
    clone(): TabbedLayout {
        return new TabbedLayout(this.grid.clone(), new Map(this.groups));
    }

    toSaved(): SavedLayout {
        return {version: 1, grid: this.grid.serialize(), groups: Object.fromEntries(this.groups), explorer: this.explorerState()};
    }

    /** 读档：形状、快照、快照与编组表对不对得上，全部通过才交回；任何一项不对就是存档坏了，交回原因。 */
    static fromSaved(raw: unknown): {readonly ok: true; readonly layout: TabbedLayout} | Failure {
        if (!isSavedShape(raw)) return failure("bad-shape", "Unrecognised save format");
        const groups = new Map(Object.entries(raw.groups).map(([id, group]) => [id, {tabs: [...group.tabs], active: group.active}]));
        // 不认识的 ref 交回 null：库把它报进 dropped。这里把 dropped 非空也当坏：丢了一块，用户的标签就跟着丢了。
        const restored = restoreGrid<string>(raw.grid, (ref) => (ref === EXPLORER || groups.has(ref) ? {ref, ...policyFor(ref, raw.explorer)} : null), {sashSize: SASH_SIZE});
        if (!restored.ok) return failure("bad-grid", restored.message);
        if (restored.dropped.length > 0) return failure("bad-grid", "The saved layout refers to unknown panes");
        const grid = restored.grid;
        const leaves = [...walk(grid.root())].filter((node) => node.kind === "leaf");
        if (leaves.some((leaf) => leaf.id !== leaf.ref)) return failure("bad-grid", "Leaf ids and refs differ");
        if (leaves.filter((leaf) => leaf.id === EXPLORER).length !== 1) return failure("bad-grid", "The explorer is missing or duplicated");
        // 侧栏是最外层横向那一排的一块：在别处时它的保留像素会变成高度，收起按钮也收错了方向。
        const root = grid.root();
        if (root?.kind !== "branch" || root.orientation !== "horizontal" || !root.children.some((child) => child.id === EXPLORER)) return failure("bad-grid", "The explorer is not in the outer row");
        const groupLeaves = leaves.filter((leaf) => leaf.id !== EXPLORER).map((leaf) => leaf.id);
        if (groupLeaves.length === 0) return failure("bad-grid", "No tab groups");
        if (groupLeaves.length !== groups.size || groupLeaves.some((id) => !groups.has(id))) return failure("bad-groups", "Groups and panes do not match");
        const seen = new Set<string>();
        for (const group of groups.values()) {
            if (group.tabs.length === 0 || !group.tabs.includes(group.active)) return failure("bad-groups", "A group has no tabs or a missing active tab");
            for (const tab of group.tabs) {
                if (seen.has(tab)) return failure("bad-groups", `Tab ${tab} is in two groups`);
                seen.add(tab);
            }
        }
        return {ok: true, layout: new TabbedLayout(grid, groups)};
    }

    /** 拿掉一个标签；编组空了连叶一起删。选中的被拿走时选它右边的，没有就选左边的。 */
    private takeOut(tab: string): void {
        const id = this.groupOf(tab)!;
        const group = this.groups.get(id)!;
        const index = group.tabs.indexOf(tab);
        const tabs = group.tabs.filter((each) => each !== tab);
        if (tabs.length === 0) {
            this.grid.removeLeaf(id);
            this.groups.delete(id);
            return;
        }
        const active = group.active === tab ? tabs[Math.min(index, tabs.length - 1)]! : group.active;
        this.groups.set(id, {tabs, active});
    }

    /**
     * 新 id 取现有同类 id 的最大序号加一，每次现算。用模块里的计数器的话，重新载入后它从头数，
     * 第一次拆分就和存档里的 id 撞上，库回 `duplicate-id`。
     */
    private nextId(prefix: "group" | "split"): string {
        const pattern = new RegExp(`^${prefix}-(\\d+)$`, "u");
        let max = 0;
        for (const node of walk(this.grid.root())) {
            const match = pattern.exec(node.id);
            if (match !== null) max = Math.max(max, Number(match[1]));
        }
        return `${prefix}-${max + 1}`;
    }
}

export type SavedLayout = {
    readonly version: 1;
    readonly grid: GridSnapshot;
    readonly groups: Readonly<Record<string, Group>>;
    readonly explorer: ExplorerState;
};

function isSavedShape(value: unknown): value is SavedLayout {
    if (typeof value !== "object" || value === null) return false;
    const saved = value as Record<string, unknown>;
    if (saved.version !== 1 || typeof saved.groups !== "object" || saved.groups === null) return false;
    const explorer = saved.explorer as Record<string, unknown> | null | undefined;
    // 以前的存档在这里还带着收起前的宽度 `restoreSize`；现在展开回到快照里的宽度意图，读档时不看它，也不因为它拒绝。
    if (typeof explorer?.collapsed !== "boolean") return false;
    return Object.values(saved.groups).every((group: unknown) => {
        const each = group as Record<string, unknown> | null;
        return Array.isArray(each?.tabs) && each.tabs.every((tab) => typeof tab === "string") && typeof each.active === "string";
    });
}

/** 存档用到的那两个方法：浏览器里是 `localStorage`，测试里可以换成内存里的一份。 */
export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export const STORAGE_KEY = "nb-layout-example:tabbed-panels";
/** 读不了的存档原样搬到这里，不拿缺省布局覆盖它：等程序修好了还能再读。 */
export const BACKUP_KEY = `${STORAGE_KEY}:backup`;

/**
 * 读档的结果。`keep` 为假时这一页不要再保存：存档读不了、备份也写不进去，原件只剩主键那一份，
 * 再存就拿缺省布局把它覆盖了。
 */
export type Loaded = {readonly layout: TabbedLayout; readonly notice: string | null; readonly keep: boolean};

/** 读档。没有存档时用缺省布局；存档坏了也用缺省布局，原件留在备份键里，`notice` 告诉用户。 */
export function loadLayout(storage: LayoutStorage | null): Loaded {
    if (storage === null) return {layout: TabbedLayout.createDefault(), notice: "Storage is unavailable; changes will not be kept", keep: false};
    let raw: string | null;
    try {
        raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
        console.warn("Reading the saved layout failed", error);
        return {layout: TabbedLayout.createDefault(), notice: "Storage is unavailable; changes will not be kept", keep: false};
    }
    if (raw === null) return {layout: TabbedLayout.createDefault(), notice: null, keep: true};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return keepOriginal(storage, raw, "The saved layout is not valid JSON");
    }
    const loaded = TabbedLayout.fromSaved(parsed);
    return loaded.ok ? {layout: loaded.layout, notice: null, keep: true} : keepOriginal(storage, raw, loaded.message);
}

function keepOriginal(storage: LayoutStorage, raw: string, reason: string): Loaded {
    try {
        storage.setItem(BACKUP_KEY, raw);
    } catch (error) {
        console.warn("Backing up the unreadable layout failed", error);
        return {layout: TabbedLayout.createDefault(), notice: `${reason}; the default layout is used and changes will not be kept, so the original stays untouched`, keep: false};
    }
    return {layout: TabbedLayout.createDefault(), notice: `${reason}; the default layout is used and the original is kept as a backup`, keep: true};
}

/** 保存。存储满了、被浏览器禁用时交回原因，界面显示出来；布局照常用。 */
export function saveLayout(storage: LayoutStorage | null, layout: TabbedLayout): string | null {
    if (storage === null) return null;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(layout.toSaved()));
        return null;
    } catch (error) {
        console.warn("Saving the layout failed", error);
        return "Saving the layout failed";
    }
}
