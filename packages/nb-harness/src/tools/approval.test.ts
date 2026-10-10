import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import {decideApproval, defineTool, MODE_TABLE, resolveApprovalMode} from "./tools";
import type {ApprovalMode, Risk, ToolTier} from "./tools";

const ok = async () => ({ok: true as const, content: "ok"});
const tool = (risk?: Risk) => defineTool({id: "edit", description: "d", parameters: Type.Object({}), ...(risk === undefined ? {} : {risk}), execute: ok});
const decide = (input: {risk?: Risk; mode?: ApprovalMode; config?: Record<string, "allow" | "deny" | "ask">; grants?: {toolName: string; tier?: string}[]; args?: unknown}) =>
    decideApproval({tool: tool(input.risk), args: input.args ?? {}, mode: input.mode ?? "write", config: input.config ?? {}, grants: input.grants ?? []});

describe("模式解析（输出 4）", () => {
    test("依次取会话、配置、Profile；都没有时按是否绑定审批角色取 auto 或 write", () => {
        expect(resolveApprovalMode({session: "yolo", config: "write", profile: "auto", approvalRoleBound: false})).toBe("yolo");
        expect(resolveApprovalMode({config: "always-ask", profile: "auto", approvalRoleBound: true})).toBe("always-ask");
        expect(resolveApprovalMode({profile: "auto", approvalRoleBound: false})).toBe("auto");
        expect(resolveApprovalMode({approvalRoleBound: true})).toBe("auto");
        expect(resolveApprovalMode({approvalRoleBound: false})).toBe("write");
    });
});

describe("判定（输出 5、6）", () => {
    test("场景 3：四种模式 × 三档等级的 12 格", () => {
        const modes: ApprovalMode[] = ["always-ask", "write", "auto", "yolo"];
        const tiers: ToolTier[] = ["read", "write", "exec"];
        const table = Object.fromEntries(modes.map((mode) => [mode, Object.fromEntries(tiers.map((tier) => [tier, decide({risk: tier, mode}).outcome]))]));
        expect(table).toEqual({
            "always-ask": {read: "allow", write: "ask", exec: "ask"},
            write: {read: "allow", write: "allow", exec: "ask"},
            auto: {read: "allow", write: "model", exec: "model"},
            yolo: {read: "allow", write: "allow", exec: "allow"},
        });
        expect(table as unknown as typeof MODE_TABLE).toEqual(MODE_TABLE);
        expect(decide({risk: "exec", mode: "auto"})).toMatchObject({step: 6, tier: "exec"});
        expect(decide({})).toMatchObject({outcome: "ask", tier: "exec", step: 6});
    });

    test("场景 3：步骤 1–5——策略 deny、配置 deny、本会话内允许（等级相同与更高）、策略 ask（yolo 下放行）、配置 allow/ask、风险函数抛错", () => {
        expect(decide({risk: {tier: "read", policy: "deny", reason: "禁区"}, mode: "yolo", config: {edit: "allow"}})).toMatchObject({outcome: "deny", step: 1});
        expect(decide({risk: {tier: "read", policy: "deny"}, mode: "yolo"}).reason).toContain("一律拒绝");
        expect(decide({risk: "read", mode: "yolo", config: {edit: "deny"}, grants: [{toolName: "edit", tier: "exec"}]})).toMatchObject({outcome: "deny", step: 2});
        expect(decide({risk: "write", mode: "always-ask", grants: [{toolName: "edit", tier: "write"}]})).toMatchObject({outcome: "allow", step: 3});
        expect(decide({risk: "write", mode: "always-ask", grants: [{toolName: "edit", tier: "exec"}]})).toMatchObject({outcome: "allow", step: 3});
        expect(decide({risk: "exec", mode: "always-ask", grants: [{toolName: "edit", tier: "write"}]})).toMatchObject({outcome: "ask", step: 6});
        expect(decide({risk: "read", mode: "always-ask", grants: [{toolName: "edit"}]})).toMatchObject({outcome: "allow", step: 3});
        expect(decide({risk: "write", mode: "always-ask", grants: [{toolName: "other", tier: "exec"}]})).toMatchObject({outcome: "ask", step: 6});
        expect(decide({risk: {tier: "read", policy: "ask", reason: "危险命令"}, mode: "auto", config: {edit: "allow"}})).toMatchObject({outcome: "ask", step: 4});
        expect(decide({risk: {tier: "read", policy: "ask"}, mode: "yolo"})).toMatchObject({outcome: "allow", step: 4});
        expect(decide({risk: "exec", mode: "always-ask", config: {edit: "allow"}})).toMatchObject({outcome: "allow", step: 5});
        expect(decide({risk: "read", mode: "yolo", config: {edit: "ask"}})).toMatchObject({outcome: "ask", step: 5});
        const throwing: Risk = () => {
            throw new Error("算不出来");
        };
        expect(decide({risk: throwing, mode: "yolo"})).toMatchObject({outcome: "allow", tier: "exec", step: 4});
        expect(decide({risk: throwing, mode: "write"})).toMatchObject({outcome: "ask", tier: "exec", step: 4});
        expect(decide({risk: throwing, mode: "write"}).reason).toContain("算不出来");
        const byArgs: Risk = (args) => ((args as {path: string}).path === "/etc/passwd" ? {tier: "exec", policy: "deny"} : "read");
        expect(decide({risk: byArgs, args: {path: "/etc/passwd"}, mode: "yolo"}).outcome).toBe("deny");
        expect(decide({risk: byArgs, args: {path: "a.md"}, mode: "always-ask"}).outcome).toBe("allow");
    });
});
