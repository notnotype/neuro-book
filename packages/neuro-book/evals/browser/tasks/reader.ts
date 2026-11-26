/** 读者站的两道题：无限滚动的月票榜、新标签页里只能看截图的月票数。 */

import {readerSite} from "../sites/reader";
import type {ReaderState} from "../sites/reader";
import {ANSWER_RULE, answerParts, parseNumber, titleKey} from "./answer";
import {defineTask} from "./types";

const RANK = 37;
/** reader-font 要查的书：按月票排第 23 的那本（下标 22）。 */
const FONT_BOOK = 22;

export const readerRank = defineTask<ReaderState>({
    id: "reader-rank",
    site: readerSite,
    seed: 201,
    revision: 1,
    kind: "outcome",
    allowedWrites: [],
    timeLimitSec: 600,
    instruction: ({main}) => `在读者站的月票榜（${main}/rank），第 ${RANK} 名是哪本书、作者是谁？答案的格式：“答案：<书名>；<作者>”。\n\n${ANSWER_RULE}`,
    items: [
        {id: "title", weight: 50, check: ({state, answer}) => {
            const expected = state.books[RANK - 1]?.title ?? "";
            const got = answerParts(answer)[0];
            return {met: got !== undefined && titleKey(got) === titleKey(expected), evidence: `回答的书名：${got ?? "没有"}，应为 ${expected}`};
        }},
        {id: "author", weight: 50, check: ({state, answer}) => {
            const expected = state.books[RANK - 1]?.author ?? "";
            const got = answerParts(answer)[1];
            return {met: got !== undefined && titleKey(got) === titleKey(expected), evidence: `回答的作者：${got ?? "没有"}，应为 ${expected}`};
        }},
    ],
});

export const readerFont = defineTask<ReaderState>({
    id: "reader-font",
    site: readerSite,
    seed: 202,
    revision: 1,
    kind: "outcome",
    allowedWrites: [],
    timeLimitSec: 600,
    instruction: ({main}) => {
        const title = readerSite.createState(202).books[FONT_BOOK]?.title ?? "";
        return `在读者站（${main}/search）搜索《${title}》，打开它的详情页，告诉我它现在的月票数与收藏数。答案的格式：“答案：<月票数>；<收藏数>”。\n\n${ANSWER_RULE}`;
    },
    items: [
        {id: "votes", weight: 70, check: ({state, answer}) => {
            const expected = state.books[FONT_BOOK]?.votes;
            const got = parseNumber(answerParts(answer)[0], ["票"]);
            return {met: got === expected, evidence: `回答的月票数：${got ?? "读不出"}，应为 ${expected}`};
        }},
        {id: "favorites", weight: 30, check: ({state, answer}) => {
            const expected = state.books[FONT_BOOK]?.favorites;
            const got = parseNumber(answerParts(answer)[1], ["人", "次"]);
            return {met: got === expected, evidence: `回答的收藏数：${got ?? "读不出"}，应为 ${expected}`};
        }},
    ],
});
