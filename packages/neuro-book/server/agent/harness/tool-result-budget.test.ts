import {describe, expect, it} from "vitest";
import {boundToolResult, TOOL_RESULT_HARD_MAX_BYTES} from "nbook/server/agent/harness/tool-result-budget";
import {TOOL_RESULT_MAX_BYTES} from "nbook/server/agent/tools/truncate";
import type {AgentOutputSpill} from "nbook/server/agent/tools/agent-output-store";
import type {NeuroToolResult} from "nbook/server/agent/tools/types";

const LOCATOR = "tool-output://11111111-1111-4111-8111-111111111111/output.log";

/** 生成远超硬上限的多行正文。 */
function oversizedText(lines = 4000): string {
    return Array.from({length: lines}, (_, index) => `payload ${index + 1} ${"x".repeat(48)}`).join("\n");
}

/** 拼接模型可见文本。 */
function visibleText(result: NeuroToolResult): string {
    return result.content.map((block) => block.type === "text" ? block.text : "").join("");
}

describe("boundToolResult", () => {
    it("未超过硬上限时原样返回同一结果引用", async () => {
        const result: NeuroToolResult = {content: [{type: "text", text: "short"}], details: {keep: true}};

        await expect(boundToolResult({result})).resolves.toBe(result);
    });

    it("超限文本落盘后只保留头部并写回locator，details与附件块不变", async () => {
        const text = oversizedText();
        const result: NeuroToolResult = {
            content: [
                {type: "text", text},
                {type: "attachment", attachment: {id: "sha256:test", mimeType: "text/plain", bytes: 4}, name: "note.txt"},
            ],
            details: {marker: "keep"},
            terminate: true,
        };
        const spilled: string[] = [];
        const spill = async (value: string): Promise<AgentOutputSpill | null> => {
            spilled.push(value);
            return {locator: LOCATOR, state: "available"};
        };

        const bounded = await boundToolResult({result, spill});

        expect(spilled).toEqual([text]);
        expect(bounded).not.toBe(result);
        const visible = visibleText(bounded);
        expect(visible).toContain("payload 1 ");
        expect(visible).toContain(LOCATOR);
        expect(visible).not.toContain("payload 4000");
        expect(Buffer.byteLength(visible, "utf-8")).toBeLessThan(TOOL_RESULT_MAX_BYTES + 512);
        expect(bounded.content.filter((block) => block.type === "attachment")).toEqual(result.content.filter((block) => block.type === "attachment"));
        expect(bounded.details).toEqual({marker: "keep"});
        expect(bounded.terminate).toBe(true);
    });

    it("落盘不可用时仍截断并给出可见标记", async () => {
        const result: NeuroToolResult = {content: [{type: "text", text: oversizedText()}]};

        const missing = await boundToolResult({result, spill: async () => null});
        expect(visibleText(missing)).toContain("无法落盘");
        expect(Buffer.byteLength(visibleText(missing), "utf-8")).toBeLessThan(TOOL_RESULT_MAX_BYTES + 512);

        const failing = await boundToolResult({
            result,
            spill: async () => {
                throw new Error("cache down");
            },
        });
        expect(visibleText(failing)).toContain("无法落盘");
    });
    it("超限结果的locator位于发送前头部裁剪可保留的位置", async () => {
        const text = oversizedText();
        const bounded = await boundToolResult({
            result: {content: [{type: "text", text}]},
            spill: async () => ({locator: LOCATOR, state: "available"}),
        });

        expect(visibleText(bounded).indexOf(LOCATOR)).toBeLessThan(2_000);
    });

    it("单行正文超过上限时保留字节前缀且不切断UTF-8码位", async () => {
        const result: NeuroToolResult = {content: [{type: "text", text: "中".repeat(TOOL_RESULT_HARD_MAX_BYTES + 1)}]};

        const bounded = await boundToolResult({result, spill: async () => ({locator: LOCATOR, state: "available"})});

        const visible = visibleText(bounded);
        expect(visible).toContain(LOCATOR);
        expect(visible).not.toContain("\uFFFD");
    });
});
