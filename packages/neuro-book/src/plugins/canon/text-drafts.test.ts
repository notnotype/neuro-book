/**
 * 主文字的稿在窗口里的登记（web/text-drafts.ts；docs/specs/canon/author-ui.md 输出 44 到 46）：暂存、提交与提交的结局。服务端
 * 实例、路由与项目子进程是真实的（世界服务在项目子进程里、Storage 落在真实的 SQLite），窗口是本进程里的浏览器内核实例，装
 * `nbook.canon` 与 `nbook.storage` 的浏览器入口。
 *
 * “回复丢了”用包在真实写入外面的一层来造：照常把请求交给真实的世界客户端（或者不交），再把结果换成 `unknown-outcome`。窗口
 * 看到的与链路在那一刻断开时相同，丢在落盘之前还是之后由用例定，不靠掐时间。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {replaceLocked} from "@notnotype/nb-file-lock";
import type {EntryOp, ReadPosition} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {MAX_RECORD_MAX_BYTES} from "nbook/shared/storage";
import type {StorageService} from "nbook/shared/storage";

import {CANON_BUDGET_BYTES} from "./shared/contracts";
import type {CanonClient} from "./shared/contracts";
import {serverPlugins, until, windowOf} from "./testing/harness";
import {addAfter, removeBlock, setText, splitAt, SUBMIT_OPS_MAX, textOf} from "./web/text-draft";
import {createTextDrafts, TEXT_DRAFTS_RECORD} from "./web/text-drafts";
import type {TextDrafts} from "./web/text-drafts";
import {createCanonWorld} from "./web/world";
import type {CanonWorld} from "./web/world";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "text-drafts");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const by = {kind: "author"} as const;
const end = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "end"});
let sequence = 0;
const id = () => `req-${String(++sequence)}`;

/** 写入外面的一层：下一次写入的回复丢掉（`after`：请求照常到了世界服务；`before`：请求根本没到）。 */
interface Faults {
    lose: "before" | "after" | null;
    /** 每次真正写入之前先做的事（造“读与写之间别处写了”）。 */
    beforeWrite: (() => Promise<void>) | null;
}

interface Desk {
    readonly canon: CanonClient;
    readonly storage: StorageService;
    readonly world: CanonWorld;
    readonly drafts: TextDrafts;
    readonly faults: Faults;
    /** 排着还没执行的暂存（输入停顿以后才写的那一次）。 */
    readonly scheduled: Array<() => void>;
    close(): Promise<void>;
}

/** 一个窗口上的登记；`client` 相同的窗口是同一台机器的同一份浏览器配置，读写同一条本机记录。 */
async function desk(h: ProjectHarness, windowId: string, client = "profile-1"): Promise<Desk> {
    let storage: StorageService | null = null;
    const window = await windowOf(h, windowId, client, [
        storageBrowserPlugin,
        {id: "test.desk", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: storageKey}], activate: (context) => {
            storage = context.services.require(storageKey);
            return {};
        }}]},
    ]);
    const real = createCanonWorld(window.canon);
    const faults: Faults = {lose: null, beforeWrite: null};
    const world: CanonWorld = {
        ...real,
        write: (async (method: never, input: never) => {
            await faults.beforeWrite?.();
            const lose = faults.lose;
            faults.lose = null;
            if (lose === "before") return {ok: false, failure: {code: "unknown-outcome"}};
            const result = await real.write(method, input);
            return lose === "after" ? {ok: false, failure: {code: "unknown-outcome"}} : result;
        }) as CanonWorld["write"],
    };
    const scheduled: Array<() => void> = [];
    const drafts = createTextDrafts({
        storage: storage!,
        world: () => world,
        call: window.canon.call,
        schedule: (run) => {
            scheduled.push(run);
            return () => void scheduled.splice(scheduled.indexOf(run), 1);
        },
    });
    return {canon: window.canon, storage: storage!, world, drafts, faults, scheduled, close: async () => {
        real.dispose();
        await window.close();
    }};
}

async function harness(): Promise<{readonly h: ProjectHarness; release(): void}> {
    const h = await projectHarness(tmp, {plugins: serverPlugins()});
    const keep = leaseOf(await h.manager.acquire("book", "test"));
    await h.ready(1);
    await mkdir(join(h.project.path, "manuscripts.binder"), {recursive: true});
    const binder = await replaceLocked(join(h.project.path, "manuscripts.binder", "binder.xml"), {lockPath: join(h.project.path, ".nbook", "locks", "binder.lock"), decide: () => ({write: `<binder><chapter id="1"/><chapter id="2"/><chapter id="3"/></binder>`}), report: () => undefined});
    expect(binder.ok).toBe(true);
    return {h, release: () => keep.release()};
}

async function chaptersReady(canon: CanonClient): Promise<void> {
    await until(async () => {
        const read = await canon.call("chapters", {});
        return read.ok && read.value.items.length === 3;
    });
}

async function createEntry(canon: CanonClient, text: readonly string[]): Promise<string> {
    const created = await canon.call("editEntries", {input: {requestId: id(), by, what: "edit", title: "建条目", ops: [{op: "create", id: "tmp:e", entry: {name: `条目 ${String(sequence)}`, kind: "设定", text: [...text]}}]}});
    if (!created.ok) throw new Error(JSON.stringify(created.failure));
    return created.value.ids["tmp:e"]!;
}

async function write(canon: CanonClient, intent: "creative" | "story", position: ReadPosition, ops: EntryOp[], title = "别处的改动"): Promise<void> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error("status");
    const result = await canon.call("editEntries", {input: {requestId: id(), by, what: "edit", title, baseVersion: status.value.version, intent, position, ops}});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
}

async function sources(canon: CanonClient, entry: string, position: ReadPosition = end("3")): Promise<string[]> {
    const read = await canon.call("textBlocks", {id: entry, position});
    if (!read.ok || read.value === null) throw new Error("读不到块");
    return read.value.blocks.map((block) => block.source);
}

/** 这个条目名下的修订标题，从旧到新。 */
async function revisionTitles(canon: CanonClient, entry: string): Promise<string[]> {
    const page = await canon.call("revisions", {filter: {entry}});
    if (!page.ok) throw new Error(page.failure.code);
    return page.value.items.map((item) => item.title).reverse();
}

async function stored(storage: StorageService, entry: string) {
    const opened = await storage.open(TEXT_DRAFTS_RECORD, entry);
    if (!opened.ok) throw new Error(opened.code);
    return opened.handle.read();
}

describe("author-ui 输出 44、45：暂存与提交", () => {
    it("改了就暂存，同一份浏览器配置再开一个窗口读得到；提交成一条修订、暂存删掉；净变化是零时不发请求", async () => {
        const {h, release} = await harness();
        const first = await desk(h, "browser-1");
        await chaptersReady(first.canon);
        const entry = await createEntry(first.canon, ["A", "B", "C"]);
        const session = first.drafts.session(entry);
        expect(await session.begin(end("3"))).toBeNull();
        // 进了编辑、还没改：不算有未提交的内容，存储里也没有东西。
        expect([first.drafts.uncommitted(entry), (await stored(first.storage, entry)).status]).toEqual([false, "missing"]);

        session.edit((draft, read) => setText(draft, read, "b1", "A 改"));
        session.edit((draft) => addAfter(draft, "b2", "新的一块").draft);
        expect([session.state.saved, first.scheduled.length]).toEqual(["unsaved", 1]);
        await session.flush();
        expect([session.state.saved, first.drafts.uncommitted(entry)]).toEqual(["saved", true]);

        // 另一个窗口（同一份配置）：问有没有未提交的，读到以后为真；打开直接带着稿。
        const second = await desk(h, "browser-2");
        expect(second.drafts.uncommitted(entry)).toBe(false);
        await until(() => second.drafts.uncommitted(entry));
        const reopened = second.drafts.session(entry);
        await reopened.load();
        expect(reopened.state.draft?.order.map((key) => textOf(reopened.state.draft!, reopened.state.read!, key))).toEqual(["A 改", "B", "新的一块", "C"]);
        // 暂存不是修订：世界里还是原样。
        expect(await sources(first.canon, entry)).toEqual(["A", "B", "C"]);

        const result = await session.submit("改主文字");
        expect(result.status).toBe("published");
        expect(await sources(first.canon, entry)).toEqual(["A 改", "B", "新的一块", "C"]);
        expect(await revisionTitles(first.canon, entry)).toEqual(["建条目", "改主文字"]);
        expect([session.state.draft, first.drafts.uncommitted(entry), (await stored(first.storage, entry)).status]).toEqual([null, false, "missing"]);

        // 清空一个新块以后再写回去：没有净变化（空的新块不算改动、不进暂存），不发请求、不多出修订，稿清掉。
        await session.begin(end("3"));
        const blank = addAfter(session.state.draft!, "b1", "先写了几个字");
        session.edit(() => blank.draft);
        await session.flush();
        expect((await stored(first.storage, entry)).status).toBe("ok");
        session.edit((draft, read) => setText(draft, read, blank.key, "  "));
        await session.flush();
        expect([first.drafts.uncommitted(entry), (await stored(first.storage, entry)).status]).toEqual([false, "missing"]);
        expect((await session.submit("改主文字")).status).toBe("nothing");
        expect([await revisionTitles(first.canon, entry), (await stored(first.storage, entry)).status, session.state.draft]).toEqual([["建条目", "改主文字"], "missing", null]);

        await second.close();
        await first.close();
        release();
    }, 60_000);

    it("被剧情碰过的块只改字、没被碰过的块拆开：提交以后各章读到的只多出该多的；放弃以后迟到的暂存不会把稿写回来", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B", "前半。\n\n后半。"]);
        // 第 2 章：把 B 整块换掉、在 A 后面加 X。
        await write(author.canon, "story", end("2"), [{op: "set", at: {entry, path: "text[b2]"}, value: "B′"}, {op: "addBlock", entry, source: "X", after: "b1"}]);
        expect(await sources(author.canon, entry)).toEqual(["A", "X", "B′", "前半。\n\n后半。"]);

        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        // 放弃：排着的那次暂存后来执行了，存储里仍然没有稿。
        session.edit((draft, read) => setText(draft, read, "b3", "要放弃的"));
        const late = author.scheduled[0]!;
        await session.discard();
        late();
        await session.flush();
        expect([session.state.draft, (await stored(author.storage, entry)).status]).toEqual([null, "missing"]);

        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b2", "B″"));
        session.edit((draft, read) => splitAt(draft, read, "b3", "前半。".length).draft);
        session.edit((draft) => addAfter(draft, "b4", "跟在 X 后面").draft);
        expect((await session.submit("改主文字")).status).toBe("published");
        // 第 3 章末尾：B″ 改进了第 2 章那条变更；拆出来的后半与新块在初值里。
        expect(await sources(author.canon, entry)).toEqual(["A", "X", "跟在 X 后面", "B″", "前半。", "后半。"]);
        // 第 1 章末尾（那条剧情之前）：B 还是初值，没有 X；多出来的只有新加的设定块，拆开的两半合起来还是原文。
        expect(await sources(author.canon, entry, end("1"))).toEqual(["A", "跟在 X 后面", "B", "前半。", "后半。"]);

        await author.close();
        release();
    }, 60_000);
});

describe("author-ui 输出 44：世界在这期间变了", () => {
    it("别处改的是没碰过的块：不问，两处的改动都在；读与写之间别处写了：自动重读再发；一直在变就停下、稿不丢", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B", "C"]);
        const other = await createEntry(author.canon, ["别的条目"]);
        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b1", "A 改"));
        await write(author.canon, "creative", end("3"), [{op: "set", at: {entry, path: "text[b3]"}, value: "C（别处改了）"}, {op: "addBlock", entry, source: "别处加的", after: "b2"}]);
        // 这一次提交：读到块以后、写入之前，别处又改了一个不相干的条目。只按对象的版本拦不住，读取戳拦得住；重读以后通过。
        let interleaved = 0;
        author.faults.beforeWrite = async () => {
            if (interleaved++ === 0) await write(author.canon, "creative", end("3"), [{op: "set", at: {entry: other, path: "text[b1]"}, value: "别的条目（改）"}]);
        };
        expect((await session.submit("改主文字")).status).toBe("published");
        expect(interleaved).toBe(2);
        expect(await sources(author.canon, entry)).toEqual(["A 改", "B", "别处加的", "C（别处改了）"]);
        expect(await revisionTitles(author.canon, entry)).toEqual(["建条目", "别处的改动", "改主文字"]);

        // 每次写入之前别处都写一次：重读再发到上限就停，稿原样留着、没有 pending。
        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b2", "B 改"));
        let noise = 0;
        author.faults.beforeWrite = () => write(author.canon, "creative", end("3"), [{op: "set", at: {entry: other, path: "text[b1]"}, value: `噪声 ${String(++noise)}`}]);
        expect((await session.submit("改主文字")).status).toBe("contended");
        expect([noise, session.state.phase, session.state.draft?.pending, textOf(session.state.draft!, session.state.read!, "b2")]).toEqual([3, "idle", undefined, "B 改"]);
        expect(await sources(author.canon, entry)).toEqual(["A 改", "B", "别处加的", "C（别处改了）"]);
        author.faults.beforeWrite = null;
        expect((await session.submit("改主文字")).status).toBe("published");

        await author.close();
        release();
    }, 60_000);

    it("同一块两边都改了：停下来问；选我的再提交以我的为准；再发时又变了再问；选现在的就放弃对这一块的改动", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B", "C"]);
        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b1", "A（我的）"));
        session.edit((draft, read) => removeBlock(draft, read, "b3"));
        await write(author.canon, "creative", end("3"), [{op: "set", at: {entry, path: "text[b1]"}, value: "A（别处）"}, {op: "set", at: {entry, path: "text[b3]"}, value: "C（别处）"}]);

        expect((await session.submit("改主文字")).status).toBe("conflicts");
        expect(session.state.conflicts).toEqual([
            {kind: "changed", key: "b1", mine: "A（我的）", theirs: "A（别处）"},
            {kind: "changed", key: "b3", mine: null, theirs: "C（别处）"},
        ]);
        expect(await sources(author.canon, entry)).toEqual(["A（别处）", "B", "C（别处）"]);
        const [mine, theirs] = session.state.conflicts;
        session.choose(mine!, "mine");
        session.choose(theirs!, "theirs");
        expect(session.state.conflicts).toEqual([]);

        // 选完、再提交之前别处又改了同一块：再问一次。
        await write(author.canon, "creative", end("3"), [{op: "set", at: {entry, path: "text[b1]"}, value: "A（别处第二次）"}]);
        expect((await session.submit("改主文字")).status).toBe("conflicts");
        expect(session.state.conflicts).toEqual([{kind: "changed", key: "b1", mine: "A（我的）", theirs: "A（别处第二次）"}]);
        session.choose(session.state.conflicts[0]!, "mine");
        expect((await session.submit("改主文字")).status).toBe("published");
        expect(await sources(author.canon, entry)).toEqual(["A（我的）", "B", "C（别处）"]);

        await author.close();
        release();
    }, 60_000);
});

describe("author-ui 输出 46：提交的结局不明", () => {
    it("回复丢在落盘之后：留着 pending、不能再改；再确认时原样重发，拿回那一次的结果，不多出修订", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B"]);
        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b1", "A 改"));
        session.edit((draft) => addAfter(draft, "b2", "新块").draft);
        author.faults.lose = "after";
        expect((await session.submit("改主文字")).status).toBe("unknown");
        expect([session.state.phase, session.state.draft?.pending !== undefined]).toEqual(["confirming", true]);
        const kept = await stored(author.storage, entry);
        expect(kept.status === "ok" && kept.value.pending !== undefined).toBe(true);
        // 等结局的时候改不了。
        session.edit((draft, read) => setText(draft, read, "b2", "不该进去"));
        expect(textOf(session.state.draft!, session.state.read ?? {version: 0, inputDigest: "", at: end("3"), blocks: []}, "b2")).not.toBe("不该进去");

        // 换一个窗口（刷新以后）：读到带 pending 的稿，自己去确认。
        const reopened = await desk(h, "browser-2");
        await reopened.drafts.session(entry).load();
        expect([reopened.drafts.session(entry).state.draft, reopened.drafts.uncommitted(entry)]).toEqual([null, false]);
        expect(await sources(author.canon, entry)).toEqual(["A 改", "B", "新块"]);
        expect(await revisionTitles(author.canon, entry)).toEqual(["建条目", "改主文字"]);
        expect((await stored(author.storage, entry)).status).toBe("missing");

        await reopened.close();
        await author.close();
        release();
    }, 60_000);

    it("回复丢在落盘之前、世界没变：再确认时同一个请求发出去，发布一次；世界变了：查到没发布，稿还在、可以再提交，新块不会加两遍", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B"]);
        const other = await createEntry(author.canon, ["别的条目"]);
        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        session.edit((draft) => addAfter(draft, "b2", "新块").draft);
        author.faults.lose = "before";
        expect((await session.submit("改主文字")).status).toBe("unknown");
        expect(await sources(author.canon, entry)).toEqual(["A", "B"]);
        // 作者没点“再试”、又按了一次提交（标题也换了）：发出去的还是冻结着的那个请求。
        expect((await session.submit("换了标题")).status).toBe("published");
        expect(await sources(author.canon, entry)).toEqual(["A", "B", "新块"]);
        expect(await revisionTitles(author.canon, entry)).toEqual(["建条目", "改主文字"]);

        // 第二轮：请求没到，之后世界变了。原请求带着旧戳、再到也发布不了，所以“没发布”是定论。
        await session.begin(end("3"));
        session.edit((draft) => addAfter(draft, "b1", "又一块").draft);
        author.faults.lose = "before";
        expect((await session.submit("改主文字")).status).toBe("unknown");
        await write(author.canon, "creative", end("3"), [{op: "set", at: {entry: other, path: "text[b1]"}, value: "别的条目（改）"}]);
        expect((await session.confirm()).status).toBe("not-published");
        expect([session.state.phase, session.state.draft?.pending]).toEqual(["idle", undefined]);
        expect((await session.submit("改主文字")).status).toBe("published");
        expect(await sources(author.canon, entry)).toEqual(["A", "又一块", "B", "新块"]);

        // 第三轮：请求到了、回复丢了，之后世界又变了：查到已经发布，收场，不再发。
        await session.begin(end("3"));
        session.edit((draft) => addAfter(draft, null, "开头").draft);
        author.faults.lose = "after";
        expect((await session.submit("改主文字")).status).toBe("unknown");
        await write(author.canon, "creative", end("3"), [{op: "set", at: {entry: other, path: "text[b1]"}, value: "别的条目（再改）"}]);
        expect((await session.confirm()).status).toBe("published");
        expect(await sources(author.canon, entry)).toEqual(["开头", "A", "又一块", "B", "新块"]);
        expect((await revisionTitles(author.canon, entry)).filter((title) => title === "改主文字").length).toBe(3);

        await author.close();
        release();
    }, 60_000);
});

describe("author-ui 输出 44、45：两个窗口、放不下、被拒收", () => {
    it("两个窗口改同一个条目：后写暂存的那个被告知、停止自动暂存，那边的稿不被盖掉；选“用这里的”才覆盖", async () => {
        const {h, release} = await harness();
        const first = await desk(h, "browser-1");
        const second = await desk(h, "browser-2");
        await chaptersReady(first.canon);
        const entry = await createEntry(first.canon, ["A", "B"]);
        const [one, two] = [first.drafts.session(entry), second.drafts.session(entry)];
        await one.begin(end("3"));
        await two.begin(end("3"));
        one.edit((draft, read) => setText(draft, read, "b1", "窗口一"));
        two.edit((draft, read) => setText(draft, read, "b2", "窗口二"));
        await two.flush();
        await one.flush();
        expect([two.state.saved, one.state.saved]).toEqual(["saved", "diverged"]);
        const kept = await stored(first.storage, entry);
        expect(kept.status === "ok" && kept.value.texts).toEqual({b2: "窗口二"});
        // 被告知以后接着打字也不写；提交不可用（暂存写不进去就不发）。
        one.edit((draft, read) => setText(draft, read, "b1", "窗口一（接着改）"));
        await one.flush();
        expect((await one.submit("改主文字")).status).toBe("not-saved");
        expect(((await stored(first.storage, entry)) as {value: {texts: unknown}}).value.texts).toEqual({b2: "窗口二"});

        await one.takeOver();
        expect(one.state.saved).toBe("saved");
        expect(((await stored(first.storage, entry)) as {value: {texts: unknown}}).value.texts).toEqual({b1: "窗口一（接着改）"});
        // 现在轮到另一个窗口被告知；它选“换成那边的”。
        two.edit((draft, read) => setText(draft, read, "b2", "窗口二（接着改）"));
        await two.flush();
        expect(two.state.saved).toBe("diverged");
        await two.adopt();
        expect([two.state.saved, two.state.draft?.texts]).toEqual(["saved", {b1: "窗口一（接着改）"}]);

        await second.close();
        await first.close();
        release();
    }, 60_000);

    it("暂存放不下时写明、内容留在内存里、不能提交；请求超过上限、超过一次能发的项数时不能提交，稿照常能改", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B"]);
        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        const huge = "字".repeat(Math.ceil(MAX_RECORD_MAX_BYTES / 3) + 1000);
        session.edit((draft, read) => setText(draft, read, "b1", huge));
        await session.flush();
        expect([session.state.saved, (await stored(author.storage, entry)).status]).toEqual(["too-large", "missing"]);
        expect((await session.submit("改主文字")).status).toBe("too-large");
        expect(textOf(session.state.draft!, session.state.read!, "b1")).toBe(huge);

        // 存得下、发不出：稿在记录的上限之内，请求比消息的上限大。
        const large = "a".repeat(CANON_BUDGET_BYTES - 200);
        session.edit((draft, read) => setText(draft, read, "b1", large));
        await session.flush();
        expect(session.state.saved).toBe("saved");
        expect((await session.submit("改主文字")).status).toBe("too-large");
        expect(session.state.draft?.pending).toBeUndefined();

        session.edit((draft, read) => setText(draft, read, "b1", "A"));
        for (let index = 0; index <= SUBMIT_OPS_MAX; index += 1) session.edit((draft) => addAfter(draft, "b2", `第 ${String(index + 1)} 块`).draft);
        expect(await session.submit("改主文字")).toEqual({status: "too-many", count: SUBMIT_OPS_MAX + 1});
        session.edit((draft) => ({...draft, order: draft.order.filter((key) => key !== draft.order[2]), texts: Object.fromEntries(Object.entries(draft.texts).filter(([key]) => key !== draft.order[2]))}));
        expect((await session.submit("改主文字")).status).toBe("published");
        expect((await sources(author.canon, entry)).length).toBe(2 + SUBMIT_OPS_MAX);

        await author.close();
        release();
    }, 90_000);

    it("原文没过校验：原因落在那一块上，稿与暂存都在、没有 pending；改好以后提交通过。开始编辑时的那一章没了：只能放弃", async () => {
        const {h, release} = await harness();
        const author = await desk(h, "browser-1");
        await chaptersReady(author.canon);
        const entry = await createEntry(author.canon, ["A", "B"]);
        const session = author.drafts.session(entry);
        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b1", "A 改"));
        const added = addAfter(session.state.draft!, "b2", '没写完的 <V of="entry.name"');
        session.edit(() => added.draft);
        expect((await session.submit("改主文字")).status).toBe("problems");
        expect(Object.keys(session.state.problems)).toEqual([added.key]);
        expect(session.state.problems[added.key]).toMatchObject({kind: "rejected", code: "tag-malformed"});
        const kept = await stored(author.storage, entry);
        expect(kept.status === "ok" && [kept.value.pending, kept.value.texts.b1]).toEqual([undefined, "A 改"]);
        expect(await sources(author.canon, entry)).toEqual(["A", "B"]);
        session.edit((draft, read) => setText(draft, read, added.key, "改好了的一块"));
        expect(session.state.problems).toEqual({});
        expect((await session.submit("改主文字")).status).toBe("published");

        // 稿开在第 3 章末尾；活页夹里去掉第 3 章以后，稿对不上世界了。
        await session.begin(end("3"));
        session.edit((draft, read) => setText(draft, read, "b2", "B 改"));
        await session.flush();
        const binder = await replaceLocked(join(h.project.path, "manuscripts.binder", "binder.xml"), {lockPath: join(h.project.path, ".nbook", "locks", "binder.lock"), decide: () => ({write: `<binder><chapter id="1"/><chapter id="2"/></binder>`}), report: () => undefined});
        expect(binder.ok).toBe(true);
        await until(async () => {
            const read = await author.canon.call("chapters", {});
            return read.ok && read.value.items.length === 2;
        });
        expect(await session.submit("改主文字")).toEqual({status: "blocked", reason: "chapter-not-found"});
        expect([session.state.blocker, session.state.read, session.state.draft?.texts]).toEqual(["chapter-not-found", null, {b2: "B 改"}]);
        await session.discard();
        expect([session.state.draft, (await stored(author.storage, entry)).status]).toEqual([null, "missing"]);

        await author.close();
        release();
    }, 60_000);
});
