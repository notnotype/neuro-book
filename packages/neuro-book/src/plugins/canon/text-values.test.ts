/**
 * 富文本里小块的值（web/text-values.ts；docs/specs/canon/author-ui.md 输出 48）：什么时候读、先发的晚回来怎么办、写得不对与
 * 读不出来时留着什么。世界服务与链路用 `testing/text-scene.ts` 的真实场地；延后的执行换成手动的，不等真实时间。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {effectScope, nextTick, shallowRef} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {until} from "./testing/harness";
import {RENDER_SOURCE_MAX} from "./shared/contracts";
import {textScene} from "./testing/text-scene";
import type {SceneWindow, TextScene} from "./testing/text-scene";
import {VALUES_DELAY, useTextValues} from "./web/text-values";
import type {TextValueTable, ValuesInput} from "./web/text-values";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "text-values");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const at: ReadPosition = {kind: "chapter", chapter: "3", edge: "end"};

async function inScene(run: (scene: TextScene) => Promise<void>): Promise<void> {
    const scene = await textScene(await mkdtemp(join(tmp, "scene-")));
    try {
        await run(scene);
    } finally {
        await scene.close();
    }
}

/** 值表那一篇的原文，条目引用换成 `[名字]`（取自值表）。 */
function words(block: TextValueTable | null): string {
    if (block === null) return "";
    let text = "";
    let cursor = 0;
    for (const value of [...block.values].sort((left, right) => left.start - right.start)) {
        if (value.tag !== "Ref" || !("name" in value)) continue;
        text += `${block.source.slice(cursor, value.start)}[${value.name}]`;
        cursor = block.source.indexOf("/>", value.start) + 2;
    }
    return text + block.source.slice(cursor);
}

/** 一个窗口上的取值：`source` 是输入框里的整篇（null 是不在富文本里编辑），`stamp` 代表世界的版本；延后的执行攒在 `timers` 里，`fire` 才跑。 */
function deskOf(window: SceneWindow, entry: string) {
    const source = shallowRef<string | null>(null);
    const stamp = shallowRef(0);
    const timers: Array<{run(): void; ms: number; cancelled: boolean}> = [];
    const scope = effectScope();
    /** 发出去的渲染请求数。 */
    let calls = 0;
    const call: SceneWindow["canon"]["call"] = (method, input) => {
        if (method === "renderSource") calls += 1;
        return window.canon.call(method, input);
    };
    const values = scope.run(() => useTextValues({
        call,
        input: (): ValuesInput | null => (source.value === null ? null : {entry, source: source.value, position: at, mode: "actual"}),
        stamp: () => stamp.value,
        schedule: (run, ms) => {
            const timer = {run, ms, cancelled: false};
            timers.push(timer);
            return () => void (timer.cancelled = true);
        },
    }))!;
    return {
        source,
        stamp,
        values,
        calls: () => calls,
        shown: () => words(values.table.value),
        /** 还等着的延后执行。 */
        waiting: () => timers.filter((timer) => !timer.cancelled),
        /** 作者停够了：跑掉等着的那一次。 */
        fire: () => {
            for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
        },
        dispose: () => scope.stop(),
    };
}

describe("author-ui 输出 48：小块的值什么时候读", () => {
    it("开始编辑马上读；之后每次改字都等作者停下，连着改只读最后的那一份", () => inScene(async (scene) => {
        const [entry, other] = [await scene.seed(["存下来的"]), await scene.seed([])];
        const desk = deskOf(await scene.window("browser-1"), entry);
        expect([desk.shown(), desk.waiting().length]).toEqual(["", 0]);

        desk.source.value = `见 <Ref id="${other}" />`;
        await until(() => desk.shown() === "见 [条目 2]");
        expect([desk.waiting().length, desk.calls()]).toEqual([0, 1]);

        desk.source.value = "改一";
        await nextTick();
        desk.source.value = "改二";
        await nextTick();
        // 停顿之前一次也不发：只有一个等着的延后执行。
        expect([desk.waiting().map((timer) => timer.ms), desk.shown(), desk.calls()]).toEqual([[VALUES_DELAY], "见 [条目 2]", 1]);
        desk.fire();
        await until(() => desk.shown() === "改二");
        expect(desk.calls()).toBe(2);
        desk.dispose();
    }));

    it("先发的晚回来：不盖掉后发的结果", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window, entry);
        // 第一次读的回复扣住，等第二次读完再放。
        const first = scene.holdReply((ask) => ask.method === "renderSource");
        desk.source.value = "先发的";
        await first.held;
        desk.source.value = "后发的";
        await nextTick();
        desk.fire();
        await until(() => desk.shown() === "后发的");
        first.release();
        // 同一条链路上的回复按先后到：后发的这次调用回来时，放掉的那条已经到过了。
        await window.canon.call("status", {});
        await nextTick();
        expect(desk.shown()).toBe("后发的");
        desk.dispose();
    }));

    it("世界变了（别处改了被引用的条目的名字）：不等停顿，马上重读", () => inScene(async (scene) => {
        const [entry, other] = [await scene.seed([]), await scene.seed([])];
        const desk = deskOf(await scene.window("browser-1"), entry);
        desk.source.value = `见 <Ref id="${other}" />`;
        await until(() => desk.shown() === "见 [条目 2]");
        await scene.edit([{op: "set", at: {entry: other, path: "entry.name"}, value: "改了名"}], "creative", at);
        desk.stamp.value = scene.world.status().version;
        await until(() => desk.shown() === "见 [改了名]");
        expect(desk.waiting().length).toBe(0);
        desk.dispose();
    }));

    it("不再要值（离开编辑、切到源文字）：留着的丢掉，等着的那一次不再读；再要时重新读", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"), entry);
        desk.source.value = "甲";
        await until(() => desk.shown() === "甲");
        desk.source.value = "乙";
        await nextTick();
        desk.source.value = null;
        await nextTick();
        expect([desk.shown(), desk.waiting().length, desk.calls()]).toEqual(["", 0, 1]);
        desk.source.value = "丙";
        await until(() => desk.shown() === "丙");
        expect(desk.calls()).toBe(2);
        desk.dispose();
    }));
});

describe("author-ui 输出 48：写得不对与读不出来", () => {
    it("值表配的是发出去的那一篇（逐字相同），小块按它对齐", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"), entry);
        const sent = '## 标题\n\n- 一项 <V of="entry.name" />\n- 两项\n\n> 引用 **强调**';
        desk.source.value = sent;
        await until(() => desk.values.table.value !== null);
        expect(desk.values.table.value?.source).toBe(sent);
        desk.dispose();
    }));

    it("写得不对：留着上一次读得出来的值表，不算失败；改对了换上新的", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window, entry);
        desk.source.value = "好的一段";
        await until(() => desk.shown() === "好的一段");
        desk.source.value = '好的一段\n\n他说<V of="entry.name"';
        await nextTick();
        desk.fire();
        // 同一条链路上后发的调用回来时，取值的那条回复已经到过了。
        await window.canon.call("status", {});
        await nextTick();
        expect([desk.shown(), desk.values.failure.value]).toEqual(["好的一段", null]);
        desk.source.value = "好的一段\n\n他说了";
        await nextTick();
        desk.fire();
        await until(() => desk.shown() === "好的一段\n\n他说了");
        desk.dispose();
    }));

    it("连接断着：给出失败的原因，留着上一次的；连上以后（宿主换了 stamp）读回来", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const window = await scene.window("browser-1");
        const desk = deskOf(window, entry);
        desk.source.value = "断之前";
        await until(() => desk.shown() === "断之前");
        window.disconnect();
        desk.source.value = "断着的时候写的";
        await nextTick();
        desk.fire();
        await until(() => desk.values.failure.value !== null);
        expect(desk.shown()).toBe("断之前");
        await window.reconnect();
        desk.stamp.value += 1;
        await until(() => desk.values.failure.value === null);
        expect(desk.shown()).toBe("断着的时候写的");
        desk.dispose();
    }));

    it("整篇超过一次肯渲染的长度：不发请求，原因是 too-large，留着上一次的；改短了照常读", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"), entry);
        desk.source.value = "短的";
        await until(() => desk.shown() === "短的");
        const before = desk.calls();
        desk.source.value = "字".repeat(RENDER_SOURCE_MAX + 1);
        await nextTick();
        desk.fire();
        await until(() => desk.values.failure.value !== null);
        expect([desk.values.failure.value, desk.calls() - before, desk.shown()]).toEqual(["too-large", 0, "短的"]);
        desk.source.value = "又短了";
        await nextTick();
        desk.fire();
        await until(() => desk.shown() === "又短了");
        expect(desk.values.failure.value).toBeNull();
        desk.dispose();
    }));

    it("条目读不到（不存在）：没有可看的，也不算失败", () => inScene(async (scene) => {
        const window = await scene.window("browser-1");
        const desk = deskOf(window, "e999");
        const asked = scene.holdReply((ask) => ask.method === "renderSource");
        desk.source.value = "字";
        await asked.held;
        asked.release();
        // 同一条链路上后发的调用回来时，取值的那条回复已经到过了。
        await window.canon.call("status", {});
        await nextTick();
        expect([desk.shown(), desk.values.failure.value]).toEqual(["", null]);
        desk.dispose();
    }));
});
