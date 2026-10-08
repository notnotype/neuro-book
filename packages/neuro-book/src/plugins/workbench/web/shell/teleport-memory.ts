/**
 * 搬动 DOM 前后的滚动与焦点记忆（docs/specs/ui/workbench-shell.md 外壳一输出 6、外壳二输出 18）。外壳有三层 Teleport：
 * Part 内容搬进网格叶、容器宿主搬进 Part 的落点、视图实例搬进容器里的分节。浏览器把节点移到别处时会清掉它的滚动位置，
 * 焦点也会丢；停放区是 `display: none`，在那里设滚动位置不生效。
 *
 * 三层共用一份记忆：滚动位置记在一张跨多次变化的表里，任何一层搬动前记下仍可见的元素、搬完后给回到可见处的元素还原；
 * 停放区登记在这里，记录时跳过停放着的元素，也不用读出的 0 覆盖之前的记录（停放与刚搬回还没还原的元素读出的都是 0）。
 *
 * 焦点只在一次搬动里有效：原节点搬完仍可见、用户也没有把焦点移出外壳时拿回，不抢外壳外的菜单与对话框。
 *
 * 内层的搬动可能发生在记录之前：分节重建时旧落点连同里面的内容先被移出文档，这时再读滚动位置与焦点都已丢失。所以
 * `track` 在根上监听滚动（捕获阶段）与 focusin，滚动位置随用户操作随时记下，焦点记下最近一个。
 */

/**
 * 被压成零宽或零高的元素（Part 拖到零、收起的过程中）：内容在这时重排，浏览器的滚动锚定会改写滚动位置并发出滚动事件，
 * 这种位置不是用户的，不记。
 */
function collapsed(element: Element): boolean {
    return element.clientWidth === 0 || element.clientHeight === 0;
}

export class TeleportMemory {
    readonly #scroll = new Map<Element, {readonly top: number; readonly left: number}>();
    readonly #parkings = new Set<Element>();
    readonly #tracked = new WeakSet<Element>();
    #lastFocus: HTMLElement | null = null;

    /** 在根上持续记录滚动位置与最近的焦点；同一个根只装一次。返回卸下监听的函数。 */
    track(root: Element): () => void {
        if (this.#tracked.has(root)) return () => undefined;
        this.#tracked.add(root);
        const onScroll = (event: Event): void => {
            const element = event.target;
            if (!(element instanceof Element) || this.parked(element) || collapsed(element)) return;
            this.#scroll.set(element, {top: element.scrollTop, left: element.scrollLeft});
        };
        const onFocus = (event: Event): void => {
            if (event.target instanceof HTMLElement) this.#lastFocus = event.target;
        };
        root.addEventListener("scroll", onScroll, {capture: true, passive: true});
        root.addEventListener("focusin", onFocus);
        return () => {
            this.#tracked.delete(root);
            root.removeEventListener("scroll", onScroll, {capture: true});
            root.removeEventListener("focusin", onFocus);
        };
    }

    /** 停放区挂载时登记、卸载时注销。 */
    parking(element: Element | null, previous?: Element | null): void {
        if (previous !== undefined && previous !== null) this.#parkings.delete(previous);
        if (element !== null) this.#parkings.add(element);
    }

    parked(element: Element): boolean {
        for (const parking of this.#parkings) if (parking.contains(element)) return true;
        return false;
    }

    /** 搬动前调用：记下 `root` 里可见元素的滚动位置，返回焦点所在元素（不在 `root` 里为 null）。 */
    capture(root: Element | null): HTMLElement | null {
        if (root === null) return null;
        for (const element of root.querySelectorAll("*")) {
            if (this.parked(element) || collapsed(element)) continue;
            // 读到 0 不覆盖：多层搬动交错时，元素可能已经回到可见处、还没还原（读出的是浏览器清掉的 0）。用户真的滚回
            // 顶端时滚动事件会记下 0（`track`）。
            if (element.scrollTop !== 0 || element.scrollLeft !== 0) this.#scroll.set(element, {top: element.scrollTop, left: element.scrollLeft});
        }
        const active = document.activeElement;
        return active instanceof HTMLElement && root.contains(active) ? active : null;
    }

    /**
     * 搬完后调用：可见的元素还原滚动位置；焦点在原节点仍可见、当前焦点还在 `root` 里或落到了 body 时拿回。返回焦点是否
     * 丢了需要别处接住（原节点被停放或已不在文档里，且焦点原本在 `root` 里）。
     */
    restore(focus: HTMLElement | null, root: Element | null): "kept" | "restored" | "lost" | "none" {
        for (const [element, {top, left}] of this.#scroll) {
            if (!element.isConnected) {
                this.#scroll.delete(element);
                continue;
            }
            if (this.parked(element)) continue;
            element.scrollTop = top;
            element.scrollLeft = left;
        }
        const current = document.activeElement;
        // 焦点在记录之前就随旧落点离开了文档：落到了 body，用最近一次 focusin 的元素代替。
        if (focus === null && current === document.body && this.#lastFocus !== null && root?.contains(this.#lastFocus) === true) focus = this.#lastFocus;
        if (focus === null) return "none";
        const inside = current !== null && (current === document.body || root?.contains(current) === true);
        if (!focus.isConnected || this.parked(focus)) return inside ? "lost" : "none";
        if (current === focus) return "kept";
        if (!inside) return "none";
        focus.focus({preventScroll: true});
        return "restored";
    }
}
