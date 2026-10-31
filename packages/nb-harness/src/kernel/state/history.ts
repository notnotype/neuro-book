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
    /** 已提交的轮（turnEnded 之后）。 */
    readonly committed: List<ConversationTurn>;
    /** 进行中的轮。 */
    readonly current: ConversationTurn | null;
    /** 空闲时写的对话事件（位置章 next-turn），并进下一轮的附带内容。 */
    readonly waiting: readonly LogEvent[];
    readonly turns: number;
    readonly runs: number;
}

export const initialHistory: HistoryState = {committed: null, current: null, waiting: [], turns: 0, runs: 0};

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
            return {...state, current: {id: data.turnId, input: null, attachments: state.waiting, steps: [], status: "running"}, waiting: []};
        }
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

export function committedTurns(state: HistoryState): readonly ConversationTurn[] {
    return listToArray(state.committed);
}
