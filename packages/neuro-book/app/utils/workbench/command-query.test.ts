import {describe, expect, it} from "vitest";
import {matchCommandText, parseCommandQuery, parseLineNumber, searchCommands} from "nbook/app/utils/workbench/command-query";
import type {CommandMetadata} from "nbook/app/utils/workbench/commands";
import {Type} from "typebox";

function command(overrides: {id: string; titleKey: string; description?: string; categoryKey?: string}): CommandMetadata {
    return {
        id: overrides.id,
        titleKey: overrides.titleKey,
        description: overrides.description ?? `run ${overrides.id}`,
        categoryKey: overrides.categoryKey,
        argsSchema: Type.Object({}, {additionalProperties: false}),
        effect: "read",
    };
}

const TITLES: Record<string, string> = {
    "workbenchCommands.focus": "聚焦编辑器",
    "workbenchCommands.undo": "撤销",
    "workbenchCommands.redo": "重做",
    "workbenchCommands.goToLine": "跳转到行",
    "workbenchCommands.openLine": "跳转到行…",
    "workbenchCommands.category.edit": "编辑",
    "lab.editEverything": "Edit Everything",
};

function titleOf(key: string): string {
    return TITLES[key] ?? key;
}

describe("parseCommandQuery", () => {
    it("按原始首字符路由：`>` 与 `:` 各删一个前缀，其余（含空串与 @）都是命令文本", () => {
        expect(parseCommandQuery(">undo")).toEqual({mode: "commands", text: "undo"});
        expect(parseCommandQuery("> undo ")).toEqual({mode: "commands", text: "undo"});
        expect(parseCommandQuery(">")).toEqual({mode: "commands", text: ""});
        expect(parseCommandQuery(":15")).toEqual({mode: "line", text: "15"});
        expect(parseCommandQuery(": 15 ")).toEqual({mode: "line", text: "15"});
        expect(parseCommandQuery(":")).toEqual({mode: "line", text: ""});
        expect(parseCommandQuery("undo")).toEqual({mode: "commands", text: "undo"});
        expect(parseCommandQuery("")).toEqual({mode: "commands", text: ""});
        // 没有第三类前缀：@ 与带空格的 `:` 都退回命令文本，不做实体搜索
        expect(parseCommandQuery("@文件")).toEqual({mode: "commands", text: "@文件"});
        expect(parseCommandQuery(" :15")).toEqual({mode: "commands", text: ":15"});
    });
});

describe("parseLineNumber", () => {
    it("只接受正 safe integer：1 与 60 通过，0 / 61 之外的小数、列号与空白拒绝", () => {
        expect(parseLineNumber("1")).toBe(1);
        expect(parseLineNumber("60")).toBe(60);
        for (const text of ["0", "1.5", "15:2", "", " ", "-1", "+1", "01", "1 ", "第1行", "9007199254740993"]) {
            expect(parseLineNumber(text)).toBeNull();
        }
    });
});

describe("matchCommandText", () => {
    it("精确 0、前缀 1、连续包含 2+起点、非连续 100+10×间隔+起点", () => {
        expect(matchCommandText("跳转到行", "跳转到行")).toEqual({score: 0, ranges: [[0, 4]]});
        expect(matchCommandText("跳转到行", "跳转")).toEqual({score: 1, ranges: [[0, 2]]});
        expect(matchCommandText("跳转到行", "到行")).toEqual({score: 4, ranges: [[2, 4]]});
        // 「跳x转x到x行」的非连续命中：3 处间隔，起点 0
        expect(matchCommandText("跳x转x到x行", "跳转到行")).toEqual({
            score: 100 + 30,
            ranges: [[0, 1], [2, 3], [4, 5], [6, 7]],
        });
        expect(matchCommandText("聚焦编辑器", "跳转")).toBeNull();
    });

    it("大小写不敏感，空查询命中一切且不产生片段", () => {
        expect(matchCommandText("Undo Edit", "undo edit")).toEqual({score: 0, ranges: [[0, 9]]});
        expect(matchCommandText("Undo Edit", "ue")).toEqual({score: 100 + 10 + 0, ranges: [[0, 1], [5, 6]]});
        expect(matchCommandText("Undo", "")).toEqual({score: 0, ranges: []});
    });

    it("代理对不被劈开：range 覆盖整个 code point 的 UTF-16 区间", () => {
        const label = "第 1 行 😀 命令";
        const match = matchCommandText(label, "😀");

        expect(match).toEqual({score: 2 + 6, ranges: [[6, 8]]});
        const [start, end] = match!.ranges[0]!;
        expect(label.slice(start, end)).toBe("😀");
        expect(label.charCodeAt(start)).toBeGreaterThanOrEqual(0xd800);
        expect(label.charCodeAt(start)).toBeLessThanOrEqual(0xdbff);
        expect(label.charCodeAt(end - 1)).toBeGreaterThanOrEqual(0xdc00);
    });

    it("起点分数按 code point 计算，不按 UTF-16 码元", () => {
        const label = "😀跳";
        // 起点是第 1 个 code point（UTF-16 偏移 2），分数用 1 而不是 2
        expect(matchCommandText(label, "跳")).toEqual({score: 2 + 1, ranges: [[2, 3]]});
    });
});

describe("searchCommands", () => {
    const commands = [
        command({id: "nbook.edit.undo", titleKey: "workbenchCommands.undo", categoryKey: "workbenchCommands.category.edit"}),
        command({id: "nbook.edit.redo", titleKey: "workbenchCommands.redo"}),
        command({id: "nbook.quick-open.open-line", titleKey: "workbenchCommands.openLine"}),
        command({id: "nbook.lab.edit-everything", titleKey: "lab.editEverything"}),
    ];

    it("命中项带上标题、描述、解析后的分类与标亮片段", () => {
        const items = searchCommands(commands, "撤", titleOf, []);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: "nbook.edit.undo",
            label: "撤销",
            description: "run nbook.edit.undo",
            category: "编辑",
        });
        expect(items[0]!.labelMatches).toEqual([[0, 1]]);
    });

    it("按 id 命中也算候选，但不渲染标亮片段", () => {
        const items = searchCommands(commands, "open-line", titleOf, []);

        expect(items.map((item) => item.id)).toEqual(["nbook.quick-open.open-line"]);
        expect(items[0]!.labelMatches).toBeUndefined();
    });

    it("匹配分为主、MRU 为次、同分 id 升序；空查询只按 MRU/id", () => {
        // 标题前缀命中（分数 1）压过 id 命中（分数 8），即使后者在 MRU 里
        const byScore = searchCommands(commands, "edit", titleOf, ["nbook.edit.undo"]);
        expect(byScore.map((item) => item.id)).toEqual([
            "nbook.lab.edit-everything",
            "nbook.edit.undo",
            "nbook.edit.redo",
        ]);

        // 同分（都是 id 命中）时 MRU 在前
        const byMru = searchCommands(commands, "edit", titleOf, ["nbook.edit.redo"]);
        expect(byMru.map((item) => item.id)).toEqual([
            "nbook.lab.edit-everything",
            "nbook.edit.redo",
            "nbook.edit.undo",
        ]);

        // 空查询没有匹配分差异，只剩 MRU 与 id
        const empty = searchCommands(commands, "", titleOf, ["nbook.edit.redo"]);
        expect(empty.map((item) => item.id)).toEqual([
            "nbook.edit.redo",
            "nbook.edit.undo",
            "nbook.lab.edit-everything",
            "nbook.quick-open.open-line",
        ]);
    });

    it("没有候选时返回空数组", () => {
        expect(searchCommands(commands, "并不存在的命令", titleOf, [])).toEqual([]);
    });
});
