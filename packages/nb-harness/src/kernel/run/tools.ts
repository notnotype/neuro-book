/**
 * 工具：生效工具集、实现的建与释放、一条回复里的调用怎样执行（docs/specs/harness/runtime.md 输出 15–19、23、25、26）。
 *
 * 一条回复的调用：先定下不执行的（工具不在集里、收尾工具没有单独调用），其余按 `concurrency` 切段，段内按调用顺序
 * 启动、并发等待，段与段之间串行。每个调用走工具拦截链，最里层依次是参数校验、只读模式、审批、`toolStarted`、执行。
 * 结果不在这里写：交回按调用顺序排好的写入批，由运行循环一次写下（收尾时与 `runEnded` 同批）。
 *
 * 中止：运行的信号触发后在注入的时钟上等宽限期；期内完成的照常交回，没完成的记 `unknown`，之后才到的只写诊断。
 * 中止之后不再启动新的段。
 */

import {createHash} from "node:crypto";
import {Value} from "typebox/value";
import {providerNameProblem, providerToolName, TOOL_NAME_LIMIT, toolIdProblem} from "../api/index.js";
import type {ApproveHook, JsonValue, KernelEvents, EventData, ModelCaller, ReplyEvent, Resources, ToolCall, ToolContext, ToolDeclaration, ToolEffect, ToolImplementation, ToolInfo, ToolResult, ToolSessionContext, ToolStatus, SessionEnv} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {HANDLER_TIMEOUT_MS} from "../dispatch/reactions.js";
import {interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
import {deepFreeze} from "../state/freeze.js";
import {chainLayers, failureDrafts, runChain, type ChainFailure} from "./chain.js";
import type {Interactions} from "./interaction.js";
import {ctrl, interrupting, RunStoppedError} from "./writes.js";

/** 中止之后等进行中的工具完成的时间（runtime.md 输出 25）。 */
export const ABORT_GRACE_MS = 2_000;
/** 会话头带 `result` 时内核生成的收尾工具（runtime.md 输出 27）。 */
export const YIELD_TOOL = "yield";

type ToolResultData = EventData<KernelEvents["toolResult"]>;

export function toolInfo(declaration: ToolDeclaration): ToolInfo {
    const {strict: _strict, customFormat: _customFormat, ...info} = declaration;
    return info;
}

/** 生效工具集与工具实现：每个会话一个。 */
export class ToolBox {
    readonly #implementations = new Map<string, Promise<ToolImplementation>>();
    /** 报过诊断的声明问题：每次请求都重算工具集，同一个问题只报一次。 */
    readonly #reported = new Set<string>();

    /** `context` 每次取：换了 Profile 之后宿主拿到的是当前的（runtime.md 输出 38）。 */
    constructor(private readonly core: SessionCore, private readonly env: Pick<SessionEnv, "tools">, private readonly context: () => ToolSessionContext) {}

    #yield(): ToolDeclaration | null {
        const result = this.core.header.result;
        if (result === undefined) return null;
        return {id: YIELD_TOOL, description: "Hand back the result of this run. Call it alone, once the work is done.", parameters: result.schema as {readonly [key: string]: JsonValue}, provider: "core", version: "1", finish: true, concurrency: "exclusive", strict: true, effect: "read"};
    }

    /** 宿主给的声明加 `yield`；不合规则的丢掉并诊断（`yield` 排在前面，宿主声明的同名工具算重名）。 */
    current(): ToolDeclaration[] {
        let declared: readonly ToolDeclaration[] = [];
        try {
            declared = this.env.tools.declarations(this.context());
        } catch (error) {
            if (!this.#reported.has("declarations")) this.core.diagnostics.add({code: "tool-declaration-invalid", entry: "host", subject: "declarations", message: "the host's tool declarations threw; the session has no tools for this request", cause: error}, this.core.head);
            this.#reported.add("declarations");
        }
        const yieldTool = this.#yield();
        const names = new Map<string, string>();
        const tools: ToolDeclaration[] = [];
        for (const declaration of [...(yieldTool === null ? [] : [yieldTool]), ...declared]) {
            const name = providerToolName(declaration);
            const problem = toolIdProblem(declaration.id)
                ?? (declaration.providerName === undefined ? (name.length > TOOL_NAME_LIMIT ? `tool id ${declaration.id} is longer than ${TOOL_NAME_LIMIT} characters once converted; give it a providerName` : null) : providerNameProblem(declaration.providerName))
                ?? (names.has(name) ? `tool ${declaration.id} has the same provider name ${name} as ${names.get(name)}` : null);
            if (problem !== null) {
                if (!this.#reported.has(problem)) this.core.diagnostics.add({code: "tool-declaration-invalid", entry: "host", subject: declaration.id, params: {tool: declaration.id}, message: `${problem}; the tool is left out`}, this.core.head);
                this.#reported.add(problem);
                continue;
            }
            names.set(name, declaration.id);
            tools.push(declaration);
        }
        return tools;
    }

    /**
     * 运行边界调用：不在当前工具集里的实现摘下并释放，之后同 id 重新出现时重建（工具被卸载时 `dispose`，api/tool.ts）。
     * 只在边界做：别处（视图、反应）读工具集时可能正有调用在用旧实现。
     */
    async retire(current: readonly ToolDeclaration[]): Promise<void> {
        const keep = new Set(current.map((tool) => tool.id));
        for (const [id, created] of [...this.#implementations.entries()]) {
            if (keep.has(id)) continue;
            this.#implementations.delete(id);
            await this.#dispose(id, created);
        }
    }

    async #dispose(id: string, created: Promise<ToolImplementation>): Promise<void> {
        try {
            await (await created).dispose?.();
        } catch (error) {
            this.core.diagnostics.add({code: "tool-dispose-failed", entry: "host", subject: id, params: {tool: id}, message: `dispose of tool ${id} threw`, cause: error}, this.core.head);
        }
    }

    implementation(id: string): Promise<ToolImplementation> {
        if (id === YIELD_TOOL && this.core.header.result !== undefined) return Promise.resolve({execute: async () => ({text: "The result has been handed back."})});
        let created = this.#implementations.get(id);
        if (created === undefined) {
            created = Promise.resolve().then(() => this.env.tools.create(id, this.context()));
            this.#implementations.set(id, created);
            // 建失败的不留在表里，下一次调用再建。
            created.catch(() => this.#implementations.delete(id));
        }
        return created;
    }

    /** 关闭会话时：释放建过的实现；`dispose` 抛错只写诊断。 */
    async dispose(): Promise<void> {
        const entries = [...this.#implementations.entries()];
        this.#implementations.clear();
        for (const [id, created] of entries) await this.#dispose(id, created);
    }
}

export interface ToolRunHost {
    readonly core: SessionCore;
    readonly box: ToolBox;
    readonly resources: Resources;
    readonly approve: ApproveHook;
    /** 等用户；没有时（例如没有界面的单次请求）审批判定 `ask` 得 `approval-unavailable`，工具拿不到 `ask`。 */
    readonly interactions?: Interactions;
    readonly model: ModelCaller;
    environment(): ViewEnvironment;
    /** 写 `toolStarted`（排进单写者队列）。 */
    write(drafts: EventDraft[]): Promise<unknown>;
}

export interface ToolsOutcome {
    /** 这条回复全部调用的结果（按调用顺序）与拦截链的 `extensionFailed`，作为一个写入批写下。 */
    readonly drafts: EventDraft[];
    /** 收尾工具单独调用且成功：运行以 `finished` 结束。 */
    readonly finished: {readonly tool: string; readonly value: JsonValue} | null;
}

interface CallOutcome {
    readonly data: ToolResultData;
    readonly failures: readonly ChainFailure[];
    /** 执行了的话，实际执行的参数（收尾工具的结果值）。 */
    readonly args: Readonly<Record<string, unknown>> | null;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function argumentProblems(schema: ToolDeclaration["parameters"], args: unknown): string | null {
    if (Value.Check(schema as never, args)) return null;
    const errors = [...Value.Errors(schema as never, args)].slice(0, 5) as {instancePath: string; message: string}[];
    return errors.map((error) => `${error.instancePath === "" ? "/" : error.instancePath} ${error.message}`).join("; ");
}

function effectOf(declaration: ToolDeclaration, args: Readonly<Record<string, unknown>>): ToolEffect {
    if (typeof declaration.effect !== "function") return declaration.effect;
    try {
        return declaration.effect(args);
    } catch {
        // 按参数求等级的函数出错时按最严的算（runtime.md 输出 18），不放过一个可能会写的调用。
        return "exec";
    }
}

/** 交给拦截层的调用与结果是冻结的：原地修改抛错、按这一层出错处理，`raw` 与署名因此不会漏记。 */
function normalizeResult(value: unknown, who: string): ToolResult {
    if (typeof value === "string") return Object.freeze({text: value});
    const result = value as Partial<ToolResult> | null;
    if (typeof result === "object" && result !== null && typeof result.text === "string") return deepFreeze(result as ToolResult);
    throw new TypeError(`${who} did not return a tool result`);
}

/** 工具的 `ctx.ask`：同步的等回答，异步的写下问题就返回 `{kind: "unavailable", code: "async"}`（回答以后作为输入到来）。 */
function askFor(host: ToolRunHost, interactions: Interactions, callId: string, signal: AbortSignal): NonNullable<ToolContext["ask"]> {
    return async (request, options) => {
        const resolution = await interactions.request(host.core, host.write, {callId, kind: "question", request: request as unknown as JsonValue, async: options?.async === true}, signal);
        if (resolution === null) return {kind: "unavailable", code: "async"};
        if (resolution.decision === "answer") {
            const answer = resolution.data as {text: string; data?: JsonValue};
            return {kind: "answer", text: answer.text, ...(answer.data === undefined ? {} : {data: answer.data})};
        }
        return {kind: "unavailable", code: resolution.decision === "aborted" ? "aborted" : "declined"};
    };
}

export async function runTools(host: ToolRunHost, reply: ReplyEvent, tools: readonly ToolDeclaration[], signal: AbortSignal): Promise<ToolsOutcome> {
    const {core} = host;
    const calls = reply.data.toolCalls as readonly ToolCall[];
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const finishCalls = calls.filter((call) => byId.get(call.tool)?.finish === true);
    const finishAlone = calls.length === 1 && finishCalls.length === 1;
    const state = core.stateAt();
    const outcomes = new Map<string, CallOutcome>();
    const preset = (call: ToolCall, text: string, code: string): CallOutcome => ({data: {callId: call.id, tool: call.tool, text, status: "error", code}, failures: [], args: null});
    // 写过 toolStarted 的调用：进程收尾时据此区分“开始了、结果未知”与“根本没开始”，与打开时的恢复一致（runtime.md 输出 34、53）。
    const started = new Set<string>();
    const unfinished = (call: ToolCall): CallOutcome => {
        if (!interrupting(signal)) return {data: {callId: call.id, tool: call.tool, text: "The call did not finish before the run was aborted.", status: "unknown", code: "aborted"}, failures: [], args: null};
        if (!started.has(call.id)) return {data: {callId: call.id, tool: call.tool, text: `The call to ${call.tool} was not run: the process was interrupted before it started.`, status: "denied", code: "interrupted-before-approval", by: "core"}, failures: [], args: null};
        return {data: {callId: call.id, tool: call.tool, text: "The call did not finish before the process was interrupted.", status: "unknown", code: "interrupted"}, failures: [], args: null};
    };

    const runnable: ToolCall[] = [];
    for (const call of calls) {
        if (!byId.has(call.tool)) outcomes.set(call.id, preset(call, `Unknown tool ${call.tool}.`, "unknown-tool"));
        else if (finishCalls.length > 0 && !finishAlone && byId.get(call.tool)!.finish) outcomes.set(call.id, preset(call, `${call.tool} finishes the run and must be called alone; it was not run.`, "finish-not-alone"));
        else runnable.push(call);
    }

    const runCall = async (call: ToolCall): Promise<CallOutcome> => {
        const declaration = byId.get(call.tool)!;
        let terminalValue: ToolResult | null = null;
        let executed: ToolResult | null = null;
        let executedArgs: Readonly<Record<string, unknown>> | null = null;
        let kernelBy: string | null = null;
        let policy: {value: ToolResult; by: string} | null = null;
        const outcome = await runChain<ToolCall, ToolResult>({
            core,
            method: "tool",
            layers: chainLayers(core, "tool"),
            input: deepFreeze(call),
            signal,
            timeoutMs: (item) => item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS,
            ctxFor: (item, invocation, layerSignal) => interceptCtx({assembly: core.assembly, item, state, environment: host.environment(), resources: host.resources, signal: layerSignal, invocation, phase: "run"}),
            onNext: (_item, _received, passed) => void deepFreeze(passed),
            terminal: async (final) => {
                const settle = (value: ToolResult, by: string | null = null) => {
                    terminalValue = value;
                    kernelBy = by;
                    return value;
                };
                // 中止之后不再开始新的调用：交给外面记成 unknown。
                if (signal.aborted) throw new RunStoppedError(`the call to ${final.tool}`);
                const problems = argumentProblems(declaration.parameters, final.args);
                if (problems !== null) return settle({text: `Invalid arguments for ${final.tool}: ${problems}`, status: "error", code: "invalid-arguments"});
                const settings = core.session.kernel.core;
                const effect = effectOf(declaration, final.args);
                if (settings.readOnly && effect !== "read") return settle({text: `${final.tool} is not allowed in read-only mode.`, status: "denied", code: "read-only"}, "core");
                let verdict;
                try {
                    verdict = await host.approve(final, {tool: toolInfo(declaration), effect, mode: settings.approvalMode, readOnly: settings.readOnly, remembered: core.session.kernel.remembered}, {signal, sessionId: core.header.id, model: host.model});
                } catch (error) {
                    core.diagnostics.add({code: "intercept-threw", entry: "intercept.tool", subject: "approve", params: {tool: final.tool}, message: `the approval hook threw for ${final.tool}; the call is denied`, cause: error}, core.head);
                    return settle({text: `The call to ${final.tool} was denied because approval failed.`, status: "denied", code: "intercept-failed"}, "core");
                }
                if (verdict.verdict === "deny") return settle({text: `The call to ${final.tool} was denied (${verdict.rejection.code}).`, status: "denied", code: verdict.rejection.code}, verdict.rejection.by);
                let approvedBy = verdict.verdict === "allow" ? verdict.by : "user";
                if (verdict.verdict === "ask") {
                    // 审批要问用户（runtime.md 输出 39）：这次调用停下等 resolve；同一段里别的调用照常并发。
                    if (host.interactions === undefined) return settle({text: `The call to ${final.tool} needs the user's approval, which this run cannot ask for.`, status: "denied", code: "approval-unavailable"}, "core");
                    const request = {tool: final.tool, args: final.args, effect, ...(verdict.reason === undefined ? {} : {reason: verdict.reason})} as unknown as JsonValue;
                    const resolution = (await host.interactions.request(core, host.write, {callId: final.id, kind: "approval", request, async: false}, signal))!;
                    if (resolution.decision === "aborted" || resolution.decision === "interrupted") return settle({text: `The call to ${final.tool} was not run: the run was aborted while it waited for approval.`, status: "denied", code: resolution.decision === "interrupted" ? "interrupted-before-approval" : "aborted"}, "core");
                    if (resolution.decision === "deny") return settle({text: `The user denied the call to ${final.tool}.${resolution.note === undefined ? "" : ` The user said: ${resolution.note}`}`, status: "denied", code: "user-denied"}, "user");
                    approvedBy = "user";
                }
                // 先建好实现、再看一次中止，才写 toolStarted 并执行：建实现可能很慢，中止之后不该再开始执行。
                let implementation: ToolImplementation;
                try {
                    implementation = await host.box.implementation(final.tool);
                } catch (error) {
                    return settle({text: `${final.tool} is not available: ${messageOf(error)}`, status: "error", code: "tool-unavailable"});
                }
                if (signal.aborted) throw new RunStoppedError(`the call to ${final.tool}`);
                await host.write([ctrl("toolStarted", {callId: final.id, tool: final.tool, args: final.args, invocation: core.newId(), approval: {by: approvedBy}})]);
                started.add(final.id);
                executedArgs = final.args;
                try {
                    executed = normalizeResult(await implementation.execute(final.args, {signal, callId: final.id, sessionId: core.header.id, initial: host.environment().initial, ...(host.interactions === undefined ? {} : {ask: askFor(host, host.interactions, final.id, signal)})}), `tool ${final.tool}`);
                } catch (error) {
                    executed = Object.freeze({text: `${final.tool} failed: ${messageOf(error)}`, status: "error", code: "tool-threw"} as const);
                }
                return settle(executed);
            },
            onFailure: (item) => {
                if ((item.definition.onFailure as {tool?: "deny" | "ignore"} | undefined)?.tool === "ignore") return {kind: "skip"};
                policy = {value: {text: `The call to ${call.tool} was denied because an interceptor failed.`, status: "denied", code: "intercept-failed"}, by: item.definition.id};
                return {kind: "result", value: policy.value};
            },
            normalize: (item, returned) => normalizeResult(returned, `tool interceptor of ${item.definition.id}`),
        });
        const final = outcome.value;
        let status: ToolStatus = final.status ?? "ok";
        let by: string | null = null;
        if (policy !== null && final === (policy as {value: ToolResult}).value) by = (policy as {by: string}).by;
        else if (final === terminalValue) by = kernelBy;
        else if (terminalValue === null && outcome.stoppedBy !== null && status === "denied") {
            status = "blocked";
            by = outcome.stoppedBy;
        }
        const ran = executed as ToolResult | null;
        const changed = ran !== null && final.text !== ran.text;
        const data: ToolResultData = {
            callId: call.id,
            tool: call.tool,
            text: final.text,
            status,
            ...(final.code === undefined ? {} : {code: final.code}),
            ...(by === null ? {} : {by}),
            // 脱敏的结果不写 details：拦截层常写 {...result, text, redacted: true}，details 会把原文带进日志（session.md 输出 10）。
            ...(final.details === undefined || final.redacted === true ? {} : {details: final.details}),
            ...(!changed ? {} : final.redacted === true ? {rawHash: sha256(ran.text)} : {raw: ran.text}),
        };
        return {data, failures: outcome.failures, args: executedArgs};
    };

    // 宽限期：中止之后才起表；没中止就永远不到。
    const graceTimer = new AbortController();
    let graceExpired = false;
    let startGrace: () => void = () => undefined;
    const graceOver = new Promise<null>((resolve) => {
        startGrace = () => core.clock.wait(ABORT_GRACE_MS, graceTimer.signal).then(() => {
            graceExpired = true;
            resolve(null);
        }, () => undefined);
    });
    if (signal.aborted) startGrace();
    else signal.addEventListener("abort", startGrace, {once: true});

    try {
        let index = 0;
        while (index < runnable.length) {
            if (signal.aborted) break;
            const first = runnable[index]!;
            const shared = byId.get(first.tool)!.concurrency === "shared";
            let end = index + 1;
            while (shared && end < runnable.length && byId.get(runnable[end]!.tool)!.concurrency === "shared") end += 1;
            // 被中止而没开始的调用记 unknown；写日志失败这类错误照常往外抛。每个调用记下自己完成时的结果：宽限期到了之后，
            // 按各自是否已经完成判断，不按模型给的先后（排在前面的慢调用不能连累后面已经完成的）。
            const segment = runnable.slice(index, end).map((call) => {
                const entry: {call: ToolCall; done: CallOutcome | null; running: Promise<CallOutcome>} = {call, done: null, running: Promise.resolve(unfinished(call))};
                entry.running = runCall(call).catch((error: unknown) => {
                    if (error instanceof RunStoppedError) return unfinished(call);
                    throw error;
                }).then((outcome) => (entry.done = outcome));
                return entry;
            });
            const waited = graceExpired ? null : await Promise.race([Promise.allSettled(segment.map((entry) => entry.running)), graceOver]);
            const rejected = waited?.find((result) => result.status === "rejected");
            if (rejected !== undefined) throw (rejected as PromiseRejectedResult).reason;
            for (const {call, done, running} of segment) {
                if (done !== null) {
                    outcomes.set(call.id, done);
                    continue;
                }
                outcomes.set(call.id, unfinished(call));
                void running.then((late) => {
                    if (late.data.status === "unknown") return;
                    core.diagnostics.add({code: "late-result-dropped", entry: "host", subject: call.id, params: {callId: call.id, tool: call.tool}, message: `${call.tool} finished after the abort grace period; its result is not written`}, core.head);
                }, () => undefined);
            }
            index = end;
        }
    } finally {
        graceTimer.abort();
        signal.removeEventListener("abort", startGrace);
    }

    const ordered = calls.map((call) => outcomes.get(call.id) ?? unfinished(call));
    const failures = ordered.flatMap((outcome) => outcome.failures);
    const drafts: EventDraft[] = [
        ...failureDrafts(core, "intercept.tool", failures),
        ...ordered.map((outcome): EventDraft => ({type: "toolResult", kind: "conv", scope: "path", data: outcome.data as unknown as JsonValue})),
    ];
    const only = ordered[0];
    const finished = finishAlone && only !== undefined && only.data.status === "ok" && only.args !== null ? {tool: only.data.tool, value: only.args as JsonValue} : null;
    return {drafts, finished};
}
