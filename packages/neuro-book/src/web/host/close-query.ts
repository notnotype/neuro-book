/**
 * 页面一侧的关闭前询问（docs/specs/runtime/browser-host.md 输出 9、10）：接下桌面壳的询问，按顺序问参与方、宿主页上未保存的正文与
 * 服务端在跑的工作，回答 `allow` 或 `deny`。不依赖 Vue 与 DOM：桥、窗口、取工作、提问与“正在关闭”层都由装配方（`boot.ts`）给出。
 *
 * 在窗口启动之前建立：启动中（加载页）来的询问也要立即接下，壳 3 秒没收到接下就弹“没有响应”。
 *
 * 一次询问的先后：
 *
 * 1. 收到 `close-query`：上一次还在就先按结束处理；立即回 `close-ack`；盖层。
 * 2. 窗口就绪时逐个调参与方（`window.closeParticipants()` 的顺序），前一个完成才调下一个，有 `deny` 就停；抛错时写诊断并问
 *    “仍然关闭 / 取消”，仍然关闭就接着问下一个。询问中途窗口离开就绪（服务端重启、项目已关闭）时，正在调用的参与方的
 *    `signal` abort，改从第 3 步接着走。
 * 3. 窗口是列出了未保存正文的宿主页时，确认“关闭后这些正文会丢失”。
 * 4. 原因是 `quit` 时取在跑的工作，8 秒取不到按取不到算；有工作、有取不到的或整个取不到时提示。
 * 5. 都过了回 `allow`，否则 `deny`。
 *
 * 每一步等待之后都先核对这次是否已结束（`close-end`、新的询问）；结束了就不再往下走、不再回答，提问随 `signal` 收起。
 * `deny` 与被壳结束时撤层并恢复焦点；`allow` 时层保留到窗口关掉。壳在 `window` 的同意之后可能以 `quit` 再问一次（别的窗口
 * 在询问期间关掉了，desktop-shell 输出 16）：层一直盖着、页面没有输入，参与方的结论不会变，所以这时跳过第 2 步。同意之后
 * 10 秒窗口还没关、也没有新询问，就撤层写诊断，免得页面一直不能用。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {CloseReason, DesktopBridge, ShellMessage} from "nbook/shared/desktop-bridge";
import type {CloseParticipant} from "nbook/shared/host";
import type {RunningWorkReport} from "nbook/shared/running-work";

import type {WindowState} from "./window";

/** 宿主自己的三种询问。 */
export type ClosePrompt =
    | {readonly kind: "participant-failed"; readonly reason: string}
    | {readonly kind: "rescued-lost"; readonly paths: ReadonlyArray<string>}
    /** `uncertain`：有取不到的项目或插件，或整个取不到。 */
    | {readonly kind: "work"; readonly items: RunningWorkReport["items"]; readonly uncertain: boolean};

export interface ClosePrompts {
    /** 开一个询问；`signal` abort 时收起它，Promise 以 `cancel` 完成。 */
    ask(prompt: ClosePrompt, signal: AbortSignal): Promise<"close" | "cancel">;
}

/** “正在关闭”层：盖上时页面不接受输入；撤下时把焦点还给盖层之前的位置。重复盖、重复撤都无副作用。 */
export interface CloseLayer {
    show(): void;
    hide(): void;
}

/** 询问要看的窗口部分。 */
export interface CloseWindowView {
    readonly state: WindowState;
    onChange(listener: (state: WindowState) => void): () => void;
    closeParticipants(): ReadonlyArray<CloseParticipant>;
}

export interface CloseQueryOptions {
    readonly bridge: DesktopBridge;
    readonly window: CloseWindowView;
    /** 取服务端在跑的工作；失败抛错，`signal` abort 时也抛。 */
    readonly fetchWork: (signal: AbortSignal) => Promise<RunningWorkReport>;
    readonly prompts: ClosePrompts;
    readonly layer: CloseLayer;
    readonly report: (input: DiagnosticInput) => void;
    readonly clock: RuntimeClock;
}

export interface CloseQuery {
    /** 有询问在进行，或同意之后层还盖着：键盘拦截据此生效。 */
    readonly active: boolean;
    dispose(): void;
}

/** 取在跑的工作的上限：比服务端向项目取工作的 5 秒长，才收得到服务端汇总的“取不到”。 */
export const WORK_TIMEOUT_MS = 8_000;
/** 同意之后等窗口关掉的上限。 */
export const NOT_CLOSED_MS = 10_000;

interface Query {
    readonly generation: number;
    readonly controller: AbortController;
    /** 正在调用的参与方的 signal；窗口离开就绪时 abort 它（不结束整次询问）。 */
    participant: AbortController | null;
}

/** `signal` abort 时 resolve：等一个可能永不 settle 的 Promise 时与它赛跑。 */
function aborted(signal: AbortSignal): Promise<"aborted"> {
    return new Promise((resolve) => {
        if (signal.aborted) resolve("aborted");
        else signal.addEventListener("abort", () => resolve("aborted"), {once: true});
    });
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createCloseQuery(options: CloseQueryOptions): CloseQuery {
    let current: Query | null = null;
    /** 上一次以 `allow` 结束、层还盖着：它的代次。 */
    let heldAfterAllow: number | null = null;
    let cancelNotClosed: (() => void) | null = null;

    const send = (message: Parameters<DesktopBridge["send"]>[0]): void => {
        if (options.bridge.send(message)) return;
        options.report({level: "warn", event: "browser-host.close.no-bridge", message: "页面里没有桌面壳的发送函数，关闭前询问回答不了", data: {type: message.type}});
    };

    const release = (): void => {
        cancelNotClosed?.();
        cancelNotClosed = null;
        heldAfterAllow = null;
        options.layer.hide();
    };

    /** 结束一次询问：abort 它（提问随之收起），之后它的步骤都不再往下走。 */
    const end = (query: Query): void => {
        if (current === query) current = null;
        query.controller.abort();
    };

    const finish = (query: Query, answer: "allow" | "deny"): void => {
        if (current !== query) return;
        current = null;
        query.controller.abort();
        send({type: "close-answer", generation: query.generation, answer});
        if (answer === "deny") {
            release();
            return;
        }
        heldAfterAllow = query.generation;
        cancelNotClosed = options.clock.schedule(() => {
            cancelNotClosed = null;
            if (heldAfterAllow !== query.generation || current !== null) return;
            options.report({level: "warn", event: "browser-host.close.not-closed", message: `同意关闭之后 ${String(NOT_CLOSED_MS / 1000)} 秒窗口还没关，撤下“正在关闭”层`, data: {generation: query.generation}});
            release();
        }, NOT_CLOSED_MS);
    };

    const ended = (query: Query): boolean => current !== query || query.controller.signal.aborted;

    const askParticipants = async (query: Query, reason: CloseReason): Promise<"allow" | "deny" | "ended"> => {
        for (const participant of options.window.closeParticipants()) {
            if (options.window.state.status !== "ready") return "allow";
            const controller = new AbortController();
            query.participant = controller;
            const signal = AbortSignal.any([query.controller.signal, controller.signal]);
            let outcome: {readonly ok: true; readonly answer: "allow" | "deny" | "aborted"} | {readonly ok: false; readonly error: unknown};
            try {
                outcome = {ok: true, answer: await Promise.race([participant({reason, signal}), aborted(signal)])};
            } catch (error) {
                outcome = {ok: false, error};
            } finally {
                query.participant = null;
            }
            if (ended(query)) return "ended";
            // 窗口离开了就绪：这个参与方的结果不再采用，后面的也不再问，改按宿主页接着走。
            if (controller.signal.aborted) return "allow";
            if (outcome.ok) {
                if (outcome.answer === "deny") return "deny";
                continue;
            }
            options.report({level: "warn", event: "browser-host.close.participant-failed", message: "关闭前的检查出错", error: outcome.error});
            const choice = await options.prompts.ask({kind: "participant-failed", reason: describe(outcome.error)}, query.controller.signal);
            if (ended(query)) return "ended";
            if (choice === "cancel") return "deny";
        }
        return "allow";
    };

    const fetchWork = async (query: Query): Promise<{readonly items: RunningWorkReport["items"]; readonly uncertain: boolean}> => {
        const timeout = new AbortController();
        const cancel = options.clock.schedule(() => timeout.abort(), WORK_TIMEOUT_MS);
        try {
            const report = await options.fetchWork(AbortSignal.any([query.controller.signal, timeout.signal]));
            return {items: report.items, uncertain: report.failed.length > 0};
        } catch (error) {
            if (!ended(query)) options.report({level: "warn", event: "browser-host.close.work-unavailable", message: timeout.signal.aborted ? `${String(WORK_TIMEOUT_MS / 1000)} 秒内没取到在跑的工作` : "取不到在跑的工作", error});
            return {items: [], uncertain: true};
        } finally {
            cancel();
        }
    };

    const run = async (query: Query, reason: CloseReason, skipParticipants: boolean): Promise<void> => {
        if (!skipParticipants && options.window.state.status === "ready") {
            const answer = await askParticipants(query, reason);
            if (answer === "ended") return;
            if (answer === "deny") {
                finish(query, "deny");
                return;
            }
        }
        const state = options.window.state;
        if ("rescued" in state && state.rescued !== undefined && state.rescued.length > 0) {
            const choice = await options.prompts.ask({kind: "rescued-lost", paths: state.rescued.map((item) => item.path)}, query.controller.signal);
            if (ended(query)) return;
            if (choice === "cancel") {
                finish(query, "deny");
                return;
            }
        }
        if (reason === "quit") {
            const work = await fetchWork(query);
            if (ended(query)) return;
            if (work.items.length > 0 || work.uncertain) {
                const choice = await options.prompts.ask({kind: "work", items: work.items, uncertain: work.uncertain}, query.controller.signal);
                if (ended(query)) return;
                if (choice === "cancel") {
                    finish(query, "deny");
                    return;
                }
            }
        }
        finish(query, "allow");
    };

    const onMessage = (message: ShellMessage): void => {
        if (message.type === "close-end") {
            if (current?.generation === message.generation) {
                end(current);
                release();
            } else if (current === null && heldAfterAllow === message.generation) {
                release();
            }
            return;
        }
        if (current !== null) end(current);
        const skipParticipants = heldAfterAllow !== null;
        cancelNotClosed?.();
        cancelNotClosed = null;
        heldAfterAllow = null;
        const query: Query = {generation: message.generation, controller: new AbortController(), participant: null};
        current = query;
        send({type: "close-ack", generation: message.generation});
        options.layer.show();
        run(query, message.reason, skipParticipants).catch((error: unknown) => {
            // 走到这里是本模块的缺陷：不回答，壳那边用户再点关闭会看到“没有响应”，可以取消或强制关闭。
            options.report({level: "error", event: "browser-host.close.failed", message: "关闭前询问出错", error});
        });
    };

    const stopListening = options.bridge.listen(onMessage);
    const stopWatching = options.window.onChange((state) => {
        if (state.status !== "ready") current?.participant?.abort();
    });

    return {
        get active() {
            return current !== null || heldAfterAllow !== null;
        },
        dispose() {
            stopListening();
            stopWatching();
            if (current !== null) end(current);
            release();
        },
    };
}
