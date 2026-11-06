/**
 * 规则设置页的换算（docs/specs/agent/permissions.md 输出 22、23）：表单写得了的条件来回不变，写不了的走 JSON；“以后都允许”记什么。
 */

import {describe, expect, test} from "bun:test";

import type {Rule} from "../shared/permissions";
import {appendRules, emptyRuleForm, formToRule, moveRule, ruleSummary, rulesToRemember, ruleToForm} from "./permission-rules";

const roundTrip = (rule: Rule): unknown => {
    const result = formToRule(ruleToForm(rule));
    return result.ok ? result.rule : result;
};

describe("规则与表单", () => {
    const rules: readonly Rule[] = [
        {tool: "shell", action: "deny"},
        {tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny", reason: "先问我"},
        {tool: "write", when: {type: "path", glob: "project://正文/**"}, action: "ask"},
        {tool: "write", when: {type: "path", glob: "**/.env", access: "write"}, action: "deny"},
        {tool: "search", when: {type: "subject", kind: "url", glob: "https://example.com/*"}, action: "allow"},
        {tool: "*", when: {type: "any", of: [{type: "command", pattern: "rm *"}, {type: "path", glob: "**/.env"}]}, action: "deny"},
    ];
    test.each(rules.map((rule, index) => [index, rule] as const))("第 %d 条来回不变", (_index, rule) => {
        expect(roundTrip(rule)).toEqual(rule);
    });

    test("表单认不出的条件显示成自定义，编辑时是 JSON", () => {
        const form = ruleToForm(rules[5]!);
        expect(form.kind).toBe("json");
        expect(JSON.parse(form.json)).toEqual(rules[5]!.when);
        expect(ruleSummary(rules[5]!)).toEqual({key: "json"});
    });

    test("写得不对时指出字段", () => {
        expect(formToRule(emptyRuleForm())).toEqual({ok: false, field: "tool"});
        expect(formToRule({...emptyRuleForm(), tool: "shell", kind: "command", value: " "})).toEqual({ok: false, field: "value"});
        expect(formToRule({...emptyRuleForm(), tool: "shell", kind: "json", json: "{"})).toEqual({ok: false, field: "json"});
    });

    test("上下移动：顶到头不动", () => {
        const list: Rule[] = [{tool: "a", action: "deny"}, {tool: "b", action: "ask"}];
        expect(moveRule(list, 1, -1).map((rule) => rule.tool)).toEqual(["b", "a"]);
        expect(moveRule(list, 0, -1).map((rule) => rule.tool)).toEqual(["a", "b"]);
        expect(moveRule(list, 1, 1).map((rule) => rule.tool)).toEqual(["a", "b"]);
    });
});

describe("以后都允许（输出 23）", () => {
    const rule: Rule = {tool: "nbook.agent.shell", when: {type: "command", pattern: "git diff *"}, action: "allow"};

    test("命令工具记请求里的规则；别的工具记整个工具；不能记时什么也不写", () => {
        expect(rulesToRemember({tool: "nbook.agent.shell", remember: {label: "git diff *", rules: [rule]}})).toEqual([rule]);
        expect(rulesToRemember({tool: "nbook.agent.write"})).toEqual([{tool: "nbook.agent.write", action: "allow"}]);
        expect(rulesToRemember({tool: "nbook.agent.shell", remember: false})).toEqual([]);
    });

    test("加在末尾，不盖过已有的拒绝；一样的不重复写", () => {
        const deny: Rule = {tool: "nbook.agent.shell", when: {type: "command", pattern: "git *"}, action: "deny"};
        expect(appendRules([deny], [rule])).toEqual([deny, rule]);
        expect(appendRules([deny, rule], [{...rule, reason: "手写的理由"}])).toEqual([deny, rule]);
    });
});
