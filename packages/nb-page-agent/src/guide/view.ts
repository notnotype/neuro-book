/**
 * 一次高亮画在页面上的东西（docs/specs/agent/page-agent.md 输出 10）：压暗层、描边框与说明框，都在一个 shadow 宿主里。
 *
 * 宿主是 `popover="manual"` 的元素，挂在目标所在那一层的 DOM 里（`HighlightSession` 决定挂在哪），排在那一层的最前面，显示时进
 * top layer：
 * - 挂在那一层里面，弹层的“点外面就关”与焦点圈把点说明框、在提问框里打字都当成在层里，不会关掉弹层；
 * - 进 top layer，盖在一切 z-index 之上，也不被祖先的 `overflow` 与 `transform` 裁掉。
 * 宿主铺满视口、不接指针，只有说明框接；它的子元素按视口坐标放。排在最前而不是最后：常见的间距与分隔线工具类按“不是最后一个
 * 子元素”写（Tailwind 的 `space-y`、`divide-y`），排在最后会让原来的最后一项多出间距或线；最前也在框架管的那段子节点之外。
 *
 * 页面不该看到说明框里的事件：键盘与指针事件冒泡到宿主就停（输出 10 的“按键不交给页面”）。窗口上捕获阶段的监听仍先看到它们，
 * 那是页面自己的选择；`HighlightSession` 自己在窗口上的监听按事件路径跳过宿主。
 */

import {OWN_NODE_ATTRIBUTE, QUESTION_MAX_CHARS} from "../api";
import {intersect} from "../snapshot/walk";
import type {Box} from "../snapshot/walk";
import {frameClip, height, width} from "./geometry";
import type {Frame} from "./geometry";
import {GUIDE_STYLES} from "./styles";
import {themeDeclarations} from "./theme";
import type {GuideText, GuideTheme} from "./theme";

/** 说明框要显示的东西，由参数与文字表算好。 */
export interface CalloutModel {
    readonly title: string | null;
    readonly message: string;
    /** 进度文字；没给步数时为 null。 */
    readonly progress: string | null;
    /** “下一步”或“完成”；等用户点目标时没有这个按钮，为 null。 */
    readonly next: string | null;
    /** 有“上一步”：只在要按“下一步”的步骤上。 */
    readonly back: boolean;
    readonly dim: boolean;
    readonly text: GuideText;
    /** 写在说明框的 `data-nb-page-agent-target` 上：目标的稳定名（`target` 或 `target:key`），没有时是引用。 */
    readonly targetLabel: string;
    readonly step: number | null;
}

export interface CalloutEvents {
    next(): void;
    back(): void;
    skip(): void;
    ask(question: string): void;
}

/** 冒泡到宿主就停下的事件：说明框里的按键、点击与剪贴板都不交给页面。 */
const ISOLATED_EVENTS = [
    "keydown", "keyup", "keypress", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend",
    "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "copy", "cut", "paste",
] as const;

/** 关掉时等淡出的上限：动画没有按时结束（页面忙、元素被挪走）也不会一直挂着。 */
const CLOSE_WAIT_MS = 400;

const SVG_NS = "http://www.w3.org/2000/svg";
/** Lucide 图标（ISC 许可）的路径。 */
const ICONS = {
    ask: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
    send: ["m5 12 7-7 7 7", "M12 19V5"],
    close: ["M18 6 6 18", "m6 6 12 12"],
} as const;

interface SavedFocus {
    readonly element: HTMLElement | SVGElement | null;
    readonly ranges: readonly Range[];
}

/** 焦点所在的元素，钻进 open 的 shadow root。 */
function deepActiveElement(document: Document): Element | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement != null) active = active.shadowRoot.activeElement;
    return active;
}

function saveFocus(document: Document): SavedFocus {
    const active = deepActiveElement(document);
    const element = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    const selection = document.getSelection();
    const ranges: Range[] = [];
    if (selection !== null) for (let index = 0; index < selection.rangeCount; index += 1) ranges.push(selection.getRangeAt(index).cloneRange());
    return {element, ranges};
}

/**
 * 焦点还给原来的元素，文档选区按原样放回去。输入框与文本框自己记着选区，聚焦即恢复；再放文档选区会冲掉它们自己的，所以不放。
 */
function restoreFocus(document: Document, saved: SavedFocus): void {
    const element = saved.element;
    if (element !== null && element.isConnected && element !== document.body) element.focus({preventScroll: true});
    else {
        // 原来没有焦点：让提问框交出焦点（宿主上的 blur 不一定交出 shadow 里的焦点，直接对焦点所在的元素做）。
        const active = deepActiveElement(document);
        if (active instanceof HTMLElement) active.blur();
    }
    const ownSelection = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const selection = document.getSelection();
    if (ownSelection || selection === null) return;
    selection.removeAllRanges();
    for (const range of saved.ranges) selection.addRange(range);
}

export class GuideView {
    readonly host: HTMLElement;
    readonly callout: HTMLElement;
    readonly #document: Document;
    readonly #root: ShadowRoot;
    readonly #outline: HTMLElement;
    readonly #dim: HTMLElement | null;
    readonly #actions: HTMLElement;
    readonly #askRow: HTMLElement;
    readonly #input: HTMLInputElement;
    readonly #events: CalloutEvents;
    #saved: SavedFocus | null = null;
    /** 提问框有焦点；层被页面删掉、宿主跟着被摘下而丢的焦点不算交出，重挂时据此放回。 */
    #inputFocused = false;

    constructor(document: Document, model: CalloutModel, theme: GuideTheme | undefined, events: CalloutEvents) {
        this.#document = document;
        this.#events = events;
        const host = document.createElement("div");
        host.setAttribute(OWN_NODE_ATTRIBUTE, "guide");
        // 盖掉用户代理给 popover 的样式（边框、底色、居中）；写在行内，页面的样式表压不过它。
        host.style.cssText = "position:fixed;inset:0;width:auto;height:auto;max-width:none;max-height:none;margin:0;padding:0;border:0;"
            + "background:transparent;overflow:visible;pointer-events:none;color:inherit;z-index:2147483647;";
        if (typeof host.showPopover === "function") host.setAttribute("popover", "manual");
        this.host = host;
        const root = host.attachShadow({mode: "open"});
        this.#root = root;

        const style = document.createElement("style");
        style.textContent = `${themeDeclarations(theme)}\n${GUIDE_STYLES}`;
        root.append(style);

        this.#dim = model.dim ? this.#part("div", "dim") : null;
        this.#outline = this.#part("div", "outline");
        if (this.#dim !== null) root.append(this.#dim);
        root.append(this.#outline);

        const callout = this.#part("section", "callout");
        callout.setAttribute("role", "dialog");
        callout.setAttribute("data-nb-page-agent-target", model.targetLabel);
        if (model.step !== null) callout.setAttribute("data-step", String(model.step));
        if (model.title !== null || model.progress !== null) {
            const head = document.createElement("header");
            head.className = "head";
            if (model.title !== null) {
                const title = document.createElement("strong");
                title.className = "title";
                title.id = "title";
                title.textContent = model.title;
                head.append(title);
                callout.setAttribute("aria-labelledby", "title");
            }
            if (model.progress !== null) {
                const progress = document.createElement("span");
                progress.className = "progress";
                progress.textContent = model.progress;
                head.append(progress);
            }
            callout.append(head);
        }
        if (model.title === null) callout.setAttribute("aria-label", model.message.slice(0, 100));
        const message = document.createElement("p");
        message.className = "message";
        message.textContent = model.message;
        callout.append(message);

        const rows = document.createElement("div");
        rows.className = "rows";
        const text = model.text;
        this.#actions = document.createElement("div");
        this.#actions.className = "row";
        this.#actions.setAttribute("data-active", "");
        const openAsk = this.#button("ask-open", "ghost", text.ask, "ask");
        const fill = document.createElement("span");
        fill.className = "fill";
        this.#actions.append(openAsk, fill, this.#button("skip", "ghost", text.skip));
        if (model.back) this.#actions.append(this.#button("back", "secondary", text.back));
        if (model.next !== null) this.#actions.append(this.#button("next", "primary", model.next));

        this.#askRow = document.createElement("div");
        this.#askRow.className = "row";
        this.#askRow.inert = true;
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = QUESTION_MAX_CHARS;
        input.placeholder = text.askPlaceholder;
        input.setAttribute(OWN_NODE_ATTRIBUTE, "ask");
        input.setAttribute("aria-label", text.ask);
        this.#input = input;
        const submit = this.#button("ask-submit", "icon", null, "send", text.askSubmit);
        const close = this.#button("ask-close", "icon", null, "close", text.askClose);
        this.#askRow.append(input, submit, close);
        rows.append(this.#actions, this.#askRow);
        callout.append(rows);
        root.append(callout);
        this.callout = callout;

        for (const type of ISOLATED_EVENTS) host.addEventListener(type, (event) => event.stopPropagation());
        // 点说明框不移走页面的焦点（输出 10）：按下的默认动作是聚焦，取消它；提问框要能聚焦与选字，不取消。
        const keepFocus = (event: Event): void => {
            if (event.composedPath()[0] !== input) event.preventDefault();
        };
        root.addEventListener("pointerdown", keepFocus);
        root.addEventListener("mousedown", keepFocus);
        root.addEventListener("click", (event) => {
            const button = (event.target as Element | null)?.closest("button");
            switch (button?.getAttribute(OWN_NODE_ATTRIBUTE)) {
                case "next": return this.#events.next();
                case "back": return this.#events.back();
                case "skip": return this.#events.skip();
                case "ask-open": return this.#openAsk();
                case "ask-submit": return this.#submit();
                case "ask-close": return this.#closeAsk();
                default: return undefined;
            }
        });
        input.addEventListener("focus", () => {
            this.#inputFocused = true;
        });
        // 宿主被摘下时提问框也会失焦：等这一轮的 DOM 改动做完再看，宿主已经不在页面上就是被摘下，不是用户移走了焦点。
        input.addEventListener("blur", () => {
            queueMicrotask(() => {
                // 挪层时这一轮里已经把焦点放回去了，那也不算交出。
                if (this.host.isConnected && this.#root.activeElement !== input) this.#inputFocused = false;
            });
        });
        // 输入法组字时的回车是选字、Esc 是取消组字，都不是给说明框的。
        const composing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !composing(event)) {
                event.preventDefault();
                this.#submit();
            }
        });
        // Esc 挂在提问那一行：焦点在发送、关闭按钮上时同样收起。
        this.#askRow.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !composing(event)) {
                event.preventDefault();
                this.#closeAsk();
            }
        });
    }

    /**
     * 挂进 `parent` 的最前面并显示；已经挂在别处时挪过去。挪动（或层被页面删掉时宿主跟着被摘下）会让 popover 关上、焦点掉到
     * body，所以重新显示，焦点原来在提问框里的话放回去。
     */
    mount(parent: Element): void {
        if (this.host.parentNode !== parent) parent.prepend(this.host);
        if (typeof this.host.showPopover === "function" && !this.host.matches(":popover-open")) this.host.showPopover();
        if (this.#inputFocused && this.#root.activeElement !== this.#input) this.#input.focus({preventScroll: true});
    }

    /**
     * 画描边框与压暗层；`frame` 为 null 时两者藏起来（目标滚出了视野）。压暗层的洞只开在可见区域里：目标一部分滚到滚动区域
     * 外面时，外面那一截不是目标，照样压暗（洞是元素自己的框，`clip-path` 裁不出洞，所以直接缩框，被裁的那几个角不要圆角）。
     */
    placeFrame(frame: Frame | null, visible: Box | null): void {
        const parts = this.#dim === null ? [this.#outline] : [this.#outline, this.#dim];
        if (frame === null || visible === null) {
            for (const part of parts) part.setAttribute("data-hidden", "");
            return;
        }
        for (const part of parts) part.removeAttribute("data-hidden");
        place(this.#outline, frame.box, [frame.radius, frame.radius, frame.radius, frame.radius]);
        this.#outline.toggleAttribute("data-inside", frame.inside);
        this.#outline.style.clipPath = frameClip(frame, visible);
        if (this.#dim !== null) {
            const hole = intersect(frame.box, visible);
            const top = hole.top > frame.box.top;
            const bottom = hole.bottom < frame.box.bottom;
            const left = hole.left > frame.box.left;
            const right = hole.right < frame.box.right;
            const corner = (cut: boolean): number => (cut ? 0 : frame.radius);
            place(this.#dim, hole, [corner(top || left), corner(top || right), corner(bottom || right), corner(bottom || left)]);
        }
    }

    placeCallout(x: number, y: number): void {
        this.callout.style.left = `${String(Math.round(x))}px`;
        this.callout.style.top = `${String(Math.round(y))}px`;
    }

    /**
     * 撤掉：先淡出，再从页面上拿走。焦点在提问框里时先还给原来的元素，不让它掉到 body 上。
     */
    async close(): Promise<void> {
        if (this.#root.activeElement !== null) this.#restore();
        const host = this.host;
        if (host.isConnected) {
            host.setAttribute("data-closing", "");
            // 读一次样式，让淡出的过渡从现在的状态开始，再取正在跑的动画。
            void getComputedStyle(this.callout).opacity;
            const running = this.#root.getAnimations().map((animation) => animation.finished.catch(() => undefined));
            if (running.length > 0) await Promise.race([Promise.all(running), new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]);
        }
        if (typeof host.hidePopover === "function" && host.isConnected && host.matches(":popover-open")) host.hidePopover();
        host.remove();
    }

    #part<K extends keyof HTMLElementTagNameMap>(tag: K, name: string): HTMLElementTagNameMap[K] {
        const element = this.#document.createElement(tag);
        element.setAttribute(OWN_NODE_ATTRIBUTE, name);
        return element;
    }

    #button(name: string, kind: "ghost" | "secondary" | "primary" | "icon", label: string | null, icon?: keyof typeof ICONS, ariaLabel?: string): HTMLButtonElement {
        const button = this.#part("button", name);
        button.type = "button";
        button.className = kind;
        if (icon !== undefined) button.append(this.#icon(icon));
        if (label !== null) button.append(label);
        if (ariaLabel !== undefined) {
            button.setAttribute("aria-label", ariaLabel);
            button.title = ariaLabel;
        }
        return button;
    }

    #icon(name: keyof typeof ICONS): SVGSVGElement {
        const svg = this.#document.createElementNS(SVG_NS, "svg");
        for (const [key, value] of Object.entries({viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"})) {
            svg.setAttribute(key, value);
        }
        for (const d of ICONS[name]) {
            const path = this.#document.createElementNS(SVG_NS, "path");
            path.setAttribute("d", d);
            svg.append(path);
        }
        return svg;
    }

    /** 点“提问”：提问框在原位换掉按钮那一行，焦点进提问框；原来的焦点与选区记下，收起或提交时还回去。 */
    #openAsk(): void {
        this.#saved = saveFocus(this.#document);
        this.callout.setAttribute("data-asking", "");
        this.#actions.removeAttribute("data-active");
        this.#actions.inert = true;
        this.#askRow.inert = false;
        this.#askRow.setAttribute("data-active", "");
        this.#input.focus({preventScroll: true});
    }

    /** 收起提问框：清空、换回按钮那一行，焦点还给原来的元素。 */
    #closeAsk(): void {
        this.#input.value = "";
        this.callout.removeAttribute("data-asking");
        this.#askRow.removeAttribute("data-active");
        this.#askRow.inert = true;
        this.#actions.inert = false;
        this.#actions.setAttribute("data-active", "");
        this.#restore();
    }

    #submit(): void {
        const question = this.#input.value.trim();
        if (question === "") return;
        // 焦点在撤掉时还回去（`close`）。
        this.#events.ask(question.slice(0, QUESTION_MAX_CHARS));
    }

    #restore(): void {
        const saved = this.#saved;
        this.#saved = null;
        if (saved !== null) restoreFocus(this.#document, saved);
        else if (this.#root.activeElement instanceof HTMLElement) this.#root.activeElement.blur();
    }
}

/** 按视口坐标放一个框；圆角按左上、右上、右下、左下。 */
function place(element: HTMLElement, box: Box, radii: readonly [number, number, number, number]): void {
    element.style.left = `${String(box.left)}px`;
    element.style.top = `${String(box.top)}px`;
    element.style.width = `${String(Math.max(0, width(box)))}px`;
    element.style.height = `${String(Math.max(0, height(box)))}px`;
    element.style.borderRadius = radii.map((radius) => `${String(radius)}px`).join(" ");
}
