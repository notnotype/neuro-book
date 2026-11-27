/**
 * 给模型看的条目字段（`agent-fields.ts`；docs/specs/canon/agent-tools.md 的 `canon_read`，author-ui 输出 54 的“AI视图”）：只出一个模块时
 * 那一节与整条目读到的那一节逐字相同，说整个条目的两行（以后才启用、去掉过）不出；只读的组、可以加字段的组、条目上自己加的字段照写。
 * 后端经真实世界的整条输出由 `agent-tools.test.ts` 管，这里直接喂条目视图。
 */

import {describe, expect, it} from "bun:test";

import type {ComponentType, EntryView, FieldDeclaration} from "@notnotype/nb-canon/schema";

import {fieldsText} from "./agent-fields";

const PANEL: ComponentType = {id: "nbook.canon.panel", label: "数值", namespace: "panel", version: 1, instanceFields: true, fields: [{id: "存款", label: "存款", kind: "number"}]};
const LOOK: ComponentType = {id: "nbook.canon.look", label: "形象", namespace: "look", version: 1, instanceFields: false, fields: []};

const view: EntryView = {
    id: "xia",
    deleted: false,
    appeared: true,
    name: "星瑕",
    aliases: [],
    summary: "",
    text: [],
    namespaces: {
        panel: {type: PANEL.id, version: 1, fields: {存款: {value: 900}, 幸运: {value: 7}}},
        // 类型没登记：只读，节头用命名空间本身。
        header: {type: "test.header", version: 1, readOnly: "component-unknown", fields: {称号: {value: "夜王"}}},
    },
    upcoming: [{namespace: "rb", from: {kind: "chapter", chapter: "c3", key: 10}, fields: {}}],
    components: [PANEL.id, "test.header"],
    removedComponents: [{namespace: "look", type: LOOK.id}],
};
const declarations: Readonly<Record<string, readonly FieldDeclaration[]>> = {
    // 幸运是条目上自己加的字段：声明由条目读取并进这个模块的声明里。
    panel: [...PANEL.fields, {id: "幸运", label: "幸运", kind: "number"}],
    header: [{id: "称号", label: "称号", kind: "text"}],
};

describe("fieldsText", () => {
    it("整个条目：每个模块一节，末尾写以后才启用的与去掉过的模块", () => {
        const whole = fieldsText(view, declarations, [PANEL, LOOK]);
        expect(whole).toContain("以后才启用的模块：rb");
        expect(whole).toContain("去掉过的模块（可以再加回来）：形象");
    });

    it("只出一个模块：与整条目里那一节逐字相同，不写说整个条目的两行；只读、可以加字段、条目上自己加的字段照写", () => {
        const whole = fieldsText(view, declarations, [PANEL, LOOK]);
        const panel = fieldsText(view, declarations, [PANEL, LOOK], {namespace: "panel"});
        expect(panel.split("\n")).toEqual(["【数值】（模块 panel，可以加字段）", expect.stringMatching(/^- 存款 = 900｜/u), expect.stringMatching(/^- 幸运 = 7｜/u)]);
        expect(whole.startsWith(`${panel}\n`)).toBe(true);
        const header = fieldsText(view, declarations, [PANEL, LOOK], {namespace: "header"});
        expect(header.split("\n")[0]).toBe("【header】（模块 header，只读）");
        expect(header).not.toContain("以后才启用");
        expect(header).not.toContain("去掉过");
    });
});
