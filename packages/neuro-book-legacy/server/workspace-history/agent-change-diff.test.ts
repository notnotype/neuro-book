import {describe, expect, it} from "vitest";
import {agentDiffLineLimit, toAgentChangeDiffDetail} from "nbook/server/workspace-history/agent-change-diff";
import type {WorkspaceHistoryDiffDto} from "nbook/shared/dto/workspace-history.dto";

describe("agent file change diff policy", () => {
    it("512 字符预算派生为 16 条变更行，并内联安全小 diff", () => {
        const detail = toAgentChangeDiffDetail({
            path: "manuscript/ch1.md",
            diff: available("旧句\n", "新句\n", 2),
            maxChars: 512,
        });

        expect(agentDiffLineLimit(512)).toBe(16);
        expect(detail).toMatchObject({
            kind: "inline",
            changedLineCount: 2,
            lineLimit: 16,
            locations: ["新 L1 / 旧 L1"],
        });
        expect(detail.kind === "inline" && detail.diff).toContain("-旧句");
        expect(detail.kind === "inline" && detail.diff).toContain("+新句");
    });

    it("字符数超限时只返回引用摘要所需的 hunk 位置", () => {
        const detail = toAgentChangeDiffDetail({
            path: "manuscript/ch1.md",
            diff: available("", `${"长".repeat(600)}\n`, 1),
            maxChars: 512,
        });

        expect(detail).toMatchObject({
            kind: "reference",
            changedLineCount: 1,
            lineLimit: 16,
            locations: ["新 L1 / 旧 ∅"],
        });
        expect(detail.kind === "reference" && detail.charCount).toBeGreaterThan(512);
    });

    it("大量短行超过派生行数门槛时不内联", () => {
        const text = Array.from({length: 17}, (_, index) => `${index}`).join("\n");
        const detail = toAgentChangeDiffDetail({
            path: "notes/short-lines.md",
            diff: available("", `${text}\n`, 17),
            maxChars: 512,
        });

        expect(detail).toMatchObject({kind: "reference", changedLineCount: 17, lineLimit: 16});
    });

    it("配置为 0 时关闭直接内联但保留位置摘要", () => {
        const detail = toAgentChangeDiffDetail({
            path: "notes/change.md",
            diff: available("a\n", "b\n", 2),
            maxChars: 0,
        });

        expect(agentDiffLineLimit(0)).toBe(0);
        expect(detail).toMatchObject({kind: "reference", lineLimit: 0, locations: ["新 L1 / 旧 L1"]});
    });
});

/** 构造策略测试使用的安全 available diff。 */
function available(original: string, modified: string, changedLineCount: number): Extract<WorkspaceHistoryDiffDto, {status: "available"}> {
    return {
        status: "available",
        original,
        modified,
        changes: [],
        byteSize: new TextEncoder().encode(original).byteLength + new TextEncoder().encode(modified).byteLength,
        changedLineCount,
    };
}
