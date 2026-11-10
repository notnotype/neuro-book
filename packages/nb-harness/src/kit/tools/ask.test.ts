/**
 * `ask` 自身的行为（docs/specs/agent/builtin-tools.md 输出 23–25；测试名里的编号是它的输出条目）：回答的校验与交给模型的文字、表单
 * 先按 Agent 策略检查、拒答与没人能答。提问通道是内核的 `ToolContext.ask`，这里按它的类型给定回答；经真实提问通道的走一遍在宿主的测试里。
 */

import {describe, expect, test} from "bun:test";

import type {JsonValue, QuestionAnswer, ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import type {ArtifactStore, SessionFiles} from "../files/index.js";
import {askDeclaration, askFormDeclaration, askTool} from "./ask.js";

const QUESTIONS = [
    {question: "主角叫什么？", options: [{label: "林舟"}, {label: "陈砚"}]},
    {question: "哪些人物要出场？", multiSelect: true, options: [{label: "甲"}, {label: "乙"}, {label: "丙"}]},
];
const FORM = {type: "object", properties: {年龄: {type: "integer"}}, required: ["年龄"]};

/** 调一次 `ask`：`reply` 是用户的回答；交回工具结果与工具交给提问通道的请求（没问时为 null）。 */
async function ask(questions: unknown, reply: QuestionAnswer | null, options: {readonly background?: boolean} = {}): Promise<{readonly result: ToolResult; readonly asked: {readonly question: string; readonly data?: JsonValue} | null}> {
    let asked: {question: string; data?: JsonValue} | null = null;
    const context = {sessionId: "s-1", profile: "p", ...(options.background === true ? {background: true} : {})} as ToolSessionContext;
    const call = {
        callId: "c-1",
        signal: new AbortController().signal,
        ...(reply === null ? {} : {ask: async (request: {question: string; data?: JsonValue}) => {
            asked = request;
            return reply;
        }}),
    } as unknown as ToolContext;
    const result = await askTool.create(context, {files: {} as SessionFiles, artifacts: {} as ArtifactStore}).execute({questions}, call);
    return {result: typeof result === "string" ? {text: result} : result, asked};
}

const answered = (answers: unknown): QuestionAnswer => ({kind: "answer", text: "见回答", data: {answers} as JsonValue, by: {kind: "user"}});

describe("ask", () => {
    test("输出 23：选项、其它、表单的回答回到模型；结构化的值在 details；请求带全部问题", async () => {
        const answers = [{selected: ["林舟"]}, {selected: ["甲", "丙"], other: "再加一个丁"}, {selected: [], form: {年龄: 19}}];
        const {result, asked} = await ask([...QUESTIONS, {question: "年龄？", options: [{label: "跳过"}, {label: "填写"}], form: FORM}], answered(answers));
        expect((asked?.data as {questions: unknown[]}).questions).toHaveLength(3);
        expect(result.status).toBeUndefined();
        expect(result.details).toEqual({answers} as never);
        expect(result.text).toContain("回答：林舟");
        expect(result.text).toContain("甲；丙；其它：再加一个丁");
        expect(result.text).toContain('表单：{"年龄":19}');
    });

    test("输出 23：回答越界得 ask-invalid-answer：选项之外、单选给两个、题数不对、没答、表单不合规、不是列表、多选重复、只给文字", async () => {
        const cases: {readonly questions: unknown; readonly reply: QuestionAnswer}[] = [
            {questions: QUESTIONS, reply: answered([{selected: ["不存在"]}, {selected: ["甲"]}])},
            {questions: QUESTIONS, reply: answered([{selected: ["林舟", "陈砚"]}, {selected: ["甲"]}])},
            {questions: QUESTIONS, reply: answered([{selected: ["林舟"]}])},
            {questions: QUESTIONS, reply: answered([{selected: []}, {selected: ["甲"]}])},
            {questions: [{question: "年龄？", options: [{label: "跳过"}, {label: "填写"}], form: FORM}], reply: answered([{selected: [], form: {年龄: "很老"}}])},
            {questions: QUESTIONS, reply: answered("不是列表")},
            {questions: QUESTIONS, reply: answered([{selected: ["林舟"]}, {selected: ["甲", "甲"]}])},
            {questions: QUESTIONS, reply: {kind: "answer", text: "随便写的", by: {kind: "user"}}},
        ];
        for (const item of cases) expect((await ask(item.questions, item.reply)).result.code, JSON.stringify(item.reply)).toBe("ask-invalid-answer");
    });

    test("输出 23：子会话的提问由父会话回答时只有文字，原样交给模型", async () => {
        const {result} = await ask(QUESTIONS, {kind: "answer", text: "按你的判断来", by: {kind: "session", id: "parent"}});
        expect(result).toEqual({text: "按你的判断来"});
    });

    test("输出 24：form 不合 Agent 策略得 ask-form-invalid，不打扰用户；只列错误级别的问题", async () => {
        const {result, asked} = await ask([{question: "填", options: [{label: "甲"}, {label: "乙"}], form: {type: "object", properties: {a: {type: "string", pattern: "^x"}}}}], answered([]));
        expect(asked).toBeNull();
        expect(result.code).toBe("ask-form-invalid");
        expect(result.text).toContain("第 1 题");
        expect((result.details as {problems: string[]}).problems.length).toBeGreaterThan(0);
    });

    test("输出 25：用户拒答或停止得 ask-declined；后台会话、没有提问通道得 ask-unavailable", async () => {
        expect((await ask(QUESTIONS, {kind: "unavailable", code: "declined"})).result.code).toBe("ask-declined");
        expect((await ask(QUESTIONS, answered([]), {background: true})).result.code).toBe("ask-unavailable");
        expect((await ask(QUESTIONS, null)).result.code).toBe("ask-unavailable");
    });

    test("输出 25：两种声明给同一个实现；固定的那条没有 form，声明更短", () => {
        expect(JSON.stringify(askDeclaration).length).toBeLessThan(JSON.stringify(askFormDeclaration).length);
        expect(JSON.stringify(askDeclaration)).not.toContain("form");
    });
});
