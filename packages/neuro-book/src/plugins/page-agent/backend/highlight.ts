/**
 * `ui.highlight`（docs/specs/agent/page-agent.md 输出 9、11、14）：选窗口，订阅窗口的 `highlight` 事件，等到结局就退订。
 *
 * 一次调用的先后：
 * 1. 订阅之前先登记好“只结算一次”的收尾（`finish`）：取消、插件停止、装上的截止、订阅结束、窗口的事件，谁先到算谁。
 * 2. 订阅的句柄是异步交回的：交回之前已经结算了（被取消、事件先到），拿到句柄就退订。
 * 3. 收到 `installed` 才开始等用户：从这时起按 `timeout` 计时（服务端的时钟，窗口转后台或被节流照样到点），并向 eval 自报
 *    在等用户，这段不计进单元时限；结算时一定收回。
 *
 * 装上之后窗口断开、插件停止都是结局 `window-gone`（输出 9 的结局表）；装上之前同样的事是失败，代码里抛出（失败与恢复表）。
 */

import type {JsonValue, ToolContext, ToolResult} from "@notnotype/nb-harness/kernel/contracts";
import {CandidateSchema} from "@notnotype/nb-page-agent/api";
import type {HighlightArgs, PageOutcome} from "@notnotype/nb-page-agent/api";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteFailure, RemoteSubscription} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";

import {agentTool} from "nbook/plugins/agent/shared/contracts";
import type {AgentToolImplementation} from "nbook/plugins/agent/shared/contracts";

import {HIGHLIGHT_DEFAULT_TIMEOUT_S, HIGHLIGHT_TOOL, pageAgentWindowContract, UI_OBJECT, UiHighlightArgsSchema} from "../shared/contracts";
import type {HighlightEvent, UiHighlightArgs} from "../shared/contracts";
import {CandidatesDetailSchema, failureResult, LOCATOR_ERRORS, pageLocator, sessionOf, toolBase, WINDOW_ERRORS, windowCallFailure, windowFailureResult, windowSummary, WindowSummarySchema} from "./tools";
import type {UiToolDeps} from "./tools";
import {callFailure} from "./windows";
import type {SelectedWindow} from "./windows";

/** 订阅开始到窗口画出高亮的截止（输出 2）。 */
export const INSTALL_TIMEOUT_MS = 10_000;

/** 交给代码的结局：页面上的，加上服务端结算的三种（`cancelled` 只记在日志里，代码已随单元结束）。 */
const OUTCOMES = ["clicked", "next", "back", "asked", "missed", "dismissed", "gone", "replaced", "timeout", "window-gone", "cancelled"] as const;
type Outcome = (typeof OUTCOMES)[number];

const HighlightReturnsSchema = Type.Object({
    window: WindowSummarySchema,
    outcome: Type.Union(OUTCOMES.map((outcome) => Type.Literal(outcome)), {description: "结局；以后会增加，不认识的当作引导中断"}),
    question: Type.Optional(Type.String({description: "outcome 为 asked 时用户的问题"})),
    clicked: Type.Optional(Type.Object(CandidateSchema.properties, {additionalProperties: false, description: "outcome 为 missed 时用户点到的控件，带引用"})),
}, {additionalProperties: false});

export const highlightTool = agentTool(HIGHLIGHT_TOOL, {
    ...toolBase,
    description: "高亮当前窗口里的一个控件并在旁边显示说明框，等用户点它（until: click）或点“下一步”（until: next），也可能提问、点错或跳过；交回结局。说明框里的话只作纯文字。",
    parameters: {...UiHighlightArgsSchema},
    effect: "read",
    global: {object: UI_OBJECT, method: "highlight"},
    returns: {...HighlightReturnsSchema},
    errors: {...WINDOW_ERRORS, ...LOCATOR_ERRORS, "window-hidden": CandidatesDetailSchema},
});

/** 插件停止时要结算的高亮。 */
export interface ActiveHighlights {
    /** 登记一次高亮在插件停止时怎么结算；交回的函数撤销登记。 */
    add(stop: () => void): () => void;
    /** 插件停止：全部结算。 */
    stopAll(): void;
}

export function createActiveHighlights(): ActiveHighlights {
    const active = new Set<() => void>();
    return {
        add: (stop) => {
            active.add(stop);
            return () => active.delete(stop);
        },
        stopAll: () => {
            for (const stop of [...active]) stop();
        },
    };
}

export interface HighlightDeps extends UiToolDeps {
    readonly clock: RuntimeClock;
    readonly active: ActiveHighlights;
}

export function highlightImplementation(deps: HighlightDeps): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, context: ToolContext) => {
                const {at, timeout, ...rest} = args as UiHighlightArgs;
                const target = pageLocator(at);
                if (!target.ok) return target.result;
                const selected = await deps.windows.select(sessionOf(session), context.signal);
                if (!selected.ok) return windowFailureResult(selected);
                if (!selected.info.visible) return failureResult("window-hidden", "选中的窗口看不见：请用户切回那个 NeuroBook 窗口");
                return runHighlight(deps, selected, {...rest, at: target.locator!}, (timeout ?? HIGHLIGHT_DEFAULT_TIMEOUT_S) * 1000, context);
            },
        }),
    };
}

function outcomeResult(window: JsonValue, outcome: Outcome, extra: {readonly question?: string; readonly clicked?: JsonValue} = {}): ToolResult {
    const said = extra.question === undefined ? "" : `：${JSON.stringify(extra.question)}`;
    const clicked = extra.clicked as {role?: string; name?: string} | undefined;
    const where = clicked === undefined ? "" : `（点了 ${clicked.role ?? ""} ${JSON.stringify(clicked.name ?? "")}）`;
    return {text: `结局：${outcome}${said}${where}`, details: {window, outcome, ...extra} as JsonValue};
}

function pageOutcomeResult(window: JsonValue, outcome: PageOutcome): ToolResult {
    switch (outcome.outcome) {
        case "asked": return outcomeResult(window, "asked", {question: outcome.question});
        case "missed": return outcomeResult(window, "missed", {clicked: outcome.clicked as unknown as JsonValue});
        default: return outcomeResult(window, outcome.outcome);
    }
}

function runHighlight(deps: HighlightDeps, selected: SelectedWindow, filter: HighlightArgs, timeoutMs: number, context: ToolContext): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
        let done = false;
        let installed = false;
        let window = windowSummary(selected.info);
        let subscription: RemoteSubscription | null = null;
        let stopWaiting: (() => void) | null = null;
        const cleanups: Array<() => void> = [];

        const finish = (result: ToolResult): void => {
            if (done) return;
            done = true;
            for (const cleanup of cleanups.splice(0)) cleanup();
            stopWaiting?.();
            subscription?.release();
            resolve(result);
        };
        /** 窗口不在了（断开、刷新、插件停止）：装上之后是结局，之前是失败。 */
        const windowGone = (cause: string): void => {
            if (installed) finish(outcomeResult(window, "window-gone"));
            else finish(failureResult("window-gone", "窗口在高亮装上之前断开或刷新了：重新快照，再做这一步", {cause}));
        };

        if (context.signal.aborted) {
            finish(outcomeResult(window, "cancelled"));
            return;
        }
        const onAbort = (): void => finish(outcomeResult(window, "cancelled"));
        context.signal.addEventListener("abort", onAbort, {once: true});
        cleanups.push(() => context.signal.removeEventListener("abort", onAbort));
        cleanups.push(deps.active.add(() => windowGone("provider-stopped")));
        cleanups.push(deps.clock.schedule(() => {
            if (!installed) finish(failureResult("window-unresponsive", `窗口在 ${String(INSTALL_TIMEOUT_MS / 1000)} 秒里没有画出高亮：稍后重试`, {cause: "timeout"}));
        }, INSTALL_TIMEOUT_MS));

        const onEvent = (event: HighlightEvent): void => {
            if (done) return;
            switch (event.kind) {
                case "installed": {
                    if (installed) return;
                    installed = true;
                    window = windowSummary(event.window);
                    cleanups.push(deps.clock.schedule(() => finish(outcomeResult(window, "timeout")), timeoutMs));
                    // 从装上起等用户（输出 11）：结算时 resolve，eval 的时限从这时起恢复。
                    const waiting = new Promise<void>((resolveWaiting) => {
                        stopWaiting = resolveWaiting;
                    });
                    void context.waitingForUser?.(waiting);
                    return;
                }
                case "outcome":
                    finish(pageOutcomeResult(window, event.outcome));
                    return;
                case "failed":
                    finish(windowCallFailure({ok: false, code: event.code, detail: event.detail} as unknown as RemoteFailure<string>));
                    return;
            }
        };
        const onEnd = (reason: string): void => {
            if (done) return;
            // 输出 14：订阅以 provider-stopped 或 target-gone 结束是窗口不在了，其余是窗口没应答。
            if (reason === "provider-stopped" || reason === "target-gone") windowGone(reason);
            else finish(failureResult("window-unresponsive", "窗口在高亮途中出了错：稍后重试", {cause: reason}));
        };

        void deps.remote().use(pageAgentWindowContract).at({client: selected.id}).events.highlight.subscribe(filter, onEvent, {onEnd}).then((result) => {
            if (!result.ok) {
                finish(windowFailureResult(callFailure(result)));
                return;
            }
            if (done) result.value.release();
            else subscription = result.value;
        });
    });
}
