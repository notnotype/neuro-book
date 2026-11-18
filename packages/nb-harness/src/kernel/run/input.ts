/**
 * 输入拦截链（docs/specs/harness/runtime.md 输出 24）：`send`、`enqueue` 受理时、受理批写下之前，在指令的队列项里跑，
 * 读受理这一刻的叶子。它是唯一会让指令的队列项变长的东西，所以缺省时限比别的拦截短（5 秒）。
 *
 * 一层返回 `{reject}` 时整条指令失败、不写日志；返回 `{redacted: true}` 时原文只记哈希（session.md 输出 10）。
 */

import {createHash} from "node:crypto";
import type {Attributed, HeldCause, Issuer, JsonValue, Rejection, Resources, UserInput} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
import {chainLayers, failureDrafts, runChain} from "./chain.js";

export const INPUT_INTERCEPT_TIMEOUT_MS = 5_000;

interface InputOutcome {
    readonly input: UserInput;
    readonly reject?: Attributed;
    readonly redacted: boolean;
}

export type InterceptedInput =
    | {readonly ok: true; readonly input: UserInput; readonly original?: string; readonly originalHash?: string; readonly failed: readonly EventDraft[]}
    | {readonly ok: false; readonly rejection: Attributed};

export interface InputHost {
    readonly core: SessionCore;
    readonly resources: Resources;
    environment(): ViewEnvironment;
}

/** 永不触发的信号：受理指令时没有运行可中止。 */
const NEVER = new AbortController().signal;

export async function interceptInput(host: InputHost, input: UserInput): Promise<InterceptedInput> {
    const {core} = host;
    const layers = chainLayers(core, "input");
    if (layers.length === 0) return {ok: true, input, failed: []};
    const state = core.stateAt();
    const environment = host.environment();
    const outcome = await runChain<UserInput, InputOutcome>({
        core,
        method: "input",
        layers,
        input,
        signal: NEVER,
        timeoutMs: (item) => item.definition.timeoutMs ?? INPUT_INTERCEPT_TIMEOUT_MS,
        ctxFor: (item, invocation, signal) => interceptCtx({assembly: core.assembly, item, state, environment, resources: host.resources, signal, invocation, phase: "run"}),
        terminal: async (final) => ({input: final, redacted: false}),
        onFailure: () => ({kind: "skip"}),
        normalize: (item, returned, inner, received) => {
            const value = returned as {reject?: Rejection; redacted?: boolean} | undefined | null;
            if (value !== undefined && value !== null && typeof value !== "object") throw new TypeError(`input interceptor of ${item.definition.id} returned ${typeof value}`);
            if (value?.reject !== undefined) return {input: received, reject: {...value.reject, by: item.definition.id}, redacted: false};
            const base = inner?.value ?? {input: received, redacted: false};
            return value?.redacted === true ? {...base, redacted: true} : base;
        },
    });
    const {reject, input: final, redacted} = outcome.value;
    if (reject !== undefined) {
        core.diagnostics.add({code: "input-rejected", extension: reject.by, entry: "intercept.input", subject: reject.code, params: {code: reject.code, by: reject.by}, message: `${reject.by} rejected the input (${reject.code})`}, core.head);
        return {ok: false, rejection: reject};
    }
    const failed = failureDrafts(core, "intercept.input", outcome.failures);
    if (redacted) return {ok: true, input: final, failed, originalHash: createHash("sha256").update(input.text).digest("hex")};
    if (JSON.stringify(final) === JSON.stringify(input)) return {ok: true, input, failed};
    return {ok: true, input: final, failed, original: input.text};
}

/** 写进输入事件的发出者：只记会话与宿主，用户（也是旧日志的读法）不写。 */
export function byField(issuer: Issuer | undefined): {by?: JsonValue} {
    return issuer === undefined || issuer.kind === "user" ? {} : {by: issuer as unknown as JsonValue};
}

/** `inputQueued` 的数据：改过的输入带原文或原文的哈希；会话以自己的身份发的带 `by`，用户发的不带（runtime.md 输出 85）。 */
export function queuedData(id: string, intercepted: Extract<InterceptedInput, {ok: true}>, mode: "steer" | "followup", issuer: Issuer, extra: {commandId?: string; held?: HeldCause} = {}): JsonValue {
    return {
        id,
        input: intercepted.input as unknown as JsonValue,
        mode,
        ...byField(issuer),
        ...(extra.commandId === undefined ? {} : {commandId: extra.commandId}),
        ...(extra.held === undefined ? {} : {state: "held", cause: extra.held as unknown as JsonValue}),
        ...(intercepted.original === undefined ? {} : {original: intercepted.original}),
        ...(intercepted.originalHash === undefined ? {} : {originalHash: intercepted.originalHash}),
    };
}
