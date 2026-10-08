/**
 * 合成与快照比较（docs/specs/settings/configuration.md 输出 6、10，“时序与寿命”第 2 条）。
 */

import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";

import {effectiveOf, sameContent, supersedes} from "./layers";
import type {LayerSnapshot} from "./layers";

const title = {"zh-CN": "项", "en-US": "Item"};
const theme = defineSetting({plugin: "x.ui", name: "theme", schema: Type.String(), default: "nbook", title});
const locale = defineSetting({plugin: "x.ui", name: "locale", schema: Type.String(), default: "zh-CN", title, layers: ["user"]});
const font = defineSetting({plugin: "x.ui", name: "font", schema: Type.Object({size: Type.Number(), family: Type.Optional(Type.String())}), default: {size: 12, family: "serif"}, title});

describe("effectiveOf", () => {
    it("项目层 > 用户层 > 默认值；本实例没有的层不参与", () => {
        expect(effectiveOf(theme.key, theme.declaration, {})).toEqual({value: "nbook", source: "default"});
        expect(effectiveOf(theme.key, theme.declaration, {user: {[theme.key]: "macos"}})).toEqual({value: "macos", source: "user"});
        expect(effectiveOf(theme.key, theme.declaration, {user: {[theme.key]: "macos"}, project: {[theme.key]: "nbook"}})).toEqual({value: "nbook", source: "project"});
        expect(effectiveOf(theme.key, theme.declaration, {user: {}, project: {}})).toEqual({value: "nbook", source: "default"});
    });

    it("声明不允许的层不参与；对象值整体覆盖，不与默认值合并", () => {
        expect(effectiveOf(locale.key, locale.declaration, {user: {[locale.key]: "en-US"}, project: {[locale.key]: "ja-JP"}})).toEqual({value: "en-US", source: "user"});
        expect(effectiveOf(font.key, font.declaration, {user: {[font.key]: {size: 14}}})).toEqual({value: {size: 14}, source: "user"});
    });
});

describe("supersedes：写入结果与订阅推送乱序到达时不倒退", () => {
    it("同一启动标识下序号更大才替换；启动标识不同以新的为准；当前没有时总是替换", () => {
        expect(supersedes({boot: "a", seq: 2}, {boot: "a", seq: 1})).toBe(true);
        expect(supersedes({boot: "a", seq: 1}, {boot: "a", seq: 2})).toBe(false);
        expect(supersedes({boot: "a", seq: 2}, {boot: "a", seq: 2})).toBe(false);
        expect(supersedes({boot: "b", seq: 1}, {boot: "a", seq: 9})).toBe(true);
        expect(supersedes({boot: "a", seq: 1}, null)).toBe(true);
    });
});

describe("sameContent：层变坏或修好而值不变也算变化", () => {
    const ok: LayerSnapshot = {status: "ok", revision: {boot: "a", seq: 1}, values: {[theme.key]: "macos", [font.key]: {size: 1, family: "x"}}, problems: []};

    it("只差修订号或对象键的顺序：相同", () => {
        const later: LayerSnapshot = {...ok, revision: {boot: "a", seq: 2}};
        expect(sameContent(ok, later)).toBe(true);
        expect(sameContent(ok, {...ok, values: {[font.key]: {family: "x", size: 1}, [theme.key]: "macos"}})).toBe(true);
    });

    it("状态、值、被丢弃的键、无效原因任一不同：不同", () => {
        const invalid: LayerSnapshot = {status: "invalid", revision: ok.revision, values: ok.values, problems: [], detail: "第 1 行：InvalidSymbol"};
        expect(sameContent(ok, invalid)).toBe(false);
        expect(sameContent(invalid, {...invalid, detail: "根不是对象"})).toBe(false);
        expect(sameContent(ok, {...ok, values: {[theme.key]: "nbook"}})).toBe(false);
        expect(sameContent(ok, {...ok, problems: [{key: locale.key, reason: "layer-not-allowed"}]})).toBe(false);
    });
});
