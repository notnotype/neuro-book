/**
 * 作者界面要的几项读取（canon.project 输出 28 到 35、验收 10；canon.model 输出 37；canon.components 输出 21）。
 * 都读星瑕样本：样本经世界服务发布到临时项目（真实的 `./node` 存储），期望值从样本的写入里数出来，不从被测的读取里取。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type Entry, type OriginStep, type ReadPosition, type StoryChange} from "../src/index";
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

describe("canon.project 输出 30、32、33 与 canon.model 输出 37：条目树带位置、条目的上级与最近改动、按地址取来历", () => {
    const start = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "start"});

    test("条目树：马甲“哥哥”在星瑕下面、sameAs 是星瑕；根这一层带位置上的名字与出场，一页 2 项时 remaining 是其余会列出的条数", () => {
        const {service, ids} = replayed;
        const xingxia = ids.get("xingxia");
        const below = service.tree(xingxia, undefined, 50, {position: start("ch1"), mode: "actual"});
        if (typeof below === "string") throw new Error(below);
        expect(below.items.find((item) => item.id === ids.get("brother"))).toMatchObject({name: "哥哥", nameAt: "哥哥", sameAs: xingxia, deleted: false});

        const roots = [...service.world.data.entries.values()].filter((entry) => entry.parent === null && entry.deleted !== true);
        const page = service.tree(null, undefined, 2, {position: start("ch1"), mode: "actual"});
        if (typeof page === "string") throw new Error(page);
        expect(page.items).toHaveLength(2);
        expect(page.remaining).toBe(roots.length - 2);
        // 每项的出场与名字就是在这个位置读这个条目得到的。
        for (const item of page.items) {
            const read = service.entry(item.id, start("ch1"), "actual");
            if (typeof read === "string" || read.view === null) throw new Error("读不到条目");
            expect(item).toMatchObject({nameAt: read.view.name, appeared: read.view.appeared});
        }
        // 样本里有第 1 章之后才出场的条目：在第 1 章开头读是未出场。
        const all = service.tree(null, undefined, 1000, {position: start("ch1"), mode: "actual"});
        const later = service.tree(null, undefined, 1000, {position: end("ch3"), mode: "actual"});
        if (typeof all === "string" || typeof later === "string") throw new Error("读取失败");
        expect(all.remaining).toBe(0);
        const appearedLater = all.items.filter((item) => !item.appeared && later.items.find((other) => other.id === item.id)?.appeared === true);
        expect(appearedLater.length).toBeGreaterThan(0);

        // 位置属于游标的读取参数；章不存在得到 chapter-not-found。
        if (page.cursor === undefined) throw new Error("要有下一页");
        expect(service.tree(null, page.cursor, 2, {position: end("ch1"), mode: "actual"})).toBe("cursor-stale");
        expect(service.tree(null, undefined, 2, {position: end("ch9"), mode: "actual"})).toBe("chapter-not-found");
    });

    test("删掉一个没有子条目的条目后它不再列出，remaining 少一；它的上级照常显示有没有子项", async () => {
        const {service, ids} = replayed;
        const xingxia = ids.get("xingxia");
        const before = service.tree(xingxia, undefined, 1);
        if (typeof before === "string") throw new Error(before);
        const brother = service.object({kind: "entry", id: ids.get("brother")}).object as Entry;
        const result = await service.publish({requestId: "delete-brother", by: {kind: "author"}, what: "edit", title: "删除哥哥", baseVersion: service.status().version, puts: [{ref: {kind: "entry", id: brother.id}, after: {...brother, deleted: true}}]});
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        const after = service.tree(xingxia, undefined, 1000);
        if (typeof after === "string") throw new Error(after);
        expect(after.items.some((item) => item.id === brother.id)).toBe(false);
        expect(after.items.length + after.remaining).toBe(before.items.length + before.remaining - 1);
    });

    test("要最近一次改动：第 1 章末尾存款没有 changedAt，第 2 章末尾是“工资到账”那条与它的安放；“哥哥”的上级与本体都是星瑕", () => {
        const {service, ids} = replayed;
        const xingxia = ids.get("xingxia");
        const plain = service.entry(xingxia, end("ch2"), "actual");
        const first = service.entry(xingxia, end("ch1"), "actual", false, true);
        const second = service.entry(xingxia, end("ch2"), "actual", false, true);
        if (typeof plain === "string" || typeof first === "string" || typeof second === "string" || plain.view === null || first.view === null || second.view === null) throw new Error("读不到星瑕");
        expect("changedAt" in plain.view.namespaces.panel!.fields["存款"]!).toBe(false);
        expect("changedAt" in first.view.namespaces.panel!.fields["存款"]!).toBe(false);
        // 样本最后一项“记一笔：工资到账”新建的那条变更。
        const salary = service.world.revisions.at(-1)!.ops.find((op) => op.kind === "create" && op.ref.kind === "change") as {ref: {id: string}};
        expect(second.view.namespaces.panel!.fields["存款"]!.changedAt).toEqual({by: "change", id: salary.ref.id, at: (service.object({kind: "change", id: salary.ref.id}).object as StoryChange).at});
        // 不要的时候与要的时候，别的内容一样。
        expect({...second.view.namespaces.panel!.fields["存款"]!, changedAt: undefined}).toEqual({...plain.view.namespaces.panel!.fields["存款"]!, changedAt: undefined});
        expect(second).toMatchObject({ancestors: [], sameAs: null, folder: "人物"});

        const brother = service.entry(ids.get("brother"), end("ch2"), "actual");
        if (typeof brother === "string") throw new Error(brother);
        expect(brother).toMatchObject({ancestors: [{id: xingxia, name: second.view.name}], sameAs: {id: xingxia, name: second.view.name}, folder: "人物"});
    });

    test("带视图令牌读条目：没有上级、本体与 changedAt", () => {
        const {service, ids} = replayed;
        const opened = service.openView({viewer: null, line: "main", until: end("ch2"), purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error("开不了视图");
        const read = service.viewed(opened.token).entry(ids.get("brother"), undefined);
        if (typeof read === "string" || read.view === null) throw new Error("读不到");
        expect("ancestors" in read || "sameAs" in read || "folder" in read).toBe(false);
        expect(Object.values(read.view.namespaces).flatMap((data) => Object.values(data.fields)).some((field) => "changedAt" in field)).toBe(false);
    });

    test("按地址取来历：从最近一步往前分页，变更的一步带安放与文字，初值在页外；翻页接得上；不存在的条目与没声明的路径是空的", () => {
        const {service, ids} = replayed;
        const address = {entry: ids.get("xingxia"), path: "panel.存款"};
        const whole = service.entry(address.entry, end("ch2"), "actual", true);
        if (typeof whole === "string" || !("origins" in whole) || whole.origins === undefined) throw new Error("读不到整份来历");
        const steps = whole.origins["panel.存款"] as readonly OriginStep[];
        const between = steps.filter((step) => step.kind !== "init" && step.kind !== "reduce").reverse();
        expect(between.length).toBeGreaterThan(3);

        const first = service.origins(address, end("ch2"), "actual", undefined, 2);
        if (typeof first === "string") throw new Error(first);
        expect(first.total).toBe(between.length);
        expect(first.initial as OriginStep | null).toEqual(steps[0]!);
        expect(first.initial).toMatchObject({kind: "init", value: 41800});
        expect(first.reduced).toBeNull();
        const source = (step: OriginStep) => (step.kind === "patch" ? step.change : step.kind === "check" ? step.check : null);
        expect(first.items.map(source)).toEqual(between.slice(0, 2).map(source));
        const newest = first.items[0] as {kind: string; change: string; at: unknown; text: string};
        expect(newest.kind).toBe("patch");
        const stored = service.object({kind: "change", id: newest.change}).object as StoryChange;
        expect(newest).toMatchObject({at: stored.at, text: stored.text});
        expect(stored.text).toContain("工资到账");

        const rest = service.origins(address, end("ch2"), "actual", first.cursor, 1000);
        if (typeof rest === "string") throw new Error(rest);
        expect([...first.items, ...rest.items]).toHaveLength(between.length);
        expect(rest.cursor).toBeUndefined();
        // 核对点的一步带它的安放。
        const check = [...first.items, ...rest.items].find((step) => step.kind === "check") as {check: string; at: unknown} | undefined;
        expect(check?.at).toEqual((service.object({kind: "check", id: check!.check}).object as {place: unknown}).place);

        const empty = {items: [], total: 0, initial: null, reduced: null};
        expect(service.origins({entry: "e999999", path: "panel.存款"}, end("ch2"), "actual")).toMatchObject(empty);
        expect(service.origins({entry: address.entry, path: "panel.没有这个字段"}, end("ch2"), "actual")).toMatchObject(empty);
        expect(service.origins({entry: address.entry, path: "不是路径"}, end("ch2"), "actual")).toMatchObject(empty);
        expect(service.origins(address, end("ch9"), "actual")).toBe("chapter-not-found");
        // 名字的来历也能按地址取。
        const name = service.origins({entry: address.entry, path: "entry.name"}, end("ch2"), "actual");
        if (typeof name === "string") throw new Error(name);
        expect(name.initial).toMatchObject({kind: "init"});
    });
});
