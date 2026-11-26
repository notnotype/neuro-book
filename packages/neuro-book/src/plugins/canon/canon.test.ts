/**
 * 世界服务在真实项目子进程里（docs/specs/canon/project.md 输出 1、10、13、18、21、23）：服务端实例、路由与项目
 * 管理器是真实的，项目子进程跑项目宿主的测试入口（产品插件里含 `nbook.canon` 的项目入口），窗口是本进程里的浏览器
 * 内核实例，装 `nbook.canon` 的浏览器入口，经进程内链路绑定项目。目录监视是异步的：等可观察的结果，不按时长等待。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {replaceLocked} from "@notnotype/nb-file-lock";
import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";

import {componentsPoint, type ComponentContribution} from "./shared/components";
import {CANON_BUDGET_BYTES, canonClientKey, RENDER_SOURCE_MAX} from "./shared/contracts";
import type {CanonClient, CanonEvent} from "./shared/contracts";
import {publish, serverPlugins, until, version, windowOf} from "./testing/harness";
import {CANON_PROBE_ID, PROBE_DIAGNOSTIC, PROBE_MARK} from "./testing/probe-plugin";
import {venueScenario} from "./testing/venue-scenario";
import {canonBrowserPlugin} from "./web/plugin";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "project-child");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

let sequence = 0;
function person(name: string, extra: Partial<Entry["init"]> = {}): WriteRequest {
    const id = `tmp:${String(++sequence)}`;
    const entry: Entry = {id, type: "nbook.canon.person", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {性格: null, 身份: null, 现在的状态: null}}}, ...extra}};
    return {requestId: `req-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: name, baseVersion: 0, puts: [{ref: {kind: "entry", id}, after: entry}]};
}

async function binder(h: ProjectHarness, xml: string): Promise<void> {
    await mkdir(join(h.project.path, "manuscripts.binder"), {recursive: true});
    const result = await replaceLocked(join(h.project.path, "manuscripts.binder", "binder.xml"), {lockPath: join(h.project.path, ".nbook", "locks", "binder.lock"), decide: () => ({write: xml}), report: () => undefined});
    expect(result.ok).toBe(true);
}

async function reorders(canon: CanonClient): Promise<number> {
    const page = await canon.call("revisions", {filter: {by: "system"}});
    if (!page.ok) throw new Error(page.failure.code);
    return page.value.items.filter((item) => item.what === "reorder").length;
}

describe("canon.project：世界服务在项目子进程里", () => {
    it("输出 1、13、21：两个窗口共用项目里的一个世界；一边发布，另一边收到 changed 后读到；日志与锁在 .nbook 下", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const first = await windowOf(h, "browser-1", "profile-1");
        const second = await windowOf(h, "browser-2", "profile-2");
        const seen: CanonEvent[] = [];
        expect((await second.canon.subscribe((event) => seen.push(event))).ok).toBe(true);

        const result = await publish(first.canon, person("星瑕"));
        if (!result.ok) throw new Error(result.failure.code);
        expect(result.value.version).toBe(1);
        await until(() => seen.some((event) => event.kind === "changed" && event.version === 1));
        const found = await second.canon.call("lookup", {names: ["星瑕"], position: {kind: "initial"}});
        expect(found).toMatchObject({ok: true, value: {version: 1, found: {星瑕: Object.values(result.value.ids)}}});
        // 只有主线的作品：世界线的树是空的。
        expect(await second.canon.call("lines", {})).toMatchObject({ok: true, value: {version: 1, lines: []}});
        expect(existsSync(join(h.project.path, ".nbook", "world", "log", "000001.jsonl"))).toBe(true);
        expect(existsSync(join(h.project.path, ".nbook", "locks"))).toBe(true);

        await first.close();
        await second.close();
        keep.release();
    }, 30_000);

    it("输出 28 到 35、canon.model 输出 37 与 canon.components 输出 21：经链路读章表、一次修订、登记的类型、条目树、条目的上级与来历；章节文件改名收到 inputChanged", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const author = await windowOf(h, "browser-1", "profile-1");
        const seen: CanonEvent[] = [];
        expect((await author.canon.subscribe((event) => seen.push(event))).ok).toBe(true);

        const dir = join(h.project.path, "manuscripts.binder");
        await mkdir(dir, {recursive: true});
        await writeFile(join(dir, "00001-好哥哥真难当.md"), "第一章\n");
        await writeFile(join(dir, "00002-用钱说话.md"), "第二章\n");
        await binder(h, `<binder><chapter id="1"/><chapter id="2"/></binder>`);
        const table = async () => {
            const read = await author.canon.call("chapters", {});
            if (!read.ok) throw new Error(read.failure.code);
            return read.value.items;
        };
        await until(async () => (await table()).length === 2);
        expect(await table()).toEqual([{id: "1", index: 1, title: "好哥哥真难当", lines: [{from: 1, line: "main"}]}, {id: "2", index: 2, title: "用钱说话", lines: [{from: 1, line: "main"}]}]);

        // 只改章节文件的名字：章序没变，不发布修订，靠 inputChanged 知道要重读章表。
        const before = await version(author.canon);
        await rename(join(dir, "00002-用钱说话.md"), join(dir, "00002-卡里的两万.md"));
        await until(() => seen.some((event) => event.kind === "inputChanged" && event.what === "chapters"));
        expect((await table())[1]).toMatchObject({id: "2", title: "卡里的两万"});
        expect(await version(author.canon)).toBe(before);

        const written = await publish(author.canon, {...person("星瑕"), baseVersion: before});
        if (!written.ok) throw new Error(written.failure.code);
        const revision = await author.canon.call("revision", {id: written.value.revision});
        expect(revision).toMatchObject({ok: true, value: {version: written.value.version, revision: {id: written.value.revision, title: "星瑕", ops: [{kind: "create", ref: {kind: "entry"}}]}, revertable: {ok: true}}});
        expect(await author.canon.call("revision", {id: "r999999"})).toMatchObject({ok: true, value: {revision: null}});

        const types = await author.canon.call("components", {});
        if (!types.ok) throw new Error(types.failure.code);
        expect(types.value.items.find((type) => type.id === "nbook.canon.person")).toMatchObject({namespace: "character", fields: expect.any(Array)});
        expect(await author.canon.call("changes", {filter: {before: {position: {kind: "chapter", chapter: "2", edge: "end"}, mode: "actual"}, order: "desc"}})).toMatchObject({ok: true, value: {items: [], total: 0}});
        expect(await author.canon.call("changes", {filter: {before: {position: {kind: "chapter", chapter: "9", edge: "end"}, mode: "actual"}}})).toMatchObject({ok: false, failure: {code: "chapter-not-found"}});

        // 输出 30、32、33 与 canon.model 输出 37：条目树带位置、条目的上级与最近改动、按地址取来历。
        const star = Object.values(written.value.ids)[0]!;
        const child = person("哥哥");
        const mask = await publish(author.canon, {...child, baseVersion: written.value.version, puts: [{ref: child.puts[0]!.ref, after: {...(child.puts[0]!.after as Entry), parent: star, sameAs: star}}]});
        if (!mask.ok) throw new Error(JSON.stringify(mask.failure));
        const brother = Object.values(mask.value.ids)[0]!;
        const at = {kind: "chapter", chapter: "1", edge: "end"} as const;
        expect(await author.canon.call("tree", {parent: star, position: at})).toMatchObject({ok: true, value: {items: [{id: brother, name: "哥哥", nameAt: "哥哥", appeared: true, sameAs: star, hasChildren: false}], remaining: 0}});
        expect(await author.canon.call("tree", {parent: null})).toMatchObject({ok: true, value: {items: [{id: star, hasChildren: true}], remaining: 0}});
        expect(await author.canon.call("entry", {id: brother, position: at, mode: "actual", withChangedAt: true})).toMatchObject({ok: true, value: {ancestors: [{id: star, name: "星瑕"}], sameAs: {id: star, name: "星瑕"}, folder: ""}});
        expect(await author.canon.call("origins", {at: {entry: star, path: "character.性格"}, position: at, mode: "actual"})).toMatchObject({ok: true, value: {items: [], total: 0, initial: {kind: "init", value: null}, reduced: null}});
        expect(await author.canon.call("origins", {at: {entry: star, path: "character.没有"}, mode: "actual"})).toMatchObject({ok: true, value: {total: 0, initial: null}});

        // 带视图令牌：章表只到上限所在的章，登记的类型照常，读一次修订被拒。
        const view = await author.canon.call("openView", {viewer: null, line: "main", until: {kind: "chapter", chapter: "1", edge: "end"}, purpose: "writer"});
        if (!view.ok) throw new Error(view.failure.code);
        expect(await author.canon.call("chapters", {view: view.value.token})).toMatchObject({ok: true, value: {items: [{id: "1"}]}});
        expect((await author.canon.call("components", {view: view.value.token})).ok).toBe(true);
        expect(await author.canon.call("revision", {id: written.value.revision, view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await author.canon.call("origins", {at: {entry: star, path: "character.性格"}, mode: "actual", view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        const viewed = await author.canon.call("entry", {id: brother, mode: "actual", view: view.value.token});
        if (!viewed.ok) throw new Error(viewed.failure.code);
        expect("ancestors" in viewed.value || "sameAs" in viewed.value).toBe(false);

        await author.close();
        keep.release();
    }, 30_000);

    it("canon.revisions 输出 22、23、24：经链路预览就地改、给语义档记一笔、同一请求 id 重发；带视图令牌都被拒", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const author = await windowOf(h, "browser-1", "profile-1");
        await binder(h, `<binder><chapter id="1"/></binder>`);
        await until(async () => {
            const read = await author.canon.call("chapters", {});
            return read.ok && read.value.items.length === 1;
        });
        const created = await publish(author.canon, {...person("星瑾"), baseVersion: await version(author.canon)});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        const star = Object.values(created.value.ids)[0]!;
        const at = {kind: "chapter", chapter: "1", edge: "end"} as const;
        const by = {kind: "author"} as const;

        // 预览改名字：路由是改初值；预览不发布，随后用同一个请求 id 写入，操作与预览的相同。
        const rename = {requestId: "rename-1", by, position: at, at: {entry: star, path: "entry.name"}, value: "星瑾（妹妹）", read: {value: "星瑾", version: created.value.version}};
        const preview = await author.canon.call("previewEdit", {input: {kind: "edit", ...rename}});
        if (!preview.ok) throw new Error(JSON.stringify(preview.failure));
        expect(preview.value.route).toEqual({kind: "init"});
        expect(await version(author.canon)).toBe(created.value.version);
        const renamed = await author.canon.call("editInPlace", rename);
        if (!renamed.ok) throw new Error(JSON.stringify(renamed.failure));
        const stored = await author.canon.call("revision", {id: renamed.value.revision});
        expect(stored.ok && stored.value.revision?.ops).toEqual(preview.value.revision.ops);
        // 重发：返回第一次的结果，不因为名字已经变了而报冲突；换了内容得到 request-id-reused。
        expect(await author.canon.call("editInPlace", rename)).toMatchObject({ok: true, value: {revision: renamed.value.revision, repeated: true}});
        expect(await author.canon.call("editInPlace", {...rename, value: "别的名字"})).toMatchObject({ok: false, failure: {code: "request-id-reused"}});

        // 语义档的记一笔：预览的路由是在这一章新记一条变更；写入后字段多一条事件。
        const note = {requestId: "note-1", by, position: at, at: {entry: star, path: "character.现在的状态"}, text: "把卡推了回去", read: {value: null, version: renamed.value.version}};
        expect(await author.canon.call("previewEdit", {input: {kind: "note", ...note}})).toMatchObject({ok: true, value: {route: {kind: "change", at: {kind: "chapter", chapter: "1", key: 0}}}});
        const noted = await author.canon.call("recordNote", note);
        if (!noted.ok) throw new Error(JSON.stringify(noted.failure));
        const origins = await author.canon.call("origins", {at: note.at, position: at, mode: "actual"});
        expect(origins).toMatchObject({ok: true, value: {total: 1, items: [{kind: "patch", op: "note", text: "把卡推了回去", at: {kind: "chapter", chapter: "1", key: 0}}]}});
        expect(await author.canon.call("recordNote", {...note, requestId: "note-2", at: {entry: star, path: "character.性格"}})).toMatchObject({ok: false, failure: {code: "validation-failed", problems: [{code: "type-mismatch"}]}});

        // 有事件的语义档不能直接改：链路上的失败只带步数，不带整份来历（来历用分页的 origins 读）。
        // 条目读取带字段声明（canon.components 输出 21）。
        const read = await author.canon.call("entry", {id: star, position: at, mode: "actual"});
        if (!read.ok) throw new Error(JSON.stringify(read.failure));
        expect(read.value.declarations).toMatchObject({character: [{id: "性别"}, {id: "年龄"}, {id: "身份"}, {id: "所属"}, {id: "性格"}, {id: "背景"}, {id: "说话方式"}, {id: "现在的状态", precision: "semantic"}, {id: "现在在哪"}, {id: "生死"}]});
        const attitude = read.value.view?.namespaces.character?.fields.现在的状态?.value;
        const refused = await author.canon.call("previewEdit", {input: {kind: "edit", requestId: "edit-9", by, position: at, at: note.at, value: "缓和", read: {value: attitude, version: noted.value.version}}});
        expect(refused).toMatchObject({ok: false, failure: {code: "accumulated-value", steps: 3}});
        expect(refused.ok === false && "origins" in refused.failure).toBe(false);

        const view = await author.canon.call("openView", {viewer: null, line: "main", until: at, purpose: "writer"});
        if (!view.ok) throw new Error(view.failure.code);
        expect(await author.canon.call("previewEdit", {input: {kind: "note", ...note}, view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await author.canon.call("recordNote", {...note, requestId: "note-3", view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});

        await author.close();
        keep.release();
    }, 30_000);

    it("canon.revisions 输出 25 与 findEntries：经链路一次改几处（预览与写入相同、读取戳过期整批拒收）、按名字片段找条目；带视图令牌都被拒；老方法照常", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const author = await windowOf(h, "browser-1", "profile-1");
        await binder(h, `<binder><chapter id="1"/></binder>`);
        await until(async () => {
            const read = await author.canon.call("chapters", {});
            return read.ok && read.value.items.length === 1;
        });
        const by = {kind: "author"} as const;
        // 全是新建的一批不用读到的版本；新建的条目可以在同一批里当上级。
        const created = await author.canon.call("editEntries", {input: {requestId: "batch-1", by, what: "edit", title: "建两个", ops: [
            {op: "create", id: "tmp:group", entry: {name: "学院", kind: "组织"}},
            {op: "create", id: "tmp:star", entry: {name: "星瑾", kind: "人物", parent: "tmp:group", aliases: ["小瑾"], components: [{type: "nbook.canon.person"}]}},
        ]}});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        expect(created.value.routes).toEqual([{kind: "entry"}, {kind: "entry"}]);
        const star = created.value.ids["tmp:star"]!;

        const status = await author.canon.call("status", {});
        if (!status.ok) throw new Error("status");
        const input = {requestId: "batch-2", by, what: "edit" as const, baseVersion: created.value.version, title: "填外观", ops: [{op: "set" as const, at: {entry: star, path: "character.性格"}, value: "银白长发"}, {op: "aliases" as const, entry: star, add: ["瑾"]}]};
        const preview = await author.canon.call("previewEntries", {input});
        if (!preview.ok) throw new Error(JSON.stringify(preview.failure));
        const written = await author.canon.call("editEntries", {input});
        if (!written.ok) throw new Error(JSON.stringify(written.failure));
        const stored = await author.canon.call("revision", {id: written.value.revision});
        expect(stored.ok && stored.value.revision?.ops).toEqual(preview.value.revision.ops);

        // 读取戳过期：之间有新修订，整批拒收，版本不动。
        const stale = await author.canon.call("editEntries", {input: {requestId: "batch-3", by: {kind: "agent", session: "s1"}, what: "creative", baseVersion: created.value.version, readStamp: {version: created.value.version, input: "0"}, title: "Agent 改", ops: [{op: "set", at: {entry: star, path: "character.身份"}, value: "受伤"}]}});
        expect(stale).toMatchObject({ok: false, failure: {code: "stale-read", revisions: [{id: written.value.revision, title: "填外观"}]}});
        expect(await version(author.canon)).toBe(written.value.version);

        const found = await author.canon.call("findEntries", {query: "小瑾"});
        expect(found).toMatchObject({ok: true, value: {total: 1, items: [{id: star, name: "星瑾", kind: "人物", matchedAlias: "小瑾"}]}});

        // 老方法照常：合同只加了方法、版本没升。
        const renamed = await author.canon.call("editInPlace", {requestId: "rename-1", by, position: {kind: "initial"}, at: {entry: star, path: "entry.name"}, value: "星瑾（妹妹）", read: {value: "星瑾", version: written.value.version}});
        expect(renamed.ok).toBe(true);

        const view = await author.canon.call("openView", {viewer: null, line: "main", until: {kind: "chapter", chapter: "1", edge: "end"}, purpose: "writer"});
        if (!view.ok) throw new Error(view.failure.code);
        expect(await author.canon.call("findEntries", {query: "星", view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await author.canon.call("previewEntries", {input, view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await author.canon.call("editEntries", {input: {...input, requestId: "batch-4"}, view: view.value.token})).toMatchObject({ok: false, failure: {code: "view-denied"}});

        await author.close();
        keep.release();
    }, 30_000);

    it("textBlocks 与 canon.revisions 输出 25：经链路读主文字的块（带读取戳与解析后的位置），照着它带戳写入；之间别处写过就被拒，重读再写通过", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const author = await windowOf(h, "browser-1", "profile-1");
        await binder(h, `<binder><chapter id="1"/></binder>`);
        await until(async () => {
            const read = await author.canon.call("chapters", {});
            return read.ok && read.value.items.length === 1;
        });
        const by = {kind: "author"} as const;
        const created = await author.canon.call("editEntries", {input: {requestId: "text-1", by, what: "edit", title: "建两个", ops: [
            {op: "create", id: "tmp:a", entry: {name: "学院", kind: "组织", text: ["第一块", "第二块"]}},
            {op: "create", id: "tmp:b", entry: {name: "别的", kind: "组织"}},
        ]}});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        const [entry, other] = [created.value.ids["tmp:a"]!, created.value.ids["tmp:b"]!];
        const story = await author.canon.call("editEntries", {input: {requestId: "text-2", by, what: "edit", title: "第 1 章加一块", baseVersion: created.value.version, intent: "story", position: {kind: "chapter", chapter: "1", edge: "end"}, ops: [{op: "addBlock", entry, source: "剧情加的", after: "b1"}]}});
        if (!story.ok) throw new Error(JSON.stringify(story.failure));

        // 不写位置就是缺省位置（最后一章末尾），回来的位置写明了线。
        const read = await author.canon.call("textBlocks", {id: entry});
        if (!read.ok || read.value === null) throw new Error("读不到块");
        expect(read.value).toMatchObject({version: story.value.version, at: {kind: "chapter", chapter: "1", edge: "end", line: "main"}});
        expect(read.value.blocks.map((block) => [block.id, block.source, block.write, block.fixed.length, block.anchor, block.init])).toEqual([
            ["b1", "第一块", "init", 1, "b1", 0],
            ["b3", "剧情加的", "change", 1, "b1", undefined],
            ["b2", "第二块", "init", 0, "b2", 1],
        ]);
        expect(await author.canon.call("textBlocks", {id: "e999"})).toEqual({ok: true, value: null});
        expect(await author.canon.call("textBlocks", {id: entry, position: {kind: "chapter", chapter: "9", edge: "end"}})).toMatchObject({ok: false, failure: {code: "chapter-not-found"}});

        const submit = (requestId: string, from: NonNullable<typeof read.value>) => author.canon.call("editEntries", {input: {requestId, by, what: "edit", title: "改第二块", baseVersion: from.version, readStamp: {version: from.version, input: from.inputDigest}, intent: "creative", position: from.at, ops: [{op: "set", at: {entry, path: "text[b2]"}, value: "第二块（改）", read: "第二块"}, {op: "addBlock", entry, source: "新的一块", after: from.blocks[2]!.anchor!}]}});
        // 别处改了不相干的条目：带旧戳的写入整批拒收。
        expect((await author.canon.call("editEntries", {input: {requestId: "text-3", by, what: "edit", title: "改别的", baseVersion: story.value.version, ops: [{op: "aliases", entry: other, add: ["另一个"]}]}})).ok).toBe(true);
        expect(await submit("text-4", read.value)).toMatchObject({ok: false, failure: {code: "stale-read", revisions: [{title: "改别的"}]}});
        const fresh = await author.canon.call("textBlocks", {id: entry});
        if (!fresh.ok || fresh.value === null) throw new Error("读不到块");
        expect((await submit("text-5", fresh.value)).ok).toBe(true);
        const after = await author.canon.call("textBlocks", {id: entry});
        expect(after.ok && after.value?.blocks.map((block) => block.source)).toEqual(["第一块", "剧情加的", "第二块（改）", "新的一块"]);

        await author.close();
        keep.release();
    }, 30_000);

    it("renderSource 与 canon.rendering 输出 16：经链路把一段没提交的源文字渲染成给作者的一块；写得不对给行、列；不写入", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const author = await windowOf(h, "browser-1", "profile-1");
        const by = {kind: "author"} as const;
        const created = await author.canon.call("editEntries", {input: {requestId: "source-1", by, what: "edit", title: "建两个", ops: [
            {op: "create", id: "tmp:a", entry: {name: "学院", kind: "组织", text: ["存下来的"]}},
            {op: "create", id: "tmp:b", entry: {name: "星瑾", kind: "人物"}},
        ]}});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        const [entry, other] = [created.value.ids["tmp:a"]!, created.value.ids["tmp:b"]!];

        const rendered = await author.canon.call("renderSource", {entry, source: `# 学院\n\n院长是 <Ref id="${other}" />。`, mode: "actual"});
        if (!rendered.ok || rendered.value === null) throw new Error("读不到渲染");
        expect([rendered.value.version, rendered.value.mode, rendered.value.blocks.length]).toEqual([created.value.version, "actual", 1]);
        const block = rendered.value.blocks[0] as {id: string; tree: {children: Array<{type: string; children: Array<Record<string, unknown>>}>}};
        expect([block.id, block.tree.children.map((node) => node.type)]).toEqual(["source", ["heading", "paragraph"]]);
        expect(block.tree.children[1]!.children.filter((node) => node.type !== "text")).toEqual([{type: "canonRef", id: other, name: "星瑾", deleted: false}]);

        const broken = await author.canon.call("renderSource", {entry, source: "一段\n\n他说{+5}", mode: "actual"});
        expect(broken.ok && broken.value?.blocks).toEqual([{id: "source", error: expect.objectContaining({code: "no-field-expression", line: 3}), text: "一段\n\n他说{+5}"}]);
        expect(await author.canon.call("renderSource", {entry: "e999", source: "字", mode: "actual"})).toEqual({ok: true, value: null});
        // 太长的不渲染：正好到上限的照常，多一个字符就拒。
        expect((await author.canon.call("renderSource", {entry, source: "字".repeat(RENDER_SOURCE_MAX), mode: "actual"})).ok).toBe(true);
        expect(await author.canon.call("renderSource", {entry, source: "字".repeat(RENDER_SOURCE_MAX + 1), mode: "actual"})).toMatchObject({ok: false, failure: {code: "too-large"}});

        // 嵌套深到栈溢出的（几万层引用）：照出错的块给，不是说不清原因的内部错误。
        const deep = await author.canon.call("renderSource", {entry, source: "> ".repeat(RENDER_SOURCE_MAX / 2), mode: "actual"});
        expect(deep.ok && deep.value?.blocks).toEqual([expect.objectContaining({id: "source", error: expect.objectContaining({code: "mdx-invalid"})})]);

        // 只读：存下来的主文字与世界的版本都没变。
        const after = await author.canon.call("textBlocks", {id: entry});
        expect(after.ok && [after.value?.version, after.value?.blocks.map((item) => item.source)]).toEqual([created.value.version, ["存下来的"]]);

        await author.close();
        keep.release();
    }, 30_000);

    it("输出 10：独占期间别的窗口写入得到 busy；持有窗口的链路断开，独占随租约订阅结束", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const task = await windowOf(h, "browser-1", "profile-1");
        const author = await windowOf(h, "browser-2", "profile-2");
        const seen: CanonEvent[] = [];
        expect((await author.canon.subscribe((event) => seen.push(event))).ok).toBe(true);

        const held = await task.canon.hold("第 5 章记账");
        if (!held.ok) throw new Error(held.failure.code);
        expect(await publish(author.canon, person("星瑾"))).toMatchObject({ok: false, failure: {code: "busy", holder: "第 5 章记账"}});
        expect(await publish(task.canon, person("白灵"), held.value.token)).toMatchObject({ok: true});

        task.disconnect();
        await until(() => seen.some((event) => event.kind === "exclusive" && event.holder === null));
        expect(await publish(author.canon, person("星瑾"))).toMatchObject({ok: true});

        await task.close();
        await author.close();
        keep.release();
    }, 30_000);

    it("输出 10：独占被强行解除时持有方收到一次结束；自己释放不算结束；持有窗口停止时独占结束", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const task = await windowOf(h, "browser-1", "profile-1");
        const author = await windowOf(h, "browser-2", "profile-2");
        const seen: CanonEvent[] = [];
        expect((await author.canon.subscribe((event) => seen.push(event))).ok).toBe(true);
        const holderNull = () => seen.filter((event) => event.kind === "exclusive" && event.holder === null).length;

        const ends: string[] = [];
        const first = await task.canon.hold("第 5 章记账", (reason) => ends.push(reason));
        if (!first.ok) throw new Error(first.failure.code);
        expect(first.value.expires).toBeGreaterThan(0);
        expect((await first.value.renew()).ok).toBe(true);
        expect((await author.canon.call("breakExclusive", {})).ok).toBe(true);
        await until(() => ends.length > 0);
        expect(ends).toEqual(["ended"]);
        expect(await publish(author.canon, person("星瑾"))).toMatchObject({ok: true});

        const second = await task.canon.hold("第 6 章记账", (reason) => ends.push(reason));
        if (!second.ok) throw new Error(second.failure.code);
        expect(await second.value.release()).toEqual({ok: true, value: null});
        expect(await publish(author.canon, person("白灵"))).toMatchObject({ok: true});

        const third = await task.canon.hold("第 7 章记账");
        if (!third.ok) throw new Error(third.failure.code);
        const before = holderNull();
        await task.close();
        await until(() => holderNull() > before);
        expect(await publish(author.canon, person("彗"))).toMatchObject({ok: true});
        expect(ends).toEqual(["ended"]);

        await author.close();
        keep.release();
    }, 30_000);

    it("两种场地的契约：订阅、独占与断开后的失败码同进程内的场地（node-world.dom.test.ts）", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        expect(await venueScenario({window: (id) => windowOf(h, id, `profile-${id}`)})).toEqual({changedMatchesPublish: true, writeWhileHeld: "busy", writeAfterHolderGone: true, callAfterDisconnect: "unavailable"});
        keep.release();
    }, 30_000);

    it("订阅：释放后不再收到事件；没有绑定项目的窗口调用得到 no-project", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        const released: CanonEvent[] = [];
        const kept: CanonEvent[] = [];
        const subscription = await window.canon.subscribe((event) => released.push(event));
        if (!subscription.ok) throw new Error(subscription.failure.code);
        expect((await window.canon.subscribe((event) => kept.push(event))).ok).toBe(true);
        expect((await publish(window.canon, person("星瑕"))).ok).toBe(true);
        await until(() => released.some((event) => event.kind === "changed") && kept.some((event) => event.kind === "changed"));
        subscription.value.release();
        expect((await publish(window.canon, person("星瑾"))).ok).toBe(true);
        await until(() => kept.filter((event) => event.kind === "changed").length === 2);
        expect(released.filter((event) => event.kind === "changed")).toHaveLength(1);
        await window.close();

        let unbound: CanonClient | null = null;
        const app = createApplication(
            {identity: {location: "browser", instanceId: "browser-unbound", client: "profile-9"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: null})}],
                plugins: [canonBrowserPlugin, {id: "app.writer", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: canonClientKey}], activate: (context) => {
                    unbound = context.services.require(canonClientKey);
                    return {};
                }}]}],
                gates: [],
                remote: createRemoteNode({instance: {id: "browser-unbound", kind: "browser", role: "client", project: null, client: "profile-9"}}),
            },
        );
        expect(await app.startup).toMatchObject({status: "available"});
        expect(await unbound!.call("status", {})).toMatchObject({ok: false, failure: {code: "no-project"}});
        expect(await unbound!.hold("记账")).toMatchObject({ok: false, failure: {code: "no-project"}});
        await app.stop();
        keep.release();
    }, 30_000);

    it("输出 18：请求超过预算时不发出；结果超过预算回 too-large；列表按预算缩小一页", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");

        expect(await publish(window.canon, person("大", {summary: "字".repeat(Math.ceil(CANON_BUDGET_BYTES / 3) + 10)}))).toEqual({ok: false, failure: {code: "too-large"}});
        expect(await version(window.canon)).toBe(0);

        // 三个名字各约 400 KiB 的条目：一页三条超过预算，缩成两条以下，带游标接着读。
        for (const mark of ["甲", "乙", "丙"]) expect((await publish(window.canon, person(mark.repeat(135_000)))).ok).toBe(true);
        const page = await window.canon.call("tree", {parent: null});
        if (!page.ok) throw new Error(page.failure.code);
        expect(page.value.items.length).toBeLessThan(3);
        expect(page.value.cursor).toBeDefined();

        // 渲染给作者的语法树比源文大得多：源文在预算内，渲染结果超过预算。粗体之间留空格：连写的 `**粗****粗**…`
        // 在 micromark 里解析时间按平方增长（1 万个约 3 秒）。
        const bold = await publish(window.canon, person("粗", {text: [{id: "b1", source: "**粗** ".repeat(30_000)}]}));
        if (!bold.ok) throw new Error(bold.failure.code);
        const id = Object.values(bold.value.ids)[0]!;
        expect(await window.canon.call("render", {entry: id, position: {kind: "initial"}, mode: "actual", audience: "author"})).toEqual({ok: false, failure: {code: "too-large"}});

        await window.close();
        keep.release();
    }, 60_000);

    it("输出 9、23：活页夹清单给出章序；清单写坏不改章序、写诊断；改好后照常；加锁替换清单两次，两次都收到新章序", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            await mkdir(join(paths.project.path, "manuscripts.binder"), {recursive: true});
            await writeFile(join(paths.project.path, "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="1" title="一"/><chapter id="2" title="二"/></binder>');
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => (await reorders(window.canon)) === 1);

        await binder(h, "<binder><chapter id=");
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.diagnostics.some((item) => (item as {code?: string}).code === "binder-invalid");
        });
        expect(await reorders(window.canon)).toBe(1);
        expect((await window.canon.call("pending", {position: {kind: "chapter", chapter: "2", edge: "end"}})).ok).toBe(true);

        await binder(h, '<binder nextId="3"><chapter id="2" title="二"/><chapter id="1" title="一"/></binder>');
        await until(async () => (await reorders(window.canon)) === 2);
        await binder(h, '<binder nextId="4"><group title="卷一"><chapter id="2" title="二"/><chapter id="1" title="一"/></group><chapter id="3" title="三"/></binder>');
        await until(async () => (await reorders(window.canon)) === 3);
        expect((await window.canon.call("pending", {position: {kind: "chapter", chapter: "3", edge: "end"}})).ok).toBe(true);

        await window.close();
        keep.release();
    }, 30_000);
});

/** 活页夹三章，正文各一段；章节文件名按活页夹的写法（`00001-…md`）。 */
describe("canon.time 输出 4、8、16：作品设置里的历法", () => {
    it("项目层设置里的自定义历法生效：时间查询按它回答，最近一次合法的历法存进 .nbook；改成不合法的以后照样用它；清空设置回到公历、存下的删掉", async () => {
        const royal = {version: 1, unit: "day", hoursPerDay: 24, minutesPerHour: 60, months: [{id: "frost", name: "霜月", days: 30}], eras: [{id: "royal", name: "王历", start: 1}]};
        let book = "";
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            book = paths.project.path;
            await threeChapters(paths);
            await mkdir(join(paths.project.path, ".nbook"), {recursive: true});
            await writeFile(join(paths.project.path, ".nbook", "settings.json"), JSON.stringify({"nbook.canon/calendar": royal}));
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        const eras = async () => {
            const read = await window.canon.call("time", {query: {kind: "calendar"}});
            return read.ok ? ((read.value.answer as {eras?: {id: string}[]}).eras ?? []).map((era) => era.id) : [];
        };
        await until(async () => (await eras()).includes("royal"));
        const created = await publish(window.canon, {requestId: "dated", by: {kind: "author"}, what: "edit", title: "定日子", baseVersion: await version(window.canon), puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "那一天", at: {kind: "chapter", chapter: "1", key: 0}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, when: [{kind: "date", era: "royal", year: 612, month: "frost", day: 5, basis: {kind: "author"}}]}}]});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        const event = await window.canon.call("time", {query: {kind: "event", change: created.value.ids["tmp:c"]!}});
        expect(event.ok && (event.value.answer as {start: {text: string}}).start.text).toBe("王历612年霜月5日");
        const stored = join(book, ".nbook", "world", "calendar.json");
        await until(async () => existsSync(stored));
        // 设置改坏：照样用最近一次合法的那一份，不退回公历。
        await writeFile(join(book, ".nbook", "settings.json"), JSON.stringify({"nbook.canon/calendar": {...royal, months: []}}));
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.diagnostics.some((item) => (item as {code: string}).code === "calendar-invalid");
        });
        expect(await eras()).toEqual(["royal"]);
        // 清空设置：不填时用公历，存下的那份删掉（之后重启也不会再用它）。
        await writeFile(join(book, ".nbook", "settings.json"), JSON.stringify({}));
        await until(async () => !existsSync(stored));
        expect(await eras()).toEqual(["ad"]);
        await window.close();
        keep.release();
    }, 30_000);
});

describe("canon.time 输出 16（补）：新打开时设置里的历法已不合法", () => {
    it("项目里已存着最近一次合法的历法、设置却不合法：打开以后第一次交设置就用存下的那份，诊断写明 previous；存下的文件原样留着", async () => {
        const royal = {version: 1, unit: "day", hoursPerDay: 24, minutesPerHour: 60, months: [{id: "frost", name: "霜月", days: 30}], eras: [{id: "royal", name: "王历", start: 1}]};
        let stored = "";
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            await threeChapters(paths);
            // 上一次运行存下的历法，与这一次已经被改坏的设置。
            await mkdir(join(paths.project.path, ".nbook", "world"), {recursive: true});
            stored = join(paths.project.path, ".nbook", "world", "calendar.json");
            await writeFile(stored, JSON.stringify(royal));
            await writeFile(join(paths.project.path, ".nbook", "settings.json"), JSON.stringify({"nbook.canon/calendar": {...royal, months: []}}));
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.diagnostics.some((item) => (item as {code: string}).code === "calendar-invalid");
        });
        const status = await window.canon.call("status", {});
        expect(status.ok && status.value.diagnostics.filter((item) => (item as {code: string}).code === "calendar-invalid").map((item) => (item as {using: string}).using)).toEqual(["previous"]);
        const read = await window.canon.call("time", {query: {kind: "calendar"}});
        expect(read.ok && ((read.value.answer as {eras?: {id: string}[]}).eras ?? []).map((era) => era.id)).toEqual(["royal"]);
        expect(JSON.parse(await readFile(stored, "utf8"))).toEqual(royal);
        await window.close();
        keep.release();
    }, 30_000);
});

async function threeChapters(paths: {readonly project: {readonly path: string}}): Promise<void> {
    const dir = join(paths.project.path, "manuscripts.binder");
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, "binder.xml"), '<binder nextId="4"><chapter id="1" title="一"/><chapter id="2" title="二"/><chapter id="3" title="三"/></binder>');
    await writeFile(join(dir, "00001-一.md"), "她把钟拨慢了一刻。\n");
    await writeFile(join(dir, "00002-二.md"), "雨下了一夜。\n");
    await writeFile(join(dir, "00003-三.md"), "天亮了。\n");
}

/** 一条安放在第 1 章、讲述“她把钟拨慢了一刻”的剧情变更；`marks` 给讲述带标注。 */
function told(baseVersion: number, marks?: readonly unknown[]): WriteRequest {
    const id = `tmp:c${String(++sequence)}`;
    return {requestId: `req-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: "讲述", baseVersion, puts: [{ref: {kind: "change", id}, after: {id, kind: "written", text: "拨钟", at: {kind: "chapter", chapter: "1", key: 0}, told: [{source: "chapter", chapter: "1", quote: "她把钟拨慢了一刻", ...(marks === undefined ? {} : {marks})}], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}]};
}

async function rewriteChapter(h: ProjectHarness, file: string, text: string): Promise<void> {
    // 与文件服务保存章节同一个原子替换（nbook.files 的 rooted.ts 也用它）：写临时文件再改名。
    const result = await replaceLocked(join(h.project.path, "manuscripts.binder", file), {lockPath: join(h.project.path, ".nbook", "locks", "chapter.lock"), decide: () => ({write: text}), report: () => undefined});
    expect(result.ok).toBe(true);
}

describe("canon.project：正文快照、视图与插件的登记", () => {
    it("输出 25、P2 第 8 条：原子替换保存章节后，讲述按新正文失联、世界版本不变、读取输入的摘要变了，收到 textChanged", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: threeChapters});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => (await reorders(window.canon)) === 1);
        const written = await window.canon.publish(told(await version(window.canon)));
        if (!written.ok) throw new Error(JSON.stringify(written.failure));
        const seen: CanonEvent[] = [];
        expect((await window.canon.subscribe((event) => seen.push(event))).ok).toBe(true);
        const before = await window.canon.call("status", {});
        if (!before.ok) throw new Error(before.failure.code);

        await rewriteChapter(h, "00001-一.md", "她没有动那座钟。\n");
        await until(async () => {
            const page = await window.canon.call("tellings", {});
            return page.ok && page.value.items.some((item) => item.located.kind === "lost");
        });
        const after = await window.canon.call("status", {});
        if (!after.ok) throw new Error(after.failure.code);
        expect(after.value.version).toBe(before.value.version);
        expect(after.value.inputDigest).not.toBe(before.value.inputDigest);
        await until(() => seen.some((event) => event.kind === "textChanged" && event.chapter === "1"));

        await window.close();
        keep.release();
    }, 30_000);

    it("输出 24、场景 8：带视图令牌读上限之后、读不许带令牌的方法、写入都被拒并记审计；写手的窗口关掉后令牌失效", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: threeChapters});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const writer = await windowOf(h, "browser-1", "profile-1");
        const author = await windowOf(h, "browser-2", "profile-2");
        await until(async () => (await reorders(writer.canon)) === 1);
        const created = await publish(author.canon, person("星瑕"));
        if (!created.ok) throw new Error(created.failure.code);
        const xia = created.value.ids[Object.keys(created.value.ids)[0]!]!;

        const opened = await writer.canon.call("openView", {viewer: xia, line: "main", until: {kind: "chapter", chapter: "2", edge: "start"}, purpose: "writer"});
        if (!opened.ok) throw new Error(JSON.stringify(opened.failure));
        const view = opened.value.token;
        expect((await writer.canon.call("entry", {id: xia, mode: "actual", view})).ok).toBe(true);
        expect(await writer.canon.call("entry", {id: xia, position: {kind: "chapter", chapter: "3", edge: "end"}, mode: "actual", view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await writer.canon.call("object", {ref: {kind: "entry", id: xia}, view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await writer.canon.call("publish", {request: {...person("又一个"), baseVersion: await version(author.canon)}, view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        // 别的调用方拿着写手的令牌读：按不存在的令牌拒，审计里看的人记成不知道（不借用写手那张视图）。
        expect(await author.canon.call("entry", {id: xia, mode: "actual", view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        const audit = await author.canon.call("viewAudit", {});
        expect(audit.ok && audit.value.items.map((item) => [item.method, item.viewer])).toEqual([["entry", xia], ["object", xia], ["publish", xia], ["entry", null]]);
        expect(view).not.toMatch(/^view-\d+$/u);

        // 令牌的寿命是申请它的调用方实例：窗口关掉（实例失效）时入口关掉它打开的视图。只断链路时实例还在、可以重连。
        const status = async () => {
            const read = await author.canon.call("status", {});
            return read.ok ? read.value.openViews : -1;
        };
        expect(await status()).toBe(1);
        await writer.close();
        await until(async () => (await status()) === 0);

        await author.close();
        keep.release();
    }, 30_000);

    it("components 输出 17、model 输出 34：插件声明的标注种类与诊断经贡献点登记，诊断的计算经项目内接口登记", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: threeChapters, env: {NBOOK_TEST_PLUGINS: CANON_PROBE_ID}});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => (await reorders(window.canon)) === 1);
        const created = await publish(window.canon, person("哥哥"));
        if (!created.ok) throw new Error(created.failure.code);
        const brother = created.value.ids[Object.keys(created.value.ids)[0]!]!;

        // 登记了的种类：载荷不合 schema 拒收，合的收下。
        expect(await window.canon.publish(told(await version(window.canon), [{kind: PROBE_MARK, version: 1}]))).toMatchObject({ok: false, failure: {code: "validation-failed"}});
        expect((await window.canon.publish(told(await version(window.canon), [{kind: PROBE_MARK, version: 1, point: brother}]))).ok).toBe(true);

        await rewriteChapter(h, "00001-一.md", "钟还在走。\n");
        await until(async () => {
            const page = await window.canon.call("pending", {});
            return page.ok && page.value.items.some((item) => item.kind === "finding" && item.diagnostic === PROBE_DIAGNOSTIC);
        });
        const page = await window.canon.call("pending", {});
        expect(page.ok && page.value.complete).toBe(true);

        await window.close();
        keep.release();
    }, 30_000);
});

describe("canon.components 输出 1：经宿主的贡献点载入的声明", () => {
    // 宿主载入贡献时调用的就是贡献点定义里的 `validate`：用它本身核对，不另起项目子进程。
    const descriptor = (id: string, declaration: unknown): ContributionDescriptor<ComponentContribution> => ({capability: "canon.components", id, declaration: declaration as ComponentContribution, plugin: "acme.cast", entry: null, location: "server"});
    const person = {label: "人物", namespace: "character", version: 1, fields: [{id: "状态", label: "状态", kind: "text"}]};
    const problemOf = (id: string, declaration: unknown) => componentsPoint.validate!(descriptor(id, declaration));

    it("贡献 id 就是类型 id，贡献点要求它以贡献方插件 id 开头；声明里不写 id", () => {
        expect(componentsPoint.idPrefix).toBe("plugin");
        expect(problemOf("acme.cast.person", person)).toBeNull();
        expect(problemOf("acme.cast.person", {...person, id: "acme.cast.person"})).toContain("不写 id");
    });

    it("声明不是对象，或内核的单条校验不过：这一条被拒，原因指出哪一项", () => {
        for (const declaration of [null, "人物", ["人物"]]) expect(problemOf("acme.cast.person", declaration)).toContain("声明必须是对象");
        expect(problemOf("acme.cast.person", {...person, version: 0})).toStartWith("version");
        expect(problemOf("acme.cast.person", {...person, namespace: "text"})).toStartWith("namespace");
        expect(problemOf("acme.cast.person", {...person, fields: [{id: "启用", label: "启用", kind: "boolean"}]})).toStartWith("fields[0].id");
    });
});
