import {describe, expect, it} from "vitest";
import {
    AgentInvokeRequestDtoSchema,
    AgentSessionAttachmentListQueryDtoSchema,
    AgentSessionAttachmentResolveRequestDtoSchema,
    AgentSessionListQueryDtoSchema,
    AgentSessionQueryDtoSchema,
    AgentAbortRequestDtoSchema,
    ClientVariablePatchAckDtoSchema,
} from "nbook/shared/dto/agent-session.dto";
describe("AgentAbortRequestDtoSchema", () => {
    it("拒绝未知字段而不是静默剥离", () => {
        expect(AgentAbortRequestDtoSchema.safeParse({unexpected: true}).success).toBe(false);
        expect(AgentAbortRequestDtoSchema.parse({reason: "停止", clearQueue: false})).toEqual({
            reason: "停止",
            clearQueue: false,
        });
    });
});


describe("AgentSessionListQueryDtoSchema", () => {
    it("recovery=required 只允许与 scope=all 组合并保留分页参数", () => {
        expect(AgentSessionListQueryDtoSchema.parse({
            scope: "all",
            recovery: "required",
            offset: "20",
            limit: "10",
        })).toEqual({
            scope: "all",
            recovery: "required",
            offset: 20,
            limit: 10,
        });

        expect(AgentSessionListQueryDtoSchema.safeParse({
            scope: "project",
            projectRoot: "novel-a",
            recovery: "required",
        }).success).toBe(false);
        expect(AgentSessionListQueryDtoSchema.safeParse({
            scope: "workspace-root",
            recovery: "required",
        }).success).toBe(false);
        expect(AgentSessionListQueryDtoSchema.safeParse({
            recovery: "required",
        }).success).toBe(false);
    });
});

describe("AgentInvokeRequestDtoSchema", () => {
    it("要求 prompt、steer、followup 携带 message 或 input", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "steer",
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "followup",
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "steer",
            clientMessageId: "00000000-0000-4000-8000-000000000001",
            message: {text: "调整"},
        }).success).toBe(true);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "followup",
            clientMessageId: "00000000-0000-4000-8000-000000000002",
            input: {plotId: "plot-1"},
        }).success).toBe(true);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "prompt",
            clientMessageId: "00000000-0000-4000-8000-000000000003",
            input: {plotId: "plot-1"},
        }).success).toBe(true);
    });

    it("要求创建用户输入的模式携带 clientMessageId，并拒绝 continue 携带", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "prompt",
            message: {text: "缺少关联 ID"},
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "continue",
            clientMessageId: "00000000-0000-4000-8000-000000000004",
        }).success).toBe(false);
    });

    it("拒绝 continue 携带 message 或 input", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "continue",
            message: {text: "不应出现"},
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "continue",
            input: {plotId: "plot-1"},
        }).success).toBe(false);
    });

    it("拒绝前端提交内部 caller identity", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "prompt",
            message: {text: "hello"},
            caller: {kind: "agent"},
        }).success).toBe(false);
    });

    it("硬切拒绝旧 message.images base64 ingress", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "prompt",
            message: {
                text: "旧请求",
                images: [{type: "image", mimeType: "image/png", data: "iVBORw0KGgo="}],
            },
        }).success).toBe(false);
    });

    it("resolution toolCallId 按UTF-8字节统一fail closed", () => {
        const request = (toolCallId: string) => ({
            mode: "continue",
            resolution: {kind: "tool_approval", toolCallId, approved: true},
        });
        expect(AgentInvokeRequestDtoSchema.safeParse(request("a".repeat(512))).success).toBe(true);
        expect(AgentInvokeRequestDtoSchema.safeParse(request("a".repeat(513))).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse(request("工".repeat(170))).success).toBe(true);
        expect(AgentInvokeRequestDtoSchema.safeParse(request("工".repeat(171))).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse(request(" ")).success).toBe(false);
    });

    it("client patch ack 只在存在toolCallId时应用同一身份合同", () => {
        const base = {namespace: "client", path: "ide.selection", operations: []};
        expect(ClientVariablePatchAckDtoSchema.safeParse(base).success).toBe(true);
        expect(ClientVariablePatchAckDtoSchema.safeParse({...base, toolCallId: "tool-1"}).success).toBe(true);
        expect(ClientVariablePatchAckDtoSchema.safeParse({...base, toolCallId: "工".repeat(172)}).success).toBe(false);
    });
});

describe("AgentSessionAttachmentListQueryDtoSchema", () => {
    it("分页默认 40、最大 100，并严格拒绝未知参数", () => {
        expect(AgentSessionAttachmentListQueryDtoSchema.parse({})).toEqual({offset: 0, limit: 40});
        expect(AgentSessionAttachmentListQueryDtoSchema.parse({search: "PNG", offset: "20", limit: "100"})).toEqual({
            search: "PNG",
            offset: 20,
            limit: 100,
        });
        expect(AgentSessionAttachmentListQueryDtoSchema.safeParse({limit: 101}).success).toBe(false);
        expect(AgentSessionAttachmentListQueryDtoSchema.safeParse({unknown: "value"}).success).toBe(false);
    });
});

describe("AgentSessionAttachmentResolveRequestDtoSchema", () => {
    const first = `sha256:${"1".repeat(64)}`;
    const second = `sha256:${"2".repeat(64)}`;

    it("严格接受 1–8 个不重复 Attachment ID", () => {
        expect(AgentSessionAttachmentResolveRequestDtoSchema.parse({attachmentIds: [first, second]}))
            .toEqual({attachmentIds: [first, second]});
        expect(AgentSessionAttachmentResolveRequestDtoSchema.safeParse({attachmentIds: []}).success).toBe(false);
        expect(AgentSessionAttachmentResolveRequestDtoSchema.safeParse({attachmentIds: [first, first]}).success).toBe(false);
        expect(AgentSessionAttachmentResolveRequestDtoSchema.safeParse({
            attachmentIds: Array.from({length: 9}, (_, index) => `sha256:${index.toString(16).repeat(64)}`),
        }).success).toBe(false);
        expect(AgentSessionAttachmentResolveRequestDtoSchema.safeParse({
            attachmentIds: [first],
            unknown: true,
        }).success).toBe(false);
    });
});

describe("AgentSessionQueryDtoSchema", () => {
    it("只接受 recovery、history、systemPrompt 三种严格判别查询", () => {
        expect(AgentSessionQueryDtoSchema.parse({})).toEqual({});
        expect(AgentSessionQueryDtoSchema.parse({view: "recovery"})).toEqual({view: "recovery"});
        expect(AgentSessionQueryDtoSchema.parse({view: "history", cursor: "cursor-1"})).toEqual({
            view: "history",
            cursor: "cursor-1",
        });
        expect(AgentSessionQueryDtoSchema.parse({view: "systemPrompt"})).toEqual({view: "systemPrompt"});

        expect(AgentSessionQueryDtoSchema.safeParse({view: "history"}).success).toBe(false);
        expect(AgentSessionQueryDtoSchema.safeParse({cursor: "cursor-1"}).success).toBe(false);
        expect(AgentSessionQueryDtoSchema.safeParse({view: "systemPrompt", cursor: "cursor-1"}).success).toBe(false);
        expect(AgentSessionQueryDtoSchema.safeParse({view: "recovery", cursor: "cursor-1"}).success).toBe(false);
    });
});
