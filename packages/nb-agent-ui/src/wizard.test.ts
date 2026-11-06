import {describe, expect, test} from "bun:test";

import type {PendingApprovalView} from "./types";
import {allChosen, answered, choose, EMPTY_WIZARD, nextUnchosen, questionResolution, readWizardState} from "./wizard";

const approval = (id: string, tool: string): PendingApprovalView => ({kind: "approval", id, toolCallId: `c-${id}`, tool, args: {}, preview: {state: "loading"}});
const items = [approval("a", "edit"), approval("b", "shell"), approval("c", "edit")];

describe("审批向导", () => {
    test("都选了才能提交；可以改选", () => {
        let state = choose(EMPTY_WIZARD, items, "a", "allow");
        expect(allChosen(state, items)).toBe(false);
        state = choose(state, items, "b", "deny", "不要跑");
        state = choose(state, items, "c", "allow");
        expect(allChosen(state, items)).toBe(true);
        expect(state.approvals.b).toEqual({decision: "deny", note: "不要跑"});
        expect(choose(state, items, "b", "allow").approvals.b).toEqual({decision: "allow"});
    });

    test("本会话都批准不改已经选了的：拒绝还是拒绝，附言还在", () => {
        const denied = choose(EMPTY_WIZARD, items, "c", "deny", "这个不要");
        expect(choose(denied, items, "a", "allow-session").approvals).toEqual({a: {decision: "allow-session"}, c: {decision: "deny", note: "这个不要"}});
    });

    test("本会话都批准同时选中这批里同一个工具的其余调用，别的工具不动", () => {
        const state = choose(EMPTY_WIZARD, items, "a", "allow-session");
        expect(state.approvals).toEqual({a: {decision: "allow-session"}, c: {decision: "allow-session"}});
    });

    test("以后都允许同样联动", () => {
        const state = choose(EMPTY_WIZARD, items, "a", "allow-always");
        expect(state.approvals).toEqual({a: {decision: "allow-always"}, c: {decision: "allow-always"}});
    });

    test("记规则时只联动记同一条的：别的前缀不动，不能记的不动", () => {
        const shell = (id: string, remember: PendingApprovalView["remember"]): PendingApprovalView => ({...approval(id, "shell"), ...(remember === undefined ? {} : {remember})});
        const batch = [shell("a", {label: "git diff *"}), shell("b", {label: "touch *"}), shell("c", {label: "git diff *"}), shell("d", false)];
        expect(choose(EMPTY_WIZARD, batch, "a", "allow-session").approvals).toEqual({a: {decision: "allow-session"}, c: {decision: "allow-session"}});
    });

    test("下一个没选的：往后找，转一圈；都选了是 null", () => {
        const state = choose(EMPTY_WIZARD, items, "b", "allow");
        expect(nextUnchosen(state, items, 0)).toBe(2);
        expect(nextUnchosen(state, items, 2)).toBe(0);
        expect(nextUnchosen(choose(choose(state, items, "a", "allow"), items, "c", "allow"), items, 0)).toBeNull();
    });

    test("宿主放回来读不懂的按空的来", () => {
        expect(readWizardState(null)).toEqual(EMPTY_WIZARD);
        expect(readWizardState("乱的")).toEqual(EMPTY_WIZARD);
        expect(readWizardState({step: 2})).toEqual({...EMPTY_WIZARD, step: 2});
    });
});

describe("提问向导", () => {
    const question = {question: "视角？", options: [{label: "第一人称"}, {label: "第三人称"}]};
    const formQuestion = {...question, form: {type: "object"}};

    test("选了选项、写了其它、填了对的表单才算答了", () => {
        expect(answered(question, undefined)).toBe(false);
        expect(answered(question, {selected: []})).toBe(false);
        expect(answered(question, {selected: [], other: "   "})).toBe(false);
        expect(answered(question, {selected: ["第一人称"]})).toBe(true);
        expect(answered(question, {selected: [], other: "第二人称"})).toBe(true);
        expect(answered(formQuestion, {selected: [], form: {a: 1}})).toBe(true);
        expect(answered(formQuestion, {selected: [], form: {a: 1}, formInvalid: true})).toBe(false);
    });

    test("提交的回答：文字非空，给人看；结构化的值逐题；其它去掉空白", () => {
        const resolution = questionResolution([question, {...question, question: "人物？", multiSelect: true}, formQuestion], [{selected: ["第三人称"]}, {selected: ["第一人称", "第三人称"], other: "  丁 "}, {selected: [], form: {a: 1}}], {other: "其它：", form: "表单："});
        expect(resolution).toEqual({kind: "question", answer: {
            text: '视角？ 第三人称\n人物？ 第一人称、第三人称、其它：丁\n视角？ 表单：{"a":1}',
            data: {answers: [{selected: ["第三人称"]}, {selected: ["第一人称", "第三人称"], other: "丁"}, {selected: [], form: {a: 1}}]},
        }});
    });
});
