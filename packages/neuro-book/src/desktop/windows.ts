/**
 * 关窗协调（docs/specs/runtime/desktop-shell.md 输出 9、14 到 17、23、29 到 31）：纯状态机，经 `WindowPort` 操作窗口，事件由适配层
 * 按 Electrobun 的顺序送来：
 *
 * - 用户关窗：`will-close` 里已经同步否决，再送 `closeRequested`；真正关窗用 `commitClose`（不经 `will-close`），窗口没了才有
 *   `closed`。在 `closed` 之前窗口仍算存活的窗口之外（“正在关”），不再计入“最后一个”。
 * - 页面回答：`pageAcked`、`pageAnswered`，带询问的代次；只认当前代次。
 * - 对话框的选择：`dialogChose`。
 *
 * 最后一次关闭：关的是最后一个仍存活的产品窗口、按输出 29 的表原因是 `quit`（`#reasonFor`）时以 `quit` 询问。询问期间开窗转交
 * 回 `closing`、页面请求的新窗口被拒，窗口集合只会变少，所以同意时它一定还是最后一个；同意与进入停止中在同一个同步段里，中间
 * 开不出窗口。原因是 `window` 的询问（包括设置为 `tray` 时的最后一个窗口）不挡开窗；同意时按那一刻的情形重算原因，变成 `quit`
 * 就以 `quit` 再问一次。
 *
 * 应用级退出（输出 31）：`quitRequested` 置 `#appQuit`，任一询问被拒或取消时复位；置位期间不开新窗口，最后一个窗口的原因是
 * `quit`；窗口关完（剩下的本来就在关闭中）或本来就没有窗口时直接停止。
 *
 * 后台（输出 29）：窗口都关完时，服务端是自有的、设置是 `tray`、托盘图标显示着，就不调 `onAllClosed`，壳留在后台；托盘菜单经
 * `openFromTray`、`quitFromTray` 进来。
 *
 * 更新提示的交付（docs/specs/runtime/desktop-update.md 输出 3、4）：当前提示由更新控制器给（`setUpdateHint`），这里为它记一个
 * “持有窗口”。提示变化时交给最近获得焦点的就绪产品窗口；只在持有窗口关掉、刷新（又报一次就绪）、离开就绪时转给当时最近
 * 焦点的就绪窗口；别的窗口第一次就绪时只在没有持有窗口时接手。“就绪”由页面报（`pageReady`、`pageGone`）。
 */

import type {CloseLastWindow, CloseReason, UpdateHint} from "../shared/desktop-bridge";
import {RESUME_PATH} from "../shared/resume-path";

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
    /** 窗口都关完了（`closed` 之后），且不留在后台、不是停止中关完的。 */
    readonly onAllClosed: () => void;
    /** 设置“关掉最后一个窗口时”此刻的值（壳从页面交来的值里取）；判断原因时现读。 */
    readonly closeLastWindow: () => CloseLastWindow;
    /** 托盘图标此刻是不是显示着（适配层建出来了）；没显示出来时按没有托盘处理。 */
    readonly trayShown: () => boolean;
    /** 窗口数变了（开了一个，或关掉一个之后）：壳据此算托盘的提示文字与在不在后台。 */
    readonly onWindowsChanged: (count: number) => void;
}

/** 托盘“打开”的结果：置前这个窗口（适配层还原最小化的）、开了一个新窗口，或这时不能开（`null`）。 */
export type TrayOpen = {readonly focus: WindowId} | {readonly opened: WindowId} | null;

/** 带动作的提示：用户关掉之后，它的动作还留在通知中心里。 */
const ACTIONABLE_HINTS: ReadonlySet<UpdateHint["kind"]> = new Set(["available", "notify-only", "download-failed"]);

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
    /** 开它时没有别的窗口：加载“启动时打开”的路由，进上次的作品或书架（desktop-shell.md 输出 9）。 */
    resume: boolean;
}

function newWindowState(kind: WindowState["kind"], resume = false): WindowState {
    return {kind, closing: false, ask: null, dialogOpen: false, ready: false, focusedAt: 0, resume};
}

/** 窗口要加载的地址。服务端地址以斜杠结尾（`Bun.serve().url.href`），路由用 `new URL` 拼，字符串相加会成 `//api/…`。 */
const pageUrl = (serverUrl: string, resume: boolean): string => (resume ? new URL(RESUME_PATH, serverUrl).href : serverUrl);

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
    /** 应用级退出进行中（输出 31）。 */
    #appQuit = false;
    #hint: {readonly id: number; readonly hint: UpdateHint} | null = null;
    /** 当前提示交给了哪个窗口；null 是还没有就绪的窗口可交，等。 */
    #hintHolder: WindowId | null = null;
    /**
     * 被用户结束（“以后”、打开下载页）的带动作的提示：控制器清掉了它，但它还留在那个窗口的通知中心里，动作照样能点
     * （desktop-update 场景 7）。下一个阶段到来时让那个窗口收起它，否则中心里留着旧版本的动作。
     */
    #lingeringHint: {readonly id: number; readonly holder: WindowId} | null = null;
    #focusSequence = 0;

    constructor(options: WindowCoordinatorOptions) {
        this.#options = options;
    }

    /**
     * 开第一个窗口（或开窗转交、托盘与 Dock 再开一个）：服务端就绪了加载页面，否则显示启动页。此刻没有别的（不在关闭中的）窗口时，
     * 它加载“启动时打开”的路由，进上次的作品；已有窗口时再开的是书架。启动、托盘、Dock 与第二次启动都经这里，规则只写这一处。
     */
    openWindow(): WindowId {
        const resume = ![...this.#windows.values()].some((state) => !state.closing);
        const id = this.#options.port.open(this.#serverUrl === null ? {kind: "startup"} : {kind: "page", url: pageUrl(this.#serverUrl, resume)});
        this.#windows.set(id, newWindowState(this.#serverUrl === null ? "startup" : "page", resume));
        this.#options.onWindowsChanged(this.#windows.size);
        return id;
    }

    /** 锁上的 `open-window`（输出 2）：同步决定并开窗。 */
    openWindowRequested(): {ok: true} | {ok: false; code: "closing" | "stopping"} {
        if (this.#stopping) return {ok: false, code: "stopping"};
        if (this.#lastClose !== null || this.#appQuit) return {ok: false, code: "closing"};
        this.openWindow();
        return {ok: true};
    }

    /** 页面以网页方式请求的新窗口（输出 12），来源已由适配层核对是服务端的精确来源。 */
    pageWindowRequested(url: string): boolean {
        if (this.#stopping || this.#lastClose !== null || this.#appQuit || this.#serverUrl === null) return false;
        const id = this.#options.port.open({kind: "page", url});
        this.#windows.set(id, newWindowState("page"));
        this.#options.onWindowsChanged(this.#windows.size);
        return true;
    }

    /** 服务端就绪：启动页的窗口都转为产品窗口。`owned` 说明服务端是不是壳自己拉起的。 */
    serverReady(url: string, owned: boolean): void {
        this.#serverUrl = url;
        this.#ownsServer = owned;
        for (const [id, state] of this.#windows) {
            if (state.kind === "startup" && !state.closing) {
                state.kind = "page";
                // 启动期间转交来的再开的启动页不 resume：只有开它时没有别的窗口的那一个进上次的作品。
                this.#options.port.load(id, pageUrl(url, state.resume));
            }
        }
    }

    /** 自有服务端意外退出且用户选了“稍后”：之后关窗不再停服务端（输出 21）；在后台时（没有窗口）壳就此退出。 */
    serverAbandoned(): void {
        this.#ownsServer = false;
        if (this.#windows.size === 0 && !this.#stopping) this.#options.onAllClosed();
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
        this.#ask(id, state, this.#reasonFor(id));
    }

    /**
     * 应用级退出（输出 19 的框架退出请求、输出 30 的托盘“退出”，输出 31）：每个还活着的窗口都像用户关它一样走 `closeRequested`，
     * 启动页直接关，产品窗口各自询问，最后一个以 `quit` 询问；任何一个页面不同意或取消关闭，这次退出就结束，应用照常运行。
     * 已经在问的窗口不再弹“没有响应”（那是用户再次关同一个窗口时才给的），它同意时按重算的原因再问。没有窗口时（后台）直接
     * 停止。停止中再来的退出请求不用处理。
     */
    quitRequested(): void {
        if (this.#stopping) return;
        this.#appQuit = true;
        if (this.#windows.size === 0) {
            this.#quit();
            return;
        }
        for (const [id, state] of [...this.#windows]) if (state.ask === null) this.closeRequested(id);
    }

    /**
     * 托盘菜单的“打开”（输出 30）：有不在关闭中的产品窗口时置前最近获得焦点的那个；没有时开一个新窗口，规则与开窗转交相同
     * （应用级退出或最后一次关闭进行中、停止中都不开）。
     */
    openFromTray(): TrayOpen {
        if (this.#stopping) return null;
        let best: WindowId | null = null;
        let bestFocus = -1;
        for (const [id, state] of this.#windows) {
            if (state.kind !== "page" || state.closing) continue;
            if (state.focusedAt >= bestFocus) {
                best = id;
                bestFocus = state.focusedAt;
            }
        }
        if (best !== null) return {focus: best};
        if (this.#lastClose !== null || this.#appQuit || this.#serverUrl === null) return null;
        return {opened: this.openWindow()};
    }

    /**
     * 托盘菜单的“退出”（输出 30）：有窗口时就是应用级退出（`"quitting"`）；没有窗口时交回 `"check-work"`，由壳先取在跑的工作，
     * 决定之后再调 `quitRequested`。停止中交回 `"stopping"`，不用处理。
     */
    quitFromTray(): "quitting" | "check-work" | "stopping" {
        if (this.#stopping) return "stopping";
        if (this.#windows.size === 0) return "check-work";
        this.quitRequested();
        return "quitting";
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
        if (answer === "deny") {
            this.#appQuit = false;
            return;
        }
        if (ask.reason === "quit") {
            // 以 quit 问的得到同意就停止，询问期间设置改成 tray 也一样（输出 29）。
            this.#commit(id, true);
            return;
        }
        if (this.#reasonFor(id) === "quit") {
            // 询问期间情形变了（别的窗口关掉了、设置改成 quit、托盘没了、来了应用级退出）：以 quit 重新问一次（输出 16、29）。
            this.#ask(id, state, "quit");
            return;
        }
        this.#commit(id, false);
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
        if (choice === "cancel") {
            this.#appQuit = false;
            return;
        }
        // 强制关闭：这次询问的原因与此刻算的原因有一个是 quit，就以 quit 提交（输出 29）。
        this.#commit(id, ask.reason === "quit" || this.#reasonFor(id) === "quit");
    }

    closed(id: WindowId): void {
        const state = this.#windows.get(id);
        if (state === undefined) return;
        if (state.ask !== null) this.#endAsk(id, state, true);
        if (state.dialogOpen) this.#options.port.closeNotResponding(id);
        this.#windows.delete(id);
        if (this.#hintHolder === id) this.#handOverHint(id);
        this.#options.onWindowsChanged(this.#windows.size);
        if (this.#windows.size > 0) return;
        if (this.#stopping) {
            this.#options.onAllClosed();
            return;
        }
        // 应用级退出进行中，剩下的窗口本来就在关闭中（没有一个以 quit 问过）：关完就停止（输出 31）。服务端不归壳时（启动中、
        // 连别人的实例、选过“稍后”）照旧走 onAllClosed：壳据此结束启动流程、不停别人的服务端。
        if (this.#appQuit) {
            if (this.#ownsServer) this.#quit();
            else this.#options.onAllClosed();
            return;
        }
        if (this.#ownsServer && this.#trayMode()) return;
        this.#options.onAllClosed();
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
        if (endPrevious) {
            if (previous !== null && holder !== null && this.#windows.has(holder)) this.#options.port.endHint(holder, previous.id);
            const lingering = this.#lingeringHint;
            if (lingering !== null && this.#windows.has(lingering.holder)) this.#options.port.endHint(lingering.holder, lingering.id);
            this.#lingeringHint = null;
        } else if (current === null && previous !== null && holder !== null && ACTIONABLE_HINTS.has(previous.hint.kind)) {
            this.#lingeringHint = {id: previous.id, holder};
        }
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

    /** 这个窗口是不是最后一个仍存活（不在关闭中）的窗口。 */
    #isLast(id: WindowId): boolean {
        for (const [other, state] of this.#windows) if (other !== id && !state.closing) return false;
        return true;
    }

    /** 设置是 `tray`、托盘图标显示着：最后一个窗口关掉之后留在后台。 */
    #trayMode(): boolean {
        return this.#options.closeLastWindow() === "tray" && this.#options.trayShown();
    }

    /** 关这个窗口的询问原因（输出 29 的表）：`quit` 的询问同意后停止。 */
    #reasonFor(id: WindowId): CloseReason {
        if (!this.#isLast(id) || !this.#ownsServer) return "window";
        if (this.#appQuit) return "quit";
        return this.#trayMode() ? "window" : "quit";
    }

    /** 进入停止中（`onQuit` 只调一次）。 */
    #quit(): void {
        if (this.#stopping) return;
        this.#stopping = true;
        this.#options.onQuit();
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
        if (quit) this.#quit();
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
