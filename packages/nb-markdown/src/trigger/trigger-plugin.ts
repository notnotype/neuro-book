/**
 * 输入触发（Composer 的 `@`、`/`，正文的斜杠菜单）的状态：一个插件，每次事务后由宿主按光标前的文字重算；被 dismiss 的那一处，
 * 查询不变时不再打开。怎样算触发、是否在组字都归宿主：两处的规则不同，组字要看视图，不在编辑状态里。
 *
 * 不用 @tiptap/suggestion：它按字符各起一个插件，不能在宿主换了可选项后按原查询重算。
 */

import {Plugin} from "@tiptap/pm/state";
import type {EditorState, PluginKey, Transaction} from "@tiptap/pm/state";

export interface TriggerMatch {
    readonly from: number;
    readonly query: string;
}

export interface TriggerState<Match extends TriggerMatch> {
    active: Match | null;
    /** 被收起的那一处：光标还在这里、查询没变时不再打开。 */
    dismissed: {from: number; query: string} | null;
}

/** 事务的 meta：收起当前的触发。 */
export const DISMISS_TRIGGER = "dismiss";

export function createTriggerPlugin<Match extends TriggerMatch>(key: PluginKey<TriggerState<Match>>, read: (state: EditorState) => Match | null): Plugin<TriggerState<Match>> {
    return new Plugin<TriggerState<Match>>({
        key,
        state: {
            init: () => ({active: null, dismissed: null}),
            apply(tr: Transaction, value, _oldState, newState) {
                const candidate = read(newState);
                if (tr.getMeta(key) === DISMISS_TRIGGER) {
                    return {active: null, dismissed: candidate ? {from: candidate.from, query: candidate.query} : null};
                }
                const dismissed = value.dismissed ? {from: tr.mapping.map(value.dismissed.from), query: value.dismissed.query} : null;
                if (dismissed && candidate && candidate.from === dismissed.from && candidate.query === dismissed.query) {
                    return {active: null, dismissed};
                }
                return {active: candidate, dismissed: null};
            },
        },
    });
}
