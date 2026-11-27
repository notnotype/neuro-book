/**
 * 回执页 `nbook.canon.receipt`（docs/specs/canon/author-ui.md 输出 20；workbench/editor.md 输出 33）：编辑器的页面贡献，参数是修订
 * id，每次修订一个标签，刷新后恢复。页面没有自己的标签状态。标签标题与面包屑读“各次修订最近读到的标题”，由挂着的回执页写入。
 */

import {defineComponent, h, reactive} from "vue";
import type {PropType} from "vue";

import type {EditorPageContext, EditorPageCrumb, EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {OPEN_VIEW_COMMAND} from "nbook/plugins/workbench/shared/contracts";

import {canonText} from "../shared/text";
import {OPEN_CHANGE_COMMAND, OPEN_ENTRY_COMMAND, OPEN_RECEIPT_COMMAND} from "./commands";
import type {CanonNotices} from "./notices";
import type {RevertRequests} from "./revert";
import {useCanonText} from "./text";
import type {CanonWorld} from "./world";

export interface ReceiptPageOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly notices: CanonNotices;
    readonly revert: RevertRequests;
    readonly execute: (id: string, args: unknown) => void;
    /** 设定视图与改动记录视图的 id：面包屑的前两段显示它们。 */
    readonly entriesView: string;
    readonly revisionsView: string;
}

export function createReceiptPage(options: ReceiptPageOptions): EditorPageImplementation {
    const titles = reactive(new Map<string, string>());
    const open = (ref: {readonly kind: "entry" | "change"; readonly id: string}): void => {
        options.execute(ref.kind === "entry" ? OPEN_ENTRY_COMMAND : OPEN_CHANGE_COMMAND, {id: ref.id});
    };
    const receipt = (revision: string): void => options.execute(OPEN_RECEIPT_COMMAND, {revision});
    return {
        load: async () => {
            const Host = (await import("./components/revisions/ReceiptPageHost.vue")).default;
            return defineComponent({
                name: "CanonReceiptPage",
                props: {context: {type: Object as PropType<EditorPageContext>, required: true}},
                setup(props) {
                    const text = useCanonText();
                    return () => {
                        const world = options.world();
                        const id = props.context.arg;
                        if (world === null || id === undefined) return h("p", {class: "px-6 py-4 text-[length:var(--text-sm)] text-[var(--text-muted)]"}, text("world.unbound"));
                        return h(Host, {key: id, id, world, notices: options.notices, revert: options.revert, open, receipt, onTitle: (title: string) => titles.set(id, title)});
                    };
                },
            });
        },
        title: (arg) => (arg === undefined ? null : titles.get(arg) ?? null),
        breadcrumbs: (arg) => {
            const title = arg === undefined ? undefined : titles.get(arg);
            if (title === undefined) return null;
            const crumbs: EditorPageCrumb[] = [
                {label: canonText("views.entries.title"), command: {id: OPEN_VIEW_COMMAND, args: {viewId: options.entriesView}}},
                {label: canonText("receipt.revisionsCrumb"), command: {id: OPEN_VIEW_COMMAND, args: {viewId: options.revisionsView}}},
                {label: title},
            ];
            return crumbs;
        },
    };
}
