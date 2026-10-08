/**
 * 配置文件文本的解析与单键编辑（docs/specs/settings/configuration.md 输出 4、5、13）：真实 `jsonc-parser`。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";
import type {SettingDeclaration} from "nbook/shared/settings";

import {editLayerText, parseLayerText} from "./layer-text";
import type {EditResult} from "./layer-text";

const title = {"zh-CN": "项", "en-US": "Item"};
const theme = defineSetting({plugin: "x.ui", name: "theme", schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]), default: "nbook", title});
const locale = defineSetting({plugin: "x.ui", name: "locale", schema: Type.String(), default: "zh-CN", title, layers: ["user"]});
const size = defineSetting({plugin: "x.ui", name: "editor.fontSize", schema: Type.Number(), default: 12, title});
const font = defineSetting({plugin: "x.ui", name: "font", schema: Type.Object({family: Type.String(), size: Type.Number()}), default: {family: "serif", size: 12}, title});
const anything = defineSetting({plugin: "x.ui", name: "anything", schema: Type.Unknown(), default: null, title});

const declarations: ReadonlyMap<string, SettingDeclaration> = new Map([theme, locale, size, font, anything].map((setting) => [setting.key, setting.declaration]));

function textOf(result: EditResult): string {
    if (!result.ok) throw new Error(`编辑失败：${result.detail}`);
    return result.text;
}

describe("parseLayerText", () => {
    it("注释、尾随逗号与 BOM 都能读；没有声明的键忽略且不报问题", () => {
        const text = "﻿{\n    // 主题\n    \"x.ui/theme\": \"macos\", /* 块注释 */\n    \"other.plugin/thing\": 1,\n}\n";
        expect(parseLayerText(text, declarations, "user")).toEqual({status: "ok", values: {"x.ui/theme": "macos"}, problems: []});
    });

    it("空文件、只有空白或只有注释：空层", () => {
        for (const text of ["", "  \n", "// 还没有设置\n", "/* */"]) {
            expect(parseLayerText(text, declarations, "user"), JSON.stringify(text)).toEqual({status: "ok", values: {}, problems: []});
        }
    });

    it("无法解析、根不是对象、任意深度的重复键：invalid，原因可读", () => {
        expect(parseLayerText("{\"x.ui/theme\": ", declarations, "user")).toMatchObject({status: "invalid", detail: expect.stringContaining("第 1 行")});
        for (const text of ["[]", "null", "1", "\"macos\""]) {
            expect(parseLayerText(text, declarations, "user"), text).toEqual({status: "invalid", detail: "根不是对象"});
        }
        expect(parseLayerText("{\"x.ui/theme\": \"nbook\", \"x.ui/theme\": \"macos\"}", declarations, "user")).toEqual({status: "invalid", detail: "键 x.ui/theme 出现了多次"});
        expect(parseLayerText("{\"x.ui/font\": {\"size\": 1, \"size\": 2, \"family\": \"a\"}}", declarations, "user")).toEqual({status: "invalid", detail: "键 size 出现了多次"});
    });

    it("不符合 schema、不是 JSON 能如实表示的数（1e400）、本层不允许的键：丢弃并列入问题，不含值", () => {
        const text = "{\"x.ui/theme\": \"solarized\", \"x.ui/editor.fontSize\": 1e400, \"x.ui/locale\": \"en-US\", \"x.ui/font\": {\"family\": \"mono\", \"size\": 14}}";
        expect(parseLayerText(text, declarations, "project")).toEqual({
            status: "ok",
            values: {"x.ui/font": {family: "mono", size: 14}},
            problems: [{key: "x.ui/editor.fontSize", reason: "invalid-value"}, {key: "x.ui/locale", reason: "layer-not-allowed"}, {key: "x.ui/theme", reason: "invalid-value"}],
        });
        expect(parseLayerText("{\"x.ui/locale\": \"en-US\"}", declarations, "user")).toEqual({status: "ok", values: {"x.ui/locale": "en-US"}, problems: []});
        // schema 什么都接受时，超出范围的数字仍不是 JSON 能如实表示的值。
        expect(parseLayerText("{\"x.ui/anything\": 1e400}", declarations, "user")).toEqual({status: "ok", values: {}, problems: [{key: "x.ui/anything", reason: "invalid-value"}]});
    });

    it("读出的值逐层冻结", () => {
        const parsed = parseLayerText("{\"x.ui/font\": {\"family\": \"mono\", \"size\": 14}}", declarations, "user");
        if (parsed.status !== "ok") throw new Error("应能解析");
        expect(Object.isFrozen(parsed.values)).toBe(true);
        expect(Object.isFrozen(parsed.values["x.ui/font"])).toBe(true);
    });
});

describe("editLayerText", () => {
    const commented = "{\n    // 外观\n    \"x.ui/theme\": \"nbook\", // 行尾注释\n    \"other.plugin/thing\": {\"a\": 1},\n    /* 字号 */\n    \"x.ui/editor.fontSize\": 12\n}\n";

    it("替换已有键的值：其余文本（注释、未声明的键、行尾注释）一字不动", () => {
        expect(textOf(editLayerText(commented, theme.key, {kind: "set", value: "macos"}))).toBe(commented.replace("\"nbook\"", "\"macos\""));
    });

    it("保留 BOM、CRLF 与制表符缩进；新增键按原文的缩进与换行追加", () => {
        const text = "﻿{\r\n\t\"x.ui/theme\": \"nbook\"\r\n}\r\n";
        const replaced = textOf(editLayerText(text, theme.key, {kind: "set", value: "macos"}));
        expect(replaced).toBe("﻿{\r\n\t\"x.ui/theme\": \"macos\"\r\n}\r\n");
        const added = textOf(editLayerText(text, size.key, {kind: "set", value: 14}));
        expect(added).toBe("﻿{\r\n\t\"x.ui/theme\": \"nbook\",\r\n\t\"x.ui/editor.fontSize\": 14\r\n}\r\n");
        const twoSpaces = textOf(editLayerText("{\n  \"x.ui/theme\": \"nbook\"\n}\n", size.key, {kind: "set", value: 14}));
        expect(twoSpaces).toBe("{\n  \"x.ui/theme\": \"nbook\",\n  \"x.ui/editor.fontSize\": 14\n}\n");
    });

    it("新增键：最后一个键的行尾注释仍跟着它，不规则空白与单行写法不动，尾随逗号的风格沿用", () => {
        expect(textOf(editLayerText("{\"unrelated\"  :  1 /* 行尾 */}", theme.key, {kind: "set", value: "macos"}))).toBe("{\"unrelated\"  :  1, /* 行尾 */ \"x.ui/theme\": \"macos\"}");
        expect(textOf(editLayerText("{\n    \"a\":   1 // 说明\n}\n", theme.key, {kind: "set", value: "macos"}))).toBe("{\n    \"a\":   1, // 说明\n    \"x.ui/theme\": \"macos\"\n}\n");
        expect(textOf(editLayerText("{\n  \"a\": 1,\n}\n", theme.key, {kind: "set", value: "macos"}))).toBe("{\n  \"a\": 1,\n  \"x.ui/theme\": \"macos\",\n}\n");
        expect(textOf(editLayerText("{\n  \"a\": 1\n}\n", font.key, {kind: "set", value: {family: "mono", size: 14}}))).toBe("{\n  \"a\": 1,\n  \"x.ui/font\": {\n    \"family\": \"mono\",\n    \"size\": 14\n  }\n}\n");
    });

    it("删除独占一行的首、中、末键：只删那一行，其它行（含别的键前的注释）不动", () => {
        expect(textOf(editLayerText(commented, theme.key, {kind: "delete"}))).toBe("{\n    // 外观\n    \"other.plugin/thing\": {\"a\": 1},\n    /* 字号 */\n    \"x.ui/editor.fontSize\": 12\n}\n");
        expect(textOf(editLayerText(commented, "other.plugin/thing", {kind: "delete"}))).toBe("{\n    // 外观\n    \"x.ui/theme\": \"nbook\", // 行尾注释\n    /* 字号 */\n    \"x.ui/editor.fontSize\": 12\n}\n");
        // 删最后一个键时前一个键的逗号留成尾随逗号，读取照常。
        const last = textOf(editLayerText(commented, size.key, {kind: "delete"}));
        expect(last).toBe("{\n    // 外观\n    \"x.ui/theme\": \"nbook\", // 行尾注释\n    \"other.plugin/thing\": {\"a\": 1},\n    /* 字号 */\n}\n");
        expect(parseLayerText(last, declarations, "user")).toEqual({status: "ok", values: {"x.ui/theme": "nbook"}, problems: []});
    });

    it("同一行里的键：删除后仍是合法文本，包括唯一一个带尾随逗号的键", () => {
        for (const text of ["{\"x.ui/theme\":\"nbook\",}", "{\"a\": 1, \"x.ui/theme\": \"nbook\",}", "{\"x.ui/theme\": \"nbook\", \"a\": 1}"]) {
            const next = textOf(editLayerText(text, theme.key, {kind: "delete"}));
            expect(parseLayerText(next, declarations, "user"), text).toMatchObject({status: "ok", values: {}});
            expect(next, text).not.toContain("x.ui/theme");
        }
    });

    it("空文本或只有注释时新增：得到只含这个键的对象，注释保留；删除不存在的键原样返回", () => {
        expect(textOf(editLayerText("", theme.key, {kind: "set", value: "macos"}))).toBe("{\n    \"x.ui/theme\": \"macos\"\n}");
        const commentOnly = textOf(editLayerText("// 我的设置\n", theme.key, {kind: "set", value: "macos"}));
        expect(commentOnly).toContain("// 我的设置");
        expect(parseLayerText(commentOnly, declarations, "user")).toEqual({status: "ok", values: {"x.ui/theme": "macos"}, problems: []});
        expect(textOf(editLayerText("", theme.key, {kind: "delete"}))).toBe("");
        expect(textOf(editLayerText(commented, "x.ui/nothing", {kind: "delete"}))).toBe(commented);
    });

    it("对象值整体写入；写入的值读回来与要写的相同", () => {
        const next = textOf(editLayerText(commented, font.key, {kind: "set", value: {family: "mono", size: 14}}));
        expect(parseLayerText(next, declarations, "user")).toMatchObject({status: "ok", values: {"x.ui/font": {family: "mono", size: 14}}});
    });

    it("原文无效（坏 JSON、根不是对象、重复键）：不编辑，给出原因", () => {
        expect(editLayerText("{\"x.ui/theme\": ", theme.key, {kind: "set", value: "macos"})).toMatchObject({ok: false});
        expect(editLayerText("[]", theme.key, {kind: "set", value: "macos"})).toEqual({ok: false, detail: "根不是对象"});
        expect(editLayerText("{\"a\": 1, \"a\": 2}", theme.key, {kind: "delete"})).toEqual({ok: false, detail: "键 a 出现了多次"});
    });
});
