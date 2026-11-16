/**
 * 视图的标题区（docs/specs/workbench/views.md 输出 19）：申请了的视图在自己的组件树里画头，用 `Teleport` 送进面板头给的位置。
 *
 * 头留在视图树里，是为了让它与视图共用状态、注入与错误边界：头渲染出错时实例变成 `render-failed`，面板头退回只写声明标题；
 * 标题按钮始终由工作台渲染，拖动、键盘拿起与右键菜单都不经过视图。
 *
 * 每一代上下文一份：实例换代时外壳拿到新的一份，旧的那份不再收到位置与按下，视图手里的旧引用自然作废。
 */

import {ref, shallowRef} from "vue";
import type {Ref} from "vue";

import type {ViewContext} from "../contracts";

/** 面板头给视图的几个位置（输出 19）。都是工作台渲染的元素，视图只往里送内容，不改它们的属性。 */
export interface ViewHeadSlots {
    readonly start: HTMLElement;
    /** 在标题按钮里面：只放文字与图标，不放可交互的元素。 */
    readonly title: HTMLElement;
    readonly end: HTMLElement;
    /** 标题按钮本身：浮层锚在它上面，关掉后焦点回到它。 */
    readonly handle: HTMLElement;
}

/** 视图这一代实例的标题区（输出 19）；经 `viewHeadOf(context)` 取，没申请的视图取到 null。 */
export interface ViewHead {
    /** 面板头此刻给视图的位置；为 null 时视图在自己的内容里画头。 */
    readonly slots: Readonly<Ref<ViewHeadSlots | null>>;
    /** 面板展开时按标题按钮（点击、回车）调它；面板收起时工作台只展开、不调。返回取消订阅。 */
    onTitlePress(listener: () => void): () => void;
    /** 标题按钮弹出的东西开着没有；null 是不弹出东西。视图写，工作台写到按钮的 `aria-haspopup`、`aria-expanded`。 */
    readonly titlePopup: Ref<{readonly expanded: boolean} | null>;
}

/** 外壳持有的一端：面板头画出或拆掉位置时写 `slots`，按下标题时 `press`。 */
export interface ViewHeadControl {
    readonly head: ViewHead;
    setSlots(slots: ViewHeadSlots | null): void;
    press(): void;
}

/** 以上下文为键：视图手里只有 `context`，不另开一条注入通道。 */
const heads = new WeakMap<ViewContext, ViewHead>();

/** 视图取自己这一代的标题区；没申请（或不是工作台建的上下文）时是 null。 */
export function viewHeadOf(context: ViewContext): ViewHead | null {
    return heads.get(context) ?? null;
}

export function createViewHead(context: ViewContext): ViewHeadControl {
    const slots = shallowRef<ViewHeadSlots | null>(null);
    const listeners = new Set<() => void>();
    const head: ViewHead = {
        slots,
        onTitlePress(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        titlePopup: ref<{readonly expanded: boolean} | null>(null),
    };
    heads.set(context, head);
    return {
        head,
        setSlots: (next) => {
            slots.value = next;
        },
        press: () => {
            for (const listener of [...listeners]) listener();
        },
    };
}
