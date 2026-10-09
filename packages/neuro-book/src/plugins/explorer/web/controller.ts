/**
 * 资源管理器的控制器（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：持有树模型、选择、显示
 * 偏好与提示。入口在视图第一次挂上时建一个，活到入口停止；视图停放、移动、渲染重试只解绑再绑定同一个控制器。组件经它
 * 取数据、发动作，不持有文件客户端或网络协议。
 */

import {computed, shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {FilesService} from "nbook/plugins/files/shared/contracts";

import {parentAddress} from "./tree/address";
import {treeKey} from "./tree/keys";
import type {TreeKey} from "./tree/keys";
import {createTreeModel} from "./tree/model";
import type {TreeModel} from "./tree/model";
import {projectRows} from "./tree/rows";
import type {Row} from "./tree/rows";
import {click, contextSelect, EMPTY_SELECTION, followPaths, prune} from "./tree/selection";
import type {Modifiers, Selection} from "./tree/selection";

/** 打开编辑器的命令；编辑器区随 t71 登记它。 */
export const OPEN_COMMAND = "nbook.editor.open";

export type OpenMode = "preview" | "permanent";

/** 结果区的一条提示。文件操作的逐项结果随操作一起加入。 */
export type Notice =
    | {readonly kind: "editor-missing"; readonly address: string}
    | {readonly kind: "open-failed"; readonly address: string; readonly reason: string};

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
    click(id: string, modifiers: Modifiers, part: RowPart): void;
    /** 双击：以常驻方式打开。 */
    activate(id: string): void;
    contextSelect(id: string): void;
    /** 树内按键；返回是否处理了（处理了的由视图阻止默认行为）。`page` 是一页的行数。 */
    key(key: TreeKey, page: number): boolean;
    setShowManifests(show: boolean): void;
    dismissNotice(): void;
    dispose(): void;
}

export function createExplorerController(options: ExplorerControllerOptions): ExplorerController {
    let disposed = false;
    const selection = shallowRef<Selection>(EMPTY_SELECTION);
    const showManifests = shallowRef(options.showManifests ?? false);
    const notice = shallowRef<Notice | null>(null);
    const model = createTreeModel({
        files: options.files,
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
    const rows = computed(() => projectRows({roots: model.roots.value, slots: model.slots.value, expanded: model.expanded.value, showManifests: showManifests.value}));
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
            selection.value = prune(selection.value, next, pruned, pending);
            pruned = next;
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
        if (row.kind === "status" || (row.kind === "root" && row.status.kind === "unbound") || (row.kind === "entry" && !row.expandable)) return;
        if (row.expanded) model.collapse(row.id);
        else model.expand(row.id);
    };

    return {
        model,
        rows,
        selection,
        showManifests,
        notice,
        click: (id, modifiers, part) => {
            const row = find(id);
            if (row === undefined || row.kind === "status") return;
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
                    return false;
                case "select":
                    selection.value = effect.selection;
                    return true;
                case "expand":
                    model.expand(effect.address);
                    return true;
                case "collapse":
                    model.collapse(effect.address);
                    return true;
                case "open":
                    void open(effect.address, "permanent");
                    return true;
                case "menu":
                    return false;
            }
        },
        setShowManifests: (show) => {
            showManifests.value = show;
        },
        dismissNotice: () => {
            notice.value = null;
        },
        dispose: () => {
            disposed = true;
            stopPrune();
            model.dispose();
        },
    };
}
