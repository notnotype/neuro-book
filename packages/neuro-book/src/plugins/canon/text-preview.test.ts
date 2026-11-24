/**
 * 主文字编辑时的预览（web/text-preview.ts；docs/specs/canon/author-ui.md 输出 48）：什么时候读、先发的晚回来怎么办、写得不对与
 * 读不出来时留着什么。世界服务与链路用 `testing/text-scene.ts` 的真实场地；延后的执行换成手动的，不等真实时间。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {effectScope, nextTick, shallowRef} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {until} from "./testing/harness";
import {textScene} from "./testing/text-scene";
import type {SceneWindow, TextScene} from "./testing/text-scene";
import type {EntryTextNode} from "./web/components/entry-text";
import {PREVIEW_DELAY, useTextPreview} from "./web/text-preview";
import type {PreviewInput} from "./web/text-preview";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "text-preview");
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

/** 一块里的字：文字节点的字、引用的名字，按出现的先后连起来。 */
const words = (node: EntryTextNode | undefined): string => (node === undefined ? "" : node.type === "text" ? node.value ?? "" : node.type === "canonRef" ? `[${node.name ?? ""}]` : (node.children ?? []).map(words).join(""));

/** 一个窗口上的预览：`source` 是输入框里的整篇（null 是预览关着），`stamp` 代表世界的版本；延后的执行攒在 `timers` 里，`fire` 才跑。 */
function deskOf(window: SceneWindow, entry: string) {
    const source = shallowRef<string | null>(null);
    const stamp = shallowRef(0);
    const timers: Array<{run(): void; ms: number; cancelled: boolean}> = [];
    const scope = effectScope();
    const preview = scope.run(() => useTextPreview({
        call: window.canon.call,
        input: (): PreviewInput | null => (source.value === null ? null : {entry, source: source.value, position: at, mode: "actual"}),
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
        preview,
        shown: () => words(preview.block.value?.tree),
        /** 还等着的延后执行。 */
        waiting: () => timers.filter((timer) => !timer.cancelled),
        /** 作者停够了：跑掉等着的那一次。 */
        fire: () => {
            for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
        },
        dispose: () => scope.stop(),
    };
}

describe("author-ui 输出 48：预览什么时候读", () => {
    it("打开预览马上读；之后每次改字都等作者停下，连着改只读最后的那一份", () => inScene(async (scene) => {
        const [entry, other] = [await scene.seed(["存下来的"]), await scene.seed([])];
        const desk = deskOf(await scene.window("browser-1"), entry);
        expect([desk.shown(), desk.waiting().length]).toEqual(["", 0]);

        desk.source.value = `见 <Ref id="${other}" />`;
        await until(() => desk.shown() === "见 [条目 2]");
        expect(desk.waiting().length).toBe(0);

        desk.source.value = "改一";
        await nextTick();
        desk.source.value = "改二";
        await nextTick();
        expect([desk.waiting().map((timer) => timer.ms), desk.shown()]).toEqual([[PREVIEW_DELAY], "见 [条目 2]"]);
        desk.fire();
        await until(() => desk.shown() === "改二");
        desk.dispose();
    }));

    it("先发的晚回来：不盖掉后发的结果", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"), entry);
        // 第一次读的回复扣住，等第二次读完再放。
        const first = scene.holdReply((ask) => ask.method === "renderSource");
        desk.source.value = "先发的";
        await first.held;
        desk.source.value = "后发的";
        await nextTick();
        desk.fire();
        await until(() => desk.shown() === "后发的");
        first.release();
        // 放掉以后再读一轮别的东西，确认迟到的回复已经到过、没有换上。
        desk.stamp.value += 1;
        await until(() => desk.preview.failure.value === null && desk.shown() === "后发的");
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

    it("关掉预览：留着的丢掉，等着的那一次不再读；再打开重新读", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"), entry);
        desk.source.value = "甲";
        await until(() => desk.shown() === "甲");
        desk.source.value = "乙";
        await nextTick();
        desk.source.value = null;
        await nextTick();
        expect([desk.shown(), desk.waiting().length]).toEqual(["", 0]);
        desk.source.value = "丙";
        await until(() => desk.shown() === "丙");
        desk.dispose();
    }));
});

describe("author-ui 输出 48：写得不对与读不出来", () => {
    it("写得不对：给出行、列与原因，留着上一次读得出来的样子；改对了换回来", () => inScene(async (scene) => {
        const entry = await scene.seed([]);
        const desk = deskOf(await scene.window("browser-1"), entry);
        desk.source.value = "好的一段";
        await until(() => desk.shown() === "好的一段");
        desk.source.value = "好的一段\n\n他说{+5}";
        await nextTick();
        desk.fire();
        await until(() => desk.preview.problem.value !== null);
        expect([desk.preview.problem.value?.line, desk.preview.problem.value?.column, desk.preview.problem.value?.message === "", desk.shown()]).toEqual([3, 3, false, "好的一段"]);
        desk.source.value = "好的一段\n\n他说了";
        await nextTick();
        desk.fire();
        await until(() => desk.preview.problem.value === null);
        expect(desk.shown()).toBe("好的一段他说了");
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
        await until(() => desk.preview.failure.value !== null);
        expect(desk.shown()).toBe("断之前");
        await window.reconnect();
        desk.stamp.value += 1;
        await until(() => desk.preview.failure.value === null);
        expect(desk.shown()).toBe("断着的时候写的");
        desk.dispose();
    }));

    it("条目读不到（不存在）：没有可看的，也不算失败", () => inScene(async (scene) => {
        const desk = deskOf(await scene.window("browser-1"), "e999");
        const asked = scene.holdReply((ask) => ask.method === "renderSource");
        desk.source.value = "字";
        await asked.held;
        asked.release();
        desk.stamp.value += 1;
        await nextTick();
        await until(async () => {
            await nextTick();
            return desk.preview.failure.value === null && desk.preview.problem.value === null;
        });
        expect(desk.shown()).toBe("");
        desk.dispose();
    }));
});
