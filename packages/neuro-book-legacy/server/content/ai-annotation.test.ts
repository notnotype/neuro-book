import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {parseAiAnnotationBlocks} from "nbook/server/content/ai-annotation";

type CreateErrorInput = {statusCode?: number; message?: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

describe("parseAiAnnotationBlocks", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input) => Object.assign(new Error(input.message ?? "未知错误"), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("解析 replace 与 command 批注块", () => {
        const text = "A %{取一个名字}% B %!{统一润色}%";
        const replaceRaw = "%{取一个名字}%";
        const commandRaw = "%!{统一润色}%";
        const blocks = parseAiAnnotationBlocks(text);

        expect(blocks).toEqual([
            {
                kind: "replace",
                raw: replaceRaw,
                prompt: "取一个名字",
                rangeStart: text.indexOf(replaceRaw),
                rangeEnd: text.indexOf(replaceRaw) + replaceRaw.length,
            },
            {
                kind: "command",
                raw: commandRaw,
                prompt: "统一润色",
                rangeStart: text.indexOf(commandRaw),
                rangeEnd: text.indexOf(commandRaw) + commandRaw.length,
            },
        ]);
    });

    it("拒绝空批注、嵌套与未闭合语法", () => {
        expect(() => parseAiAnnotationBlocks("%{}%")).toThrowError("AI 批注内容不能为空");
        expect(() => parseAiAnnotationBlocks("%{外层 %!{内层}% }%")).toThrowError("AI 批注暂不支持嵌套");
        expect(() => parseAiAnnotationBlocks("%{未闭合")).toThrowError("AI 批注缺少结束标记 }%");
    });
});
