/**
 * 工具：生效工具集、实现的建与释放、一条回复里的调用怎样执行（docs/specs/harness/runtime.md 输出 15–19、23、25、26）。
 *
 * 一条回复的调用：先定下不执行的（工具不在集里、收尾工具没有单独调用），其余先过审批阶段（输出 79）：按调用顺序逐个判定，
 * 要问用户的一起问，全部应答之后才执行；模型一次发起几个编辑时，用户是对着这一批作答，不是批了一个、执行、再问下一个。
 * 之后按 `concurrency` 切段，段内按调用顺序启动、并发等待，段与段之间串行。每个调用走工具拦截链，最里层用审批阶段记下的结果，
 * 拦截改了参数才重新判定（用户不会批了 X 却执行 Y）；然后 `toolStarted`、执行。
 * 结果不在这里写：交回按调用顺序排好的写入批，由运行循环一次写下（收尾时与 `runEnded` 同批）。
 *
 * 中止：运行的信号触发后在注入的时钟上等宽限期；期内完成的照常交回，没完成的记 `unknown`，之后才到的只写诊断。
 * 中止之后不再启动新的段。
 */

import {createHash} from "node:crypto";
import {Value} from "typebox/value";
import {providerNameProblem, providerToolName, TOOL_NAME_LIMIT, toolIdProblem} from "../api/index.js";
import type {ApprovalCtx, ApproveHook, InvokeOptions, JsonValue, KernelEvents, EventData, ModelCaller, NestedOutcome, ReplyEvent, Resources, ToolCall, ToolContext, ToolDeclaration, ToolEffect, ToolImplementation, ToolInfo, ToolImage, ToolResult, ToolSessionContext, ToolStatus, SessionEnv} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {HANDLER_TIMEOUT_MS} from "../dispatch/reactions.js";
import {canonicalJson} from "../log/json.js";
import {hostReader, interceptCtx, type ViewEnvironment} from "../extension/ctx.js";
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

    /** 审批钩子拿到的上下文，与工具的同一份。 */
    sessionContext(): ToolSessionContext {
        return this.context();
    }

    #yield(): ToolDeclaration | null {
        const result = this.core.header.result;
        if (result === undefined) return null;
        return {id: YIELD_TOOL, description: "Hand back the result of this run. Call it alone, once the work is done.", parameters: result.schema as {readonly [key: string]: JsonValue}, provider: "core", version: "1", finish: true, concurrency: "exclusive", strict: true, effect: "read"};
    }

    /**
     * 宿主给的声明加 `yield`；不合规则的丢掉并诊断（`yield` 排在前面，宿主声明的同名工具算重名）。宿主给的就是最终的工具集，
     * 不按 Profile 的 `tools` 过滤：工具绑定在 Profile 之外，可以加 Profile 没写的工具（t04 决定 4，runtime.md 输出 15）；
     * Profile 的 `required` 只用来判断缺失（`run/loop.ts`）。
     */
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

/** 一个调用的判定：定下了不执行（`settled`）、可以执行（`allowed`，值是批准者），或者要问用户。 */
type Judgment =
    | {readonly kind: "settled"; readonly value: ToolResult; readonly by: string | null}
    | {readonly kind: "allowed"; readonly by: string}
    | {readonly kind: "ask"; readonly request: JsonValue};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const imagesKey = (images: readonly ToolImage[] | undefined): string => (images ?? []).map((image) => sha256(image.data)).join(",");
/** 没有图片时就是文字的哈希，与没有图片那时写下的日志一致（docs/specs/harness/runtime.md 输出 59）。 */
const rawHashOf = (result: ToolResult): string => sha256((result.images ?? []).length === 0 ? result.text : `${result.text}\0${imagesKey(result.images)}`);
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
/** 嵌套调用的提问带上来源；`onWaiting` 在等用户的前后各调一次（输出 90、94）。 */
function askFor(host: ToolRunHost, interactions: Interactions, callId: string, signal: AbortSignal, nested?: NestedAsk): NonNullable<ToolContext["ask"]> {
    return async (request, options) => {
        const async = options?.async === true;
        if (!async) nested?.onWaiting?.(true);
        let resolution;
        try {
            resolution = await interactions.request(host.core, host.write, {callId, kind: "question", request: request as unknown as JsonValue, async, ...(nested === undefined ? {} : {within: nested.within})}, signal);
        } finally {
            if (!async) nested?.onWaiting?.(false);
        }
        if (resolution === null) return {kind: "unavailable", code: "async"};
        if (resolution.decision === "answer") {
            const answer = resolution.data as {text: string; data?: JsonValue};
            return {kind: "answer", text: answer.text, by: resolution.by, ...(answer.data === undefined ? {} : {data: answer.data})};
        }
        return {kind: "unavailable", code: resolution.decision === "aborted" ? "aborted" : "declined"};
    };
}

interface NestedAsk {
    readonly within: {readonly tool: string; readonly invocation: string};
    readonly onWaiting?: (waiting: boolean) => void;
}

/**
 * 嵌套调用自报的等用户（`ctx.waitingForUser`，输出 90）：每个等待报一次 `true`、一次 `false`。promise 结算、调用被取消、
 * 调用结算三者先到的收回它；提供方被撤回、promise 永不结算时，调用结算照样收回，父工具的计时不会一直停着。
 */
class SelfReportedWaits {
    readonly #open = new Set<() => void>();
    #closed = false;

    constructor(private readonly report: ((waiting: boolean) => void) | undefined, private readonly signal: AbortSignal) {}

    wrap<T>(promise: Promise<T>): Promise<T> {
        if (this.#closed || this.signal.aborted) return promise;
        let open = true;
        const close = (): void => {
            if (!open) return;
            open = false;
            this.#open.delete(close);
            this.signal.removeEventListener("abort", close);
            this.report?.(false);
        };
        this.#open.add(close);
        this.signal.addEventListener("abort", close, {once: true});
        this.report?.(true);
        return promise.finally(close);
    }

    /** 调用结算：收回还开着的，之后的不再报。 */
    closeAll(): void {
        this.#closed = true;
        for (const close of [...this.#open]) close();
    }
}

/** 一次嵌套调用至多 2,000 个（输出 99）：`loop-guard` 不数它们，这是代码里失控循环的上限。 */
export const INVOKE_LIMIT = 2_000;
/** 嵌套调用的参数与结果进日志时字符串的上限（输出 96）：全文模型已经在父调用的结果里看到，界面的子行只要预览。 */
export const NESTED_PREVIEW_BYTES = 2_048;

/** 参数不是能如实写进日志的 JSON 时的说明（session.md“事件”一节的“值”）；经 IPC 从代码里来的参数可能带 `Map`、`NaN`、`bigint`。 */
function jsonProblem(value: unknown, path = "args", seen = new Set<object>()): string | null {
    if (value === null || typeof value === "string" || typeof value === "boolean") return null;
    if (typeof value === "number") return Number.isFinite(value) ? null : `${path} is ${String(value)}`;
    if (typeof value !== "object") return `${path} is a ${typeof value}`;
    if (seen.has(value)) return `${path} is a circular reference`;
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
                const problem = jsonProblem(value[index], `${path}[${String(index)}]`, seen);
                if (problem !== null) return problem;
            }
            return null;
        }
        const prototype = Object.getPrototypeOf(value) as unknown;
        if (prototype !== Object.prototype && prototype !== null) return `${path} is not a plain object`;
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined) return `${path}.${key} is undefined`;
            const problem = jsonProblem(item, `${path}.${key}`, seen);
            if (problem !== null) return problem;
        }
        return null;
    } finally {
        seen.delete(value);
    }
}

/** UTF-8 不超过 `limit` 字节的前缀，不切断字符。 */
function headBytes(text: string, limit: number): string {
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length <= limit) return text;
    let end = limit;
    // 落在一个多字节字符的中间（续字节是 10xxxxxx）时往前退到它的开头。
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    return bytes.subarray(0, end).toString("utf8");
}

/**
 * 参数里超过上限的字符串截短并注明总字节数；形状不变，界面照样取 `path` 这类短字段（输出 96）。`clipped` 是有没有截过：事件上写成
 * `argsClipped`，界面据此不按参数算增删行数，不靠认那段注明的文字。
 */
function clippedArgs(value: JsonValue): {readonly value: JsonValue; readonly clipped: boolean} {
    if (typeof value === "string") {
        const size = Buffer.byteLength(value, "utf8");
        return size <= NESTED_PREVIEW_BYTES ? {value, clipped: false} : {value: `${headBytes(value, NESTED_PREVIEW_BYTES)}…（共 ${String(size)} 字节）`, clipped: true};
    }
    if (Array.isArray(value)) {
        const items = value.map(clippedArgs);
        return {value: items.map((item) => item.value), clipped: items.some((item) => item.clipped)};
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).map(([key, item]) => [key, clippedArgs(item as JsonValue)] as const);
        return {value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])), clipped: entries.some(([, item]) => item.clipped)};
    }
    return {value, clipped: false};
}

/**
 * 同一个父调用里嵌套调用的执行顺序（输出 98）：`shared` 的并发，`exclusive` 的等在途的都结束、独占执行。先到先排，
 * 排在 `exclusive` 后面的 `shared` 不插队。只管执行这一段，审批与等用户不占它。
 */
class NestedLock {
    #shared = 0;
    #exclusive = false;
    readonly #queue: Array<{readonly kind: "shared" | "exclusive"; readonly grant: () => void}> = [];

    acquire(kind: "shared" | "exclusive", signal: AbortSignal): Promise<() => void> {
        return new Promise((resolve, reject) => {
            if (signal.aborted) return void reject(new RunStoppedError("waiting to run a nested call"));
            const entry = {kind, grant: () => {
                signal.removeEventListener("abort", abort);
                resolve(this.#releaser(kind));
            }};
            const abort = (): void => {
                const index = this.#queue.indexOf(entry);
                if (index < 0) return;
                this.#queue.splice(index, 1);
                reject(new RunStoppedError("waiting to run a nested call"));
                // 摘掉的可能是挡在队首的 exclusive：排在它后面的 shared 现在就能开始。
                this.#pump();
            };
            signal.addEventListener("abort", abort, {once: true});
            this.#queue.push(entry);
            this.#pump();
        });
    }

    #releaser(kind: "shared" | "exclusive"): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (kind === "shared") this.#shared -= 1;
            else this.#exclusive = false;
            this.#pump();
        };
    }

    #pump(): void {
        for (;;) {
            const head = this.#queue[0];
            if (head === undefined || this.#exclusive) return;
            if (head.kind === "exclusive" && this.#shared > 0) return;
            this.#queue.shift();
            if (head.kind === "exclusive") this.#exclusive = true;
            else this.#shared += 1;
            head.grant();
        }
    }
}

/** 一个声明了 `invokes` 的父调用的嵌套调用共用的状态：计数、锁、在途的调用与“父调用已结束”（输出 98 到 100）。 */
class NestedScope {
    count = 0;
    finished = false;
    readonly lock = new NestedLock();
    /** 在途的嵌套调用：各自交回结局（照实完成，或宽限期到了记成 unknown）时 settle，不等迟到的执行本身。 */
    readonly inflight = new Set<Promise<unknown>>();
    /** 父调用的执行交回时还有在途的嵌套调用：触发它，按宽限期结算（输出 100）。 */
    readonly closing = new AbortController();
    constructor(readonly within: {readonly tool: string; readonly invocation: string}) {}
}

export async function runTools(host: ToolRunHost, reply: ReplyEvent, tools: readonly ToolDeclaration[], signal: AbortSignal): Promise<ToolsOutcome> {
    const {core} = host;
    const calls = reply.data.toolCalls as readonly ToolCall[];
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const finishCalls = calls.filter((call) => byId.get(call.tool)?.finish === true);
    const finishAlone = calls.length === 1 && finishCalls.length === 1;
    const state = core.stateAt();
    const reader = hostReader(core.assembly, state);
    const leafMoves = core.session.kernel.leafMoves;
    const outcomes = new Map<string, CallOutcome>();
    const preset = (call: ToolCall, text: string, code: string): CallOutcome => ({data: {callId: call.id, tool: call.tool, text, status: "error", code}, failures: [], args: null});
    // 写过 toolStarted 的调用：据此区分“开始了、结果未知”与“根本没开始”。没开始的肯定没执行，记 denied，界面不必提示用户
    // 去核对副作用；中止、进程收尾与打开时的恢复说法一致（runtime.md 输出 25、34、53）。
    const started = new Set<string>();
    const unfinished = (call: ToolCall): CallOutcome => {
        const interrupted = interrupting(signal);
        if (!started.has(call.id)) {
            const text = `The call to ${call.tool} was not run: ${interrupted ? "the process was interrupted" : "the run was aborted"} before it started.`;
            return {data: {callId: call.id, tool: call.tool, text, status: "denied", code: interrupted ? "interrupted-before-approval" : "aborted", by: "core"}, failures: [], args: null};
        }
        if (!interrupted) return {data: {callId: call.id, tool: call.tool, text: "The call did not finish before the run was aborted.", status: "unknown", code: "aborted"}, failures: [], args: null};
        return {data: {callId: call.id, tool: call.tool, text: "The call did not finish before the process was interrupted.", status: "unknown", code: "interrupted"}, failures: [], args: null};
    };

    const runnable: ToolCall[] = [];
    for (const call of calls) {
        const declaration = byId.get(call.tool);
        if (declaration === undefined) outcomes.set(call.id, preset(call, `Unknown tool ${call.tool}.`, "unknown-tool"));
        else if (declaration.global !== undefined) outcomes.set(call.id, preset(call, `${call.tool} can only be called from code (it is ${declaration.global.object}.${declaration.global.method}).`, "code-only"));
        else if (finishCalls.length > 0 && !finishAlone && declaration.finish) outcomes.set(call.id, preset(call, `${call.tool} finishes the run and must be called alone; it was not run.`, "finish-not-alone"));
        else runnable.push(call);
    }

    /** 参数校验、只读模式、审批钩子。不问用户。`within` 是嵌套调用的来源（输出 92）。 */
    const judge = async (call: ToolCall, within?: NestedAsk["within"]): Promise<Judgment> => {
        const declaration = byId.get(call.tool);
        // 拦截层可能把调用改派到这次运行没有的工具。
        if (declaration === undefined) return {kind: "settled", value: {text: `Unknown tool ${call.tool}.`, status: "error", code: "unknown-tool"}, by: null};
        const problems = argumentProblems(declaration.parameters, call.args);
        if (problems !== null) return {kind: "settled", value: {text: `Invalid arguments for ${call.tool}: ${problems}`, status: "error", code: "invalid-arguments"}, by: null};
        const settings = core.session.kernel.core;
        const effect = effectOf(declaration, call.args);
        if (settings.readOnly && effect !== "read") return {kind: "settled", value: {text: `${call.tool} is not allowed in read-only mode.`, status: "denied", code: "read-only"}, by: "core"};
        let verdict;
        try {
            verdict = await host.approve(call, {tool: toolInfo(declaration), effect, mode: settings.approvalMode, readOnly: settings.readOnly, remembered: core.session.kernel.remembered, rememberedRules: core.session.kernel.rememberedRules, ...(within === undefined ? {} : {within})}, {signal, sessionId: core.header.id, context: host.box.sessionContext(), model: host.model, read: hostReader(core.assembly, core.stateAt()) as ApprovalCtx["read"]});
        } catch (error) {
            core.diagnostics.add({code: "intercept-threw", entry: "intercept.tool", subject: "approve", params: {tool: call.tool}, message: `the approval hook threw for ${call.tool}; the call is denied`, cause: error}, core.head);
            return {kind: "settled", value: {text: `The call to ${call.tool} was denied because approval failed.`, status: "denied", code: "intercept-failed"}, by: "core"};
        }
        if (verdict.verdict === "deny") return {kind: "settled", value: {text: `The call to ${call.tool} was denied (${verdict.rejection.code}).${typeof verdict.rejection.params?.reason === "string" ? ` ${verdict.rejection.params.reason}` : ""}`, status: "denied", code: verdict.rejection.code}, by: verdict.rejection.by};
        if (verdict.verdict === "allow") return {kind: "allowed", by: verdict.by};
        return {kind: "ask", request: {tool: call.tool, args: call.args, effect, ...(verdict.reason === undefined ? {} : {reason: verdict.reason}), ...(verdict.remember === undefined ? {} : {remember: verdict.remember}), ...(within === undefined ? {} : {within})} as unknown as JsonValue};
    };

    /** 问用户（runtime.md 输出 39）并等应答。嵌套调用的事项带来源，等的前后告诉父工具（输出 94）。 */
    const askUser = async (call: ToolCall, request: JsonValue, callSignal: AbortSignal, nested?: NestedAsk): Promise<Exclude<Judgment, {kind: "ask"}>> => {
        if (host.interactions === undefined) return {kind: "settled", value: {text: `The call to ${call.tool} needs the user's approval, which this run cannot ask for.`, status: "denied", code: "approval-unavailable"}, by: "core"};
        nested?.onWaiting?.(true);
        let resolution;
        try {
            resolution = (await host.interactions.request(core, host.write, {callId: call.id, kind: "approval", request, async: false, ...(nested === undefined ? {} : {within: nested.within})}, callSignal))!;
        } finally {
            nested?.onWaiting?.(false);
        }
        if (resolution.decision === "aborted" || resolution.decision === "interrupted") return {kind: "settled", value: {text: `The call to ${call.tool} was not run: the run was aborted while it waited for approval.`, status: "denied", code: resolution.decision === "interrupted" ? "interrupted-before-approval" : "aborted"}, by: "core"};
        if (resolution.decision === "deny") return {kind: "settled", value: {text: `The user denied the call to ${call.tool}.${resolution.note === undefined ? "" : ` The user said: ${resolution.note}`}`, status: "denied", code: "user-denied"}, by: "user"};
        return {kind: "allowed", by: "user"};
    };

    /** 判定依据里会被用户中途改掉的设置。 */
    const judgingSettings = (): string => {
        const settings = core.session.kernel.core;
        // 扩展设置也算：Agent 模式这类判定依据在扩展里，内核不认识它们，变了一样重判（harness/runtime.md 输出 79）。
        return `${String(settings.readOnly)}/${settings.approvalMode}/${JSON.stringify(core.session.kernel.settings)}`;
    };
    /** 审批阶段的结果：判定时的工具、参数、设置与结论，按 callId。 */
    const judged = new Map<string, {readonly tool: string; readonly args: string; readonly settings: string; judgment: Judgment}>();
    const approvalPhase = async (): Promise<void> => {
        for (const call of runnable) {
            if (signal.aborted) return;
            const settings = judgingSettings();
            judged.set(call.id, {tool: call.tool, args: canonicalJson(call.args), settings, judgment: await judge(call)});
        }
        // 全部判定完才写事项：钩子可能很慢，先写的话向导的“第 1 / N 个”的分母会一直变。`askUser` 同步走到写入，写入顺序就是调用顺序。
        const asking = await Promise.allSettled(runnable.map(async (call) => {
            const entry = judged.get(call.id);
            if (entry?.judgment.kind === "ask") entry.judgment = await askUser(call, entry.judgment.request, signal);
        }));
        // 中止之后不再写事项，没写的调用由外面记成没开始；写日志失败这类错误照常往外抛。
        const failed = asking.find((result) => result.status === "rejected" && !(result.reason instanceof RunStoppedError));
        if (failed !== undefined) throw (failed as PromiseRejectedResult).reason;
    };

    /**
     * 一次调用经过拦截链到执行（顶层与嵌套共用）：最里层先问 `decide` 这次能不能执行（判定、要问就问），能执行就建实现、
     * `start` 写开始的事件并给出执行用的上下文、执行、`finish` 收尾。结局的状态与署名在这里按拦截链的结果算出。
     */
    interface Attempt {
        readonly call: ToolCall;
        readonly signal: AbortSignal;
        decide(final: ToolCall): Promise<Exclude<Judgment, {kind: "ask"}>>;
        start(final: ToolCall, approvedBy: string): Promise<ToolContext>;
        /** 执行交回之后、结局写下之前（父调用在这里收口它在途的嵌套调用）。 */
        finish?(): Promise<void>;
    }
    interface Attempted {
        readonly data: Omit<ToolResultData, "callId" | "tool">;
        readonly status: ToolStatus;
        readonly final: ToolResult;
        readonly failures: readonly ChainFailure[];
        readonly args: Readonly<Record<string, unknown>> | null;
    }
    const attempt = async (a: Attempt): Promise<Attempted> => {
        let terminalValue: ToolResult | null = null;
        let executed: ToolResult | null = null;
        let executedArgs: Readonly<Record<string, unknown>> | null = null;
        let kernelBy: string | null = null;
        let policy: {value: ToolResult; by: string} | null = null;
        const outcome = await runChain<ToolCall, ToolResult>({
            core,
            method: "tool",
            layers: chainLayers(core, "tool"),
            input: deepFreeze(a.call),
            signal: a.signal,
            timeoutMs: (item) => item.definition.timeoutMs ?? HANDLER_TIMEOUT_MS,
            ctxFor: (item, invocation, layerSignal) => interceptCtx({assembly: core.assembly, item, state, environment: host.environment(), resources: host.resources, signal: layerSignal, invocation, phase: "run"}),
            onNext: (_item, _received, passed) => void deepFreeze(passed),
            terminal: async (final) => {
                const settle = (value: ToolResult, by: string | null = null) => {
                    terminalValue = value;
                    kernelBy = by;
                    return value;
                };
                // 中止之后不再开始新的调用：交给外面记成没开始或 unknown。
                if (a.signal.aborted) throw new RunStoppedError(`the call to ${final.tool}`);
                const judgment = await a.decide(final);
                if (judgment.kind === "settled") return settle(judgment.value, judgment.by);
                // 先建好实现、再看一次中止，才写开始的事件并执行：建实现可能很慢，中止之后不该再开始执行。
                let implementation: ToolImplementation;
                try {
                    implementation = await host.box.implementation(final.tool);
                } catch (error) {
                    return settle({text: `${final.tool} is not available: ${messageOf(error)}`, status: "error", code: "tool-unavailable"});
                }
                if (a.signal.aborted) throw new RunStoppedError(`the call to ${final.tool}`);
                const context = await a.start(final, judgment.by);
                executedArgs = final.args;
                try {
                    executed = normalizeResult(await implementation.execute(final.args, context), `tool ${final.tool}`);
                } catch (error) {
                    executed = Object.freeze({text: `${final.tool} failed: ${messageOf(error)}`, status: "error", code: "tool-threw"} as const);
                } finally {
                    await a.finish?.();
                }
                return settle(executed);
            },
            onFailure: (item) => {
                if ((item.definition.onFailure as {tool?: "deny" | "ignore"} | undefined)?.tool === "ignore") return {kind: "skip"};
                policy = {value: {text: `The call to ${a.call.tool} was denied because an interceptor failed.`, status: "denied", code: "intercept-failed"}, by: item.definition.id};
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
        const changed = ran !== null && (final.text !== ran.text || imagesKey(final.images) !== imagesKey(ran.images));
        const data: Omit<ToolResultData, "callId" | "tool"> = {
            text: final.text,
            ...(final.images === undefined || final.images.length === 0 || final.redacted === true ? {} : {images: final.images}),
            status,
            ...(final.code === undefined ? {} : {code: final.code}),
            ...(by === null ? {} : {by}),
            // 脱敏的结果不写 details：拦截层常写 {...result, text, redacted: true}，details 会把原文带进日志（session.md 输出 10）。
            ...(final.details === undefined || final.redacted === true ? {} : {details: final.details}),
            ...(!changed ? {} : final.redacted === true ? {rawHash: rawHashOf(ran)} : {raw: ran.text, ...(ran.images === undefined || ran.images.length === 0 ? {} : {rawImages: ran.images})}),
        };
        return {data, status, final, failures: outcome.failures, args: executedArgs};
    };

    /** 嵌套调用的准入（输出 92、95）：交回不允许的原因，允许时为 null。 */
    const notInvocable = (declaration: ToolDeclaration | undefined, tool: string): ToolResult | null => {
        if (declaration === undefined) return {text: `Unknown tool ${tool}.`, status: "error", code: "unknown-tool"};
        if (declaration.finish) return {text: `${tool} finishes the run; it cannot be called from code.`, status: "error", code: "invoke-not-allowed"};
        if (declaration.invokes === true) return {text: `${tool} calls other tools itself; it cannot be called from code.`, status: "error", code: "invoke-not-allowed"};
        if (declaration.codeCallable === false) return {text: `${tool} cannot be called from code.`, status: "error", code: "invoke-not-allowed"};
        return null;
    };

    /** 嵌套调用（输出 90 到 101）：判定、问用户、拦截与执行同顶层，事件与收口是它自己的。不抛。 */
    const invokeNested = async (scope: NestedScope, tool: string, args: Readonly<Record<string, unknown>>, options: InvokeOptions | undefined): Promise<NestedOutcome> => {
        const id = core.newId();
        const within = scope.within;
        /** 写进嵌套事件的参数：`args` 加截过时的 `argsClipped`。 */
        const loggedArgs = (value: Readonly<Record<string, unknown>>): {args: Readonly<Record<string, JsonValue>>; argsClipped?: true} => {
            if (jsonProblem(value) !== null) return {args: {}};
            const clipped = clippedArgs(value as JsonValue);
            return {args: clipped.value as Readonly<Record<string, JsonValue>>, ...(clipped.clipped ? {argsClipped: true as const} : {})};
        };
        let written = false;
        // 准入时拒收的调用在算出 callSignal 之前就经 writeResult 结算，那时还没有等待；之后才换成这次调用的。
        let waits: SelfReportedWaits | null = null;
        const writeResult = async (result: ToolResult, status: ToolStatus, by: string | null, callArgs: Readonly<Record<string, unknown>>): Promise<NestedOutcome> => {
            waits?.closeAll();
            const outcome: NestedOutcome = {status, text: result.text, ...(result.code === undefined ? {} : {code: result.code}), ...(result.details === undefined || result.redacted === true ? {} : {details: result.details}), ...(result.images === undefined || result.images.length === 0 || result.redacted === true ? {} : {images: result.images})};
            if (written) return outcome;
            written = true;
            const imageCount = result.redacted === true ? 0 : (result.images?.length ?? 0);
            try {
                await host.write([ctrl("nestedToolResult", {id, within, tool, ...loggedArgs(callArgs), status, ...(result.code === undefined ? {} : {code: result.code}), ...(by === null ? {} : {by}), preview: headBytes(result.text, NESTED_PREVIEW_BYTES), size: Buffer.byteLength(result.text, "utf8"), ...(imageCount === 0 ? {} : {imageCount})})]);
            } catch (error) {
                // 运行已经收口（父调用之后才到的结算）：结果照样交给代码，日志里不再写。
                if (!(error instanceof RunStoppedError)) throw error;
            }
            return outcome;
        };
        const refuse = (result: ToolResult): Promise<NestedOutcome> => writeResult(result, result.status ?? "error", null, args);

        if (scope.finished) return refuse({text: `The call that ran this code has finished; ${tool} was not run.`, status: "error", code: "parent-finished"});
        if (scope.count >= INVOKE_LIMIT) return refuse({text: `Code may call at most ${String(INVOKE_LIMIT)} tools per run of ${within.tool}; ${tool} was not run.`, status: "error", code: "invoke-limit"});
        scope.count += 1;
        const problem = jsonProblem(args);
        if (problem !== null) return refuse({text: `Invalid arguments for ${tool}: ${problem}; arguments must be plain JSON.`, status: "error", code: "invalid-arguments"});
        const denied = notInvocable(byId.get(tool), tool);
        if (denied !== null) return refuse(denied);

        const sources = [signal, scope.closing.signal, ...(options?.signal === undefined ? [] : [options.signal])];
        const callSignal = AbortSignal.any(sources);
        const nested: NestedAsk = {within, ...(options?.onWaiting === undefined ? {} : {onWaiting: options.onWaiting})};
        const selfReported = new SelfReportedWaits(options?.onWaiting, callSignal);
        waits = selfReported;
        const call: ToolCall = {id, tool, args: deepFreeze({...args})};
        const concurrency = byId.get(tool)!.concurrency;
        let isStarted = false;
        let release: (() => void) | null = null;
        const running = attempt({
            call,
            signal: callSignal,
            decide: async (final) => {
                if (final.tool !== tool) {
                    // 拦截层改派了：最终目标照样要过准入，且不能换到另一种 concurrency（输出 95）。
                    const target = byId.get(final.tool);
                    const refused = notInvocable(target, final.tool) ?? (target!.concurrency !== concurrency ? {text: `${final.tool} cannot replace ${tool} in code: it runs with a different concurrency.`, status: "error" as const, code: "invoke-not-allowed"} : null);
                    if (refused !== null) return {kind: "settled", value: refused, by: null};
                }
                const problems = jsonProblem(final.args);
                if (problems !== null) return {kind: "settled", value: {text: `Invalid arguments for ${final.tool}: ${problems}`, status: "error", code: "invalid-arguments"}, by: null};
                // 放行之后才排队拿锁（审批与等用户不占锁）；排队期间只读或审批模式变了，按现在的设置重新判定，要问就再问（输出 92，同顶层的输出 79）。
                for (;;) {
                    const settings = judgingSettings();
                    let judgment = await judge(final, within);
                    if (judgment.kind === "ask") judgment = await askUser(final, judgment.request, callSignal, nested);
                    if (judgment.kind !== "allowed") return judgment;
                    // 等审批的时候父调用可能已经结束、工具可能被移出：批准之后再核一遍（输出 92）。
                    if (scope.finished) return {kind: "settled", value: {text: `The call that ran this code has finished; ${final.tool} was not run.`, status: "error", code: "parent-finished"}, by: null};
                    release = await scope.lock.acquire(concurrency, callSignal);
                    if (settings === judgingSettings()) return judgment;
                    release();
                    release = null;
                }
            },
            start: async (final, approvedBy) => {
                await host.write([ctrl("nestedToolStarted", {id, within, tool: final.tool, ...loggedArgs(final.args), approval: {by: approvedBy}})]);
                isStarted = true;
                return {signal: callSignal, callId: id, invocation: id, sessionId: core.header.id, initial: host.environment().initial, read: reader as ToolContext["read"], leafMoves, within, waitingForUser: (promise) => selfReported.wrap(promise), ...(host.interactions === undefined ? {} : {ask: askFor(host, host.interactions, id, callSignal, nested)})};
            },
        }).finally(() => {
            release?.();
            selfReported.closeAll();
        });

        // 宽限期（输出 100）：这次调用的信号触发之后才起表；期内完成的照实，没开始的 denied，开始了没完成的 unknown，之后到的只诊断。
        const graceTimer = new AbortController();
        const graceOver = new Promise<"grace">((resolve) => {
            const startGrace = (): void => void core.clock.wait(ABORT_GRACE_MS, graceTimer.signal).then(() => resolve("grace"), () => undefined);
            if (callSignal.aborted) startGrace();
            else callSignal.addEventListener("abort", startGrace, {once: true});
        });
        const settled = running.then(
            (done) => writeResult(done.final, done.status, done.data.by ?? null, done.args ?? args),
            (error: unknown) => {
                if (!(error instanceof RunStoppedError)) throw error;
                return writeResult({text: `${tool} was not run: the code that called it was stopped first.`, status: "denied", code: "aborted"}, "denied", "core", args);
            },
        );
        let answered!: () => void;
        const handedBack = new Promise<void>((resolve) => (answered = resolve));
        scope.inflight.add(handedBack);
        try {
            const first = await Promise.race([settled, graceOver]);
            if (first !== "grace") return first;
            void settled.then(() => core.diagnostics.add({code: "late-result-dropped", entry: "host", subject: id, params: {callId: id, tool}, message: `${tool} (called from ${within.tool}) finished after the abort grace period; its result is not written`}, core.head), () => undefined);
            return isStarted
                ? writeResult({text: `${tool} did not finish before the code that called it was stopped.`, code: "aborted"}, "unknown", null, args)
                : writeResult({text: `${tool} was not run: the code that called it was stopped first.`, status: "denied", code: "aborted"}, "denied", "core", args);
        } finally {
            graceTimer.abort();
            scope.inflight.delete(handedBack);
            answered();
        }
    };

    const runCall = async (call: ToolCall): Promise<CallOutcome> => {
        let scope: NestedScope | null = null;
        const done = await attempt({
            call,
            signal,
            decide: async (final) => {
                // 拦截层把顶层调用改派到只走代码的工具：同样不执行（输出 95）。
                const target = byId.get(final.tool);
                if (target?.global !== undefined) return {kind: "settled", value: {text: `${final.tool} can only be called from code.`, status: "error", code: "code-only"}, by: null};
                // 审批阶段判定的不是现在要执行的这个时按现在的重来，要问就再问一次：拦截改了工具或参数（规范化 JSON 比较）；
                // 或者放行之后、轮到它之前设置变了（排在慢调用后面时用户开了只读）。拒绝了的不重新判定：放宽设置不改用户的决定。
                const recorded = judged.get(final.id);
                const stillHolds = recorded !== undefined && recorded.tool === final.tool && recorded.args === canonicalJson(final.args) && (recorded.judgment.kind !== "allowed" || recorded.settings === judgingSettings());
                const judgment = stillHolds ? recorded.judgment : await judge(final);
                return judgment.kind === "ask" ? askUser(final, judgment.request, signal) : judgment;
            },
            start: async (final, approvedBy) => {
                const invocation = core.newId();
                await host.write([ctrl("toolStarted", {callId: final.id, tool: final.tool, args: final.args, invocation, approval: {by: approvedBy}})]);
                started.add(final.id);
                const context: ToolContext = {signal, callId: final.id, invocation, sessionId: core.header.id, initial: host.environment().initial, read: reader as ToolContext["read"], leafMoves, ...(host.interactions === undefined ? {} : {ask: askFor(host, host.interactions, final.id, signal)})};
                if (byId.get(final.tool)?.invokes !== true) return context;
                const opened = new NestedScope({tool: final.tool, invocation});
                scope = opened;
                return {...context, invoke: (tool, args, options) => invokeNested(opened, tool, args, options)};
            },
            finish: async () => {
                // 父调用的执行交回了：之后的 invoke 得 parent-finished；还在途的按宽限期结算完，结果都写在父调用的结果之前（输出 100）。
                const opened = scope as NestedScope | null;
                if (opened === null) return;
                opened.finished = true;
                if (opened.inflight.size === 0) return;
                opened.closing.abort();
                await Promise.allSettled([...opened.inflight]);
            },
        });
        // 宽限期过了：这个调用已经记成 unknown，迟到的结果只写诊断，帧也不能再说它成功了。
        if (!graceExpired) core.emit({type: "tool", callId: call.id, status: done.status});
        return {data: {callId: call.id, tool: call.tool, ...done.data}, failures: done.failures, args: done.args};
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
        // 钩子可能不理会中止：和执行一样，宽限期到了就不再等它。
        await Promise.race([approvalPhase(), graceOver]);
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
