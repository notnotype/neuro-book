/**
 * 写 `commit` 用的两个纯函数：交回改过的一轮，再经 `format.turn` 渲染（docs/specs/harness/profile.md 输出 13、14）。
 * 只改轮的形状，不碰事件本身：回复去掉工具调用时换一个新的事件对象，日志与状态里的那条不变。
 */

import type {ConversationTurn, FinalOnlyHelper, LogEvent, MergeSteersHelper, Step, WithoutEventsHelper} from "../api/index.js";
import type {UserAttachment} from "../api/basics.js";

export const finalOnly: FinalOnlyHelper = <P>(turn: ConversationTurn<P>): ConversationTurn<P> => {
    const last = turn.steps.at(-1);
    if (last === undefined) return turn;
    const reply = last.reply.data.toolCalls.length === 0 ? last.reply : {...last.reply, data: {...last.reply.data, toolCalls: []}};
    return {...turn, steps: [{reply, results: [], after: []}]};
};

export const withoutEvents: WithoutEventsHelper = (turn, dependency, ...names) => {
    const id = "contract" in dependency ? dependency.contract.id : dependency.id;
    const drop = new Set(names.map((name) => `${id}/${String(name)}`));
    const keep = (events: Step["after"]) => events.filter((event) => !drop.has(event.type));
    return {...turn, attachments: keep(turn.attachments), steps: turn.steps.map((step) => ({...step, after: keep(step.after)}))};
};

type SteerData = {text: string; attachments?: readonly UserAttachment[]; boundary?: string; payload?: unknown};

const plain = (event: LogEvent): boolean => (event.data as SteerData).payload === undefined;

/** 把 `next` 接到 `into` 后面：文字之间空一行，后一条附件的位置随前面的文字往后挪。 */
function joinSteer(into: LogEvent, next: LogEvent): LogEvent {
    const first = into.data as SteerData;
    const second = next.data as SteerData;
    const offset = first.text.length + 2;
    const moved = (second.attachments ?? []).map((item) => (item.from === undefined || item.to === undefined ? item : {...item, from: item.from + offset, to: item.to + offset}));
    const attachments = [...(first.attachments ?? []), ...moved];
    return {...into, data: {...first, text: `${first.text}\n\n${second.text}`, ...(attachments.length === 0 ? {} : {attachments})}};
}

/**
 * 附带内容与每一步之后的事件里，同一个 `boundary` 的相邻插话合成一条（来源是第一条的）；没有 `boundary` 的旧事件各自成一条。
 * 带 `payload` 的插话不合：结构化的数据没有通用的合并办法，合了会丢掉后一条的（Profile 的 `render.steer` 读得到它）。
 */
export const mergeSteers: MergeSteersHelper = <P>(turn: ConversationTurn<P>): ConversationTurn<P> => {
    const merge = (events: readonly LogEvent[]): LogEvent[] => {
        const out: LogEvent[] = [];
        for (const event of events) {
            const last = out.at(-1);
            const boundary = (event.data as SteerData).boundary;
            if (event.type === "steer" && last?.type === "steer" && boundary !== undefined && (last.data as SteerData).boundary === boundary && plain(last) && plain(event)) out[out.length - 1] = joinSteer(last, event);
            else out.push(event);
        }
        return out;
    };
    return {...turn, attachments: merge(turn.attachments), steps: turn.steps.map((step): Step => ({...step, after: merge(step.after)}))};
};
