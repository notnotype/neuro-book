/**
 * 规则设置页的纯逻辑（docs/specs/agent/permissions.md）：规则与表单之间的换算、列表里的一句话说明。表单只写得了叶子匹配器，
 * 嵌套的 `when` 用 JSON 字段；存储形状不变，手写在设置文件里的规则照样显示、照样能改。
 */

import type {Rule, RuleAction} from "../shared/permissions";

export type RuleConditionKind = "none" | "command" | "path" | "keywords" | "subject" | "json";

export interface RuleForm {
    tool: string;
    action: RuleAction;
    reason: string;
    kind: RuleConditionKind;
    /** 命令的 `pattern`、路径或对象的 `glob`；关键词用逗号分开。 */
    value: string;
    /** 路径：全部、只算读、只算写。 */
    access: "any" | "read" | "write";
    /** 关键词：参数的路径。判定对象：种类。 */
    field: string;
    json: string;
}

export const emptyRuleForm = (): RuleForm => ({tool: "", action: "deny", reason: "", kind: "none", value: "", access: "any", field: "", json: ""});

export function ruleToForm(rule: Rule): RuleForm {
    const form: RuleForm = {...emptyRuleForm(), tool: rule.tool, action: rule.action, reason: rule.reason ?? ""};
    const when = rule.when as Record<string, unknown> | undefined;
    if (when === undefined) return form;
    if (when.type === "command" && typeof when.pattern === "string") return {...form, kind: "command", value: when.pattern};
    if (when.type === "path" && typeof when.glob === "string") return {...form, kind: "path", value: when.glob, access: when.access === "read" || when.access === "write" ? when.access : "any"};
    if (when.type === "subject" && typeof when.kind === "string" && typeof when.glob === "string") return {...form, kind: "subject", field: when.kind, value: when.glob};
    if (when.type === "arg" && when.op === "keywords" && typeof when.path === "string" && Array.isArray(when.value)) return {...form, kind: "keywords", field: when.path, value: when.value.join("、")};
    return {...form, kind: "json", json: JSON.stringify(when, null, 2)};
}

/** 表单换回规则；写得不对时交回哪个字段错了。 */
export function formToRule(form: RuleForm): {readonly ok: true; readonly rule: Rule} | {readonly ok: false; readonly field: "tool" | "value" | "field" | "json"} {
    const tool = form.tool.trim();
    if (tool === "") return {ok: false, field: "tool"};
    const base = {tool, action: form.action, ...(form.reason.trim() === "" ? {} : {reason: form.reason.trim()})};
    const value = form.value.trim();
    switch (form.kind) {
        case "none":
            return {ok: true, rule: base};
        case "command":
            return value === "" ? {ok: false, field: "value"} : {ok: true, rule: {...base, when: {type: "command", pattern: value}}};
        case "path":
            return value === "" ? {ok: false, field: "value"} : {ok: true, rule: {...base, when: {type: "path", glob: value, ...(form.access === "any" ? {} : {access: form.access})}}};
        case "subject":
            if (form.field.trim() === "") return {ok: false, field: "field"};
            return value === "" ? {ok: false, field: "value"} : {ok: true, rule: {...base, when: {type: "subject", kind: form.field.trim(), glob: value}}};
        case "keywords": {
            if (form.field.trim() === "") return {ok: false, field: "field"};
            const words = value.split(/[,，、\s]+/u).filter((word) => word !== "");
            return words.length === 0 ? {ok: false, field: "value"} : {ok: true, rule: {...base, when: {type: "arg", path: form.field.trim(), op: "keywords", value: words}}};
        }
        case "json":
            try {
                return {ok: true, rule: {...base, when: JSON.parse(form.json) as unknown}};
            } catch {
                return {ok: false, field: "json"};
            }
    }
}

export type RuleSummary =
    | {readonly key: "none"}
    | {readonly key: "command" | "path" | "pathRead" | "pathWrite"; readonly value: string}
    | {readonly key: "keywords" | "subject"; readonly field: string; readonly value: string}
    | {readonly key: "json"};

export function ruleSummary(rule: Rule): RuleSummary {
    const form = ruleToForm(rule);
    switch (form.kind) {
        case "none": return {key: "none"};
        case "command": return {key: "command", value: form.value};
        case "path": return {key: form.access === "read" ? "pathRead" : form.access === "write" ? "pathWrite" : "path", value: form.value};
        case "keywords": return {key: "keywords", field: form.field, value: form.value};
        case "subject": return {key: "subject", field: form.field, value: form.value};
        case "json": return {key: "json"};
    }
}

export function moveRule<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
}

/**
 * “以后都允许”要写进用户规则的（permissions.md 输出 23）：内核请求里 `remember` 的规则；没有时（不看命令的工具）记整个工具。
 * `false` 是这次不能记，界面本来就没有这个按钮。
 */
export function rulesToRemember(request: {readonly tool?: string; readonly remember?: unknown}): readonly Rule[] {
    const remember = request.remember;
    if (remember === false) return [];
    if (typeof remember === "object" && remember !== null && "rules" in remember && Array.isArray(remember.rules)) return remember.rules as Rule[];
    return request.tool === undefined ? [] : [{tool: request.tool, action: "allow"}];
}

/** 加在末尾：第一条命中算数，放在末尾才不会盖过已有的拒绝。一样的不重复写。 */
export function appendRules(rules: readonly Rule[], added: readonly Rule[]): readonly Rule[] {
    const same = (left: Rule, right: Rule): boolean => JSON.stringify([left.tool, left.when, left.action]) === JSON.stringify([right.tool, right.when, right.action]);
    return added.reduce((list, rule) => (list.some((item) => same(item, rule)) ? list : [...list, rule]), rules);
}
