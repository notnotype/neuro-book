/**
 * 关窗协调（docs/specs/runtime/desktop-shell.md 输出 9、14 到 17、23）：纯状态机，经 `WindowPort` 操作窗口，事件由适配层
 * 按 Electrobun 的顺序送来：
 *
 * - 用户关窗：`will-close` 里已经同步否决，再送 `closeRequested`；真正关窗用 `commitClose`（不经 `will-close`），窗口没了才有
 *   `closed`。在 `closed` 之前窗口仍算存活的窗口之外（“正在关”），不再计入“最后一个”。
 * - 页面回答：`pageAcked`、`pageAnswered`，带询问的代次；只认当前代次。
 * - 对话框的选择：`dialogChose`。
 *
 * 最后一次关闭：关的是最后一个仍存活的产品窗口、服务端是自有时以 `quit` 询问。询问期间开窗转交回 `closing`、页面请求的新窗口
 * 被拒，窗口集合只会变少，所以同意时它一定还是最后一个；同意与进入停止中在同一个同步段里，中间开不出窗口。
 *
 * 更新提示的交付（docs/specs/runtime/desktop-update.md 输出 3、4）：当前提示由更新控制器给（`setUpdateHint`），这里为它记一个
 * “持有窗口”。提示变化时交给最近获得焦点的就绪产品窗口；只在持有窗口关掉、刷新（又报一次就绪）、离开就绪时转给当时最近
 * 焦点的就绪窗口；别的窗口第一次就绪时只在没有持有窗口时接手。“就绪”由页面报（`pageReady`、`pageGone`）。
 */

import type {CloseReason, UpdateHint} from "../shared/desktop-bridge";

import {at} from "./deadline";
import type {DeadlineClock} from "./deadline";

export type {CloseReason} from "../shared/desktop-bridge";
export type WindowId = number;
export type OpenTarget = {readonly kind: "startup"} | {readonly kind: "page"; readonly url: string};

/** 适配层实现：每个方法同步执行（开窗、关窗、发消息都不等）。 */
export interface WindowPort {
    open(target: OpenTarget): WindowId;
    load(id: WindowId, url: string): void;
    /** 真正关窗，不再经过 `will-close`；窗口没了之后送 `closed`。 */
    commitClose(id: WindowId): void;
    askPage(id: WindowId, generation: number, reason: CloseReason): void;
    /** 这次询问结束了（取消、强制关闭或窗口已关），页面收起它的界面。 */
    endAsk(id: WindowId, generation: number): void;
    showNotResponding(id: WindowId): void;
    closeNotResponding(id: WindowId): void;
    /** 把更新提示交给这个窗口的页面。 */
    sendHint(id: WindowId, hintId: number, hint: UpdateHint): void;
    /** 这条提示已被新阶段取代或转给了别的窗口：页面收起它（连通知中心里的记录）。 */
    endHint(id: WindowId, hintId: number): void;
}

export interface WindowCoordinatorOptions {
    readonly port: WindowPort;
    readonly clock: DeadlineClock;
    /** 最后一次关闭被同意（或强制关闭了最后一个窗口）：壳进入停止中。与 `commitClose` 在同一个同步段里调用。 */
    readonly onQuit: () => void;
    /** 窗口都关完了（`closed` 之后）。 */
    readonly onAllClosed: () => void;
}

/** 页面接下询问的截止（输出 14）。 */
export const ACK_MS = 3_000;

interface Ask {
    readonly generation: number;
    readonly reason: CloseReason;
    acked: boolean;
    cancelTimer: () => void;
}

interface WindowState {
    kind: "startup" | "page";
    /** 已经 `commitClose`，等 `closed`。 */
    closing: boolean;
    ask: Ask | null;
    dialogOpen: boolean;
    /** 页面报了就绪（界面挂好），还没报离开。 */
    ready: boolean;
    /** 最近一次获得焦点的序号，0 是还没获得过。 */
    focusedAt: number;
}

function newWindowState(kind: WindowState["kind"]): WindowState {
    return {kind, closing: false, ask: null, dialogOpen: false, ready: false, focusedAt: 0};
}

export class WindowCoordinator {
    readonly #options: WindowCoordinatorOptions;
    readonly #windows = new Map<WindowId, WindowState>();
    #generation = 0;
    /** 服务端是不是壳自己的、还要由最后一次关闭来停：决定原因是 `quit` 还是 `window`。 */
    #ownsServer = false;
    #serverUrl: string | null = null;
    #stopping = false;
    /** 进行中的最后一次关闭（以 `quit` 询问的那个窗口）。 */
    #lastClose: WindowId | null = null;
    #hint: {readonly id: number; readonly hint: UpdateHint} | null = null;
    /** 当前提示交给了哪个窗口；null 是还没有就绪的窗口可交，等。 */
    #hintHolder: WindowId | null = null;
    #focusSequence = 0;

    constructor(options: WindowCoordinatorOptions) {
        this.#options = options;
    }

    /** 开第一个窗口（或开窗转交时再开一个）：服务端就绪了加载页面，否则显示启动页。 */
    openWindow(): WindowId {
        const id = this.#options.port.open(this.#serverUrl === null ? {kind: "startup"} : {kind: "page", url: this.#serverUrl});
        this.#windows.set(id, newWindowState(this.#serverUrl === null ? "startup" : "page"));
        return id;
    }

    /** 锁上的 `open-window`（输出 2）：同步决定并开窗。 */
    openWindowRequested(): {ok: true} | {ok: false; code: "closing" | "stopping"} {
        if (this.#stopping) return {ok: false, code: "stopping"};
        if (this.#lastClose !== null) return {ok: false, code: "closing"};
        this.openWindow();
        return {ok: true};
    }

    /** 页面以网页方式请求的新窗口（输出 12），来源已由适配层核对是服务端的精确来源。 */
    pageWindowRequested(url: string): boolean {
        if (this.#stopping || this.#lastClose !== null || this.#serverUrl === null) return false;
        const id = this.#options.port.open({kind: "page", url});
        this.#windows.set(id, newWindowState("page"));
        return true;
    }

    /** 服务端就绪：启动页的窗口都转为产品窗口。`owned` 说明服务端是不是壳自己拉起的。 */
    serverReady(url: string, owned: boolean): void {
        this.#serverUrl = url;
        this.#ownsServer = owned;
        for (const [id, state] of this.#windows) {
            if (state.kind === "startup" && !state.closing) {
                state.kind = "page";
                this.#options.port.load(id, url);
            }
        }
    }

    /** 自有服务端意外退出且用户选了“稍后”：之后关窗不再停服务端（输出 21）。 */
    serverAbandoned(): void {
        this.#ownsServer = false;
    }

    closeRequested(id: WindowId): void {
        const state = this.#windows.get(id);
        if (state === undefined || state.closing || this.#stopping) return;
        if (state.kind === "startup") {
            this.#commit(id, false);
            return;
        }
        if (state.ask !== null) {
            // 询问进行中再次关：给用户“继续等待、取消关闭、强制关闭”（输出 14）。
            this.#showDialog(id, state);
            return;
        }
        this.#ask(id, state, this.#isLast(id) ? "quit" : "window");
    }

    /**
     * 应用级的退出请求（输出 19：系统或框架发来的退出，适配层已同步否决）：每个还活着的窗口都像用户关它一样走 `closeRequested`，
     * 启动页直接关，产品窗口各自询问，最后一个照常以 `quit` 询问；任何一个页面不同意，应用就照常运行。已经在问的窗口不再弹
     * “没有响应”（那是用户再次关同一个窗口时才给的），停止中再来的退出请求不用处理。
     */
    quitRequested(): void {
        if (this.#stopping) return;
        for (const [id, state] of [...this.#windows]) if (state.ask === null) this.closeRequested(id);
    }

    pageAcked(id: WindowId, generation: number): void {
        const ask = this.#windows.get(id)?.ask;
        if (ask === null || ask === undefined || ask.generation !== generation || ask.acked) return;
        ask.acked = true;
        ask.cancelTimer();
    }

    pageAnswered(id: WindowId, generation: number, answer: "allow" | "deny"): void {
        const state = this.#windows.get(id);
        const ask = state?.ask;
        if (state === undefined || ask === null || ask === undefined || ask.generation !== generation) return;
        this.#endAsk(id, state, false);
        if (answer === "deny") return;
        if (ask.reason === "window" && this.#isLast(id)) {
            // 询问期间别的窗口关掉了，它已是最后一个：以 quit 重新问一次（输出 16）。
            this.#ask(id, state, "quit");
            return;
        }
        this.#commit(id, this.#isLast(id));
    }

    dialogChose(id: WindowId, choice: "wait" | "cancel" | "force"): void {
        const state = this.#windows.get(id);
        if (state === undefined || !state.dialogOpen) return;
        state.dialogOpen = false;
        this.#options.port.closeNotResponding(id);
        const ask = state.ask;
        if (ask === null) return;
        if (choice === "wait") {
            if (!ask.acked) ask.cancelTimer = this.#ackTimer(id, ask);
            return;
        }
        this.#endAsk(id, state, true);
        if (choice === "force") this.#commit(id, this.#isLast(id));
    }

    closed(id: WindowId): void {
        const state = this.#windows.get(id);
        if (state === undefined) return;
        if (state.ask !== null) this.#endAsk(id, state, true);
        if (state.dialogOpen) this.#options.port.closeNotResponding(id);
        this.#windows.delete(id);
        if (this.#hintHolder === id) this.#handOverHint(id);
        if (this.#windows.size === 0) this.#options.onAllClosed();
    }

    /** 窗口获得焦点。 */
    focused(id: WindowId): void {
        const state = this.#windows.get(id);
        if (state === undefined) return;
        this.#focusSequence += 1;
        state.focusedAt = this.#focusSequence;
    }

    /** 页面的界面挂好了。持有窗口又报一次是刷新：转给当时最近焦点的就绪窗口（可能还是它）。 */
    pageReady(id: WindowId): void {
        const state = this.#windows.get(id);
        if (state === undefined || state.kind !== "page" || state.closing) return;
        state.ready = true;
        if (this.#hint === null) return;
        if (this.#hintHolder === id || this.#hintHolder === null) this.#deliverHint();
    }

    /** 页面离开了就绪（服务端重启、项目关闭、页面卸载）。持有窗口离开时转交，并让它收起（页面还在时它的通知还在）。 */
    pageGone(id: WindowId): void {
        const state = this.#windows.get(id);
        if (state === undefined) return;
        state.ready = false;
        if (this.#hintHolder === id) this.#handOverHint(id);
    }

    /**
     * 更新控制器的当前提示变了。`endPrevious` 为真时上一条被新阶段取代，持有它的窗口收起；之后把新的一条交给最近焦点的
     * 就绪窗口。
     */
    setUpdateHint(current: {readonly id: number; readonly hint: UpdateHint} | null, endPrevious: boolean): void {
        const previous = this.#hint;
        const holder = this.#hintHolder;
        if (endPrevious && previous !== null && holder !== null && this.#windows.has(holder)) this.#options.port.endHint(holder, previous.id);
        this.#hint = current;
        this.#hintHolder = null;
        if (current !== null) this.#deliverHint();
    }

    get stopping(): boolean {
        return this.#stopping;
    }

    get windowCount(): number {
        return this.#windows.size;
    }

    /** 这个窗口是不是最后一个仍存活的窗口，且关掉它会停自有服务端。 */
    #isLast(id: WindowId): boolean {
        if (!this.#ownsServer) return false;
        for (const [other, state] of this.#windows) if (other !== id && !state.closing) return false;
        return true;
    }

    #ask(id: WindowId, state: WindowState, reason: CloseReason): void {
        this.#generation += 1;
        const ask: Ask = {generation: this.#generation, reason, acked: false, cancelTimer: () => undefined};
        state.ask = ask;
        if (reason === "quit") this.#lastClose = id;
        this.#options.port.askPage(id, ask.generation, reason);
        ask.cancelTimer = this.#ackTimer(id, ask);
    }

    #ackTimer(id: WindowId, ask: Ask): () => void {
        return at(this.#options.clock, this.#options.clock.now() + ACK_MS, () => {
            const state = this.#windows.get(id);
            if (state?.ask === ask && !ask.acked) this.#showDialog(id, state);
        });
    }

    #showDialog(id: WindowId, state: WindowState): void {
        if (state.dialogOpen) return;
        state.dialogOpen = true;
        this.#options.port.showNotResponding(id);
    }

    /** 结束这个窗口当前的询问；`notifyPage` 为真时告诉页面（取消、强制关闭、窗口已关）。 */
    #endAsk(id: WindowId, state: WindowState, notifyPage: boolean): void {
        const ask = state.ask;
        if (ask === null) return;
        ask.cancelTimer();
        state.ask = null;
        if (this.#lastClose === id) this.#lastClose = null;
        if (state.dialogOpen) {
            state.dialogOpen = false;
            this.#options.port.closeNotResponding(id);
        }
        if (notifyPage) this.#options.port.endAsk(id, ask.generation);
    }

    #commit(id: WindowId, quit: boolean): void {
        const state = this.#windows.get(id);
        if (state === undefined) return;
        state.closing = true;
        state.ready = false;
        if (this.#hintHolder === id) this.#handOverHint(id);
        if (quit) {
            this.#stopping = true;
            this.#options.onQuit();
        }
        this.#options.port.commitClose(id);
    }

    /** 持有窗口没了或离开就绪：还在的让它收起，再转给当时最近焦点的就绪窗口。 */
    #handOverHint(from: WindowId): void {
        const hint = this.#hint;
        this.#hintHolder = null;
        if (hint === null) return;
        const state = this.#windows.get(from);
        if (state !== undefined && !state.closing) this.#options.port.endHint(from, hint.id);
        this.#deliverHint();
    }

    /** 交给最近获得焦点的就绪产品窗口（正在关的在 `#commit` 里已不算就绪）；一个都没有时等下一个就绪的。停止中不再交。 */
    #deliverHint(): void {
        const hint = this.#hint;
        if (hint === null || this.#stopping) return;
        let best: WindowId | null = null;
        let bestFocus = -1;
        for (const [id, state] of this.#windows) {
            if (state.kind !== "page" || !state.ready) continue;
            // 焦点相同（都还没获得过）时取后开的。
            if (state.focusedAt >= bestFocus) {
                best = id;
                bestFocus = state.focusedAt;
            }
        }
        this.#hintHolder = best;
        if (best !== null) this.#options.port.sendHint(best, hint.id, hint.hint);
    }
}
