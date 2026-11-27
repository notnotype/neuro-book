/**
 * 变更详情页 `nbook.canon.change`（docs/specs/canon/author-ui.md 输出 21；workbench/editor.md 输出 33）：编辑器的页面贡献，参数是
 * 剧情变更 id，每条变更一个标签，刷新后恢复。标签状态是填了一半的改动（`ChangeDraft`），切走再回来还在。标签标题与面包屑读
 * “各条变更最近读到的文字与安放”，由挂着的详情页写入。
 */

import {defineComponent, h, reactive} from "vue";
import type {PropType} from "vue";

import type {EditorPageContext, EditorPageCrumb, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {OPEN_VIEW_COMMAND} from "nbook/plugins/workbench/shared/contracts";

import type {CanonClient} from "../shared/contracts";
import {canonText} from "../shared/text";
import type {ChangeDraft} from "./change-edit";
import {OPEN_CHANGE_COMMAND, OPEN_ENTRY_COMMAND, OPEN_RECEIPT_COMMAND} from "./commands";
import type {CanonNotices} from "./notices";
import type {RevertRequests} from "./revert";
import {useCanonText} from "./text";
import type {CanonWorld} from "./world";

export interface ChangePageState {
    /** 填了一半的改动（改一处的值或改成生效）。 */
    edit: ChangeDraft | null;
}

/** 标签标题与面包屑里的文字最多这么多个字，多的截掉写省略号（输出 21）。 */
export const CHANGE_TITLE_MAX = 24;

export function shortText(value: string): string {
    const chars = [...value];
    return chars.length <= CHANGE_TITLE_MAX ? value : `${chars.slice(0, CHANGE_TITLE_MAX).join("")}…`;
}

export interface ChangePageOptions {
    readonly world: () => CanonWorld | null;
    readonly call: CanonClient["call"];
    readonly notices: CanonNotices;
    readonly revert: RevertRequests;
    readonly execute: (id: string, args: unknown) => void;
    /** 打开一章的正文；没找到这一章的文件时 resolve 为 false。 */
    readonly openChapter: (chapter: string) => Promise<boolean>;
    /** 设定视图的 id：面包屑的“设定”显示它。 */
    readonly entriesView: string;
}

export function createChangePage(options: ChangePageOptions): EditorPageImplementation<ChangePageState> {
    const heads = reactive(new Map<string, {readonly text: string; readonly place: string}>());
    const open = (ref: {readonly kind: "entry" | "change"; readonly id: string}): void => {
        options.execute(ref.kind === "entry" ? OPEN_ENTRY_COMMAND : OPEN_CHANGE_COMMAND, {id: ref.id});
    };
    const receipt = (revision: string): void => options.execute(OPEN_RECEIPT_COMMAND, {revision});
    return {
        load: async () => {
            const Host = (await import("./components/revisions/ChangePageHost.vue")).default;
            return defineComponent({
                name: "CanonChangePage",
                props: {context: {type: Object as PropType<EditorPageContext<ChangePageState>>, required: true}},
                setup(props) {
                    const text = useCanonText();
                    return () => {
                        const world = options.world();
                        const id = props.context.arg;
                        if (world === null || id === undefined) return h("p", {class: "px-6 py-4 text-[length:var(--text-sm)] text-[var(--text-muted)]"}, text("world.unbound"));
                        return h(Host, {key: id, id, state: props.context.state, world, client: {call: options.call}, notices: options.notices, revert: options.revert, open, receipt, openChapter: options.openChapter, onHead: (head: {readonly text: string; readonly place: string}) => heads.set(id, head)});
                    };
                },
            });
        },
        title: (arg) => {
            const head = arg === undefined ? undefined : heads.get(arg);
            return head === undefined ? null : shortText(head.text);
        },
        initialState: () => ({edit: null}),
        // 只有“设定”可点：安放的位置不是一个页面。
        breadcrumbs: (arg) => {
            const head = arg === undefined ? undefined : heads.get(arg);
            if (head === undefined) return null;
            const crumbs: EditorPageCrumb[] = [
                {label: canonText("views.entries.title"), command: {id: OPEN_VIEW_COMMAND, args: {viewId: options.entriesView}}},
                {label: head.place},
                {label: shortText(head.text)},
            ];
            return crumbs;
        },
    };
}
