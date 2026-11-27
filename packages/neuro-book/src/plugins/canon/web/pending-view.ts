/**
 * “待处理”视图（docs/specs/canon/author-ui.md 输出 23、25、33）：底部面板里的一个隐式容器。选中哪一条、哪几组展开着记在窗口里
 * （`PendingViewState`），视图停放、卸载再挂上时还在。读取、选中的规则与强行解除在宿主 `PendingViewHost`；这里只按窗口有没有
 * 绑定项目挂宿主，并把视图上下文的 `visible` 交给它（不可见时不读，输出 26）。
 */

import {defineComponent, h, shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";

import type {PendingGroup, PendingTarget} from "./pending";
import {useCanonText} from "./text";
import {unboundView, viewContextProp, viewVisible} from "./view-visible";
import type {CanonWorld} from "./world";

/** 选中的那一条：组、键（`pending.ts` 的 `pendingKey`），与它在组里的位置（每次读到现在的结果时跟着更新；它消失以后选这个位置上的那一条）。 */
export interface PendingSelection {
    readonly group: PendingGroup;
    readonly key: string;
    readonly index: number;
}

export interface PendingViewState {
    readonly selected: ShallowRef<PendingSelection | null>;
    /** 下一次读到“待处理”一组时选中它的第一条：第一次打开视图与 `nbook.canon.show-pending` 之后为真。 */
    readonly pickFirst: ShallowRef<boolean>;
    readonly expanded: ShallowRef<readonly PendingGroup[]>;
}

export function pendingViewState(): PendingViewState {
    return {selected: shallowRef(null), pickFirst: shallowRef(true), expanded: shallowRef(["pending"])};
}

/** `nbook.canon.show-pending`：展开“待处理”一组，选回它的第一条（输出 25 的状态栏条目点的就是它）。 */
export function pickFirstPending(state: PendingViewState): void {
    if (!state.expanded.value.includes("pending")) state.expanded.value = ["pending", ...state.expanded.value];
    state.pickFirst.value = true;
}

export interface PendingViewOptions {
    /** 窗口没有绑定项目时为 null。 */
    readonly world: () => CanonWorld | null;
    readonly state: PendingViewState;
    /** 打开条目页、变更详情页或回执页（命令 `nbook.canon.open-entry`、`nbook.canon.open-change`、`nbook.canon.open-receipt`）。 */
    readonly open: (target: PendingTarget) => void;
    /** “打开这一章”：在编辑区打开那一章的正文。 */
    readonly openChapter: (chapter: string) => void;
}

export function createPendingView(options: PendingViewOptions): ViewImplementation {
    return {
        load: async () => {
            const Host = (await import("./components/revisions/PendingViewHost.vue")).default;
            return defineComponent({
                name: "CanonPendingView",
                props: viewContextProp,
                setup(props) {
                    const text = useCanonText();
                    const visible = viewVisible(props);
                    return () => {
                        const world = options.world();
                        if (world === null) return unboundView(text);
                        return h(Host, {world, state: options.state, open: options.open, openChapter: options.openChapter, visible: visible.value});
                    };
                },
            });
        },
    };
}
