/**
 * 脚本化的假模型：模型端口的一种实现，交回的回复与真实适配器同一份 `ModelResponse` 形状。
 * 脚本用完还被调用时，这次请求以 `local` 失败（码 `script-exhausted`）收口，测试能看到是哪一次。
 *
 * 和真实适配器一样先推流式增量再交回回复：思考、文字与每个工具调用的参数各拆成两块（测出站过滤时，
 * 一个词可能被拆在两块里）。
 */

import type {ContentBlock, ModelDelta, ModelErrorKind, ModelInfo, ModelPort, ModelQuery, ModelRequest, ModelResolutionCode, ModelResponse, RequestPurpose, ToolCall, Usage} from "../api/index.js";

/** 一次回复的简写：字符串是纯文字。 */
export type Reply =
    | string
    | {
          readonly text?: string;
          readonly thinking?: string;
          readonly tools?: readonly {tool: string; args?: Record<string, unknown>}[];
          readonly usage?: Partial<Usage>;
          readonly stop?: "stop" | "length" | "tool";
          /** 这次调用失败（与服务商报错同一组分类）。 */
          readonly fail?: ModelErrorKind;
          /** 失败的细节：可不可重发、服务商要求的等待时间、已经产生的半截文字、错误文字。 */
          readonly retryable?: boolean;
          readonly retryAfterMs?: number;
          readonly partial?: string;
          readonly message?: string;
          /** 推完增量后停住直到中止，再以 `aborted` 交回已推出的内容与用量（与 OMP 适配器中止时一样）。 */
          readonly hold?: boolean;
      };

export interface TestModel {
    /** 按顺序排好后面几次调用的回复。 */
    script(...replies: Reply[]): void;
    /** 到目前为止收到的请求，按先后。 */
    readonly requests: readonly ModelRequest[];
    readonly port: ModelPort;
    /** 这些用途的模型解析不到，得到对应的码（测“对话模型不可用时也能压缩”、失败码的传播这类）；改它即生效。 */
    readonly unavailable: Map<RequestPurpose, ModelResolutionCode>;
    /** 到目前为止端口收到的解析请求，按先后（测 Profile 与角色是否传到了端口）。 */
    readonly queries: readonly ModelQuery[];
}

export const TEST_MODEL_INFO: ModelInfo = {id: "test/model", contextWindow: 100_000, maxOutput: 8_000, capabilities: {vision: false, thinking: true}, efforts: ["low", "medium", "high"]};

const USAGE: Usage = {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null, complete: true};

/** 一次回复按流式增量推出去：每段文字拆成前后两半。 */
function streamOf(response: ModelResponse): ModelDelta[] {
    const halves = (text: string) => (text.length < 2 ? [text] : [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))]);
    const deltas: ModelDelta[] = [];
    for (const block of response.content) {
        if (block.kind === "thinking" || block.kind === "text") for (const text of halves(block.text)) deltas.push({part: block.kind, text});
    }
    for (const call of response.toolCalls) for (const text of halves(JSON.stringify(call.args))) deltas.push({part: "toolArgs", callId: call.id, text});
    return deltas;
}

/** `info` 换掉模型信息（例如给 `compactAt`、小窗口）。 */
export function createTestModel(info: ModelInfo = TEST_MODEL_INFO): TestModel {
    const unavailable = new Map<RequestPurpose, ModelResolutionCode>();
    const queries: ModelQuery[] = [];
    const queue: Reply[] = [];
    const requests: ModelRequest[] = [];
    let calls = 0;
    const respond = (): ModelResponse => {
        calls += 1;
        const reply = queue.shift();
        if (reply === undefined) return {content: [], toolCalls: [], stopReason: "error", usage: USAGE, model: TEST_MODEL_INFO.id, error: {kind: "local", code: "script-exhausted", message: `the test model has no scripted reply for request ${calls}`}};
        const shape = typeof reply === "string" ? {text: reply} : reply;
        const usage = {...USAGE, ...shape.usage};
        if (shape.fail !== undefined) return {content: shape.partial === undefined ? [] : [{kind: "text", text: shape.partial}], toolCalls: [], stopReason: "error", usage, model: TEST_MODEL_INFO.id, error: {kind: shape.fail, message: shape.message ?? `scripted ${shape.fail} failure`, ...(shape.retryable === undefined ? {} : {retryable: shape.retryable}), ...(shape.retryAfterMs === undefined ? {} : {retryAfterMs: shape.retryAfterMs})}};
        const content: ContentBlock[] = [
            ...(shape.thinking === undefined ? [] : [{kind: "thinking" as const, text: shape.thinking, signature: `sig-${calls}`}]),
            ...(shape.text === undefined ? [] : [{kind: "text" as const, text: shape.text}]),
        ];
        const toolCalls: ToolCall[] = (shape.tools ?? []).map((call, index) => ({id: `call-${calls}-${index + 1}`, tool: call.tool, args: call.args ?? {}}));
        return {content, toolCalls, stopReason: toolCalls.length > 0 ? "tool" : (shape.stop ?? "stop"), usage, model: TEST_MODEL_INFO.id};
    };
    return {
        script: (...replies) => void queue.push(...replies),
        requests,
        unavailable,
        queries,
        port: {
            resolve: (query) => (queries.push(query), unavailable.has(query.purpose)) ? {ok: false, code: unavailable.get(query.purpose)!} : ({
                ok: true,
                info,
                call: async (request, signal, onDelta) => {
                    requests.push(request);
                    if (signal.aborted) return {content: [], toolCalls: [], stopReason: "aborted", usage: {...USAGE, complete: false}, model: TEST_MODEL_INFO.id};
                    const hold = typeof queue[0] === "object" && queue[0].hold === true;
                    const response = respond();
                    for (const delta of streamOf(response)) onDelta(delta);
                    if (!hold) return response;
                    await new Promise((resolve) => (signal.aborted ? resolve(undefined) : signal.addEventListener("abort", resolve, {once: true})));
                    return {...response, toolCalls: [], stopReason: "aborted", usage: {...response.usage, complete: false}};
                },
            }),
        },
    };
}
