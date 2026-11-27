/**
 * 条目页文字分页的宿主逻辑（web/text-tab.ts；docs/specs/canon/author-ui.md 输出 39、44、45）：整篇的编辑、进不了编辑的条目、
 * 提交时别处也改了、内核拒收、放弃删不掉暂存时。不挂组件，直接用 `useTextTab`：它只依赖响应式状态。世界服务、Storage 与链路用
 * `testing/text-scene.ts` 的真实场地。页面上的接线（按钮、对话框、焦点）在 `web/entry-page.dom.test.ts` 与组件的 dom 测试里。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {effectScope} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {testTextPort} from "nbook/shared/testing/text-port";
import {boundText} from "nbook/shared/use-plugin-text";

import {until} from "./testing/harness";
import {textScene} from "./testing/text-scene";
import type {SceneWindow, TextScene} from "./testing/text-scene";
import {createNotices} from "./web/notices";
import {canonCatalogs} from "./web/text";
import {setText} from "./web/text-draft";
import {createTextDrafts} from "./web/text-drafts";
import {useTextTab} from "./web/text-tab";
import {createCanonWorld} from "./web/world";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "text-tab");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const at: ReadPosition = {kind: "chapter", chapter: "3", edge: "end"};
const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

/** 一个窗口上某个条目的文字分页逻辑；`dispose` 收掉它的监听与世界客户端。 */
function tabOf(window: SceneWindow, entry: string) {
    const world = createCanonWorld(window.canon);
    const drafts = createTextDrafts({storage: window.storage, world: () => world, call: window.canon.call, schedule: () => () => undefined});
    const scope = effectScope();
    const session = drafts.session(entry);
    const start = () => scope.run(() => useTextTab({entry, session, world, call: window.canon.call, name: () => "条目", position: () => at, blocked: () => "", notices: createNotices(), text: boundText(port, "nbook.canon"), translate: (value) => port.t(value)}))!;
    return {session, start, dispose: () => {
        scope.stop();
        world.dispose();
    }};
}

async function inScene(run: (scene: TextScene) => Promise<void>): Promise<void> {
    const scene = await textScene(await mkdtemp(join(tmp, "scene-")));
    try {
        await run(scene);
    } finally {
        await scene.close();
    }
}

const elsewhere = (scene: TextScene, entry: string, value: string) => scene.edit([{op: "set", at: {entry, path: "text[b1]"}, value}], "creative", at);

describe("author-ui 输出 39：整篇的编辑", () => {
    it("进编辑得到各块连成的整篇；改一句提交以后回到阅读，条目的主文字是一块", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙", "丙"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        expect(await tab.start()).toBe("");
        expect([tab.editing.value, tab.editor.value.text, tab.editor.value.dirty]).toEqual([true, "甲\n\n乙\n\n丙", false]);
        tab.update("甲\n\n乙（改）\n\n丙");
        expect(tab.editor.value.dirty).toBe(true);
        await tab.submit();
        expect([tab.editing.value, scene.sources(entry, at), scene.titles(entry)]).toEqual([false, ["甲\n\n乙（改）\n\n丙"], ["建条目", "改条目的主文字"]]);
        desk.dispose();
    }), 60_000);

    it("没有主文字的条目：进编辑是空的，写了提交以后有一块", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        expect(await tab.start()).toBe("");
        expect(tab.editor.value.text).toBe("");
        tab.update("第一段");
        await tab.submit();
        expect([tab.editing.value, scene.sources(entry, at)]).toEqual([false, ["第一段"]]);
        desk.dispose();
    }), 60_000);

    it("主文字里有被剧情改过的块：进不了编辑，写明原因，世界不变", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        await scene.edit([{op: "set", at: {entry, path: "text[b2]"}, value: "乙（第 3 章起）"}], "story", at);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        expect(await tab.start()).toBe("这个条目的文字里有随剧情变的段落，现在不能在这里改");
        expect([tab.editing.value, tab.dirty.value, scene.sources(entry, at)]).toEqual([false, false, ["甲", "乙（第 3 章起）"]]);
        desk.dispose();
    }), 60_000);

    it("别处留下了带改动的稿、现在这个条目不能整篇改了：照常进编辑、看得到稿，提交时再问", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const window = await scene.window("browser-1");
        const first = tabOf(window, entry);
        const before = first.start();
        await before.start();
        before.update("甲\n\n乙（上次没提交的）");
        before.flush();
        await until(() => before.editor.value.saved === "saved");
        first.dispose();
        await scene.edit([{op: "set", at: {entry, path: "text[b2]"}, value: "乙（第 3 章起）"}], "story", at);

        const desk = tabOf(window, entry);
        const tab = desk.start();
        expect(await tab.start()).toBe("");
        expect([tab.editing.value, tab.editor.value.text, tab.editor.value.dirty]).toEqual([true, "甲\n\n乙（上次没提交的）", true]);
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{kind: "locked", choice: "theirs"}]);
        desk.dispose();
    }), 60_000);

    it("按块改出来的旧稿：这一页见到就换算成整篇，照整篇提交", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        await desk.session.begin(at);
        desk.session.edit((draft, read) => setText(draft, read, "b2", "乙（按块改的）"));
        const tab = desk.start();
        expect([tab.editor.value.text, tab.editor.value.dirty]).toEqual(["甲\n\n乙（按块改的）", true]);
        await tab.submit();
        expect(scene.sources(entry, at)).toEqual(["甲\n\n乙（按块改的）"]);
        desk.dispose();
    }), 60_000);
});

describe("author-ui 输出 44：提交时别处也改了", () => {
    it("回去再改、再提交，同一条冲突还选着；别处又改了一次就是另一条冲突，要重新选", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        expect(await tab.start()).toBe("");
        tab.update("我的");
        await elsewhere(scene, entry, "别处第一次");
        await tab.submit();
        expect([tab.asking.value, tab.conflicts.value]).toEqual([true, [{id: "whole", kind: "changed", mine: "我的", theirs: "别处第一次", choice: null}]]);
        tab.choose("whole", "mine");
        tab.asking.value = false;
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{theirs: "别处第一次", choice: "mine"}]);

        tab.asking.value = false;
        await elsewhere(scene, entry, "别处第二次");
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{theirs: "别处第二次", choice: null}]);
        desk.dispose();
    }), 60_000);

    it("放弃以后重新开始的是另一份稿：上一份稿里选过的不带过来", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        await tab.start();
        tab.update("第一份稿");
        await elsewhere(scene, entry, "别处改的");
        await tab.submit();
        tab.choose("whole", "theirs");
        tab.asking.value = false;
        await tab.leave();
        expect(tab.editing.value).toBe(false);

        // 第二份稿从别的原文起步，改成同样的字，别处又改回原来那一句：冲突的两边与上一份稿的一模一样，但这一份稿里没选过。
        await elsewhere(scene, entry, "中间的样子");
        await tab.start();
        tab.update("第一份稿");
        await elsewhere(scene, entry, "别处改的");
        await tab.submit();
        expect(tab.conflicts.value).toEqual([{id: "whole", kind: "changed", mine: "第一份稿", theirs: "别处改的", choice: null}]);
        expect([tab.editing.value, scene.titles(entry)]).toEqual([true, ["建条目", "别处的改动", "别处的改动", "别处的改动"]]);
        desk.dispose();
    }), 60_000);

    it("别处在末尾加了一块：问一次；选“我的”以后世界里只有作者的整篇", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        await tab.start();
        tab.update("甲（改）\n\n乙");
        await scene.edit([{op: "addBlock", entry, source: "别处加的"}], "creative", at);
        await tab.submit();
        expect(tab.conflicts.value).toEqual([{id: "whole", kind: "changed", mine: "甲（改）\n\n乙", theirs: "甲\n\n乙\n\n别处加的", choice: null}]);
        tab.choose("whole", "mine");
        await tab.confirmConflicts();
        expect([tab.asking.value, tab.editing.value, scene.sources(entry, at)]).toEqual([false, false, ["甲（改）\n\n乙"]]);
        desk.dispose();
    }), 60_000);

    it("选“现在的”：放弃自己的改动、回到阅读，世界里是别处的那一版，没有多出修订", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        await tab.start();
        tab.update("我的");
        await elsewhere(scene, entry, "别处的");
        await tab.submit();
        tab.choose("whole", "theirs");
        await tab.confirmConflicts();
        expect([tab.editing.value, tab.dirty.value, scene.sources(entry, at), scene.titles(entry)]).toEqual([false, false, ["别处的"], ["建条目", "别处的改动"]]);
        desk.dispose();
    }), 60_000);

    it("编辑的时候有一块被剧情改过了：提交时只能照现在的来，写明原因；确认以后回到阅读，世界不变", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        await tab.start();
        tab.update("甲\n\n乙（我改的）");
        await scene.edit([{op: "set", at: {entry, path: "text[b2]"}, value: "乙（第 3 章起）"}], "story", at);
        await tab.submit();
        expect(tab.conflicts.value).toEqual([{id: "whole", kind: "locked", mine: "甲\n\n乙（我改的）", theirs: "甲\n\n乙（第 3 章起）", reason: "这个条目的文字里有随剧情变的段落，现在不能在这里改", choice: "theirs"}]);
        expect(tab.dirty.value).toBe(true);
        await tab.confirmConflicts();
        expect([tab.editing.value, scene.sources(entry, at)]).toEqual([false, ["甲", "乙（第 3 章起）"]]);
        desk.dispose();
    }), 60_000);

    it("内核说写得不对：原因写在输入框下面，留在编辑、字还在；改对以后再提交就发布", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲"]);
        const desk = tabOf(await scene.window("browser-1"), entry);
        const tab = desk.start();
        await tab.start();
        tab.update('好感度 <V of="entry.name"');
        await tab.submit();
        expect([tab.editing.value, tab.editor.value.text, tab.editor.value.problem.startsWith("写得不对："), scene.sources(entry, at)]).toEqual([true, '好感度 <V of="entry.name"', true, ["甲"]]);
        tab.update('好感度 \\<V of="entry.name"');
        await tab.submit();
        expect([tab.editing.value, scene.sources(entry, at)]).toEqual([false, ['好感度 \\<V of="entry.name"']]);
        desk.dispose();
    }), 60_000);
});

describe("author-ui 输出 45：另一个窗口也在改", () => {
    it("那边的提交还在等结果时点“用这里的”：不覆盖，写明先换成那边的", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲"]);
        const [first, second] = [tabOf(await scene.window("browser-1"), entry), tabOf(await scene.window("browser-2"), entry)];
        const [one, two] = [first.start(), second.start()];
        await one.start();
        one.update("甲\n\n只该有一份");
        one.flush();
        await until(() => one.editor.value.saved === "saved");
        await two.start();
        const lost = scene.loseReply((ask) => ask.method === "editEntries");
        await one.submit();
        await lost.lost;
        expect(one.editor.value.phase).toBe("confirming");
        two.update("甲改");
        two.flush();
        await until(() => two.editor.value.saved === "diverged");

        await two.takeOver();
        expect([two.editor.value.saved, two.editor.value.message]).toEqual(["diverged", "另一个窗口有一次提交还在等结果，先换成那边的"]);
        second.dispose();
        first.dispose();
    }), 60_000);
});

describe("author-ui 输出 45：放弃", () => {
    it("链路断着时放弃：留在编辑，写明暂存没有删掉；连上以后再放弃才离开", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const desk = tabOf(window, entry);
        const tab = desk.start();
        await tab.start();
        tab.update("改过的");
        tab.flush();
        await until(() => tab.editor.value.saved === "saved");

        window.disconnect();
        await tab.leave();
        expect([tab.editing.value, tab.editor.value.message]).toEqual([true, "暂存没有删掉，连上以后再放弃"]);
        expect(await window.reconnect()).toEqual({ok: true});
        await tab.leave();
        expect(tab.editing.value).toBe(false);
        desk.dispose();
    }), 60_000);
});
