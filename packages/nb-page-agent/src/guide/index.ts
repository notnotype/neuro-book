/**
 * 一次高亮（docs/specs/agent/page-agent.md 输出 9、10）：等目标出现、画描边框与说明框、跟着目标动、等到结局再撤掉。
 *
 * 状态只往前走：waiting（等目标）→ shown（已装上，等用户）→ closing（淡出）→ closed（已撤掉，`outcome` 在这时 resolve）。
 * 任何一步都可以直接进 closing：`end` 只认第一次，之后的结局一律忽略，所以几路事件同时到（点了目标又被替换）只有先到的算。
 *
 * 结局在撤掉之后才交出（Spec 的“时序与寿命”）：宿主拿到结局时页面上已经没有这次的节点了。
 */

import {autoUpdate, computePosition, flip, offset, shift} from "@floating-ui/dom";
import type {Placement, VirtualElement} from "@floating-ui/dom";

import type {Candidate, HighlightArgs, HighlightInstalled, Locator, PageFailure, PageOutcome} from "../api";
import {composedParent} from "../dom";
import type {Inspector} from "../inspect";
import type {Located} from "../locate";
import {INTERACTIVE_ROLES} from "../snapshot/describe";
import {intersect, isEmptyBox, viewportBox} from "../snapshot/walk";
import type {Box} from "../snapshot/walk";
import {CALLOUT_OFFSET, edgeAnchor, frameFor, height, width} from "./geometry";
import {ENGLISH_GUIDE_TEXT} from "./theme";
import type {GuideText, GuideTheme} from "./theme";
import {GuideView} from "./view";
import type {CalloutModel} from "./view";

export {ENGLISH_GUIDE_TEXT, GUIDE_THEME_DEFAULTS} from "./theme";
export type {GuideText, GuideTheme, GuideThemeSlot} from "./theme";

/** 宿主给高亮的东西（都可省）。 */
export interface GuideOptions {
    /** 说明框上的文字，每次高亮开始时取一次（界面语言可能变了）；缺省英文。 */
    readonly text?: () => GuideText;
    readonly theme?: GuideTheme;
    /**
     * 目标要靠悬停才看得见时，宿主在这里让它一直显示（例如给悬停动作区写个属性）；交回的函数在撤掉高亮时调用。
     */
    readonly reveal?: (target: Element) => (() => void) | void;
    /** 等目标出现的上限，缺省 5 秒（输出 9）。 */
    readonly targetWaitMs?: number;
}

export const TARGET_WAIT_MS = 5000;

/** 高亮从引擎拿的东西：每次都是新的查询，页面在两次之间怎么变都不受影响。 */
export interface GuideEnvironment {
    readonly document: Document;
    /** 按高亮的规则定位：不改页面、落到唯一的可交互后代。写错的定位抛 `TypeError`。 */
    locate(locator: Locator): Located | PageFailure;
    describe(element: Element): Candidate;
    inspector(): Inspector;
}

/** 一次高亮怎样结束：页面上的结局、宿主取消，或者装不上（定位失败、等目标超时）。 */
export type HighlightEnd = PageOutcome | {readonly outcome: "cancelled"} | PageFailure;

export interface HighlightHandle {
    /** 画出来时 resolve；没画出来就结束了（定位失败、被替换、被取消）时 resolve 成 null，原因看 `outcome`。 */
    readonly installed: Promise<HighlightInstalled | null>;
    /** 撤掉之后 resolve。 */
    readonly outcome: Promise<HighlightEnd>;
    /** 宿主不再要这次高亮（调用结束、窗口退订）：撤掉，结局是 `cancelled`。 */
    cancel(): void;
}

const POLL_MS = 200;
/** 目标短暂消失（重渲染换掉了元素又马上放回）不算 `gone`：隔这么久仍不在才算。 */
const GONE_GRACE_MS = 150;
const EDGE_PADDING = 8;

type State = "waiting" | "shown" | "closing" | "closed";

export class HighlightSession {
    readonly handle: HighlightHandle;
    readonly #environment: GuideEnvironment;
    readonly #options: GuideOptions;
    readonly #args: HighlightArgs;
    readonly #window: Window;
    #state: State = "waiting";
    #resolveInstalled!: (value: HighlightInstalled | null) => void;
    #resolveOutcome!: (value: HighlightEnd) => void;
    /** 停掉等待或跟随时要做的事；进 closing 时全部执行。 */
    #cleanups: Array<() => void> = [];
    #target: Element | null = null;
    #view: GuideView | null = null;
    #unreveal: (() => void) | null = null;
    #frame: number | null = null;
    #goneTimer: ReturnType<typeof setTimeout> | null = null;
    /** 每次重算位置加一；算位置是异步的，晚到的旧结果不写。 */
    #placing = 0;

    /** 第一次定位同步进行：写错的定位在这里抛 `TypeError`，调用方当场知道。 */
    constructor(environment: GuideEnvironment, options: GuideOptions, args: HighlightArgs) {
        this.#environment = environment;
        this.#options = options;
        this.#args = args;
        const view = environment.document.defaultView;
        if (view === null) throw new TypeError("文档不在窗口里，不能高亮");
        this.#window = view;
        const installed = new Promise<HighlightInstalled | null>((resolve) => {
            this.#resolveInstalled = resolve;
        });
        const outcome = new Promise<HighlightEnd>((resolve) => {
            this.#resolveOutcome = resolve;
        });
        this.handle = {installed, outcome, cancel: () => this.end({outcome: "cancelled"})};
        if (!this.#attempt(false)) this.#wait();
    }

    /** 结束这次高亮：只认第一次。撤掉（含淡出）之后 resolve `outcome`。 */
    end(result: HighlightEnd): void {
        if (this.#state === "closing" || this.#state === "closed") return;
        const shown = this.#state === "shown";
        this.#state = "closing";
        for (const cleanup of this.#cleanups.splice(0)) cleanup();
        if (this.#frame !== null) this.#window.cancelAnimationFrame(this.#frame);
        if (this.#goneTimer !== null) clearTimeout(this.#goneTimer);
        this.#unreveal?.();
        this.#unreveal = null;
        if (!shown) this.#resolveInstalled(null);
        const finish = (): void => {
            this.#state = "closed";
            this.#resolveOutcome(result);
        };
        if (this.#view === null) finish();
        // 撤掉失败（页面把节点弄到了意外的状态）也要交出结局，不让宿主一直等；错误照样作为未处理的 rejection 报出来。
        else void this.#view.close().finally(finish);
    }

    // ---------- 等目标 ----------

    /** 等目标出现：页面有变化就在下一帧再找，另外每 200 毫秒找一次（只改样式的变化没有 DOM 记录）。 */
    #wait(): void {
        const observer = new MutationObserver(() => this.#schedule(() => this.#attempt(false)));
        observer.observe(this.#environment.document, {subtree: true, childList: true, attributes: true, characterData: true});
        const poll = setInterval(() => this.#attempt(false), POLL_MS);
        const deadline = setTimeout(() => this.#attempt(true), this.#options.targetWaitMs ?? TARGET_WAIT_MS);
        this.#cleanups.push(() => {
            observer.disconnect();
            clearInterval(poll);
            clearTimeout(deadline);
        });
    }

    /** 找一次；找到就装上，找不到以外的失败直接结束。交回这次有没有了结果（装上或结束）。 */
    #attempt(final: boolean): boolean {
        if (this.#state !== "waiting") return true;
        const found = this.#environment.locate(this.#args.at);
        if (found.ok) {
            for (const cleanup of this.#cleanups.splice(0)) cleanup();
            // 等待时排下的那一帧是再找一次，装上之后它占着位置会挡掉跟随的重算。
            if (this.#frame !== null) {
                this.#window.cancelAnimationFrame(this.#frame);
                this.#frame = null;
            }
            this.#install(found);
            return true;
        }
        if (found.code !== "not-found") {
            this.end(found);
            return true;
        }
        if (!final) return false;
        const seconds = (this.#options.targetWaitMs ?? TARGET_WAIT_MS) / 1000;
        this.end({...found, message: `等了 ${String(seconds)} 秒，目标仍没有出现：${found.message}`});
        return true;
    }

    // ---------- 装上与跟随 ----------

    #install(found: Located): void {
        const target = found.element;
        const document = this.#environment.document;
        this.#target = target;
        this.#bringIntoView(target);
        this.#unreveal = this.#options.reveal?.(target) ?? null;
        const candidate = this.#environment.describe(target);
        const view = new GuideView(document, this.#model(candidate), this.#options.theme, {
            next: () => this.end({outcome: "next"}),
            back: () => this.end({outcome: "back"}),
            skip: () => this.end({outcome: "dismissed"}),
            ask: (question) => this.end({outcome: "asked", question}),
        });
        this.#view = view;
        view.mount(this.#environment.inspector().entered(target)?.layer ?? document.body);
        this.#state = "shown";
        this.#update();

        const observer = new MutationObserver((records) => {
            if (records.some((record) => !this.#ownRecord(record))) this.#schedule(() => this.#update());
        });
        observer.observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
        // 祖先滚动、窗口与目标改大小、目标被动画或布局挪动（交叉观察）时重算。
        const stopAutoUpdate = autoUpdate(target, view.callout, () => this.#schedule(() => this.#update()));
        const listeners: Array<[string, EventListener]> = [
            ["pointerdown", (event) => this.#onPointerDown(event as PointerEvent)],
            ["pointerup", (event) => this.#onActivate(event as MouseEvent)],
            ["click", (event) => this.#onActivate(event as MouseEvent)],
            ["keydown", (event) => this.#onKey(event as KeyboardEvent)],
        ];
        // 捕获阶段：页面的处理函数还没动（点了目标随即关掉弹层、换掉元素）之前就判定。
        for (const [type, listener] of listeners) this.#window.addEventListener(type, listener, true);
        this.#cleanups.push(() => {
            observer.disconnect();
            stopAutoUpdate();
            for (const [type, listener] of listeners) this.#window.removeEventListener(type, listener, true);
        });
        this.#resolveInstalled({target: candidate, warnings: [...found.warnings]});
    }

    #model(candidate: Candidate): CalloutModel {
        const args = this.#args;
        const text = this.#options.text?.() ?? ENGLISH_GUIDE_TEXT;
        const counted = args.step !== undefined && args.total !== undefined;
        const last = counted && args.step! >= args.total!;
        return {
            title: args.title ?? null,
            message: args.message,
            progress: counted ? text.progress(args.step!, args.total!) : null,
            next: args.until === "next" ? (last ? text.done : text.next) : null,
            back: args.until === "next" && args.back === true,
            dim: args.dim === true,
            text,
            targetLabel: candidate.target === undefined ? candidate.ref : candidate.key === undefined ? candidate.target : `${candidate.target}:${candidate.key}`,
            step: args.step ?? null,
        };
    }

    /** 目标没有整个在它的滚动区域里时滚过去（就近，已经看得见的不动）。 */
    #bringIntoView(target: Element): void {
        const viewport = viewportBox(this.#environment.document);
        const entered = this.#environment.inspector().entered(target);
        const box = intersect(entered?.clips.scroll ?? viewport, viewport);
        const rect = target.getBoundingClientRect();
        const shown = intersect(rect, box);
        const short = (shownLength: number, rectLength: number, boxLength: number): boolean => shownLength < Math.min(rectLength, boxLength) - 1;
        if (isEmptyBox(shown) || short(width(shown), rect.width, width(box)) || short(height(shown), rect.height, height(box))) {
            target.scrollIntoView({block: "nearest", inline: "nearest"});
        }
    }

    /** 页面变化在下一帧合并处理一次。 */
    #schedule(task: () => void): void {
        if (this.#frame !== null) return;
        this.#frame = this.#window.requestAnimationFrame(() => {
            this.#frame = null;
            task();
        });
    }

    /** 自己的宿主被挂上、挪动产生的记录不算页面变化（不然每次挂上都会再触发一次重算）。 */
    #ownRecord(record: MutationRecord): boolean {
        const host = this.#view?.host;
        if (host === undefined) return false;
        if (record.target === host) return true;
        if (record.type !== "childList") return false;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return nodes.length > 0 && nodes.every((node) => node === host);
    }

    /**
     * 重算：目标还在不在、该挂在哪一层、在不在视野里，再放描边框与说明框。目标被模态弹层藏到 `aria-hidden` 后面时它仍在
     * 页面上，只是不在任何层里：这时不挪宿主，按视口算。
     */
    #update(): void {
        const target = this.#target;
        const view = this.#view;
        if (this.#state !== "shown" || target === null || view === null) return;
        if (!present(target)) {
            this.#suspectGone(target);
            return;
        }
        if (this.#goneTimer !== null) {
            clearTimeout(this.#goneTimer);
            this.#goneTimer = null;
        }
        const document = this.#environment.document;
        const entered = this.#environment.inspector().entered(target);
        if (entered !== null) view.mount(entered.layer ?? document.body);
        else if (!view.host.isConnected) view.mount(document.body);

        const viewport = viewportBox(document);
        const visible = entered === null ? viewport : intersect(intersect(entered.clips.scroll, entered.clips.hard), viewport);
        const rect = target.getBoundingClientRect();
        let reference: Element | VirtualElement = target;
        let placement: Placement = this.#args.side ?? "bottom";
        const offscreen = isEmptyBox(intersect(rect, visible));
        if (offscreen) {
            view.placeFrame(null, null);
            const anchor = edgeAnchor(rect, visible);
            reference = {getBoundingClientRect: () => domRect(anchor.box), contextElement: target};
            placement = anchor.side;
        } else {
            view.placeFrame(frameFor(rect, visible, radiusOf(target, rect)), visible);
        }
        // 目标滚出去时说明框留在滚动区域里（只在区域外面停着的说明框看不出指的是哪个区域）。
        const middleware = offscreen
            ? [offset(CALLOUT_OFFSET), shift({padding: EDGE_PADDING, boundary: {x: visible.left, y: visible.top, width: width(visible), height: height(visible)}})]
            : [offset(CALLOUT_OFFSET), flip({fallbackPlacements: fallbacksFor(placement)}), shift({padding: EDGE_PADDING})];
        const token = ++this.#placing;
        void computePosition(reference, view.callout, {strategy: "fixed", placement, middleware}).then(({x, y}) => {
            if (token === this.#placing && this.#state === "shown") view.placeCallout(x, y);
        });
    }

    #suspectGone(target: Element): void {
        if (this.#goneTimer !== null) return;
        this.#goneTimer = setTimeout(() => {
            this.#goneTimer = null;
            if (this.#state === "shown" && !present(target)) this.end({outcome: "gone"});
        }, GONE_GRACE_MS);
    }

    // ---------- 用户的操作 ----------

    /** 事件是不是落在说明框上（宿主可能挂在目标里面，所以先判它）。 */
    #onCallout(path: readonly unknown[]): boolean {
        return this.#view !== null && path.includes(this.#view.host);
    }

    /** `missed`：等点目标时，主键按在目标、说明框、滚动条与模态弹层的遮罩之外。 */
    #onPointerDown(event: PointerEvent): void {
        if (this.#args.until !== "click" || !event.isTrusted || event.button !== 0) return;
        const path = event.composedPath();
        const target = this.#target;
        if (target === null || this.#onCallout(path) || path.includes(target)) return;
        const hit = path[0];
        if (!(hit instanceof Element) || onScrollbar(hit, event) || isBackdrop(hit, event)) return;
        this.end({outcome: "missed", clicked: this.#environment.describe(activatable(this.#environment.inspector(), hit))});
    }

    /** `clicked`：在目标上点击，或在目标上抬起指针（按住拖到选项上松开的下拉只有抬起，没有 click）。 */
    #onActivate(event: MouseEvent): void {
        if (this.#args.until !== "click" || !event.isTrusted || event.button !== 0) return;
        const path = event.composedPath();
        if (this.#target !== null && !this.#onCallout(path) && path.includes(this.#target)) this.end({outcome: "clicked"});
    }

    /** `clicked`：焦点在目标里按 Enter 或空格。 */
    #onKey(event: KeyboardEvent): void {
        if (this.#args.until !== "click" || !event.isTrusted || event.isComposing || (event.key !== "Enter" && event.key !== " ")) return;
        const path = event.composedPath();
        if (this.#target !== null && !this.#onCallout(path) && path.includes(this.#target)) this.end({outcome: "clicked"});
    }
}

/** 目标还在页面上：连着、有框、没被 `visibility` 藏起来。`display: contents` 的元素自己没有框，看子元素。 */
function present(element: Element): boolean {
    if (!element.isConnected) return false;
    if (element.checkVisibility({visibilityProperty: true})) return true;
    const view = element.ownerDocument.defaultView;
    return view !== null && view.getComputedStyle(element).display === "contents" && [...element.children].some(present);
}

function domRect(box: Box): DOMRect {
    return new DOMRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
}

/** 目标左上角的圆角（像素）；百分比按短边换算。 */
function radiusOf(target: Element, rect: DOMRect): number {
    const view = target.ownerDocument.defaultView;
    if (view === null) return 0;
    const raw = view.getComputedStyle(target).borderTopLeftRadius.split(" ")[0] ?? "0";
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return 0;
    return raw.endsWith("%") ? (Math.min(rect.width, rect.height) * value) / 100 : value;
}

/** 放不下时先换到对面，再试另外两边。 */
function fallbacksFor(placement: Placement): Placement[] {
    const order: Record<string, Placement[]> = {
        bottom: ["top", "right", "left"],
        top: ["bottom", "right", "left"],
        right: ["left", "bottom", "top"],
        left: ["right", "bottom", "top"],
    };
    return order[placement] ?? ["top", "right", "left"];
}

/** 按在滚动条上：视口的滚动条，或元素自己的滚动条那一条（内容框之外、边框之内）。 */
function onScrollbar(hit: Element, event: PointerEvent): boolean {
    const root = hit.ownerDocument.documentElement;
    if (event.clientX >= root.clientWidth || event.clientY >= root.clientHeight) return true;
    if (!(hit instanceof HTMLElement)) return false;
    // 只有滚动容器才有滚动条；行内元素的 clientWidth 是 0，不先排除会把按在文字上当成按在滚动条上。
    const view = hit.ownerDocument.defaultView;
    const style = view?.getComputedStyle(hit);
    if (style === undefined || !/auto|scroll/u.test(`${style.overflowX} ${style.overflowY}`)) return false;
    const rect = hit.getBoundingClientRect();
    const x = event.clientX - rect.left - hit.clientLeft;
    const y = event.clientY - rect.top - hit.clientTop;
    const gutterX = hit.offsetWidth - hit.clientWidth - 2 * hit.clientLeft;
    const gutterY = hit.offsetHeight - hit.clientHeight - 2 * hit.clientTop;
    return (gutterX > 0 && x >= hit.clientWidth) || (gutterY > 0 && y >= hit.clientHeight);
}

/**
 * 按在模态弹层的遮罩上：原生 `<dialog>` 的遮罩（事件落在 dialog 上、点在它的框外），或铺满视口、没有子元素的 fixed 元素
 * （弹出库画的遮罩）。按遮罩通常是关弹层，不是点错了控件。
 */
function isBackdrop(hit: Element, event: PointerEvent): boolean {
    const rect = hit.getBoundingClientRect();
    if (hit.localName === "dialog") {
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    }
    const view = hit.ownerDocument.defaultView;
    if (view === null || hit.childElementCount > 0 || view.getComputedStyle(hit).position !== "fixed") return false;
    const viewport = viewportBox(hit.ownerDocument);
    return rect.width >= 0.95 * width(viewport) && rect.height >= 0.95 * height(viewport);
}

/** 点到的元素升到包着它的可交互元素（点按钮里的图标就是点按钮）；没有时是它自己。 */
function activatable(inspector: Inspector, element: Element): Element {
    for (let current: Element | null = element; current !== null; current = composedParent(current)) {
        const role = inspector.role(current);
        if (role !== null && INTERACTIVE_ROLES.has(role)) return current;
    }
    return element;
}
