/** 待处理的一行与详情（pending.ts；docs/specs/canon/author-ui.md 输出 23）：键怎样认出同一条、每种写什么、读不到时怎样退。 */

import {describe, expect, it} from "bun:test";

import type {Check, Decision, ObjectRef, StoryChange} from "@notnotype/nb-canon/schema";

import {testTextPort} from "nbook/shared/testing/text-port";
import {boundText} from "nbook/shared/use-plugin-text";

import type zhCN from "../locales/zh-CN.json";
import {pendingDetail, pendingDetailNeeds, pendingKey, pendingNeeds, pendingRow} from "./pending";
import type {PendingItem, PendingLookups} from "./pending";
import {canonCatalogs} from "./text";

const text = boundText<typeof zhCN>(testTextPort("zh-CN", {"nbook.canon": canonCatalogs}), "nbook.canon");

const chapter = (id: string) => ({kind: "chapter" as const, chapter: id, key: 1});
const storyChange = (id: string, extra: Partial<StoryChange> = {}): StoryChange => ({id, kind: "written", text: `情节${id}`, at: chapter("2"), told: [{id: "t", source: "chapter", chapter: "2", quote: "她数了数钱"}], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra} as StoryChange);
const check: Check = {id: "k1", at: {entry: "e1", path: "panel.存款"}, value: 500, told: {id: "t1", source: "chapter", chapter: "2", quote: "余额 500"}, place: chapter("2")};
const decision: Decision = {id: "d1", text: "看过了", status: "decided", conclusion: "有意为之", about: [], hints: []} as Decision;

/** 读到了哪些对象：键是 `kind:id`。 */
function lookups(objects: readonly unknown[] = [], extra: Partial<PendingLookups> = {}): PendingLookups {
    const known = new Map(objects.map((object) => {
        const value = object as {id: string; at?: unknown; told?: unknown; status?: unknown};
        const kind = "about" in value ? "decision" : "kind" in value && "patches" in value ? "change" : "check";
        return [`${kind}:${value.id}`, object];
    }));
    return {
        object: (ref: ObjectRef) => known.get(`${ref.kind}:${ref.id}`),
        entryName: (id) => (id === "e1" ? "星瑕" : undefined),
        address: (at) => `${at.entry === "e1" ? "星瑕" : "一个条目"}的存款`,
        place: (at) => (at.kind === "chapter" ? `第 ${at.chapter} 章` : "前史"),
        chapter: (id) => `第 ${id} 章`,
        label: () => undefined,
        outcome: () => undefined,
        revisionTitle: () => undefined,
        ...extra,
    };
}

const mismatch = (computed: number, suspects: readonly string[] = ["c2", "init"]): PendingItem => ({kind: "canon", item: {kind: "check-mismatch", check: "k1", at: check.at, computed, written: 500, suspects}});

describe("pendingKey", () => {
    it("算出来的数、嫌疑、跟着套不上的变了，键不变；换一个核对点、换一条发现，键就换了", () => {
        expect(pendingKey(mismatch(1000))).toBe(pendingKey(mismatch(800, ["c3"])));
        expect(pendingKey(mismatch(1000))).not.toBe(pendingKey({kind: "canon", item: {kind: "check-mismatch", check: "k2", at: check.at, computed: 1000, written: 500, suspects: []}}));
        const cannot = (changes: string[]): PendingItem => ({kind: "canon", item: {kind: "cannot-apply", root: "c1", changes}});
        expect(pendingKey(cannot(["c1"]))).toBe(pendingKey(cannot(["c1", "c2"])));
        const finding = (detail: string, params: Record<string, number>): PendingItem => ({kind: "finding", diagnostic: "nbook.plot.chain", level: "pending", finding: {key: {detail}, objects: [], params}});
        expect(pendingKey(finding("钟", {n: 1}))).toBe(pendingKey(finding("钟", {n: 2})));
        expect(pendingKey(finding("钟", {n: 1}))).not.toBe(pendingKey(finding("表", {n: 1})));
    });
});

describe("pendingRow", () => {
    it("每种写一句与位置：核对点写地址与两个数、位置取它的安放；插件的发现写显示名，没有时“插件的一项检查”", () => {
        expect(pendingRow(mismatch(1000), lookups([check]), text)).toMatchObject({text: "星瑕的存款对不上：正文写 500，算出来是 1,000", place: "第 2 章"});
        expect(pendingRow({kind: "canon", item: {kind: "held", change: "c1", reason: "unsure"}}, lookups([storyChange("c1")]), text)).toMatchObject({text: "“情节c1”待定", place: "第 2 章"});
        const finding: PendingItem = {kind: "finding", diagnostic: "nbook.plot.chain", level: "pending", finding: {key: {detail: "x"}, objects: [], params: {}}, occurrence: {chapter: "3", paragraph: 4, offset: 0}};
        expect(pendingRow(finding, lookups([], {label: (id) => (id === "nbook.plot.chain" ? "传话链断了" : undefined)}), text)).toMatchObject({text: "传话链断了", place: "第 3 章第 4 段"});
        expect(pendingRow(finding, lookups(), text).text).toBe("插件的一项检查");
        expect(pendingRow({kind: "hint", hint: {code: "component-unknown", entry: "e1", namespace: "x"}}, lookups(), text).text).toBe("星瑕用了没有登记的数据类型");
    });

    it("对象还没读到或超出上限时只写种类，不写位置；章已删除的没有位置", () => {
        expect(pendingRow({kind: "canon", item: {kind: "cannot-apply", root: "c1", changes: ["c1"]}}, lookups(), text)).toMatchObject({text: "一条情节套不上了", place: ""});
        expect(pendingRow({kind: "canon", item: {kind: "chapter-deleted", ref: {kind: "change", id: "c1"}}}, lookups([storyChange("c1")]), text)).toMatchObject({text: "“情节c1”安放的那一章已经删除", place: ""});
    });
});

describe("pendingDetail", () => {
    it("核对点不符：原句带章、正文写的与算出来的数、嫌疑的每一笔（估计的标出来，初值点开的是条目）", () => {
        const estimated = storyChange("c2", {patches: [{at: check.at, op: "add", value: -200, basis: {kind: "estimate", note: "大概"}}]} as Partial<StoryChange>);
        const detail = pendingDetail(mismatch(1000), lookups([check, estimated]), text);
        expect(detail.quote).toEqual({text: "余额 500", chapter: "2"});
        expect(detail.facts).toEqual([{label: "正文写的数", value: "500"}, {label: "算出来的数", value: "1,000"}]);
        expect(detail.suspects).toEqual([
            {key: "c2", text: "情节c2", place: "第 2 章", estimate: true, target: {kind: "change", id: "c2"}, initial: false},
            {key: "init", text: "最初", place: "", estimate: false, target: {kind: "entry", id: "e1"}, initial: true},
        ]);
        expect(pendingDetailNeeds(mismatch(1000)).refs).toEqual([{kind: "check", id: "k1"}, {kind: "change", id: "c2"}]);
        expect(pendingNeeds(mismatch(1000)).entries).toEqual(["e1"]);
    });

    it("待定写原因与说明；套不上写根因、原因与跟着套不上的条数；已处理的发现写作者当时的决定", () => {
        const held = pendingDetail({kind: "canon", item: {kind: "held", change: "c1", reason: "conflict"}}, lookups([storyChange("c1", {held: {reason: "conflict", note: "存款不够"}} as Partial<StoryChange>)]), text);
        expect(held.facts).toEqual([{label: "原因", value: "与设定冲突：存款不够"}]);
        expect(held.quote).toEqual({text: "她数了数钱", chapter: "2"});
        expect(held.links).toEqual([{label: "打开这条情节", target: {kind: "change", id: "c1"}}]);

        // 根因查不到（根因就是第一条情节自己）：写原因与还有几条。
        const cannot = pendingDetail({kind: "canon", item: {kind: "cannot-apply", root: "c1", changes: ["c1", "c2", "c3"]}}, lookups([storyChange("c1")], {outcome: (id) => (id === "c1" ? {applied: false, reason: "entry-missing"} : undefined)}), text);
        expect(cannot.title).toBe("“情节c1”套不上了");
        expect(cannot.facts).toEqual([{label: "原因", value: "要改的条目不在了"}, {label: "跟着套不上的", value: "还有 2 条"}]);
        expect(cannot.links).toEqual([{label: "打开这条情节", target: {kind: "change", id: "c1"}}]);
        // 根因是一次修订：写它的标题，链到它的回执。
        const broken = pendingDetail({kind: "canon", item: {kind: "cannot-apply", root: "r9", changes: ["c1"]}}, lookups([storyChange("c1")], {outcome: () => ({applied: false, reason: "number-out-of-range"}), revisionTitle: (id) => (id === "r9" ? "继承了遗产" : undefined)}), text);
        expect(broken.facts).toEqual([{label: "原因", value: "改完的数超出了范围"}, {label: "让它套不上的那次改动", value: "“继承了遗产”"}]);
        expect(broken.links).toEqual([{label: "打开这条情节", target: {kind: "change", id: "c1"}}, {label: "看那次改动的回执", target: {kind: "receipt", id: "r9"}}]);
        expect(pendingNeeds({kind: "canon", item: {kind: "cannot-apply", root: "r9", changes: ["c1"]}}).refs).toEqual([{kind: "change", id: "c1"}]);

        const handled: PendingItem = {kind: "finding", diagnostic: "nbook.plot.chain", level: "pending", finding: {key: {detail: "x"}, objects: [{kind: "entry", id: "e1"}], params: {}}, handledBy: "d1"};
        const detail = pendingDetail(handled, lookups([decision]), text);
        expect(detail.facts).toEqual([{label: "作者当时的决定", value: "有意为之"}]);
        expect(detail.links).toEqual([{label: "星瑕", target: {kind: "entry", id: "e1"}}]);
        expect(pendingDetailNeeds(handled)).toEqual({refs: [{kind: "decision", id: "d1"}], entries: ["e1"]});
    });
});
