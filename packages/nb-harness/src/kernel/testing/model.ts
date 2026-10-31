/**
 * 脚本化的假模型：模型端口的一种实现，交回的回复与真实适配器同一份 `ModelResponse` 形状。
 * 脚本用完还被调用时，这次请求以 `local` 失败（码 `script-exhausted`）收口，测试能看到是哪一次。
 */

import type {ContentBlock, ModelErrorKind, ModelInfo, ModelPort, ModelRequest, ModelResponse, RequestPurpose, ToolCall, Usage} from "../api/index.js";

/** 一次回复的简写：字符串是纯文字。 */
export type Reply =
    | string
    | {
          readonly text?: string;
          readonly thinking?: string;
          readonly tools?: readonly {tool: string; args?: Record<string, unknown>}[];
          readonly usage?: Partial<Usage>;
          readonly stop?: "stop" | "length";
          /** 这次调用失败（与服务商报错同一组分类）。 */
          readonly fail?: ModelErrorKind;
      };

export interface TestModel {
    /** 按顺序排好后面几次调用的回复。 */
    script(...replies: Reply[]): void;
    /** 到目前为止收到的请求，按先后。 */
    readonly requests: readonly ModelRequest[];
    readonly port: ModelPort;
    /** 这些用途的模型解析不到（测“对话模型不可用时也能压缩”这类）；改它即生效。 */
    readonly unavailable: Set<RequestPurpose>;
}

export const TEST_MODEL_INFO: ModelInfo = {id: "test/model", contextWindow: 100_000, maxOutput: 8_000, capabilities: {vision: false, thinking: true}, efforts: ["low", "medium", "high"]};

const USAGE: Usage = {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null, complete: true};

/** `info` 换掉模型信息（例如给 `compactAt`、小窗口）。 */
export function createTestModel(info: ModelInfo = TEST_MODEL_INFO): TestModel {
    const unavailable = new Set<RequestPurpose>();
    const queue: Reply[] = [];
    const requests: ModelRequest[] = [];
    let calls = 0;
    const respond = (): ModelResponse => {
        calls += 1;
        const reply = queue.shift();
        if (reply === undefined) return {content: [], toolCalls: [], stopReason: "error", usage: USAGE, model: TEST_MODEL_INFO.id, error: {kind: "local", code: "script-exhausted", message: `the test model has no scripted reply for request ${calls}`}};
        const shape = typeof reply === "string" ? {text: reply} : reply;
        const usage = {...USAGE, ...shape.usage};
        if (shape.fail !== undefined) return {content: [], toolCalls: [], stopReason: "error", usage, model: TEST_MODEL_INFO.id, error: {kind: shape.fail, message: `scripted ${shape.fail} failure`}};
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
        port: {
            resolve: (_settings, purpose) => unavailable.has(purpose) ? {ok: false, code: "no-model"} : ({
                ok: true,
                info,
                call: async (request, signal) => {
                    requests.push(request);
                    if (signal.aborted) return {content: [], toolCalls: [], stopReason: "aborted", usage: {...USAGE, complete: false}, model: TEST_MODEL_INFO.id};
                    return respond();
                },
            }),
        },
    };
}
