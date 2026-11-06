/**
 * `nbook.plot` 的服务端入口：替项目入口调模型（`shared/model.ts`）。记账 Agent 用 `main` 角色，试读用 `fast`（Spec 说“便宜模型”；用哪个随实现）。
 * 答案经强制调用一个 `answer` 工具交回；项目入口按 schema 校验。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {fail, provideRemote} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import type {CoreSettings, JsonValue, ModelPort, ModelRequest, ModelResponse, ToolDeclaration} from "@notnotype/nb-harness/kernel/contracts";

import {modelsKey} from "nbook/plugins/models/shared/contracts";

import {descriptor} from "../plugin";
import {ANSWER_SCHEMAS, ZERO_USAGE} from "../shared/checks";
import type {AnswerKind, CheckRole, CheckUsage} from "../shared/checks";
import {plotModelContract} from "../shared/model";
import type {AskOutcome} from "../shared/model";

const ROLES: Readonly<Record<CheckRole, string>> = {ledger: "main", reader: "fast"};
const TOOL_ID = "plot.answer";
const PROFILE = "nbook.plot.check";
const SETTINGS: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: true};
const ORIGIN = {kind: "fixed", by: "kernel"} as const;

const usageOf = (response: ModelResponse): CheckUsage => ({input: response.usage.input, output: response.usage.output, cacheRead: response.usage.cacheRead, cacheWrite: response.usage.cacheWrite, cost: response.usage.cost});

const failedOutcome = (response: ModelResponse, usage: CheckUsage): AskOutcome => ({
    outcome: "failed",
    kind: response.error?.kind ?? "provider",
    retryable: response.error?.retryable === true,
    ...(response.error?.retryAfterMs === undefined ? {} : {retryAfterMs: response.error.retryAfterMs}),
    usage,
});

const toolOf = (answer: AnswerKind): ToolDeclaration => ({
    id: TOOL_ID,
    description: "交回结构化的答案。",
    parameters: ANSWER_SCHEMAS[answer] as unknown as {readonly [key: string]: JsonValue},
    provider: descriptor.id,
    version: descriptor.version,
    finish: true,
    concurrency: "exclusive",
    strict: false,
    effect: "read",
});

/** 提供方的实现（测试与真实模型的用例直接调它，不起插件宿主）。 */
export function plotModelImplementation(port: ModelPort | null, consumer: Pick<ConsumerIdentity, "plugin">) {
    const resolve = (role: CheckRole) => {
        if (port === null) return {ok: false as const, code: "no-model"};
        return port.resolve({settings: SETTINGS, purpose: "background", profile: PROFILE, role: ROLES[role]});
    };
    return {
        methods: {
            available: () => {
                // 它是个通用的模型网关，只给本插件的项目入口（consumer.plugin 由内核填写，经路由的不可伪造）。
                if (consumer.plugin !== descriptor.id) return fail("wrong-caller");
                const problem = (["ledger", "reader"] as const).map(resolve).find((resolution) => !resolution.ok);
                return {ok: true as const, value: {problem: problem === undefined ? null : (problem as {code: string}).code}};
            },
            ask: async (input: {role: CheckRole; system: string; user: string; answer: AnswerKind; maxTokens: number}, context: {signal: AbortSignal}) => {
                if (consumer.plugin !== descriptor.id) return fail("wrong-caller");
                const resolution = resolve(input.role);
                if (!resolution.ok) return {ok: true as const, value: {outcome: "failed", kind: resolution.code, retryable: false, usage: ZERO_USAGE} satisfies AskOutcome};
                const tool = toolOf(input.answer);
                const limit = resolution.info.maxOutput ?? Number.POSITIVE_INFINITY;
                const request: ModelRequest = {
                    purpose: "background",
                    model: resolution.info.id,
                    params: {maxTokens: Math.min(input.maxTokens, limit)},
                    headers: {},
                    system: [{kind: "text", text: input.system, origin: ORIGIN}],
                    messages: [{role: "user", content: [{kind: "text", text: input.user, origin: ORIGIN}]}],
                    tools: [tool],
                    toolChoice: {tool: TOOL_ID},
                };
                const response = await resolution.call(request, context.signal, () => undefined);
                const usage = usageOf(response);
                const outcome: AskOutcome =
                    response.stopReason === "aborted" ? {outcome: "aborted", usage}
                    : response.stopReason === "error" ? failedOutcome(response, usage)
                    : response.stopReason === "length" ? {outcome: "length", capped: input.maxTokens >= limit, usage}
                    // 模型没调工具时答案是 null：项目入口按结构不对处理（重试一次）。
                    : {outcome: "answer", answer: response.toolCalls.find((call) => call.tool === TOOL_ID)?.args ?? null, usage};
                return {ok: true as const, value: outcome};
            },
        },
        events: {},
    };
}

export const plotServerPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: modelsKey, required: false}],
        remoteProvides: [plotModelContract],
        activate: async (context) => {
            const models = await context.services.resolve(modelsKey);
            const port = models.status === "resolved" ? models.instance.port() : null;
            return {remote: [provideRemote(plotModelContract, (consumer) => plotModelImplementation(port, consumer))]};
        },
    })],
};
