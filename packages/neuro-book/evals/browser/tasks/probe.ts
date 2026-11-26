/**
 * `probe` 用的最小题（不在题目登记表里、不进统计）：要截一张图、点一下、再回答，
 * 保证模型请求走到“第二次请求带着第一次的工具调用与图片”，看两个 Gemini 经网关能不能走通 browser-use 的多轮工具调用。
 */

import {authorSite} from "../sites/author";
import type {AuthorState} from "../sites/author";
import {ANSWER_RULE} from "./answer";
import {defineTask} from "./types";

export const probeTask = defineTask<AuthorState>({
    id: "probe",
    site: authorSite,
    seed: 1,
    revision: 1,
    kind: "outcome",
    allowedWrites: [],
    timeLimitSec: 300,
    instruction: ({main}) => `打开 ${main}/ ，先截一张图看看页面，然后点“同意并继续”，告诉我页面上的欢迎语是什么。答案的格式：“答案：<欢迎语>”。\n\n${ANSWER_RULE}`,
    items: [
        {id: "answered", weight: 100, check: ({answer}) => ({met: answer !== null && answer.includes("你好"), evidence: `回答：${answer ?? "没有“答案：”行"}`})},
    ],
});
