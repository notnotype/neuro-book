/** 作家后台的三道题：发布章节、拖动章节换卷、查收入。 */

import {authorSite, incomeSummary} from "../sites/author";
import type {AuthorState} from "../sites/author";
import {ANSWER_RULE, answerParts, parseNumber} from "./answer";
import {defineTask} from "./types";

const PUBLISH_TITLE = "第十五章 潮汐钟";
const PUBLISH_PARAGRAPHS = [
    "天还没亮，港口的钟就自己响了起来，一下比一下急。",
    "守夜人阿岚提着灯跑上钟楼，发现钟绳早就烂断了，钟锤却还在晃。",
    "她数了数，钟声一共十三下，比潮水涨起来的时辰早了整整一刻。",
];
const PUBLISH_TEXT = PUBLISH_PARAGRAPHS.join("\n");

/** 发布到“第二卷 潮声”（v2）的章节。 */
function publishedInTarget(state: AuthorState) {
    return (state.layout.v2 ?? []).map((id) => state.chapters[id]).filter((chapter) => chapter !== undefined && chapter.origin === "published");
}

export const authorPublish = defineTask<AuthorState>({
    id: "author-publish",
    site: authorSite,
    seed: 101,
    revision: 1,
    kind: "flow",
    allowedWrites: ["POST /api/chapters"],
    timeLimitSec: 600,
    instruction: ({main}) => `在作家后台（${main}/publish）给作品《雾港》的“第二卷 潮声”发布一个新章节，标题是“${PUBLISH_TITLE}”，正文是下面三段：\n\n${PUBLISH_PARAGRAPHS.join("\n\n")}\n\n${ANSWER_RULE}`,
    items: [
        {id: "published-in-target", weight: 30, check: ({state}) => {
            const chapters = publishedInTarget(state);
            return {met: chapters.length > 0, evidence: `第二卷里新发布的章节：${chapters.length} 章`};
        }},
        {id: "title-and-body", weight: 30, check: ({state}) => {
            const exact = publishedInTarget(state).filter((chapter) => chapter.title === PUBLISH_TITLE && chapter.text === PUBLISH_TEXT);
            const titles = publishedInTarget(state).map((chapter) => chapter.title);
            return {met: exact.length > 0, evidence: exact.length > 0 ? `${exact[0]?.id} 的标题与正文一致` : `标题与正文都对的章节没有；第二卷新章节的标题：${JSON.stringify(titles)}`};
        }},
        {id: "confirmed", weight: 25, check: ({state}) => {
            const valid = state.published.filter((entry) => entry.credential === "valid" && (state.layout.v2 ?? []).includes(entry.chapterId));
            return {met: valid.length > 0, evidence: `发到第二卷、按页面协议取过确认凭据的发布：${valid.length} 次（全部发布的凭据：${JSON.stringify(state.published.map((entry) => entry.credential))}）`};
        }},
        {id: "published-once", weight: 15, check: ({state}) => ({met: state.published.length === 1, evidence: `生效的发布一共 ${state.published.length} 次`})},
    ],
});

const MOVED = ["c4", "c5", "c6"];

export const authorMove = defineTask<AuthorState>({
    id: "author-move",
    site: authorSite,
    seed: 102,
    revision: 1,
    kind: "flow",
    allowedWrites: ["POST /api/layout"],
    timeLimitSec: 600,
    instruction: ({main}) => `在作家后台的章节管理（${main}/chapters），把作品《雾港》“第一卷 雾起”里的第四、第五、第六章移到“第二卷 潮声”的最前面，三章之间的先后不变，然后保存。\n\n${ANSWER_RULE}`,
    items: [
        {id: "moved", weight: 40, check: ({state}) => {
            const v2 = state.layout.v2 ?? [];
            return {met: MOVED.every((id) => v2.includes(id)), evidence: `第二卷现在的章节：${JSON.stringify(v2)}`};
        }},
        {id: "order", weight: 30, check: ({state, initial}) => {
            const expected = [...MOVED, ...(initial.layout.v2 ?? [])];
            const v2 = state.layout.v2 ?? [];
            return {met: JSON.stringify(v2) === JSON.stringify(expected), evidence: `第二卷：${JSON.stringify(v2)}，应为 ${JSON.stringify(expected)}`};
        }},
        {id: "saved-via-page", weight: 20, check: ({state}) => {
            const valid = state.layoutSaves.filter((save) => save.credential === "valid");
            return {met: valid.length > 0, evidence: `按页面协议保存的次数：${valid.length}（全部保存的凭据：${JSON.stringify(state.layoutSaves.map((save) => save.credential))}）`};
        }},
        {id: "others-untouched", weight: 10, check: ({state, initial}) => {
            const expectedV1 = (initial.layout.v1 ?? []).filter((id) => !MOVED.includes(id));
            const othersSame = Object.keys(initial.layout).filter((volume) => volume !== "v1" && volume !== "v2").every((volume) => JSON.stringify(state.layout[volume]) === JSON.stringify(initial.layout[volume]));
            const v1Same = JSON.stringify(state.layout.v1) === JSON.stringify(expectedV1);
            return {met: v1Same && othersSame, evidence: `第一卷：${JSON.stringify(state.layout.v1)}，应为 ${JSON.stringify(expectedV1)}；其它作品的分卷${othersSame ? "没动" : "被改了"}`};
        }},
    ],
});

export const authorIncome = defineTask<AuthorState>({
    id: "author-income",
    site: authorSite,
    seed: 103,
    revision: 1,
    kind: "outcome",
    allowedWrites: [],
    timeLimitSec: 600,
    instruction: ({main}) => `在作家后台的收入页（${main}/income），查 2026 年 10 月“打赏”类的收入：一共多少元、多少笔？答案的格式：“答案：<合计金额，单位元>；<笔数>”。\n\n${ANSWER_RULE}`,
    items: [
        {id: "total", weight: 60, check: ({state, answer}) => {
            const expected = incomeSummary(state, "2026-10", "打赏").cents / 100;
            const got = parseNumber(answerParts(answer)[0], ["¥", "￥", "元"]);
            return {met: got !== null && Math.abs(got - expected) < 0.005, evidence: `回答的合计：${got ?? "读不出"}，应为 ${expected.toFixed(2)}`};
        }},
        {id: "count", weight: 40, check: ({state, answer}) => {
            const expected = incomeSummary(state, "2026-10", "打赏").count;
            const got = parseNumber(answerParts(answer)[1], ["笔"]);
            return {met: got === expected, evidence: `回答的笔数：${got ?? "读不出"}，应为 ${expected}`};
        }},
    ],
});
