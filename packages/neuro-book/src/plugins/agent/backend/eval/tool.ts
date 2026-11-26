/**
 * eval 工具（docs/specs/agent/eval.md）：每个会话一个常驻内核（`kernels.ts`），一次调用执行一个单元，代码里的 `tool.<名>` 与全局对象
 * 经内核的 `ctx.invoke` 照常审批、拦截、记日志（harness/runtime.md 输出 90 起）。
 *
 * 所有权：内核进程与重置原因这些跨调用的记账在 `SessionKernel` 上，按会话 id 存在 `KernelRegistry` 里，不挂在工具实现上：工具实现
 * 每次打开会话建一个，会话关闭时释放，内核留着（eval.md 输出 11），会话再打开后新的实现接着用。内核由空闲计时、全服务端的
 * 总数上限与服务端停止（`evalTool` 交回的 `stop`）结束。
 */

import {join} from "node:path";

import {Value} from "typebox/value";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {OutputCapture, saveFullOutput} from "@notnotype/nb-harness/kit/tools";
import type {JsonValue, NestedOutcome, ToolContext, ToolDeclaration, ToolImage, ToolImplementation, ToolResult, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import {defineContract, implement, shape, slice} from "@notnotype/nb-harness/kernel";

import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";
import type {AgentToolServices} from "../../shared/resources";
import {sessionFiles} from "../resources";
import type {CallReply, CallTarget, GlobalObjects} from "./protocol";
import {IMPORT_HELPER} from "./constants";
import {objectsSection, type EvalObject} from "./objects";
import {rewriteCell} from "./rewrite";
import {describeExit, Kernel, KernelRegistry, type CellEnd, type KernelHolder} from "./kernels";
import type {EvalNotices} from "./notices";

export const EVAL_TOOL = "nbook.agent.eval";
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 3_600;
/** 空闲回收（eval.md 输出 11）。 */
export const EVAL_IDLE_MS = 30 * 60_000;
/** 一个单元的结果至多附几张图（eval.md 输出 4）。 */
const MAX_IMAGES = 8;

/** 代码不能当变量声明的名字（eval.md 输出 3）：内核给的东西，声明了就盖掉，之后的单元都调不到。 */
export const KERNEL_NAMES: readonly string[] = ["tool", "display", "console", "require", "ToolCallError", IMPORT_HELPER];

/** 给模型的说明（eval.md 输出 16；提示词规范：中文，集中放在这里）。全局对象的列表按会话拼在后面（`evalDescription`）。 */
const DESCRIPTION = [
    "在这个会话的 JS 内核（Bun）里执行一段代码，用来批量做事：一次读很多章、统计、按结果再改。顶层声明的变量与函数在之后的调用里还在，不要重复已经成功的设置；结果第一行写着“内核已重置”时，之前的变量没了，只重建还要用的那部分。",
    "代码里调工具：`await tool.<名>(参数对象)`，名字与你调工具时用的相同（带 - 或 . 的写 tool[\"名\"]）；声明了结构化结果的工具交回对象，其余交回结果文字。read 交回对象：文本的原文在 content 里（不带地址头与行号，统计用它），more 为 true 时用 offset: next 读下一页；目录的条目在 entries 里。失败时抛 ToolCallError（有 status 与 code，unknown 表示不知道有没有执行完，先核对再重做）。每个 tool.* 与对象的方法都是异步的，都要 await；批量调用可能有失败时用 Promise.allSettled。代码里调的工具照常要审批。",
    "可以用顶层 await、import（node:、bun:、相对路径与包名按工作目录解析）、require；console 的输出与最后一个表达式的值是结果；display({data, mime}) 附一张图。要命令的输出用 Bun.$`…`.text()。不支持 export 与 TypeScript 语法。",
    "失败后只重试失败的那一步，前面的步骤可能已经生效。timeout 是秒数，缺省 30，等审批的时间不算；超时会重置内核。reset 为 true 时先重置内核（code 可以为空）。",
].join("\n\n");

export const evalDeclaration: AgentToolDeclaration = {
    description: DESCRIPTION,
    parameters: {
        type: "object",
        // `title` 排在 `code` 前面：模型按这个顺序生成参数，界面在代码还在生成时就能写出卡片的标题。
        properties: {
            title: {type: "string", description: "一句话说明这段代码做什么"},
            code: {type: "string", description: "要执行的 JavaScript"},
            timeout: {type: "integer", minimum: 1, maximum: MAX_TIMEOUT_SECONDS, description: "单元时限（秒），缺省 30"},
            reset: {type: "boolean", description: "先重置内核"},
        },
        required: ["code"],
        additionalProperties: false,
    },
    providerName: "eval",
    version: "1",
    effect: "exec",
    concurrency: "exclusive",
    strict: true,
    invokes: true,
};

/**
 * 这个会话里 eval 的声明（eval.md 输出 16）：基础说明后接“可用的全局对象”一节，版本带这一节的短哈希，列表变了内核按
 * harness/runtime.md 输出 16 写 `tools-changed`，会话中途不悄悄换说明。`objects` 是这个工具集里至少有一个方法的对象。
 */
export function evalDeclarationFor(declaration: ToolDeclaration, objects: readonly EvalObject[]): ToolDeclaration {
    const section = objectsSection(objects);
    return section === null ? declaration : {...declaration, description: `${declaration.description}\n\n${section.text}`, version: `${declaration.version}+${section.hash}`};
}

/** 会话里能经代码调的工具在 eval 看来的样子：名字是交给服务商的名字，`returns` 来自 `agent.tools` 的声明。 */
export interface CodeTool {
    readonly id: string;
    readonly name: string;
    readonly returns?: Readonly<Record<string, unknown>>;
    readonly global?: {readonly object: string; readonly method: string};
}

export interface EvalToolDeps {
    /** 内核入口文件的绝对路径（`kernelEntry()`）。 */
    readonly entry: string;
    /** 这个会话此刻的工具集（与内核的生效工具集同一份来源）。 */
    readonly toolsOf: (context: ToolSessionContext) => readonly CodeTool[];
    /** 宿主的时钟：空闲回收与单元时限都在它上面计时，测试推进它。握手的期限不在这里（冷启动是宿主的成本，按真实时间）。 */
    readonly clock: RuntimeClock;
    readonly idleMs?: number;
    readonly handshakeMs?: number;
    /** 当场知道的重置给会话发提醒、新内核起来时撤回（eval.md）；不给时只写在下一次结果里。 */
    readonly notices?: EvalNotices;
}

/** 内核入口：打包产物里是与本模块的包同目录的 `eval-kernel.js`（`build:server` 与应用包一起产出），源码里是 `kernel-entry.ts`。 */
export function kernelEntry(): string {
    return import.meta.path.endsWith(".js") ? join(import.meta.dir, "eval-kernel.js") : join(import.meta.dir, "kernel-entry.ts");
}

// ─── 重置用的两个计数（eval.md 输出 11、12） ─────────────────

export const EVAL_STATE_EXTENSION = "nbook.agent.eval-state";
/**
 * `cells`：当前路径上 eval 的结果数，重置提示用。只看工具 id：结果被脱敏时 `details` 不写日志，工具 id 还在。
 * `profiles`：会话里 `profileChanged` 的条数，换没换过 Profile 用。只比 Profile 的 id 看不出换走又换回来；计数来自日志，
 * 会话关闭再打开之后照样能比。
 */
export const evalStateContract = defineContract(EVAL_STATE_EXTENSION, {exports: shape<{cells: number; profiles: number}>()});
export const evalStateExtension = implement(evalStateContract, {
    state: {cells: slice.path(0), profiles: slice.session(0)},
    reduce: {
        toolResult: (event, state) => ((event.data as {tool: string}).tool === EVAL_TOOL ? {cells: state.cells + 1} : undefined),
        profileChanged: (_event, state) => ({profiles: state.profiles + 1}),
    },
    exports: {cells: (state) => state.cells, profiles: (state) => state.profiles},
});

// ─── 实现 ─────────────────────────────────────────────

/** eval 的工具实现与它的内核登记表。会话关闭不结束内核（eval.md 输出 11）：服务端停止时，会话都关完之后调 `stop` 全部结束。 */
export function evalTool(deps: EvalToolDeps): {readonly implementation: AgentToolImplementation; stop(): Promise<void>} {
    const registry = new KernelRegistry<SessionKernel>();
    return {
        implementation: {create: (context, services) => new EvalSession(context, services, deps, registry)},
        stop: () => registry.stop(),
    };
}

/** 内核重置的原因，写进下一次结果的第一行（eval.md 输出 12）。 */
type ResetReason = "回退或切分支" | "主动重置" | "超时" | "被停止" | "意外退出" | "空闲" | "被回收" | "换了 Profile" | "工作目录变了";

/**
 * 一个会话打开期间的 eval 工具实现：会话关闭、换 Profile 或工具被卸载时 `dispose`，之后这个实例不再执行。内核在登记表里这个
 * 会话的 `SessionKernel` 上，不随它结束。
 */
class EvalSession implements ToolImplementation {
    #closed = false;

    constructor(private readonly context: ToolSessionContext, private readonly services: AgentToolServices, private readonly deps: EvalToolDeps, private readonly registry: KernelRegistry<SessionKernel>) {}

    dispose(): void {
        this.#closed = true;
    }

    async execute(args: Readonly<Record<string, unknown>>, ctx: ToolContext): Promise<ToolResult> {
        if (this.#closed) return failure("kernel-unavailable", "会话已关闭，内核不再可用。");
        const kernel = this.registry.take(this.context.sessionId, () => new SessionKernel(this.context.sessionId, this.deps, this.registry));
        if (kernel === null) return failure("kernel-unavailable", "服务端正在停止，内核不再可用。");
        return kernel.execute(args, ctx, this.context, this.services);
    }
}

/**
 * 一个会话的内核与跨调用的记账，按会话 id 存在登记表里，比会话的工具实现活得久。同一时刻至多一个调用在这里执行：eval 是
 * exclusive，一个会话同时只打开一份，关闭在它的运行都结束之后。
 */
class SessionKernel implements KernelHolder {
    #kernel: Kernel | null = null;
    /**
     * 起内核时会话的 Profile（id 加换过几次），换了就重置（eval.md 输出 11）。内核本身不依赖 Profile（工具集与全局对象每个单元
     * 重新给）：这是原先换 Profile 时工具实现整体重建、内核跟着结束的行为，搬到登记表之后保留下来；要让变量跨 Profile 留着，
     * 去掉这个判断即可。
     */
    #profile: string | null = null;
    /**
     * 起内核时的工作目录与布局变量。内核起来之后它们就定了，每次调用都按会话现在的布局重新解析、对不上就重置：项目同一个 id
     * 换了目录（runtime/projects.md 输出 1）之后，留着的内核还在旧目录里。
     */
    #place: string | null = null;
    /** 正有调用在这里执行（包括还在起内核）：登记表不丢它、不回收它。 */
    #busy = false;
    /** 上一次调用时的 `ctx.leafMoves`：变了说明中间回退或切过分支。这个计数来自日志，会话关闭再打开之后照样能比。 */
    #leafMoves: number | null = null;
    #reason: ResetReason | null = null;
    #cells = 0;
    /** 上一次执行单元时的 `ctx.leafMoves`：与这次相同，说明那个单元的结果在当前路径上（可能就在同一条回复里、还没写进日志）。 */
    #ranAt: number | null = null;
    #idle: (() => void) | null = null;

    constructor(private readonly sessionId: string, private readonly deps: EvalToolDeps, private readonly registry: KernelRegistry<SessionKernel>) {}

    get holding(): boolean {
        return this.#kernel?.alive === true;
    }

    get busy(): boolean {
        return this.#busy;
    }

    evict(): void {
        void this.#reset("被回收", true);
    }

    async close(): Promise<void> {
        this.#clearIdle();
        const kernel = this.#kernel;
        this.#kernel = null;
        await kernel?.kill();
    }

    async execute(args: Readonly<Record<string, unknown>>, ctx: ToolContext, context: ToolSessionContext, services: AgentToolServices): Promise<ToolResult> {
        this.#clearIdle();
        this.#busy = true;
        try {
            return await this.#execute(args, ctx, context, services);
        } finally {
            this.#busy = false;
            // 每个出口都重新计空闲，语法错误这类提前交回的也算：内核不随会话关闭结束，漏排一次就只剩总数上限能回收它。内核在这次调用
            // 的结尾（单元已交回、结果还在整理）退出时，`exited` 因为还忙没有重置：这里补上，提醒照发（eval.md 输出 20）。
            if (this.holding) this.#scheduleIdle();
            else if (this.#kernel !== null) void this.#reset("意外退出", true);
        }
    }

    async #execute(args: Readonly<Record<string, unknown>>, ctx: ToolContext, context: ToolSessionContext, services: AgentToolServices): Promise<ToolResult> {
        // 两次调用之间内核自己没了（被外部杀掉、崩溃）：单元里的退出由 `#run` 处理，这里补上单元之外的。
        if (this.#kernel !== null && !this.#kernel.alive) await this.#reset("意外退出");
        if (this.#leafMoves !== null && ctx.leafMoves !== this.#leafMoves && this.#kernel !== null) await this.#reset("回退或切分支");
        const profile = `${context.profile}#${String(ctx.read(evalStateContract)?.profiles ?? 0)}`;
        if (this.#kernel !== null && this.#profile !== profile) await this.#reset("换了 Profile");
        this.#leafMoves = ctx.leafMoves;
        if (args.reset === true) await this.#reset("主动重置");
        const code = args.code as string;
        if (code.trim() === "" && args.reset === true) return {text: "内核已重置。", details: {reset: true}};

        const tools = this.deps.toolsOf(context);
        const globals = globalObjects(tools);
        const rewritten = rewriteCell(code, new Set([...KERNEL_NAMES, ...globals.map((object) => object.name)]));
        if (!rewritten.ok) return failure("code-error", rewritten.failure.message);

        const place = await this.#locate(context, services, ctx.signal);
        if ("failure" in place) return place.failure;
        const where = JSON.stringify([place.cwd, place.layout]);
        if (this.#kernel !== null && this.#place !== where) await this.#reset("工作目录变了");

        let fresh = false;
        if (this.#kernel === null || !this.#kernel.alive) {
            const env: Record<string, string> = {};
            for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
            const started = await Kernel.start({entry: this.deps.entry, cwd: place.cwd, env: {...env, ...place.layout}}, {signal: ctx.signal, ...(this.deps.handshakeMs === undefined ? {} : {handshakeMs: this.deps.handshakeMs})});
            if (!started.ok) return failure("kernel-unavailable", started.reason);
            this.#kernel = started.kernel;
            this.#profile = profile;
            this.#place = where;
            fresh = true;
            // 两次调用之间内核自己退出了：当场知道，发提醒（单元执行中的退出由 `#run` 写进那次结果）。`#reset` 先把 `#kernel` 置空再杀，
            // 那次退出到这里时已不是当前内核。
            const current = started.kernel;
            void current.exited.then(() => {
                if (this.#kernel === current && !this.#busy) void this.#reset("意外退出", true);
            });
            // 新一代能用了：旧一代还没取走的提醒撤回。
            this.deps.notices?.ready(this.sessionId);
        }
        this.registry.admit(this);
        const kernel = this.#kernel;
        // 新内核、而这条路径上跑过 eval：之前的变量没了，结果第一行说明（eval.md 输出 12）。路径上的计数只含已经写进日志的结果，
        // 同一条回复里前面几个 eval 的还不在里面，所以另看叶子没动过时这里有没有跑过单元。没有 `#reason` 的是登记表里新建的：
        // 服务重启或分叉出的会话（登记表丢掉的、只记着原因的持有者也落到这里），分不出是哪一种。
        const ranOnPath = this.#ranAt === ctx.leafMoves || (ctx.read(evalStateContract)?.cells ?? 0) > 0;
        const notice = fresh && ranOnPath ? `内核已重置（${this.#reason ?? "服务重启或分叉"}），之前的变量没了。` : null;
        this.#reason = null;

        const cell = ++this.#cells;
        this.#ranAt = ctx.leafMoves;
        const outcome = await this.#run(kernel, cell, rewritten.source, code, tools, globals, ctx, args.timeout as number | undefined);
        if (outcome.reset !== null) await this.#reset(outcome.reset);
        return this.#result(outcome, notice, cell, services);
    }

    /**
     * 会话现在的工作目录与布局变量，同 `shell`（builtin-tools.md 输出 18、20）。内核的环境是服务端的环境加这些布局变量，不读
     * 工作目录的 `.env`（入口带 `--no-env-file`）。
     */
    async #locate(context: ToolSessionContext, services: AgentToolServices, signal: AbortSignal): Promise<{cwd: string; layout: Record<string, string>} | {failure: ToolResult}> {
        const files = sessionFiles(services.resources, context);
        const cwd = await files.readPath(files.layout.working, {signal});
        if (!cwd.ok) return {failure: failure("kernel-unavailable", `工作目录取不到：${cwd.detail}`)};
        const layout: Record<string, string> = {};
        for (const [name, address] of Object.entries(files.layout.shellEnv)) {
            const located = await files.readPath(address, {signal});
            if (located.ok) layout[name] = located.value.path;
        }
        return {cwd: cwd.value.path, layout};
    }

    async #run(kernel: Kernel, cell: number, source: string, code: string, tools: readonly CodeTool[], globals: GlobalObjects, ctx: ToolContext, timeoutSeconds: number | undefined): Promise<CellOutcome> {
        const capture = new OutputCapture();
        const images: ToolImage[] = [];
        let dropped = 0;
        // 宽高随图转交：harness 按它估图片的 token、在占位文字里写尺寸，丢了就只能按上限估。
        const addImage = (image: ToolImage): void => {
            if (images.length < MAX_IMAGES) images.push({data: image.data, mime: image.mime, ...(image.width === undefined ? {} : {width: image.width}), ...(image.height === undefined ? {} : {height: image.height})});
            else dropped += 1;
        };
        // 这个单元的范围：超时或停止时触发，内核按宽限期结算在途的嵌套调用（harness/runtime.md 输出 100）。
        const scope = new AbortController();
        const deadline = new Deadline(this.deps.clock, (timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000, () => scope.abort("timeout"));
        const stop = (): void => scope.abort("aborted");
        ctx.signal.addEventListener("abort", stop, {once: true});
        const byName = new Map(tools.filter((tool) => tool.global === undefined).map((tool) => [tool.name, tool]));
        const byMethod = new Map(tools.filter((tool) => tool.global !== undefined).map((tool) => [`${tool.global!.object}.${tool.global!.method}`, tool]));
        const call = async (target: CallTarget, args: unknown): Promise<CallReply> => {
            const label = target.kind === "tool" ? target.name : `${target.object}.${target.method}`;
            const tool = target.kind === "tool" ? byName.get(target.name) : byMethod.get(label);
            if (tool === undefined) return {ok: false, tool: label, status: "error", code: "unknown-tool", message: `没有 ${label}。`};
            if (ctx.invoke === undefined) return {ok: false, tool: label, status: "error", code: "invoke-not-allowed", message: "这次运行不能从代码里调工具。"};
            const outcome = await ctx.invoke(tool.id, (args ?? {}) as Record<string, unknown>, {signal: scope.signal, onWaiting: (waiting) => (waiting ? deadline.pause() : deadline.resume())});
            for (const image of outcome.images ?? []) addImage(image);
            return replyOf(label, tool, outcome);
        };
        // 代码一跑起来，超时或停止都要能打断它：两路信号都结束内核，结果由内核的退出交回。
        const killer = (): void => void kernel.kill();
        scope.signal.addEventListener("abort", killer, {once: true});
        let end: CellEnd;
        try {
            deadline.start();
            end = await kernel.run({cell, source, tools: [...byName.keys()], globals}, {text: (text) => capture.push(text), image: addImage, call});
        } finally {
            deadline.stop();
            ctx.signal.removeEventListener("abort", stop);
            scope.signal.removeEventListener("abort", killer);
        }
        const why = scope.signal.reason as "timeout" | "aborted" | undefined;
        return {end, capture, images, dropped, code, why, reset: end.kind === "exited" ? (why === "timeout" ? "超时" : why === "aborted" ? "被停止" : "意外退出") : null, timeoutSeconds: timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS};
    }

    async #result(outcome: CellOutcome, notice: string | null, cell: number, services: AgentToolServices): Promise<ToolResult> {
        const {end, capture} = outcome;
        let status: ToolResult["status"] = "ok";
        let errorCode: string | undefined;
        const tail: string[] = [];
        if (end.kind === "done" && end.ok) {
            if (end.value !== undefined) capture.push(capture.totalBytes === 0 || end.value.startsWith("\n") ? end.value : `\n${end.value}`);
        } else if (end.kind === "done") {
            status = "error";
            errorCode = "code-error";
            tail.push(`${end.error.message}${stackWithin(end.error.stack, outcome.code)}`);
        } else if (outcome.why === "timeout") {
            status = "error";
            errorCode = "timeout";
            tail.push(`超过 ${String(outcome.timeoutSeconds)} 秒的时限，内核已结束并重置，之前的变量没了。`);
        } else if (outcome.why === "aborted") {
            status = "error";
            errorCode = "aborted";
            tail.push("运行被停止，内核已结束并重置，之前的变量没了。");
        } else {
            status = "error";
            errorCode = "kernel-exited";
            const stderr = end.exit.stderrTail.trim();
            tail.push(`内核意外退出（${describeExit(end.exit)}），已重置，之前的变量没了。${stderr === "" ? "" : `\n内核的错误输出最后一段：\n${stderr}`}`);
        }
        const {text, clipped} = capture.window();
        const full = capture.overflowed ? await saveFullOutput(services.artifacts, capture, "eval") : {};
        capture.dispose();
        const lines = [
            ...(notice === null ? [] : [notice]),
            ...(text === "" && tail.length === 0 && outcome.images.length === 0 ? ["（没有输出）"] : text === "" ? [] : [text.endsWith("\n") ? text.slice(0, -1) : text]),
            ...tail,
            ...(clipped ? [`（输出 ${String(capture.totalBytes)} 字节，这里只有一部分）`] : []),
            ...(full.address === undefined ? [] : [`全文：${full.address}，用 read 分页读`]),
            ...(full.problem === undefined ? [] : [`全文没能保存：${full.problem}`]),
            ...(outcome.dropped === 0 ? [] : [`（另有 ${String(outcome.dropped)} 张图没有附上：一次至多 ${String(MAX_IMAGES)} 张）`]),
        ];
        const details: JsonValue = {cell, bytes: capture.totalBytes, images: outcome.images.length, ...(full.address === undefined ? {} : {artifact: full.address}), ...(errorCode === undefined ? {} : {code: errorCode})};
        return {
            text: lines.join("\n"),
            ...(outcome.images.length === 0 ? {} : {images: outcome.images}),
            ...(status === "ok" ? {} : {status, code: errorCode!}),
            details,
        };
    }

    /** `outside`：不在调用里、当场知道的重置（空闲、被回收、两次调用之间意外退出）：发提醒（每一代内核起来时都跑了一个单元，重置就丢了变量）。 */
    async #reset(reason: ResetReason, outside = false): Promise<void> {
        this.#clearIdle();
        const kernel = this.#kernel;
        this.#kernel = null;
        if (kernel !== null) {
            this.#reason = reason;
            if (outside) this.deps.notices?.reset(this.sessionId, `eval 的内核已重置（${reason}），之前的变量没了。下一次 eval 会起新的内核。`);
            await kernel.kill();
        }
    }

    #scheduleIdle(): void {
        this.#clearIdle();
        this.#idle = this.deps.clock.schedule(() => void this.#reset("空闲", true), this.deps.idleMs ?? EVAL_IDLE_MS);
    }

    #clearIdle(): void {
        this.#idle?.();
        this.#idle = null;
    }
}

interface CellOutcome {
    readonly end: CellEnd;
    readonly capture: OutputCapture;
    readonly images: readonly ToolImage[];
    readonly dropped: number;
    readonly code: string;
    readonly why: "timeout" | "aborted" | undefined;
    readonly reset: ResetReason | null;
    readonly timeoutSeconds: number;
}

/** 嵌套调用的结局交给代码（eval.md 输出 7、8）：声明了 `returns` 的成功时交回校验过的 `details`。 */
function replyOf(label: string, tool: CodeTool, outcome: NestedOutcome): CallReply {
    if (outcome.status !== "ok") {
        const message = outcome.status === "unknown" ? `${outcome.text}（不知道有没有执行完，先核对再重做）` : outcome.text;
        return {ok: false, tool: label, status: outcome.status, ...(outcome.code === undefined ? {} : {code: outcome.code}), message};
    }
    if (tool.returns === undefined) return {ok: true, value: outcome.text};
    if (!Value.Check(tool.returns as never, outcome.details)) return {ok: false, tool: label, status: "error", code: "returns-mismatch", message: `${label} 交回的结构不符合它声明的 returns。`};
    return {ok: true, value: outcome.details};
}

/** 这个会话里的全局对象：至少有一个方法在生效工具集里的才算（eval.md 输出 16）。 */
function globalObjects(tools: readonly CodeTool[]): GlobalObjects {
    const methods = new Map<string, string[]>();
    for (const tool of tools) {
        if (tool.global === undefined) continue;
        const list = methods.get(tool.global.object) ?? [];
        list.push(tool.global.method);
        methods.set(tool.global.object, list);
    }
    return [...methods.entries()].map(([name, list]) => ({name, methods: list}));
}

/** 堆栈里落在模型写的那几行之外的帧（包装的收尾）去掉。 */
function stackWithin(stack: string | undefined, code: string): string {
    if (stack === undefined) return "";
    const lines = code.split("\n").length;
    const kept = stack.split("\n").filter((frame) => {
        const match = /cell-\d+\.js:(\d+):/u.exec(frame);
        return match === null || Number(match[1]) <= lines;
    });
    return kept.length === 0 ? "" : `\n${kept.join("\n")}`;
}

function failure(code: string, text: string): ToolResult {
    return {text, status: "error", code, details: {code}};
}

/**
 * 单元时限（eval.md 输出 14）：累计计时，等用户应答时暂停（嵌套调用的 `onWaiting`，可能几个并发地等，按计数）。
 * 剩余时间到了调 `expire`。
 */
class Deadline {
    #remaining: number;
    #since = 0;
    #waiting = 0;
    #timer: (() => void) | null = null;
    #stopped = false;

    constructor(private readonly clock: RuntimeClock, budgetMs: number, private readonly expire: () => void) {
        this.#remaining = budgetMs;
    }

    start(): void {
        this.#arm();
    }

    pause(): void {
        this.#waiting += 1;
        if (this.#waiting === 1) this.#disarm();
    }

    resume(): void {
        this.#waiting = Math.max(0, this.#waiting - 1);
        if (this.#waiting === 0) this.#arm();
    }

    stop(): void {
        this.#stopped = true;
        this.#disarm();
    }

    #arm(): void {
        if (this.#stopped || this.#timer !== null) return;
        this.#since = this.clock.now();
        this.#timer = this.clock.schedule(() => {
            this.#timer = null;
            if (!this.#stopped) this.expire();
        }, Math.max(0, this.#remaining));
    }

    #disarm(): void {
        if (this.#timer === null) return;
        this.#timer();
        this.#timer = null;
        this.#remaining -= this.clock.now() - this.#since;
    }
}
