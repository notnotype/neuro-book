/**
 * 指令（提案第 3 节）。每条被受理的指令在受理批里写 `commandAccepted{commandId, name, value}`，重发同一个 `commandId`
 * 返回第一次的 `value` 与 `replayed: true`；校验失败不写，重发重新校验（session.md 输出 17）。
 * `value` 引用的 id 都在受理批里写出：空闲时会开始运行的指令，受理批就含 `runStarted`（输出 18）。
 *
 * 受理（校验加写）在队列的一项里做，所以两条指令的校验看到的状态不会交错。`send`、`enqueue` 的输入拦截链也在这一项里跑
 * （runtime.md 输出 24），拒绝时整条指令失败、不写日志。`abort` 不经队列（先判权限、触发信号），清空或留着由收口批写下。
 * 发出者的权限都经 `permissions.ts`（输出 108）。
 */

import type {Attributed, CommandMap, CommandName, CommandResult, InputMode, Issuer, JsonValue, LogEvent, ModelPort, PendingNotice, Placement, ReleaseMode, Resources, UserInput} from "../api/index.js";
import {LogBrokenError, type EventDraft, type SessionCore} from "../dispatch/core.js";
import {canonicalJson, sha256} from "../log/json.js";
import type {RunControl} from "./control.js";
import {blockedByUser, canAbort, canContinue, canEdit, canRemove, continuableEnded, ownerOf, sameIssuer} from "./permissions.js";
import {openRunDrafts, projectSession, releaseDrafts} from "./settle.js";
import {ctrl} from "./writes.js";
import {reactToWritten, writeAndReact, type ReactHost} from "../dispatch/reactions.js";
import {defaultSettings, type ViewEnvironment} from "../extension/ctx.js";
import {byField, interceptInput, queuedData} from "./input.js";
import {settingsProblem} from "./settings.js";
import {releaseClaims, type Claim} from "./interaction.js";
import {firstWake, gateDraft, gateOpen, hasWake, userRunsChat, wakeRunDrafts} from "./wake.js";

export interface CommandHost {
    readonly core: SessionCore;
    readonly react: ReactHost;
    readonly control: RunControl;
    readonly models: ModelPort;
    readonly resources: Resources;
    /** 输入拦截的视图环境。 */
    environment(): ViewEnvironment;
    /** 会话为什么只读；可写时为 null。 */
    readOnly(): string | null;
    /** 会话已开始关闭：在队列里等到这一项的指令（例如输入拦截还没返回时关闭开始了）不再写入、不再开运行。 */
    closed(): boolean;
    /** 进行中的重新装配；没有时为 null。排在它之前进了队列的指令要等它做完再判定（runtime.md 输出 57）。 */
    reassembling(): Promise<void> | null;
}

/** 受理项发现有进行中的重新装配：让出队列，等它做完再从头受理。 */
const AFTER_REASSEMBLY = Symbol("after-reassembly");

/**
 * 受理之后的收尾分两类（runtime.md 的应答条目）：
 * - `committed`：受理批写下就必须让内存跟上的事，只放同步、不写日志的（现在只有应答叫醒认领到的等待者）。在反应阶段结束之后执行，
 *   不论反应批写没写下：反应还在跑时等着的工具不能先往下走。带它的指令（应答）在反应批写失败时回执成功。
 * - `written`、`launch`、`after`：要会话健康才做的事。`written` 在这一个队列项里、受理批与它引出的反应都写下之后做；`after` 在队列项
 *   结束之后做（例如装上扩展：它自己要排队写日志，不能在这一项里等）。反应批写失败时都不做，内存停在受理批，重开以文件为准。
 */
export type Outcome<K extends CommandName> = {value: CommandMap[K]["value"]; drafts: EventDraft[]; launch?: string; launchOptions?: {compact?: {require: readonly string[]}}; committed?: () => void; written?: () => Promise<void>; after?: () => Promise<void>} | {fail: string; detail?: Attributed | Record<string, JsonValue>};

/** 受理一条指令：查重发、校验、写受理批、需要时开始运行。 */
export async function accept<K extends CommandName>(host: CommandHost, name: K, args: CommandMap[K]["args"] & {commandId: string}, decide: () => Outcome<K> | Promise<Outcome<K>>): Promise<CommandResult<K>> {
    const {core} = host;
    const {commandId} = args;
    const argsHash = argsHashOf(args);
    let after: (() => Promise<void>) | undefined;
    let waitFor: Promise<void> | null = null;
    // 这次受理批写失败：句柄进损坏状态，指令以 `log-broken` 交回（session.md 输出 12），不把错误抛给调用方。
    const result = await core.queue.run(async (): Promise<CommandResult<K> | typeof AFTER_REASSEMBLY> => {
        const previous = core.commands.get(commandId);
        if (previous !== undefined) return replay(previous, name, argsHash) as CommandResult<K>;
        if (core.broken) return {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
        // 运行收口时排下的重新装配先做：在它之前就排进队列的指令也等它（重新装配要占队列，不能在这一项里等）。
        waitFor = host.reassembling();
        if (waitFor !== null) return AFTER_REASSEMBLY;
        const outcome = await decide();
        if (host.closed()) return {ok: false, code: "session-closed"} as unknown as CommandResult<K>;
        if ("fail" in outcome) return {ok: false, code: outcome.fail, ...(outcome.detail === undefined ? {} : {detail: outcome.detail})} as unknown as CommandResult<K>;
        const accepted: EventDraft = {type: "commandAccepted", kind: "ctrl", scope: "session", data: {commandId, name, value: outcome.value as JsonValue, argsHash}};
        // 用户开起或接着跑了一次对话运行：同一批里开门（runtime.md 输出 117）。被拒、开不起、只进缓冲区的走不到这里或不开运行。
        const gate = outcome.launch !== undefined && userRunsChat(outcome.drafts) && !gateOpen(core) ? [gateDraft(true, "user")] : [];
        // commandAccepted 排在批的最后：它的 seq 就是受理批最后一条的 seq，重发时原样交回。
        let written: readonly LogEvent[];
        try {
            written = await core.write([...outcome.drafts, ...gate, accepted]);
        } catch (error) {
            // 受理批的写入结果不确定：认领到的等待者由调用方收尾（`releaseClaims`）。
            if (error instanceof LogBrokenError) return {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
            throw error;
        }
        // 受理批写下了：反应批写失败不改这个事实（句柄进损坏状态，之后的写入都得 log-broken）。别的异常照旧交给调用方。
        let reactionsBroken = false;
        try {
            await reactToWritten(core, written, host.react);
        } catch (error) {
            if (!(error instanceof LogBrokenError)) throw error;
            reactionsBroken = true;
        } finally {
            outcome.committed?.();
        }
        const done = {ok: true, value: outcome.value, seq: written.at(-1)!.seq, replayed: false} as CommandResult<K>;
        // 反应批写失败：句柄坏了，需要健康会话的收尾都不做、不开运行。应答的回执已由日志定下（重发、重开都说成功），照实交回；
        // 别的指令照旧交回 log-broken（重发得到成功的不一致是原有的，runtime.md 已知限制）。
        if (reactionsBroken) return outcome.committed !== undefined ? done : {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
        await outcome.written?.();
        // 写下之后关闭才开始的：不开运行，已写下的 runStarted 由重开时的恢复收口（runtime.md 输出 104）。
        if (outcome.launch !== undefined && !host.closed()) host.control.launch(outcome.launch, outcome.launchOptions);
        after = outcome.after;
        return done;
    });
    if (result === AFTER_REASSEMBLY) {
        await waitFor;
        return accept(host, name, args, decide);
    }
    if (after !== undefined) await after();
    return result;
}

/** 指令参数（去掉 `commandId`）的哈希：重发同一个 `commandId` 时核对是不是同一条指令。 */
function argsHashOf(args: {commandId: string}): string {
    const {commandId: _commandId, ...rest} = args;
    return sha256(canonicalJson(rest));
}

/**
 * 重发：同名、同参数交回第一次的结果；名字或参数不同说明调用方把 `commandId` 用重了，得 `command-id-conflict`，
 * 不当成重发（否则第二条指令静默地拿到第一条的结果）。早先写下的受理记录没有参数哈希，只比名字。
 */
function replay(previous: {name: string; value: JsonValue; seq: number; argsHash?: string}, name: string, argsHash: string): {ok: true; value: never; seq: number; replayed: true} | {ok: false; code: "command-id-conflict"} {
    if (previous.name !== name || (previous.argsHash !== undefined && previous.argsHash !== argsHash)) return {ok: false, code: "command-id-conflict"};
    return {ok: true, value: previous.value as never, seq: previous.seq, replayed: true};
}

export const isEmpty = (input: UserInput): boolean => input.text.trim() === "" && (input.attachments?.length ?? 0) === 0;

/** 开始运行前就能判定的失败：只读、解析不到模型（码原样交回，见 `ModelResolutionCode`）。 */
export function startProblem(host: CommandHost): string | null {
    if (host.readOnly() !== null) return "read-only";
    const resolution = host.models.resolve({settings: host.core.session.kernel.core, purpose: "turn", profile: host.core.assembly.profile.id});
    return resolution.ok ? null : resolution.code;
}

const USER: Issuer = {kind: "user"};

/** 接着跑暂停的运行时写的事件（runtime.md 输出 36）。 */
const resumedDraft = (runId: string, issuer: Issuer): EventDraft => ({type: "runResumed", kind: "ctrl", scope: "session", data: {runId, ...byField(issuer)} as JsonValue});

/** 叶子上暂停的运行与它的开启者（旧日志没有 `by` 时是用户）。 */
function pausedRun(host: CommandHost): {runId: string; by: Issuer} | null {
    const runId = host.control.paused;
    return runId === null ? null : {runId, by: host.core.leafState.kernel.runBy ?? USER};
}

/** `replaces` 的条件写入（输出 107）：每条要还在、改过的次数对得上、是这个发出者能移除的。 */
function replaceDrafts(core: SessionCore, issuer: Issuer, replaces: readonly {id: string; edits: number}[], replacedBy: string): {drafts: EventDraft[]} | {fail: "input-stale" | "not-allowed"} {
    const drafts: EventDraft[] = [];
    for (const target of replaces) {
        const item = core.session.kernel.buffer.find((entry) => entry.id === target.id);
        if (item === undefined || item.edits !== target.edits) return {fail: "input-stale"};
        if (!canRemove(item, issuer)) return {fail: "not-allowed"};
        drafts.push({type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: item.id, reason: "replaced", replacedBy, ...byField(issuer)} as JsonValue});
    }
    return {drafts};
}

type Delivered = {value: {inputId: string; runId: string | null; currentRunId?: string; placement: Placement}; drafts: EventDraft[]; launch?: string; written?: () => Promise<void>};

/**
 * 送一条新话（`send` 与用户的 `enqueue`，输出 2、3、105、110）：先替换、再放行这个发出者能放行的，再写新话；空闲时开运行
 * （或接着跑叶子上能接着跑的暂停的运行），运行不再取输入时推迟到收口。
 */
type DeliverArgs = {commandId: string; input: UserInput; mode: InputMode; release?: ReleaseMode; replaces?: readonly {id: string; edits: number}[]};

async function deliver(host: CommandHost, issuer: Issuer, args: DeliverArgs): Promise<Delivered | {fail: string; detail?: Attributed}> {
    const intercepted = await interceptInput(host, args.input);
    if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
    return deliverIntercepted(host, issuer, args, intercepted);
}

async function deliverIntercepted(host: CommandHost, issuer: Issuer, args: DeliverArgs, intercepted: Extract<Awaited<ReturnType<typeof interceptInput>>, {ok: true}>): Promise<Delivered | {fail: string; detail?: Attributed}> {
    const {core, control} = host;
    // 拦截之后再看运行：拦截在等的时候 `abort`（不经队列）可能已经受理，之前读的就过期了。
    const active = control.active;
    const window = active !== null && !control.takesInput;
    const paused = active === null ? pausedRun(host) : null;
    const resumable = paused !== null && canContinue(paused.by, null, issuer);
    if (active === null && (paused === null || resumable)) {
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
    }
    const inputId = core.newId();
    const replaced = replaceDrafts(core, issuer, args.replaces ?? [], inputId);
    if ("fail" in replaced) return replaced;
    const mode = args.release ?? "keep";
    if (paused !== null && !resumable) {
        // 不能接着跑叶子上别人的暂停的运行：话按空闲时排的留着，不放行、不开运行（输出 36）。
        const queued: EventDraft = {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode, issuer, {commandId: args.commandId, held: {queued: "idle"}})};
        return {value: {inputId, runId: null, currentRunId: paused.runId, placement: "held"}, drafts: [...intercepted.failed, ...replaced.drafts, queued]};
    }
    const queued: EventDraft = {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode, issuer, {commandId: args.commandId})};
    if (window) {
        // 运行不再取输入（只压缩、停止中）：话照常排进去，放行与开运行推迟到收口批（输出 104）。
        return {value: {inputId, runId: null, currentRunId: active.runId, placement: "later"}, drafts: [...intercepted.failed, ...replaced.drafts, queued], written: async () => control.defer({issuer, mode, inputIds: [inputId]})};
    }
    const before = [...intercepted.failed, ...replaced.drafts];
    const released = releaseDrafts(projectSession(core.session.kernel, before, core.head).buffer, issuer, mode);
    const drafts = [...before, ...released.drafts, queued];
    if (active !== null) return {value: {inputId, runId: null, currentRunId: active.runId, placement: "taken"}, drafts};
    if (paused !== null) return {value: {inputId, runId: paused.runId, placement: "taken"}, drafts: [...drafts, resumedDraft(paused.runId, issuer)], launch: paused.runId};
    // 放行出来的排在新话前面：取投影后就绪的第一条开第一轮（输出 2）。
    const opened = openRunDrafts(core, projectSession(core.session.kernel, drafts, core.head).buffer, issuer)!;
    return {value: {inputId, runId: opened.runId, placement: "taken"}, drafts: [...drafts, ...opened.drafts], launch: opened.runId};
}

/** `settlePending` 结算时写的应答：用户的话只进对话一次，拒绝只带这句固定的说明（runtime.md 输出 111）。 */
const SETTLED_BY_MESSAGE = {decision: "deny", note: "用户发了新消息"} as const;

export async function sendCommand(host: CommandHost, issuer: Issuer, args: CommandMap["send"]["args"] & {commandId: string}): Promise<CommandResult<"send">> {
    // 认领到、但受理没走完的事项：受理之后交还或叫醒（`releaseClaims`），不留悬空的等待。
    let claims: Map<string, Claim> | null = null;
    const result = await accept(host, "send", args, async (): Promise<Outcome<"send">> => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        // 重发在 `decide` 之前按 commandId 交回原结果，不比较发出者（runtime.md 输出 111）。
        if (args.settlePending !== undefined && issuer.kind !== "user") return {fail: "not-allowed"};
        const delivered = await deliver(host, issuer, {...args, mode: args.mode ?? "followup"});
        if ("fail" in delivered || args.settlePending === undefined) return delivered;
        // 前面的检查都过了才认领：认领之后中止那一方就不再结算这些事项。中止已经摘走的（取不到）由它结算，这里跳过。
        const taken = new Map<string, Claim>();
        const settled: EventDraft[] = [];
        for (const item of host.core.leafState.kernel.pending) {
            if (item.async) continue;
            const claim = host.control.interactions.take(item.id);
            if (claim === undefined) continue;
            taken.set(item.id, claim);
            settled.push(ctrl("interactionResolved", {id: item.id, ...SETTLED_BY_MESSAGE, by: issuer}));
        }
        claims = taken;
        // 没有认领到事项：等于不带 settlePending（输出 111），回执也照普通发话（输出 119 只管真结算了事项的应答）。
        if (taken.size === 0) return delivered;
        const resolution = {...SETTLED_BY_MESSAGE, by: issuer};
        return {...delivered, drafts: [...settled, ...delivered.drafts], committed: () => {
            claims = null;
            for (const claim of taken.values()) claim.wake(resolution);
        }};
    });
    if (claims !== null) releaseClaims(host.core, claims);
    return result;
}

export function enqueueCommand(host: CommandHost, issuer: Issuer, args: CommandMap["enqueue"]["args"] & {commandId: string}): Promise<CommandResult<"enqueue">> {
    return accept(host, "enqueue", args, async (): Promise<Outcome<"enqueue">> => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        if (host.readOnly() !== null) return {fail: "read-only"};
        const {core, control} = host;
        const position = core.session.kernel.buffer.length;
        if (issuer.kind !== "user") {
            const intercepted = await interceptInput(host, args.input);
            if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
            // 拦截之后再看运行（同 `deliver`）：有运行在取输入时只入队，交给 `deliver`。
            if (control.active !== null && control.takesInput) {
                const delivered = await deliverIntercepted(host, issuer, args, intercepted);
                if ("fail" in delivered) return delivered;
                const {inputId, currentRunId, placement} = delivered.value;
                return {...delivered, value: {inputId, position, placement, ...(currentRunId === undefined ? {} : {currentRunId})}};
            }
            // 会话、宿主空闲时（含运行不再取输入）排的：留着，不放行、不开运行（输出 3）。
            const inputId = core.newId();
            const current = control.active?.runId ?? control.paused ?? undefined;
            return {value: {inputId, position, placement: "held", ...(current === undefined ? {} : {currentRunId: current})}, drafts: [...intercepted.failed, {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, args.mode, issuer, {commandId: args.commandId, held: {queued: "idle"}})}]};
        }
        // 用户空闲时排的等于发送；有运行在取输入时只入队（输出 3）。
        const delivered = await deliver(host, issuer, args);
        if ("fail" in delivered) return delivered;
        const {inputId, runId, currentRunId, placement} = delivered.value;
        return {...delivered, value: {inputId, position, placement, ...(runId === null ? {} : {runId}), ...(currentRunId === undefined ? {} : {currentRunId})}};
    });
}

/** 叶子上能接着跑的已收口运行（中断、出错、停止在一轮当中），或暂停的运行；交回接着跑要写的事件。 */
function continueDrafts(host: CommandHost, issuer: Issuer, which: "any" | "interrupted"): {runId: string; drafts: EventDraft[]; launch: string} | {fail: "not-allowed"} | null {
    const {core} = host;
    const paused = pausedRun(host);
    if (paused !== null) {
        if (!canContinue(paused.by, null, issuer)) return {fail: "not-allowed"};
        return {runId: paused.runId, drafts: [resumedDraft(paused.runId, issuer)], launch: paused.runId};
    }
    const last = continuableEnded(core.leafState.kernel.lastChat);
    if (last === null || (which === "interrupted" && last.end !== "interrupted")) return null;
    if (!canContinue(last.by, last.stoppedBy, issuer)) return {fail: "not-allowed"};
    const runId = core.newId();
    return {runId, launch: runId, drafts: [ctrl("runStarted", {runId, kind: "chat", ...byField(issuer)}), ctrl("turnStarted", {turnId: core.newId(), inputId: null})]};
}

export function startCommand(host: CommandHost, issuer: Issuer, args: CommandMap["start"]["args"] & {commandId: string}): Promise<CommandResult<"start">> {
    return accept(host, "start", args, () => {
        const {core, control} = host;
        if (!control.idle) return {fail: "already-running"};
        // 接着跑叶子上没有正常结束的那一轮，不取留着的话（输出 4）。
        const continued = continueDrafts(host, issuer, "any");
        if (continued !== null && "fail" in continued) return continued;
        if (continued !== null) {
            const problem = startProblem(host);
            if (problem !== null) return {fail: problem};
            return {value: {runId: continued.runId}, drafts: continued.drafts, launch: continued.launch};
        }
        // 只有升级前的旧日志会有空闲会话里就绪的话：取走第一条开一轮。
        const opened = openRunDrafts(core, core.session.kernel.buffer, issuer);
        if (opened === null) return {fail: "nothing-to-continue"};
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        return {value: {runId: opened.runId}, drafts: opened.drafts, launch: opened.runId};
    });
}

/** 空闲时放行（`resume`、`release`，输出 106、107）：先接着跑能接着跑的中断或暂停的运行，否则用放行出来的开新运行。 */
function releaseWhileIdle<K extends "resume" | "release">(host: CommandHost, issuer: Issuer, released: {drafts: EventDraft[]; ids: string[]}, nothing: "nothing-to-resume" | "nothing-to-release"): Outcome<K> {
    const {core} = host;
    const continued = continueDrafts(host, issuer, "interrupted");
    if (continued !== null && "fail" in continued && pausedRun(host) !== null) return continued;
    if (continued !== null && !("fail" in continued)) {
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        return {value: {runId: continued.runId, released: released.ids}, drafts: [...released.drafts, ...continued.drafts], launch: continued.launch};
    }
    if (released.ids.length === 0) {
        // 用户的“继续”在只有待发的提醒时也开一次运行，带上它们（runtime.md 输出 114）：门关着时这是用户让提醒送出去的办法。
        if (nothing === "nothing-to-resume" && issuer.kind === "user" && core.session.kernel.notices.length > 0 && pausedRun(host) === null) {
            const problem = startProblem(host);
            if (problem !== null) return {fail: problem};
            const runId = core.newId();
            return {value: {runId, released: []}, drafts: [ctrl("runStarted", {runId, kind: "chat"})], launch: runId};
        }
        return {fail: blockedByUser(core.session.kernel.buffer, issuer) ? "held-by-user" : nothing};
    }
    const problem = startProblem(host);
    if (problem !== null) return {fail: problem};
    const opened = openRunDrafts(core, projectSession(core.session.kernel, released.drafts, core.head).buffer, issuer);
    if (opened === null) return {value: {runId: null, released: released.ids}, drafts: released.drafts};
    return {value: {runId: opened.runId, released: released.ids}, drafts: [...released.drafts, ...opened.drafts], launch: opened.runId};
}

export function resumeCommand(host: CommandHost, issuer: Issuer, args: CommandMap["resume"]["args"] & {commandId: string}): Promise<CommandResult<"resume">> {
    return accept(host, "resume", args, () => {
        const {core, control} = host;
        const mode = args.mode ?? "keep";
        // 运行不再取输入：放行推迟到收口（交回的 released 为空）；只有用户留下的话、发出者又不是用户时现在就拒绝（输出 104、106）。
        if (control.active !== null && !control.takesInput) {
            if (blockedByUser(core.session.kernel.buffer, issuer)) return {fail: "held-by-user"};
            return {value: {runId: null, released: []}, drafts: [], written: async () => control.defer({issuer, mode, inputIds: []})};
        }
        const released = releaseDrafts(core.session.kernel.buffer, issuer, mode);
        if (control.active === null) return releaseWhileIdle<"resume">(host, issuer, released, "nothing-to-resume");
        if (released.ids.length === 0) return {fail: blockedByUser(core.session.kernel.buffer, issuer) ? "held-by-user" : "nothing-to-resume"};
        return {value: {runId: null, released: released.ids}, drafts: released.drafts};
    });
}

export function releaseCommand(host: CommandHost, issuer: Issuer, args: CommandMap["release"]["args"] & {commandId: string}): Promise<CommandResult<"release">> {
    return accept(host, "release", args, (): Outcome<"release"> => {
        const {core, control} = host;
        const buffer = core.session.kernel.buffer;
        const items = args.inputIds.map((id) => buffer.find((entry) => entry.id === id && entry.state === "held"));
        const missing = args.inputIds.filter((_id, index) => items[index] === undefined);
        if (args.inputIds.length === 0 || missing.length > 0) return {fail: "nothing-to-release", detail: {ids: missing}};
        if (issuer.kind !== "user") {
            if (items.some((item) => item!.heldBy?.kind === "user")) return {fail: "held-by-user"};
            if (items.some((item) => !sameIssuer(ownerOf(item!), issuer))) return {fail: "not-allowed"};
        }
        if (control.active !== null && !control.takesInput) return {value: {runId: null, released: []}, drafts: [], written: async () => control.defer({issuer, mode: "keep", inputIds: [], only: args.inputIds})};
        const released = releaseDrafts(buffer, issuer, "keep", args.inputIds);
        if (control.active === null) return releaseWhileIdle<"release">(host, issuer, released, "nothing-to-release");
        return {value: {runId: null, released: released.ids}, drafts: released.drafts};
    });
}

/** 进行中与已完成的中止，按 `commandId`：中止不经队列，重发可能在第一次还没写下受理记录时就到。 */
const aborting = new WeakMap<SessionCore, Map<string, Promise<CommandResult<"abort">>>>();

/**
 * 中止（输出 30）：权限判定、读下范围、触发信号在同一个同步步骤里；受理记录与清空或留着由收口批写下（`settle.ts`）。
 * 没有运行、或这次运行已在组收口批时 `aborted: false`、不写日志。重发同一个 `commandId`（重开之后也一样）交回第一次的结果。
 */
export function abortCommand(host: CommandHost, issuer: Issuer, args: CommandMap["abort"]["args"] & {commandId: string}): Promise<CommandResult<"abort">> {
    const {core, control} = host;
    const argsHash = argsHashOf(args);
    const previous = core.commands.get(args.commandId);
    if (previous !== undefined) return Promise.resolve(replay(previous, "abort", argsHash) as CommandResult<"abort">);
    const inflight = aborting.get(core) ?? new Map<string, Promise<CommandResult<"abort">>>();
    aborting.set(core, inflight);
    const running = inflight.get(args.commandId);
    if (running !== undefined) return running.then((result) => (result.ok ? {...result, replayed: true} : result));
    // 句柄坏了：新的停止写不下受理记录，不登记、不中止（损坏时运行已经停了）。已提交的键在上面按记录重放。
    if (core.broken) return Promise.resolve({ok: false, code: "log-broken"} as CommandResult<"abort">);
    // 点名的那次运行已经不在跑（收口了，或已是下一次）：什么都不动（runtime.md 输出 120）。
    if (args.runId !== undefined && control.active?.runId !== args.runId) return Promise.resolve({ok: true, value: {aborted: false}, seq: core.head, replayed: false});
    if (control.active !== null && !canAbort(core.header, core.leafState.kernel.runBy ?? USER, issuer)) return Promise.resolve({ok: false, code: "not-allowed"} as CommandResult<"abort">);
    const settled = control.recordStop({by: issuer, keep: args.keepQueue === true, scope: core.session.kernel.buffer.map((item) => item.id)}, {commandId: args.commandId, argsHash});
    if (settled === null) return Promise.resolve({ok: true, value: {aborted: false}, seq: core.head, replayed: false});
    const first = (async (): Promise<CommandResult<"abort">> => {
        void control.abort();
        const seq = await settled;
        return {ok: true, value: {aborted: true}, seq, replayed: false};
    })();
    inflight.set(args.commandId, first);
    return first;
}

/** 缓冲区里的这条还在不在：不在时分清是从没入过队（`input-not-found`），还是已经取走或删掉（`input-consumed`）。 */
function bufferProblem(core: SessionCore, inputId: string): "input-not-found" | "input-consumed" | null {
    if (core.session.kernel.buffer.some((item) => item.id === inputId)) return null;
    return core.events.some((event) => event.type === "inputQueued" && (event.data as {id: string}).id === inputId) ? "input-consumed" : "input-not-found";
}

export function editCommand(host: CommandHost, issuer: Issuer, args: CommandMap["edit"]["args"] & {commandId: string}): Promise<CommandResult<"edit">> {
    return accept(host, "edit", args, async () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        const problem = bufferProblem(host.core, args.inputId);
        if (problem !== null) return {fail: problem};
        // 只能改自己排的；条目的发出者不变（输出 29、108）。
        const item = host.core.session.kernel.buffer.find((entry) => entry.id === args.inputId)!;
        if (!canEdit(item, issuer)) return {fail: "not-allowed"};
        const intercepted = await interceptInput(host, args.input);
        if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
        const data = queuedData(args.inputId, intercepted, "followup", USER) as Record<string, JsonValue>;
        const {mode: _mode, ...edited} = data;
        return {value: {}, drafts: [...intercepted.failed, {type: "inputEdited", kind: "ctrl", scope: "session", data: edited}]};
    });
}

export function removeCommand(host: CommandHost, issuer: Issuer, args: CommandMap["remove"]["args"] & {commandId: string}): Promise<CommandResult<"remove">> {
    return accept(host, "remove", args, () => {
        const problem = bufferProblem(host.core, args.inputId);
        if (problem !== null) return {fail: problem};
        const item = host.core.session.kernel.buffer.find((entry) => entry.id === args.inputId)!;
        if (!canRemove(item, issuer)) return {fail: "not-allowed"};
        return {value: {}, drafts: [{type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: args.inputId, reason: "cancelled", ...byField(issuer)} as JsonValue}]};
    });
}

/**
 * 提醒的上限（runtime.md 输出 112）。合计按编码后的整条记录算（含发出者与留在待发记录里的 `commandId`），快照与远程的大小因此
 * 有界：会话待发的提醒不会撑到窗口取不到快照、也就没处取消。
 */
export const NOTICE_TEXT_MAX_BYTES = 32 * 1024;
export const NOTICE_KEY_MAX_CHARS = 200;
export const NOTICE_MAX_PENDING = 64;
export const NOTICE_TOTAL_MAX_BYTES = 128 * 1024;

/** 一条待发提醒按合计上限算的字节数：`noticeQueued` 里留下的整条记录（不含按 seq 补的 `queuedAt`）。 */
export const noticeBytes = (notice: Omit<PendingNotice, "queuedAt">): number =>
    Buffer.byteLength(JSON.stringify({id: notice.id, by: notice.by, key: notice.key, text: notice.text, wake: notice.wake, commandId: notice.commandId, senderOnly: notice.senderOnly}), "utf8");

/** 唤起里与提醒无关的条件（runtime.md 输出 116）：空闲、门开着、叶子上没有暂停的运行、开得起运行。收口批另按运行控制的检查判。 */
const canWake = (host: CommandHost): boolean => host.control.idle && gateOpen(host.core) && pausedRun(host) === null && startProblem(host) === null;

export function noticeCommand(host: CommandHost, issuer: Issuer, args: CommandMap["notice"]["args"] & {commandId: string}): Promise<CommandResult<"notice">> {
    return accept(host, "notice", args, () => {
        if (issuer.kind === "user") return {fail: "not-allowed"};
        if (args.text.trim() === "") return {fail: "empty-input"};
        if (Buffer.byteLength(args.text, "utf8") > NOTICE_TEXT_MAX_BYTES || (args.key !== undefined && args.key.length > NOTICE_KEY_MAX_CHARS)) return {fail: "notice-too-large"};
        const pending = host.core.session.kernel.notices;
        // 同一个发出者的同一个 `key` 替换还没取走的那条；上限按扣掉它之后算。
        const replaced = args.key === undefined ? undefined : pending.find((item) => item.key === args.key && sameIssuer(item.by, issuer));
        const rest = replaced === undefined ? pending : pending.filter((item) => item !== replaced);
        const record = {id: host.core.newId(), by: issuer, ...(args.key === undefined ? {} : {key: args.key}), text: args.text, wake: args.wake === true, commandId: args.commandId, ...(args.senderOnly === true ? {senderOnly: true as const} : {})};
        const total = rest.reduce((sum, item) => sum + noticeBytes(item), noticeBytes(record));
        if (rest.length + 1 > NOTICE_MAX_PENDING || total > NOTICE_TOTAL_MAX_BYTES) return {fail: "notice-budget"};
        const drafts: EventDraft[] = [];
        if (replaced !== undefined) drafts.push({type: "noticeRemoved", kind: "ctrl", scope: "session", data: {ids: [replaced.id], ...byField(issuer), reason: "replaced"} as JsonValue});
        drafts.push({type: "noticeQueued", kind: "ctrl", scope: "session", data: record as unknown as JsonValue});
        const value = {noticeId: record.id, ...(replaced === undefined ? {} : {replaced: replaced.id})};
        // 唤起（输出 116）：空闲、门开着、叶子上没有暂停的运行、开得起运行时同一批开运行。运行不再取输入的窗口里不判，留给收口批。
        if (!record.wake || !canWake(host)) return {value, drafts};
        const wake = wakeRunDrafts(host.core, firstWake(rest)?.by ?? issuer);
        return {value, drafts: [...drafts, ...wake.drafts], launch: wake.runId};
    });
}

/**
 * 唤起的判定点之一：重新装配做完、会话回到能开运行时（runtime.md 输出 116）。另两处在 `notice` 的受理与收口批里。判与写在单写者
 * 队列的同一项里；写失败时句柄进损坏状态，不再开运行。
 */
export async function wakeIfDue(host: CommandHost): Promise<void> {
    const {core} = host;
    // 没有带唤起的提醒就不必排队；排进去之后再按当时的状态判一次。
    if (!hasWake(core.session.kernel.notices)) return;
    await core.queue.run(async () => {
        if (host.closed() || core.broken) return;
        const wake = firstWake(core.session.kernel.notices);
        if (wake === undefined || !canWake(host)) return;
        const woken = wakeRunDrafts(core, wake.by);
        try {
            await writeAndReact(core, woken.drafts, host.react);
        } catch (error) {
            if (error instanceof LogBrokenError) return;
            throw error;
        }
        if (!host.closed()) host.control.launch(woken.runId);
    });
}

/** 这条提醒有没有被取走过：取走的与从没发过的给不同的码（runtime.md 输出 112）。 */
const noticeTaken = (core: SessionCore, id: string): boolean => core.events.some((event) => event.type === "noticeTaken" && (event.data as {ids: readonly string[]}).ids.includes(id));

export function removeNoticeCommand(host: CommandHost, issuer: Issuer, args: CommandMap["removeNotice"]["args"] & {commandId: string}): Promise<CommandResult<"removeNotice">> {
    return accept(host, "removeNotice", args, () => {
        const item = host.core.session.kernel.notices.find((notice) => notice.id === args.noticeId);
        if (item === undefined) return {fail: noticeTaken(host.core, args.noticeId) ? "notice-taken" : "notice-not-found"};
        // 只有发出者能撤回的（后台任务的回执，runtime.md 输出 112）：用户也不行。
        if (item.senderOnly === true ? !sameIssuer(item.by, issuer) : !canRemove(item, issuer)) return {fail: "not-allowed"};
        return {value: {}, drafts: [{type: "noticeRemoved", kind: "ctrl", scope: "session", data: {ids: [item.id], ...byField(issuer), reason: issuer.kind === "user" ? "cancelled" : "withdrawn"} as JsonValue}]};
    });
}

export function setTitleCommand(host: CommandHost, args: CommandMap["setTitle"]["args"] & {commandId: string}): Promise<CommandResult<"setTitle">> {
    return accept(host, "setTitle", args, () => {
        const title = args.title.trim();
        if (title === "") return {fail: "empty-title"};
        return {value: {}, drafts: [{type: "titleChanged", kind: "ctrl", scope: "session", data: {title, by: "user"}}]};
    });
}

export function setGeneratedMetaCommand(host: CommandHost, args: CommandMap["setGeneratedMeta"]["args"] & {commandId: string}): Promise<CommandResult<"setGeneratedMeta">> {
    return accept(host, "setGeneratedMeta", args, () => {
        const title = args.title?.trim() ?? "";
        const description = args.description?.trim() ?? "";
        if (title === "" && description === "") return {fail: "empty-meta"};
        // 在受理的队列项里判断：用户的 `setTitle` 不会夹在判断与写入之间，晚到的自动结果盖不掉它。
        const titleApplied = title !== "" && host.core.session.kernel.titleBy !== "user";
        const drafts: EventDraft[] = [];
        if (titleApplied) drafts.push({type: "titleChanged", kind: "ctrl", scope: "session", data: {title, by: "auto"}});
        if (description !== "") drafts.push({type: "descriptionChanged", kind: "ctrl", scope: "session", data: {description}});
        return {value: {titleApplied}, drafts};
    });
}

export function archiveCommand(host: CommandHost, args: CommandMap["archive"]["args"] & {commandId: string}): Promise<CommandResult<"archive">> {
    return accept(host, "archive", args, () => ({value: {}, drafts: [{type: "archived", kind: "ctrl", scope: "session", data: {archived: args.archived}}]}));
}

/**
 * 改设置：整体校验，每个扩展一条 `settingsChanged`，受理时就写。运行中受理的也立刻写：模型按每次请求时的核心设置解析、
 * 视图只在算请求时读设置，所以效果就是“下一次请求前生效”（`scheduled: "next-boundary"`）。值没变的项不写。
 */
export function changeSettingsCommand(host: CommandHost, args: CommandMap["changeSettings"]["args"] & {commandId: string}): Promise<CommandResult<"changeSettings">> {
    return accept(host, "changeSettings", args, () => {
        const {core} = host;
        const problem = settingsProblem(core.assembly, args.patch);
        if (problem !== null) {
            const {code, ...detail} = problem;
            return {fail: code, ...(code === "unknown-extension" ? {} : {detail: detail as Record<string, JsonValue>})};
        }
        const drafts: EventDraft[] = [];
        const changed: string[] = [];
        for (const [extension, values] of Object.entries(args.patch)) {
            // 扩展的组按生效值比：缺省值合并用户改过的（与视图读到的一样），提交与缺省相同的值不算变化。
            const item = core.assembly.order.find((entry) => entry.definition.id === extension);
            const current = (extension === "core" ? core.session.kernel.core : {...(item === undefined ? {} : defaultSettings(item.definition)), ...core.session.kernel.settings[extension]}) as Record<string, unknown>;
            const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
            if (Object.keys(patch).length === 0) continue;
            changed.push(extension);
            drafts.push({type: "settingsChanged", kind: "ctrl", scope: "session", data: {extension, patch}});
        }
        return {value: {changed, scheduled: host.control.idle ? "now" : "next-boundary"}, drafts};
    });
}
