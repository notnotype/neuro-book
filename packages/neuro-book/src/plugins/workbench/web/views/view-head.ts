/**
 * 视图的标题区的工作台一端（docs/specs/workbench/views.md 输出 19）：外壳持有的控制，面板头画出或拆掉位置时写，按下标题时转给视图。
 * 视图拿到的那一端（`ViewHead`、`viewHeadOf`）在共用合同里，见 `shared/contracts.ts` 的“视图的标题区”。
 */

import {ref, shallowRef} from "vue";

import {attachViewHead} from "../../shared/contracts";
import type {ViewHead, ViewHeadSlots} from "../../shared/contracts";
import type {ViewContext} from "../contracts";

/** 面板头画出的几个位置：工作台自己按元素用；交给视图时就是共用合同的 `ViewHeadSlots`。 */
export interface PanelHeadSlots extends ViewHeadSlots {
    readonly start: HTMLElement;
    readonly title: HTMLElement;
    readonly end: HTMLElement;
    readonly handle: HTMLElement;
}

/** 外壳持有的一端：面板头画出或拆掉位置时写 `slots`，按下标题时 `press`，自绘头开始、结束时 `setOwnHead`。 */
export interface ViewHeadControl {
    readonly head: ViewHead;
    setSlots(slots: PanelHeadSlots | null): void;
    press(): void;
    setOwnHead(own: boolean): void;
}

/** 每一代上下文一份：实例换代时外壳拿到新的一份；旧的那份的位置被清成 null，之后不再收到位置与按下。 */
export function createViewHead(context: ViewContext): ViewHeadControl {
    const slots = shallowRef<PanelHeadSlots | null>(null);
    const listeners = new Set<() => void>();
    const ownHead = ref(false);
    const head: ViewHead = {
        slots,
        onTitlePress(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        titlePopup: ref<{readonly expanded: boolean} | null>(null),
        claim: ref(true),
        ownHead,
    };
    attachViewHead(context, head);
    return {
        head,
        setSlots: (next) => {
            slots.value = next;
        },
        press: () => {
            for (const listener of [...listeners]) listener();
        },
        setOwnHead: (own) => {
            ownHead.value = own;
        },
    };
}
