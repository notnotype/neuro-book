/**
 * 内核自己的状态。path 一侧（随叶子走）：对话记录、进行中的运行与请求；session 一侧（线性，不随回退）：
 * 输入缓冲区、核心设置与各扩展的设置覆盖、标题与归档、批准记忆、当前的 Profile 哈希。叶子由会话自己跟踪
 * （最后一条 path 事件或 `leafChanged` 指向的节点）。
 */

import type {BufferedInput, CoreSettings, JsonValue, LogEvent, UserInput} from "../api/index.js";
import {initialHistory, reduceHistory, type HistoryState} from "./history.js";

export interface PathKernelState {
    readonly history: HistoryState;
    /** 进行中的运行：runStarted 之后、runEnded 之前。 */
    readonly run: {readonly runId: string; readonly turnId: string | null} | null;
    /** 发出了还没有结果的模型请求（各种用途：对话、审批、压缩、后台），按发出的顺序。中止与恢复按它逐项收口。 */
    readonly openRequests: readonly number[];
    /** 这条路径上最后一次告诉模型的工具集（`toolsAnnounced`）；还没告诉过时为 null。 */
    readonly announced: readonly {readonly id: string; readonly version: string}[] | null;
    /** 这条路径上写过 `notice{code: "result-requested"}`。 */
    readonly resultRequested: boolean;
    /** 这条路径上还没应答的等用户事项（`interactionRequested` 之后、`interactionResolved` 之前），按提出的顺序。 */
    readonly pending: readonly PendingInteraction[];
    /**
     * 当前这一轮里各扩展写过几条 `continued`（`turnStarted` 时清零）。按路径事实计数，不从对话的形状里数：
     * 压缩会切掉早先的步，`continue` 的上限不能跟着重置（extensions.md 输出 17）。
     */
    readonly continued: Readonly<Record<string, number>>;
}

export interface PendingInteraction {
    readonly id: string;
    readonly callId: string;
    readonly kind: "approval" | "question";
    readonly request: JsonValue;
    readonly async: boolean;
}

export const initialPathKernel: PathKernelState = {history: initialHistory, run: null, openRequests: [], announced: null, resultRequested: false, pending: [], continued: {}};

export function reducePathKernel(state: PathKernelState, event: LogEvent): PathKernelState {
    const history = reduceHistory(state.history, event);
    let {run, openRequests, announced, resultRequested, pending, continued} = state;
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
        case "runStarted":
            run = {runId: data.runId as string, turnId: null};
            break;
        case "runEnded":
            run = null;
            openRequests = [];
            break;
        case "turnStarted":
            run = run === null ? null : {...run, turnId: data.turnId as string};
            continued = {};
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
            announced = data.tools as {id: string; version: string}[];
            break;
        case "notice":
            if (data.code === "result-requested") resultRequested = true;
            break;
        case "interactionRequested":
            pending = [...pending, {id: data.id as string, callId: data.callId as string, kind: data.kind as PendingInteraction["kind"], request: data.request as JsonValue, async: data.async === true}];
            break;
        case "interactionResolved":
            pending = pending.filter((item) => item.id !== data.id);
            break;
    }
    const same = history === state.history && run === state.run && openRequests === state.openRequests && announced === state.announced && resultRequested === state.resultRequested && pending === state.pending && continued === state.continued;
    return same ? state : {history, run, openRequests, announced, resultRequested, pending, continued};
}

export interface SessionKernelState {
    readonly buffer: readonly BufferedInput[];
    readonly core: CoreSettings;
    /** 扩展 id → 用户改过的设置项。 */
    readonly settings: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
    readonly title: string | null;
    readonly archived: boolean;
    readonly remembered: readonly string[];
    readonly profile: {readonly id: string; readonly hash: string} | null;
}

export const DEFAULT_CORE_SETTINGS: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};

export function initialSessionKernel(core: CoreSettings = DEFAULT_CORE_SETTINGS): SessionKernelState {
    return {buffer: [], core, settings: {}, title: null, archived: false, remembered: [], profile: null};
}

export function reduceSessionKernel(state: SessionKernelState, event: LogEvent): SessionKernelState {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
        case "inputQueued":
            return {...state, buffer: [...state.buffer, {id: data.id as string, mode: data.mode as BufferedInput["mode"], input: data.input as UserInput, queuedAt: event.seq, edits: 0}]};
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
            return {...state, title: data.title as string};
        case "archived":
            return {...state, archived: data.archived as boolean};
        case "approvalRemembered":
            return state.remembered.includes(data.tool as string) ? state : {...state, remembered: [...state.remembered, data.tool as string]};
        case "profileChanged":
            return {...state, profile: {id: data.profile as string, hash: data.hash as string}};
    }
    return state;
}
