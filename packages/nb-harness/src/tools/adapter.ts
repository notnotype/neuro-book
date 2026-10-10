/**
 * 把内核协议的工具适配成 OMP `AgentTool`（docs/specs/harness/tools.md 输出 8–11）。
 *
 * 执行顺序固定：按次取实现 → 校验参数 → 拦截器 beforeExecute（改写的参数再校验一次）→ 审批钩子 → execute → 拦截器 afterExecute。
 * 每一步都不抛出：异常变成带码的错误结果，OMP 的循环把它当工具错误交给模型。审批等待多久由 runtime 的钩子决定，
 * 但中止由本层结算：钩子不配合也能结束等待，迟到的批准不再开始执行。
 */

import type {AgentToolResult} from "@oh-my-pi/pi-agent-core";
import {Value} from "typebox/value";
import type {TSchema} from "typebox";
import type {AdapterHooks, AgentTool, ApprovalOutcome, JsonValue, ToolCall, ToolContext, ToolDescriptor, ToolOutcome} from "./types";

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function argumentProblems(schema: TSchema, value: unknown): string | null {
    if (Value.Check(schema, value)) return null;
    return [...Value.Errors(schema, value)]
        .slice(0, 5)
        .map((error) => `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`)
        .join("；");
}

const failure = (code: string, message: string, details?: JsonValue): ToolOutcome => ({ok: false, code, message, ...(details === undefined ? {} : {details})});

/** 信号中止（或已经中止）时结算为 aborted；钩子先返回时这个 Promise 永远挂着，没有别的引用，随之回收。 */
const abortedOn = (signal: AbortSignal): Promise<ApprovalOutcome> =>
    new Promise((resolve) => {
        if (signal.aborted) resolve({aborted: true});
        else signal.addEventListener("abort", () => resolve({aborted: true}), {once: true});
    });

/** 输出 9：内核的结果到 OMP 的结果。 */
export function toAgentToolResult(outcome: ToolOutcome): AgentToolResult {
    if (outcome.ok) {
        const content = typeof outcome.content === "string" ? [{type: "text" as const, text: outcome.content}] : outcome.content.map((block) => ({...block}));
        return {content, ...(outcome.details === undefined ? {} : {details: outcome.details})};
    }
    return {content: [{type: "text", text: `${outcome.code}: ${outcome.message}`}], isError: true, ...(outcome.details === undefined ? {} : {details: outcome.details})};
}

async function run(descriptor: ToolDescriptor, hooks: AdapterHooks, call: ToolCall, signal: AbortSignal, onProgress: (progress: JsonValue) => void): Promise<ToolOutcome> {
    const definition = hooks.source.get(descriptor.id);
    if (definition === undefined) return failure("tool-unavailable", `工具 ${descriptor.id} 此刻不可用`);
    let args = call.args;
    const invalid = argumentProblems(definition.parameters, args);
    if (invalid !== null) return failure("invalid-arguments", invalid);
    if (hooks.interceptor?.beforeExecute !== undefined) {
        try {
            const intercepted = await hooks.interceptor.beforeExecute({...call, args});
            if ("deny" in intercepted) return failure("denied", intercepted.deny);
            args = intercepted.args;
            const again = argumentProblems(definition.parameters, args);
            if (again !== null) return failure("invalid-arguments", `拦截器改写后的参数不合规则：${again}`);
        } catch (error) {
            return failure("execution-failed", `拦截器出错：${describe(error)}`);
        }
    }
    if (signal.aborted) return failure("aborted", "调用已中止");
    let approval: ApprovalOutcome;
    try {
        approval = await Promise.race([hooks.approve({...call, args, definition, signal}), abortedOn(signal)]);
    } catch (error) {
        return failure("denied", `审批出错：${describe(error)}`);
    }
    // 等待期间或批准刚返回时已中止：尚未开始的执行不再开始
    if ("aborted" in approval || signal.aborted) return failure("aborted", "调用已中止");
    if (!approval.approved) return failure("denied", approval.reason);
    const context: ToolContext = {signal, session: hooks.session, toolCallId: call.toolCallId, report: onProgress};
    let outcome: ToolOutcome;
    try {
        outcome = await definition.execute(args, context);
    } catch (error) {
        outcome = failure("execution-failed", describe(error));
    }
    if (hooks.interceptor?.afterExecute !== undefined) {
        try {
            outcome = await hooks.interceptor.afterExecute({...call, args}, outcome);
        } catch (error) {
            outcome = failure("execution-failed", `拦截器出错：${describe(error)}`);
        }
    }
    return outcome;
}

export function toAgentTool(descriptor: ToolDescriptor, hooks: AdapterHooks): AgentTool {
    return {
        name: descriptor.id,
        label: descriptor.id,
        description: descriptor.description,
        // OMP 自带的 TypeBox 类型声明与本包装的 typebox 是两套同形的类型；运行时都是同一种 JSON Schema 对象。
        parameters: descriptor.parameters as unknown as AgentTool["parameters"],
        async execute(toolCallId, params, signal, onUpdate) {
            const call: ToolCall = {toolCallId, toolId: descriptor.id, args: params};
            const onProgress = (progress: JsonValue): void => {
                hooks.report?.(call, progress);
                onUpdate?.({content: [], details: progress});
            };
            const outcome = await run(descriptor, hooks, call, signal ?? new AbortController().signal, onProgress);
            return toAgentToolResult(outcome);
        },
    };
}
