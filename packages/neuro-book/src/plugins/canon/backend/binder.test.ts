/**
 * 活页夹清单里章讲的线（docs/specs/canon/worldlines.md 输出 12，docs/specs/workspace/folder-kinds.md 的活页夹清单）：
 * `<chapter line>` 与子元素 `<segment from line/>`。
 */

import {describe, expect, it} from "bun:test";

import {parseBinder} from "./binder";

const chapters = (xml: string) => {
    const read = parseBinder(xml);
    if (!read.ok) throw new Error(read.detail);
    return {ids: read.chapters, lines: Object.fromEntries(read.lines)};
};

describe("活页夹清单：章讲的线", () => {
    it("没写线的章讲主线，不出现在 lines 里；整章一条线、分段各一条线，第一段用章的线", () => {
        const read = chapters(`<binder nextId="4">
            <chapter id="1" title="一"/>
            <group title="卷"><chapter id="2" line="l1"/></group>
            <chapter id="3" line="l1"><segment from="3" line="l2"/><segment from="10" line="main"/></chapter>
        </binder>`);
        expect(read.ids).toEqual(["1", "2", "3"]);
        expect(read.lines).toEqual({
            "2": [{from: 1, line: "l1"}],
            "3": [{from: 1, line: "l1"}, {from: 3, line: "l2"}, {from: 10, line: "main"}],
        });
    });

    it("章没写线、只有分段：第一段讲主线；from 为 1 的分段直接盖掉章的线", () => {
        expect(chapters(`<binder><chapter id="1"><segment from="4" line="l1"/></chapter></binder>`).lines).toEqual({"1": [{from: 1, line: "main"}, {from: 4, line: "l1"}]});
        expect(chapters(`<binder><chapter id="1" line="l0"><segment from="1" line="l1"/></chapter></binder>`).lines).toEqual({"1": [{from: 1, line: "l1"}]});
    });

    it("分段的 from 不是正整数、不递增、缺线，或章里有别的元素：整份清单不合法", () => {
        const bad = (inner: string) => parseBinder(`<binder><chapter id="1">${inner}</chapter></binder>`);
        expect(bad('<segment from="0" line="l1"/>').ok).toBe(false);
        expect(bad('<segment from="x" line="l1"/>').ok).toBe(false);
        expect(bad('<segment from="3" line="l1"/><segment from="3" line="l2"/>').ok).toBe(false);
        expect(bad('<segment from="5" line="l1"/><segment from="3" line="l2"/>').ok).toBe(false);
        expect(bad('<segment from="3"/>').ok).toBe(false);
        expect(bad("<note/>").ok).toBe(false);
        expect(parseBinder('<binder><chapter id="1" line=""/></binder>').ok).toBe(false);
    });
});
