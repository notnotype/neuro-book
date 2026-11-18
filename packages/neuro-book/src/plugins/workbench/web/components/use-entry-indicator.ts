/**
 * 入口条里按下的那个入口的选中标记（docs/specs/ui/workbench-layout.md 输出 22、42、47）：活动栏与右栏入口条的按下底色、底部面板入口条的下划线。
 * 标记不画在按钮上，是条目区里一个独立的块，位置量按下的那个入口。区域切换容器、内容滚过去的那一次（`slideToken` 变了），它和内容同时滑过去
 * （`sliding`，时长与曲线同布局过渡，由组件的样式给）；别的时候直接到位：窗口缩放、入口收进“更多”、拖动中入口换位、别的途径换了当前容器。
 * 没有按下的（区域隐藏）时留在原处淡出，再按下时在新的位置淡入，不滑；第一次放下时不淡入（`settled` 之前没有过渡）。
 *
 * 组件把返回的 `element` 绑在块上、`style` 与三个标记写在块上、`onTransitionEnd` 接块的 `transitionend`；块要是条目区的子元素。
 */

import {computed, nextTick, onMounted, ref, watch} from "vue";
import type {ComputedRef, Ref} from "vue";

export interface EntryIndicatorOptions {
    /** 条目区：块的位置相对它，按钮的位置沿 `offsetParent` 一路加到它。 */
    readonly band: Readonly<Ref<HTMLElement | null>>;
    /** 此刻按下的入口与它的按钮；没有按下的、按钮还没挂上时是 null。 */
    readonly pressed: () => {readonly id: string; readonly button: HTMLElement} | null;
    /** 条里摆出了入口：挂上时文档可能还没到、入口是空的，那一次不算第一次放下。 */
    readonly hasEntries: () => boolean;
    /** 宿主让内容滚过去的那一次换一个新值，和按下的入口在同一次更新里变。 */
    readonly slideToken: () => number;
    /** 会挪动按下的入口的东西（按下的是哪个、摆出来的入口、条目区与入口的尺寸）：变了才重新量。拖动预览每一帧都换新的入口数组，只按这个比，不每帧量。 */
    readonly layoutKey: () => string;
}

export interface EntryIndicator {
    readonly element: Ref<HTMLElement | null>;
    readonly shown: Readonly<Ref<boolean>>;
    readonly sliding: Readonly<Ref<boolean>>;
    readonly settled: Readonly<Ref<boolean>>;
    readonly style: ComputedRef<Record<string, string>>;
    readonly onTransitionEnd: (event: TransitionEvent) => void;
}

/**
 * 入口相对条目区的位置：沿 `offsetParent` 一路加到条目区。`offset*` 是排版的位置、不含 `transform`，拖动中按钮外层带着换位的 `translate`
 * （它可能成了按钮的 `offsetParent`）也量到的是终点；量不到条目区（还没挂上，或按钮不在它里面）时是 null。
 */
function offsetIn(band: HTMLElement | null, button: HTMLElement): {readonly x: number; readonly y: number} | null {
    let x = 0;
    let y = 0;
    // 没有排版的环境（DOM 测试）里 `offsetParent` 是 undefined，当作量不到。
    for (let element: HTMLElement | null = button; element !== band; element = (element.offsetParent ?? null) as HTMLElement | null) {
        if (element === null) return null;
        x += element.offsetLeft;
        y += element.offsetTop;
    }
    return {x, y};
}

export function useEntryIndicator(options: EntryIndicatorOptions): EntryIndicator {
    const element = ref<HTMLElement | null>(null);
    const at = ref<{readonly x: number; readonly y: number; readonly width: number; readonly height: number} | null>(null);
    const shown = ref(false);
    const sliding = ref(false);
    const settled = ref(false);
    let placedOn: string | null = null;
    let placedToken = options.slideToken();

    /**
     * 第一次放下不淡入：有了入口的那一次放置画进 DOM 之后，强制算一次样式（过渡的起点就是放好的样子），再打开过渡。
     * 那一次没有按下的（区域隐藏着），之后按下时照常淡入。
     */
    let settling = false;
    function settleAfterFirstPlacement(): void {
        if (settled.value || settling || !options.hasEntries()) return;
        settling = true;
        void nextTick(() => {
            element.value?.getBoundingClientRect();
            settled.value = true;
        });
    }

    function place(): void {
        const pressed = options.pressed();
        const token = options.slideToken();
        const switched = token !== placedToken;
        placedToken = token;
        const offset = pressed === null ? null : offsetIn(options.band.value, pressed.button);
        if (pressed === null || offset === null) {
            shown.value = false;
            placedOn = null;
            settleAfterFirstPlacement();
            return;
        }
        const next = {...offset, width: pressed.button.offsetWidth, height: pressed.button.offsetHeight};
        const current = at.value;
        const moved = current === null || current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height;
        // 挪了位置才改：滑到一半又点了别的入口，接着滑（过渡从此刻的位置重定向）；别的原因挪了位置（缩放、拖动换位）直接到位。
        if (moved) sliding.value = switched && placedOn !== null && placedOn !== pressed.id;
        placedOn = pressed.id;
        shown.value = true;
        if (moved) at.value = next;
        settleAfterFirstPlacement();
    }

    watch(() => `${options.layoutKey()}|${String(options.slideToken())}`, place, {flush: "post"});
    onMounted(place);

    /**
     * 滑完再摘掉过渡。滑到一半又换了一次（又点了别的入口）时浏览器先取消上一段、马上开始下一段：这时摘掉，下一段也跟着没了，块一下子到终点；
     * 所以不听 `transitioncancel`，`transitionend` 来时还有别的 `transform` 过渡在走也不摘。
     */
    function onTransitionEnd(event: TransitionEvent): void {
        if (event.propertyName !== "transform") return;
        const running = (event.currentTarget as HTMLElement).getAnimations().some((animation) => (animation as Animation & {transitionProperty?: string}).transitionProperty === "transform");
        if (!running) sliding.value = false;
    }

    const style = computed((): Record<string, string> => {
        const rect = at.value;
        return rect === null ? {} : {transform: `translate(${String(rect.x)}px, ${String(rect.y)}px)`, width: `${String(rect.width)}px`, height: `${String(rect.height)}px`};
    });

    return {element, shown, sliding, settled, style, onTransitionEnd};
}
