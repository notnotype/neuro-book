/**
 * 条目页 `nbook.canon.entry`（docs/specs/canon/author-ui.md 输出 6、7；workbench/editor.md 输出 33）：编辑器的页面贡献，参数是条目
 * id，每个条目一个标签，刷新后恢复。
 *
 * 标签状态（位置、按计划、分页、展开的来历、各数据分页的状态）在编辑器给每个标签的 `state` 里：页面不在前台时组件已经卸载。
 * 标签标题与面包屑读本模块的“各条目最近读到的页头”，由挂着的条目页写入，不为它们另发请求；页面不在前台时编辑器用它记着的
 * 标题。
 */

import {defineComponent, h, reactive} from "vue";
import type {PropType} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";

import type {EditorPageContext, EditorPageCrumb, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {OPEN_VIEW_COMMAND} from "nbook/plugins/workbench/shared/contracts";

import type {CanonClient, CanonOutputs, EntryName} from "../shared/contracts";
import {canonText} from "../shared/text";
import {OPEN_ENTRY_COMMAND} from "./commands";
import type {ComponentViewRegistry} from "./component-views";
import type {TextAddress} from "./components/entry-text";
import type {EditDraft} from "./in-place-edit";
import type {CanonNotices} from "./notices";
import type {OriginsPage} from "./origin-pages";
import {useCanonText} from "./text";
import type {CanonWorld} from "./world";

/** 条目页标签的状态（输出 7）。 */
export interface EntryPageState {
    /** 位置选择的值（`positions.ts` 的 `positionValue`）；null 是缺省位置，跟着章表走。 */
    position: string | null;
    planned: boolean;
    /** 当前分页；null 或已经没有这个分页时是第一个。 */
    tab: string | null;
    /** 文字分页里展开着来历的值（`addressKey`）。 */
    origin: string | null;
    /** 选过的那一章被删掉了，已经回到缺省位置。换一次位置以后清掉。 */
    positionGone: boolean;
    /** 各数据分页的界面的状态，按命名空间（`ComponentViewContext.state`）。 */
    views: Record<string, Record<string, unknown>>;
    /** 开着的确认条与填了一半的输入（输出 16）。 */
    edit: EditDraft | null;
}

export function entryPageState(): EntryPageState {
    return {position: null, planned: false, tab: null, origin: null, positionGone: false, views: {}, edit: null};
}

/** 一个条目最近读到的页头：标签标题与面包屑用。 */
export interface EntryHead {
    readonly name: string;
    readonly folder: string;
    readonly ancestors: readonly EntryName[];
}

export interface EntryPageOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly fetchOrigins: (address: TextAddress, position: ReadPosition, mode: "actual" | "planned", cursor?: string) => Promise<OriginsPage>;
    /** 世界客户端的读取（预览、读一个对象）。 */
    readonly call: CanonClient["call"];
    readonly views: ComponentViewRegistry;
    /** 本窗口的保存后的提示。 */
    readonly notices: CanonNotices;
    /** 执行命令（打开条目页、变更详情页）。 */
    readonly execute: (id: string, args: unknown) => void;
    /** 设定视图的 id：面包屑的“设定”显示它。 */
    readonly entriesView: string;
}

/** 变更详情页与回执页的命令（S6 登记）；在那之前执行它们得到命令服务的“没有这条命令”。 */
const OPEN_CHANGE_COMMAND = "nbook.canon.open-change";
const OPEN_RECEIPT_COMMAND = "nbook.canon.open-receipt";

export function createEntryPage(options: EntryPageOptions): EditorPageImplementation<EntryPageState> {
    const heads = reactive(new Map<string, EntryHead>());
    const open = (ref: {readonly kind: "entry" | "change"; readonly id: string}): void => {
        options.execute(ref.kind === "entry" ? OPEN_ENTRY_COMMAND : OPEN_CHANGE_COMMAND, {id: ref.id});
    };
    return {
        load: async () => {
            const Host = (await import("./components/EntryPageHost.vue")).default;
            return defineComponent({
                name: "CanonEntryPage",
                props: {context: {type: Object as PropType<EditorPageContext<EntryPageState>>, required: true}},
                setup(props) {
                    const text = useCanonText();
                    return () => {
                        const world = options.world();
                        const id = props.context.arg;
                        if (world === null || id === undefined) return h("p", {class: "px-6 py-4 text-[length:var(--text-sm)] text-[var(--text-muted)]"}, text("world.unbound"));
                        // 换了参数（不会发生：参数是标签的身份）也按 key 重建，免得宿主里的读取还指着旧条目。
                        return h(Host, {key: id, id, state: props.context.state, world, fetchOrigins: options.fetchOrigins, call: options.call, views: options.views, notices: options.notices, open, receipt: (revision: string) => options.execute(OPEN_RECEIPT_COMMAND, {revision}), onHead: (head: EntryHead) => heads.set(id, head)});
                    };
                },
            });
        },
        title: (arg) => (arg === undefined ? null : heads.get(arg)?.name ?? null),
        initialState: () => entryPageState(),
        breadcrumbs: (arg) => {
            const head = arg === undefined ? undefined : heads.get(arg);
            if (head === undefined) return null;
            const crumbs: EditorPageCrumb[] = [{label: canonText("views.entries.title"), command: {id: OPEN_VIEW_COMMAND, args: {viewId: options.entriesView}}}];
            if (head.folder !== "") crumbs.push({label: head.folder});
            for (const ancestor of head.ancestors) crumbs.push({label: ancestor.name, command: {id: OPEN_ENTRY_COMMAND, args: {id: ancestor.id}}});
            crumbs.push({label: head.name});
            return crumbs;
        },
    };
}

/**
 * 世界客户端的 `origins` 包成条目页要的取页函数：失败时 reject，说明取服务给的 `detail`（没有时为空）。不把失败码给作者看
 * （author-ui.md 输出 29）；`cursor-stale` 由取页的一方按已读步数重读，不显示。
 */
export function originsFetcher(call: (input: {readonly at: TextAddress; readonly position: ReadPosition; readonly mode: "actual" | "planned"; readonly cursor?: string}) => Promise<{readonly ok: true; readonly value: CanonOutputs["origins"]} | {readonly ok: false; readonly failure: {readonly code: string; readonly [detail: string]: unknown}}>): EntryPageOptions["fetchOrigins"] {
    return async (address, position, mode, cursor) => {
        const result = await call({at: address, position, mode, ...(cursor === undefined ? {} : {cursor})});
        if (!result.ok) throw new Error(typeof result.failure.detail === "string" ? result.failure.detail : "");
        return result.value;
    };
}
