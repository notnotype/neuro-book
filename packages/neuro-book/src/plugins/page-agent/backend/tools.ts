/**
 * `ui` 的方法工具（docs/specs/agent/page-agent.md 的“输入与前置条件”）：每次调用先选窗口，再经远程合同交给窗口里的页面引擎。
 * 业务失败交回 `status: "error"` 与码，eval 代码里抛出带这个码的错误（输出 12）；窗口类的失败按输出 14 从通道的结局换来。
 */

import type {JsonValue, ToolContext, ToolResult, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import {CandidateSchema, locatorKind, SNAPSHOT_DEFAULT_TOKENS, SnapshotResultSchema} from "@notnotype/nb-page-agent/api";
import type {Locator} from "@notnotype/nb-page-agent/api";
import type {RemoteAccess, RemoteFailure} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";

import {agentTool} from "nbook/plugins/agent/shared/contracts";
import type {AgentToolImplementation} from "nbook/plugins/agent/shared/contracts";

import {FIND_DEFAULT_LIMIT, FIND_TOOL, FindEntrySchema, pageAgentWindowContract, SCREENSHOT_TOOL, SNAPSHOT_TOOL, toPageLocator, UI_OBJECT, UiFindArgsSchema, UiScreenshotArgsSchema, UiSnapshotArgsSchema} from "../shared/contracts";
import type {FindKind, PageFailureDetail, UiLocator, WindowInfo} from "../shared/contracts";
import type {CaptureStore} from "./captures";
import {callFailure} from "./windows";
import type {WindowFailure, WindowSelector} from "./windows";

/** 快照与目录的窗口时限（输出 2）。 */
export const READ_TIMEOUT_MS = 3000;
/** 截图的窗口时限（输出 2）。 */
export const CAPTURE_TIMEOUT_MS = 15_000;

/** 结果里写给代码的窗口信息：选中了哪个窗口（输出 8 要写明截的是哪个）。 */
export const WindowSummarySchema = Type.Object({
    name: Type.String(),
    title: Type.String(),
    path: Type.String(),
    width: Type.Integer(),
    height: Type.Integer(),
    focused: Type.Boolean(),
}, {additionalProperties: false});

const SnapshotReturnsSchema = Type.Object({window: WindowSummarySchema, ...SnapshotResultSchema.properties}, {additionalProperties: false});
const FindReturnsSchema = Type.Object({window: WindowSummarySchema, entries: Type.Array(FindEntrySchema)}, {additionalProperties: false});
const ScreenshotReturnsSchema = Type.Object({
    window: WindowSummarySchema,
    target: Type.Union([Type.Literal("window"), Type.Literal("element")]),
    width: Type.Integer(),
    height: Type.Integer(),
}, {additionalProperties: false});

/**
 * 失败时交给代码的 `details`（Spec 输出 12、14），按码声明（contributions.md 输出 24 的 `errors`）：定位类的带当前候选，
 * 窗口类的带通道的原码。没有可带的时候结果里不放 `details`。
 */
// 展开成普通对象：声明的类型是 JSON Schema 的记录，TypeBox 的对象类型没有索引签名（同 `returns`）。
export const CandidatesDetailSchema = {...Type.Object({candidates: Type.Array(CandidateSchema, {maxItems: 10})}, {additionalProperties: false})};
const CauseDetailSchema = {...Type.Object({cause: Type.String()}, {additionalProperties: false})};
export const WINDOW_ERRORS = {"no-window": CauseDetailSchema, "window-gone": CauseDetailSchema, "window-unresponsive": CauseDetailSchema};
export const LOCATOR_ERRORS = {"stale-ref": CandidatesDetailSchema, ambiguous: CandidatesDetailSchema, "not-found": CandidatesDetailSchema};

/** `foreground`：`ui` 看的是用户眼前的窗口，没有人在窗口前的会话（后台任务、bot）用不上（contributions.md 输出 4）。 */
export const toolBase = {version: "1", concurrency: "shared" as const, defaultForAll: true, foreground: true as const};

export const snapshotTool = agentTool(SNAPSHOT_TOOL, {
    ...toolBase,
    description: "当前 NeuroBook 窗口的文字快照：看得见的可交互元素与带名字的容器，每行带引用（ref）、状态与稳定名。",
    parameters: {...UiSnapshotArgsSchema},
    effect: "read",
    global: {object: UI_OBJECT, method: "snapshot"},
    returns: {...SnapshotReturnsSchema},
    errors: {...WINDOW_ERRORS, ...LOCATOR_ERRORS},
});

export const findTool = agentTool(FIND_TOOL, {
    ...toolBase,
    description: "在界面目录里找设置项、设置窗口的节、视图与命令，交回每条怎样一步步点到（path）。",
    parameters: {...UiFindArgsSchema},
    effect: "read",
    global: {object: UI_OBJECT, method: "find"},
    returns: {...FindReturnsSchema},
    errors: WINDOW_ERRORS,
});

export const screenshotTool = agentTool(SCREENSHOT_TOOL, {
    ...toolBase,
    description: "截当前 NeuroBook 窗口或其中一个控件，结果里附一张 JPEG。",
    parameters: {...UiScreenshotArgsSchema},
    effect: "exec",
    global: {object: UI_OBJECT, method: "screenshot"},
    returns: {...ScreenshotReturnsSchema},
    errors: {...WINDOW_ERRORS, ...LOCATOR_ERRORS, "window-hidden": CandidatesDetailSchema},
});

export interface UiToolDeps {
    readonly remote: () => RemoteAccess;
    readonly windows: WindowSelector;
    readonly captures: CaptureStore;
}

export function windowSummary(info: WindowInfo): JsonValue {
    return {name: info.name, title: info.title, path: info.path, width: info.width, height: info.height, focused: info.focused};
}

export function failureResult(code: string, message: string, details?: Readonly<Record<string, JsonValue>>): ToolResult {
    return details === undefined ? {text: message, status: "error", code} : {text: message, status: "error", code, details};
}

export function windowFailureResult(failure: WindowFailure): ToolResult {
    return failureResult(failure.code, failure.message, failure.cause === undefined ? undefined : {cause: failure.cause});
}

/** 窗口交回的失败：页面里的码原样交给代码（带候选），通道的失败按输出 14 换算。 */
export function windowCallFailure(failure: RemoteFailure<string>): ToolResult {
    const detail = failure.detail as PageFailureDetail | undefined;
    switch (failure.code) {
        case "stale-ref":
        case "ambiguous":
        case "not-found":
        case "window-hidden":
            return failureResult(failure.code, detail?.message ?? failure.code, detail?.candidates === undefined ? undefined : {candidates: detail.candidates as unknown as JsonValue});
        case "invalid-locator":
            return failureResult("invalid-arguments", detail?.message ?? "定位写错了");
        case "capture-failed":
            return failureResult("window-unresponsive", detail?.message ?? "窗口没能画出截图", {cause: "capture-failed"});
        case "guide-failed":
            return failureResult("window-unresponsive", detail?.message ?? "窗口没能画出高亮", {cause: "guide-failed"});
        default:
            return windowFailureResult(callFailure(failure as RemoteFailure));
    }
}

/** 把 `ui` 的定位换成页面引擎的，并在发给窗口之前核对“恰好一种主定位”；写错时交回参数错误。 */
export function pageLocator(locator: UiLocator | undefined): {readonly ok: true; readonly locator: Locator | undefined} | {readonly ok: false; readonly result: ToolResult} {
    if (locator === undefined) return {ok: true, locator: undefined};
    const converted = toPageLocator(locator);
    if (!converted.ok) return {ok: false, result: failureResult("invalid-arguments", converted.message)};
    const {within, ...base} = converted.locator;
    for (const [part, label] of [[base, ""], [within, "within："]] as const) {
        if (part === undefined) continue;
        const kind = locatorKind(part);
        if (!kind.ok) return {ok: false, result: failureResult("invalid-arguments", `${label}${kind.message}`)};
    }
    return {ok: true, locator: converted.locator};
}

export function sessionOf(context: ToolSessionContext): {readonly id: string; readonly project?: string} {
    return context.project === undefined ? {id: context.sessionId} : {id: context.sessionId, project: context.project};
}

export function snapshotImplementation(deps: UiToolDeps): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, context: ToolContext) => {
                const input = args as {scope?: UiLocator; includeText?: boolean; maxTokens?: number};
                const scope = pageLocator(input.scope);
                if (!scope.ok) return scope.result;
                const selected = await deps.windows.select(sessionOf(session), context.signal);
                if (!selected.ok) return windowFailureResult(selected);
                const result = await deps.remote().use(pageAgentWindowContract).at({client: selected.id}).snapshot({
                    ...(scope.locator === undefined ? {} : {scope: scope.locator}),
                    ...(input.includeText === undefined ? {} : {includeText: input.includeText}),
                    maxTokens: input.maxTokens ?? SNAPSHOT_DEFAULT_TOKENS,
                }, {signal: context.signal, timeout: READ_TIMEOUT_MS});
                if (!result.ok) return windowCallFailure(result);
                const {window, snapshot} = result.value;
                return {text: snapshot.text, details: {window: windowSummary(window), ...snapshot} as unknown as JsonValue};
            },
        }),
    };
}

export function findImplementation(deps: UiToolDeps): AgentToolImplementation {
    return {
        create: (session) => ({
            execute: async (args, context: ToolContext) => {
                const input = args as {query: string; kind?: FindKind; limit?: number};
                const selected = await deps.windows.select(sessionOf(session), context.signal);
                if (!selected.ok) return windowFailureResult(selected);
                const result = await deps.remote().use(pageAgentWindowContract).at({client: selected.id}).find({
                    query: input.query,
                    ...(input.kind === undefined ? {} : {kind: input.kind}),
                    limit: input.limit ?? FIND_DEFAULT_LIMIT,
                }, {signal: context.signal, timeout: READ_TIMEOUT_MS});
                if (!result.ok) return windowCallFailure(result);
                const {window, entries} = result.value;
                const lines = entries.map((entry) => `- ${entry.kind} ${JSON.stringify(entry.title)} ${entry.id}（${String(entry.path.length)} 步）`);
                const text = entries.length === 0 ? `界面目录里没有找到 ${JSON.stringify(input.query)}` : lines.join("\n");
                return {text, details: {window: windowSummary(window), entries} as unknown as JsonValue};
            },
        }),
    };
}

/**
 * 截图（输出 8）：审批在调用之前（判定对象 `{kind: "screen", value}`），通过后才签发上传凭证；窗口画好、上传、回报成功，
 * 服务端核对收到的图之后才交进结果。调用结束（成功、失败、被停止）时凭证与暂存的图一起作废。
 */
export function screenshotImplementation(deps: UiToolDeps): AgentToolImplementation {
    return {
        subjects: (args) => [{kind: "screen", value: (args as {of?: unknown}).of === undefined ? "window" : "element"}],
        create: (session) => ({
            execute: async (args, context: ToolContext) => {
                const of = pageLocator((args as {of?: UiLocator}).of);
                if (!of.ok) return of.result;
                const selected = await deps.windows.select(sessionOf(session), context.signal);
                if (!selected.ok) return windowFailureResult(selected);
                if (!selected.info.visible) return failureResult("window-hidden", "选中的窗口看不见：请用户切回那个 NeuroBook 窗口");
                const slot = deps.captures.issue(context.signal);
                try {
                    const result = await deps.remote().use(pageAgentWindowContract).at({client: selected.id}).capture(
                        {token: slot.token, ...(of.locator === undefined ? {} : {of: of.locator})},
                        {signal: context.signal, timeout: CAPTURE_TIMEOUT_MS},
                    );
                    if (!result.ok) return windowCallFailure(result);
                    const image = slot.take();
                    if (image === null) return failureResult("window-unresponsive", "窗口说截好了，服务端没有收到合格的图：稍后重试", {cause: "capture-missing"});
                    const {window, target} = result.value;
                    const what = target === "window" ? "窗口" : "控件";
                    return {
                        text: `截了${what}（窗口 ${window.name} ${JSON.stringify(window.title)}，${String(image.width)}×${String(image.height)}）`,
                        images: [{data: Buffer.from(image.bytes).toString("base64"), mime: "image/jpeg", width: image.width, height: image.height}],
                        details: {window: windowSummary(window), target, width: image.width, height: image.height},
                    };
                } finally {
                    slot.discard();
                }
            },
        }),
    };
}
