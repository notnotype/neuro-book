/** 改动记录的一行（revisions.ts、impact.ts 的 `impactSummary`；docs/specs/canon/author-ui.md 输出 24）：摘要怎么数、还原旁写什么、筛选怎么折。 */

import {describe, expect, it} from "bun:test";

import type {Impact} from "@notnotype/nb-canon";

import {testTextPort} from "nbook/shared/testing/text-port";
import {boundText} from "nbook/shared/use-plugin-text";

import type zhCN from "../locales/zh-CN.json";
import {impactIsQuiet, impactLines, impactSummary} from "./impact";
import {ALL, revisionRow, revisionsFilter} from "./revisions";
import type {RevisionListItem} from "./revisions";
import {canonCatalogs} from "./text";

const text = boundText<typeof zhCN>(testTextPort("zh-CN", {"nbook.canon": canonCatalogs}), "nbook.canon");
const none: Impact = {values: [], pendingAdded: [], pendingResolved: [], broken: []};
const value = (entry: string, path: string) => ({at: {entry, path}, before: 1, after: 2});

describe("impactSummary", () => {
    it("几处值变了、多了少了几条待处理、几条套不上了；主文字的几块一个条目算一处；都没有时写没有带来别的变化", () => {
        expect(impactSummary(none, text)).toBe("没有带来别的变化");
        const impact = {
            ...none,
            values: [value("a", "panel.存款"), value("a", "text[b1]"), value("a", "text[b2]"), value("b", "text[b1]")],
            pendingAdded: [{} as never],
            pendingResolved: [{} as never, {} as never],
            broken: [{} as never],
        } as Impact;
        expect(impactSummary(impact, text)).toBe("3 处值变了，多了 1 条待处理，少了 2 条待处理，1 条情节套不上了");
    });
});

describe("impactIsQuiet", () => {
    // 就地改的短项填完立刻回车时，预览回来要是没有别的变化就直接保存（author-ui.md 输出 16）；有一样就停下来给作者看。
    it("只改了跳过的那个值才算没有别的变化；多了或少了待处理、套不上（含别的世界线）、别的值跟着变都不算", () => {
        const editing = (at: {readonly entry: string; readonly path: string}) => at.entry === "a" && at.path === "panel.存款";
        expect(impactIsQuiet(none, editing)).toBe(true);
        expect(impactIsQuiet({...none, values: [value("a", "panel.存款")]}, editing)).toBe(true);
        expect(impactIsQuiet({...none, values: [value("a", "panel.存款")]})).toBe(false);
        expect(impactIsQuiet({...none, values: [value("a", "panel.存款"), value("b", "panel.存款")]}, editing)).toBe(false);
        expect(impactIsQuiet({...none, pendingAdded: ["p1"]}, editing)).toBe(false);
        expect(impactIsQuiet({...none, pendingResolved: ["p1"]}, editing)).toBe(false);
        expect(impactIsQuiet({...none, broken: ["c1"]}, editing)).toBe(false);
        expect(impactIsQuiet({...none, brokenOn: [{line: "l1", change: "c1"}]}, editing)).toBe(false);
    });

    // 回车直接存（impactIsQuiet）与预览上写出的变化（impactLines）是两段代码：Impact 多了一类时两边要一起改，否则会出现
    // “预览写了变化、回车却直接存了”。这里逐类对齐：只写“别的都不变”那一句时才算没有变化。
    it("与预览写的那几行一致：预览只有“别的都不变”时才算没有别的变化", () => {
        const editing = (at: {readonly entry: string; readonly path: string}) => at.entry === "a" && at.path === "panel.存款";
        const samples: Impact[] = [
            none,
            {...none, values: [value("a", "panel.存款")]},
            {...none, values: [value("b", "panel.存款")]},
            {...none, values: [value("a", "text[b1]")]},
            {...none, pendingAdded: ["p1"]},
            {...none, pendingResolved: ["p1"]},
            {...none, broken: ["c1"]},
            {...none, brokenOn: [{line: "l1", change: "c1"}]},
            {...none, rekeyed: [{change: "c1", from: 1, to: 2}]},
        ];
        const quietLines = [text("edit.noImpact")];
        for (const impact of samples) {
            const lines = impactLines(impact, {address: (at) => at.path, skip: editing, values: "follows"}, text);
            expect(impactIsQuiet(impact, editing)).toBe(JSON.stringify(lines) === JSON.stringify(quietLines));
        }
    });
});

describe("revisionRow", () => {
    const item = (revertable: RevisionListItem["revertable"]): RevisionListItem => ({id: "r1", version: 3, by: {kind: "task", name: "第 3 章记账"}, what: "bookkeeping", title: "记账", time: "2026-11-13T14:03:00.000Z", impact: none, revertable});

    it("谁写的与时间写成一行；章序调整不能还原并写原因，有依赖的写一句、照样能还原", () => {
        const ok = revisionRow(item({ok: true}), text);
        expect(ok.meta).toMatch(/^任务：第 3 章记账 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
        expect(ok).toMatchObject({title: "记账", summary: "没有带来别的变化", notRevertable: false, note: ""});
        expect(revisionRow(item({ok: false, reason: "not-revertable"}), text)).toMatchObject({notRevertable: true, note: "调整章序的改动不能还原"});
        expect(revisionRow(item({ok: false, reason: "has-dependents", dependents: ["r2", "r3"]}), text)).toMatchObject({notRevertable: false, note: "后面有 2 次改动依赖它"});
    });
});

describe("revisionsFilter", () => {
    it("“全部”不写进筛选；认不出的写入者不写", () => {
        expect(revisionsFilter(ALL, ALL)).toEqual({});
        expect(revisionsFilter("1", "agent")).toEqual({chapter: "1", by: "agent"});
        expect(revisionsFilter(ALL, "someone")).toEqual({});
    });
});
