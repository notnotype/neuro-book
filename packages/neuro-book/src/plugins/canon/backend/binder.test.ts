/**
 * 活页夹清单里章讲的线（docs/specs/canon/worldlines.md 输出 12，docs/specs/workspace/folder-kinds.md 的活页夹清单）：
 * `<chapter line>` 与子元素 `<segment from line/>`。
 */

import {describe, expect, it} from "bun:test";

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {BINDER_DIR, chapterText, chapterTitles, parseBinder} from "./binder";

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

describe("章的标题（canon.project 输出 28）", () => {
    it("取自章节文件名；与读正文认同一个文件：编号补零到五位，同一章有几个文件时两边取的是同一个；没有活页夹目录时是空的", async () => {
        const root = await createTestTmpRoot("neuro-book-canon", "binder-titles");
        try {
            expect([...chapterTitles(root)]).toEqual([]);
            const dir = join(root, BINDER_DIR);
            await mkdir(dir, {recursive: true});
            for (const name of ["00001-好哥哥真难当.md", "00012-卡里的两万.md", "012-编号没补零.md", "00003-.md", "笔记.md"]) await writeFile(join(dir, name), `${name}\n`);
            const titles = chapterTitles(root);
            expect(Object.fromEntries(titles)).toEqual({"1": "好哥哥真难当", "12": "卡里的两万"});
            // 标题与正文来自同一个文件。
            for (const [id, title] of titles) expect(chapterText(root, id)).toBe(`${id.padStart(5, "0")}-${title}.md\n`);
            expect(chapterText(root, "3")).toBe("00003-.md\n");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});
