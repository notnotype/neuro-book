/**
 * IDE 式工具窗的模型：一棵 nb-layout 的网格，加三张“工具窗在哪条按钮条上、每个区显示哪一个”的表。
 *
 * 分工：网格只管矩形（哪块在哪、多大、收起没有），它不知道什么是工具窗；工具窗归下面这几张表。两者靠叶的 id 对上：
 * 三个区（`left`、`right`、`bottom`）各是网格里的一块叶，叶的 id 与 `ref` 相同，按钮条（`left-stripe` 等）与编辑区也一样。
 * 这条约定让读档只需要一个“按 ref 给策略”的写法。
 *
 * 这个文件不依赖 Vue，也不碰 DOM：操作都是同步的，直接调网格的 `setCollapsed`、`setSize`；界面在操作成功之后自己通知
 * 网格重算（`host.invalidate()`）并保存。
 */
import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridLeafInput, GridNodeInput} from "@notnotype/nb-layout";

/** 分隔线的宽度（CSS px）。建树与读档都要给：它不在快照里，缺省是 0，0 的分隔线拖不动。 */
export const SASH_SIZE = 4;
export const EDITOR = "editor";

export const ZONES = ["left", "right", "bottom"] as const;
/** 区：工具窗展开时显示的地方。按钮条与区一一对应，同名。 */
export type Zone = (typeof ZONES)[number];

/** 按钮条的叶 id。 */
export const STRIPE: Readonly<Record<Zone, string>> = {left: "left-stripe", right: "right-stripe", bottom: "bottom-stripe"};
export const STRIPE_IDS: readonly string[] = Object.values(STRIPE);

/**
 * 条的厚度：左右条是宽，下条是高。保留像素，并且在主轴上最小与最大尺寸都等于厚度，把条钉死。
 * 只停用条旁的分隔线（见 `sashLocked`）钉不住它：`sashDisabled` 只停这一条线，拖别处的分隔线时库的级联补偿
 * （位移由近到远传给兄弟）和窗口缩小时的压缩照样会挤它，保留像素又没有最小尺寸的叶会被压到 0，按钮就点不到了。
 */
const STRIPE_THICKNESS: Readonly<Record<Zone, number>> = {left: 28, right: 28, bottom: 24};

/** 六个工具窗，按快捷键数字的次序。 */
export const TOOLS = [
    {id: "project", title: "Project"},
    {id: "structure", title: "Structure"},
    {id: "bookmarks", title: "Bookmarks"},
    {id: "outline", title: "Outline"},
    {id: "terminal", title: "Terminal"},
    {id: "problems", title: "Problems"},
] as const;
export const TOOL_IDS: readonly string[] = TOOLS.map((tool) => tool.id);

/**
 * 三个区的尺寸：保留像素的缺省尺寸与最小尺寸，沿哪根轴。区收起到 0，所以最小尺寸只管展开时。
 * 左右区是宽，下区是高。
 */
const ZONE_SPECS: Readonly<Record<Zone, {readonly size: number; readonly minimum: number; readonly axis: "width" | "height"}>> = {
    left: {size: 260, minimum: 160, axis: "width"},
    right: {size: 240, minimum: 160, axis: "width"},
    bottom: {size: 200, minimum: 100, axis: "height"},
};

const DEFAULT_STRIPS: Readonly<Record<Zone, readonly string[]>> = {
    left: ["project", "structure", "bookmarks"],
    right: ["outline"],
    bottom: ["terminal", "problems"],
};

export type Result = {readonly ok: true} | Failure;
/** 操作的结果，与库的失败同一个形状：`code` 给程序分支，`message` 给人看。 */
export type Failure = {readonly ok: false; readonly code: string; readonly message: string};
const failure = (code: string, message: string): Failure => ({ok: false, code, message});

/**
 * 区的叶：保留像素、可以收起到 0。快照只存结构与尺寸意图，保留像素、最小尺寸、收起策略都不在里面，
 * 所以这个形状只有这一个出处，缺省建树与读档共用，载入前后同一个区的约束相同。
 * 策略里的 `restoreSize` 只是初值：库在每次收起的那一刻把它改写成当时的尺寸意图，所以读档不必也不该存它。
 */
function zoneLeaf(zone: Zone, collapsed: boolean): GridLeafInput<string> {
    const spec = ZONE_SPECS[zone];
    const along = (value: number) => (spec.axis === "width" ? {width: value, height: 0} : {width: 0, height: value});
    return {
        kind: "leaf",
        id: zone,
        ref: zone,
        size: along(spec.size),
        minimumSize: along(spec.minimum),
        sizing: "fixed",
        // 阈值 24：拖过最小尺寸再往里 24 像素就收起，从收起处往外拉 24 像素就展开。
        collapse: {collapsed, collapsedSize: 0, restoreSize: spec.size, collapseThreshold: 24, expandThreshold: 24},
    };
}

function stripeLeaf(zone: Zone): GridLeafInput<string> {
    const thickness = STRIPE_THICKNESS[zone];
    // 只约束主轴：交叉轴由父分支给，最大值要写 Infinity（写 0 就是上限 0）。
    const minimumSize = zone === "bottom" ? {width: 0, height: thickness} : {width: thickness, height: 0};
    const maximumSize = zone === "bottom" ? {width: Number.POSITIVE_INFINITY, height: thickness} : {width: thickness, height: Number.POSITIVE_INFINITY};
    return {kind: "leaf", id: STRIPE[zone], ref: STRIPE[zone], size: {...minimumSize}, minimumSize, maximumSize, sizing: "fixed"};
}

/**
 * 树：根是竖向的 [main, 下条]，main 是横向的 [左条, 左区, 中间, 右区, 右条]，中间是竖向的 [编辑区, 下区]。
 * 下条放在 main 外面：最大化编辑区时它盖住的是除条以外全部叶的外接矩形，下条要在这个矩形的外面才不会被盖住。
 * 编辑区给最小尺寸：不给时窄窗口里它会被两侧挤到几十像素，而且没有任何诊断。
 */
function buildTree(collapsed: Readonly<Record<Zone, boolean>>): GridNodeInput<string> {
    return {
        kind: "branch",
        id: "root",
        orientation: "vertical",
        children: [
            {
                kind: "branch",
                id: "main",
                orientation: "horizontal",
                // 按比例分的节点的 size 是兄弟之间的份额；这几个都是唯一的按比例分的孩子，给 1 就是吃掉全部余量。
                size: {width: 1, height: 1},
                children: [
                    stripeLeaf("left"),
                    zoneLeaf("left", collapsed.left),
                    {
                        kind: "branch",
                        id: "center",
                        orientation: "vertical",
                        size: {width: 1, height: 1},
                        children: [
                            {kind: "leaf", id: EDITOR, ref: EDITOR, size: {width: 1, height: 1}, minimumSize: {width: 300, height: 200}},
                            zoneLeaf("bottom", collapsed.bottom),
                        ],
                    },
                    zoneLeaf("right", collapsed.right),
                    stripeLeaf("right"),
                ],
            },
            stripeLeaf("bottom"),
        ],
    };
}

export class IdeLayout {
    readonly grid: Grid<string>;
    /** 每条按钮条上的工具窗，按条上的次序。值整个替换，不原地改。 */
    readonly strips: Record<Zone, readonly string[]>;
    /**
     * 每个区显示哪一个工具窗，可以为空。区收起时它留着：下次展开还是它。
     * 展开着的区必须有值（界面按它画内容、按钮选中态按它算），所以区被分隔线展开而它为空时要补上，见 `reconcile`。
     */
    readonly shown: Record<Zone, string | null>;
    /** 编辑区最大化：只在内存，不进存档。 */
    maximized = false;

    private constructor(grid: Grid<string>, strips: Record<Zone, readonly string[]>, shown: Record<Zone, string | null>) {
        this.grid = grid;
        this.strips = strips;
        this.shown = shown;
    }

    /** 缺省布局：左区展开显示 Project，右区与下区收着、还没有显示哪一个。 */
    static createDefault(): IdeLayout {
        const grid = createGrid<string>(buildTree({left: false, right: true, bottom: true}), {sashSize: SASH_SIZE});
        return new IdeLayout(grid, {...DEFAULT_STRIPS}, {left: "project", right: null, bottom: null});
    }

    zoneOf(tool: string): Zone | undefined {
        return ZONES.find((zone) => this.strips[zone].includes(tool));
    }

    isCollapsed(zone: Zone): boolean {
        const node = this.grid.find(zone);
        return node?.kind === "leaf" && node.collapse?.collapsed === true;
    }

    /** 按钮的选中态：它所在的区展开着，并且显示的就是它。 */
    isOpen(tool: string): boolean {
        const zone = this.zoneOf(tool);
        return zone !== undefined && !this.isCollapsed(zone) && this.shown[zone] === tool;
    }

    /** 这条分隔线此刻不能拖（指针与键盘都不行）。`before`、`after` 是分隔线两侧节点的 id。 */
    sashLocked(before: string, after: string): boolean {
        // 条旁的分隔线：条已经被最小与最大尺寸钉死，这些线本来拖不动；停用它们是为了不画拖动光标、读屏读成不可用。
        if (STRIPE_IDS.includes(before) || STRIPE_IDS.includes(after)) return true;
        // 没有按钮的区：点不到、也不该被拖开，不然造出收不起来的空区。两侧里挨着区的那一侧是叶，id 就是区名；
        // 另一侧可能是分支（中间那一列），分支的 id 会随树的结构变，所以只按区这一侧判。
        return ZONES.some((zone) => this.strips[zone].length === 0 && (before === zone || after === zone));
    }

    /**
     * 点按钮（或快捷键）：区收着就展开并显示它；区显示着别的就换成它；已经显示它就收起这个区，`shown` 留着。
     * 最大化时先退出最大化再照常做：被盖住的区展开了也看不见。
     */
    toggleTool(tool: string): Result {
        const zone = this.zoneOf(tool);
        if (zone === undefined) return failure("unknown-tool", `No tool ${tool}`);
        this.maximized = false;
        if (this.isOpen(tool)) {
            this.setCollapsed(zone, true);
            return {ok: true};
        }
        this.shown[zone] = tool;
        this.setCollapsed(zone, false);
        return {ok: true};
    }

    /**
     * 把按钮拖到一条按钮条上，插在 `before` 前面（`null` 是排到最后）。同一条里换位置，不动区。
     * 拖到另一条：工具窗归那一条的区，成为那个区显示的，区展开；它原来是来源区显示的，就换成来源条上剩下的第一个，
     * 没有剩下的就收起来源区。最大化时先退出最大化。
     */
    moveTool(tool: string, to: Zone, before: string | null): Result {
        const from = this.zoneOf(tool);
        if (from === undefined) return failure("unknown-tool", `No tool ${tool}`);
        const rest = this.strips[to].filter((each) => each !== tool);
        const at = before === null ? rest.length : rest.indexOf(before);
        // 插入位不在目标条上（或就是自己）时不悄悄退成“排到最后”：那是另一个动作，界面显示的不是它。
        if (at < 0) return failure("bad-position", `No tool ${before} on the ${to} strip`);
        this.maximized = false;
        rest.splice(at, 0, tool);
        if (from === to) {
            this.strips[to] = rest;
            return {ok: true};
        }
        this.strips[from] = this.strips[from].filter((each) => each !== tool);
        this.strips[to] = rest;
        this.shown[to] = tool;
        this.setCollapsed(to, false);
        if (this.shown[from] === tool) {
            this.shown[from] = this.strips[from][0] ?? null;
            if (this.shown[from] === null) this.setCollapsed(from, true);
        }
        return {ok: true};
    }

    toggleMaximized(): Result {
        this.maximized = !this.maximized;
        return {ok: true};
    }

    /**
     * 分隔线的手势（拖、在分隔线上按 Enter）展开了一个区之后调：网格只管尺寸，不知道区里该显示什么，宿主补两件事。
     * 条上没有按钮的区不该展开（它的分隔线被停用，这是兜底），收回去；`shown` 为空的区显示这条上的第一个。
     * 返回有没有收起了哪个区，有就要通知网格重算。
     */
    reconcile(): boolean {
        let collapsed = false;
        for (const zone of ZONES) {
            if (this.isCollapsed(zone)) continue;
            const first = this.strips[zone][0];
            if (first === undefined) {
                this.shown[zone] = null;
                this.setCollapsed(zone, true);
                collapsed = true;
            } else if (this.shown[zone] === null) {
                this.shown[zone] = first;
            }
        }
        return collapsed;
    }

    private setCollapsed(zone: Zone, collapsed: boolean): void {
        const result = this.grid.setCollapsed(zone, collapsed);
        // 区都带着收起策略、叶总在树里：失败是模型写错了，不是用户做错了，直接抛。
        if (!result.ok) throw new Error(`Collapsing ${zone} failed: ${result.message}`);
    }

    toSaved(): SavedLayout {
        const zone = (id: Zone): SavedZone => {
            const node = this.grid.find(id);
            if (node?.kind !== "leaf" || node.collapse === undefined) throw new Error(`The ${id} zone is missing from the grid`);
            // 意图在收起时不变，收起着的区存的也是收起前的尺寸，不是 0。
            return {size: node.size[ZONE_SPECS[id].axis], collapsed: node.collapse.collapsed};
        };
        return {
            version: 1,
            zones: {left: zone("left"), right: zone("right"), bottom: zone("bottom")},
            shown: {...this.shown},
            strips: {left: [...this.strips.left], right: [...this.strips.right], bottom: [...this.strips.bottom]},
        };
    }

    /**
     * 读档：形状、数值、工具窗的归属、展开着的区有没有东西可显示，全部通过才交回；任何一项不对就是存档坏了，交回原因。
     * 不存网格的快照：这棵树的形状是固定的，存下来的只有三个区的尺寸、收起与各条上的工具窗。
     * 做法是先建缺省的树，再用公开的 `setSize`、`setCollapsed` 把尺寸与收起放回去。
     */
    static fromSaved(raw: unknown): {readonly ok: true; readonly layout: IdeLayout} | Failure {
        if (!isSavedShape(raw)) return failure("bad-shape", "Unrecognised save format");
        const placed = raw.strips.left.concat(raw.strips.right, raw.strips.bottom);
        if (placed.length !== TOOL_IDS.length || new Set(placed).size !== placed.length || placed.some((tool) => !TOOL_IDS.includes(tool))) {
            return failure("bad-tools", "The tool windows are not exactly the six known ones, each on one strip");
        }
        for (const zone of ZONES) {
            const spec = ZONE_SPECS[zone];
            const saved = raw.zones[zone];
            // 只拒绝读不出来的数与小于最小尺寸的数：上限没有，意图在窗口放不下时由库照约束压缩。
            if (!Number.isFinite(saved.size) || saved.size < spec.minimum) return failure("bad-size", `The size of the ${zone} zone is out of range`);
            const shown = raw.shown[zone];
            if (shown !== null && !raw.strips[zone].includes(shown)) return failure("bad-shown", `The ${zone} zone shows a tool that is not on its strip`);
            // 展开着的区必须有按钮可显示：不然读出一个收不起来的空区。
            if (!saved.collapsed && shown === null) return failure("bad-shown", `The ${zone} zone is open but shows nothing`);
        }
        // 先建全部展开的树；意图与收起状态下面用 setSize、setCollapsed 放回。
        const grid = createGrid<string>(buildTree({left: false, right: false, bottom: false}), {sashSize: SASH_SIZE});
        for (const zone of ZONES) {
            const saved = raw.zones[zone];
            // 先放回意图再收起：收起那一刻库把 `restoreSize` 记成当时的意图。按钮展开（`setCollapsed(false)`）回到意图，
            // 分隔线上的 Enter 展开读 `restoreSize`，两者因此一致。所以收起着存档的区，存下来的 size 必须是收起前的尺寸。
            const size = grid.setSize(zone, saved.size);
            if (!size.ok) return failure("bad-size", size.message);
            if (saved.collapsed) {
                const collapsed = grid.setCollapsed(zone, true);
                if (!collapsed.ok) return failure("bad-size", collapsed.message);
            }
        }
        const copy = (zones: Readonly<Record<Zone, readonly string[]>>) => ({left: [...zones.left], right: [...zones.right], bottom: [...zones.bottom]});
        return {ok: true, layout: new IdeLayout(grid, copy(raw.strips), {...raw.shown})};
    }
}

type SavedZone = {readonly size: number; readonly collapsed: boolean};

/** 存档：三个区的尺寸（意图）与收起，各区显示哪一个，各条上的工具窗与次序。最大化只在内存，不存。 */
export type SavedLayout = {
    readonly version: 1;
    readonly zones: Readonly<Record<Zone, SavedZone>>;
    readonly shown: Readonly<Record<Zone, string | null>>;
    readonly strips: Readonly<Record<Zone, readonly string[]>>;
};

function isSavedShape(value: unknown): value is SavedLayout {
    if (typeof value !== "object" || value === null) return false;
    const saved = value as Record<string, unknown>;
    if (saved.version !== 1) return false;
    const table = (candidate: unknown): Record<string, unknown> | null => (typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>) : null);
    const zones = table(saved.zones);
    const shown = table(saved.shown);
    const strips = table(saved.strips);
    if (zones === null || shown === null || strips === null) return false;
    return ZONES.every((zone) => {
        const each = table(zones[zone]);
        const list = strips[zone];
        return each !== null
            && typeof each.size === "number" && typeof each.collapsed === "boolean"
            && (shown[zone] === null || typeof shown[zone] === "string")
            && Array.isArray(list) && list.every((tool) => typeof tool === "string");
    });
}

/** 存档用到的那两个方法：浏览器里是 `localStorage`，测试里可以换成内存里的一份。 */
export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export const STORAGE_KEY = "nb-layout-example:ide";
/** 读不了的存档原样搬到这里，不拿缺省布局覆盖它：等程序修好了还能再读。 */
export const BACKUP_KEY = `${STORAGE_KEY}:backup`;

/**
 * 读档的结果。`keep` 为假时这一页不要再保存：存档读不了、备份也写不进去，原件只剩主键那一份，
 * 再存就拿缺省布局把它覆盖了。
 */
export type Loaded = {readonly layout: IdeLayout; readonly notice: string | null; readonly keep: boolean};

/** 读档。没有存档时用缺省布局；存档坏了也用缺省布局，原件留在备份键里，`notice` 告诉用户。 */
export function loadLayout(storage: LayoutStorage | null): Loaded {
    if (storage === null) return {layout: IdeLayout.createDefault(), notice: "Storage is unavailable; changes will not be kept", keep: false};
    let raw: string | null;
    try {
        raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
        console.warn("Reading the saved layout failed", error);
        return {layout: IdeLayout.createDefault(), notice: "Storage is unavailable; changes will not be kept", keep: false};
    }
    if (raw === null) return {layout: IdeLayout.createDefault(), notice: null, keep: true};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return keepOriginal(storage, raw, "The saved layout is not valid JSON");
    }
    const loaded = IdeLayout.fromSaved(parsed);
    return loaded.ok ? {layout: loaded.layout, notice: null, keep: true} : keepOriginal(storage, raw, loaded.message);
}

function keepOriginal(storage: LayoutStorage, raw: string, reason: string): Loaded {
    try {
        storage.setItem(BACKUP_KEY, raw);
    } catch (error) {
        console.warn("Backing up the unreadable layout failed", error);
        return {layout: IdeLayout.createDefault(), notice: `${reason}; the default layout is used and changes will not be kept, so the original stays untouched`, keep: false};
    }
    return {layout: IdeLayout.createDefault(), notice: `${reason}; the default layout is used and the original is kept as a backup`, keep: true};
}

/** 保存。存储满了、被浏览器禁用时交回原因，界面显示出来；布局照常用。 */
export function saveLayout(storage: LayoutStorage | null, layout: IdeLayout): string | null {
    if (storage === null) return null;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(layout.toSaved()));
        return null;
    } catch (error) {
        console.warn("Saving the layout failed", error);
        return "Saving the layout failed";
    }
}
