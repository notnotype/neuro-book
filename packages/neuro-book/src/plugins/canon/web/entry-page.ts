/**
 * 条目页 `nbook.canon.entry`（docs/specs/canon/author-ui.md 输出 6、7；workbench/editor.md 输出 33）：编辑器的页面贡献，参数是条目
 * id，每个条目一个标签，刷新后恢复。
 *
 * 标签状态（位置、按计划、分页、展开的来历、各数据分页的状态）在编辑器给每个标签的 `state` 里：页面不在前台时组件已经卸载。
 * 标签标题与面包屑读本模块的“各条目最近读到的页头”，由挂着的条目页写入，不为它们另发请求；页面不在前台时编辑器用它记着的
 * 标题。
 */

import {defineComponent, h, onBeforeUnmount, onMounted, reactive, ref} from "vue";
import type {Component, PropType, Ref} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";

import type {EditorPageContext, EditorPageCrumb, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {OPEN_VIEW_COMMAND} from "nbook/plugins/workbench/shared/contracts";

import type {CanonClient, CanonOutputs, EntryName} from "../shared/contracts";
import {MAIN_LINE} from "../shared/reads";
import type {LineOption} from "../shared/reads";
import {canonText} from "../shared/text";
import {OPEN_CHANGE_COMMAND, OPEN_ENTRY_COMMAND, OPEN_RECEIPT_COMMAND} from "./commands";
import type {EntryKind} from "../shared/entry-kinds";
import type {CanonImages} from "./images";
import type {EntryTabDeclaration} from "../shared/entry-tabs";
import {ComponentViewRegistry} from "./component-views";
import type {TextAddress} from "./components/entry-text";
import type {EditDraft} from "./in-place-edit";
import type {CanonNotices} from "./notices";
import type {OriginsPage} from "./origin-pages";
import type {RevertRequests} from "./revert";
import {useCanonText} from "./text";
import type {TextDrafts} from "./text-drafts";
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
    /** 编辑主文字时预览开着（输出 48）。加这一项之前存下的标签没有它，按开着算。 */
    preview?: boolean;
    /** 选过的那一章被删掉了，已经回到缺省位置。换一次位置以后清掉。 */
    positionGone: boolean;
    /** 各数据分页的界面的状态，按命名空间（`ComponentViewContext.state`）。 */
    views: Record<string, Record<string, unknown>>;
    /** 各附加分页的状态，按贡献 id（`EntryTabContext.state`，输出 36）。 */
    extras: Record<string, Record<string, unknown>>;
    /** 开着的确认条与填了一半的输入（输出 16）。 */
    edit: EditDraft | null;
}

export function entryPageState(): EntryPageState {
    return {position: null, planned: false, tab: null, origin: null, preview: true, positionGone: false, views: {}, extras: {}, edit: null};
}

/** 一个条目最近读到的页头：标签标题与面包屑用。 */
export interface EntryHead {
    readonly name: string;
    readonly folder: string;
    readonly ancestors: readonly EntryName[];
    /** 条目的种类（`type`）：标签的图标按它取（workbench/editor.md 输出 53）。 */
    readonly kind: string;
}

/** 条目页标签的缺省图标：种类没登记图标、或还没读到条目时；与欢迎页的书分开。 */
export const ENTRY_PAGE_ICON = "i-lucide-bookmark";

/** 页面要的那部分窗口的线：读哪条、可选哪些、改它。 */
export interface PageLine {
    readonly line: Readonly<Ref<string>>;
    readonly options: Readonly<Ref<readonly LineOption[]>>;
    set(line: string): void;
}

/** 没有附加分页的贡献点时（测试窗口）。 */
const NO_TABS = new ComponentViewRegistry<EntryTabDeclaration>();

/** 没有窗口的线时（测试窗口）：总是按章节自动，只有主线。 */
const FOLLOW_ONLY: PageLine = {line: ref(""), options: ref([{id: MAIN_LINE, name: null, depth: 0}]), set: () => undefined};

export interface EntryPageOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly fetchOrigins: (address: TextAddress, position: ReadPosition, mode: "actual" | "planned", cursor?: string) => Promise<OriginsPage>;
    /** 世界客户端的读取（预览、读一个对象）。 */
    readonly call: CanonClient["call"];
    readonly views: ComponentViewRegistry;
    /** 附加分页（输出 36）；不给时没有。 */
    readonly entryTabs?: ComponentViewRegistry<EntryTabDeclaration>;
    /** 本窗口的保存后的提示。 */
    readonly notices: CanonNotices;
    /** 本窗口的还原对话框。 */
    readonly revert: RevertRequests;
    /** 执行命令（打开条目页、变更详情页）。 */
    readonly execute: (id: string, args: unknown) => void;
    /** 设定视图的 id：面包屑的“设定”显示它。 */
    readonly entriesView: string;
    /** 窗口在看的线（输出 34）；不给时总是按章节自动、“在看”不提线。 */
    readonly windowLine?: PageLine;
    /**
     * 一个条目页挂上了：设定视图据此选中它的条目。页面标签只在所在组的活动标签时挂载，挂上说明它刚显示出来：切到这个标签、把它拖到
     * 别的组、刷新后恢复都会挂一次，所以拆成几组时选中的是最后挂上的那一页，不一定是焦点所在的；在组之间换焦点不会再挂。编辑器的
     * 公开状态只给文件标签的地址、没有活动页面，按挂上判断不用改编辑器。
     */
    readonly shown?: (entry: string) => void;
    /** 本窗口的主文字稿（输出 44 到 46）：标签的未保存圆点问它，条目页的编辑视图用它的会话。 */
    readonly drafts: TextDrafts;
    /** 源文字的输入框（编辑器插件的代码输入框）；窗口里没有编辑器插件时为 null。 */
    readonly sourceInput?: Component | null;
    /** 登记的条目种类（`canon.entry-kinds`，已并好）：分页的顺序用（author-ui.md 输出 9）；不给时没有排在“文字”前面的分页。 */
    readonly entryKinds?: () => readonly EntryKind[];
    /** 设定里的图片（输出 53）；窗口里没有文件服务时不给。 */
    readonly images?: CanonImages | null;
}

export function createEntryPage(options: EntryPageOptions): EditorPageImplementation<EntryPageState> {
    const heads = reactive(new Map<string, EntryHead>());
    /**
     * 挂着的条目页交来的“提交主文字”，按条目各记一串：同一个条目可以在两个编辑组里各开一页，哪一页卸载只撤自己的那一个。
     * 提交用最后挂上的那一页的（它们对着同一份稿，谁发都一样）。
     */
    const commits = new Map<string, Array<() => Promise<void>>>();
    const withdraw = (id: string, commit: () => Promise<void>): void => {
        const rest = (commits.get(id) ?? []).filter((item) => item !== commit);
        if (rest.length === 0) commits.delete(id);
        else commits.set(id, rest);
    };
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
                    /** 这一页交来的提交入口（它的宿主换了、卸载了就撤掉）。 */
                    let mine: {readonly id: string; readonly commit: () => Promise<void>} | null = null;
                    // 种类的登记只在装插件时变，页面挂上时读一次。
                    const kinds = options.entryKinds?.() ?? [];
                    const register = (id: string, commit: (() => Promise<void>) | null): void => {
                        if (mine !== null) withdraw(mine.id, mine.commit);
                        mine = commit === null ? null : {id, commit};
                        if (commit !== null) commits.set(id, [...(commits.get(id) ?? []), commit]);
                    };
                    onMounted(() => {
                        if (props.context.arg !== undefined) options.shown?.(props.context.arg);
                    });
                    onBeforeUnmount(() => {
                        if (mine !== null) withdraw(mine.id, mine.commit);
                        mine = null;
                    });
                    return () => {
                        const world = options.world();
                        const id = props.context.arg;
                        if (world === null || id === undefined) return h("p", {class: "px-6 py-4 text-[length:var(--text-sm)] text-[var(--text-muted)]"}, text("world.unbound"));
                        // 换了参数（不会发生：参数是标签的身份）也按 key 重建，免得宿主里的读取还指着旧条目。
                        return h(Host, {key: id, id, state: props.context.state, world, fetchOrigins: options.fetchOrigins, client: {call: options.call}, windowLine: options.windowLine ?? FOLLOW_ONLY, views: options.views, entryTabs: options.entryTabs ?? NO_TABS, notices: options.notices, revert: options.revert, open, receipt: (revision: string) => options.execute(OPEN_RECEIPT_COMMAND, {revision}), onHead: (head: EntryHead) => heads.set(id, head), draft: options.drafts.session(id), sourceInput: options.sourceInput ?? null, onCommitReady: (commit: (() => Promise<void>) | null) => register(id, commit), entryKinds: kinds, images: options.images ?? null});
                    };
                },
            });
        },
        title: (arg) => (arg === undefined ? null : heads.get(arg)?.name ?? null),
        // 标签的图标按条目的种类（输出 53）：人物、组织、地点、物品各一个，没登记图标的种类用缺省的；还没读到条目时交给记着的。
        icon: (arg) => {
            const head = arg === undefined ? undefined : heads.get(arg);
            if (head === undefined) return null;
            return (options.entryKinds?.() ?? []).find((item) => item.kind === head.kind.trim())?.icon ?? ENTRY_PAGE_ICON;
        },
        initialState: () => entryPageState(),
        // 有没提交的主文字时标签带未保存的圆点，Ctrl+S 提交它（workbench/editor.md 输出 68）。
        uncommitted: (arg) => arg !== undefined && options.drafts.uncommitted(arg),
        commit: async (arg) => {
            const commit = arg === undefined ? undefined : commits.get(arg)?.at(-1);
            // 页面还没挂上（刚切到这个标签、组件还在加载）：没有能提交的入口。不当成提交过了，让“保存”报没保存成功。
            if (commit === undefined) throw new Error("条目页还没有挂上，这一次没有提交");
            await commit();
        },
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
