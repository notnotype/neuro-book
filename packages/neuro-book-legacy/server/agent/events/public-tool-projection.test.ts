import {describe, expect, it} from "vitest";
import {projectPublicToolArgs, projectPublicToolResult, valuePreview} from "nbook/server/agent/events/public-tool-projection";

describe("projectPublicToolArgs", () => {
    it("write 正文只公开有界预览和原始 UTF-8 字节数", () => {
        const content = "章".repeat(800_000);

        const projected = projectPublicToolArgs("write", {
            path: "manuscript/chapter-1.md",
            content,
        });

        expect(projected).toEqual({
            kind: "write",
            path: "manuscript/chapter-1.md",
            contentPreview: expect.any(String),
            contentBytes: Buffer.byteLength(content, "utf8"),
            contentOmitted: true,
        });
        expect(Buffer.byteLength(projected.kind === "write" ? projected.contentPreview : "", "utf8")).toBeLessThanOrEqual(16 * 1024);
        expect(JSON.stringify(projected)).not.toContain(content);
    });

    it("edit 每个 replacement 都只公开有界 old/new 预览", () => {
        const oldText = "旧".repeat(20_000);
        const newText = "新".repeat(20_000);

        const projected = projectPublicToolArgs("edit", {
            path: "manuscript/chapter-1.md",
            edits: [{oldText, newText}],
        });

        expect(projected.kind).toBe("edit");
        if (projected.kind !== "edit") {
            return;
        }
        expect(projected.path).toBe("manuscript/chapter-1.md");
        expect(projected.edits).toHaveLength(1);
        expect(projected.edits[0]).toEqual({
            oldTextPreview: expect.any(String),
            oldTextBytes: Buffer.byteLength(oldText, "utf8"),
            oldTextOmitted: true,
            newTextPreview: expect.any(String),
            newTextBytes: Buffer.byteLength(newText, "utf8"),
            newTextOmitted: true,
        });
        expect(projected.omittedEdits).toBe(0);
        expect(JSON.stringify(projected)).not.toContain(oldText);
        expect(JSON.stringify(projected)).not.toContain(newText);
    });

    it("apply_patch 公开 touchedFiles 和有界 patch 预览", () => {
        const body = "+正文\n".repeat(100_000);
        const patch = [
            "*** Begin Patch",
            "*** Update File: manuscript/chapter-1.md",
            "@@",
            body,
            "*** Add File: lorebook/new.md",
            body,
            "*** End Patch",
        ].join("\n");

        const projected = projectPublicToolArgs("apply_patch", {patch});

        expect(projected.kind).toBe("apply_patch");
        if (projected.kind !== "apply_patch") {
            return;
        }
        expect(projected.touchedFiles).toEqual([
            "manuscript/chapter-1.md",
            "lorebook/new.md",
        ]);
        expect(projected.touchedFilesOmitted).toBe(false);
        expect(projected.patchBytes).toBe(Buffer.byteLength(patch, "utf8"));
        expect(projected.patchOmitted).toBe(true);
        expect(Buffer.byteLength(projected.patchPreview, "utf8")).toBeLessThanOrEqual(16 * 1024);
        expect(JSON.stringify(projected)).not.toContain(body);
    });

    it("apply_patch 的长 touched files 共用路径预算", () => {
        const patch = Array.from({length: 64}, (_, index) => `*** Update File: ${String(index).padStart(2, "0")}-${"a".repeat(2040)}\n@@`).join("\n");
        const projected = projectPublicToolArgs("apply_patch", {patch});

        expect(projected.kind).toBe("apply_patch");
        if (projected.kind !== "apply_patch") return;
        expect(projected.touchedFilesOmitted).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(96 * 1024);
    });

    it("unknown 深层对象共享单一正文预算，不会按节点倍增", () => {
        const large = "值".repeat(100_000);
        const input = Object.fromEntries(Array.from({length: 32}, (_, index) => [
            `field-${String(index)}`,
            {nested: Array.from({length: 32}, () => large)},
        ]));

        const projected = valuePreview(input);

        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(64 * 1024);
        expect(JSON.stringify(projected)).not.toContain(large);
    });
});

describe("projectPublicToolResult", () => {
    it("stored attachment 只公开 metadata，并保留过滤前的原 contentIndex", () => {
        const projected = projectPublicToolResult("read", {
            content: [
                {type: "unsupported", secret: "不能公开"},
                {type: "text", text: "图片如下"},
                {
                    type: "attachment",
                    attachment: {
                        id: `sha256:${"a".repeat(64)}`,
                        mimeType: "image/png",
                        bytes: 7_170_689,
                    },
                    name: "世界地图.png",
                },
            ],
        });

        expect(projected.content).toEqual([
            {
                type: "text",
                contentIndex: 1,
                textPreview: "图片如下",
                textBytes: Buffer.byteLength("图片如下", "utf8"),
                textOmitted: false,
            },
            {
                type: "attachment",
                contentIndex: 2,
                attachment: {
                    attachmentId: `sha256:${"a".repeat(64)}`,
                    mimeType: "image/png",
                    bytes: 7_170_689,
                    name: "世界地图.png",
                    dataOmitted: true,
                },
            },
        ]);
        expect(JSON.stringify(projected)).not.toContain("不能公开");
    });

    it("图片结果不公开 base64，只保留 MIME、原始字节数和 omitted", () => {
        const data = Buffer.alloc(7 * 1024 * 1024, 7).toString("base64");

        const projected = projectPublicToolResult("read", {
            content: [{
                type: "image",
                mimeType: "image/png",
                data,
            }],
            details: {
                path: "manuscript/cover.png",
            },
        });

        expect(projected.content).toEqual([{
            type: "image",
            contentIndex: 0,
            mimeType: "image/png",
            dataBytes: 7 * 1024 * 1024,
            dataOmitted: true,
        }]);
        expect(projected.omittedContentBlocks).toBe(0);
        expect(JSON.stringify(projected)).not.toContain(data);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(128 * 1024);
    });

    it("图片 MIME 也必须是有界公开字符串", () => {
        const mimeType = "application/x-" + "m".repeat(10_000);
        const projected = projectPublicToolResult("read", {
            content: [{type: "image", mimeType, data: "AAAA"}],
        });

        expect(projected.content).toEqual([{
            type: "image",
            contentIndex: 0,
            mimeType: expect.any(String),
            dataBytes: 3,
            dataOmitted: true,
        }]);
        const image = projected.content[0];
        if (image?.type !== "image") return;
        expect(Buffer.byteLength(image.mimeType, "utf8")).toBeLessThanOrEqual(256);
        expect(image.mimeType).not.toContain(mimeType);
    });

    it("多个文本 block 共享结果预览预算", () => {
        const text = "输出".repeat(100_000);
        const projected = projectPublicToolResult("bash", {
            content: Array.from({length: 32}, () => ({type: "text", text})),
        });

        expect(projected.content).toHaveLength(32);
        expect(projected.content.every((block) => block.type !== "text" || block.textOmitted)).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(64 * 1024);
    });

    it("edit/apply_patch diff 使用专用有界 details", () => {
        const diff = "-旧\n+新\n".repeat(100_000);
        const projected = projectPublicToolResult("apply_patch", {
            content: [{type: "text", text: "ok"}],
            details: {
                diff,
                firstChangedLine: 12,
                files: [{path: "manuscript/chapter-1.md"}],
            },
        });

        expect(projected.details).toEqual({
            kind: "file_change",
            diffPreview: expect.any(String),
            diffBytes: Buffer.byteLength(diff, "utf8"),
            diffOmitted: true,
            firstChangedLine: 12,
            files: ["manuscript/chapter-1.md"],
            filesOmitted: false,
        });
        expect(JSON.stringify(projected)).not.toContain(diff);
    });

    it("read/bash 只公开工具卡需要的轻量 metadata", () => {
        const read = projectPublicToolResult("read", {
            content: [],
            details: {path: "workspace/book/manuscript/a.md", startLine: 2, endLine: 20, totalLines: 50, nextOffset: 21, ignored: "x".repeat(100_000)},
        });
        const bash = projectPublicToolResult("bash", {
            content: [],
            details: {
                truncation: {truncated: true, truncatedBy: "bytes", totalLines: 3000, totalBytes: 100_000, content: "x".repeat(100_000)},
                fullOutput: {locator: "bash-output://12345678-1234-4123-8123-123456789abc/output.log", state: "available"},
            },
        });

        expect(read.details).toEqual({
            kind: "read",
            path: "workspace/book/manuscript/a.md",
            startLine: 2,
            endLine: 20,
            totalLines: 50,
            nextOffset: 21,
        });
        expect(bash.details).toEqual({
            kind: "bash",
            truncated: true,
            truncatedBy: "bytes",
            totalLines: 3000,
            totalBytes: 100_000,
            fullOutput: {locator: "bash-output://12345678-1234-4123-8123-123456789abc/output.log", state: "available"},
        });
    });

    it("request/switch/task/agent details 使用专用判别类型", () => {
        const request = projectPublicToolResult("request_user_input", {content: [], details: {answers: [{questionIndex: 0, text: "继续"}]}});
        const mode = projectPublicToolResult("switch_mode", {content: [], details: {approved: true, pending: true, targetMode: "normal"}});
        const task = projectPublicToolResult("task_create", {content: [], details: {steps: [{id: "1", text: "执行", status: "pending"}]}});
        const agent = projectPublicToolResult("invoke_agent", {content: [], details: {sessionId: 12, profileKey: "writer", status: "completed", large: "x".repeat(100_000)}});

        expect(request.details).toEqual({kind: "request_user_input", answers: [{questionIndex: 0, text: "继续"}], omittedAnswers: 0});
        expect(mode.details).toEqual({kind: "switch_mode", approved: true, pending: true, targetMode: "normal"});
        expect(task.details).toEqual(expect.objectContaining({kind: "task"}));
        expect(agent.details).toEqual(expect.objectContaining({kind: "agent", sessionId: 12, profileKey: "writer", status: "completed"}));
        expect(Buffer.byteLength(JSON.stringify(agent), "utf8")).toBeLessThan(64 * 1024);
    });

    it("request answers 与 content 各自共享预算且完整结果低于事件硬上限", () => {
        const large = "回答🙂".repeat(2_048);
        const projected = projectPublicToolResult("request_user_input", {
            content: [{type: "text", text: large}],
            details: {
                answers: Array.from({length: 32}, (_, questionIndex) => ({
                    questionIndex,
                    text: large,
                    note: large,
                    selectedOptionIndex: 0,
                    ignored: false,
                })),
            },
        });

        expect(Buffer.byteLength(JSON.stringify({
            eventEpoch: "epoch",
            seq: 1,
            sessionId: 1,
            kind: "runtime",
            invocationId: "run-1",
            event: {type: "tool_execution_end", toolCallId: "call-1", toolName: "request_user_input", result: projected, isError: false},
        }), "utf8")).toBeLessThan(128 * 1024);
        expect(projected.details?.kind).toBe("request_user_input");
        if (projected.details?.kind !== "request_user_input") return;
        expect(projected.details.answers).toHaveLength(32);
        expect(projected.details.answers.some((answer) => answer.textOmitted || answer.noteOmitted)).toBe(true);
        expect(projected.details.omittedAnswers).toBe(0);
        expect(JSON.stringify(projected)).not.toContain(large);
    });
});
