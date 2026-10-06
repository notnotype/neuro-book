import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import type {CommandMetadata} from "nbook/plugins/commands/shared/contracts";

import {matchCommandText, parseCommandQuery, parseLineNumber, searchCommands} from "./command-query";

function command(id: string, zh: string, overrides: Partial<CommandMetadata> = {}): CommandMetadata {
    return {id, source: "nbook.test", title: {"zh-CN": zh, "en-US": zh}, description: `run ${id}`, args: Type.Object({}, {additionalProperties: false}), effect: "read", ...overrides};
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
        expect(parseCommandQuery("@文件")).toEqual({mode: "commands", text: "@文件"});
        expect(parseCommandQuery(" :15")).toEqual({mode: "commands", text: ":15"});
    });
});

describe("parseLineNumber", () => {
    it("只接受正的十进制 safe integer", () => {
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
        expect(matchCommandText("跳x转x到x行", "跳转到行")).toEqual({score: 130, ranges: [[0, 1], [2, 3], [4, 5], [6, 7]]});
        expect(matchCommandText("聚焦编辑器", "跳转")).toBeNull();
    });

    it("大小写不敏感；空查询命中一切且不产生片段", () => {
        expect(matchCommandText("Undo Edit", "undo edit")).toEqual({score: 0, ranges: [[0, 9]]});
        expect(matchCommandText("Undo Edit", "ue")).toEqual({score: 110, ranges: [[0, 1], [5, 6]]});
        expect(matchCommandText("Undo", "")).toEqual({score: 0, ranges: []});
    });

    it("代理对不被劈开；起点分数按 code point 算", () => {
        const label = "第 1 行 😀 命令";
        const match = matchCommandText(label, "😀");
        expect(match).toEqual({score: 8, ranges: [[6, 8]]});
        expect(label.slice(6, 8)).toBe("😀");
        expect(matchCommandText("😀跳", "跳")).toEqual({score: 3, ranges: [[2, 3]]});
    });
});

describe("searchCommands", () => {
    const commands = [
        command("nbook.edit.undo", "撤销", {category: {"zh-CN": "编辑", "en-US": "Edit"}, keybinding: "Mod+Z"}),
        command("nbook.edit.redo", "重做"),
        command("nbook.quick-open.open-line", "跳转到行…"),
        command("nbook.app.edit-everything", "Edit Everything"),
    ];

    it("命中项带上显示语言的标题与分类、英文描述、默认键位与标亮片段", () => {
        const items = searchCommands(commands, "撤", [], "zh-CN");
        expect(items).toEqual([{
            id: "nbook.edit.undo",
            label: "撤销",
            description: "run nbook.edit.undo",
            category: "编辑",
            shortcut: "Mod+Z",
            labelMatches: [[0, 1]],
        }]);
        expect(searchCommands(commands, "undo", [], "en-US")[0]).toMatchObject({label: "撤销", category: "Edit"});
    });

    it("按 id 命中也算候选，但不渲染标亮片段", () => {
        const items = searchCommands(commands, "open-line", [], "zh-CN");
        expect(items.map((item) => item.id)).toEqual(["nbook.quick-open.open-line"]);
        expect(items[0]?.labelMatches).toBeUndefined();
    });

    it("匹配分为主、MRU 为次、同分按 id；空查询只按 MRU 与 id", () => {
        expect(searchCommands(commands, "edit", ["nbook.edit.undo"], "zh-CN").map((item) => item.id)).toEqual([
            "nbook.app.edit-everything",
            "nbook.edit.undo",
            "nbook.edit.redo",
        ]);
        expect(searchCommands(commands, "edit", ["nbook.edit.redo"], "zh-CN").map((item) => item.id)).toEqual([
            "nbook.app.edit-everything",
            "nbook.edit.redo",
            "nbook.edit.undo",
        ]);
        expect(searchCommands(commands, "", ["nbook.edit.redo"], "zh-CN").map((item) => item.id)).toEqual([
            "nbook.edit.redo",
            "nbook.app.edit-everything",
            "nbook.edit.undo",
            "nbook.quick-open.open-line",
        ]);
        expect(searchCommands(commands, "并不存在的命令", [], "zh-CN")).toEqual([]);
    });
});
