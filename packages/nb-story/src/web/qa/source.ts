/**
 * 问答页里一个对话的数据源（docs/specs/story/viewer.md 的问答页）：读记录与日志（`qa.get`），有运行时订阅推送，合成
 * 对话视图的消息。一个对话一个：换对话时调用方 `dispose()` 旧的、建新的；每个异步回调先核对自己还是当前这一次加载。
 *
 * 状态从哪来：
 * - 记录与它的日志是权威。运行中这一轮的日志条目（推送的快照与 `log` 帧）接在后面，事件只画正在生成的那条（适配器
 *   `createHarnessTranscript` 的分工）。每一轮各用一份适配器（`turn-transcripts.ts`）。
 * - 运行开始时的记录轮数（`baseTurns`）或位置改动次数（`baseChanges`）与读到的记录对不上（命令行同时续问并先保存了，或位置被别处改了）：这一轮不接进来，只给
 *   `detached`，页面写明它不会保存。
 * - 运行已经结束并且保存了：它就在记录里，不再管它。结束了但没保存：订阅一次拿它的条目（服务端的快照带着），接在
 *   记录后面显示，页面写明没保存的原因。
 * - 看着运行结束（`ended` 帧）：重新 `qa.get`，换一份新的转录（适配器只进不退，结束后以记录为准）。
 * - 推送断开、或服务端因为积压断开：按 1、2、4…最多 15 秒退避，重新 `qa.get`；还是同一个运行在跑，就把新快照喂给
 *   原来的转录（条目按 seq 去重，已画的消息不闪），否则换新的。
 */

import type {MessageView} from "@notnotype/nb-agent-ui";

import {QA_FIRST_TURN_RUNNING, QA_FIRST_TURN_UNSAVED, type QaRecordView, type QaRunView, type ViewerResult} from "../../contract/contract";
import {StoryCallError, type StoryClient, type SubscriptionEnd} from "../host/client";
import {messagesFromRecord} from "./record-messages";
import {createTurnTranscripts, type TurnTranscripts} from "./turn-transcripts";
import {composeMessages, createMessageCache, replyCheckOf, type MessageCache, type TurnInfo} from "./turns";

export interface QaSourceState {
    readonly phase: "loading" | "ready" | "failed";
    /** `phase` 为 failed 时：读对话失败的码与说明（例如对话被删了）。 */
    readonly error: {readonly code: string; readonly message: string} | null;
    readonly record: QaRecordView | null;
    /** 服务里这个对话运行中或刚结束的一轮。 */
    readonly run: QaRunView | null;
    readonly continuable: ViewerResult<"qa.get">["continuable"];
    /** 会话日志读不成时的原因：只按记录显示，过程没有保留。 */
    readonly logProblem: string | null;
    /** 运行的这一轮基于较早的记录，不接在后面，结束后也不会保存。 */
    readonly detached: boolean;
    readonly messages: readonly MessageView[];
}

export interface QaSourceOptions {
    client: StoryClient;
    book: string;
    conversation: string;
    onChange(state: QaSourceState): void;
    /** 把一阵子到的帧合成一次更新；默认下一帧画面（requestAnimationFrame）。 */
    schedule?: (flush: () => void) => void;
    /** 定时；默认 setTimeout。返回取消的函数。 */
    setTimer?: (run: () => void, ms: number) => () => void;
}

export interface QaSource {
    state(): QaSourceState;
    /** 重新读（例如这个对话刚开始了新的一轮）。 */
    /** 读完（或失败、被下一次加载取代）时完成。 */
    refresh(): Promise<void>;
    dispose(): void;
}

const MAX_RETRY_MS = 15_000;

/** 第 n 次重连前等多久（n 从 0 数）。 */
export function retryDelay(attempt: number): number {
    return Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt);
}

/** 各轮在日志里的起点：记录的各轮加上接在后面的运行；有一轮没有 `logFrom`（旧记录）时为 null。 */
function turnStarts(record: QaRecordView | null, run: QaRunView | null): number[] | null {
    const starts: number[] = [];
    for (const turn of record?.turns ?? []) {
        if (turn.logFrom === undefined) return null;
        starts.push(turn.logFrom);
    }
    if (run !== null && !starts.includes(run.logFrom)) starts.push(run.logFrom);
    return starts.sort((a, b) => a - b);
}

/**
 * 看着运行结束时的 `continuable`。首轮运行中读到的是“第一轮还在运行”，而重读（`qa.get`，要带上剧透过滤）回来之前页面
 * 还会画这句，与实际相反（issue 269），所以结束帧一到就按结果换掉：保存了就能续问，没保存换成没保存的原因。
 * 已有记录的对话运行中本来就能续问，不动。
 */
function continuableAfterEnd(state: QaSourceState, ended: QaRunView): QaSourceState["continuable"] {
    if (state.continuable.ok || state.continuable.reason !== QA_FIRST_TURN_RUNNING) return state.continuable;
    return ended.saved?.ok === true ? {ok: true} : {ok: false, reason: QA_FIRST_TURN_UNSAVED};
}

const LOADING: QaSourceState = {phase: "loading", error: null, record: null, run: null, continuable: {ok: false, reason: ""}, logProblem: null, detached: false, messages: []};

export function createQaSource(options: QaSourceOptions): QaSource {
    const {client, book, conversation} = options;
    const schedule = options.schedule ?? (flush => void requestAnimationFrame(flush));
    const setTimer =
        options.setTimer ??
        ((run, ms) => {
            const timer = setTimeout(run, ms);
            return () => clearTimeout(timer);
        });

    let state: QaSourceState = LOADING;
    let disposed = false;
    /** 每次加载加一；回调核对它，过期的直接丢掉。 */
    let generation = 0;
    let transcript: TurnTranscripts = createTurnTranscripts(null);
    let cache: MessageCache = createMessageCache();
    /** 日志里的出处复查元数据（`seq` → 没读过的出处），随转录一起换。 */
    let replyChecks = new Map<number, readonly string[]>();
    function applyLogEntry(entry: unknown): void {
        const check = replyCheckOf(entry);
        if (check !== null) replyChecks.set(check.seq, check.refs);
        transcript.applyLogEntry(entry);
    }
    let subscription: {close(): void} | null = null;
    let cancelRetry: (() => void) | null = null;
    /** 连续重连了几次：订阅收到快照才清零（qa.get 成功而推送一连就断时，间隔照样变长）。 */
    let attempts = 0;
    /**
     * 看着结束并保存了、还没重读到记录的那一轮：重读回来之前照样接在记录后面，这一轮的消息不并进上一轮、提问 id 不变
     * （turns.ts 的“同一个 id”）。
     */
    let settling: string | null = null;
    let scheduled = false;

    function emit(): void {
        if (!disposed) options.onChange(state);
    }

    /** 运行的这一轮要不要接在记录后面。 */
    function attachedRun(record: QaRecordView | null, run: QaRunView | null): QaRunView | null {
        if (run === null) return null;
        if (run.state === "ended" && run.saved?.ok === true && run.runId !== settling) return null;
        return run.baseTurns === (record?.turns.length ?? 0) && run.baseChanges === (record?.positionChanges ?? 0) ? run : null;
    }

    function messagesOf(next: QaSourceState): readonly MessageView[] {
        if (next.phase !== "ready") return [];
        const turns = next.record?.turns ?? [];
        if (next.logProblem !== null) return messagesFromRecord(conversation, turns);
        const info: TurnInfo[] = turns.map(turn => ({question: turn.question, startedAt: turn.startedAt, unverifiedRefs: turn.reply?.unverifiedRefs ?? [], ...(turn.reply?.ungrounded === true ? {ungrounded: true} : {}), ...(turn.logFrom === undefined ? {} : {logFrom: turn.logFrom})}));
        const run = attachedRun(next.record, next.run);
        const running = run === null ? null : {question: run.question, startedAt: run.startedAt, logFrom: run.logFrom, unverifiedRefs: run.result?.reply?.unverifiedRefs ?? [], ...(run.result?.reply?.ungrounded === true ? {ungrounded: true} : {})};
        return composeMessages(transcript.messages(), {conversationId: conversation, turns: info, running, replyChecks}, cache);
    }

    function update(patch: Partial<QaSourceState>): void {
        const next = {...state, ...patch};
        state = {...next, messages: messagesOf(next)};
    }

    /** 帧到了只记下来，合到下一次画面再算一次消息。 */
    function changed(): void {
        if (scheduled) return;
        scheduled = true;
        schedule(() => {
            scheduled = false;
            if (disposed) return;
            update({});
            emit();
        });
    }

    function stopWatching(): void {
        subscription?.close();
        subscription = null;
        cancelRetry?.();
        cancelRetry = null;
    }

    function retryLater(): void {
        const ms = retryDelay(attempts);
        attempts += 1;
        cancelRetry = setTimer(() => {
            cancelRetry = null;
            void load(true);
        }, ms);
    }

    function watch(run: QaRunView, token: number): void {
        let sawEnd = false;
        let wasRunning = false;
        const current = () => token === generation && !disposed;
        subscription = client.subscribe(book, conversation, {
            frame(frame) {
                if (!current()) return;
                switch (frame.type) {
                    case "snapshot":
                        if (frame.run === null || frame.run.runId !== run.runId || (frame.run.state === "ended" && frame.run.saved?.ok === true)) {
                            // 读对话与订阅之间这一轮已经换掉（下一轮开始了、对话被删了），或已经结束并保存（条目在记录里，
                            // 快照不再带）：重读一次。重读到的已保存的运行不再订阅，所以不会来回。
                            sawEnd = true;
                            void load(false);
                            return;
                        }
                        attempts = 0;
                        for (const entry of frame.entries) applyLogEntry(entry);
                        wasRunning = frame.run.state === "running";
                        sawEnd = !wasRunning;
                        state = {...state, run: frame.run};
                        break;
                    case "log":
                        if (frame.runId !== run.runId) return;
                        for (const entry of frame.entries) applyLogEntry(entry);
                        break;
                    case "event":
                        if (frame.runId !== run.runId) return;
                        transcript.applyEvent(frame.event);
                        break;
                    case "ended":
                        sawEnd = true;
                        if (frame.run.saved?.ok === true) settling = frame.run.runId;
                        state = {...state, run: frame.run, continuable: continuableAfterEnd(state, frame.run)};
                        break;
                }
                changed();
            },
            end(reason: SubscriptionEnd) {
                if (!current()) return;
                subscription = null;
                if (sawEnd) {
                    // 看着它结束的：记录已经写好（或确定没保存），重读一份。快照里就已结束的：条目已经拿到，不用再读。
                    if (wasRunning) void load(false);
                    return;
                }
                retryLater();
            },
        });
    }

    /** 读一次对话。`keep` 时（断线重连）同一个运行还在跑就沿用原来的转录。 */
    async function load(keep: boolean): Promise<void> {
        generation += 1;
        const token = generation;
        stopWatching();
        let got: ViewerResult<"qa.get">;
        try {
            got = await client.call("qa.get", {book, id: conversation});
        } catch (error) {
            if (token !== generation || disposed) return;
            if (keep && error instanceof StoryCallError && error.code === "network") {
                retryLater();
                return;
            }
            const code = error instanceof StoryCallError ? error.code : "internal";
            state = {...LOADING, phase: "failed", error: {code, message: error instanceof Error ? error.message : String(error)}};
            emit();
            return;
        }
        if (token !== generation || disposed) return;
        settling = null;
        const sameRun = keep && got.run !== null && got.run.state === "running" && got.run.runId === state.run?.runId;
        const attached = attachedRun(got.record, got.run);
        if (!sameRun) {
            transcript = createTurnTranscripts(turnStarts(got.record, attached));
            cache = createMessageCache();
            replyChecks = new Map();
            if (got.log.ok) for (const entry of got.log.entries) applyLogEntry(entry);
        }
        update({phase: "ready", error: null, record: got.record, run: got.run, continuable: got.continuable, logProblem: got.log.ok ? null : got.log.problem, detached: got.run !== null && attached === null && !(got.run.state === "ended" && got.run.saved?.ok === true)});
        emit();
        if (attached !== null) watch(attached, token);
    }

    void load(false);

    return {
        state: () => state,
        refresh: () => (disposed ? Promise.resolve() : load(false)),
        dispose() {
            disposed = true;
            generation += 1;
            stopWatching();
        },
    };
}
