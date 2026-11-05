import {describe, expect, test} from "bun:test";

import {length, trim} from "./budget";

describe("plot.brief 输出 12：体积预算", () => {
    test("字数按码点数；超出时按项从后往前裁，protect 的项不裁；裁到只剩 protect 的项就停；不超不裁", () => {
        const items = [{label: "甲", text: "一二三四五"}, {label: "乙", text: "一二三四五", protect: true}, {label: "丙", text: "一二三四五"}, {label: "丁", text: "😀😀😀😀😀"}];
        expect(length("😀😀")).toBe(2);
        expect(trim(items, 1000)).toEqual({kept: items, omitted: []});
        const trimmed = trim(items, 12);
        expect(trimmed.omitted).toEqual(["丁", "丙"]);
        expect(trimmed.kept.map((item) => item.label)).toEqual(["甲", "乙"]);
        const floor = trim(items, 3);
        expect(floor.omitted).toEqual(["丁", "丙", "甲"]);
        expect(floor.kept.map((item) => item.label)).toEqual(["乙"]);
    });
});
