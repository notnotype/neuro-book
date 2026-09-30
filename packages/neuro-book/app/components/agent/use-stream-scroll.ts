/**
 * 消息流的滚动：停在底部时跟随新内容；离开底部后，内容高度怎么变，视口里正在读的内容都不动。
 *
 * 不用浏览器自带的滚动锚定（`overflow-anchor`）：Tauri 在 macOS 与 Linux 上用的 WebKit 没有它，
 * 而且它会和“跟随底部”各自修正一次 scrollTop。滚动容器必须声明 `overflow-anchor: none`，
 * 由这里在内容尺寸变化之后、绘制之前（ResizeObserver 回调）统一校正。
 *
 * 锚点有两种，位置都记成内容坐标（与 scrollTop 无关），校正时在“已知的 scrollTop”上加锚点的位移：
 * 已知值只跟随用户滚动和这里自己的写入。内容变短时浏览器会先把 scrollTop 夹到新的底部并发出 scroll 事件，
 * 那不是用户在滚，不改已知值，也不据此判定停在了底部，否则校正会被跳过或从错误的位置算起。
 * - 阅读锚点：视口顶部第一个露出来的元素；和浏览器的规则一样，声明了 `overflow-anchor: none` 的元素不当锚点
 *   （例如新内容插在它后面、自己位置不变的顶部历史行）。它被移除时（例如整轮收起时过程里的一步），
 *   依次改用它的下一个兄弟、父元素、父元素的下一个兄弟……所以过程收起后固定的是紧跟在过程后面的最终回复。
 *   宿主数据变化时在调用方组件更新之前记下，避免记到已经变化的布局。
 * - 点击锚点：用户点开或收起某一项时固定被点的那一项，即使原本停在底部也不把它推走；只在点击后两帧内有效。
 */
import {onBeforeUnmount, onBeforeUpdate, onMounted, ref, type Ref} from "vue";

export type StreamScrollOptions = {
    /** 滚动容器，须声明 `overflow-anchor: none`。 */
    scroller: Ref<HTMLElement | null>;
    /** 滚动容器里唯一的内容元素；它的尺寸变化触发校正。 */
    content: Ref<HTMLElement | null>;
    /** 滚到接近顶部、或内容不足一屏时调用；要不要加载更早的内容由调用方决定。 */
    onNearTop: () => void;
};

export type StreamScroll = {
    /** 是否停在底部、跟随新内容。 */
    following: Readonly<Ref<boolean>>;
    /** 滚到最新内容并恢复跟随。 */
    scrollToLatest: () => void;
    /**
     * 等这次界面更新与校正过去之后，再看一次是否仍在顶部附近。滚动与尺寸变化时会自动检查；
     * 调用方在“没有这两种变化也可能要继续加载”时调用，例如一页加载完、补上的内容都收在已收起的轮次里。
     */
    recheckNearTop: () => void;
};

/** 距底部不超过这个距离算停在底部；给小数像素和最后一行的行高留余量。 */
const FOLLOW_THRESHOLD_PX = 24;

/** 距顶部不超过这个距离时请求更早的内容，让下一页在滚到顶之前就开始加载。 */
const NEAR_TOP_PX = 160;

/** 找阅读锚点时最多往下钻的层数；再深的节点多是行内文字，精度已经够了。 */
const MAX_ANCHOR_DEPTH = 12;

type AnchorCandidate = {element: Element; position: number};

export function useStreamScroll(options: StreamScrollOptions): StreamScroll {
    const following = ref(true);
    let reading: AnchorCandidate[] = [];
    let interaction: AnchorCandidate[] | null = null;
    /** 组件更新前记下的阅读锚点还没被校正用掉；这期间滚动不重记，否则会记到更新后的布局。 */
    let readingPinned = false;
    /** 用户滚动与本组合函数写入后的 scrollTop；浏览器因内容变短而夹住的不算。 */
    let knownScrollTop = 0;
    const frames = new Map<"capture" | "interaction" | "pin" | "recheck", number>();
    let observer: ResizeObserver | null = null;

    function elements(): {scroller: HTMLElement; content: HTMLElement} | null {
        const scroller = options.scroller.value;
        const content = options.content.value;
        return scroller === null || content === null ? null : {scroller, content};
    }

    function atBottom(scroller: HTMLElement): boolean {
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOLLOW_THRESHOLD_PX;
    }

    function captureReading() {
        const found = elements();
        if (found === null) {
            return;
        }
        const anchor = findReadingAnchor(found.content, found.scroller.getBoundingClientRect().top);
        reading = anchor === null ? [] : anchorCandidates(anchor, found.content, found.scroller);
    }

    /** 下一帧执行；同名任务未执行前再次安排时只保留一个。`twice` 表示再隔一帧，用来等一次布局与校正过去。 */
    function schedule(name: "capture" | "interaction" | "pin" | "recheck", run: () => void, twice = false) {
        const previous = frames.get(name);
        if (previous !== undefined) {
            cancelAnimationFrame(previous);
        }
        frames.set(name, requestAnimationFrame(() => {
            if (!twice) {
                frames.delete(name);
                run();
                return;
            }
            frames.set(name, requestAnimationFrame(() => {
                frames.delete(name);
                run();
            }));
        }));
    }

    function checkNearTop(scroller: HTMLElement) {
        if (scroller.scrollTop <= NEAR_TOP_PX) {
            options.onNearTop();
        }
    }

    /** 内容或视口尺寸变化后、绘制前调用。 */
    function settle() {
        const found = elements();
        if (found === null) {
            return;
        }
        const {scroller} = found;
        if (following.value && interaction === null) {
            scroller.scrollTop = scroller.scrollHeight;
        } else {
            restoreAnchor(scroller, interaction ?? reading, knownScrollTop);
            following.value = atBottom(scroller);
        }
        knownScrollTop = scroller.scrollTop;
        readingPinned = false;
        // 跟随底部时用不到阅读锚点；离开底部时滚动事件会重新记下。
        if (!following.value) {
            captureReading();
        }
        checkNearTop(scroller);
    }

    function onScroll() {
        const found = elements();
        if (found === null) {
            return;
        }
        const {scroller} = found;
        const top = scroller.scrollTop;
        // 往上移、而且正好落在新的底部：内容变短被浏览器夹住，随后的 settle 会按锚点校正。
        if (top < knownScrollTop && top >= scroller.scrollHeight - scroller.clientHeight - 1) {
            return;
        }
        knownScrollTop = top;
        following.value = atBottom(scroller);
        if (!readingPinned) {
            schedule("capture", captureReading);
        }
        checkNearTop(scroller);
    }

    /** 捕获阶段监听：在被点的组件改动界面之前记下它的位置。 */
    function onClickCapture(event: MouseEvent) {
        const found = elements();
        const target = event.target;
        if (found === null || !(target instanceof Element) || !found.content.contains(target)) {
            return;
        }
        interaction = anchorCandidates(target, found.content, found.scroller);
        // 点击引起的界面更新在下一帧布局后由 settle 校正；再过一帧仍没有尺寸变化，说明这次点击不改布局。
        schedule("interaction", () => {
            interaction = null;
        }, true);
    }

    onBeforeUpdate(() => {
        if (readingPinned || following.value) {
            return;
        }
        captureReading();
        readingPinned = true;
        // 这次更新没有改变尺寸时不会有校正，两帧后放开。
        schedule("pin", () => {
            readingPinned = false;
        }, true);
    });

    function scrollToLatest() {
        following.value = true;
        interaction = null;
        const found = elements();
        if (found !== null) {
            found.scroller.scrollTop = found.scroller.scrollHeight;
            knownScrollTop = found.scroller.scrollTop;
        }
    }

    onMounted(() => {
        const found = elements();
        if (found === null) {
            return;
        }
        found.scroller.addEventListener("scroll", onScroll, {passive: true});
        found.scroller.addEventListener("click", onClickCapture, {capture: true});
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(settle);
            observer.observe(found.scroller);
            observer.observe(found.content);
        }
    });

    onBeforeUnmount(() => {
        const found = elements();
        found?.scroller.removeEventListener("scroll", onScroll);
        found?.scroller.removeEventListener("click", onClickCapture, {capture: true});
        observer?.disconnect();
        frames.forEach((frame) => cancelAnimationFrame(frame));
        frames.clear();
    });

    function recheckNearTop() {
        schedule("recheck", () => {
            const found = elements();
            if (found !== null) {
                checkNearTop(found.scroller);
            }
        }, true);
    }

    return {following, scrollToLatest, recheckNearTop};
}

/**
 * 视口顶部第一个露出来的元素：从内容根逐层往下，每层取第一个底边低于视口顶的子元素，一直取到最深处。
 * 取最深的而不是第一个完整露出的：同一个容器里、锚点前面插入的内容（例如开头不完整的一轮补上用户消息）
 * 也会把它推下去，校正时一并算进去。
 */
function findReadingAnchor(root: Element, viewportTop: number): Element | null {
    let anchor: Element | null = null;
    let parent = root;
    for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth += 1) {
        let next: Element | null = null;
        for (const child of parent.children) {
            const rect = child.getBoundingClientRect();
            if (rect.height > 0 && rect.bottom > viewportTop && getComputedStyle(child).overflowAnchor !== "none") {
                next = child;
                break;
            }
        }
        if (next === null) {
            break;
        }
        anchor = next;
        parent = next;
    }
    return anchor;
}

/** 元素顶边在滚动内容里的位置；用户滚动不改变它，只有布局变化才会。 */
function contentPosition(element: Element, scroller: HTMLElement): number {
    return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

/** 锚点和它被移除时的替补，按优先顺序：自己、下一个兄弟、父元素、父元素的下一个兄弟……直到内容根。 */
function anchorCandidates(start: Element, root: Element, scroller: HTMLElement): AnchorCandidate[] {
    const candidates: AnchorCandidate[] = [];
    for (let element: Element | null = start; element !== null && element !== root; element = element.parentElement) {
        for (const candidate of [element, element.nextElementSibling]) {
            if (candidate !== null) {
                candidates.push({element: candidate, position: contentPosition(candidate, scroller)});
            }
        }
    }
    return candidates;
}

/** 第一个仍在页面上的候选移动了多少，就在已知的 scrollTop 上移动多少，它在视口里的位置因此不变。 */
function restoreAnchor(scroller: HTMLElement, candidates: readonly AnchorCandidate[], knownScrollTop: number) {
    for (const candidate of candidates) {
        if (!candidate.element.isConnected || candidate.element.getClientRects().length === 0) {
            continue;
        }
        const target = knownScrollTop + contentPosition(candidate.element, scroller) - candidate.position;
        if (Math.abs(scroller.scrollTop - target) >= 0.5) {
            scroller.scrollTop = target;
        }
        return;
    }
}
