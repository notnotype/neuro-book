/**
 * 作者界面要的几项读取（canon.project 输出 28 到 35、验收 10；canon.model 输出 37；canon.components 输出 21）。
 * 都读星瑕样本：样本经世界服务发布到临时项目（真实的 `./node` 存储），期望值从样本的写入里数出来，不从被测的读取里取。
 */

import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {createHash} from "node:crypto";

import {buildRegistry, type ComponentDeclaration, type Entry, type OriginStep, type ReadPosition, type StoryChange, type WriteRequest} from "../src/index";
import {nodeFiles, WorldService, type ServiceEvent} from "../src/node/index";
import {memoryLock} from "./fixtures/faulty-files";
import {PANEL, PERSON} from "./fixtures/world";
import {componentDeclarations, loadXingxiaSample, type PrototypeSample} from "../src/sample/index";
import {replay, type Replayed} from "./sample/replay";

const sample = (await loadXingxiaSample()) as PrototypeSample;
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
        // 只改第 2 章各段讲的线：章序没变，不发布修订，同样靠 inputChanged。
        await service.setChapters(ids, new Map([["ch2", [{from: 1, line: "main"}, {from: 3, line: "main"}]]]), new Map([["ch2", "用钱说话"]]));
        expect(service.status().version).toBe(version);
        expect(events.splice(0)).toEqual(["inputChanged:chapters", "inputChanged:chapters"]);
        expect(service.chapters().items[1]!.lines).toEqual([{from: 1, line: "main"}, {from: 3, line: "main"}]);
        events.push("inputChanged:chapters");
        await service.setChapters(ids, undefined, new Map([["ch2", "用钱说话"]]));
        events.splice(0);
        events.push("inputChanged:chapters");
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
        // 只改适用的种类（提示，不进摘要）：照样通知，重读得到新的（components.md 输出 24）。
        const hinted = declared.filter((type) => type.namespace !== "panel").map((type) => (type.namespace === undefined ? type : {...type, kinds: ["人物"]}));
        expect(buildRegistry(hinted).digest).toBe(buildRegistry(declared.filter((type) => type.namespace !== "panel")).digest);
        await service.setRegistries({registry: buildRegistry(hinted)});
        expect(events).toEqual(["inputChanged:components", "inputChanged:components"]);
        expect(service.components().items.every((type) => type.kinds?.[0] === "人物")).toBe(true);
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
        expect(second).toMatchObject({ancestors: [], sameAs: null, folder: "人物", kind: "人物", appears: null});

        const brother = service.entry(ids.get("brother"), end("ch2"), "actual");
        if (typeof brother === "string") throw new Error(brother);
        expect(brother).toMatchObject({ancestors: [{id: xingxia, name: second.view.name}], sameAs: {id: xingxia, name: second.view.name}, folder: "人物"});
        // 出场存的原样（安放）：样本里的书从第 1 章出场。
        const book = service.entry(ids.get("book"), end("ch2"), "actual");
        if (typeof book === "string") throw new Error(book);
        expect(book.appears).toMatchObject({kind: "chapter", key: 30});
    });

    test("带视图令牌读条目：没有上级、本体与 changedAt", () => {
        const {service, ids} = replayed;
        const opened = service.openView({viewer: null, line: "main", until: end("ch2"), purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error("开不了视图");
        const read = service.viewed(opened.token).entry(ids.get("brother"), undefined);
        if (typeof read === "string" || read.view === null) throw new Error("读不到");
        expect("ancestors" in read || "sameAs" in read || "folder" in read || "kind" in read || "appears" in read).toBe(false);
        expect(Object.values(read.view.namespaces).flatMap((data) => Object.values(data.fields)).some((field) => "changedAt" in field)).toBe(false);
    });

    test("按地址取来历：从最近一步往前分页，变更的一步带安放与文字，初值在页外；翻页接得上；不存在的条目与没声明的路径是空的", () => {
        const {service, ids} = replayed;
        const address = {entry: ids.get("xingxia"), path: "panel.存款"};
        const whole = service.entry(address.entry, end("ch2"), "actual", true);
        if (typeof whole === "string" || !("origins" in whole) || whole.origins === undefined) throw new Error("读不到整份来历");
        const steps = whole.origins["panel.存款"] as readonly OriginStep[];
        const between = steps.filter((step) => step.kind !== "init" && step.kind !== "reduce").reverse();
        // 步数从样本数出来：最后留在世界里、安放在第 2 章末尾之前、改存款的已写变更，加核对存款的核对点。
        const patched = [...service.world.data.changes.values()].filter((change) => change.kind === "written" && change.status === "active" && change.patches.some((patch) => patch.at.entry === address.entry && patch.at.path === "panel.存款"));
        const checked = [...service.world.data.checks.values()].filter((check) => check.at.entry === address.entry && check.at.path === "panel.存款");
        expect(between.length).toBe(patched.length + checked.length);
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
        // 一页一步翻到底：每一步（含改完的值与核对的结果）与整条来历的对应位置一样，安放与文字是页上另加的。
        const bare = (item: object): unknown => {
            const {at: _at, text: _text, ...step} = item as Record<string, unknown>;
            return step;
        };
        const paged: unknown[] = [];
        let cursor: string | undefined;
        do {
            const page = service.origins(address, end("ch2"), "actual", cursor, 1);
            if (typeof page === "string") throw new Error(page);
            paged.push(...page.items.map(bare));
            cursor = page.cursor;
        } while (cursor !== undefined);
        expect(paged).toEqual(between);
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

/** 一个小世界：四章、一个人（面板、人物、会带过线的“回溯次数”）、一条回溯线。验收里星瑕样本没有的情形（子线、核对点给起点、列表元素、墓碑）在它上面测。 */
describe("canon.project 输出 30 到 33、canon.model 输出 37、canon.revisions 输出 24：子线、核对点、列表元素与墓碑", () => {
    const ROLLBACK: ComponentDeclaration = {id: "test.rollback", label: "回溯", namespace: "rb", version: 1, fields: [{id: "次数", label: "次数", kind: "number", carry: true}]};
    const CHAPTERS = ["ch1", "ch2", "ch3", "ch4"];
    let dir = "";
    let service: WorldService;
    let sequence = 0;
    const at = (chapter: string, key: number, line?: string) => ({kind: "chapter" as const, chapter, key, ...(line === undefined ? {} : {line})});
    const written = (id: string, placement: unknown, patches: unknown[] = [], extra: object = {}) => ({ref: {kind: "change" as const, id}, after: {id, kind: "written", text: id.replace("tmp:", ""), at: placement, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra}});
    const entry = (id: string, name: string, extra: Partial<Entry> = {}, data: Entry["init"]["data"] = {}) => ({ref: {kind: "entry" as const, id}, after: {id, type: "人物", parent: null, folder: "人物", order: 0, init: {name, aliases: [], summary: "", text: [], data}, ...extra}});
    const publish = async (puts: unknown[]): Promise<Readonly<Record<string, string>>> => {
        const result = await service.publish({requestId: `small-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "写入", baseVersion: service.status().version, puts} as WriteRequest);
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        return result.ids;
    };
    const open = async (chapters: readonly string[]): Promise<WorldService> => {
        const opened = await WorldService.open({files: nodeFiles, lock: memoryLock(), logDir: join(dir, "log"), sideDir: join(dir, "side"), cachePath: join(dir, "cache.jsonl"), chapterText: () => "", digest: (text) => createHash("sha256").update(text).digest("hex"), clock: () => 0, now: () => "2026-11-10T00:00:00.000Z"}, {chapters, registry: buildRegistry([PANEL, PERSON, ROLLBACK])});
        if ("code" in opened) throw new Error(opened.code);
        return opened;
    };

    beforeEach(async () => {
        dir = await createTestTmpRoot("nb-canon-author-reads-small");
        service = await open(CHAPTERS);
        sequence = 0;
    });
    afterEach(async () => {
        await service.stop();
        await removeMarkedTmpRoot(dir, join(dir, TMP_MARKER_FILE));
    });

    test("条目读取带上种类：是条目的 type，不是它所在的文件夹", async () => {
        const ids = await publish([entry("tmp:sect", "青云门", {type: "组织", folder: "势力"})]);
        const read = service.entry(ids["tmp:sect"]!, {kind: "chapter", chapter: "ch1", edge: "end"}, "actual");
        if (typeof read === "string") throw new Error(read);
        expect(read).toMatchObject({kind: "组织", folder: "势力"});
    });

    /** 星瑕与一条回溯线：第 2 章“回溯”把次数用掉（c3），线从 c1 之后重来。 */
    const withLine = async () => {
        const xia = (await publish([entry("tmp:xia", "星瑕", {}, {
            panel: {type: PANEL.id!, version: 1, enabled: true, declared: [{id: "幸运", label: "幸运", kind: "number"}], fields: {存款: 20000, 魔力上限: null, 魔力: null, 物品: [{id: "sword", label: "剑", 数量: 1}], 幸运: 7}},
            character: {type: PERSON.id!, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: "冷淡"}},
            rb: {type: ROLLBACK.id!, version: 1, enabled: true, fields: {次数: 1}},
        })]))["tmp:xia"]!;
        const story = await publish([
            written("tmp:c0", at("ch1", 10), [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 5}]),
            written("tmp:item", at("ch1", 20), [{op: "add", at: {entry: xia, path: "panel.物品[sword].数量"}, value: 2}]),
            written("tmp:c1", at("ch2", 10)),
            written("tmp:c3", at("ch2", 30), [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 0}]),
        ]);
        const forked = await publish([written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: story["tmp:c1"], trigger: story["tmp:c3"], type: "rollback", who: xia}})]);
        return {xia, story, line: forked["tmp:r1"]!};
    };
    const fields = (read: ReturnType<WorldService["entry"]>, namespace: string) => {
        if (typeof read === "string" || read.view === null) throw new Error("读不到条目");
        return read.view.namespaces[namespace]!.fields;
    };
    const stored = (id: string) => service.object({kind: "change", id}).object as StoryChange;

    test("changedAt：列表元素子字段的改动算在列表字段上；子线上带过去而本线没再改的值给原线上的那一条，不给分叉", async () => {
        const {xia, story, line} = await withLine();
        const main = service.entry(xia, end("ch1"), "actual", false, true);
        expect(fields(main, "panel")["物品"]!.changedAt).toEqual({by: "change", id: story["tmp:item"]!, at: stored(story["tmp:item"]!).at});
        expect(fields(main, "rb")["次数"]!.changedAt).toEqual({by: "change", id: story["tmp:c0"]!, at: stored(story["tmp:c0"]!).at});
        expect("changedAt" in fields(main, "panel")["存款"]!).toBe(false);

        const child = service.entry(xia, {...end("ch3"), line}, "actual", false, true);
        expect(fields(child, "rb")["次数"]).toMatchObject({value: 0, changedAt: {by: "change", id: story["tmp:c3"]!, at: stored(story["tmp:c3"]!).at}});
    });

    test("changedAt：语义档的起点由核对点给出时给那个核对点与它的安放", async () => {
        const {xia} = await withLine();
        const ids = await publish([{ref: {kind: "check", id: "tmp:k"}, after: {id: "tmp:k", at: {entry: xia, path: "character.态度"}, value: 3, told: {source: "note"}, place: at("ch1", 40), by: {kind: "author"}}}]);
        const read = service.entry(xia, end("ch1"), "actual", false, true);
        expect(fields(read, "character")["态度"]!.changedAt).toEqual({by: "check", id: ids["tmp:k"]!, at: at("ch1", 40)});
        // 核对点之前的位置没有。
        expect("changedAt" in fields(service.entry(xia, {kind: "chapter", chapter: "ch1", edge: "start"}, "actual", false, true), "character")["态度"]!).toBe(false);
    });

    test("changes 的 before 在子线上、不写 worldline：只列那条线视图里的，套没套上也按那条线算", async () => {
        const {xia, line} = await withLine();
        const own = (await publish([written("tmp:o", at("ch3", 5, line), [{op: "add", at: {entry: xia, path: "panel.存款"}, value: -100}])]))["tmp:o"]!;
        const page = service.changes({before: {position: {...end("ch4"), line}, mode: "actual"}, order: "desc"});
        if (typeof page === "string") throw new Error(page);
        expect(page.items.find((item) => item.change.id === own)).toMatchObject({outcome: {applied: true}});
        expect(page.items.every((item) => item.outcome !== null)).toBe(true);
        // 主线上看不到这条线上的变更。
        const onMain = service.changes({before: {position: end("ch4"), mode: "actual"}});
        if (typeof onMain === "string") throw new Error(onMain);
        expect(onMain.items.some((item) => item.change.id === own)).toBe(false);
    });

    test("changes 按条目筛：只经参与者、只经马甲、只写在 involves、只经补丁涉及它的都列出，按安放排；再发布一条安放在中间的，下一次读就有它、排在它的位置上", async () => {
        const ids = await publish([
            entry("tmp:xia", "星瑕", {}, {panel: {type: PANEL.id!, version: 1, enabled: true, fields: {存款: 100, 魔力上限: null, 魔力: null, 物品: []}}}),
            entry("tmp:other", "白灵"),
        ]);
        const [xia, other] = [ids["tmp:xia"]!, ids["tmp:other"]!];
        const ge = (await publish([entry("tmp:ge", "哥哥", {parent: xia, sameAs: xia})]))["tmp:ge"]!;
        const story = await publish([
            written("tmp:unrelated", at("ch1", 5), [], {involves: [other]}),
            written("tmp:cast", at("ch1", 10), [], {cast: [{who: xia, role: "present"}]}),
            written("tmp:as", at("ch2", 10), [], {cast: [{who: xia, as: ge, role: "present"}]}),
            written("tmp:involves", at("ch3", 10), [], {involves: [xia]}),
            written("tmp:patch", at("ch4", 10), [{op: "add", at: {entry: xia, path: "panel.存款"}, value: 5}]),
        ]);
        const listed = (entryId: string): string[] => {
            const page = service.changes({entry: entryId});
            if (typeof page === "string") throw new Error(page);
            return page.items.map((item) => item.change.id);
        };
        expect(listed(xia)).toEqual(["tmp:cast", "tmp:as", "tmp:involves", "tmp:patch"].map((id) => story[id]!));
        expect(listed(ge)).toEqual([story["tmp:as"]!]);
        // 没有变更涉及它的 id（条目不存在）：空列表。
        expect(listed("e404")).toEqual([]);
        const late = (await publish([written("tmp:late", at("ch2", 20), [], {involves: [xia]})]))["tmp:late"]!;
        expect(listed(xia)).toEqual([story["tmp:cast"]!, story["tmp:as"]!, late, story["tmp:involves"]!, story["tmp:patch"]!]);
    });

    test("changes 按命名空间筛：给了条目只列改了这个条目这个命名空间的（同一个补丁上两样都对才算），只经参与、涉及的不列；不给条目时算任何条目上的改动；命名空间随筛选进游标", async () => {
        const panel = (deposit: number) => ({panel: {type: PANEL.id!, version: 1, enabled: true, fields: {存款: deposit, 魔力上限: null, 魔力: null, 物品: [{id: "sword", label: "剑", 数量: 1}]}}});
        const ids = await publish([entry("tmp:xia", "星瑕", {}, panel(100)), entry("tmp:other", "白灵", {}, panel(50))]);
        const [xia, other] = [ids["tmp:xia"]!, ids["tmp:other"]!];
        const story = await publish([
            written("tmp:cast", at("ch1", 10), [], {cast: [{who: xia, role: "present"}]}),
            written("tmp:mine", at("ch2", 10), [{op: "add", at: {entry: xia, path: "panel.存款"}, value: 5}]),
            written("tmp:theirs", at("ch3", 10), [{op: "add", at: {entry: other, path: "panel.存款"}, value: 7}], {involves: [xia]}),
            written("tmp:name", at("ch4", 10), [{op: "set", at: {entry: xia, path: "entry.name"}, value: "星瑕二号"}]),
            written("tmp:item", at("ch4", 20), [{op: "add", at: {entry: xia, path: "panel.物品[sword].数量"}, value: 1}]),
            // 一条变更里星瑕的补丁不在 panel、白灵的补丁在 panel：按星瑕与 panel 筛时不算。
            written("tmp:mixed", at("ch4", 30), [{op: "set", at: {entry: xia, path: "entry.summary"}, value: "改了简介"}, {op: "add", at: {entry: other, path: "panel.存款"}, value: 1}]),
        ]);
        const listed = (filter: {entry?: string; namespace: string}): string[] => {
            const page = service.changes(filter);
            if (typeof page === "string") throw new Error(page);
            return page.items.map((item) => item.change.id);
        };
        expect(listed({entry: xia, namespace: "panel"})).toEqual([story["tmp:mine"]!, story["tmp:item"]!]);
        expect(listed({entry: other, namespace: "panel"})).toEqual([story["tmp:theirs"]!, story["tmp:mixed"]!]);
        // 改名字、简介不算任何命名空间；没有这个命名空间的改动、只是命名空间名字的开头对上：空列表。
        expect(listed({entry: xia, namespace: "character"})).toEqual([]);
        expect(listed({entry: xia, namespace: "pan"})).toEqual([]);
        expect(listed({namespace: "panel"}).filter((id) => Object.values(story).includes(id))).toEqual([story["tmp:mine"]!, story["tmp:theirs"]!, story["tmp:item"]!, story["tmp:mixed"]!]);
        const first = service.changes({entry: xia, namespace: "panel"}, undefined, 1);
        if (typeof first === "string" || first.cursor === undefined) throw new Error("应当还有下一页");
        expect(service.changes({entry: xia, namespace: "character"}, first.cursor, 1)).toBe("cursor-stale");
        expect(service.changes({entry: xia}, first.cursor, 1)).toBe("cursor-stale");
        const second = service.changes({entry: xia, namespace: "panel"}, first.cursor, 1);
        if (typeof second === "string") throw new Error(second);
        expect(second.items.map((item) => item.change.id)).toEqual([story["tmp:item"]!]);
    });

    test("条目读取带每个命名空间生效的字段声明，含条目上实例声明的；来历对“不是列表的字段带元素”是空的", async () => {
        const {xia} = await withLine();
        const read = service.entry(xia, end("ch1"), "actual");
        if (typeof read === "string" || !("declarations" in read)) throw new Error("读不到条目");
        expect(read.declarations.panel).toEqual([...PANEL.fields!, {id: "幸运", label: "幸运", kind: "number"}]);
        expect(read.declarations.rb).toEqual(ROLLBACK.fields!);
        const empty = {items: [], total: 0, initial: null, reduced: null};
        expect(service.origins({entry: xia, path: "panel.存款[x]"}, end("ch4"), "actual")).toMatchObject(empty);
        expect(service.origins({entry: xia, path: "panel.物品[sword].没有"}, end("ch4"), "actual")).toMatchObject(empty);
        expect(service.origins({entry: xia, path: "panel.物品[sword].数量"}, end("ch4"), "actual")).toMatchObject({total: 1, initial: {kind: "init", value: 1}});
        expect(service.origins({entry: xia, path: "panel.幸运"}, end("ch4"), "actual")).toMatchObject({total: 0, initial: {kind: "init", value: 7}});
    });

    test("墓碑：已删除的条目下面只有已删除的子条目时不列；上级唯一的子条目删了以后 hasChildren 为假", async () => {
        const ids = await publish([entry("tmp:p", "父"), entry("tmp:q", "另一个父")]);
        const children = await publish([entry("tmp:c", "子", {parent: ids["tmp:p"]!}), entry("tmp:d", "独子", {parent: ids["tmp:q"]!})]);
        const remove = async (id: string) => publish([{ref: {kind: "entry", id}, after: {...(service.object({kind: "entry", id}).object as Entry), deleted: true}}]);
        const roots = () => {
            const page = service.tree(null);
            if (typeof page === "string") throw new Error(page);
            return page.items.map((item) => ({name: item.name, deleted: item.deleted, hasChildren: item.hasChildren}));
        };
        expect(roots()).toEqual([{name: "父", deleted: false, hasChildren: true}, {name: "另一个父", deleted: false, hasChildren: true}]);
        await remove(children["tmp:d"]!);
        await remove(ids["tmp:p"]!);
        // 父删了、子还在：作墓碑列出；另一个父的独子删了：它没有子项了。
        expect(roots()).toEqual([{name: "父", deleted: true, hasChildren: true}, {name: "另一个父", deleted: false, hasChildren: false}]);
        await remove(children["tmp:c"]!);
        expect(roots()).toEqual([{name: "另一个父", deleted: false, hasChildren: false}]);
    });

    test("就地改与记一笔的请求 id：可选的键写成 undefined 与不写是同一次请求；被普通写入用过的请求 id 得到 request-id-reused；语义档的记一笔重发返回第一次的结果", async () => {
        const {xia} = await withLine();
        const version = service.status().version;
        const edit = {requestId: "edit-1", by: {kind: "author"} as const, position: {kind: "initial"} as const, at: {entry: xia, path: "entry.name"}, value: "夜王", read: {value: "星瑕", version}};
        const first = await service.editInPlace({...edit, title: undefined, intent: undefined} as never);
        if (!first.ok) throw new Error(JSON.stringify(first.failure));
        expect(await service.editInPlace(edit)).toMatchObject({ok: true, repeated: true, revision: {id: first.revision.id}});
        // `small-1` 是建星瑕那次普通写入用过的请求 id。
        expect(await service.editInPlace({...edit, requestId: "small-1"})).toMatchObject({ok: false, failure: {code: "request-id-reused"}});

        const note = {requestId: "note-1", by: {kind: "author"} as const, position: end("ch1"), at: {entry: xia, path: "character.态度"}, text: "把卡推了回去", read: {value: "冷淡", version: service.status().version}};
        const noted = await service.recordNote(note);
        if (!noted.ok) throw new Error(JSON.stringify(noted.failure));
        const revisions = service.world.revisions.length;
        expect(await service.recordNote(note)).toMatchObject({ok: true, repeated: true, revision: {id: noted.revision.id}});
        expect(service.world.revisions.length).toBe(revisions);
        expect(await service.recordNote({...note, text: "别的话"})).toMatchObject({ok: false, failure: {code: "request-id-reused"}});
        // 预览交出的修订带的是调用方的请求 id。
        const preview = service.previewEdit({kind: "note", ...note, requestId: "note-2", read: {value: service.entry(xia, end("ch1"), "actual") === null ? null : (fields(service.entry(xia, end("ch1"), "actual"), "character")["态度"]!.value), version: service.status().version}});
        if (!preview.ok) throw new Error(JSON.stringify(preview.failure));
        expect(preview.revision.requestId).toBe("note-2");
    });

    test("没有章的作品：写过东西以后宿主再给一次空章序，不发布章序调整", async () => {
        await service.stop();
        await removeMarkedTmpRoot(dir, join(dir, TMP_MARKER_FILE));
        dir = await createTestTmpRoot("nb-canon-author-reads-empty");
        service = await open([]);
        const events: ServiceEvent["kind"][] = [];
        service.subscribe((event) => events.push(event.kind));
        await publish([entry("tmp:a", "甲")]);
        await service.setChapters([]);
        expect(events).toEqual(["changed"]);
        expect(service.world.revisions.map((revision) => revision.what)).toEqual(["edit"]);
    });
});
