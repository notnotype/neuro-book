/**
 * 规则的匹配与合并、判定顺序（docs/specs/agent/permissions.md 输出 1–5、8、10–12）：纯计算的结果表。
 */

import {describe, expect, test} from "bun:test";

import type {ApprovalMode, ToolEffect} from "@notnotype/nb-harness/kernel/contracts";

import type {Rule} from "../../shared/permissions";
import {decide} from "./judge";
import type {GateClass, ModeWriteAction} from "./judge";
import {evaluate, layerResult, matchesCommand, mergeLayers} from "./rules";
import type {CallView, RuleHit} from "./rules";

const view = (patch: Partial<CallView> = {}): CallView => ({tool: "nbook.agent.shell", toolName: "shell", args: {}, paths: [], unresolvedPaths: false, others: [], subjectsAvailable: true, argv: null, opaqueText: null, readOnly: false, redirectWrites: false, ...patch});
const noExpand = (glob: string): string => glob;
const hit = (action: RuleHit["action"]): RuleHit => ({action});

describe("命令按词比对（输出 11）", () => {
    test.each([
        ["git push *", ["git", "push"], true],
        ["git push *", ["git", "push", "origin", "main"], true],
        ["git push *", ["git", "-c", "x=y", "push"], false],
        ["git push *", ["git", "pushx"], false],
        ["git push", ["git", "push"], true],
        ["git push", ["git", "push", "origin"], false],
        ["git pu*", ["git", "push"], true],
        ["rm *", ["rm", "a b"], true],
    ] as const)("%s 比对 %j：%s", (pattern, argv, expected) => {
        expect(matchesCommand(pattern, argv)).toBe(expected);
    });
});

describe("匹配器（输出 8、10）", () => {
    test("arg：关键词不分大小写，点分路径；写错的正则算不出来", () => {
        const args = {prompt: "Draw a BLOODY scene", size: {w: 5}};
        expect(evaluate({type: "arg", path: "prompt", op: "keywords", value: ["bloody", "x"]}, view({args}), noExpand)).toBe(true);
        expect(evaluate({type: "arg", path: "prompt", op: "keywords", value: ["cat"]}, view({args}), noExpand)).toBe(false);
        expect(evaluate({type: "arg", path: "size.w", op: "eq", value: "5"}, view({args}), noExpand)).toBe(true);
        expect(evaluate({type: "arg", path: "none", op: "eq", value: "5"}, view({args}), noExpand)).toBe(false);
        expect(evaluate({type: "arg", path: "prompt", op: "regex", value: "("}, view({args}), noExpand)).toBe("unknown");
    });

    test("path：看访问方式；有算不出地址的写目标时，没命中算不出来", () => {
        const paths = [{access: "write" as const, address: "projects://b/正文/一.md"}];
        expect(evaluate({type: "path", glob: "projects://b/正文/**"}, view({paths}), noExpand)).toBe(true);
        expect(evaluate({type: "path", glob: "projects://b/正文/**", access: "read"}, view({paths}), noExpand)).toBe(false);
        expect(evaluate({type: "path", glob: "**/一.md"}, view({paths}), noExpand)).toBe(true);
        expect(evaluate({type: "path", glob: "projects://b/设定/**"}, view({paths, unresolvedPaths: true}), noExpand)).toBe("unknown");
        expect(evaluate({type: "path", glob: "project://x"}, view({paths}), () => null)).toBe("unknown");
    });

    test("subject：扩展的对象不用改匹配器", () => {
        expect(evaluate({type: "subject", kind: "host", glob: "prod*"}, view({others: [{kind: "host", value: "prod-1"}]}), noExpand)).toBe(true);
        expect(evaluate({type: "subject", kind: "host", glob: "prod*"}, view({others: [{kind: "host", value: "dev"}]}), noExpand)).toBe(false);
    });

    test("组合是三值的：not 不把算不出来变成命中", () => {
        const unknown = {type: "没有这种"};
        const yes = {type: "arg", path: "a", op: "eq", value: "1"};
        const no = {type: "arg", path: "a", op: "eq", value: "2"};
        const on = view({args: {a: "1"}});
        expect(evaluate({not: unknown}, on, noExpand)).toBe("unknown");
        expect(evaluate({not: no}, on, noExpand)).toBe(true);
        expect(evaluate({all: [yes, unknown]}, on, noExpand)).toBe("unknown");
        expect(evaluate({all: [no, unknown]}, on, noExpand)).toBe(false);
        expect(evaluate({any: [yes, unknown]}, on, noExpand)).toBe(true);
        expect(evaluate({any: [no, unknown]}, on, noExpand)).toBe("unknown");
    });

    test("取不到判定对象：看对象的都算不出来，看参数的照常", () => {
        const on = view({subjectsAvailable: false, args: {a: "1"}});
        expect(evaluate({type: "path", glob: "**"}, on, noExpand)).toBe("unknown");
        expect(evaluate({type: "command", pattern: "rm *"}, on, noExpand)).toBe("unknown");
        expect(evaluate({type: "arg", path: "a", op: "eq", value: "1"}, on, noExpand)).toBe(true);
    });
});

describe("一层的结果（输出 5、12、14）", () => {
    const shell = (pattern: string, action: Rule["action"]): Rule => ({tool: "shell", when: {type: "command", pattern}, action});
    const of = (rules: readonly Rule[], views: readonly CallView[]): RuleHit["action"] | undefined => layerResult(rules, views, noExpand, () => undefined)?.action;
    const commands = (...argvs: string[][]): CallView[] => argvs.map((argv) => view({argv}));

    test("第一条命中；工具名与 id 都认", () => {
        expect(of([shell("rm *", "allow"), shell("rm *", "deny")], commands(["rm", "x"]))).toBe("allow");
        expect(of([{tool: "nbook.agent.*", action: "ask"}], commands(["ls"]))).toBe("ask");
        expect(of([{tool: "other", action: "deny"}], commands(["ls"]))).toBeUndefined();
    });

    test("复合命令：任一条拒绝就拒绝，任一条询问就询问，全部放行才放行，否则没命中", () => {
        const rules = [shell("git status", "allow"), shell("git diff *", "allow"), shell("git push *", "ask"), shell("rm *", "deny")];
        expect(of(rules, commands(["git", "status"], ["git", "diff"]))).toBe("allow");
        expect(of(rules, commands(["git", "status"], ["ls"]))).toBeUndefined();
        expect(of(rules, commands(["git", "status"], ["git", "push"]))).toBe("ask");
        expect(of(rules, commands(["git", "push"], ["rm", "x"]))).toBe("deny");
    });

    test("只读的条没命中不拦放行；全是只读且没命中算没命中", () => {
        const rules = [shell("touch *", "allow")];
        expect(of(rules, [view({argv: ["cd", "a"], readOnly: true}), view({argv: ["touch", "b"]})])).toBe("allow");
        expect(of(rules, [view({argv: ["cd", "a"], readOnly: true})])).toBeUndefined();
    });

    test("写重定向：只看命令的放行规则不放行，路径规则可以；拒绝规则不受影响", () => {
        const redirected = [view({argv: ["echo", "a"], redirectWrites: true, paths: [{access: "write", address: "temps://s/a"}]})];
        expect(of([{tool: "shell", action: "allow"}, {tool: "shell", when: {type: "path", glob: "temps://**"}, action: "deny"}], redirected)).toBe("deny");
        expect(of([shell("echo *", "allow")], redirected)).toBeUndefined();
        expect(of([{tool: "shell", action: "allow"}], redirected)).toBeUndefined();
        expect(of([{tool: "shell", when: {type: "path", glob: "temps://**", access: "write"}, action: "allow"}], redirected)).toBe("allow");
        expect(of([shell("echo *", "deny")], redirected)).toBe("deny");
    });

    test("算不出来：拒绝与询问算命中，放行不算，都报告", () => {
        const reported: string[] = [];
        const broken = (action: Rule["action"]): Rule => ({tool: "shell", when: {type: "没有这种"}, action});
        const result = (action: Rule["action"]) => layerResult([broken(action)], commands(["ls"]), noExpand, (rule) => reported.push(rule.action))?.action;
        expect(result("deny")).toBe("deny");
        expect(result("ask")).toBe("ask");
        expect(result("allow")).toBeUndefined();
        expect(reported).toEqual(["deny", "ask", "allow"]);
    });

    test("看不懂的命令：放行规则不生效，询问与拒绝按文本包含比对", () => {
        const opaque = [view({opaqueText: "eval git push origin"})];
        expect(of([shell("eval *", "allow")], opaque)).toBeUndefined();
        expect(of([{tool: "shell", action: "allow"}], opaque)).toBeUndefined();
        expect(of([shell("git push *", "deny")], opaque)).toBe("deny");
        // 不生效的放行规则等于没写，不挡后面的。
        expect(of([{tool: "shell", action: "allow"}, shell("git push *", "deny")], opaque)).toBe("deny");
        expect(of([shell("git pu* origin", "ask")], opaque)).toBe("ask");
        expect(of([shell("rm *", "deny")], opaque)).toBeUndefined();
    });
});

describe("三层合并（输出 2）", () => {
    const merged = (user: RuleHit["action"] | null, project: RuleHit["action"] | null, session: RuleHit["action"] | null) => mergeLayers({
        user: user === null ? null : hit(user), project: project === null ? null : hit(project), session: session === null ? null : hit(session),
    })?.action ?? null;

    test.each([
        ["项目询问盖不住用户拒绝", "deny", "ask", null, "deny"],
        ["本会话批准盖不住用户拒绝", "deny", null, "allow", "deny"],
        ["本会话批准盖不住项目拒绝", null, "deny", "allow", "deny"],
        ["本会话批准盖过用户询问", "ask", null, "allow", "allow"],
        ["本会话批准盖过项目询问", null, "ask", "allow", "allow"],
        ["项目询问收紧用户放行", "allow", "ask", null, "ask"],
        ["只有用户放行", "allow", null, null, "allow"],
        ["都没命中", null, null, null, null],
    ] as const)("%s", (_name, user, project, session, expected) => {
        expect(merged(user, project, session)).toBe(expected);
    });
});

describe("判定顺序（输出 1）", () => {
    const judged = (rules: RuleHit["action"] | null, gate: GateClass | null, approvalMode: ApprovalMode, effect: ToolEffect = "write", modeWriteAction: ModeWriteAction = "deny"): string => {
        const verdict = decide({rules: rules === null ? null : hit(rules), gate, modeWriteAction, effect, approvalMode});
        return verdict.verdict === "deny" ? `deny:${verdict.rejection.code}` : verdict.verdict;
    };

    const MODES: ApprovalMode[] = ["ask", "allow-writes", "auto", "yolo"];

    test.each(MODES)("%s：拒绝规则先于一切", (mode) => {
        expect(judged("deny", null, mode)).toBe("deny:rule-denied");
        expect(judged("deny", "write", mode)).toBe("deny:rule-denied");
        expect(judged("deny", "read", mode, "read")).toBe("deny:rule-denied");
    });

    test.each(MODES)("%s：闸门算写时，放行规则与审批模式都放不过", (mode) => {
        expect(judged(null, "write", mode)).toBe("deny:mode-blocked");
        expect(judged("allow", "write", mode)).toBe("deny:mode-blocked");
        expect(judged("ask", "write", mode)).toBe("deny:mode-blocked");
        expect(judged(null, "write", mode, "write", "ask")).toBe("ask");
        expect(judged("allow", "write", mode, "write", "ask")).toBe("ask");
    });

    test("放行规则放行；询问规则询问，yolo 下放行", () => {
        expect(judged("allow", null, "ask", "exec")).toBe("allow");
        expect(judged("ask", null, "ask", "read")).toBe("ask");
        expect(judged("ask", null, "allow-writes")).toBe("ask");
        expect(judged("ask", null, "yolo", "exec")).toBe("allow");
    });

    test("只写草稿放行，询问规则照问", () => {
        expect(judged(null, "scratch", "ask")).toBe("allow");
        expect(judged("ask", "scratch", "ask")).toBe("ask");
    });

    test("没命中按审批模式", () => {
        expect(judged(null, null, "ask", "read")).toBe("allow");
        expect(judged(null, null, "ask", "write")).toBe("ask");
        expect(judged(null, null, "ask", "exec")).toBe("ask");
        expect(judged(null, null, "allow-writes", "write")).toBe("allow");
        expect(judged(null, null, "allow-writes", "exec")).toBe("ask");
        expect(judged(null, null, "yolo", "exec")).toBe("allow");
    });

    test("auto：读与作品内写放行，其余交审批模型；规则与闸门排在模型前面", () => {
        const auto = {rules: null, gate: null, modeWriteAction: "deny", approvalMode: "auto"} as const;
        expect(decide({...auto, effect: "read"})).toEqual({verdict: "allow", by: "mode:read"});
        expect(decide({...auto, effect: "write", localWrite: true})).toEqual({verdict: "allow", by: "mode:auto"});
        expect(decide({...auto, effect: "write"})).toEqual({verdict: "review"});
        expect(decide({...auto, effect: "exec"})).toEqual({verdict: "review"});
        expect(decide({...auto, effect: "exec", rules: {action: "allow"}})).toEqual({verdict: "allow", by: "rule"});
        expect(decide({...auto, effect: "exec", rules: {action: "ask"}})).toEqual({verdict: "ask"});
        expect(decide({...auto, effect: "exec", rules: {action: "deny"}}).verdict).toBe("deny");
        expect(decide({...auto, effect: "exec", gate: "write"}).verdict).toBe("deny");
    });

    test("规则的 reason 进给模型的拒绝文字", () => {
        const verdict = decide({rules: {action: "deny", reason: "不许推送"}, gate: null, modeWriteAction: "deny", effect: "exec", approvalMode: "ask"});
        expect(verdict).toEqual({verdict: "deny", rejection: {code: "rule-denied", by: "rule", params: {reason: "不许推送"}}});
    });
});
