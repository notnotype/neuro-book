import {afterEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, onMounted, type Component} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";
import {sashPanelsOfConfig} from "./grid-splitter";
import {createSplitterSession, type SplitterGestureSession} from "./splitter-session";
import {SASH_HOVER_DELAY_MS, sashBandBox} from "./sash-feedback";

/**
 * 独立 `Splitter` 的用户可观察行为：默认分配、指针/键盘手势、受控发布与设备像素对齐。
 *
 * happy-dom 没有布局引擎（`getBoundingClientRect` 全是 0），所以只对**分隔线元素**注入矩形：
 * 命中判定、拖动求解、面板命名、分配与渲染仍是组件真实实现。
 * 指针事件派发在 scope 根（`[data-splitter]`）上，与真实用户按下分隔线后事件冒泡到根一致；
 * 真实浏览器的光标、指针捕获与视觉由 e2e/splitter.spec.ts 覆盖。
 * 几何一律 CSS px：`sizesPx` 与 `panels` 同序，合计等于面板空间（不含 sash 占用）。
 */

/** 三栏声明：两侧固定 px，中间按权重吸收余量；未测量时容器事实就是声明合计 700px */
const FREE_PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSizePx: 200, sizing: "fixed"},
    {id: "editor", defaultSizePx: 300},
    {id: "inspector", defaultSizePx: 200, sizing: "fixed"},
];
/** 700 − 两条 1px 分隔线 = 698：固定栏各保持 200，editor 吸收 298 */
const FREE_SIZES = [200, 298, 200];

/** 受限三栏：editor 已接近自己的最小尺寸，sash 0 继续向右推要由更远的 inspector 让位 */
const CONSTRAINED_PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSizePx: 200, minSizePx: 150, maxSizePx: 400, sizing: "fixed"},
    {id: "editor", defaultSizePx: 300, minSizePx: 250},
    {id: "inspector", defaultSizePx: 200, sizing: "fixed"},
];

/** 可收起三栏：outline 收起后内容不占主轴，记忆展开尺寸 180 与按下时的呈现 200 不同 */
const COLLAPSIBLE_PANELS: SplitterPanelConfig[] = [
    {
        id: "outline",
        defaultSizePx: 200,
        minSizePx: 150,
        sizing: "fixed",
        collapse: {collapsedSize: 0, restoreSize: 180, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
    },
    {id: "editor", defaultSizePx: 300},
    {id: "inspector", defaultSizePx: 200, sizing: "fixed"},
];

const GESTURE_EVENTS = ["gesture-start", "gesture-update", "gesture-end", "gesture-cancel"] as const;
/** 第 i 条分隔线的命中位置：200、400；命中带是 ±5px（fine 指针） */
const SASH_LEFT = (index: number): number => 200 + index * 200;
const SASH_CENTER = (index: number): number => SASH_LEFT(index) + 0.5;

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

type RectInit = {left: number; top: number; right: number; bottom: number};

/** 只替代测量：命中判定读的是元素矩形，happy-dom 下必须逐个给出真实盒 */
function stubRect(element: Element, box: RectInit): void {
    (element as HTMLElement).getBoundingClientRect = () => ({
        ...box,
        x: box.left,
        y: box.top,
        width: box.right - box.left,
        height: box.bottom - box.top,
        toJSON: () => box,
    }) as DOMRect;
}

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

type ExtraProps = {
    disabled?: boolean;
    direction?: "horizontal" | "vertical";
    sashSizes?: readonly number[];
    sizesPx?: readonly number[];
};

function mountSplitter(panels: SplitterPanelConfig[] = FREE_PANELS, extra: ExtraProps = {}): VueWrapper {
    const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels, ...extra}});
    wrappers.push(wrapper);
    return wrapper;
}

function mountTemplate(component: Component, props: Record<string, unknown> = {}): VueWrapper {
    const wrapper = mount(component, {attachTo: attachContainer(), props});
    wrappers.push(wrapper);
    return wrapper;
}

function rootElement(wrapper: VueWrapper): HTMLElement {
    return wrapper.find("[data-splitter]").element as HTMLElement;
}

function sashElements(wrapper: VueWrapper): HTMLElement[] {
    return wrapper.findAll("[data-sash]").map((sash) => sash.element as HTMLElement);
}

/** 装饰带：分隔线里那条盖在接缝上的可见线（几何写内联，显隐由 scoped CSS 按状态属性决定）。 */
function lineElement(sash: HTMLElement): HTMLElement {
    return sash.querySelector<HTMLElement>(".sash-line")!;
}

function panelElements(wrapper: VueWrapper): HTMLElement[] {
    return wrapper.findAll("[data-panel-id]").map((panel) => panel.element as HTMLElement);
}

function panelSizes(wrapper: VueWrapper, axis: "width" | "height" = "width"): number[] {
    return panelElements(wrapper).map((panel) => Number.parseFloat(axis === "width" ? panel.style.width : panel.style.height));
}

function lastLayout(wrapper: VueWrapper): number[] {
    return wrapper.emitted("layout")?.at(-1)?.[0] as number[];
}

function stubSashRects(wrapper: VueWrapper): void {
    sashElements(wrapper).forEach((sash, index) => {
        stubRect(sash, {left: SASH_LEFT(index), top: 0, right: SASH_LEFT(index) + 1, bottom: 300});
    });
}

/** 指针事件：happy-dom 的 PointerEvent 字段可写，按真实指针输入构造（单主指针、左键、鼠标）。 */
function pointer(type: string, x: number, y: number, init: {pointerId?: number; pointerType?: string; isPrimary?: boolean} = {}): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: init.pointerId ?? 1,
        pointerType: init.pointerType ?? "mouse",
        isPrimary: init.isPrimary ?? true,
    });
}

/** 拖动求解挂在 rAF 上：派发一帧指针移动后要等这一帧跑完才看得到预览。 */
async function nextFrame(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
    await nextTick();
}

function press(wrapper: VueWrapper, index: number, x = SASH_CENTER(index)): void {
    rootElement(wrapper).dispatchEvent(pointer("pointerdown", x, 150));
}

function move(wrapper: VueWrapper, index: number, deltaX: number): void {
    rootElement(wrapper).dispatchEvent(pointer("pointermove", SASH_CENTER(index) + deltaX, 150));
}

function release(wrapper: VueWrapper, index: number, deltaX = 0): void {
    rootElement(wrapper).dispatchEvent(pointer("pointerup", SASH_CENTER(index) + deltaX, 150));
}

/** 一次完整指针拖动：按下 → 移动 → 松手（移动后的帧已求解） */
async function dragSash(wrapper: VueWrapper, index: number, deltaX: number): Promise<void> {
    press(wrapper, index);
    move(wrapper, index, deltaX);
    await nextFrame();
    release(wrapper, index, deltaX);
    await nextTick();
}

function pressKey(element: HTMLElement, key: string, init: {type?: "keydown" | "keyup"; shiftKey?: boolean} = {}): void {
    element.dispatchEvent(new KeyboardEvent(init.type ?? "keydown", {key, bubbles: true, cancelable: true, shiftKey: init.shiftKey ?? false}));
}

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) {
        if (wrapper.exists()) wrapper.unmount();
    }
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
    Object.defineProperty(window, "devicePixelRatio", {value: 1, configurable: true});
});

describe("splitter 默认分配与指针手势", () => {
    it("程序挂载按声明 px 分配，约束收紧只发 layout、不产生手势事件", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
        for (const name of GESTURE_EVENTS) expect(wrapper.emitted(name), name).toBeUndefined();

        // 宿主收紧 max 属于程序布局：几何跟着约束走，但没有任何用户提交
        await wrapper.setProps({panels: [FREE_PANELS[0]!, FREE_PANELS[1]!, {...FREE_PANELS[2]!, maxSizePx: 150}]});
        await nextTick();

        expect(lastLayout(wrapper)).toEqual([200, 348, 150]);
        expect(panelSizes(wrapper)).toEqual([200, 348, 150]);
        for (const name of GESTURE_EVENTS) expect(wrapper.emitted(name), name).toBeUndefined();
    });

    it("一次指针拖动只提交一次最终意图，并按主动/补偿划分面板", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        expect(wrapper.emitted("gesture-start")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: [],
            compensated: [],
            sizesPx: FREE_SIZES,
            collapsed: {},
        });

        move(wrapper, 0, 50);
        await nextFrame();
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);
        expect(panelSizes(wrapper)).toEqual([250, 248, 200]);

        release(wrapper, 0, 50);
        await nextTick();

        expect(wrapper.emitted("gesture-update")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizesPx: [250, 248, 200],
            collapsed: {},
        });
        expect(panelSizes(wrapper)).toEqual([250, 248, 200]);
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
    });

    it("相邻面板停在约束上时，吸收空间的更远面板记为兄弟补偿", async () => {
        const wrapper = mountSplitter(CONSTRAINED_PANELS);
        await nextTick();
        stubSashRects(wrapper);
        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);

        await dragSash(wrapper, 0, 100);

        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: ["inspector"],
            sizesPx: [300, 250, 148],
            collapsed: {},
        });
    });

    it("命中带边缘：带内 4px 可开拖，带外 1px 不开始手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);
        const edge = SASH_LEFT(0) + 1;

        press(wrapper, 0, edge + 6);
        rootElement(wrapper).dispatchEvent(pointer("pointerup", edge + 6, 150));
        expect(wrapper.emitted("gesture-start")).toBeUndefined();

        press(wrapper, 0, edge + 4);
        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
    });

    it("pointercancel 取消手势，几何回到按下基线且下一次拖动可用", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        move(wrapper, 0, 50);
        await nextFrame();
        expect(panelSizes(wrapper)).toEqual([250, 248, 200]);

        rootElement(wrapper).dispatchEvent(pointer("pointercancel", SASH_CENTER(0) + 50, 150));
        await nextTick();

        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            reason: "pointercancel",
        });

        // 取消后的裸移动不再生效，新的拖动可以正常提交
        move(wrapper, 0, 120);
        await nextFrame();
        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);

        await dragSash(wrapper, 0, 20);
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(panelSizes(wrapper)).toEqual([220, 278, 200]);
    });

    it("第二指针不参与已开始的手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        rootElement(wrapper).dispatchEvent(pointer("pointerdown", SASH_CENTER(1), 150, {pointerId: 2}));
        rootElement(wrapper).dispatchEvent(pointer("pointermove", SASH_CENTER(1) + 200, 150, {pointerId: 2}));
        await nextFrame();

        // 第二指针的位移不产生预览：仍以第一指针的按下点为基准
        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
        move(wrapper, 0, 30);
        await nextFrame();
        expect(panelSizes(wrapper)).toEqual([230, 268, 200]);
        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
    });

    it("窗口失焦取消指针手势，下一次键盘调整独立提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        move(wrapper, 0, 40);
        await nextFrame();
        window.dispatchEvent(new Event("blur"));
        await nextTick();

        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            reason: "blur",
        });

        const sash = sashElements(wrapper)[0]!;
        pressKey(sash, "ArrowRight");
        pressKey(sash, "ArrowRight", {type: "keyup"});
        await nextTick();

        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({
            source: "keyboard",
            sash: "outline~editor",
            sizesPx: [210, 288, 200],
        });
    });

    it("卸载取消进行中的手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        pressKey(sashElements(wrapper)[0]!, "ArrowRight");
        await nextTick();
        expect(panelSizes(wrapper)).toEqual([210, 288, 200]);
        wrapper.unmount();

        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]).toMatchObject({reason: "unmount"});
    });

    it("挂载时只挂根元素监听与全局取消监听，卸载后全部解绑", async () => {
        // 只有监听簿记能观察到这一点：组件不能在卸载后继续持有 window/document 监听
        const windowAdd = vi.spyOn(window, "addEventListener");
        const windowRemove = vi.spyOn(window, "removeEventListener");
        const documentAdd = vi.spyOn(document, "addEventListener");
        const documentRemove = vi.spyOn(document, "removeEventListener");

        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        // 取消监听由组件自己挂上：blur 与捕获阶段的 document keydown
        const blurListener = windowAdd.mock.calls.filter((call) => call[0] === "blur").at(-1)?.[1];
        const keydownCall = documentAdd.mock.calls.filter((call) => call[0] === "keydown").at(-1);
        expect(blurListener).toBeTypeOf("function");
        expect(keydownCall?.[1]).toBeTypeOf("function");
        expect(keydownCall?.[2]).toBe(true);

        wrapper.unmount();

        expect(windowRemove.mock.calls).toContainEqual(["blur", blurListener]);
        expect(documentRemove.mock.calls).toContainEqual(["keydown", keydownCall?.[1], true]);
    });
});

describe("splitter 键盘手势与可访问性", () => {
    it("方向键每帧 10px、Shift 走 1px，keyup 只提交一次", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;

        pressKey(sash, "Tab");
        expect(wrapper.emitted("gesture-start")).toBeUndefined();

        pressKey(sash, "ArrowRight");
        pressKey(sash, "ArrowRight");
        pressKey(sash, "ArrowRight", {shiftKey: true});
        pressKey(sash, "ArrowLeft", {shiftKey: true});
        await nextTick();

        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
        expect(wrapper.emitted("gesture-update")).toHaveLength(4);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(panelSizes(wrapper)).toEqual([220, 278, 200]);

        pressKey(sash, "ArrowRight", {type: "keyup"});
        await nextTick();

        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "keyboard",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizesPx: [220, 278, 200],
            collapsed: {},
        });
        expect(panelSizes(wrapper)).toEqual([220, 278, 200]);
    });

    it("Home 与 End 把分隔线移到可行两端", async () => {
        const wrapper = mountSplitter(CONSTRAINED_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;

        pressKey(sash, "End");
        await nextTick();
        // 两端取「先到的一个」：向后拖时 editor 先触到自己的最小 250，停在 248
        expect(panelSizes(wrapper)).toEqual([248, 250, 200]);

        pressKey(sash, "Home");
        await nextTick();
        expect(panelSizes(wrapper)).toEqual([150, 348, 200]);

        pressKey(sash, "Home", {type: "keyup"});
        await nextTick();
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({
            source: "keyboard",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizesPx: [150, 348, 200],
        });
    });

    it("分隔线失焦结束键盘手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;

        pressKey(sash, "ArrowRight");
        sash.dispatchEvent(new FocusEvent("blur"));
        await nextTick();

        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({sizesPx: [210, 288, 200]});
    });

    it("Escape 取消进行中的手势，几何回到基线且不提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;

        pressKey(sash, "ArrowRight");
        await nextTick();
        expect(panelSizes(wrapper)).toEqual([210, 288, 200]);

        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await nextTick();

        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]).toEqual({
            source: "keyboard",
            sash: "outline~editor",
            reason: "escape",
        });
    });

    it("Enter 折叠一次：重复 keydown 不重复切换，DOM 与提交一致", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;

        pressKey(sash, "Enter");
        pressKey(sash, "Enter");
        pressKey(sash, "Enter");
        await nextTick();

        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);
        expect(panelSizes(wrapper)).toEqual([0, 498, 200]);

        pressKey(sash, "Enter", {type: "keyup"});
        await nextTick();

        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "keyboard",
            sash: "outline~editor",
            active: ["outline"],
            compensated: [],
            sizesPx: [0, 498, 200],
            collapsed: {outline: true},
        });
        expect(panelSizes(wrapper)).toEqual([0, 498, 200]);
    });

    it("拖动在 minimum − 24 处收起，回到 max(minimum, collapsedSize + 24) 后按指针位置展开", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        move(wrapper, 0, -150);
        await nextFrame();
        expect(wrapper.emitted("gesture-update")?.at(-1)?.[0]).toMatchObject({sizesPx: [0, 498, 200], collapsed: {outline: true}});

        // 阈值内不抖动：向外 60px 只到 140（自己的 minimum 是 150），仍是收起
        move(wrapper, 0, -60);
        await nextFrame();
        expect(panelSizes(wrapper)).toEqual([0, 498, 200]);

        // 到 minimum 的当帧就按指针位置展开：150，不是记忆的 180，也不是按下时的 200
        move(wrapper, 0, -50);
        await nextFrame();
        expect(wrapper.emitted("gesture-update")?.at(-1)?.[0]).toMatchObject({
            active: ["outline", "editor"],
            sizesPx: [150, 348, 200],
            collapsed: {},
        });
        expect(panelSizes(wrapper)).toEqual([150, 348, 200]);

        // 展开后继续拖动保持绝对跟随：位移始终从按下基线起算
        move(wrapper, 0, -45);
        await nextFrame();
        release(wrapper, 0, -45);
        await nextTick();
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizesPx: [155, 343, 200],
            collapsed: {},
        });
        expect(panelSizes(wrapper)).toEqual([155, 343, 200]);
    });

    it("收起后过冲再回到同一指针位置：DOM 与提交都不留永久偏移", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        move(wrapper, 0, -260);
        await nextFrame();
        expect(panelSizes(wrapper)).toEqual([0, 498, 200]);

        move(wrapper, 0, -50);
        await nextFrame();
        expect(panelSizes(wrapper)).toEqual([150, 348, 200]);

        release(wrapper, 0, -50);
        await nextTick();
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({sizesPx: [150, 348, 200], collapsed: {}});
        expect(panelSizes(wrapper)).toEqual([150, 348, 200]);
    });

    it("禁用时指针与键盘都不产生事件或改变布局", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS, {disabled: true});
        await nextTick();
        stubSashRects(wrapper);
        const layouts = wrapper.emitted("layout")?.length ?? 0;
        const before = panelSizes(wrapper);

        await dragSash(wrapper, 0, 50);
        pressKey(sashElements(wrapper)[0]!, "ArrowRight");
        pressKey(sashElements(wrapper)[0]!, "Enter");

        for (const name of GESTURE_EVENTS) expect(wrapper.emitted(name), name).toBeUndefined();
        expect(wrapper.emitted("layout")?.length ?? 0).toBe(layouts);
        expect(panelSizes(wrapper)).toEqual(before);
    });

    it("方向与面板身份变化取消进行中的手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        pressKey(sashElements(wrapper)[0]!, "ArrowRight");
        await wrapper.setProps({direction: "vertical"});
        await nextTick();

        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toEqual({
            source: "keyboard",
            sash: "outline~editor",
            reason: "context-changed",
        });
        expect(wrapper.emitted("gesture-end")).toBeUndefined();

        const next = mountSplitter(FREE_PANELS);
        await nextTick();
        pressKey(sashElements(next)[0]!, "ArrowRight");
        await next.setProps({panels: [{id: "manuscript", defaultSizePx: 200, sizing: "fixed"}, ...FREE_PANELS.slice(1)]});
        await nextTick();

        expect(next.emitted("gesture-end")).toBeUndefined();
        expect(next.emitted("gesture-cancel")?.at(-1)?.[0]).toMatchObject({sash: "outline~editor", reason: "context-changed"});
    });

    it("等值 panels 重建不中断指针手势，真实约束变化取消", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);

        press(wrapper, 0);
        move(wrapper, 0, 20);
        await nextFrame();
        await wrapper.setProps({panels: FREE_PANELS.map((panel) => ({...panel}))});
        await nextTick();
        move(wrapper, 0, 40);
        await nextFrame();
        release(wrapper, 0, 40);
        await nextTick();

        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({sizesPx: [240, 258, 200]});

        pressKey(sashElements(wrapper)[0]!, "ArrowRight");
        await wrapper.setProps({panels: [FREE_PANELS[0]!, {...FREE_PANELS[1]!, maxSizePx: 250}, FREE_PANELS[2]!]});
        await nextTick();

        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]).toMatchObject({reason: "context-changed"});
        expect(panelSizes(wrapper)).toEqual([200, 250, 200]);
    });

    it("等值 sashSizes 重建不中断手势，真实几何变化取消", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {sashSizes: [7, 1]});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;

        pressKey(sash, "ArrowRight");
        await wrapper.setProps({sashSizes: [7, 1]});
        await nextTick();
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();

        await wrapper.setProps({sashSizes: [8, 1]});
        await nextTick();
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({reason: "context-changed"});
    });

    it("按边界应用 sash 像素，零值边界退出交互与命中", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {sashSizes: [7, 0]});
        await nextTick();
        const [first, second] = sashElements(wrapper);
        const before = panelSizes(wrapper);

        expect(first?.style.width).toBe("7px");
        expect(first?.style.flexBasis).toBe("7px");
        expect(first?.getAttribute("tabindex")).toBe("0");
        expect(second?.style.width).toBe("0px");
        expect(second?.style.flexBasis).toBe("0px");
        expect(second?.getAttribute("tabindex")).toBe("-1");
        expect(second?.getAttribute("aria-disabled")).toBe("true");
        expect(second?.hasAttribute("data-disabled")).toBe(true);
        expect(second?.classList.contains("pointer-events-none")).toBe(true);
        // 零值边界连静止接缝都不渲染：不可见的接缝不该画出一条线
        expect(second?.querySelector(".sash-seam")).toBeNull();
        expect(second?.querySelector(".sash-line")).toBeNull();
        expect(first?.querySelector(".sash-seam")).not.toBeNull();

        // 零值边界既不可 Tab 聚焦，也不参与指针命中
        stubRect(second!, {left: 400, top: 0, right: 400, bottom: 300});
        press(wrapper, 1, 400);
        release(wrapper, 1);
        await nextTick();

        expect(wrapper.emitted("gesture-start")).toBeUndefined();
        expect(panelSizes(wrapper)).toEqual(before);
    });

    it("垂直方向使用高度，非法 sashSizes 明确诊断并回退到 1px", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const wrapper = mountSplitter(FREE_PANELS, {
            direction: "vertical",
            sashSizes: [Number.NaN, -2, 9],
        });
        await nextTick();

        expect(panelSizes(wrapper, "height")).toEqual(FREE_SIZES);
        expect(panelSizes(wrapper, "width")).toEqual([Number.NaN, Number.NaN, Number.NaN]);
        const [first, second] = sashElements(wrapper);
        expect(first?.style.height).toBe("1px");
        expect(second?.style.height).toBe("1px");
        expect(first?.getAttribute("aria-orientation")).toBe("horizontal");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("sashSizes[0]"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("sashSizes[1]"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("extra entries are ignored"));
    });

    it("同页实例的 DOM id 与 aria-controls 唯一，手势仍使用宿主语义 id", async () => {
        const Twin = defineComponent({
            render: () => h("div", [h(Splitter, {panels: FREE_PANELS}), h(Splitter, {panels: FREE_PANELS})]),
        });
        const wrapper = mountTemplate(Twin);
        await nextTick();
        const ids = panelElements(wrapper).map((panel) => panel.id);
        expect(new Set(ids).size).toBe(ids.length);
        const controls = wrapper.findAll("[role=separator]").map((sash) => sash.attributes("aria-controls"));
        expect(new Set(controls).size).toBe(controls.length);
        expect(wrapper.findAll("[data-sash]").map((sash) => sash.attributes("data-sash"))).toEqual([
            "panels:0", "panels:1", "panels:0", "panels:1",
        ]);

        const first = wrapper.findAllComponents(Splitter)[0]!;
        const sash = first.findAll("[data-sash]")[0]!.element as HTMLElement;
        pressKey(sash, "ArrowRight");
        pressKey(sash, "ArrowRight", {type: "keyup"});
        await nextTick();

        expect(first.emitted("gesture-end")?.[0]?.[0]).toMatchObject({sash: "outline~editor", sizesPx: [210, 288, 200]});
    });

    it("同页多个与嵌套的 Splitter 互不串手势", async () => {
        const Twin = defineComponent({
            render() {
                return h("div", [
                    h(Splitter, {panels: FREE_PANELS}),
                    h(Splitter, {panels: FREE_PANELS}, {
                        "panel-outline": () => h(Splitter, {panels: FREE_PANELS}),
                    }),
                ]);
            },
        });
        const wrapper = mountTemplate(Twin);
        await nextTick();
        const splitters = wrapper.findAllComponents(Splitter);
        const inner = splitters.at(-1)!;
        const innerSash = inner.findAll("[data-sash]")[0]!.element as HTMLElement;

        pressKey(innerSash, "ArrowRight");
        pressKey(innerSash, "ArrowRight", {type: "keyup"});
        await nextTick();

        expect(inner.emitted("gesture-end")).toHaveLength(1);
        expect(splitters[0]!.emitted("gesture-end")).toBeUndefined();
        expect(splitters[0]!.emitted("gesture-start")).toBeUndefined();
    });
});

describe("splitter 程序发布尺寸", () => {
    it("发布尺寸立即改变呈现，且不是用户提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {sizesPx: [300, 300, 100]});
        await nextTick();

        expect(panelSizes(wrapper)).toEqual([300, 300, 100]);
        expect(wrapper.emitted("layout")).toBeUndefined();
        for (const event of GESTURE_EVENTS) expect(wrapper.emitted(event), event).toBeUndefined();
    });

    it("等值发布不重放，也不重挂面板", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {sizesPx: FREE_SIZES});
        await nextTick();
        const panels = panelElements(wrapper);

        await wrapper.setProps({sizesPx: [...FREE_SIZES]});
        await nextTick();

        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
        expect(panelElements(wrapper)).toEqual(panels);
        expect(wrapper.emitted("layout")).toBeUndefined();
        for (const event of GESTURE_EVENTS) expect(wrapper.emitted(event), event).toBeUndefined();
    });

    it("受控呈现以发布值为准，组件不自行夹取约束", async () => {
        const wrapper = mountSplitter(CONSTRAINED_PANELS, {sizesPx: [2, 30, 68]});
        await nextTick();

        expect(panelSizes(wrapper)).toEqual([2, 30, 68]);
        const [firstSash] = sashElements(wrapper);
        // 约束只作为可访问性范围发布，单位是 px：min 来自声明，now 来自当前呈现
        expect(firstSash?.getAttribute("aria-valuemin")).toBe("150");
        expect(firstSash?.getAttribute("aria-valuenow")).toBe("2");
        expect(firstSash?.getAttribute("aria-valuetext")).toBe("2 像素");
    });

    it("发布的收起状态与呈现、可访问性一致", async () => {
        const panels: SplitterPanelConfig[] = [
            {
                id: "outline",
                defaultSizePx: 200,
                minSizePx: 150,
                sizing: "fixed",
                collapse: {collapsedSize: 0, restoreSize: 180, collapseThreshold: 24, expandThreshold: 24, collapsed: true},
            },
            {id: "editor", defaultSizePx: 300},
            {id: "inspector", defaultSizePx: 200, sizing: "fixed"},
        ];
        const wrapper = mountSplitter(panels, {sizesPx: [0, 498, 200]});
        await nextTick();

        const [outline] = panelElements(wrapper);
        expect(outline?.getAttribute("data-state")).toBe("collapsed");
        expect(panelSizes(wrapper)).toEqual([0, 498, 200]);
        const [firstSash] = sashElements(wrapper);
        expect(firstSash?.getAttribute("aria-valuetext")).toBe("已收起");
        expect(firstSash?.getAttribute("aria-valuenow")).toBe("0");
    });

    it("程序发布尺寸不重挂叶内容", async () => {
        const mounts: string[] = [];
        const Leaf = defineComponent({
            props: {label: {type: String, required: true}},
            setup(props) {
                onMounted(() => mounts.push(props.label));
                return () => h("div", {class: "leaf-marker"}, props.label);
            },
        });
        const Host = defineComponent({
            props: {sizes: {type: Array as () => readonly number[], default: undefined}},
            setup(props) {
                return () => h(Splitter, {panels: FREE_PANELS, sizesPx: props.sizes}, {
                    "panel-outline": () => h(Leaf, {label: "outline"}),
                    "panel-editor": () => h(Leaf, {label: "editor"}),
                    "panel-inspector": () => h(Leaf, {label: "inspector"}),
                });
            },
        });
        const wrapper = mountTemplate(Host, {sizes: FREE_SIZES});
        await nextTick();
        const before = wrapper.findAll(".leaf-marker").map((node) => node.element);

        await wrapper.setProps({sizes: [300, 200, 200]});
        await nextTick();
        await nextTick();

        expect(mounts).toEqual(["outline", "editor", "inspector"]);
        expect(wrapper.findAll(".leaf-marker").map((node) => node.element)).toEqual(before);
        expect(panelSizes(wrapper.findComponent(Splitter))).toEqual([300, 200, 200]);
    });
});

/** 设备像素对齐在渲染后的一帧里结算：改 dpr 后触发一次窗口 resize 即可重算。 */
async function settleSnap(): Promise<void> {
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
}

/**
 * 装饰带的纯几何：厚度固定目标 3px，落位被前后相邻的当前呈现夹住。
 * 「收起边界上被裁细」的旧行为是起点越出了可用范围，这里把可用范围钉成硬边界。
 */
describe("装饰带的可用范围与对齐位移", () => {
    it("1px 接缝两侧有空间时居中且厚度 3px，7px 接缝也不会把装饰一起变粗", () => {
        expect(sashBandBox({sashPx: 1, beforePx: 200, afterPx: 298})).toEqual({startPx: -1, thicknessPx: 3});
        expect(sashBandBox({sashPx: 7, beforePx: 200, afterPx: 298})).toEqual({startPx: 2, thicknessPx: 3});
    });

    it("收起边界（前邻 0px）向内贴边，厚度仍是完整 3px", () => {
        // 旧行为到这里仍是 start=-1：那 1px 落在分隔盒之外，被祖先的 overflow-hidden 裁成 2px
        expect(sashBandBox({sashPx: 1, beforePx: 0, afterPx: 498})).toEqual({startPx: 0, thicknessPx: 3});
    });

    it("后邻 0px 时同样贴边，起点不再越过已收起的一侧", () => {
        expect(sashBandBox({sashPx: 1, beforePx: 200, afterPx: 0})).toEqual({startPx: -2, thicknessPx: 3});
    });

    it("两侧都没有空间时厚度退回可用空间，最多是接缝本身", () => {
        expect(sashBandBox({sashPx: 1, beforePx: 0, afterPx: 0})).toEqual({startPx: 0, thicknessPx: 1});
        expect(sashBandBox({sashPx: 1, beforePx: 0, afterPx: 1})).toEqual({startPx: 0, thicknessPx: 2});
        expect(sashBandBox({sashPx: 7, beforePx: 0, afterPx: 0})).toEqual({startPx: 2, thicknessPx: 3});
    });

    it("对齐位移先加、再夹：可用范围优先于设备像素网格", () => {
        expect(sashBandBox({sashPx: 1, beforePx: 200, afterPx: 298, alignmentDeltaPx: 0.1}))
            .toEqual({startPx: -0.9, thicknessPx: 3});
        expect(sashBandBox({sashPx: 1, beforePx: 0, afterPx: 498, alignmentDeltaPx: -0.4}))
            .toEqual({startPx: 0, thicknessPx: 3});
    });

    it("非法输入不画线", () => {
        expect(sashBandBox({sashPx: 0, beforePx: 200, afterPx: 200})).toBeNull();
        expect(sashBandBox({sashPx: Number.NaN, beforePx: 200, afterPx: 200})).toBeNull();
        expect(sashBandBox({sashPx: 1, beforePx: -1, afterPx: 200})).toBeNull();
        expect(sashBandBox({sashPx: 1, beforePx: 200, afterPx: Number.POSITIVE_INFINITY})).toBeNull();
        expect(sashBandBox({sashPx: 1, beforePx: 200, afterPx: 200, alignmentDeltaPx: Number.NaN})).toBeNull();
    });
});

describe("分界线像素对齐", () => {
    it("半像素上的接缝只移动装饰带，不移动命中盒", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const line = lineElement(sash);

        stubRect(sash, {left: 400.4, top: 0, right: 401.4, bottom: 300});
        await settleSnap();

        // 装饰带中心 400.9 → 设备像素网格 401：起点 -1（居中）+ 0.1（对齐），厚度仍是 3
        expect(line.style.width).toBe("3px");
        expect(Number.parseFloat(line.style.left)).toBeCloseTo(-0.9);
        // 交叉轴铺满分隔盒，不再靠负 inset 外扩
        expect(line.style.top).toBe("0px");
        expect(line.style.bottom).toBe("0px");
        // 接缝自己不动：模型里仍是 1px，命中盒也仍在 400.4
        expect(sash.style.transform).toBe("");
        expect(sash.style.width).toBe("1px");
        expect(sash.getBoundingClientRect().left).toBe(400.4);

        // 再次结算不回跳：400.9 已经落在整像素边界上
        await settleSnap();
        expect(Number.parseFloat(line.style.left)).toBeCloseTo(-0.9);
    });

    it("dpr 1.25 上装饰带吸到设备像素网格，命中仍按逻辑盒", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[1]!;
        const line = lineElement(sash);

        Object.defineProperty(window, "devicePixelRatio", {value: 1.25, configurable: true});
        stubRect(sash, {left: 600.2, top: 0, right: 601.2, bottom: 300});
        await settleSnap();

        // 中心 600.7 × 1.25 = 750.875 → 751 → 600.8：装饰带起点 -1 + 0.1
        expect(Number.parseFloat(line.style.left)).toBeCloseTo(-0.9);
        expect(line.style.width).toBe("3px");
        expect(sash.style.transform).toBe("");
        expect(sash.style.width).toBe("1px");

        // 装饰带的位移没有把命中带一起挪走：逻辑盒内的按下仍命中同一条分隔线
        press(wrapper, 1, 600.5);
        expect(wrapper.emitted("gesture-start")?.[0]?.[0]).toMatchObject({sash: "editor~inspector"});
    });

    it("7px 接缝的装饰仍是 3px 并留在接缝内，接缝自身不动", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {sashSizes: [7, 1]});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const line = lineElement(sash);

        stubRect(sash, {left: 200, top: 0, right: 207, bottom: 300});
        await settleSnap();

        // 旧行为是线盒 + 两侧各 1px 外扩 = 9px：装饰厚度不该跟着 sashSize 变
        expect(line.style.width).toBe("3px");
        const start = Number.parseFloat(line.style.left);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start + 3).toBeLessThanOrEqual(7);
        expect(sash.style.width).toBe("7px");
    });

    it("收起边界上装饰带向内贴边，不落在分隔盒之外被裁细", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS, {sizesPx: [0, 498, 200]});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const line = lineElement(sash);

        // 中心 320.9 想吸到整像素 321（位移 +0.1），但前邻是 0px：起点只能从分隔盒起点开始
        stubRect(sash, {left: 320.4, top: 0, right: 321.4, bottom: 300});
        await settleSnap();

        expect(Number.parseFloat(line.style.left)).toBe(0);
        expect(line.style.width).toBe("3px");
        // 完整落在盒内：起点 + 厚度不超出接缝与后邻组成的可用范围
        expect(Number.parseFloat(line.style.left) + Number.parseFloat(line.style.width)).toBeLessThanOrEqual(1 + 498);
    });

    it("呈现尺寸变化后自己重排：前邻展开，装饰带回到居中位置", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS, {sizesPx: [0, 498, 200]});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const line = lineElement(sash);

        stubRect(sash, {left: 320.4, top: 0, right: 321.4, bottom: 300});
        await settleSnap();
        expect(Number.parseFloat(line.style.left)).toBe(0);

        // 不派发 resize：只发布新尺寸，可用范围变化本身就要触发重排
        await wrapper.setProps({sizesPx: [180, 318, 200]});
        await nextTick();
        await nextFrame();

        expect(Number.parseFloat(line.style.left)).toBeCloseTo(-0.9);
        expect(line.style.width).toBe("3px");
    });

    it("垂直方向装饰带写 top/height，交叉轴仍铺满分隔盒", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {direction: "vertical"});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const line = lineElement(sash);

        stubRect(sash, {left: 0, top: 100.4, right: 700, bottom: 101.4});
        await settleSnap();

        expect(line.style.height).toBe("3px");
        expect(Number.parseFloat(line.style.top)).toBeCloseTo(-0.9);
        expect(line.style.left).toBe("0px");
        expect(line.style.right).toBe("0px");
        expect(line.style.width).toBe("");
    });
});

describe("静止接缝（常驻的 1px 分界线）", () => {
    it("接缝画在自己的盒上，不改命中盒、面板分配与自己的布局", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;

        stubRect(sash, {left: 400, top: 0, right: 401, bottom: 300});
        await settleSnap();

        // 线盒 [400, 401] 本来就落在整像素边界上：接缝原地不动，厚度 1px
        expect(seam.style.left).toBe("0px");
        expect(seam.style.width).toBe("1px");
        // 交叉轴铺满分隔盒
        expect(seam.style.top).toBe("0px");
        expect(seam.style.bottom).toBe("0px");
        // 装饰层是绝对定位的裸元素：接缝自身的布局盒、命中盒与面板分配都不受影响
        expect(sash.style.width).toBe("1px");
        expect(sash.style.transform).toBe("");
        expect(panelSizes(wrapper)).toEqual(FREE_SIZES);
    });

    it("半像素上的接缝吸到近端边的设备像素，装饰带仍走中心对齐那一套", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;
        const line = lineElement(sash);

        stubRect(sash, {left: 400.4, top: 0, right: 401.4, bottom: 300});
        await settleSnap();

        // 中心 400.9 上的 1px 线要边缘落在整像素上才是实的：400.9 − 0.5 取整 = 400
        expect(Number.parseFloat(seam.style.left)).toBeCloseTo(-0.4);
        expect(400.4 + Number.parseFloat(seam.style.left)).toBeCloseTo(400);
        expect(seam.style.width).toBe("1px");
        // 3px 装饰带看中心：中心 400.9 → 设备像素 401，起点 −1 + 0.1（两套对齐互不干扰）
        expect(Number.parseFloat(line.style.left)).toBeCloseTo(-0.9);
        expect(line.style.width).toBe("3px");
    });

    it("缩放容器的静止接缝仍以本地 1px 厚度对齐近端边", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;
        stubRect(sash, {left: 400.2, top: 0, right: 402.2, bottom: 600});
        await settleSnap();
        // 视口近端边吸到整像素：400.2 + (-0.1 × 2) = 400；缺 /scale 会得到 -0.2。
        expect(Number.parseFloat(seam.style.left)).toBeCloseTo(-0.1);
        expect(400.2 + Number.parseFloat(seam.style.left) * 2).toBeCloseTo(400);
        expect(seam.style.width).toBe("1px");
    });

    it("dpr 1.25 上近端边落在设备像素边界上，厚度仍是 CSS px 的 1", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const sash = sashElements(wrapper)[1]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;

        Object.defineProperty(window, "devicePixelRatio", {value: 1.25, configurable: true});
        stubRect(sash, {left: 600.2, top: 0, right: 601.2, bottom: 300});
        await settleSnap();

        // 中心 600.7 × 1.25 = 750.875，减半个设备像素后取整 = 750 → 视口 600
        expect(Number.parseFloat(seam.style.left)).toBeCloseTo(-0.2);
        expect((600.2 + Number.parseFloat(seam.style.left)) * 1.25).toBeCloseTo(750);
        // 主题里每条边框都是 1 CSS px：接缝不按设备像素换厚度（1.25 上不会缩成 0.8）
        expect(seam.style.width).toBe("1px");
    });

    it("7px 接缝里接缝居中且仍是 1px，不跟着接缝一起变粗", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {sashSizes: [7, 1]});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;

        stubRect(sash, {left: 200, top: 0, right: 207, bottom: 300});
        await settleSnap();

        expect(seam.style.width).toBe("1px");
        expect(Number.parseFloat(seam.style.left)).toBeCloseTo(3);
        // 完整落在接缝盒内，两侧各留 3px：它标记的是中心边界，不填满整个接缝
        expect(Number.parseFloat(seam.style.left) + Number.parseFloat(seam.style.width)).toBeLessThanOrEqual(7);
        expect(Number.parseFloat(seam.style.left)).toBeGreaterThan(0);
    });

    it("相邻面板收起时接缝仍标在边界上，贴边的是装饰带不是接缝", async () => {
        const wrapper = mountSplitter(COLLAPSIBLE_PANELS, {sizesPx: [0, 498, 200]});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;
        const line = lineElement(sash);

        stubRect(sash, {left: 320.4, top: 0, right: 321.4, bottom: 300});
        await settleSnap();

        // 接缝只认自己的盒：前邻 0px 也不把它推离边界（近端边仍吸到 320）
        expect(Number.parseFloat(seam.style.left)).toBeCloseTo(-0.4);
        // 装饰带被可用范围夹到盒起点，才不会越出分隔盒被祖先裁细
        expect(Number.parseFloat(line.style.left)).toBe(0);
    });

    it("垂直方向写 top/height，交叉轴铺满分隔盒", async () => {
        const wrapper = mountSplitter(FREE_PANELS, {direction: "vertical"});
        await nextTick();
        const sash = sashElements(wrapper)[0]!;
        const seam = sash.querySelector<HTMLElement>(".sash-seam")!;

        stubRect(sash, {left: 0, top: 100.4, right: 700, bottom: 101.4});
        await settleSnap();

        expect(seam.style.height).toBe("1px");
        expect(Number.parseFloat(seam.style.top)).toBeCloseTo(-0.4);
        expect(seam.style.left).toBe("0px");
        expect(seam.style.right).toBe("0px");
        expect(seam.style.width).toBe("");
    });
});

describe("悬停显现与光标所有权", () => {
    it("命中先给光标，停留满 250ms 才显示线，离开即淡出并放开光标", async () => {
        vi.useFakeTimers();
        try {
            const wrapper = mountSplitter(FREE_PANELS);
            await nextTick();
            stubSashRects(wrapper);
            const sash = sashElements(wrapper)[0]!;

            rootElement(wrapper).dispatchEvent(pointer("pointermove", SASH_CENTER(0), 150));
            await nextTick();

            expect(sash.getAttribute("data-sash-hover")).toBe("true");
            expect(sash.getAttribute("data-sash-revealed")).toBeNull();
            // 装饰带常驻且状态不写进 DOM 样式：显隐由 scoped CSS 按上面这些状态属性选择
            expect(lineElement(sash).style.opacity).toBe("");
            expect(document.documentElement.getAttribute("data-nb-sash-cursor")).toBe("ew-resize");

            await vi.advanceTimersByTimeAsync(SASH_HOVER_DELAY_MS);
            await nextTick();
            expect(sash.getAttribute("data-sash-revealed")).toBe("true");

            sash.dispatchEvent(pointer("pointerleave", SASH_CENTER(0), 150));
            await nextTick();
            expect(sash.getAttribute("data-sash-hover")).toBeNull();
            expect(sash.getAttribute("data-sash-revealed")).toBeNull();
            expect(document.documentElement.getAttribute("data-nb-sash-cursor")).toBeNull();
            expect(document.querySelector("[data-nb-sash-cursor-styles]")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("未满停留时长就按下：立即全亮成 active，松手后仍悬停则保持显示", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);
        const sash = sashElements(wrapper)[0]!;

        press(wrapper, 0);
        await nextTick();
        expect(sash.getAttribute("data-sash-active")).toBe("true");
        expect(sash.getAttribute("data-sash-revealed")).toBe("true");

        release(wrapper, 0);
        await nextTick();
        expect(sash.getAttribute("data-sash-active")).toBeNull();
        // 松手时指针仍在线盒上：不重新等待停留时长
        expect(sash.getAttribute("data-sash-revealed")).toBe("true");
    });

    it("别的按下手势（拖 View / 选文本）经过热区不点灯、不改光标", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubSashRects(wrapper);
        const sash = sashElements(wrapper)[0]!;

        rootElement(wrapper).dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: SASH_CENTER(0),
            clientY: 150,
            button: -1,
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
        }));
        await nextTick();

        expect(sash.getAttribute("data-sash-hover")).toBeNull();
        expect(sash.getAttribute("data-sash-revealed")).toBeNull();
        expect(document.documentElement.getAttribute("data-nb-sash-cursor")).toBeNull();
    });
});

/** 会话层：显式折叠/恢复、Home/End 与 finish 的收口规则（不经过 DOM）。 */
describe("Splitter 会话的显式折叠与提交", () => {
    function collapsibleSession(): SplitterGestureSession {
        const baseline = [200, 298, 200];
        const panels = sashPanelsOfConfig(COLLAPSIBLE_PANELS, baseline);
        return createSplitterSession({
            sessionId: "session-1",
            contextKey: "outline",
            source: "pointer",
            revision: 3,
            branchId: "outline",
            axis: "width",
            ids: panels.map((panel) => panel.id),
            panels,
            baselinePx: baseline,
            sashIndex: 0,
            extent: {width: 700, height: 0},
        });
    }

    it("显式恢复用记忆尺寸，finish 提交恢复结果而不是最后一次指针位移", () => {
        const session = collapsibleSession();
        expect(session.update({x: -150, y: 0})).toMatchObject({sizesPx: [0, 498, 200], collapsed: {outline: true}});

        // Enter 显式恢复：记忆尺寸 180，而不是指针位置 50
        expect(session.toggleCollapsed()).toMatchObject({sizesPx: [180, 318, 200], collapsed: {outline: false}});

        const commit = session.finish();
        // 若按最后一次位移重解，outline 会再次收起到 0
        expect(commit?.changes[0]).toMatchObject({target: {outline: 180, editor: 318}, collapsed: {outline: false}});
    });

    it("Home / End 从线的当前位置换算绝对位移，不落在最后一段位移上重解", () => {
        const session = collapsibleSession();
        session.update({x: 40, y: 0});
        // 线现在在 +40，到可行起点的相对位移是 −90：绝对位移 −50 落在自己的 minimum 150 上。
        expect(session.jump("start")).toMatchObject({sizesPx: [150, 348, 200]});
        expect(session.finish()?.changes[0]).toMatchObject({target: {outline: 150, editor: 348}});
    });

    it("没有真实变化的手势 finish 返回 null，不产生收起写入", () => {
        const session = collapsibleSession();
        expect(session.update({x: -50, y: 0})).toMatchObject({sizesPx: [150, 348, 200]});
        // 回到按下基线：净变化为零，会话按合同不再发布预览（宿主据此回到基线几何）
        expect(session.update({x: 0, y: 0})).toBeNull();
        expect(session.finish()).toBeNull();
        // 收起覆盖没有因为这次往返留下任何写入
        expect(session.state).toBeNull();
    });

    it("取消之后会话不再接受输入，也不提交", () => {
        const session = collapsibleSession();
        session.update({x: -150, y: 0});
        session.cancel("escape");
        expect(session.reason).toBe("escape");
        expect(session.update({x: -150, y: 0})).toBeNull();
        expect(session.finish()).toBeNull();
    });
});
