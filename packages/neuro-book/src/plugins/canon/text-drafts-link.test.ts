/**
 * 主文字的稿在请求还在途、回执丢了、链路断开时的行为（web/text-drafts.ts；docs/specs/canon/author-ui.md 输出 45、46）。
 * `text-drafts.test.ts` 经真实的项目子进程测平常的路径；这里要扣住“请求已经过了检查、还没落盘”“写进去了、回执没到”这样的
 * 先后，所以用进程内的场地（`testing/text-scene.ts`）：世界服务、日志、远程入口、Storage 的 SQLite 与链路都是真实的，先后只在
 * 日志追加之前与回复帧上扣。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";

import type {ReadPosition} from "@notnotype/nb-canon";
import type {RequestFrame} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {StorageService} from "nbook/shared/storage";

import {until} from "./testing/harness";
import {textScene} from "./testing/text-scene";
import type {SceneWindow, TextScene} from "./testing/text-scene";
import {addAfter, removeBlock, setText} from "./web/text-draft";
import {createTextDrafts, TEXT_DRAFTS_RECORD} from "./web/text-drafts";
import {setWhole} from "./web/text-whole";
import {createCanonWorld} from "./web/world";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "text-drafts-link");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const at: ReadPosition = {kind: "chapter", chapter: "3", edge: "end"};
const savingDraft = (ask: RequestFrame): boolean => ask.contract === "nbook.storage/project" && ask.method === "save";
const readingDraft = (ask: RequestFrame): boolean => ask.contract === "nbook.storage/project" && ask.method === "read";
const writing = (ask: RequestFrame): boolean => ask.method === "editEntries";

/** 请求 id 在整个文件里不重复：两个窗口各数各的会撞上，内核把撞上的当成“这个请求早就发布过”。 */
let next = 0;

/** 一个窗口上的登记。排着的暂存（输入停顿以后才写的那一次）不自己执行，留在 `scheduled` 里。 */
function deskOf(window: SceneWindow) {
    const world = createCanonWorld(window.canon);
    const scheduled: Array<() => void> = [];
    const drafts = createTextDrafts({
        storage: window.storage,
        world: () => world,
        call: window.canon.call,
        requestId: () => `text-${String(++next)}`,
        schedule: (run) => {
            scheduled.push(run);
            return () => void scheduled.splice(scheduled.indexOf(run), 1);
        },
    });
    return {drafts, scheduled, dispose: () => world.dispose()};
}

async function stored(storage: StorageService, entry: string) {
    const opened = await storage.open(TEXT_DRAFTS_RECORD, entry);
    if (!opened.ok) throw new Error(opened.code);
    return opened.handle.read();
}

/** 开一个场地跑 `run`，结束时收口（失败也收）。 */
async function inScene(run: (scene: TextScene) => Promise<void>): Promise<void> {
    const scene = await textScene(await mkdtemp(join(tmp, "scene-")));
    try {
        await run(scene);
    } finally {
        await scene.close();
    }
}

const published = (scene: TextScene, requestId: string): boolean => {
    const outcome = scene.world.outcome(requestId);
    return "published" in outcome && outcome.published;
};

describe("author-ui 输出 46：请求在途时断线", () => {
    it("请求过了检查、还没落盘时断线，之后正文变了、问到的结局是“没发布”：不解冻；再按提交不换请求，只发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        expect(await session.begin(at)).toBeNull();
        session.edit((draft) => addAfter(draft, "b1", "只该有一份").draft);

        const gate = scene.pauseAppend();
        try {
            const first = session.submit("改主文字");
            await gate.entered;
            window.disconnect();
            expect(await first).toEqual({status: "unknown"});
            expect(await window.reconnect()).toEqual({ok: true});
            // 正文变了：版本没动、读取戳变了。原请求还停在落盘之前，这时问结局是“没发布”。
            scene.setChapterText("1", "改过的正文");
            const frozen = session.state.draft!.pending!.requestId;
            expect(scene.world.outcome(frozen)).toEqual({published: false});

            // 作者再按一次提交（换了标题）：有冻结着的请求，发出去的还是它。扣住“问结局”的回复，等它答完“没发布”再放行原请求：
            // 这一次确认拿到的是“没发布”，接着原样重发。
            const asked = scene.holdReply((ask) => ask.method === "outcome");
            const again = session.submit("另一个标题");
            await asked.held;
            gate.release();
            asked.release();
            expect((await again).status).toBe("published");
            expect(published(scene, frozen)).toBe(true);
        } finally {
            gate.release();
        }
        expect(scene.sources(entry, at)).toEqual(["A", "只该有一份"]);
        expect(scene.titles(entry)).toEqual(["建条目", "改主文字"]);
        expect([session.state.draft, session.state.phase, (await stored(window.storage, entry)).status]).toEqual([null, "idle", "missing"]);
        desk.dispose();
    }), 60_000);

    it("原样重发被别处的独占拦下：说明不了原来那一次，稿仍然冻结；独占放开以后再确认，拿回原来那一次的结果", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const [window, elsewhere] = [await scene.window("browser-1"), await scene.window("browser-2", "profile-2")];
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "只该有一份").draft);

        const gate = scene.pauseAppend();
        try {
            const first = session.submit("改主文字");
            await gate.entered;
            window.disconnect();
            expect(await first).toEqual({status: "unknown"});
            const frozen = session.state.draft!.pending!.requestId;
            const lease = await elsewhere.canon.call("acquireExclusive", {label: "另一处独占"});
            if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
            expect(await window.reconnect()).toEqual({ok: true});

            // 确认先问结局：原请求还停在落盘之前，问到的是“没发布”。重发排在原请求后面，放行以后原请求发布、重发撞上独占。
            const asked = scene.holdReply((ask) => ask.method === "outcome");
            const confirming = session.confirm();
            await asked.held;
            gate.release();
            asked.release();
            expect(await confirming).toEqual({status: "unknown"});
            await until(() => published(scene, frozen));
            expect([session.state.phase, session.state.draft?.pending?.requestId]).toEqual(["confirming", frozen]);
            const kept = await stored(window.storage, entry);
            expect(kept.status === "ok" && kept.value.pending?.requestId).toBe(frozen);

            expect((await elsewhere.canon.call("releaseExclusive", {token: lease.value.token})).ok).toBe(true);
            expect((await session.confirm()).status).toBe("published");
        } finally {
            gate.release();
        }
        expect(scene.sources(entry, at)).toEqual(["A", "只该有一份"]);
        expect(scene.titles(entry)).toEqual(["建条目", "改主文字"]);
        desk.dispose();
    }), 60_000);

    it("日志明确没写进去：不算结局不明，稿解冻、还在；别的窗口打开不会替作者发；再提交发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "写盘失败时的稿").draft);

        scene.failAppend();
        const failed = await session.submit("改主文字");
        expect(failed).toMatchObject({status: "failed", failure: {code: "write-failed"}});
        expect([session.state.phase, session.state.draft?.pending]).toEqual(["idle", undefined]);
        const kept = await stored(window.storage, entry);
        expect(kept.status === "ok" && [kept.value.pending, Object.values(kept.value.texts)]).toEqual([undefined, ["写盘失败时的稿"]]);

        // 同一份浏览器配置的另一个窗口：读到稿，不发任何请求。
        const other = deskOf(await scene.window("browser-2"));
        await other.drafts.session(entry).load();
        expect(other.drafts.uncommitted(entry)).toBe(true);
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["A"], ["建条目"]]);

        expect((await session.submit("改主文字")).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["A", "写盘失败时的稿"], ["建条目", "改主文字"]]);
        other.dispose();
        desk.dispose();
    }), 60_000);

    it("发布以后条目大到一次读不回来、回执又丢了：问到已经发布就收场，不用先把块读回来", () => inScene(async (scene) => {
        // 一块最多 5 万字：读得回来的 18 块（各一万字，约 540 KB），再加 17 块，合起来超过一次读取的预算（960 KiB）。
        const block = (mark: string) => mark.repeat(10_000);
        const entry = await scene.seed(Array.from({length: 18}, () => block("甲")));
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        expect(await session.begin(at)).toBeNull();
        for (let index = 0; index < 17; index += 1) session.edit((draft) => addAfter(draft, "b1", block("乙")).draft);

        scene.loseReply(writing);
        expect(await session.submit("改主文字")).toEqual({status: "unknown"});
        expect(await window.reconnect()).toEqual({ok: true});
        expect(await window.canon.call("textBlocks", {id: entry, position: at})).toEqual({ok: false, failure: {code: "too-large"}});
        expect((await session.confirm()).status).toBe("published");
        expect([session.state.draft, session.state.phase, scene.titles(entry)]).toEqual([null, "idle", ["建条目", "改主文字"]]);
        // 现在整个条目超过一次读取的上限：进不了编辑，写明原因（已知限制）。
        expect(await session.begin(at)).toBe("too-large");
        desk.dispose();
    }), 60_000);
});

describe("author-ui 输出 45、46：暂存的回执丢了、链路断开", () => {
    it("冻结写进去了、回执丢了：当作结局不明，不说成“没提交”；连上以后放弃，记录真的删掉，重开不会把它发出去", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        // 没有暂存过：第一次写存储就是提交时的冻结。
        session.edit((draft) => addAfter(draft, "b1", "后来放弃的字").draft);
        const lost = scene.loseReply(savingDraft);
        expect(await session.submit("改主文字")).toEqual({status: "unknown"});
        await lost.lost;
        expect([session.state.phase, session.state.draft?.pending !== undefined, scene.sources(entry, at)]).toEqual(["confirming", true, ["A"]]);

        expect(await window.reconnect()).toEqual({ok: true});
        const witness = await scene.window("browser-2");
        const frozen = await stored(witness.storage, entry);
        expect(frozen.status === "ok" && frozen.value.pending !== undefined).toBe(true);

        expect(await session.discard()).toBe(true);
        expect([session.state.draft, session.state.saved, (await stored(witness.storage, entry)).status]).toEqual([null, "none", "missing"]);
        const reopened = deskOf(witness);
        await reopened.drafts.session(entry).load();
        expect([reopened.drafts.session(entry).state.draft, scene.sources(entry, at), scene.titles(entry)]).toEqual([null, ["A"], ["建条目"]]);

        // 同样丢了冻结的回执，这一次作者去确认：发出去的就是冻结的那个请求，发布一次。
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "这一次要发的字").draft);
        scene.loseReply(savingDraft);
        expect(await session.submit("改主文字")).toEqual({status: "unknown"});
        expect(await window.reconnect()).toEqual({ok: true});
        expect((await session.confirm()).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry), (await stored(witness.storage, entry)).status]).toEqual([["A", "这一次要发的字"], ["建条目", "改主文字"], "missing"]);
        reopened.dispose();
        desk.dispose();
    }), 60_000);

    it("更早一次暂存的回执丢了、提交时读回来核对又读不到：这一次没冻结上，不发、不留成“正在确认”；连上以后再提交，只发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "只该有一份").draft);
        // 自动暂存写进去了、回执丢了。
        const lostSave = scene.loseReply(savingDraft);
        await session.flush();
        await lostSave.lost;
        expect(await window.reconnect()).toEqual({ok: true});
        // 提交：冻结之前先把记录读回来核对，这一次读的回执又丢了。冻结的写根本没发出去。
        scene.loseReply(readingDraft);
        expect(await session.submit("改主文字")).toEqual({status: "not-saved", code: "unknown-outcome"});
        expect([session.state.phase, session.state.draft?.pending, scene.sources(entry, at)]).toEqual(["idle", undefined, ["A"]]);

        expect(await window.reconnect()).toEqual({ok: true});
        expect((await session.submit("改主文字")).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["A", "只该有一份"], ["建条目", "改主文字"]]);
        desk.dispose();
    }), 60_000);

    it("冻结的写没到存储就断了：连上以后确认，先把冻结补存下去再发；这时回执再丢、窗口关掉，重开读到的稿带着冻结，不会再加一遍", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "只该有一份").draft);
        const dropped = scene.loseRequest(savingDraft);
        expect(await session.submit("改主文字")).toEqual({status: "unknown"});
        await dropped.lost;
        const frozen = session.state.draft!.pending!.requestId;
        expect(await window.reconnect()).toEqual({ok: true});
        const witness = await scene.window("browser-2");
        expect((await stored(witness.storage, entry)).status).toBe("missing");

        // 确认：这一次发布的回执丢掉。发出去之前冻结已经在存储里了。
        scene.loseReply(writing);
        expect(await session.confirm()).toEqual({status: "unknown"});
        const kept = await stored(witness.storage, entry);
        expect([kept.status === "ok" && kept.value.pending?.requestId, scene.sources(entry, at)]).toEqual([frozen, ["A", "只该有一份"]]);
        desk.dispose();

        // 窗口关掉，同一份浏览器配置重开：读到带冻结的稿，自己去确认，问到已经发布就收场。
        const reopened = deskOf(witness);
        await reopened.drafts.session(entry).load();
        expect([reopened.drafts.session(entry).state.draft, reopened.drafts.uncommitted(entry)]).toEqual([null, false]);
        expect([scene.sources(entry, at), scene.titles(entry), (await stored(witness.storage, entry)).status]).toEqual([["A", "只该有一份"], ["建条目", "改主文字"], "missing"]);
        reopened.dispose();
    }), 60_000);

    it("读进来就在等结局的稿、确认时被确定地拒收：稿解冻并读了块，能接着改；上一次没发出去的结局记着，再提交发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        const added = addAfter(session.state.draft!, "b1", "新的一块");
        session.edit(() => added.draft);
        // 原请求停在日志追加之前，链路断开；放行以后这一次追加失败（磁盘满）：确定没写进去，但窗口不知道。
        const gate = scene.pauseAppend();
        const first = session.submit("改主文字");
        await gate.entered;
        scene.failAppend();
        window.disconnect();
        expect(await first).toEqual({status: "unknown"});
        gate.release();
        desk.dispose();

        // 同一份浏览器配置的另一个窗口打开：读到带冻结的稿去确认，原样重发又遇上磁盘满。
        const other = deskOf(await scene.window("browser-2"));
        const reopened = other.drafts.session(entry);
        scene.failAppend();
        await reopened.load();
        expect([reopened.state.phase, reopened.state.draft?.pending, reopened.state.read !== null, reopened.state.resumed]).toMatchObject(["idle", undefined, true, {status: "failed", failure: {code: "write-failed"}}]);
        reopened.edit((draft, read) => setText(draft, read, added.key, "新的一块（接着改了）"));
        expect([reopened.state.draft?.texts[added.key], reopened.state.resumed]).toEqual(["新的一块（接着改了）", null]);
        expect((await reopened.submit("改主文字")).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["A", "新的一块（接着改了）"], ["建条目", "改主文字"]]);
        other.dispose();
    }), 60_000);

    it("被确定地拒收、解冻又没存下去：不说成“没发出去”，仍按等结局；存储好了再确认，发出去的还是那个请求，只发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "只该有一份").draft);
        // 日志写不进去（确定没发布），扣住这条回复；回复放行以后解冻的那一次存储写没到就断了。
        scene.failAppend();
        const refused = scene.holdReply(writing);
        const submitting = session.submit("改主文字");
        await refused.held;
        scene.loseRequest(savingDraft);
        refused.release();
        expect(await submitting).toEqual({status: "unknown"});
        const frozen = session.state.draft?.pending?.requestId;
        expect([session.state.phase, frozen !== undefined, scene.sources(entry, at)]).toEqual(["confirming", true, ["A"]]);

        expect(await window.reconnect()).toEqual({ok: true});
        const kept = await stored(window.storage, entry);
        expect(kept.status === "ok" && kept.value.pending?.requestId).toBe(frozen!);
        expect((await session.confirm()).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry), (await stored(window.storage, entry)).status]).toEqual([["A", "只该有一份"], ["建条目", "改主文字"], "missing"]);
        desk.dispose();
    }), 60_000);

    it("块的编号是对象自带的名字（`__proto__`）：内核拒收时原因照样落在那一块上", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        // 经底层发布把块的编号换成 `__proto__`（导入来的数据可以是任何编号）。
        const read = scene.world.object({kind: "entry", id: entry});
        if (typeof read === "string") throw new Error(read);
        const object = read.object as {init: {text: unknown[]}};
        const imported = await scene.world.publish({requestId: "import-proto", by: {kind: "author"}, what: "edit", title: "导入", baseVersion: scene.world.status().version, puts: [{ref: {kind: "entry", id: entry}, after: {...object, init: {...object.init, text: [{id: "__proto__", source: "A"}]}} as never}]});
        if (!imported.ok) throw new Error(JSON.stringify(imported.failure));

        const desk = deskOf(await scene.window("browser-1"));
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, blocks) => setText(draft, blocks, "__proto__", '没写完的 <V of="entry.name"'));
        expect((await session.submit("改主文字")).status).toBe("problems");
        expect(Object.entries(session.state.problems)).toMatchObject([["__proto__", {kind: "rejected"}]]);
        desk.dispose();
    }), 60_000);

    it("暂存写不进去（链路断着）：连上以后不用再打字，失焦或转入后台的那一次补存下去", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const [window, witness] = [await scene.window("browser-1"), await scene.window("browser-2")];
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setText(draft, read, "b1", "断着的时候改的"));
        window.disconnect();
        await session.flush();
        expect([session.state.saved, (await stored(witness.storage, entry)).status]).toEqual(["failed", "missing"]);
        expect(await window.reconnect()).toEqual({ok: true});
        await session.flush();
        const kept = await stored(witness.storage, entry);
        expect([session.state.saved, kept.status === "ok" && kept.value.texts]).toEqual(["saved", {b1: "断着的时候改的"}]);
        desk.dispose();
    }), 60_000);

    it("链路断着时放弃：记录删不掉，不离开编辑、写明没存上；连上以后再放弃才算完成，重开不会回来", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const [window, witness] = [await scene.window("browser-1"), await scene.window("browser-2")];
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setText(draft, read, "b1", "不该回来的字"));
        await session.flush();
        expect((await stored(witness.storage, entry)).status).toBe("ok");

        window.disconnect();
        expect(await session.discard()).toBe(false);
        expect([session.state.draft?.texts, session.state.saved]).toEqual([{b1: "不该回来的字"}, "failed"]);
        expect((await stored(witness.storage, entry)).status).toBe("ok");

        expect(await window.reconnect()).toEqual({ok: true});
        expect(await session.discard()).toBe(true);
        expect([session.state.draft, (await stored(witness.storage, entry)).status]).toEqual([null, "missing"]);
        const reopened = deskOf(witness);
        await reopened.drafts.session(entry).load();
        expect(reopened.drafts.uncommitted(entry)).toBe(false);
        reopened.dispose();
        desk.dispose();
    }), 60_000);

    it("第一次读暂存时链路断着：不当成“没有稿”；连上以后再读，稿回来", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const [first, second] = [await scene.window("browser-1"), await scene.window("browser-2")];
        const writer = deskOf(first);
        const session = writer.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setText(draft, read, "b1", "已经暂存的稿"));
        await session.flush();

        const reader = deskOf(second);
        const opened = reader.drafts.session(entry);
        second.disconnect();
        await opened.load();
        expect([opened.state.loaded, opened.state.draft]).toEqual([false, null]);
        // 没读到的时候开始编辑：不另开一份空稿盖掉那一份。
        expect(await opened.begin(at)).toBe("unavailable");

        expect(await second.reconnect()).toEqual({ok: true});
        await opened.reload();
        expect([opened.state.loaded, opened.state.draft?.texts, reader.drafts.uncommitted(entry)]).toEqual([true, {b1: "已经暂存的稿"}, true]);
        reader.dispose();
        writer.dispose();
    }), 60_000);

    it("一次暂存在途时又打了字：回执回来不写“已暂存”，排着的那一次存下去以后才写", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const [window, witness] = [await scene.window("browser-1"), await scene.window("browser-2")];
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setText(draft, read, "b1", "已经传出去的字"));
        const hold = scene.holdReply(savingDraft);
        try {
            const flushing = session.flush();
            await hold.held;
            session.edit((draft, read) => setText(draft, read, "b1", "还没传的字"));
            expect(session.state.saved).toBe("unsaved");
            hold.release();
            await flushing;
        } finally {
            hold.release();
        }
        const kept = await stored(witness.storage, entry);
        expect([session.state.saved, desk.scheduled.length, kept.status === "ok" && kept.value.texts]).toEqual(["unsaved", 1, {b1: "已经传出去的字"}]);
        await session.flush();
        const later = await stored(witness.storage, entry);
        expect([session.state.saved, later.status === "ok" && later.value.texts]).toEqual(["saved", {b1: "还没传的字"}]);
        desk.dispose();
    }), 60_000);
});

describe("author-ui 输出 45、46：放弃与确认、两处同时开始、大块的冻结", () => {
    it("放弃在途（记录已经删了、回执还没到）时不能确认：冻结的请求从没发出去过，放弃以后也不会发", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "放弃了的一块").draft);
        // 冻结写进去了，发给世界的请求没到就断了。
        const dropped = scene.loseRequest(writing);
        expect(await session.submit("改主文字")).toEqual({status: "unknown"});
        await dropped.lost;
        expect(await window.reconnect()).toEqual({ok: true});

        // 放弃：存储已经把记录删了，回执扣着。这时另一处（重新连上、另一个页面）来确认。
        const removing = scene.holdReply((ask) => ask.contract === "nbook.storage/project" && ask.method === "remove");
        const leaving = session.discard();
        await removing.held;
        expect(await session.confirm()).toEqual({status: "busy"});
        removing.release();
        expect(await leaving).toBe(true);
        expect([session.state.draft, scene.sources(entry, at), scene.titles(entry), (await stored(window.storage, entry)).status]).toEqual([null, ["A"], ["建条目"], "missing"]);
        desk.dispose();
    }), 60_000);

    it("同一个会话被两处同时开始编辑：只开一份稿；读块的途中另一个窗口暂存了它的稿，这边打的字不被盖掉，暂存时被告知", () => inScene(async (scene) => {
        const entry = await scene.seed(["A", "B"]);
        const [mine, theirs] = [deskOf(await scene.window("browser-1")), deskOf(await scene.window("browser-2"))];
        const session = mine.drafts.session(entry);
        const reading = scene.holdReply((ask) => ask.method === "textBlocks");
        const first = session.begin(at);
        await reading.held;
        // 第一处读过暂存（没有稿）、读块还没回来。另一个窗口（同一份浏览器配置）这时进编辑、暂存了它的稿。
        const other = theirs.drafts.session(entry);
        await other.begin(at);
        other.edit((draft, read) => setText(draft, read, "b2", "另一个窗口的字"));
        await other.flush();
        // 这个窗口的另一个页面这时也点了“编辑”：与第一处是同一次开始，不另读一次暂存、不把那边的稿装进来。
        const second = session.begin(at);
        reading.release();
        expect([await first, await second]).toEqual([null, null]);

        session.edit((draft, read) => setText(draft, read, "b1", "这个窗口刚打的字"));
        await session.flush();
        expect([session.state.draft?.texts, session.state.saved]).toEqual([{b1: "这个窗口刚打的字"}, "diverged"]);
        const kept = await stored((await scene.window("browser-3")).storage, entry);
        expect(kept.status === "ok" && kept.value.texts).toEqual({b2: "另一个窗口的字"});
        theirs.dispose();
        mine.dispose();
    }), 60_000);

    it("几十万字的修改（一块最多 5 万字，四十块各一万字）：稿存得下、请求发得出，冻结也存得下（不把文字再存一遍），照常发布", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        const piece = "a".repeat(10_000);
        session.edit((draft, read) => setText(draft, read, "b1", piece));
        for (let index = 0; index < 39; index += 1) session.edit((draft) => addAfter(draft, "b1", piece).draft);
        await session.flush();
        expect(session.state.saved).toBe("saved");
        expect((await session.submit("改主文字")).status).toBe("published");
        expect(scene.sources(entry, at).map((source) => source.length)).toEqual(Array.from({length: 40}, () => 10_000));
        desk.dispose();
    }), 60_000);

    it("冻结的稿读回来与冻结时逐字相同：请求没到世界就断了，另一个窗口读到它去确认，第一次发出去的就是冻结的那个请求", () => inScene(async (scene) => {
        const entry = await scene.seed(["A", "B"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setText(draft, read, "b1", "A 改"));
        session.edit((draft) => addAfter(draft, "b1", "新的一块").draft);
        session.edit((draft, read) => removeBlock(draft, read, "b2"));
        // 冻结写进了存储，发给世界的请求没到就断了：世界里什么也没发生。
        const dropped = scene.loseRequest(writing);
        expect(await session.submit("改主文字")).toEqual({status: "unknown"});
        await dropped.lost;
        const sent = session.state.draft!.pending!;
        desk.dispose();

        // 同一份浏览器配置的另一个窗口读到带冻结的稿：还原出来的请求与冻结时一样（省掉的文字照稿补对了），由它第一次发布。
        const other = deskOf(await scene.window("browser-2"));
        const reopened = other.drafts.session(entry);
        const asking = scene.holdReply((ask) => ask.method === "outcome");
        const loading = reopened.load();
        await asking.held;
        expect(reopened.state.draft?.pending).toEqual(sent);
        asking.release();
        await loading;
        expect(published(scene, sent.requestId)).toBe(true);
        expect([reopened.state.draft, scene.sources(entry, at), scene.titles(entry)]).toEqual([null, ["A 改", "新的一块"], ["建条目", "改主文字"]]);
        other.dispose();
    }), 60_000);
});

describe("author-ui 输出 44、45：提交在途时别的动作、被告知以后重新开始", () => {
    it("提交在途时不能放弃、不能重新开始、打字不生效：在途的那一次发布的就是它开始时的稿", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft) => addAfter(draft, "b1", "这一份稿的字").draft);

        const gate = scene.pauseAppend();
        try {
            const sending = session.submit("改主文字");
            await gate.entered;
            expect(session.state.phase).toBe("submitting");
            expect(await session.discard()).toBe(false);
            expect(await session.begin(at)).toBe("unavailable");
            session.edit((draft, read) => setText(draft, read, "b1", "在途时打的字"));
            expect(session.state.draft?.texts.b1).toBeUndefined();
            expect(await session.submit("再按一次")).toEqual({status: "busy"});
            gate.release();
            expect((await sending).status).toBe("published");
        } finally {
            gate.release();
        }
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["A", "这一份稿的字"], ["建条目", "改主文字"]]);
        expect([session.state.draft, (await stored(window.storage, entry)).status]).toEqual([null, "missing"]);
        desk.dispose();
    }), 60_000);

    it("被告知另一个窗口也在改、那边发布以后：这边放弃再开始，从现在的记录起步，照常暂存与提交", () => inScene(async (scene) => {
        const entry = await scene.seed(["A", "B"]);
        const [first, second] = [deskOf(await scene.window("browser-1")), deskOf(await scene.window("browser-2"))];
        const [one, two] = [first.drafts.session(entry), second.drafts.session(entry)];
        await one.begin(at);
        await two.begin(at);
        one.edit((draft, read) => setText(draft, read, "b1", "这个窗口的字"));
        two.edit((draft, read) => setText(draft, read, "b2", "另一个窗口的字"));
        await two.flush();
        await one.flush();
        expect(one.state.saved).toBe("diverged");
        expect((await two.submit("那边的提交")).status).toBe("published");

        expect(await one.discard()).toBe(true);
        expect(await one.begin(at)).toBeNull();
        one.edit((draft, read) => setText(draft, read, "b1", "重新开始的稿"));
        await one.flush();
        expect(one.state.saved).toBe("saved");
        expect((await one.submit("这边的提交")).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["重新开始的稿", "另一个窗口的字"], ["建条目", "那边的提交", "这边的提交"]]);
        second.dispose();
        first.dispose();
    }), 60_000);

    it("那边的提交还在等结果时“用这里的”不覆盖那条记录（那是它唯一的一份）；换成那边的去确认，同一个新块只发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲"]);
        const [first, second] = [deskOf(await scene.window("browser-1")), deskOf(await scene.window("browser-2"))];
        const [one, two] = [first.drafts.session(entry), second.drafts.session(entry)];
        await one.begin(at);
        one.edit((draft) => addAfter(draft, "b1", "只该有一份").draft);
        await one.flush();
        // 同一份浏览器配置的另一个窗口点“编辑”，接过的是同一份稿。
        await two.begin(at);
        const lost = scene.loseReply(writing);
        expect(await one.submit("那边的提交")).toEqual({status: "unknown"});
        await lost.lost;
        two.edit((draft, read) => setText(draft, read, "b1", "甲改"));
        await two.flush();
        expect(two.state.saved).toBe("diverged");

        expect(await two.takeOver()).toBe("pending");
        const kept = await stored((await scene.window("browser-3")).storage, entry);
        expect([kept.status === "ok" && kept.value.pending?.requestId, two.state.saved]).toEqual([one.state.draft?.pending?.requestId, "diverged"]);
        await two.adopt();
        expect([two.state.draft, scene.sources(entry, at), scene.titles(entry)]).toEqual([null, ["甲", "只该有一份"], ["建条目", "那边的提交"]]);
        second.dispose();
        first.dispose();
    }), 60_000);

    it("那边已经发布、记录也删了以后“用这里的”：记录换成这里的稿，块重读一遍，那边发布的块在编辑里看得到", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲"]);
        const [first, second] = [deskOf(await scene.window("browser-1")), deskOf(await scene.window("browser-2"))];
        const [one, two] = [first.drafts.session(entry), second.drafts.session(entry)];
        await one.begin(at);
        one.edit((draft) => addAfter(draft, "b1", "那边加的").draft);
        await one.flush();
        await two.begin(at);
        expect((await one.submit("那边的提交")).status).toBe("published");
        two.edit((draft, read) => setText(draft, read, "b1", "甲改"));
        await two.flush();
        expect(two.state.saved).toBe("diverged");

        expect(await two.takeOver()).toBe("taken");
        const kept = await stored((await scene.window("browser-3")).storage, entry);
        expect([two.state.saved, kept.status === "ok" && kept.value.texts.b1, two.state.read?.blocks.map((block) => block.source)]).toEqual(["saved", "甲改", ["甲", "那边加的"]]);
        second.dispose();
        first.dispose();
    }), 60_000);
});

describe("author-ui 输出 39、44：整篇的稿经真实内核", () => {
    it("多块的条目整篇改一句：提交以后是一块；改的是别的条目时不问，照常发布", () => inScene(async (scene) => {
        const [entry, other] = [await scene.seed(["甲", "乙", "丙"]), await scene.seed(["别的条目"])];
        const desk = deskOf(await scene.window("browser-1"));
        const session = desk.drafts.session(entry);
        expect(await session.begin(at)).toBeNull();
        session.edit((draft, read) => setWhole(draft, read, "甲\n\n乙（改）\n\n丙"));
        // 别处的写入让读取戳过期：重读以后这个条目的整篇没变，不问。
        await scene.edit([{op: "set", at: {entry: other, path: "text[b1]"}, value: "别的条目改了"}], "creative", at);
        expect((await session.submit("整篇改一句")).status).toBe("published");
        expect([scene.sources(entry, at), scene.titles(entry), session.state.draft]).toEqual([["甲\n\n乙（改）\n\n丙"], ["建条目", "整篇改一句"], null]);
        desk.dispose();
    }), 60_000);

    it("别处在末尾加了一块：提交时问，不把那一块悄悄带进去；选“我的”以后世界里只有作者的整篇", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const desk = deskOf(await scene.window("browser-1"));
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setWhole(draft, read, "甲（改）\n\n乙"));
        await scene.edit([{op: "addBlock", entry, source: "别处加的"}], "creative", at);

        expect((await session.submit("我的整篇")).status).toBe("conflicts");
        expect(session.state.conflicts).toEqual([{kind: "whole", mine: "甲（改）\n\n乙", theirs: "甲\n\n乙\n\n别处加的"}]);
        expect(scene.sources(entry, at)).toEqual(["甲", "乙", "别处加的"]);

        session.choose(session.state.conflicts[0]!, "mine");
        expect((await session.submit("我的整篇")).status).toBe("published");
        expect(scene.sources(entry, at)).toEqual(["甲（改）\n\n乙"]);
        desk.dispose();
    }), 60_000);

    it("别处改了这篇文字、作者选“现在的”：没有要发的，稿收掉，世界里是别处的那一版", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setWhole(draft, read, "我的"));
        await session.flush();
        await scene.edit([{op: "set", at: {entry, path: "text[b1]"}, value: "别处的"}], "creative", at);
        expect((await session.submit("我的")).status).toBe("conflicts");
        session.choose(session.state.conflicts[0]!, "theirs");
        expect((await session.submit("我的")).status).toBe("nothing");
        expect([scene.sources(entry, at), session.state.draft, (await stored(window.storage, entry)).status]).toEqual([["别处的"], null, "missing"]);
        desk.dispose();
    }), 60_000);

    it("没有主文字的条目写第一段、之后整篇清空：先加一块，再把它删掉", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"));
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setWhole(draft, read, "第一段\n\n第二段"));
        expect((await session.submit("开始写")).status).toBe("published");
        expect(scene.sources(entry, at)).toEqual(["第一段\n\n第二段"]);

        await session.begin(at);
        session.edit((draft, read) => setWhole(draft, read, ""));
        expect((await session.submit("清空")).status).toBe("published");
        expect(scene.sources(entry, at)).toEqual([]);
        desk.dispose();
    }), 60_000);

    it("整篇的稿暂存以后重开：读回来还是作者的整篇，照常提交", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const window = await scene.window("browser-1");
        const first = deskOf(window);
        const session = first.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setWhole(draft, read, "甲\n\n乙\n\n新加一段"));
        await session.flush();
        expect(session.state.saved).toBe("saved");
        first.dispose();

        const reopened = deskOf(window).drafts.session(entry);
        await reopened.load();
        expect(reopened.state.draft?.whole).toEqual({base: "甲\n\n乙", text: "甲\n\n乙\n\n新加一段"});
        expect((await reopened.submit("重开以后提交")).status).toBe("published");
        expect(scene.sources(entry, at)).toEqual(["甲\n\n乙\n\n新加一段"]);
    }), 60_000);
    it("整篇的稿提交以后回执丢了：等着结局；再确认拿回那一次的结果，只发布一次", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window);
        const session = desk.drafts.session(entry);
        await session.begin(at);
        session.edit((draft, read) => setWhole(draft, read, "甲\n\n乙\n\n新加一段"));
        scene.loseReply(writing);
        expect((await session.submit("回执会丢")).status).toBe("unknown");
        expect(await window.reconnect()).toEqual({ok: true});
        expect([session.state.phase, session.state.draft?.whole?.text, scene.sources(entry, at)]).toEqual(["confirming", "甲\n\n乙\n\n新加一段", ["甲\n\n乙\n\n新加一段"]]);
        expect((await session.confirm()).status).toBe("published");
        expect([session.state.draft, scene.sources(entry, at), scene.titles(entry)]).toEqual([null, ["甲\n\n乙\n\n新加一段"], ["建条目", "回执会丢"]]);
        desk.dispose();
    }), 60_000);
});
