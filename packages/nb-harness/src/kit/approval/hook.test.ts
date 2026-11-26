/**
 * 审批钩子（docs/specs/agent/permissions.md 输出 1、6、7、17–19；agent/modes.md 输出 1）：规则、闸门与审批模式怎样交到审批者与
 * 转问手里，转问的来源，缺省转问与不传相同，转问之后的“本会话都批准”。文件访问用本机参考实现，审批者与转问是测试给的宿主实现。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ApprovalCtx, ApprovalInfo, ApprovalMode, ApprovalVerdict, ToolEffect, ToolSessionContext} from "../../kernel/contracts.js";
import {createDialects} from "../commands/index.js";
import type {SessionFiles} from "../files/index.js";
import {localFiles} from "../files/local.js";
import type {Rule, ToolSubject} from "../shapes.js";
import {createApprovalHook} from "./hook.js";
import type {ApprovalHookOptions} from "./hook.js";
import type {Escalation, ReviewRequest} from "./types.js";

const GATE = {askReason: "gate-ask", blockedText: "gate-blocked"};
const context = {sessionId: "s-1", profile: "p"} as ToolSessionContext;

let root = "";
let files: SessionFiles;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "approval-hook");
    await mkdir(join(root, "work", "home"), {recursive: true});
    ({files} = localFiles({
        roots: {work: join(root, "work")},
        aliases: {home: "work://home"},
        layout: {working: "home://", scratch: ["home://"], localWrites: ["home://"], shellEnv: {}, searchExcludes: () => []},
        // `work://settings` 下的写要另外问（宿主的“用户设置”这类）。
        classify: (address) => (address.startsWith("work://settings") ? "ask" : "allowed"),
        artifacts: "work://artifacts",
    }));
});
afterEach(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 工具交出的判定对象：写工具交路径，shell 交命令，截图交画面加一条路径。 */
async function subjectsOf(tool: string, args: Readonly<Record<string, unknown>>): Promise<readonly ToolSubject[] | null> {
    if (tool === "kit.write") return [{kind: "path", access: "write", address: args.path as string}];
    if (tool === "kit.shell") return [{kind: "command", dialect: "bash", text: args.command as string}];
    if (tool === "kit.shot") return [{kind: "screen", value: "window"}, {kind: "path", access: "read", address: "work://a.md"}];
    return [];
}

interface Setup {
    readonly hook: ReturnType<typeof createApprovalHook>;
    readonly reviewed: ReviewRequest[];
    readonly escalated: Escalation[];
    readonly reports: string[];
}

function setup(overrides: Partial<ApprovalHookOptions> & {readonly reviewer?: ApprovalVerdict; readonly withEscalate?: boolean} = {}): Setup {
    const reviewed: ReviewRequest[] = [];
    const escalated: Escalation[] = [];
    const reports: string[] = [];
    const hook = createApprovalHook({
        files: () => files,
        userRules: () => [],
        projectRules: async () => [],
        projectRulesInvalidMessage: "项目规则读不了",
        dialects: createDialects(() => []),
        gated: () => false,
        modeWriteAction: () => "ask",
        gate: GATE,
        subjectsOf,
        review: async (request) => {
            reviewed.push(request);
            return overrides.reviewer ?? {verdict: "allow", by: "reviewer"};
        },
        ...(overrides.withEscalate === false ? {} : {escalate: async (escalation) => {
            escalated.push(escalation);
            return {verdict: "ask", ...(escalation.reason === undefined ? {} : {reason: escalation.reason})};
        }}),
        report: (code, message) => reports.push(`${code}:${message}`),
        ...overrides,
    });
    return {hook, reviewed, escalated, reports};
}

function judge(setupResult: Setup, tool: string, args: Readonly<Record<string, unknown>>, effect: ToolEffect, mode: ApprovalMode): Promise<ApprovalVerdict> {
    const info = {tool: {id: tool, providerName: tool.slice(4)}, effect, mode, readOnly: false, remembered: [], rememberedRules: []} as unknown as ApprovalInfo;
    const ctx = {signal: new AbortController().signal, sessionId: context.sessionId, context, model: async () => { throw new Error("不该调模型"); }, read: () => undefined} as unknown as ApprovalCtx;
    return setupResult.hook({id: "call-1", tool, args}, info, ctx);
}

const writeArgs = (path: string) => ({path, content: "x"});
const rule = (action: Rule["action"], reason?: string): Rule => ({tool: "kit.*", action, ...(reason === undefined ? {} : {reason})});

describe("转问的来源", () => {
    test("rule：某层规则判 ask，原因是规则的；yolo 下放行、不转问", async () => {
        const s = setup({userRules: () => [rule("ask", "要问一下")]});
        expect(await judge(s, "kit.write", writeArgs("home://a.md"), "write", "ask")).toEqual({verdict: "ask", reason: "要问一下"});
        expect(s.escalated.map((item) => [item.source, item.reason])).toEqual([["rule", "要问一下"]]);
        expect(await judge(s, "kit.write", writeArgs("home://a.md"), "write", "yolo")).toEqual({verdict: "allow", by: "mode:yolo"});
        expect(s.escalated).toHaveLength(1);
    });

    test("rules-invalid：项目规则读坏，本来放行的写也问，诊断用宿主给的消息；读照常放行", async () => {
        const s = setup({projectRules: async () => "invalid"});
        await judge(s, "kit.write", writeArgs("home://a.md"), "write", "allow-writes");
        expect(s.escalated.map((item) => item.source)).toEqual(["rules-invalid"]);
        expect(s.reports).toContain("permission-rules-invalid:项目规则读不了");
        expect(await judge(s, "kit.read", {path: "home://a.md"}, "read", "ask")).toEqual({verdict: "allow", by: "mode:read"});
    });

    test("address：写的地址分类为 ask，别的规则放行也问；与项目规则读坏同时成立时记后改的 address", async () => {
        const s = setup({userRules: () => [rule("allow")]});
        await judge(s, "kit.write", writeArgs("work://settings/a.json"), "write", "allow-writes");
        expect(s.escalated.map((item) => item.source)).toEqual(["address"]);
        const both = setup({projectRules: async () => "invalid"});
        await judge(both, "kit.write", writeArgs("work://settings/a.json"), "write", "allow-writes");
        expect(both.escalated.map((item) => item.source)).toEqual(["address"]);
    });

    test("gate：闸门下写出草稿，闸门动作是 ask 时转问带闸门的原因；动作是 deny 时直接拒绝、不转问；只写草稿放行", async () => {
        const asking = setup({gated: () => true});
        expect(await judge(asking, "kit.write", writeArgs("work://out.md"), "write", "yolo")).toEqual({verdict: "ask", reason: GATE.askReason});
        expect(asking.escalated.map((item) => item.source)).toEqual(["gate"]);
        expect(await judge(asking, "kit.write", writeArgs("home://draft.md"), "write", "ask")).toEqual({verdict: "allow", by: "mode:scratch"});
        const denying = setup({gated: () => true, modeWriteAction: () => "deny"});
        expect(await judge(denying, "kit.write", writeArgs("work://out.md"), "write", "yolo")).toEqual({verdict: "deny", rejection: {code: "mode-blocked", by: "mode", params: {reason: GATE.blockedText}}});
        expect(denying.escalated).toHaveLength(0);
    });

    test("mode：审批模式本身要问时没有原因", async () => {
        const s = setup();
        expect(await judge(s, "kit.write", writeArgs("work://out.md"), "write", "ask")).toEqual({verdict: "ask"});
        expect(s.escalated.map((item) => [item.source, item.reason])).toEqual([["mode", undefined]]);
    });

    test("reviewer：auto 下交给审批者，审批者转人工时经转问，带审批者的原因与展开过的路径", async () => {
        const s = setup({reviewer: {verdict: "ask", reason: "看不懂"}});
        expect(await judge(s, "kit.write", writeArgs("work://out.md"), "write", "auto")).toEqual({verdict: "ask", reason: "看不懂"});
        expect(s.reviewed.map((item) => item.paths)).toEqual([[{access: "write", address: "work://out.md"}]]);
        expect(s.escalated.map((item) => [item.source, item.reason])).toEqual([["reviewer", "看不懂"]]);
    });

    test("reviewer：路径与命令之外的判定对象原样交给审批者", async () => {
        const s = setup();
        await judge(s, "kit.shot", {}, "exec", "auto");
        expect(s.reviewed.map((item) => [item.subjects, item.paths])).toEqual([[[{kind: "screen", value: "window"}], [{access: "read", address: "work://a.md"}]]]);
    });
});

describe("审批者与转问由宿主给", () => {
    test("auto：本地写（布局的 localWrites）直接放行、不问审批者；规则先判：放行不问，询问转问，拒绝直接拒", async () => {
        const s = setup();
        expect(await judge(s, "kit.write", writeArgs("home://a.md"), "write", "auto")).toEqual({verdict: "allow", by: "mode:auto"});
        expect(s.reviewed).toHaveLength(0);
        const ruled = (action: Rule["action"]) => setup({userRules: () => [rule(action)]});
        const allowed = ruled("allow");
        expect(await judge(allowed, "kit.write", writeArgs("work://out.md"), "write", "auto")).toEqual({verdict: "allow", by: "rule"});
        expect(allowed.reviewed).toHaveLength(0);
        const asked = ruled("ask");
        await judge(asked, "kit.write", writeArgs("work://out.md"), "write", "auto");
        expect([asked.reviewed.length, asked.escalated.map((item) => item.source)]).toEqual([0, ["rule"]]);
        expect((await judge(ruled("deny"), "kit.write", writeArgs("work://out.md"), "write", "auto")).verdict).toBe("deny");
    });

    test("转问交回的结论就是钩子的结论；不传转问时与原样交回询问相同", async () => {
        const allowing = setup({escalate: async () => ({verdict: "allow", by: "bot"})});
        expect(await judge(allowing, "kit.write", writeArgs("work://out.md"), "write", "ask")).toEqual({verdict: "allow", by: "bot"});
        const plain = setup({withEscalate: false, userRules: () => [rule("ask", "要问一下")], reviewer: {verdict: "ask", reason: "看不懂"}});
        expect(await judge(plain, "kit.write", writeArgs("work://out.md"), "write", "ask")).toEqual({verdict: "ask", reason: "要问一下"});
        const reviewedPlain = setup({withEscalate: false, reviewer: {verdict: "ask", reason: "看不懂"}});
        expect(await judge(reviewedPlain, "kit.write", writeArgs("work://out.md"), "write", "auto")).toEqual({verdict: "ask", reason: "看不懂"});
    });

    test("输出 18：转问之后仍要问、调用含命令时带“本会话都批准”的前缀；转问放行时不带", async () => {
        const s = setup();
        expect(await judge(s, "kit.shell", {command: "git push origin main"}, "exec", "ask")).toEqual({verdict: "ask", remember: {label: "git push *", rules: [{tool: "kit.shell", when: {type: "command", pattern: "git push *"}, action: "allow"}]}});
        const allowing = setup({escalate: async () => ({verdict: "allow", by: "bot"})});
        expect(await judge(allowing, "kit.shell", {command: "git push origin main"}, "exec", "ask")).toEqual({verdict: "allow", by: "bot"});
    });
});
