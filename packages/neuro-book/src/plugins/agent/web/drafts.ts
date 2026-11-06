/**
 * 输入框的草稿（docs/specs/agent/conversation.md 输出 29）：按会话存在浏览器本地（`nbook.storage` 的本地记录），另一个窗口看不到。
 * 只留最近 10 条、30 天内的：这是没发出去的字，不是要长期保存的东西。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

export const MAX_DRAFTS = 10;
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const DraftsSchema = Type.Object({
    items: Type.Array(Type.Object({session: Type.String(), text: Type.String(), at: Type.Number()}, {additionalProperties: false})),
}, {additionalProperties: false});
export type Drafts = Static<typeof DraftsSchema>;

export const NO_DRAFTS: Drafts = {items: []};

/** 这个会话的草稿；过期的不算。 */
export function draftOf(drafts: Drafts, session: string, now: number): string | null {
    const item = drafts.items.find((entry) => entry.session === session);
    return item === undefined || now - item.at > DRAFT_TTL_MS ? null : item.text;
}

/** 写一条：空文字就是删。顺手丢掉过期的和超出条数的（最早写的先丢）。 */
export function withDraft(drafts: Drafts, session: string, text: string, now: number): Drafts {
    const others = drafts.items.filter((entry) => entry.session !== session && now - entry.at <= DRAFT_TTL_MS);
    const items = text === "" ? others : [...others, {session, text, at: now}];
    return {items: items.sort((a, b) => a.at - b.at).slice(-MAX_DRAFTS)};
}
