/**
 * 模型调用经模型拦截链（docs/specs/harness/runtime.md 输出 21、22）：链的最里层写 `modelStarted` 再交给模型端口，
 * 所以一层调两次 `next` 就有两条 `modelStarted`；一层不调 `next` 直接给回复时没有 `modelStarted`。
 *
 * 写日志都经 `write`（排进单写者队列）。链本身不和中止赛跑；调用方拿 `signal` 赛跑决定还等不等。
 */

import {createHash} from "node:crypto";
import type {Message, ModelCaller, ModelInfo, ModelRequest, ModelResolution, ModelResponse, RequestPurpose, Resources} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {HANDLER_TIMEOUT_MS} from "../dispatch/reactions.js";
import {interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
import {isSealed, seal} from "../state/freeze.js";
import {chainLayers, failureDrafts, runChain, type ChainFailure} from "./chain.js";
import {ctrl} from "./writes.js";

export interface ModelCallHost {
    readonly core: SessionCore;
    readonly resources: Resources;
    environment(model: ModelInfo): ViewEnvironment;
    write(drafts: EventDraft[]): Promise<unknown>;
    /** 开始流式接收（推状态帧用）。 */
    streaming?(request: number): void;
}

export interface ModelCallOutcome {
    readonly response: ModelResponse;
    /** 写进 `assistant`、`modelEnded` 或 `modelFailed` 的请求序号：最后一次真正发出的；被拦下时新分配一个。 */
    readonly request: number;
    readonly failures: readonly ChainFailure[];
}

/**
 * 交给拦截层的请求是冻结的：改要返回新对象（提案第 9 节），原地修改抛错、按这一层出错处理，所以 `modifiedBy` 不会漏记。
 * `tools` 只冻结数组本身：里面是宿主的声明对象（含共享的 schema），内核不替宿主冻结。
 */
export function freezeRequest(request: ModelRequest): ModelRequest {
    for (const [key, value] of Object.entries(request)) {
        if (key === "tools") Object.freeze(value);
        else seal(value);
    }
    return Object.freeze(request);
}

/**
 * 请求的哈希由除消息之外的字段与逐条消息的摘要合成（提案第 19 节的增量哈希）：已提交的消息来自提交缓存，跨请求是同一个对象，
 * 摘要按对象记下，每次请求只序列化、哈希新出现的消息。只记整个封住了的消息（`seal`）：只冻结了顶层的对象下面仍能改，
 * 按身份记的摘要会过时。交到最里层的请求都经过 `freezeRequest`，所以实际上每条都记。
 */
const messageDigests = new WeakMap<Message, Buffer>();
function messageDigest(message: Message): Buffer {
    const known = messageDigests.get(message);
    if (known !== undefined) return known;
    const digest = createHash("sha256").update(JSON.stringify(message)).digest();
    if (isSealed(message)) messageDigests.set(message, digest);
    return digest;
}
function requestHash(request: ModelRequest): string {
    const {messages, ...rest} = request;
    const hash = createHash("sha256").update(JSON.stringify(rest));
    for (const message of messages) hash.update(messageDigest(message));
    return hash.digest("hex");
}

/** 模型拦截交回的值是不是一条回复（真实调用与预览共用同一条校验）。 */
export const isResponse = (value: unknown): value is ModelResponse => {
    const response = value as Partial<ModelResponse> | null;
    return typeof response === "object" && response !== null && Array.isArray(response.content) && Array.isArray(response.toolCalls) && typeof response.stopReason === "string" && typeof response.usage === "object" && typeof response.model === "string";
};

export async function callModel(host: ModelCallHost, resolution: Extract<ModelResolution, {ok: true}>, request: ModelRequest, signal: AbortSignal): Promise<ModelCallOutcome> {
    const {core} = host;
    const modifiedBy: {extension: string; fields: string[]}[] = [];
    let lastRequest: number | null = null;
    const environment = host.environment(resolution.info);
    const state = core.stateAt();
    const outcome = await runChain<ModelRequest, ModelResponse>({
        core,
        method: "model",
        layers: chainLayers(core, "model"),
        input: freezeRequest(request),
        signal,
        timeoutMs: (item) => item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS,
        ctxFor: (item, invocation, layerSignal) => interceptCtx({assembly: core.assembly, item, state, environment, resources: host.resources, signal: layerSignal, invocation, phase: "run"}),
        onNext: (item, received, passed) => {
            // 端口在进链之前就按设置解析好了，拦截改 model 换不了作答的模型，日志却会记成改后的名字：不允许，这一层出错跳过。
            if (passed.model !== received.model) throw new TypeError(`model interceptor of ${item.definition.id} changed the model from ${received.model} to ${passed.model}; interceptors cannot route requests (change core.model with changeSettings, or choose the model by purpose in the ModelPort)`);
            freezeRequest(passed);
            if (received === passed) return;
            const fields = Object.keys({...received, ...passed}).filter((key) => (received as unknown as Record<string, unknown>)[key] !== (passed as unknown as Record<string, unknown>)[key]);
            if (fields.length > 0) modifiedBy.push({extension: item.definition.id, fields});
        },
        terminal: async (final) => {
            const number = core.requestCounter + 1;
            await host.write([ctrl("modelStarted", {request: number, purpose: final.purpose, model: final.model, hash: requestHash(final), now: core.clock.now(), invocation: core.newId(), modifiedBy: modifiedBy.map((item) => ({...item}))})]);
            lastRequest = number;
            // 只有对话请求让运行进入 streaming：压缩与审批模型的请求流式时，运行状态仍是 compacting、tools。
            if (final.purpose === "turn") host.streaming?.(number);
            let deltaNumber = 0;
            return resolution.call(final, signal, (delta) => {
                deltaNumber += 1;
                core.emit({type: "delta", request: number, purpose: final.purpose, n: deltaNumber, part: delta.part, text: delta.text, ...(delta.callId === undefined ? {} : {callId: delta.callId})});
            });
        },
        // 之前出错跳过这一层；之后出错用里层的回复（模型已经回复、花了钱，不丢）。
        onFailure: () => ({kind: "skip"}),
        normalize: (item, returned) => {
            if (!isResponse(returned)) throw new TypeError(`model interceptor of ${item.definition.id} did not return a model response`);
            return returned;
        },
    });
    return {response: outcome.value, request: lastRequest ?? core.requestCounter + 1, failures: outcome.failures};
}

/**
 * 给审批钩子、压缩方法的 `ctx.model`：非对话的请求同样经模型拦截链；成功写 `modelEnded`，失败写 `modelFailed`。
 * 失败不抛错，以 `stopReason: "error"` 的回复交回。
 */
export function modelCaller(host: ModelCallHost & {resolve(purpose: RequestPurpose): ModelResolution}, signal: AbortSignal): ModelCaller {
    return async (draft, options) => {
        const resolution = host.resolve(options.purpose);
        if (!resolution.ok) return {content: [], toolCalls: [], stopReason: "error", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: true}, model: draft.model ?? "unknown", error: {kind: "local", code: resolution.code, message: `no model for ${options.purpose} requests (${resolution.code})`}};
        const request: ModelRequest = {...draft, purpose: options.purpose, model: draft.model ?? resolution.info.id};
        const {response, request: number, failures} = await callModel(host, resolution, request, signal);
        const failed = response.stopReason === "error" || response.stopReason === "aborted";
        await host.write([
            ...failureDrafts(host.core, "intercept.model", failures),
            failed
                ? ctrl("modelFailed", {request: number, kind: response.stopReason === "aborted" ? "aborted" : (response.error?.kind ?? "provider"), ...(response.error?.code === undefined ? {} : {code: response.error.code}), usage: response.usage})
                : ctrl("modelEnded", {request: number, purpose: options.purpose, stopReason: response.stopReason, usage: response.usage, model: response.model}),
        ]);
        return response;
    };
}
