import {describe, expect, test} from "bun:test";
import {answerText, editingValue, groupQuestions, isBlankAnswer, isNewQuestion, submittedValue} from "../src/web/host/answers.js";
import type {QuestionState, VersionQuestion} from "../src/web/host/types.js";

/** 产物页侧栏的分组（t15 阶段 4 第 1 批）：待答、已答、之前几版的题、已取代与撤回。 */
const question = (id: string, patch: Partial<VersionQuestion> = {}): VersionQuestion => ({id, type: "single", label: id, options: [{value: "a", label: "甲"}, {value: "b", label: "乙"}], required: true, recommend: [], origin: "markup", page: "index.html", about: null, since: 1, outcome: null, ...patch});
const answer = (value: unknown) => ({answerId: "x", value, artifactVersion: 1, submittedAt: "2026-10-14T00:00:00.000Z", comment: null});
const state = (q: VersionQuestion, name: QuestionState["state"], value?: unknown): QuestionState => ({question: q, state: name, answer: value === undefined ? null : answer(value), stale: null});

describe("产物页侧栏的分组", () => {
    test("v1 已答、v2 页面上没有的题进“之前几版的题”；ask 登记的题不在页面里照样待答；必答在前", () => {
        const groups = groupQuestions([
            state(question("old", {page: null}), "answered", "a"),
            state(question("optional", {required: false, since: 2}), "open"),
            state(question("asked", {origin: "ask", page: null, since: 2}), "open"),
            state(question("kept", {since: 2}), "answered", "b"),
            state(question("gone", {outcome: {kind: "superseded", in: 2, by: null}}), "superseded"),
        ]);
        const ids = (list: QuestionState[]) => list.map((entry) => entry.question.id);
        expect([ids(groups.pending), ids(groups.answered), ids(groups.earlier), ids(groups.closed)]).toEqual([["asked", "optional"], ["kept"], ["old"], ["gone"]]);
    });

    test("“新”只标最新一版第一次出现的题，第一版不标", () => {
        expect([isNewQuestion({since: 2}, 2), isNewQuestion({since: 1}, 2), isNewQuestion({since: 1}, 1)]).toEqual([true, false, false]);
    });

    test("答案的文字：选项名、多选用顿号、确认题写同意与不同意", () => {
        const multi = question("m", {type: "multi"});
        expect([answerText(question("s"), "b"), answerText(multi, ["a", "b"]), answerText(question("c", {type: "confirm", options: []}), false)]).toEqual(["乙", "甲、乙", "不同意"]);
    });
});

describe("改答的取值", () => {
    test("先答了多选，点“改答”时控件里是现在的答案，加一项后提交的是原选项加新项；只写说明不改取值时交现在的答案", () => {
        const multi = state(question("pick", {type: "multi"}), "answered", ["a"]);
        const values: Record<string, unknown> = {};
        const touched: Record<string, boolean> = {};
        // 提交成功后表单已清空，这道题在本地没有取值；开始改答时取现在的答案。
        expect(editingValue(multi, values, touched)).toEqual(["a"]);
        expect(submittedValue(multi, values, touched)).toEqual(["a"]);
        values.pick = [...(editingValue(multi, values, touched) as string[]), "b"];
        touched.pick = true;
        expect(submittedValue(multi, values, touched)).toEqual(["a", "b"]);
    });
});

describe("清空了的题回到没答（t19）", () => {
    test("多选全取消、文字只剩空白、单选与确认清除选择都算清空；选了的、确认题选“不同意”不算", () => {
        const blank = [[], "", "  \n", undefined].map(isBlankAnswer);
        const filled = [["a"], "a", false, true].map(isBlankAnswer);
        expect([blank, filled]).toEqual([[true, true, true, true], [false, false, false, false]]);
    });
});
