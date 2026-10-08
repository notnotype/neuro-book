/**
 * 配置项的定义与声明校验（docs/specs/settings/configuration.md 输入“声明”、输出 1）。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineSetting, SETTINGS_POINT, settingDeclarationProblem} from "./settings";
import type {SettingDeclaration} from "./settings";

const title = {"zh-CN": "主题", "en-US": "Theme"};
const theme = Type.Union([Type.Literal("nbook"), Type.Literal("macos")]);

function declaration(overrides: Partial<Record<keyof SettingDeclaration, unknown>> = {}): Record<string, unknown> {
    return {schema: theme, default: "nbook", title, layers: ["user", "project"], restart: false, ...overrides};
}

describe("defineSetting", () => {
    it("键是 <插件 id>/<名>，缺省两层都允许、不需要重启；贡献写到贡献点 settings.properties，id 就是键", () => {
        const setting = defineSetting({plugin: "nbook.workbench", name: "theme", schema: theme, default: "nbook", title});
        expect(setting.key).toBe("nbook.workbench/theme");
        expect(setting.declaration).toMatchObject({default: "nbook", layers: ["user", "project"], restart: false});
        expect(setting.contribution).toEqual({capability: SETTINGS_POINT, id: "nbook.workbench/theme", declaration: setting.declaration});
    });

    it("默认值复制后逐层冻结：改原对象不影响定义，定义里的值改不动", () => {
        const original = {size: 12, families: ["serif"]};
        const setting = defineSetting({plugin: "x.editor", name: "font", schema: Type.Object({size: Type.Number(), families: Type.Array(Type.String())}), default: original, title});
        original.families.push("mono");
        expect(setting.declaration.default).toEqual({size: 12, families: ["serif"]});
        expect(Object.isFrozen(setting.declaration.default)).toBe(true);
        expect(Object.isFrozen((setting.declaration.default as {families: string[]}).families)).toBe(true);
    });

    it("不合规则的定义在加载时抛 TypeError", () => {
        expect(() => defineSetting({plugin: "x.editor", name: "Font", schema: theme, default: "nbook", title})).toThrow(TypeError);
        expect(() => defineSetting({plugin: "x.editor", name: "theme", schema: theme, default: "solarized" as "nbook", title})).toThrow("不符合 schema");
    });
});

describe("settingDeclarationProblem：只看这一条声明", () => {
    it("合格的声明没有问题；名字可以以点分段", () => {
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration())).toBeNull();
        expect(settingDeclarationProblem("x.editor", "x.editor/editor.fontSize", declaration({schema: Type.Number(), default: 14}))).toBeNull();
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({description: title, layers: ["user"], restart: true, secret: false}))).toBeNull();
    });

    it("键前缀不是贡献方插件、名字不合规则或超过 128 个字符", () => {
        expect(settingDeclarationProblem("x.editor", "x.other/theme", declaration())).toContain("x.editor/<名>");
        for (const name of ["Theme", "font-size", "editor..size", "1st", ".size", "size."]) {
            expect(settingDeclarationProblem("x.editor", `x.editor/${name}`, declaration()), name).toContain("不合规则");
        }
        expect(settingDeclarationProblem("x.editor", `x.editor/${"a".repeat(129)}`, declaration())).toContain("128");
        expect(settingDeclarationProblem("x.editor", `x.editor/${"a".repeat(128)}`, declaration())).toBeNull();
    });

    it("默认值必须是 JSON 能如实表示的值且符合 schema：undefined、NaN、Date、Map 都被拒", () => {
        const any = Type.Unknown();
        for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(0), new Map(), () => 1]) {
            expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({schema: any, default: value})), String(value)).toContain("JSON");
        }
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({default: "solarized"}))).toContain("不符合 schema");
    });

    it("schema 不能 JSON 序列化、layers 为空或有未知层或重复、title 缺语言、restart 不是布尔、有未知字段", () => {
        const schemaWithFunction = {...theme, check: () => true};
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({schema: schemaWithFunction}))).toContain("schema");
        for (const layers of [[], ["machine"], ["user", "user"], "user"]) {
            expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({layers})), JSON.stringify(layers)).toContain("layers");
        }
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({title: {"zh-CN": "主题"}}))).toContain("title");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({description: "主题"}))).toContain("description");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", declaration({restart: "yes"}))).toContain("restart");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", {...declaration(), scope: "machine"})).toContain("scope");
        expect(settingDeclarationProblem("x.editor", "x.editor/theme", null)).toContain("对象");
    });

    it("声明 secret: true 被拒，原因写明密钥存储尚未实现", () => {
        expect(settingDeclarationProblem("x.editor", "x.editor/token", declaration({schema: Type.String(), default: "", secret: true}))).toContain("密钥存储尚未实现");
    });
});
