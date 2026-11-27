/**
 * 小块显示什么（canon/author-ui.md 输出 10、48）：值表的一项、本条目已经读到的字段、正在算与没有算。值表的项照内核的形状手写。
 */

import {describe, expect, it} from "bun:test";

import type {EntryTextValue} from "./components/text/entry-text";
import {chipOf} from "./entry-chip";
import type {ChipContext} from "./entry-chip";

const context = (overrides: Partial<ChipContext> = {}): ChipContext => ({
    self: "e1",
    fields: new Map([
        ["panel.魔力", {path: "panel.魔力", label: "魔力", group: "数值", display: "1,200"}],
        ["character.年龄", {path: "character.年龄", label: "年龄", group: "人物", display: null}],
    ]),
    marks: {"panel.魔力": "第 3 章改过"},
    computing: true,
    words: {unknown: "未知", deletedRef: "已删除的条目", needsPlugin: "需要插件"},
    ...overrides,
});
const v = (item: Record<string, unknown>) => ({tag: "V", start: 0, raw: null, display: "", ...item}) as unknown as EntryTextValue;
const pick = (model: ReturnType<typeof chipOf>) => [model.kind, model.text, model.state, model.changed ?? null];

describe("小块显示什么", () => {
    it("取值：有值表的项就照它，本条目的带“改过”", () => {
        expect(pick(chipOf('<V of="panel.魔力" />', v({path: "panel.魔力", raw: 1500, display: "1,500"}), context()))).toEqual(["value", "1,500", "value", "第 3 章改过"]);
        expect(pick(chipOf('<V of="panel.魔力" />', v({path: "panel.魔力", unknown: true}), context()))).toEqual(["value", "未知", "unknown", "第 3 章改过"]);
        expect(pick(chipOf('<V of="panel.魔力" />', v({path: "panel.魔力", display: "1,500", incomplete: {}}), context()))[2]).toBe("incomplete");
        expect(pick(chipOf('<V of="panel.没了" />', v({path: "panel.没了", unavailable: "字段没了"}), context()))).toEqual(["value", "字段没了", "missing-field", null]);
    });

    it("取值还没有值表的项：本条目的字段马上显示这一页的值；字段不在了是“字段没了”；别的条目的看正在算还是没有算", () => {
        expect(pick(chipOf('<V of="panel.魔力" />', undefined, context()))).toEqual(["value", "1,200", "value", "第 3 章改过"]);
        expect(pick(chipOf('<V of="character.年龄" />', undefined, context()))).toEqual(["value", "未知", "unknown", null]);
        expect(pick(chipOf('<V of="panel.没有" />', undefined, context()))[2]).toBe("missing-field");
        expect(pick(chipOf('<V entry="e2" of="panel.好感度" />', undefined, context()))).toEqual(["value", "panel.好感度", "pending", null]);
        expect(pick(chipOf('<V entry="e2" of="panel.好感度" />', undefined, context({computing: false})))[2]).toBe("uncomputed");
    });

    it("计算：有值是结果，没有时是式子原文、正在算或没有算", () => {
        expect(pick(chipOf('<V expr="panel.魔力 * 2" />', v({expr: "panel.魔力 * 2", display: "2,400"}), context()))).toEqual(["calc", "2,400", "value", null]);
        expect(pick(chipOf('<V expr="panel.魔力 * 2" />', undefined, context()))).toEqual(["calc", "panel.魔力 * 2", "pending", null]);
    });

    it("条目引用、图片、没登记的标签", () => {
        expect(pick(chipOf('<Ref id="e2" />', {tag: "Ref", start: 0, id: "e2", name: "星瑾", deleted: false} as EntryTextValue, context()))).toEqual(["ref", "星瑾", "value", null]);
        expect(pick(chipOf('<Ref id="e4" />', {tag: "Ref", start: 0, id: "e4", name: "", deleted: true} as EntryTextValue, context()))).toEqual(["ref", "已删除的条目", "deleted", null]);
        expect(pick(chipOf('<Image src="a.png" alt="脚印" />', undefined, context()))).toEqual(["image", "脚印", "value", null]);
        expect(pick(chipOf("<StatusBar />", {tag: "StatusBar", start: 0, needsPlugin: true} as EntryTextValue, context()))).toEqual(["raw", "需要插件", "value", null]);
        expect(pick(chipOf("<Gauge />", undefined, context()))).toEqual(["raw", "<Gauge />", "value", null]);
    });
});
