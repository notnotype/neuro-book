import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";

import type {GridRect} from "../grid-rects";
import type {LiveDragHost} from "../live-drag";
import {createDragSession} from "./drag-session";
import {createLiveDragSession} from "./live-drag-session";
import type {LiveDragSessionHandle, LiveDragSessionOptions, LiveGrid} from "./live-drag-session";
import {useLiveDragSession} from "./useLiveDragSession";

/**
 * 实时布局的拖动会话（Spec `ui/layout-drag` 的“实时布局的编排”）：会话、引擎与网格之间接线的先后。帧用 happy-dom 真实的 `requestAnimationFrame`。
 * 引擎自己的规则在 `live-drag.test.ts`；真实浏览器里的手感由 `e2e/lab-live-panels.e2e.ts` 与工作台的 e2e 证明。
 * 合成把会话的 `sampled` 接到引擎的 `wake`，帧因此排在会话发布的帧前面：happy-dom 把帧回调里新排的帧放进同一批跑，这里分不出先后；
 * 真实浏览器里顺序反了每帧多一次强制的样式重算，由 `e2e/workbench-drag-cost.e2e.ts` 的每帧上限守着。
 */

type Drop = {readonly key: string};
type Source = "tab" | "window";

let root: HTMLElement;
let source: HTMLElement;
let handle: LiveDragSessionHandle<Source, Drop, "tab", string> | null;
let log: string[];
let placed: GridRect[];

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, {bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, ...init});
}

function grid(motionMs = 400): LiveGrid {
    return {
        origin: () => {
            log.push("origin");
            return {x: 0, y: 0};
        },
        placeLifted: (rect) => placed.push(rect),
        settleMotion: () => log.push("settleMotion"),
        motionMs: () => motionMs,
    };
}

function host(over: Partial<LiveDragHost<"tab", Drop, string>> = {}): LiveDragHost<"tab", Drop, string> {
    return {
        facts: (_source, drop) => {
            log.push("facts");
            return {key: drop.key, inPlace: false, home: false, slotOnScreen: null};
        },
        show: () => true,
        measure: () => {
            log.push("measure");
            return "lifted";
        },
        collapsed: () => "collapsed",
        card: {key: () => "card", rect: () => ({left: 0, top: 0, right: 400, bottom: 300})},
        ...over,
    };
}

type Options = LiveDragSessionOptions<Source, Drop, string, "tab", string>;

function start(over: (live: LiveDragSessionHandle<Source, Drop, "tab", string>["live"]) => Partial<Options> = () => ({})): LiveDragSessionHandle<Source, Drop, "tab", string> {
    handle = createLiveDragSession<Source, Drop, string, "tab", string>(root, (live) => ({
        sourceAt: (target) => (target.closest("[data-source]") === null ? null : "tab"),
        resolve: () => ({key: "a"}),
        actionKey: (drop) => drop.key,
        commit: (drop) => log.push(`commit:${drop.key}`),
        live: (from) => (from === "tab" ? "tab" : null),
        host: host(),
        grid: () => grid(),
        ...over(live),
    }));
    return handle;
}

function grab(): void {
    source.dispatchEvent(pointer("pointerdown", {clientX: 0, clientY: 0}));
    source.dispatchEvent(pointer("pointermove", {clientX: 10, clientY: 0}));
}

beforeEach(() => {
    document.body.innerHTML = `<div id="root"><button data-source>标签</button></div>`;
    root = document.querySelector<HTMLElement>("#root") as HTMLElement;
    source = root.querySelector<HTMLElement>("[data-source]") as HTMLElement;
    handle = null;
    log = [];
    placed = [];
    Object.assign(document, {elementsFromPoint: () => [source]});
});

afterEach(() => {
    handle?.dispose();
    document.body.innerHTML = "";
});

describe("会话的 sampled", () => {
    it("会话自己的 pointermove 一开头同步调：在那里排的帧跑在会话发布的帧前面", async () => {
        const seen: Array<number | undefined> = [];
        const session = createDragSession<string, Drop>({
            root,
            sourceAt: (target) => (target.closest("[data-source]") === null ? null : "row"),
            resolve: () => ({key: "a"}),
            actionKey: (drop) => drop.key,
            commit: () => undefined,
            sampled: () => requestAnimationFrame(() => seen.push(session.state.value?.point.x)),
        });
        try {
            source.dispatchEvent(pointer("pointerdown", {clientX: 0, clientY: 0}));
            source.dispatchEvent(pointer("pointermove", {clientX: 10, clientY: 0}));
            source.dispatchEvent(pointer("pointermove", {clientX: 30, clientY: 0}));
            await nextFrame();
            await nextFrame();
            // 第二次移动排的那一帧先跑：会话这时还没发布 30。
            expect(seen).toEqual([10, 10]);
            expect(session.state.value?.point.x).toBe(30);
        } finally {
            session.dispose();
        }
    });
});

describe("合成的先后", () => {
    it("拿起：宿主的 activate 先，返回假就不走实时布局，引擎的回调一个都不调", async () => {
        start(() => ({
            activate: () => {
                log.push("activate");
                return false;
            },
        }));
        grab();
        await nextFrame();
        expect(log).toEqual(["activate"]);
        expect(handle!.live.state().active).toBe(false);
    });

    it("拿起：宿主的 activate 返回真之后才 settleMotion、begin；宿主的结构键读引擎的 active，拿起不被当成结构变了", async () => {
        const live = start((engine) => ({
            activate: () => {
                log.push(`activate:${String(engine.state().active)}`);
                return true;
            },
            structure: () => String(engine.state().active),
        }));
        grab();
        // 拿起时读一次网格根的位置就是 `begin`：在 settleMotion 之后。
        expect(log.slice(0, 3)).toEqual(["activate:false", "settleMotion", "origin"]);
        expect(live.live.state().active).toBe(true);
        await nextFrame();
        await nextFrame();
        expect(live.session.state.value).not.toBeNull();
        expect(log).toContain("measure");
    });

    it("live 返回 null 的来源照常是落点指示：引擎的回调一个都不调", async () => {
        start(() => ({live: () => null}));
        grab();
        await nextFrame();
        expect(handle!.live.state().active).toBe(false);
        expect(handle!.session.state.value).not.toBeNull();
        expect(log).not.toContain("facts");
        expect(log).not.toContain("measure");
        // 落点指示的判定也要量终点的矩形：起拖时照样把过渡送到终点。
        expect(log).toContain("settleMotion");
    });

    it("减少动效（motionMs 为 0）、没有网格时不走实时布局，也不问 live", async () => {
        for (const box of [grid(0), null]) {
            let asked = 0;
            start(() => ({grid: () => box, live: () => (asked += 1, "tab")}));
            grab();
            await nextFrame();
            expect(handle!.live.state().active).toBe(false);
            expect(asked).toBe(0);
            handle!.dispose();
        }
    });

    it("判定：宿主的 resolve 返回之后交给引擎", async () => {
        start(() => ({
            resolve: () => {
                log.push("resolve");
                return {key: "a"};
            },
        }));
        grab();
        const first = log.indexOf("resolve");
        expect(first).toBeGreaterThanOrEqual(0);
        expect(log.indexOf("facts")).toBe(first + 1);
    });

    it("收场：引擎的 end 先于宿主的 onActiveChange(false)：放回跟手的在宿主换掉自己的状态之前", async () => {
        start((engine) => ({
            host: host({
                facts: (_source, drop) => ({key: drop.key, inPlace: false, home: true, slotOnScreen: null, container: "strip"}),
                follow: {read: (at) => () => log.push(`follow:${at === null ? "null" : at.container}`), afterRender: () => undefined},
            }),
            onActiveChange: (active) => log.push(`active:${String(active)}:${String(engine.state().active)}`),
        }));
        grab();
        await nextFrame();
        await nextFrame();
        log.length = 0;
        window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(log).toEqual(["follow:null", "active:false:false"]);
    });

    it("放下：实时布局这一场提交指针下的候选，不等预览稳定", async () => {
        start();
        grab();
        source.dispatchEvent(pointer("pointerup", {clientX: 10, clientY: 0, buttons: 0}));
        expect(log).toContain("commit:a");
    });

    it("键盘拖动不走实时布局：不问 live，放下也不按指针下提交", async () => {
        let asked = 0;
        start(() => ({live: () => (asked += 1, "tab"), keyboard: {sourceAt: () => "tab", regions: () => [], stops: () => ({axis: "horizontal", points: []}), start: () => ({region: 0, at: 0}), refocus: () => null}}));
        source.focus();
        source.dispatchEvent(new KeyboardEvent("keydown", {key: " ", bubbles: true}));
        await nextFrame();
        expect(asked).toBe(0);
        expect(handle!.live.state().active).toBe(false);
        expect(log).toContain("settleMotion");
    });

    it("拖动中 dispose：经会话收场结束引擎，状态回到空闲", async () => {
        const states: boolean[] = [];
        start(() => ({changed: (state) => states.push(state.active)}));
        grab();
        await nextFrame();
        expect(handle!.live.state().active).toBe(true);
        handle!.dispose();
        expect(handle!.live.state().active).toBe(false);
        expect(states.at(-1)).toBe(false);
    });
});

describe("useLiveDragSession", () => {
    it("根出现后建会话；lifted、dragging 跟着这一场；卸载后会话、引擎为 null，状态回到空闲", async () => {
        document.body.innerHTML = `<div id="host"></div>`;
        const refs: Array<ReturnType<typeof useLiveDragSession<Source, Drop, never, "tab", string>>> = [];
        const Probe = defineComponent({
            setup() {
                const box = ref<HTMLElement | null>(null);
                refs.push(useLiveDragSession<Source, Drop, never, "tab", string>(box, () => ({
                    sourceAt: (target) => (target.closest("[data-source]") === null ? null : "tab"),
                    resolve: () => ({key: "a"}),
                    actionKey: (drop) => drop.key,
                    commit: () => undefined,
                    live: () => "tab",
                    host: host(),
                    grid: () => grid(),
                })));
                return () => h("div", {ref: box}, [h("button", {"data-source": ""}, "标签")]);
            },
        });
        const wrapper = mount(Probe, {attachTo: document.querySelector("#host") as HTMLElement});
        const refsOf = refs[0]!;
        // 模板 ref 的根在挂载后的那次刷新里才交给侦听。
        await nextTick();
        const button = wrapper.get("[data-source]").element;
        Object.assign(document, {elementsFromPoint: () => [button]});
        button.dispatchEvent(pointer("pointerdown", {clientX: 0, clientY: 0}));
        button.dispatchEvent(pointer("pointermove", {clientX: 10, clientY: 0}));
        await nextFrame();
        expect(refsOf.dragging.value).toBe(true);
        expect(refsOf.liveState.value.active).toBe(true);
        expect(refsOf.lifted.value).toEqual({key: "card"});
        wrapper.unmount();
        expect([refsOf.state.value, refsOf.dragging.value, refsOf.liveState.value.active]).toEqual([null, false, false]);
    });
});
