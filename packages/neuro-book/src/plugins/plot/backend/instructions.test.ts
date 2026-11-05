import {describe, expect, test} from "bun:test";

import {InstructionTable, PLOT_DATA_VERSION} from "./instructions";
import type {InstructionSnapshot} from "../shared/instructions";

const snapshot = (chapter: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter, version: "v1", ...extra});

describe("写作指示快照表：数据版本取内容的摘要", () => {
    test("空表是 1；同内容再推一次版本不变（不让 canon 的游标白白作废）；换内容版本变；删到空回到 1", () => {
        const table = new InstructionTable();
        expect(table.dataVersion).toBe(PLOT_DATA_VERSION);
        expect(table.empty).toBe(true);
        const first = table.put("ch1", snapshot("ch1", {tone: "冷"}));
        expect(first).toMatchObject({ok: true, changed: true});
        expect(table.dataVersion).not.toBe(PLOT_DATA_VERSION);
        const again = table.put("ch1", snapshot("ch1", {tone: "冷"}));
        expect(again).toMatchObject({ok: true, changed: false, dataVersion: first.ok ? first.dataVersion : ""});
        const changed = table.put("ch1", snapshot("ch1", {tone: "暖"}));
        expect(changed).toMatchObject({ok: true, changed: true});
        expect(table.put("ch1", null)).toMatchObject({ok: true, dataVersion: PLOT_DATA_VERSION});
        expect(table.empty).toBe(true);
    });

    test("版本与推送先后无关、重启（新表）后同内容得到同一个版本", () => {
        const [a, b] = [new InstructionTable(), new InstructionTable()];
        a.put("ch1", snapshot("ch1"));
        a.put("ch2", snapshot("ch2", {avoid: ["别写天气"]}));
        b.put("ch2", snapshot("ch2", {avoid: ["别写天气"]}));
        b.put("ch1", snapshot("ch1"));
        expect(a.dataVersion).toBe(b.dataVersion);
        expect(a.all().map((item) => item.chapter)).toEqual(["ch1", "ch2"]);
    });

    test("带 base 的推送：对得上才替换，对不上得 instructions-conflict 且表不变", () => {
        const table = new InstructionTable();
        const first = table.put("ch1", snapshot("ch1"), PLOT_DATA_VERSION);
        if (!first.ok) throw new Error(first.code);
        const stale = table.put("ch2", snapshot("ch2"), PLOT_DATA_VERSION);
        expect(stale).toEqual({ok: false, code: "instructions-conflict"});
        expect(table.get("ch2")).toBeUndefined();
        expect(table.put("ch2", snapshot("ch2"), first.dataVersion)).toMatchObject({ok: true});
    });
});
