/** 列表里时刻的短写法（docs/specs/workbench/background-tasks.md 输出 10 的“时间”）：当天写时:分，前一天写“昨天”，更早写月日。 */

import {describe, expect, it} from "bun:test";

import {fullTime, shortTime} from "./short-time";

const at = (day: number, hour: number, minute: number): number => new Date(2026, 10, day, hour, minute).getTime();

describe("shortTime", () => {
    it("当天写时:分（24 小时制），前一天写调用方给的“昨天”，更早写月日", () => {
        const now = at(11, 10, 45);
        expect(shortTime(at(11, 9, 5), now, "zh-CN", "昨天")).toBe("09:05");
        expect(shortTime(at(11, 0, 0), now, "en-US", "Yesterday")).toBe("00:00");
        expect(shortTime(at(10, 23, 59), now, "zh-CN", "昨天")).toBe("昨天");
        expect(shortTime(at(9, 12, 0), now, "zh-CN", "昨天")).toBe("11/9");
        expect(shortTime(at(9, 12, 0), now, "en-US", "Yesterday")).toBe("11/9");
    });

    it("完整写法带年月日与时分", () => {
        expect(fullTime(at(9, 7, 3), "zh-CN")).toBe("2026/11/9 07:03");
    });
});
