/**
 * “改动记录”视图（docs/specs/canon/author-ui.md 输出 24、33）：底部面板里的一个隐式容器。筛选与当前行记在窗口里
 * （`RevisionsViewState`），视图停放、卸载再挂上时还在。读取、还原与“查看详情”在宿主 `RevisionsViewHost`；这里只按窗口有没有
 * 绑定项目挂宿主，并把视图上下文的 `visible` 交给它（不可见时不读，输出 26）。
 */

import {defineComponent, h, shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";

import type {RevertRequests} from "./revert";
import {ALL} from "./revisions";
import {useCanonText} from "./text";
import {unboundView, viewContextProp, viewVisible} from "./view-visible";
import type {CanonWorld} from "./world";

export interface RevisionsViewState {
    /** 按章筛：章 id，或 `ALL`。 */
    readonly chapter: ShallowRef<string>;
    /** 按写入者筛：写入者的种类，或 `ALL`。 */
    readonly writer: ShallowRef<string>;
    /** 键盘的当前行（修订 id）。 */
    readonly current: ShallowRef<string | null>;
}

export function revisionsViewState(): RevisionsViewState {
    return {chapter: shallowRef(ALL), writer: shallowRef(ALL), current: shallowRef(null)};
}

export interface RevisionsViewOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly state: RevisionsViewState;
    readonly revert: RevertRequests;
    /** 打开一次修订的回执页（命令 `nbook.canon.open-receipt`）。 */
    readonly receipt: (revision: string) => void;
}

export function createRevisionsView(options: RevisionsViewOptions): ViewImplementation {
    return {
        load: async () => {
            const Host = (await import("./components/revisions/RevisionsViewHost.vue")).default;
            return defineComponent({
                name: "CanonRevisionsView",
                props: viewContextProp,
                setup(props) {
                    const text = useCanonText();
                    const visible = viewVisible(props);
                    return () => {
                        const world = options.world();
                        if (world === null) return unboundView(text);
                        return h(Host, {world, state: options.state, revert: options.revert, receipt: options.receipt, visible: visible.value});
                    };
                },
            });
        },
    };
}
