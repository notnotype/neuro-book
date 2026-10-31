/**
 * `core.history`：按内核盖的位置章，把路径上的对话事件归成轮与步（提案第 7 节）。只看 path 事件。
 *
 * 状态用持久链表：回退时旧叶子的状态还要用，归约不能改旧值；用数组每条事件都要整份复制，打开长会话是 O(n²)。
 * 链表追加是 O(1)，要数组时再转，转好的按节点记住。
 */

import type {ConversationTurn, LogEvent, Step} from "../api/index.js";

type List<T> = {readonly head: T; readonly tail: List<T>; readonly size: number} | null;
const cons = <T>(head: T, tail: List<T>): List<T> => ({head, tail, size: (tail?.size ?? 0) + 1});
const arrays = new WeakMap<object, readonly unknown[]>();

export function listToArray<T>(list: List<T>): readonly T[] {
    if (list === null) return [];
    const hit = arrays.get(list);
    if (hit !== undefined) return hit as readonly T[];
    const out: T[] = new Array(list.size);
    let index = list.size - 1;
    for (let node: List<T> = list; node !== null; node = node.tail) out[index--] = node.head;
    Object.freeze(out);
    arrays.set(list, out);
    return out;
}

export interface HistoryState {
    /** 已提交的轮（turnEnded 之后）；压缩之后只剩切点及其后的。 */
    readonly committed: List<ConversationTurn>;
    /** 最近一次压缩的摘要（排在已提交的轮前面）；没有压缩过或方法没给摘要时为 null。 */
    readonly summary: {readonly compactionId: string; readonly text: string} | null;
    /** 压缩省略的条目：事件 id → 给模型看的占位（消息还在，文字换掉）。 */
    readonly omitted: ReadonlyMap<string, string>;
    /** 每一轮的 `turnStarted` 事件 id 与轮 id（新的在前）：压缩的切点按它找到轮。 */
    readonly starts: List<{readonly eventId: string; readonly turnId: string}>;
    /** 进行中的轮。 */
    readonly current: ConversationTurn | null;
    /** 空闲时写的对话事件（位置章 next-turn），并进下一轮的附带内容。 */
    readonly waiting: readonly LogEvent[];
    readonly turns: number;
    readonly runs: number;
}

export const initialHistory: HistoryState = {committed: null, summary: null, omitted: new Map(), starts: null, current: null, waiting: [], turns: 0, runs: 0};

function withLastStep(turn: ConversationTurn, update: (step: Step) => Step): ConversationTurn {
    const last = turn.steps.at(-1);
    if (last === undefined) return turn;
    return {...turn, steps: [...turn.steps.slice(0, -1), update(last)]};
}

/** 归一条 path 事件；不相干的返回原状态（同一个对象，快照因此能共享）。 */
export function reduceHistory(state: HistoryState, event: LogEvent): HistoryState {
    switch (event.type) {
        case "runStarted":
            return {...state, runs: state.runs + 1};
        case "turnStarted": {
            const data = event.data as {turnId: string};
            return {...state, current: {id: data.turnId, input: null, attachments: state.waiting, steps: [], status: "running"}, waiting: [], starts: cons({eventId: event.id, turnId: data.turnId}, state.starts)};
        }
        case "compaction":
            return compacted(state, event);
        case "turnEnded": {
            if (state.current === null) return state;
            const reason = (event.data as {reason: ConversationTurn["status"]}).reason;
            return {...state, committed: cons({...state.current, status: reason}, state.committed), current: null, turns: state.turns + 1};
        }
        case "assistant":
            if (state.current === null) return state;
            return {...state, current: {...state.current, steps: [...state.current.steps, {reply: event as Step["reply"], results: [], after: []}]}};
        case "toolResult":
            if (state.current === null) return state;
            return {...state, current: withLastStep(state.current, (step) => ({...step, results: [...step.results, event as Step["results"][number]]}))};
        case "input":
            if (state.current === null) return state;
            return {...state, current: {...state.current, input: event as ConversationTurn["input"]}};
    }
    if (event.kind !== "conv") return state;
    const position = event.position;
    if (position === undefined || position.kind === "next-turn" || state.current === null) return {...state, waiting: [...state.waiting, event]};
    if (position.kind === "attachment") return {...state, current: {...state.current, attachments: [...state.current.attachments, event]}};
    return {...state, current: withLastStep(state.current, (step) => ({...step, after: [...step.after, event]}))};
}

/** 这一轮里有没有被省略的条目（有的话要换一个轮对象，让提交缓存重新渲染它）。 */
function touches(turn: ConversationTurn, omitted: ReadonlyMap<string, string>): boolean {
    if (omitted.size === 0) return false;
    if (turn.attachments.some((event) => omitted.has(event.id)) || (turn.input !== null && omitted.has(turn.input.id))) return true;
    return turn.steps.some((step) => omitted.has(step.reply.id) || step.results.some((result) => omitted.has(result.id)) || step.after.some((event) => omitted.has(event.id)));
}

/**
 * 压缩事件（提案第 10 节、runtime.md 输出 49）：切点之前的已提交轮去掉；切点在进行中这一轮里时，输入与附带内容留着、
 * 切点之前的步去掉；`firstKeptEntryId` 为 null 时已提交的轮与进行中这一轮的步都去掉。方法给了摘要就换成这次的，没给
 * （例如只省略大块内容）就留着上一次的；省略的条目
 * 并进占位表，含有它们的已提交轮换成新对象（提交缓存按轮对象记，这样会重新渲染一次）。
 */
function compacted(state: HistoryState, event: LogEvent): HistoryState {
    const data = event.data as {firstKeptEntryId: string | null; replacement: string | null; omitted: readonly {entryId: string; placeholder: string}[]};
    const omitted = data.omitted.length === 0 ? state.omitted : new Map([...state.omitted, ...data.omitted.map((item): [string, string] => [item.entryId, item.placeholder])]);
    let kept: ConversationTurn[] = [];
    let current = state.current;
    if (data.firstKeptEntryId === null) {
        if (current !== null) current = {...current, steps: []};
    } else {
        let start: {eventId: string; turnId: string} | undefined;
        for (let node = state.starts; node !== null && start === undefined; node = node.tail) if (node.head.eventId === data.firstKeptEntryId) start = node.head;
        const all = listToArray(state.committed);
        if (start === undefined) {
            // 切点是进行中这一轮里某一步的回复。
            if (current !== null) {
                const index = current.steps.findIndex((step) => step.reply.id === data.firstKeptEntryId);
                if (index >= 0) current = {...current, steps: current.steps.slice(index)};
            }
        } else {
            const from = all.findIndex((turn) => turn.id === start.turnId);
            kept = from < 0 ? [] : all.slice(from);
        }
    }
    let committed: List<ConversationTurn> = null;
    for (const turn of kept) committed = cons(touches(turn, omitted) && omitted !== state.omitted ? {...turn} : turn, committed);
    return {...state, committed, current, omitted, summary: data.replacement === null ? state.summary : {compactionId: event.id, text: data.replacement}};
}

export function committedTurns(state: HistoryState): readonly ConversationTurn[] {
    return listToArray(state.committed);
}
