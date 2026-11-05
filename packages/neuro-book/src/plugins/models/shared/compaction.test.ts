/** 压缩触发点的算法（docs/specs/models/service.md 输出 17）：纯函数。端口与设置的接法在 `models.test.ts`。 */

import {describe, expect, test} from "bun:test";
import {Value} from "typebox/value";

import {compactionTrigger, CompactionSettingSchema, effectiveCompaction} from "./compaction";

describe("触发点", () => {
    test("输出 17：固定的触发点超过窗口时按窗口；窗口未知时原样", () => {
        expect(compactionTrigger({mode: "tokens", value: 50_000}, 200_000)).toBe(50_000);
        expect(compactionTrigger({mode: "tokens", value: 50_000}, 32_000)).toBe(32_000);
        expect(compactionTrigger({mode: "tokens", value: 50_000}, 0)).toBe(50_000);
    });

    test("输出 17：百分比按窗口算，窗口未知时不给；超过 100 的值设置入口就拒绝", () => {
        expect(compactionTrigger({mode: "percent", value: 60}, 200_000)).toBe(120_000);
        expect(compactionTrigger({mode: "percent", value: 60}, 0)).toBeUndefined();
        expect(Value.Check(CompactionSettingSchema, {mode: "percent", value: 100})).toBe(true);
        expect(Value.Check(CompactionSettingSchema, {mode: "percent", value: 150})).toBe(false);
        expect(Value.Check(CompactionSettingSchema, {mode: "percent"})).toBe(false);
        expect(Value.Check(CompactionSettingSchema, {mode: "tokens"})).toBe(false);
        expect(Value.Check(CompactionSettingSchema, {mode: "reserve"})).toBe(true);
    });

    test("输出 17：留预留量：没写基数是内核的缺省（不给）；写了按基数算，窗口的 15% 与 16,384 取大；预留量吃掉全部时不给", () => {
        expect(compactionTrigger({mode: "reserve"}, 200_000)).toBeUndefined();
        expect(compactionTrigger({mode: "reserve", value: 100_000}, 200_000)).toBe(83_616);
        expect(compactionTrigger({mode: "reserve", value: 1_000_000}, 200_000)).toBe(200_000);
        expect(compactionTrigger({mode: "reserve", value: 10_000}, 200_000)).toBeUndefined();
    });

    test("输出 17：按模型的配置覆盖全局；旧的 compactAt 读作固定的触发点；都没有用全局", () => {
        const global = {mode: "percent", value: 80} as const;
        expect(effectiveCompaction({}, global)).toBe(global);
        expect(effectiveCompaction({compactAt: 40_000}, global)).toEqual({mode: "tokens", value: 40_000});
        expect(effectiveCompaction({compactAt: 40_000, compaction: {mode: "percent", value: 50}}, global)).toEqual({mode: "percent", value: 50});
    });
});
