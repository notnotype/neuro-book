/**
 * 内核自己的状态。path 一侧（随叶子走）：对话记录、进行中的运行与请求；session 一侧（线性，不随回退）：
 * 输入缓冲区、核心设置与各扩展的设置覆盖、标题与归档、批准记忆、当前的 Profile 哈希。叶子由会话自己跟踪
 * （最后一条 path 事件或 `leafChanged` 指向的节点）。
 */

import type {BufferedInput, CoreSettings, HeldCause, Issuer, JsonValue, LogEvent, RunEndReason, UserInput} from "../api/index.js";
import {initialHistory, reduceHistory, type HistoryState} from "./history.js";

export interface PathKernelState {
    readonly history: HistoryState;
    /** 进行中的运行：runStarted 之后、runEnded 之前。 */
    readonly run: {readonly runId: string; readonly turnId: string | null} | null;
    /** 发出了还没有结果的模型请求（各种用途：对话、审批、压缩、后台），按发出的顺序。中止与恢复按它逐项收口。 */
    readonly openRequests: readonly number[];
    /** 这条路径上最后一次告诉模型的工具集（`toolsAnnounced`）；还没告诉过时为 null。 */
    readonly announced: readonly {readonly id: string; readonly version: string; readonly code?: true}[] | null;
    /** 这条路径上写过 `notice{code: "result-requested"}`。 */
    readonly resultRequested: boolean;
    /** 这条路径上还没应答的等用户事项（`interactionRequested` 之后、`interactionResolved` 之前），按提出的顺序。 */
    readonly pending: readonly PendingInteraction[];
    /**
     * 当前这一轮里各扩展写过几条 `continued`（`turnStarted` 时清零）。按路径事实计数，不从对话的形状里数：
     * 压缩会切掉早先的步，`continue` 的上限不能跟着重置（extensions.md 输出 17）。
     */
    readonly continued: Readonly<Record<string, number>>;
    /**
     * 叶子上最后一次对话运行（只压缩的运行不算）：`start`、`resume` 判断能不能接着跑、谁能接着跑，`abort` 判断谁能停
     * （runtime.md 输出 4、106、108）。按路径事实归约，回退、切分支后跟着叶子变；还没有对话运行时为 null。
     */
    readonly lastChat: LastChatRun | null;
    /** 进行中的运行是谁开的（含只压缩的运行）；旧日志的 `runStarted` 没有 `by`，按用户算。没有运行时为 null。 */
    readonly runBy: Issuer | null;
}

export interface LastChatRun {
    readonly runId: string;
    /** 开它的发出者；旧日志没有 `by` 时是用户（开发者 2026-11-18 定，不按第一条输入推断）。 */
    readonly by: Issuer;
    /** 收口方式；还没收口（在跑或暂停）时为 null。 */
    readonly end: RunEndReason | null;
    /** `abort` 停下时的停的人。 */
    readonly stoppedBy: Issuer | null;
    /** 这次运行的最后一轮以 `completed` 结束（之后没有开新的轮）。 */
    readonly lastTurnCompleted: boolean;
}

const USER: Issuer = {kind: "user"};

export interface PendingInteraction {
    readonly id: string;
    readonly callId: string;
    readonly kind: "approval" | "question";
    readonly request: JsonValue;
    readonly async: boolean;
    /** 嵌套调用的事项：父调用的工具与 `invocation`（runtime.md 输出 94）。 */
    readonly within?: {readonly tool: string; readonly invocation: string};
}

export const initialPathKernel: PathKernelState = {history: initialHistory, run: null, openRequests: [], announced: null, resultRequested: false, pending: [], continued: {}, lastChat: null, runBy: null};

export function reducePathKernel(state: PathKernelState, event: LogEvent): PathKernelState {
    const history = reduceHistory(state.history, event);
    let {run, openRequests, announced, resultRequested, pending, continued, lastChat, runBy} = state;
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
        case "runStarted": {
            const by = (data.by as Issuer | undefined) ?? USER;
            run = {runId: data.runId as string, turnId: null};
            runBy = by;
            if (data.kind !== "compact") lastChat = {runId: data.runId as string, by, end: null, stoppedBy: null, lastTurnCompleted: false};
            break;
        }
        case "runEnded":
            if (lastChat !== null && lastChat.runId === data.runId) {
                lastChat = {...lastChat, end: data.reason as RunEndReason, stoppedBy: (data.stoppedBy as Issuer | undefined) ?? null};
            }
            run = null;
            runBy = null;
            openRequests = [];
            break;
        case "turnStarted":
            run = run === null ? null : {...run, turnId: data.turnId as string};
            if (lastChat !== null && run !== null && lastChat.runId === run.runId && lastChat.lastTurnCompleted) lastChat = {...lastChat, lastTurnCompleted: false};
            continued = {};
            break;
        case "turnEnded":
            if (lastChat !== null && run !== null && lastChat.runId === run.runId) {
                const completed = data.reason === "completed";
                if (completed !== lastChat.lastTurnCompleted) lastChat = {...lastChat, lastTurnCompleted: completed};
            }
            break;
        case "modelStarted":
            openRequests = [...openRequests, data.request as number];
            break;
        case "assistant":
        case "modelEnded":
        case "modelFailed":
            if (openRequests.includes(data.request as number)) openRequests = openRequests.filter((request) => request !== data.request);
            break;
        case "continued":
            continued = {...continued, [data.by as string]: (continued[data.by as string] ?? 0) + 1};
            break;
        case "toolsAnnounced":
            announced = data.tools as {id: string; version: string; code?: true}[];
            break;
        case "notice":
            if (data.code === "result-requested") resultRequested = true;
            break;
        case "interactionRequested":
            pending = [...pending, {id: data.id as string, callId: data.callId as string, kind: data.kind as PendingInteraction["kind"], request: data.request as JsonValue, async: data.async === true, ...(data.within === undefined ? {} : {within: data.within as {tool: string; invocation: string}})}];
            break;
        case "interactionResolved":
            pending = pending.filter((item) => item.id !== data.id);
            break;
    }
    const same = history === state.history && run === state.run && openRequests === state.openRequests && announced === state.announced && resultRequested === state.resultRequested && pending === state.pending && continued === state.continued && lastChat === state.lastChat && runBy === state.runBy;
    return same ? state : {history, run, openRequests, announced, resultRequested, pending, continued, lastChat, runBy};
}

export interface SessionKernelState {
    readonly buffer: readonly BufferedInput[];
    readonly core: CoreSettings;
    /** 扩展 id → 用户改过的设置项。 */
    readonly settings: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
    readonly title: string | null;
    /** 最近一次标题是谁写的；`setGeneratedMeta` 据此不盖掉用户改的。 */
    readonly titleBy: "user" | "auto" | null;
    readonly description: string | null;
    readonly archived: boolean;
    readonly remembered: readonly string[];
    readonly rememberedRules: readonly JsonValue[];
    readonly profile: {readonly id: string; readonly hash: string} | null;
    /** `leafChanged` 的条数（回退、切分支）：给跨调用保留状态的工具判断叶子动过没有（runtime.md 输出 102）。 */
    readonly leafMoves: number;
}

export const DEFAULT_CORE_SETTINGS: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};

export function initialSessionKernel(core: CoreSettings = DEFAULT_CORE_SETTINGS): SessionKernelState {
    return {buffer: [], core, settings: {}, title: null, titleBy: null, description: null, archived: false, remembered: [], rememberedRules: [], profile: null, leafMoves: 0};
}

export function reduceSessionKernel(state: SessionKernelState, event: LogEvent): SessionKernelState {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
        case "inputQueued": {
            const entry: BufferedInput = {
                id: data.id as string,
                mode: data.mode as BufferedInput["mode"],
                input: data.input as UserInput,
                queuedAt: event.seq,
                edits: 0,
                state: data.state === "held" ? "held" : "ready",
                ...(data.by === undefined ? {} : {by: data.by as Issuer}),
                ...(data.commandId === undefined ? {} : {commandId: data.commandId as string}),
                ...(data.state === "held" && data.cause !== undefined ? {cause: data.cause as HeldCause} : {}),
            };
            return {...state, buffer: [...state.buffer, entry]};
        }
        case "inputHeld": {
            // 已经留着的不改原因与停的人（runtime.md 输出 109）：只转就绪的。
            const ids = new Set(data.ids as string[]);
            const heldBy = data.heldBy as Issuer | undefined;
            const cause = data.cause as HeldCause;
            return {...state, buffer: state.buffer.map((item) => (ids.has(item.id) && item.state === "ready" ? {...item, state: "held", cause, ...(heldBy === undefined ? {} : {heldBy})} : item))};
        }
        case "inputReleased": {
            const ids = new Set(data.ids as string[]);
            const followups = data.mode === "followups";
            return {
                ...state,
                buffer: state.buffer.map((item) => {
                    if (!ids.has(item.id) || item.state !== "held") return item;
                    const {cause: _cause, heldBy: _heldBy, ...rest} = item;
                    return {...rest, state: "ready", ...(followups ? {mode: "followup" as const} : {})};
                }),
            };
        }
        case "inputEdited":
            return {...state, buffer: state.buffer.map((item) => (item.id === data.id ? {...item, input: data.input as UserInput, edits: item.edits + 1} : item))};
        case "inputRemoved":
        case "inputConsumed":
            return {...state, buffer: state.buffer.filter((item) => item.id !== data.id)};
        case "settingsChanged": {
            const extension = data.extension as string;
            const patch = data.patch as Record<string, JsonValue>;
            if (extension === "core") return {...state, core: {...state.core, ...patch} as CoreSettings};
            return {...state, settings: {...state.settings, [extension]: {...state.settings[extension], ...patch}}};
        }
        case "titleChanged":
            return {...state, title: data.title as string, titleBy: data.by as "user" | "auto"};
        case "descriptionChanged":
            return {...state, description: data.description as string};
        case "archived":
            return {...state, archived: data.archived as boolean};
        case "approvalRemembered":
            if (data.scope === "rule") return {...state, rememberedRules: [...state.rememberedRules, data.rules as JsonValue]};
            return state.remembered.includes(data.tool as string) ? state : {...state, remembered: [...state.remembered, data.tool as string]};
        case "profileChanged":
            return {...state, profile: {id: data.profile as string, hash: data.hash as string}};
        case "leafChanged":
            return {...state, leafMoves: state.leafMoves + 1};
    }
    return state;
}
