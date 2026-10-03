import {beforeAll, describe, expect, it} from "vitest";
import {
    normalizeStructuredReferences,
    processContentText,
} from "nbook/server/content/content-middleware";
import {
    LOREBOOK_STRUCTURED_REFERENCE_KINDS,
    STORY_STRUCTURED_REFERENCE_KINDS,
} from "nbook/shared/reference-core";

beforeAll(() => {
    (globalThis as typeof globalThis & {
        createError?: (input: {statusCode?: number; message?: string}) => Error & {statusCode?: number};
    }).createError = ({statusCode, message}) => Object.assign(new Error(message), {statusCode});
});

describe("content-middleware", () => {
    it("规范化 legacy inline markdown，并提取完整 inline ref 结果", () => {
        const result = processContentText("A [旧章](@chapter://1) B @scene://24 %{写一个转折}%");

        expect(result.raw).toBe("A [旧章](@chapter://1) B @scene://24 %{写一个转折}%");
        expect(result.normalized).toBe("A [旧章](chapter://1) B @scene://24 %{写一个转折}%");
        expect(result.resolved).toBe(result.normalized);
        expect(result.diagnostics).toEqual({
            errors: [],
            warnings: ["legacy inline 引用已自动规范化 1 处"],
            notes: ["识别到 2 个 inline 引用", "识别到 1 个 AI 批注块"],
        });
        expect(result.annotations).toEqual([
            {
                kind: "replace",
                raw: "%{写一个转折}%",
                prompt: "写一个转折",
                rangeStart: result.normalized.indexOf("%{写一个转折}%"),
                rangeEnd: result.normalized.indexOf("%{写一个转折}%") + "%{写一个转折}%".length,
            },
        ]);
        expect(result.inlineRefs).toEqual([
            {
                kind: "chapter",
                targetId: "1",
                raw: "[旧章](chapter://1)",
                target: "chapter://1",
                title: "旧章",
                start: result.normalized.indexOf("[旧章](chapter://1)"),
                end: result.normalized.indexOf("[旧章](chapter://1)") + "[旧章](chapter://1)".length,
                syntax: "markdown",
            },
            {
                kind: "scene",
                targetId: "24",
                raw: "@scene://24",
                target: "scene://24",
                title: null,
                start: result.normalized.indexOf("@scene://24"),
                end: result.normalized.indexOf("@scene://24") + "@scene://24".length,
                syntax: "bare",
            },
        ]);
    });

    it("规范化内容节点 refs 到 workspace 相对路径", () => {
        const result = normalizeStructuredReferences({
            refs: [
                {relation: "关联", target: "lorebook:人物/主角", visibility: "author", note: null},
                {relation: "伏笔", target: "lorebook/note/高潮/", visibility: "reader", note: "后续确认"},
            ],
            allowedKinds: LOREBOOK_STRUCTURED_REFERENCE_KINDS,
            label: "lorebook",
        });

        expect(result.normalized).toEqual([
            {relation: "关联", target: "人物/主角", visibility: "author", note: null},
            {relation: "伏笔", target: "lorebook/note/高潮/", visibility: "reader", note: "后续确认"},
        ]);
        expect(result.diagnostics).toEqual({
            errors: [],
            warnings: ["legacy structured 引用已自动规范化 1 处"],
            notes: ["识别到 2 个 structured ref"],
        });
    });

    it("拒绝不在 allowed kinds 中的 structured ref", () => {
        expect(() => normalizeStructuredReferences({
            refs: [
                {relation: "关联", target: "thread://8", visibility: "author", note: null},
            ],
            allowedKinds: LOREBOOK_STRUCTURED_REFERENCE_KINDS,
            label: "lorebook",
        })).toThrowError("lorebook refs 仅支持 content：thread://8");

        expect(() => normalizeStructuredReferences({
            refs: [
                {relation: "关联", target: "chapter://1", visibility: "author", note: null},
            ],
            allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
            label: "plot",
        })).toThrowError("不支持的引用目标：chapter://1");
    });
});
