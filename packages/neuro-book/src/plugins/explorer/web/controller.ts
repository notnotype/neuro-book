/**
 * 资源管理器的控制器（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：持有树模型、选择、显示
 * 偏好、正在进行的编辑与确认、提示与操作结果。入口在视图第一次挂上时建一个，活到入口停止；视图停放、移动、渲染重试
 * 只解绑再绑定同一个控制器。组件经它取数据、发动作，不持有文件客户端或网络协议。
 *
 * 写操作都经文件服务、由服务端排他重验；树不做乐观更新，结果经变更事件回到树上。写操作的对象在发起时冻结（改名与
 * 删除带 `identify` 的令牌），之后选择怎么变都不改投。
 */

import {computed, shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {BatchHandle, BatchResult, FilesResult, FilesService, ItemResult, ManifestIssue, OperationDone, Scheme} from "nbook/plugins/files/shared/contracts";

import {resolveDrop} from "./actions/drop";
import type {DropAction, DropZone} from "./actions/drop";
import {candidateName, planNames} from "./actions/paste-plan";
import type {CollisionChoice, PlanSource} from "./actions/paste-plan";
import {shiftNames} from "./actions/reorder-plan";
import {childAddress, isWithin, nameOf, parentAddress, resourceOf, rootAddress} from "./tree/address";
import {treeKey} from "./tree/keys";
import type {TreeKey} from "./tree/keys";
import {createTreeModel} from "./tree/model";
import type {RootState, TreeModel} from "./tree/model";
import {creatingId, projectRows} from "./tree/rows";
import type {Creating, EntryRow, Row} from "./tree/rows";
import {click, contextSelect, EMPTY_SELECTION, followPaths, prune} from "./tree/selection";
import type {Modifiers, Selection} from "./tree/selection";

/** 打开编辑器的命令；编辑器区随 t71 登记它。 */
export const OPEN_COMMAND = "nbook.editor.open";

export type OpenMode = "preview" | "permanent";

/** 单项写操作的名字：提示里据此说明是哪个动作没做成。 */
export type ActionName = "create" | "rename" | "delete" | "create-content" | "convert" | "display" | "include" | "drop" | "reorder" | "copy" | "cut" | "move";

/** 批量动作：删除、复制（粘贴复制的项）与移动（粘贴剪切的项、拖动移入）。 */
export type BatchAction = "delete" | "copy" | "move";

/** 结果区的一条提示。 */
export type Notice =
    | {readonly kind: "editor-missing"; readonly address: string}
    | {readonly kind: "open-failed"; readonly address: string; readonly reason: string}
    | {readonly kind: "failed"; readonly action: ActionName; readonly address: string; readonly code: string; readonly detail: string}
    /** 文件已改而清单没改成（docs/specs/workspace/folder-kinds.md 的“失败与恢复”）。 */
    | {readonly kind: "manifest"; readonly action: ActionName; readonly address: string; readonly issues: ReadonlyArray<ManifestIssue>};

/** 内联输入的名字错误：空、含 `/` 等不合法字符、同名，或服务端的失败码与说明。 */
export type NameError = {readonly code: "empty" | "invalid" | "conflict"} | {readonly code: "failed"; readonly detail: string};

export type Editing =
    | {readonly mode: "create"; readonly creating: Creating; readonly name: string; readonly error: NameError | null; readonly busy: boolean}
    | {readonly mode: "rename"; readonly address: string; readonly token: string; readonly name: string; readonly error: NameError | null; readonly busy: boolean};

/** 冻结的操作对象：地址与发起时取得的身份令牌。 */
export interface Frozen {
    readonly address: string;
    readonly token: string;
}

/** 剪贴板里的一项：冻结的地址与令牌，加上排名字要用的名字与是否目录。 */
export interface ClipItem extends Frozen {
    readonly name: string;
    readonly directory: boolean;
}

/**
 * 本窗口的文件剪贴板：资源引用与复制或剪切的意图，不存字节、不碰系统剪贴板。`id` 每次复制或剪切都换新，迟到的粘贴
 * 结果据此判断剪贴板是不是还是发起时的那一份。
 */
export interface Clipboard {
    readonly id: number;
    readonly mode: "copy" | "cut";
    readonly scheme: Scheme;
    readonly items: ReadonlyArray<ClipItem>;
}

export type Dialog =
    | {readonly kind: "delete"; readonly items: ReadonlyArray<Frozen>; readonly busy: boolean}
    | {readonly kind: "display"; readonly address: string; readonly name: string; readonly title: string; readonly icon: string; readonly busy: boolean}
    /** 粘贴或拖动移入时同名：源与目标的真实地址、预填的候选名，以及改名输入的错误。 */
    | {readonly kind: "collision"; readonly action: "copy" | "move"; readonly source: string; readonly target: string; readonly candidate: string; readonly error: NameError | null; readonly busy: false};

/** 逐项结果：服务端的结果，或用户在碰撞对话框里跳过、取消了剩余而没有提交的项。 */
export type ReportResult = ItemResult | {readonly status: "declined"; readonly reason: "skip" | "cancel"};

/** 一次批量的逐项结果：与发起时的对象按下标对齐；复制与移动带目标地址。 */
export interface OperationReport {
    readonly action: BatchAction;
    readonly items: ReadonlyArray<{readonly address: string; readonly target: string | null; readonly result: ReportResult}>;
    readonly manifests: ReadonlyArray<ManifestIssue>;
    readonly truncated: boolean;
}

/** 正在进行的批量：结果区显示“进行中”与“取消”。 */
export interface Running {
    readonly action: BatchAction;
    readonly count: number;
    cancel(): void;
}

/** 结果未知的批量：在用户放弃之前挡住复制、剪切、粘贴、拖动与删除。 */
export interface Unknown {
    readonly action: BatchAction;
    readonly items: ReadonlyArray<{readonly address: string; readonly target: string | null}>;
    /** 发起它的剪贴板；放弃时一并清掉。拖动发起的为 `null`。 */
    readonly clipboard: number | null;
}

/** 拖动中：冻结的源与最后显示过的落点动作。放下时只提交与它相同的动作。 */
export interface DragState {
    readonly sources: ReadonlyArray<string>;
    readonly over: {readonly id: string; readonly zone: DropZone} | null;
    readonly action: DropAction;
}

/** 各动作此刻能不能做：菜单、公开键与命令共用。 */
export interface Availability {
    readonly create: boolean;
    readonly rename: boolean;
    readonly delete: boolean;
    readonly createContent: boolean;
    readonly convert: boolean;
    readonly display: boolean;
    readonly include: boolean;
    readonly drop: boolean;
    readonly moveUp: boolean;
    readonly moveDown: boolean;
    readonly copy: boolean;
    readonly cut: boolean;
    readonly paste: boolean;
}

/** 动作的结果：做不了时给出原因的键（见 `messages.ts`），由命令转成 `unavailable`。 */
export type ActionResult = {readonly ok: true} | {readonly ok: false; readonly reason: UnavailableReason};

export type UnavailableReason = "no-target" | "no-selection" | "not-applicable" | "busy" | "stopped" | "unknown-outcome" | "empty-clipboard" | "cross-root";

/** 树内按键的结果：没处理、处理了，或要在某一行打开右键菜单。 */
export type KeyOutcome = "none" | "handled" | {readonly menu: string};

export interface ExplorerControllerOptions {
    readonly files: FilesService;
    readonly commands: Pick<CommandService, "execute">;
    /** 窗口绑定了项目。 */
    readonly bound: boolean;
    readonly expanded?: Iterable<string>;
    readonly onExpandedChange?: (expanded: ReadonlySet<string>) => void;
    readonly showManifests?: boolean;
    readonly report: (error: unknown) => void;
}

/** 行上被点的部位：展开箭头只展开收起，其余部位是行本身（节点行的打开区）。 */
export type RowPart = "twisty" | "row";

export interface ExplorerController {
    readonly model: TreeModel;
    readonly rows: ComputedRef<ReadonlyArray<Row>>;
    readonly selection: Readonly<ShallowRef<Selection>>;
    readonly showManifests: Readonly<ShallowRef<boolean>>;
    readonly notice: Readonly<ShallowRef<Notice | null>>;
    readonly editing: Readonly<ShallowRef<Editing | null>>;
    readonly dialog: Readonly<ShallowRef<Dialog | null>>;
    readonly report: Readonly<ShallowRef<OperationReport | null>>;
    readonly running: Readonly<ShallowRef<Running | null>>;
    readonly clipboard: Readonly<ShallowRef<Clipboard | null>>;
    readonly unknown: Readonly<ShallowRef<Unknown | null>>;
    readonly drag: Readonly<ShallowRef<DragState | null>>;
    readonly available: ComputedRef<Availability>;
    /** 树要重新拿到焦点（编辑或确认结束）：视图看到它变化就把焦点放回树上。 */
    readonly focusRequest: Readonly<ShallowRef<number>>;
    click(id: string, modifiers: Modifiers, part: RowPart): void;
    /** 双击：以常驻方式打开。 */
    activate(id: string): void;
    contextSelect(id: string): void;
    key(key: TreeKey, page: number): KeyOutcome;
    setShowManifests(show: boolean): void;
    dismissNotice(): void;
    dismissReport(): void;
    // 具名动作：命令的实现调用它们。需要界面输入的动作只打开输入或确认，提交另有方法。
    create(entry: "file" | "directory"): ActionResult;
    rename(): Promise<ActionResult>;
    delete(): Promise<ActionResult>;
    createContent(): Promise<ActionResult>;
    convert(): Promise<ActionResult>;
    editDisplay(): ActionResult;
    include(): Promise<ActionResult>;
    drop(): Promise<ActionResult>;
    move(direction: "up" | "down"): Promise<ActionResult>;
    copy(): Promise<ActionResult>;
    cut(): Promise<ActionResult>;
    paste(): Promise<ActionResult>;
    clearCut(): ActionResult;
    /** 结果未知：重新列出只核对，不解除；放弃解除门禁并清掉这份意图与它的剪贴板。 */
    recheck(): void;
    abandon(): void;
    // 拖动：手势归视图，判定与提交归控制器。
    startDrag(id: string): boolean;
    hoverDrag(over: {readonly id: string; readonly zone: DropZone} | null): void;
    dropDrag(over: {readonly id: string; readonly zone: DropZone} | null): Promise<void>;
    cancelDrag(): void;
    // 内联输入与确认框。
    editName(name: string): void;
    commitEdit(): Promise<void>;
    cancelEdit(): void;
    confirmDelete(): Promise<void>;
    commitDisplay(title: string, icon: string): Promise<void>;
    /** 碰撞对话框的回答；`all` 为真时对其余同名项都这样（改名用各自的候选名）。 */
    resolveCollision(choice: CollisionChoice, all: boolean): void;
    closeDialog(): void;
    dispose(): void;
}

const NOT_AVAILABLE: Availability = {create: false, rename: false, delete: false, createContent: false, convert: false, display: false, include: false, drop: false, moveUp: false, moveDown: false, copy: false, cut: false, paste: false};

/** 两个落点动作相同：放下时重判的动作要与最后显示过的逐字段相同才提交。 */
function sameDrop(a: DropAction, b: DropAction): boolean {
    switch (a.kind) {
        case "none":
            return b.kind === "none";
        case "move":
            return b.kind === "move" && a.target === b.target;
        case "reorder":
            return b.kind === "reorder" && a.parent === b.parent && a.anchor === b.anchor && a.zone === b.zone && a.names.length === b.names.length && a.names.every((name, index) => name === b.names[index]);
    }
}

/** 父子同时在里面时只留最外层。 */
function outermost(addresses: ReadonlyArray<string>): string[] {
    return addresses.filter((address) => !addresses.some((other) => other !== address && isWithin(address, other)));
}

export function createExplorerController(options: ExplorerControllerOptions): ExplorerController {
    const {files} = options;
    let disposed = false;
    const selection = shallowRef<Selection>(EMPTY_SELECTION);
    const showManifests = shallowRef(options.showManifests ?? false);
    const notice = shallowRef<Notice | null>(null);
    const editing = shallowRef<Editing | null>(null);
    const dialog = shallowRef<Dialog | null>(null);
    const report = shallowRef<OperationReport | null>(null);
    const running = shallowRef<Running | null>(null);
    const clipboard = shallowRef<Clipboard | null>(null);
    const unknown = shallowRef<Unknown | null>(null);
    const drag = shallowRef<DragState | null>(null);
    /** 粘贴或拖动移入在预判同名（列出目标、问用户）：这期间不能再起一个批量。 */
    const preparing = shallowRef(false);
    let clipSeq = 0;
    /** 碰撞对话框等着的回答。 */
    let answer: ((choice: CollisionChoice) => void) | null = null;
    const focusRequest = shallowRef(0);
    /** 新建或改名成功后的新地址：它的行出现时选中并聚焦它。 */
    let pendingFocus: string | null = null;

    const model = createTreeModel({
        files,
        bound: options.bound,
        ...(options.expanded === undefined ? {} : {expanded: options.expanded}),
        ...(options.onExpandedChange === undefined ? {} : {onExpandedChange: options.onExpandedChange}),
        onPathsChanged: (changes) => {
            selection.value = followPaths(selection.value, changes);
        },
        report: options.report,
    });
    /** 祖先都展开、但有祖先还没有列出结果：这个地址还看不到，不等于不在了。 */
    const pending = (id: string): boolean => {
        let unlisted = false;
        for (let ancestor = parentAddress(id); ancestor !== null; ancestor = parentAddress(ancestor)) {
            if (!model.expanded.value.has(ancestor)) return false;
            if (model.slots.value.get(ancestor)?.listing == null) unlisted = true;
        }
        return unlisted;
    };
    const creating = computed(() => (editing.value?.mode === "create" ? editing.value.creating : null));
    const cutMarks = computed((): ReadonlySet<string> => new Set(clipboard.value?.mode === "cut" ? clipboard.value.items.map((item) => item.address) : []));
    const rows = computed(() => projectRows({roots: model.roots.value, slots: model.slots.value, expanded: model.expanded.value, showManifests: showManifests.value, creating: creating.value, cut: cutMarks.value}));
    // 可见行变了：选择与焦点里不可见的去掉，焦点回到最近的可见祖先或邻近的行。一批事件会依次作废缓存、改写展开集合与
    // 选择，中间的行不完整；放到微任务里，按这一轮同步改动之后的状态核对一次。
    let pruned: ReadonlyArray<Row> = [];
    let scheduled = false;
    const stopPrune = watch(rows, () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (disposed) return;
            const next = rows.value;
            if (pendingFocus !== null && next.some((row) => row.id === pendingFocus)) {
                selection.value = {selected: [pendingFocus], focus: pendingFocus, anchor: pendingFocus};
                pendingFocus = null;
            }
            selection.value = prune(selection.value, next, pruned, pending);
            pruned = next;
            // 拖动的源或落点行不在了：取消，不写。
            const current = drag.value;
            if (current !== null && !current.sources.concat(current.over === null ? [] : [current.over.id]).every((id) => next.some((row) => row.id === id))) drag.value = null;
        });
    });

    let openSeq = 0;
    const open = async (address: string, mode: OpenMode): Promise<void> => {
        const seq = ++openSeq;
        const result = await options.commands.execute(OPEN_COMMAND, {address, mode});
        // 迟到的结果不覆盖之后的打开意图。
        if (seq !== openSeq || result.ok) return;
        notice.value = result.code === "unknown-command" ? {kind: "editor-missing", address} : {kind: "open-failed", address, reason: result.reason};
    };
    const find = (id: string): Row | undefined => rows.value.find((row) => row.id === id);
    const toggle = (row: Row): void => {
        if (row.kind === "status" || row.kind === "edit" || (row.kind === "root" && row.status.kind === "unbound") || (row.kind === "entry" && !row.expandable)) return;
        if (row.expanded) model.collapse(row.id);
        else model.expand(row.id);
    };

    // ---- 动作的对象 ----

    const live = (address: string): boolean => model.roots.value.find((root) => root.scheme === resourceOf(address).scheme)?.status.kind === "live";
    /** 选中的资源行（不含根），按可见顺序。 */
    const selectedEntries = computed((): EntryRow[] => {
        const chosen = new Set(selection.value.selected);
        return rows.value.filter((row): row is EntryRow => row.kind === "entry" && chosen.has(row.id));
    });
    const single = computed((): EntryRow | null => (selectedEntries.value.length === 1 && selection.value.selected.length === 1 ? selectedEntries.value[0] as EntryRow : null));
    /** 当前根：焦点行的方案；没有焦点时取第一个可用的根。 */
    const currentRoot = computed((): string | null => {
        const focus = selection.value.focus;
        if (focus !== null) return rootAddress(resourceOf(focus).scheme);
        return model.roots.value.find((root) => root.status.kind === "live")?.address ?? null;
    });
    /** 新建与粘贴的目标：选中的目录（含根）；选中文件的父目录；没有选择时当前根。多个选中项时不猜。 */
    const createTarget = computed((): Creating | null => {
        const chosen = selection.value.selected;
        if (chosen.length > 1) return null;
        const id = chosen[0] ?? null;
        const row = id === null ? null : find(id);
        let parent: string | null;
        let before: string | null = null;
        if (row === undefined || row === null) parent = currentRoot.value;
        else if (row.kind === "root") parent = row.status.kind === "live" ? row.address : null;
        else if (row.kind === "entry" && row.expandable) parent = row.address;
        else if (row.kind === "entry") {
            parent = row.parent;
            // 内容文件夹里新项插到选中项之前。
            if (row.content) before = row.name;
        } else parent = null;
        if (parent === null || !live(parent)) return null;
        return {parent, entry: "file", before};
    });
    /** 内容文件夹一层清单里的全部条目（含缺失的），按清单顺序；还没列出时为 `null`。 */
    const manifestOrder = (parent: string): ReadonlyArray<string> | null => {
        const listing = model.slots.value.get(parent)?.listing;
        return listing == null ? null : listing.entries.filter((entry) => entry.listed === true).map((entry) => entry.name);
    };
    /** 排序的对象：都在同一个内容文件夹的同一层、都列在清单里。 */
    const reorderOf = (direction: "up" | "down"): {readonly parent: string; readonly names: string[]} | null => {
        const chosen = selectedEntries.value;
        if (chosen.length === 0 || chosen.length !== selection.value.selected.length) return null;
        const parent = chosen[0]?.parent as string;
        if (!chosen.every((row) => row.content && row.listed === true && row.parent === parent)) return null;
        const order = manifestOrder(parent);
        if (order === null) return null;
        const names = shiftNames(order, new Set(chosen.map((row) => row.name)), direction);
        return names === null ? null : {parent, names};
    };

    /** 复制、剪切与拖动的源：选中的都是资源行、都不是缺失条目、都在同一个可用的根里。 */
    const transferable = (entries: ReadonlyArray<EntryRow>): boolean => {
        const scheme = entries[0] === undefined ? null : resourceOf(entries[0].address).scheme;
        return entries.length > 0 && entries.every((row) => row.type !== "missing" && live(row.address) && resourceOf(row.address).scheme === scheme);
    };
    /** 能不能起一个批量：没有在途或在准备的批量，也没有结果未知的批量。 */
    const idle = computed(() => running.value === null && !preparing.value && unknown.value === null);
    const pasteTarget = computed((): string | null => {
        const clip = clipboard.value;
        const target = createTarget.value?.parent ?? null;
        return clip === null || target === null || resourceOf(target).scheme !== clip.scheme ? null : target;
    });

    const available = computed((): Availability => {
        if (editing.value !== null || dialog.value !== null) return NOT_AVAILABLE;
        const one = single.value;
        const entries = selectedEntries.value;
        const writable = entries.length > 0 && entries.every((row) => live(row.address));
        const whole = entries.length === selection.value.selected.length;
        return {
            create: createTarget.value !== null,
            rename: one !== null && one.type !== "missing" && live(one.address),
            delete: writable && idle.value && whole && entries.every((row) => row.type !== "missing"),
            createContent: one !== null && one.node && !one.body && live(one.address),
            convert: one !== null && one.type === "directory" && !one.content && !one.binder && live(one.address),
            display: one !== null && one.content && one.listed === true && one.type !== "missing" && live(one.address),
            include: one !== null && one.content && one.listed === false && live(one.address),
            drop: one !== null && one.type === "missing" && live(one.address),
            moveUp: writable && reorderOf("up") !== null,
            moveDown: writable && reorderOf("down") !== null,
            copy: whole && unknown.value === null && transferable(entries),
            cut: whole && unknown.value === null && transferable(entries),
            paste: idle.value && pasteTarget.value !== null,
        };
    });
    /** 动作做不了的原因：结果未知优先，其次在途的批量。 */
    const blocked = (fallback: UnavailableReason): UnavailableReason => (unknown.value !== null ? "unknown-outcome" : running.value !== null || preparing.value ? "busy" : fallback);

    // ---- 结果 ----

    const failed = (action: ActionName, address: string, result: Extract<FilesResult<unknown>, {readonly ok: false}>): void => {
        notice.value = {kind: "failed", action, address, code: result.code, detail: result.detail};
    };
    const settle = (action: ActionName, address: string, result: FilesResult<OperationDone>): boolean => {
        if (!result.ok) {
            failed(action, address, result);
            return false;
        }
        if ((result.value.manifests ?? []).length > 0) notice.value = {kind: "manifest", action, address, issues: result.value.manifests ?? []};
        return true;
    };
    /** 冻结一组地址的身份；有一项拿不到令牌（不在了、读不出）时整组不做并给出原因。 */
    const freeze = async (action: ActionName, addresses: ReadonlyArray<string>): Promise<Frozen[] | null> => {
        const identified = await files.identify(addresses);
        if (!identified.ok) {
            failed(action, addresses[0] as string, identified);
            return null;
        }
        const frozen: Frozen[] = [];
        for (const [index, item] of identified.value.items.entries()) {
            const address = addresses[index] as string;
            if ("code" in item) {
                notice.value = {kind: "failed", action, address, code: item.code, detail: item.detail};
                return null;
            }
            frozen.push({address, token: item.token});
        }
        return frozen;
    };
    const refocus = (): void => {
        focusRequest.value += 1;
    };
    const unavailable = (reason: UnavailableReason): ActionResult => ({ok: false, reason});
    const OK: ActionResult = {ok: true};

    /** 删除后焦点的去向：下一个不被删的同层项，没有则上一个，再没有则父目录。 */
    const focusAfterDelete = (deleted: ReadonlyArray<string>): string | null => {
        const visible = rows.value.filter((row) => row.kind === "root" || row.kind === "entry");
        const gone = (id: string): boolean => deleted.some((address) => isWithin(id, address));
        const focus = selection.value.focus ?? deleted[0] ?? null;
        if (focus === null) return null;
        const parent = parentAddress(focus);
        const siblings = visible.filter((row) => parentAddress(row.id) === parent);
        const at = siblings.findIndex((row) => row.id === focus);
        const next = siblings.slice(at + 1).find((row) => !gone(row.id)) ?? siblings.slice(0, Math.max(at, 0)).reverse().find((row) => !gone(row.id));
        return next?.id ?? parent;
    };

    const validName = (name: string): NameError | null => {
        if (name.trim() === "") return {code: "empty"};
        if (name.includes("/") || name.includes("\\") || name === "." || name === "..") return {code: "invalid"};
        return null;
    };
    const nameError = (result: Extract<FilesResult<unknown>, {readonly ok: false}>): NameError => (result.code === "conflict" ? {code: "conflict"} : {code: "failed", detail: `${result.code}：${result.detail}`});

    /** 冻结一组资源行，带上排名字要用的名字与是否目录。 */
    const freezeItems = async (action: ActionName, chosen: ReadonlyArray<EntryRow>): Promise<ClipItem[] | null> => {
        const directories = new Set(chosen.flatMap((row) => (row.type === "directory" ? [row.address] : [])));
        const frozen = await freeze(action, outermost(chosen.map((row) => row.address)));
        return frozen?.map((item) => ({...item, name: nameOf(item.address), directory: directories.has(item.address)})) ?? null;
    };

    /**
     * 提交一次批量并结算。结果未知时进入门禁并保留这份意图；请求没有派发出去时给出提示；其余按下标与发起时的对象对齐
     * 成逐项结果，全部干净完成时不打扰。返回服务端的逐项结果，未知或失败时为 `null`。
     */
    type Planned = {readonly address: string; readonly target: string | null};
    type Declined = Planned & {readonly result: ReportResult};
    const runBatch = async (action: BatchAction, items: ReadonlyArray<Planned>, handle: BatchHandle, declined: ReadonlyArray<Declined>, clip: number | null): Promise<BatchResult | null> => {
        running.value = {action, count: items.length, cancel: () => void handle.cancel()};
        const result = await handle.result;
        running.value = null;
        if (!result.ok) {
            if (result.code === "unknown-outcome") unknown.value = {action, items, clipboard: clip};
            else failed(action, (items[0] as Planned).address, result);
            return null;
        }
        const value = result.value;
        const all: Declined[] = [...items.map((item, index) => ({...item, result: value.items[index] as ItemResult})), ...declined];
        const clean = all.every((item) => item.result.status === "done" && (item.result.manifests ?? []).length === 0) && value.manifests.length === 0 && value.truncated !== true;
        report.value = clean ? null : {action, items: all, manifests: value.manifests, truncated: value.truncated === true};
        return value;
    };

    /** 碰撞对话框在等的回答，以及改名不能用的名字。 */
    let collision: {readonly taken: ReadonlySet<string>; readonly resolve: (choice: CollisionChoice, all: boolean) => void} | null = null;

    /**
     * 把冻结的源复制或移动到目标目录（粘贴与拖动移入同一流程）：同目标的移动无操作；用目标此刻的列出结果预判同名，逐个
     * 问改名、跳过或取消剩余；提交仍由服务端排他重验。剪切粘贴按项从剪贴板移除成功的源，剪贴板在此期间换了时不动新的。
     */
    const transfer = async (action: "copy" | "move", sources: ReadonlyArray<ClipItem>, target: string, clip: Clipboard | null): Promise<void> => {
        const moving = action === "move" ? sources.filter((item) => parentAddress(item.address) !== target) : sources;
        if (moving.length === 0) return;
        preparing.value = true;
        let asked = false;
        try {
            const listed = await files.list(target);
            if (disposed) return;
            if (!listed.ok) {
                failed(action, target, listed);
                return;
            }
            const existing = new Set(listed.value.entries.filter((entry) => entry.kind !== "missing").map((entry) => entry.name));
            let remembered: "rename" | "skip" | null = null;
            const plan = await planNames(moving, existing, (source, taken) => {
                const candidate = candidateName(source.name, source.directory, taken);
                if (remembered === "skip") return Promise.resolve({kind: "skip"});
                if (remembered === "rename") return Promise.resolve({kind: "rename", name: candidate});
                asked = true;
                return new Promise<CollisionChoice>((resolve) => {
                    dialog.value = {kind: "collision", action, source: source.address, target: childAddress(target, source.name), candidate, error: null, busy: false};
                    collision = {
                        taken,
                        resolve: (choice, all) => {
                            if (all && choice.kind !== "cancel") remembered = choice.kind;
                            resolve(choice);
                        },
                    };
                });
            });
            if (asked) refocus();
            // 等回答期间项目可能结束、控制器可能停止：旧意图不再写。
            if (disposed || !live(target)) return;
            const declined: Declined[] = [
                ...plan.skipped.map((source) => ({address: source.address, target: childAddress(target, source.name), result: {status: "declined", reason: "skip"} as const})),
                ...plan.cancelled.map((source) => ({address: source.address, target: childAddress(target, source.name), result: {status: "declined", reason: "cancel"} as const})),
            ];
            if (plan.items.length === 0) {
                report.value = declined.length === 0 ? null : {action, items: declined, manifests: [], truncated: false};
                return;
            }
            const items = plan.items.map((item) => ({address: item.source.address, target: childAddress(target, item.name)}));
            const batch = plan.items.map((item) => ({source: item.source.address, target: childAddress(target, item.name), expected: item.source.token}));
            const value = await runBatch(action, items, action === "copy" ? files.copy(batch) : files.move(batch), declined, clip?.id ?? null);
            if (value === null || clip?.mode !== "cut") return;
            const moved = new Set(plan.items.filter((_, index) => value.items[index]?.status === "done").map((item) => item.source));
            const now = clipboard.value;
            if (now?.id !== clip.id) return;
            const rest = now.items.filter((item) => !moved.has(item));
            clipboard.value = rest.length === 0 ? null : {...now, items: rest};
        } finally {
            preparing.value = false;
        }
    };

    const collect = async (mode: "copy" | "cut"): Promise<ActionResult> => {
        if (!available.value[mode]) return unavailable(unknown.value !== null ? "unknown-outcome" : "no-selection");
        const items = await freezeItems(mode, selectedEntries.value);
        if (items === null || disposed) return OK;
        clipboard.value = {id: ++clipSeq, mode, scheme: resourceOf((items[0] as ClipItem).address).scheme, items};
        return OK;
    };

    /** 拖动的源冻结出的令牌：拿起时开始取，放下时等它。 */
    let dragItems: Promise<ClipItem[] | null> | null = null;
    const NO_DROP: DropAction = {kind: "none"};
    const dropAction = (sources: ReadonlyArray<string>, over: {readonly id: string; readonly zone: DropZone} | null): DropAction => (over === null ? NO_DROP : resolveDrop(sources, find(over.id), over.zone, manifestOrder));

    // 项目代次结束：本窗口的剪贴板引用随之作废。
    const stopRoots = watch((): ReadonlyArray<RootState> => model.roots.value, (roots: ReadonlyArray<RootState>) => {
        const current = clipboard.value;
        if (current !== null && roots.find((root) => root.scheme === current.scheme)?.status.kind !== "live") clipboard.value = null;
    });

    return {
        model,
        rows,
        selection,
        showManifests,
        notice,
        editing,
        dialog,
        report,
        running,
        clipboard,
        unknown,
        drag,
        available,
        focusRequest,
        click: (id, modifiers, part) => {
            const row = find(id);
            if (row === undefined || row.kind === "status" || row.kind === "edit") return;
            if (part === "twisty") {
                toggle(row);
                return;
            }
            selection.value = click(selection.value, rows.value, id, modifiers);
            // 修饰选择不打开、不展开。
            if (modifiers.toggle || modifiers.range) return;
            if (row.kind === "root") toggle(row);
            else if (row.opens !== null) void open(row.opens, "preview");
            else if (!row.node) toggle(row);
        },
        activate: (id) => {
            const row = find(id);
            if (row?.kind === "entry" && row.opens !== null) void open(row.opens, "permanent");
        },
        contextSelect: (id) => {
            selection.value = contextSelect(selection.value, id);
        },
        key: (key, page) => {
            const effect = treeKey(rows.value, selection.value, key, page);
            switch (effect.kind) {
                case "none":
                    return "none";
                case "select":
                    selection.value = effect.selection;
                    return "handled";
                case "expand":
                    model.expand(effect.address);
                    return "handled";
                case "collapse":
                    model.collapse(effect.address);
                    return "handled";
                case "open":
                    void open(effect.address, "permanent");
                    return "handled";
                case "menu":
                    return {menu: effect.id};
                case "command":
                    void options.commands.execute(effect.id);
                    return "handled";
            }
        },
        setShowManifests: (show) => {
            showManifests.value = show;
            // 投影变了，拖动看到的落点不再成立。
            drag.value = null;
            dragItems = null;
        },
        dismissNotice: () => {
            notice.value = null;
        },
        dismissReport: () => {
            report.value = null;
        },

        create: (entry) => {
            const target = createTarget.value;
            if (!available.value.create || target === null) return unavailable("no-target");
            model.expand(target.parent);
            editing.value = {mode: "create", creating: {...target, entry}, name: "", error: null, busy: false};
            return OK;
        },
        rename: async () => {
            const row = single.value;
            if (!available.value.rename || row === null) return unavailable("no-selection");
            const frozen = await freeze("rename", [row.address]);
            if (frozen === null) return OK;
            editing.value = {mode: "rename", address: row.address, token: (frozen[0] as Frozen).token, name: row.name, error: null, busy: false};
            return OK;
        },
        delete: async () => {
            if (!available.value.delete) return unavailable(blocked("no-selection"));
            const frozen = await freeze("delete", outermost(selectedEntries.value.map((row) => row.address)));
            if (frozen === null) return OK;
            dialog.value = {kind: "delete", items: frozen, busy: false};
            return OK;
        },
        createContent: async () => {
            const row = single.value;
            if (!available.value.createContent || row === null) return unavailable("not-applicable");
            settle("create-content", row.address, await files.createContent(row.address));
            return OK;
        },
        convert: async () => {
            const row = single.value;
            if (!available.value.convert || row === null) return unavailable("not-applicable");
            const frozen = await freeze("convert", [row.address]);
            if (frozen === null) return OK;
            const to = row.folder === "content" ? "plain" : "content";
            const result = await files.convert(row.address, to, {expected: (frozen[0] as Frozen).token});
            if (settle("convert", row.address, result)) {
                const name = to === "content" ? `${row.name}.content` : row.name.replace(/\.content$/u, "");
                pendingFocus = childAddress(row.parent, name);
            }
            return OK;
        },
        editDisplay: () => {
            const row = single.value;
            if (!available.value.display || row === null) return unavailable("not-applicable");
            dialog.value = {kind: "display", address: row.address, name: row.name, title: row.subtitle === null ? "" : row.label, icon: row.icon ?? "", busy: false};
            return OK;
        },
        include: async () => {
            const row = single.value;
            if (!available.value.include || row === null) return unavailable("not-applicable");
            settle("include", row.address, await files.include(row.address));
            return OK;
        },
        drop: async () => {
            const row = single.value;
            if (!available.value.drop || row === null) return unavailable("not-applicable");
            settle("drop", row.address, await files.drop(row.address));
            return OK;
        },
        move: async (direction) => {
            const plan = available.value[direction === "up" ? "moveUp" : "moveDown"] ? reorderOf(direction) : null;
            if (plan === null) return unavailable("not-applicable");
            settle("reorder", plan.parent, await files.reorder(plan.parent, plan.names));
            return OK;
        },
        copy: () => collect("copy"),
        cut: () => collect("cut"),
        paste: async () => {
            const current = clipboard.value;
            const target = pasteTarget.value;
            if (!available.value.paste || current === null || target === null) {
                if (current === null) return unavailable(unknown.value !== null ? "unknown-outcome" : "empty-clipboard");
                const directory = createTarget.value?.parent ?? null;
                return unavailable(blocked(directory !== null && resourceOf(directory).scheme !== current.scheme ? "cross-root" : "no-target"));
            }
            await transfer(current.mode === "copy" ? "copy" : "move", current.items, target, current);
            return OK;
        },
        clearCut: () => {
            if (clipboard.value?.mode !== "cut") return unavailable("not-applicable");
            clipboard.value = null;
            return OK;
        },
        recheck: () => {
            model.refresh();
        },
        abandon: () => {
            const current = unknown.value;
            if (current === null) return;
            if (current.clipboard !== null && clipboard.value?.id === current.clipboard) clipboard.value = null;
            unknown.value = null;
        },
        startDrag: (id) => {
            const row = find(id);
            if (drag.value !== null || editing.value !== null || dialog.value !== null || !idle.value || row?.kind !== "entry") return false;
            // 拖已选的行拖整个选择；拖未选的行只拖它。
            const chosen = selection.value.selected.includes(id) ? selectedEntries.value : [row];
            if ((chosen === selectedEntries.value && chosen.length !== selection.value.selected.length) || !transferable(chosen)) return false;
            const sources = outermost(chosen.map((entry) => entry.address));
            const items = freezeItems("move", chosen);
            dragItems = items;
            drag.value = {sources, over: null, action: NO_DROP};
            // 令牌取不齐：取消这场拖动（提示由 `freeze` 给出）。
            void items.then((frozen) => {
                if (frozen === null && dragItems === items) {
                    drag.value = null;
                    dragItems = null;
                }
            });
            return true;
        },
        hoverDrag: (over) => {
            const current = drag.value;
            if (current === null) return;
            drag.value = {...current, over, action: dropAction(current.sources, over)};
        },
        dropDrag: async (over) => {
            const current = drag.value;
            const items = dragItems;
            drag.value = null;
            dragItems = null;
            if (current === null || items === null) return;
            const action = dropAction(current.sources, over);
            if (action.kind === "none" || !sameDrop(action, current.action)) return;
            const frozen = await items;
            if (frozen === null || disposed || !idle.value) return;
            if (action.kind === "move") await transfer("move", frozen, action.target, null);
            else settle("reorder", action.parent, await files.reorder(action.parent, action.names));
        },
        cancelDrag: () => {
            drag.value = null;
            dragItems = null;
        },

        editName: (name) => {
            const current = editing.value;
            if (current === null || current.busy) return;
            editing.value = {...current, name, error: null};
        },
        commitEdit: async () => {
            const current = editing.value;
            if (current === null || current.busy) return;
            const error = validName(current.name);
            if (error !== null) {
                editing.value = {...current, error};
                return;
            }
            const name = current.name.trim();
            if (current.mode === "rename" && name === nameOf(current.address)) {
                editing.value = null;
                refocus();
                return;
            }
            editing.value = {...current, busy: true};
            const result = current.mode === "create"
                ? await files.create(childAddress(current.creating.parent, name), current.creating.entry, current.creating.before === null ? {} : {before: current.creating.before})
                : await files.rename(current.address, name, {expected: current.token});
            if (editing.value?.busy !== true) return;
            if (!result.ok) {
                // 同名、源已换、失败：留在输入框里原位提示，不关闭输入。
                editing.value = {...current, busy: false, error: nameError(result)};
                return;
            }
            const parent = current.mode === "create" ? current.creating.parent : (parentAddress(current.address) as string);
            pendingFocus = childAddress(parent, name);
            editing.value = null;
            if ((result.value.manifests ?? []).length > 0) notice.value = {kind: "manifest", action: current.mode, address: pendingFocus, issues: result.value.manifests ?? []};
            refocus();
        },
        cancelEdit: () => {
            if (editing.value === null) return;
            editing.value = null;
            refocus();
        },
        confirmDelete: async () => {
            const current = dialog.value;
            if (current?.kind !== "delete" || current.busy) return;
            const focusAfter = focusAfterDelete(current.items.map((item) => item.address));
            dialog.value = null;
            refocus();
            if (focusAfter !== null) selection.value = {selected: [focusAfter], focus: focusAfter, anchor: focusAfter};
            const handle = files.delete(current.items.map((item) => ({address: item.address, expected: item.token})));
            await runBatch("delete", current.items.map((item) => ({address: item.address, target: null})), handle, [], null);
        },
        commitDisplay: async (title, icon) => {
            const current = dialog.value;
            if (current?.kind !== "display" || current.busy) return;
            dialog.value = {...current, busy: true};
            const result = await files.display(current.address, {title: title.trim() === "" ? null : title.trim(), icon: icon.trim() === "" ? null : icon.trim()});
            dialog.value = null;
            refocus();
            settle("display", current.address, result);
        },
        resolveCollision: (choice, all) => {
            const waiting = collision;
            const current = dialog.value;
            if (waiting === null || current?.kind !== "collision") return;
            let decided = choice;
            if (choice.kind === "rename") {
                const name = choice.name.trim();
                const error = validName(name) ?? (waiting.taken.has(name) ? {code: "conflict" as const} : null);
                if (error !== null) {
                    dialog.value = {...current, error};
                    return;
                }
                decided = {kind: "rename", name};
            }
            collision = null;
            dialog.value = null;
            waiting.resolve(decided, all);
        },
        closeDialog: () => {
            if (dialog.value === null || dialog.value.busy) return;
            if (dialog.value.kind === "collision") {
                // 关掉碰撞对话框就是取消剩余；焦点由粘贴收尾时放回。
                const waiting = collision;
                collision = null;
                dialog.value = null;
                waiting?.resolve({kind: "cancel"}, false);
                return;
            }
            dialog.value = null;
            refocus();
        },
        dispose: () => {
            disposed = true;
            collision?.resolve({kind: "cancel"}, false);
            collision = null;
            drag.value = null;
            dragItems = null;
            stopPrune();
            stopRoots();
            model.dispose();
        },
    };
}

