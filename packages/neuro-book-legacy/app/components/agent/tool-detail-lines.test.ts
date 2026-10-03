import {describe, expect, it} from "vitest";
import type {ToolCallView} from "./agent-view.types";
import {fileContentLines, fileDiffLines, splitLines} from "./tool-detail-lines";

function call(name: string, args: ToolCallView["args"], resultText?: string): ToolCallView {
    return {id: "c1", name, status: "success", args, ...(resultText === undefined ? {} : {result: {text: resultText, truncated: false}})};
}

describe("tool-detail-lines", () => {
    it("末尾换行不产生空行", () => {
        expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
        expect(splitLines("")).toEqual([]);
    });

    it("读取结果从 offset 开始编号", () => {
        expect(fileContentLines(call("read", {path: "a.md", offset: 41}, "x\ny")).startLine).toBe(41);
        expect(fileContentLines(call("read", {path: "a.md"}, "x")).startLine).toBe(1);
    });

    it("edit 每个片段先删后增，片段之间加省略行", () => {
        const lines = fileDiffLines(call("edit", {path: "a.md", edits: [{oldText: "旧1\n旧2", newText: "新"}, {oldText: "甲", newText: "乙"}]}));
        expect(lines.map((line) => `${line.tone}:${line.text}`)).toEqual([
            "removed:旧1", "removed:旧2", "added:新", "muted:⋯", "removed:甲", "added:乙",
        ]);
    });

    it("apply_patch 去掉行首符号并按符号着色，文件头淡色", () => {
        const lines = fileDiffLines(call("apply_patch", {patch: "*** Update File: a.md\n-旧\n+新\n 不变"}));
        expect(lines.map((line) => `${line.tone ?? "plain"}:${line.text}`)).toEqual([
            "muted:*** Update File: a.md", "removed:旧", "added:新", "plain:不变",
        ]);
    });

    it("write 全部为新增", () => {
        expect(fileDiffLines(call("write", {path: "a.md", content: "一\n二\n"})).every((line) => line.tone === "added")).toBe(true);
    });
});
