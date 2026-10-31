/**
 * 指令（提案第 3 节）。每条被受理的指令在受理批里写 `commandAccepted{commandId, name, value}`，重发同一个 `commandId`
 * 返回第一次的 `value` 与 `replayed: true`；校验失败不写，重发重新校验（session.md 输出 17）。
 * `value` 引用的 id 都在受理批里写出：空闲时会开始运行的指令，受理批就含 `runStarted`（输出 18）。
 *
 * 受理（校验加写）在队列的一项里做，所以两条指令的校验看到的状态不会交错。这一版有 `send`、`enqueue`、`start`、`abort`；
 * 其余指令随后续切片加入。
 */

import type {CommandMap, CommandName, CommandResult, InputMode, JsonValue, ModelPort, UserInput} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import type {RunControl} from "./control.js";
import {takeInputDrafts} from "./loop.js";
import {writeAndReact, type ReactHost} from "../dispatch/reactions.js";

export interface CommandHost {
    readonly core: SessionCore;
    readonly react: ReactHost;
    readonly control: RunControl;
    readonly models: ModelPort;
    /** 会话为什么只读；可写时为 null。 */
    readOnly(): string | null;
}

type Outcome<K extends CommandName> = {value: CommandMap[K]["value"]; drafts: EventDraft[]; launch?: string} | {fail: string};

/** 受理一条指令：查重发、校验、写受理批、需要时开始运行。 */
async function accept<K extends CommandName>(host: CommandHost, name: K, commandId: string, decide: () => Outcome<K>): Promise<CommandResult<K>> {
    const {core} = host;
    return core.queue.run(async () => {
        const previous = core.commands.get(commandId);
        if (previous !== undefined) return {ok: true, value: previous.value as CommandMap[K]["value"], seq: previous.seq, replayed: true} as CommandResult<K>;
        if (core.broken) return {ok: false, code: "log-broken"} as unknown as CommandResult<K>;
        const outcome = decide();
        if ("fail" in outcome) return {ok: false, code: outcome.fail} as unknown as CommandResult<K>;
        const accepted: EventDraft = {type: "commandAccepted", kind: "ctrl", scope: "session", data: {commandId, name, value: outcome.value as JsonValue}};
        // commandAccepted 排在批的最后：它的 seq 就是受理批最后一条的 seq，重发时原样交回。
        const {events: written} = await writeAndReact(core, [...outcome.drafts, accepted], host.react);
        if (outcome.launch !== undefined) host.control.launch(outcome.launch);
        return {ok: true, value: outcome.value, seq: written.at(-1)!.seq, replayed: false} as CommandResult<K>;
    });
}

const isEmpty = (input: UserInput): boolean => input.text.trim() === "" && (input.attachments?.length ?? 0) === 0;

/** 开始运行前就能判定的失败：只读、没有模型、没有凭据。 */
function startProblem(host: CommandHost): string | null {
    if (host.readOnly() !== null) return "read-only";
    const resolution = host.models.resolve(host.core.session.kernel.core, "turn");
    if (resolution.ok) return null;
    return resolution.code === "no-credentials" ? "no-credentials" : "no-model";
}

function queuedDraft(id: string, input: UserInput, mode: InputMode): EventDraft {
    return {type: "inputQueued", kind: "ctrl", scope: "session", data: {id, input: input as unknown as JsonValue, mode}};
}

export function sendCommand(host: CommandHost, args: CommandMap["send"]["args"] & {commandId: string}): Promise<CommandResult<"send">> {
    return accept(host, "send", args.commandId, () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        const {core, control} = host;
        const inputId = core.newId();
        const queued = queuedDraft(inputId, args.input, args.mode ?? "followup");
        if (!control.idle) return {value: {inputId, runId: null}, drafts: [queued]};
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        const runId = core.newId();
        // 受理批先把输入放进缓冲区，再取走它开第一轮；崩溃在这之后由恢复结算这次运行。
        const started: EventDraft = {type: "runStarted", kind: "ctrl", scope: "path", data: {runId, kind: "chat"}};
        return {value: {inputId, runId}, drafts: [queued, started, ...takeInputDrafts(inputId, args.input, core.newId())], launch: runId};
    });
}

export function enqueueCommand(host: CommandHost, args: CommandMap["enqueue"]["args"] & {commandId: string}): Promise<CommandResult<"enqueue">> {
    return accept(host, "enqueue", args.commandId, () => {
        if (isEmpty(args.input)) return {fail: "empty-input"};
        if (host.readOnly() !== null) return {fail: "read-only"};
        const inputId = host.core.newId();
        return {value: {inputId, position: host.core.session.kernel.buffer.length}, drafts: [queuedDraft(inputId, args.input, args.mode)]};
    });
}

export function startCommand(host: CommandHost, args: CommandMap["start"]["args"] & {commandId: string}): Promise<CommandResult<"start">> {
    return accept(host, "start", args.commandId, () => {
        const {core, control} = host;
        if (!control.idle) return {fail: "already-running"};
        const problem = startProblem(host);
        if (problem !== null) return {fail: problem};
        const runId = core.newId();
        const started: EventDraft = {type: "runStarted", kind: "ctrl", scope: "path", data: {runId, kind: "chat"}};
        const next = core.session.kernel.buffer[0];
        if (next !== undefined) return {value: {runId}, drafts: [started, ...takeInputDrafts(next.id, next.input, core.newId())], launch: runId};
        // 缓冲区空：没有新输入的“继续”运行；末尾已经是完整的回复时没什么可继续的。
        const history = core.leafState.kernel.history;
        const last = history.current ?? (history.committed === null ? null : history.committed.head);
        if (last === null || last.status === "completed") return {fail: "nothing-to-continue"};
        return {value: {runId}, drafts: [started, {type: "turnStarted", kind: "ctrl", scope: "path", data: {turnId: core.newId(), inputId: null}}], launch: runId};
    });
}

/** 中止不经队列：先触发信号，收口由运行循环作为队列里的一项写入。幂等：没有运行时 `aborted: false`。 */
export async function abortCommand(host: CommandHost): Promise<CommandResult<"abort">> {
    const aborted = await host.control.abort();
    return {ok: true, value: {aborted}, seq: host.core.head, replayed: false};
}
