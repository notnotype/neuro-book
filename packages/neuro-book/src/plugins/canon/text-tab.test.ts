/**
 * 条目页文字分页的宿主逻辑（web/text-tab.ts；docs/specs/canon/author-ui.md 输出 44、45）：冲突里选到一半的选择、涉及拆并的冲突选完
 * 以后、放弃删不掉暂存时。不挂组件，直接用 `useTextTab`：它只依赖响应式状态。世界服务、Storage 与链路用 `testing/text-scene.ts`
 * 的真实场地。页面上的接线（按钮、对话框、焦点）在 `web/entry-page.dom.test.ts` 与组件的 dom 测试里。
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
    const tab = scope.run(() => useTextTab({entry, session: drafts.session(entry), world, call: window.canon.call, name: () => "条目", position: () => at, blocked: () => "", notices: createNotices(), text: boundText(port, "nbook.canon"), translate: (value) => port.t(value)}))!;
    return {tab, dispose: () => {
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

describe("author-ui 输出 44：冲突里的选择", () => {
    it("回去再改、再提交，同一条冲突还选着；别处又改了一次就是另一条冲突，要重新选", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const {tab, dispose} = tabOf(await scene.window("browser-1"), entry);
        expect(await tab.start()).toBe("");
        tab.update("b1", "我的");
        await elsewhere(scene, entry, "别处第一次");
        await tab.submit();
        expect([tab.asking.value, tab.conflicts.value.map((item) => item.choice)]).toEqual([true, [null]]);
        tab.choose("b1", "mine");
        tab.asking.value = false;
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{theirs: "别处第一次", choice: "mine"}]);

        tab.asking.value = false;
        await elsewhere(scene, entry, "别处第二次");
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{theirs: "别处第二次", choice: null}]);
        dispose();
    }), 60_000);

    it("放弃以后重新开始的是另一份稿：上一份稿里选过的不带过来", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const {tab, dispose} = tabOf(await scene.window("browser-1"), entry);
        await tab.start();
        tab.update("b1", "第一份稿");
        await elsewhere(scene, entry, "别处改的");
        await tab.submit();
        tab.choose("b1", "theirs");
        tab.asking.value = false;
        await tab.leave();
        expect(tab.editing.value).toBe(false);

        // 第二份稿从别的原文起步，改成同样的字，别处又改回原来那一句：冲突的两边与上一份稿的一模一样，但这一份稿里没选过。
        await elsewhere(scene, entry, "中间的样子");
        await tab.start();
        tab.update("b1", "第一份稿");
        await elsewhere(scene, entry, "别处改的");
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{mine: "第一份稿", theirs: "别处改的", choice: null}]);
        expect([tab.editing.value, scene.titles(entry)]).toEqual([true, ["建条目", "别处的改动", "别处的改动", "别处的改动"]]);
        dispose();
    }), 60_000);

    it("拆过的块别处也改了、选“现在的”：不接着提交，写一句让作者看；拆出去的那一半一起撤掉，再提交也不会多出一份", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲\n\n乙"]);
        const {tab, dispose} = tabOf(await scene.window("browser-1"), entry);
        await tab.start();
        tab.split("b1", "甲".length);
        expect(tab.editor.value.blocks.map((block) => block.text)).toEqual(["甲", "乙"]);
        await elsewhere(scene, entry, "别处改甲\n\n乙");
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{kind: "changed", mine: "甲", theirs: "别处改甲\n\n乙"}]);
        tab.choose("b1", "theirs");
        await tab.confirmConflicts();
        expect([tab.asking.value, tab.editing.value, tab.editor.value.message]).toEqual([false, true, "有几块照现在的恢复了，看过再提交"]);
        expect([tab.editor.value.blocks.map((block) => block.text), tab.editor.value.count]).toEqual([["别处改甲\n\n乙"], 0]);
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["别处改甲\n\n乙"], ["建条目", "别处的改动"]]);
        dispose();
    }), 60_000);
});

describe("author-ui 输出 39、44：拆与并遇上别处加的块", () => {
    it("并过的两块中间别处加了一块：列成冲突，照现在的把并撤掉、不接着提交；两块都回到没动过", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲", "乙"]);
        const {tab, dispose} = tabOf(await scene.window("browser-1"), entry);
        await tab.start();
        tab.merge("b2");
        await scene.edit([{op: "addBlock", entry, source: "丙", after: "b1"}], "creative", at);
        await tab.submit();
        expect(tab.conflicts.value).toMatchObject([{id: "b2", kind: "locked", reason: "这一块与上一块中间多了别的块，不能并了"}]);
        await tab.confirmConflicts();
        expect([tab.editing.value, tab.editor.value.message, tab.editor.value.count, tab.editor.value.blocks.map((block) => block.text)]).toEqual([true, "有几块照现在的恢复了，看过再提交", 0, ["甲", "丙", "乙"]]);
        expect([scene.sources(entry, at), scene.titles(entry)]).toEqual([["甲", "丙", "乙"], ["建条目", "别处的改动"]]);
        dispose();
    }), 60_000);

    it("拆开以后别处在同一块后面加了一块：不问，提交以后拆出去的那一半仍紧跟着前半，别处加的排在它后面", () => inScene(async (scene) => {
        const entry = await scene.seed(["甲\n\n乙"]);
        const {tab, dispose} = tabOf(await scene.window("browser-1"), entry);
        await tab.start();
        tab.split("b1", "甲".length);
        await scene.edit([{op: "addBlock", entry, source: "丙", after: "b1"}], "creative", at);
        await tab.submit();
        expect([tab.editing.value, tab.conflicts.value, scene.sources(entry, at)]).toEqual([false, [], ["甲", "乙", "丙"]]);
        dispose();
    }), 60_000);
});

describe("author-ui 输出 45：放弃", () => {
    it("链路断着时放弃：留在编辑，写明暂存没有删掉；连上以后再放弃才离开", () => inScene(async (scene) => {
        const entry = await scene.seed(["A"]);
        const window = await scene.window("browser-1");
        const {tab, dispose} = tabOf(window, entry);
        await tab.start();
        tab.update("b1", "改过的");
        tab.flush();
        await until(() => tab.editor.value.saved === "saved");

        window.disconnect();
        await tab.leave();
        expect([tab.editing.value, tab.editor.value.message]).toEqual([true, "暂存没有删掉，连上以后再放弃"]);
        expect(await window.reconnect()).toEqual({ok: true});
        await tab.leave();
        expect(tab.editing.value).toBe(false);
        dispose();
    }), 60_000);
});
