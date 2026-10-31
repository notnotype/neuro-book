/**
 * 写 `commit` 用的两个纯函数：交回改过的一轮，再经 `format.turn` 渲染（docs/specs/harness/profile.md 输出 13、14）。
 * 只改轮的形状，不碰事件本身：回复去掉工具调用时换一个新的事件对象，日志与状态里的那条不变。
 */

import type {ConversationTurn, FinalOnlyHelper, Step, WithoutEventsHelper} from "../api/index.js";

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
