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
    /** 发出了还没有结果的模型请求。 */
    readonly openRequest: number | null;
    /** 这条路径上最后一次告诉模型的工具集（`toolsAnnounced`）；还没告诉过时为 null。 */
    readonly announced: readonly {readonly id: string; readonly version: string}[] | null;
    /** 这条路径上写过 `notice{code: "result-requested"}`。 */
    readonly resultRequested: boolean;
    /** 这条路径上还没应答的等用户事项（`interactionRequested` 之后、`interactionResolved` 之前），按提出的顺序。 */
    readonly pending: readonly PendingInteraction[];
}

export interface PendingInteraction {
    readonly id: string;
    readonly callId: string;
    readonly kind: "approval" | "question";
    readonly request: JsonValue;
    readonly async: boolean;
}

export const initialPathKernel: PathKernelState = {history: initialHistory, run: null, openRequest: null, announced: null, resultRequested: false, pending: []};

export function reducePathKernel(state: PathKernelState, event: LogEvent): PathKernelState {
    const history = reduceHistory(state.history, event);
    let {run, openRequest, announced, resultRequested, pending} = state;
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
        case "runStarted":
            run = {runId: data.runId as string, turnId: null};
            break;
        case "runEnded":
            run = null;
            openRequest = null;
            break;
        case "turnStarted":
            run = run === null ? null : {...run, turnId: data.turnId as string};
            break;
        case "modelStarted":
            if (data.purpose === "turn") openRequest = data.request as number;
            break;
        case "assistant":
        case "modelFailed":
            if (data.request === openRequest) openRequest = null;
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
    const same = history === state.history && run === state.run && openRequest === state.openRequest && announced === state.announced && resultRequested === state.resultRequested && pending === state.pending;
    return same ? state : {history, run, openRequest, announced, resultRequested, pending};
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
