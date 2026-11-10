/**
 * 作者界面要的几项读取（canon.project 输出 28 到 35、验收 10；canon.model 输出 37；canon.components 输出 21）。
 * 都读星瑕样本：样本经世界服务发布到临时项目（真实的 `./node` 存储），期望值从样本的写入里数出来，不从被测的读取里取。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type ReadPosition, type StoryChange} from "../src/index";
import {componentDeclarations, type PrototypeSample} from "./sample/convert";
import {replay, type Replayed} from "./sample/replay";

const sample = JSON.parse(await readFile(join(import.meta.dir, "sample", "xingxia-prototype.json"), "utf8")) as PrototypeSample;
const end = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "end"});

let root = "";
let replayed: Replayed;
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-author-reads");
    replayed = await replay(root, sample);
});
afterEach(async () => {
    await replayed.service.stop();
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

/** 存下来的变更里涉及这个条目的（参与、补丁改到或写在 involves 里），按安放筛。 */
function stored(entry: string, where: (change: StoryChange) => boolean): StoryChange[] {
    return [...replayed.service.world.data.changes.values()].filter((change) =>
        (change.involves.includes(entry) || (change.cast ?? []).some((member) => member.who === entry || member.as === entry) || change.patches.some((patch) => patch.at.entry === entry)) && where(change));
}

describe("canon.project 输出 31：剧情变更的筛选与顺序", () => {
    test("筛“涉及星瑕、第 1 章末尾之前、从新到旧”：第一项是第 1 章最后一条，total 是前史加第 1 章涉及她的条数", () => {
        const xingxia = replayed.ids.get("xingxia");
        const {service} = replayed;
        const page = service.changes({entry: xingxia, before: {position: end("ch1"), mode: "actual"}, order: "desc"}, undefined, 2);
        if (typeof page === "string") throw new Error(page);
        const expected = stored(xingxia, (change) => change.kind === "written" && (change.at.kind === "prehistory" || (change.at.kind === "chapter" && change.at.chapter === "ch1")));
        expect(expected.length).toBeGreaterThan(2);
        expect(page.total).toBe(expected.length);
        expect(page.items).toHaveLength(2);
        const lastOfCh1 = expected.filter((change) => change.at.kind === "chapter").sort((a, b) => (b.at as {key: number}).key - (a.at as {key: number}).key)[0]!;
        expect(page.items[0]!.change.id).toBe(lastOfCh1.id);

        // 翻到底：从新到旧正好是从旧到新倒过来。
        const all = service.changes({entry: xingxia, before: {position: end("ch1"), mode: "actual"}, order: "desc"}, undefined, 1000);
        const ascending = service.changes({entry: xingxia, before: {position: end("ch1"), mode: "actual"}}, undefined, 1000);
        if (typeof all === "string" || typeof ascending === "string") throw new Error("读取失败");
        expect(all.items.map((item) => item.change.id)).toEqual(ascending.items.map((item) => item.change.id).reverse());
        expect(ascending.total).toBe(expected.length);
    });

    test("初值之前什么也没有；实际模式不列计划，按计划模式列这个位置计入的计划", () => {
        const xingxia = replayed.ids.get("xingxia");
        const {service} = replayed;
        const initial = service.changes({before: {position: {kind: "initial"}, mode: "actual"}});
        if (typeof initial === "string") throw new Error(initial);
        expect(initial).toMatchObject({items: [], total: 0});

        const actual = service.changes({entry: xingxia, before: {position: end("ch3"), mode: "actual"}}, undefined, 1000);
        const planned = service.changes({entry: xingxia, before: {position: end("ch3"), mode: "planned"}}, undefined, 1000);
        if (typeof actual === "string" || typeof planned === "string") throw new Error("读取失败");
        expect(actual.items.every((item) => item.change.kind === "written")).toBe(true);
        // 最新一章末尾计入的计划：排了章、生效、到这里还没兑现的（已兑现、被取代的不算，model.md 输出 5）。
        const unfulfilled = service.changes({entry: xingxia, kind: "plan", status: "active", progress: "unfulfilled"}, undefined, 1000);
        if (typeof unfulfilled === "string") throw new Error(unfulfilled);
        const counted = unfulfilled.items.filter((item) => item.change.at.kind !== "unscheduled").map((item) => item.change.id);
        expect(counted.length).toBeGreaterThan(0);
        const plans = planned.items.filter((item) => item.change.kind === "plan" && item.change.status === "active").map((item) => item.change.id);
        expect(plans.sort()).toEqual(counted.sort());
        expect(planned.total).toBe(actual.total + planned.items.filter((item) => item.change.kind === "plan").length);
    });

    test("位置与顺序属于游标的读取参数：换了顺序拿旧游标得到 cursor-stale；章不存在得到 chapter-not-found", () => {
        const {service} = replayed;
        const first = service.changes({before: {position: end("ch2"), mode: "actual"}, order: "desc"}, undefined, 1);
        if (typeof first === "string" || first.cursor === undefined) throw new Error("要有下一页");
        expect(service.changes({before: {position: end("ch2"), mode: "actual"}}, first.cursor, 1)).toBe("cursor-stale");
        expect(service.changes({before: {position: end("ch1"), mode: "actual"}, order: "desc"}, first.cursor, 1)).toBe("cursor-stale");
        const next = service.changes({before: {position: end("ch2"), mode: "actual"}, order: "desc"}, first.cursor, 1);
        if (typeof next === "string") throw new Error(next);
        expect(next.items[0]!.change.id).not.toBe(first.items[0]!.change.id);
        expect(service.changes({before: {position: end("ch9"), mode: "actual"}})).toBe("chapter-not-found");
    });
});

describe("canon.project 输出 28、29、34 与 canon.components 输出 21：章表、读一次修订、登记的类型", () => {
    test("章表给出各章的序号、宿主给的标题与各段讲的线；宿主只改一章的标题或段的线：版本不变，收到 inputChanged，重读得到新的", async () => {
        const {service} = replayed;
        const ids = sample.chapters.map((chapter) => chapter.id);
        expect(service.chapters().items).toEqual(ids.map((id, index) => ({id, index: index + 1, title: null, lines: [{from: 1, line: "main"}]})));

        const events: string[] = [];
        const stop = service.subscribe((event) => events.push(event.kind === "inputChanged" ? `inputChanged:${event.what}` : event.kind));
        const version = service.status().version;
        await service.setChapters(ids, undefined, new Map([["ch2", "用钱说话"]]));
        expect(service.status().version).toBe(version);
        expect(events).toEqual(["inputChanged:chapters"]);
        expect(service.chapters().items[1]).toMatchObject({id: "ch2", index: 2, title: "用钱说话"});

        // 同样的章表再给一次：什么也不发。
        await service.setChapters(ids, undefined, new Map([["ch2", "用钱说话"]]));
        expect(events).toEqual(["inputChanged:chapters"]);
        // 章序变了：发布章序调整，只有 changed。
        await service.setChapters([...ids].reverse(), undefined, new Map([["ch2", "用钱说话"]]));
        expect(events).toEqual(["inputChanged:chapters", "changed"]);
        expect(service.chapters().items.map((item) => [item.id, item.index])).toEqual([...ids].reverse().map((id, index) => [id, index + 1]));
        stop();
    });

    test("读第 2 章记账那次修订：新建的对象有改后，改过的对象逐个字段有改前改后，带能不能还原；没有这次修订时是 null", () => {
        const {service} = replayed;
        // 第 1 次修订是打开时的章序调整；样本第 6 项“写完第 2 章，Agent 记账”是第 7 次。
        const stored = service.world.revisions[6]!;
        expect(stored.title).toContain("第 2 章");
        const read = service.revision(stored.id);
        expect(read.revision).toEqual(stored);
        expect(read.version).toBe(service.status().version);
        const ops = read.revision!.ops.filter((op) => op.kind !== "chapters");
        expect(ops.some((op) => op.kind === "create" && op.ref.kind === "change" && op.after !== undefined && !("before" in op))).toBe(true);
        expect(ops.some((op) => op.kind === "modify" && op.fields.length > 0 && op.fields.every((field) => "before" in field || "after" in field))).toBe(true);
        // 它后面“把蛋糕改成 −2,000”改过它新建的变更，所以不能单独还原。
        expect(read.revertable).toMatchObject({ok: false, reason: "has-dependents"});
        expect(service.revision(service.world.revisions[0]!.id).revertable).toEqual({ok: false, reason: "not-revertable"});
        expect(service.revision(service.world.revisions.at(-1)!.id).revertable).toEqual({ok: true});
        expect(service.revision("r999999")).toMatchObject({revision: null});
        expect("revertable" in service.revision("r999999")).toBe(false);
    });

    test("登记的类型给出每个字段的声明原样；登记变了：版本不变，收到 inputChanged，重读得到新的", async () => {
        const {service} = replayed;
        const declared = componentDeclarations(sample);
        const listed = service.components().items;
        expect(listed.map((type) => type.id).sort()).toEqual(declared.filter((type) => type.namespace !== undefined).map((type) => type.id).sort());
        const panel = declared.find((type) => type.namespace === "panel")!;
        expect(listed.find((type) => type.namespace === "panel")).toMatchObject({id: panel.id, label: panel.label, namespace: "panel", version: panel.version, fields: panel.fields, instanceFields: panel.instanceFields === true});

        const events: string[] = [];
        const stop = service.subscribe((event) => events.push(event.kind === "inputChanged" ? `inputChanged:${event.what}` : event.kind));
        const version = service.status().version;
        await service.setRegistries({registry: buildRegistry(declared)});
        expect(events).toEqual([]);
        await service.setRegistries({registry: buildRegistry(declared.filter((type) => type.namespace !== "panel"))});
        expect(events).toEqual(["inputChanged:components"]);
        expect(service.status().version).toBe(version);
        expect(service.components().items.some((type) => type.namespace === "panel")).toBe(false);
        stop();
    });
});
