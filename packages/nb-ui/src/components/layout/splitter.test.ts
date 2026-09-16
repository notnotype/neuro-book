import {afterEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, type Component} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";

/**
 * 真实 Splitter + Reka 的行为用例。
 *
 * happy-dom 没有布局引擎（`getBoundingClientRect` 全为 0，Reka 的指针 delta 会算成 0/0）；
 * 指针拖拽里只给 Reka 真正读到的元素注入矩形，命中判定、delta 与布局分配仍走 Reka 的真实实现。
 * 键盘调整不依赖测量（delta 来自 keyboardResizeBy），直接跑真实路径；
 * 真实指针几何与浏览器事件由 e2e/splitter.spec.ts 补齐。
 */

const GROUP_WIDTH = 1000;
/** 第 i 条 sash 的命中位置：400、600 */
const SASH_LEFT = (index: number): number => 400 + index * 200;

/** 受限三栏：editor 的 minSize 30 会让 sash 0 的收缩空间推到 inspector */
const CONSTRAINED_PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28, minSize: 18, maxSize: 45},
    {id: "editor", defaultSize: 30, minSize: 30},
    {id: "inspector", defaultSize: 42, minSize: 15},
];

/** 不受限三栏：用于观察连发的每次尺寸变化 */
const FREE_PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28},
    {id: "editor", defaultSize: 52},
    {id: "inspector", defaultSize: 20},
];

const GESTURE_EVENTS = ["gesture-start", "gesture-update", "gesture-end", "gesture-cancel"] as const;

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

function rect(left: number, width: number): DOMRect {
    return {
        x: left,
        y: 0,
        top: 0,
        left,
        right: left + width,
        bottom: 600,
        width,
        height: 600,
        toJSON: () => ({}),
    } as DOMRect;
}

/** 挂载点必须在文档内：Reka 把指针监听挂在 body 与 window 上，事件要走真实冒泡链 */
function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

function mountSplitter(panels: SplitterPanelConfig[] = CONSTRAINED_PANELS, disabled = false): VueWrapper {
    const wrapper = mount(Splitter, {attachTo: attachContainer(), props: {panels, disabled}});
    wrappers.push(wrapper);
    return wrapper;
}

function mountTemplate(component: Component): VueWrapper {
    const wrapper = mount(component, {attachTo: attachContainer()});
    wrappers.push(wrapper);
    return wrapper;
}

function handles(wrapper: VueWrapper): HTMLElement[] {
    return wrapper.findAll("[data-panel-resize-handle-id]").map((handle) => handle.element as HTMLElement);
}

function lastLayout(wrapper: VueWrapper): number[] {
    return wrapper.emitted("layout")?.at(-1)?.[0] as number[];
}
function panelSizes(wrapper: VueWrapper): number[] {
    return wrapper.findAll("[data-panel]").map((panel) => Number(panel.attributes("data-panel-size")));
}

/** 只替代测量：组宽 1000px、每条 sash 1px 宽且互不重叠，其余元素为零矩形 */
function stubLayoutMetrics(wrapper: VueWrapper): void {
    const metrics = new Map<Element, DOMRect>();
    metrics.set(wrapper.find("[data-panel-group]").element, rect(0, GROUP_WIDTH));
    handles(wrapper).forEach((sash, index) => metrics.set(sash, rect(SASH_LEFT(index), 1)));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        return metrics.get(this) ?? rect(0, 0);
    });
}

async function dragSash(wrapper: VueWrapper, index: number, deltaX: number): Promise<void> {
    const startX = SASH_LEFT(index);
    handles(wrapper)[index]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
    document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + deltaX, clientY: 10}));
    window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX + deltaX, clientY: 10}));
    await nextTick();
}

async function pressAdjustKey(handle: HTMLElement, key: string, type: "keydown" | "keyup" = "keydown"): Promise<void> {
    handle.dispatchEvent(new KeyboardEvent(type, {key, bubbles: true, cancelable: true}));
    await nextTick();
}

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) {
        if (wrapper.exists()) wrapper.unmount();
    }
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

describe("splitter 手势边界", () => {
    it("程序挂载与约束变化只发 layout，不产生手势事件", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        expect(lastLayout(wrapper)).toEqual([28, 52, 20]);
        for (const name of GESTURE_EVENTS) expect(wrapper.emitted(name), name).toBeUndefined();

        // 宿主收紧 maxSize 属于程序布局：布局跟着约束变，但没有任何用户提交
        await wrapper.setProps({panels: [FREE_PANELS[0]!, {...FREE_PANELS[1]!, maxSize: 40}, FREE_PANELS[2]!]});
        await nextTick();

        const constrained = lastLayout(wrapper);
        expect(constrained[1]).toBeLessThanOrEqual(40);
        expect(constrained.reduce((total, size) => total + size, 0)).toBeCloseTo(100);
        for (const name of GESTURE_EVENTS) expect(wrapper.emitted(name), name).toBeUndefined();
    });

    it("一次指针拖动只提交一次最终意图，并按主动/补偿划分面板", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);

        await dragSash(wrapper, 0, 50);

        expect(wrapper.emitted("gesture-start")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: [],
            compensated: [],
            sizes: [28, 52, 20],
        });
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizes: [33, 47, 20],
        });
        expect(lastLayout(wrapper)).toEqual([33, 47, 20]);
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
    });

    it("相邻面板停在约束上时，吸收空间的更远面板记为兄弟补偿", async () => {
        const wrapper = mountSplitter(CONSTRAINED_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);

        await dragSash(wrapper, 0, 50);

        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            active: ["outline"],
            compensated: ["inspector"],
            sizes: [33, 30, 37],
        });
    });

    it("按下未移动即松开只产生 no-change 取消", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);

        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup", {clientX: startX, clientY: 10}));
        await nextTick();

        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            reason: "no-change",
        });
    });

    it("键盘连发跨多个 keydown 只结束一次，且普通导航键不开始手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const handle = handles(wrapper)[0]!;

        await pressAdjustKey(handle, "Tab");
        expect(wrapper.emitted("gesture-start")).toBeUndefined();

        await pressAdjustKey(handle, "ArrowRight");
        await pressAdjustKey(handle, "ArrowRight");
        await pressAdjustKey(handle, "ArrowRight");
        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
        expect(wrapper.emitted("gesture-update")).toHaveLength(3);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();

        await pressAdjustKey(handle, "ArrowRight", "keyup");
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toEqual({
            source: "keyboard",
            sash: "outline~editor",
            active: ["outline", "editor"],
            compensated: [],
            sizes: [58, 22, 20],
        });
    });

    it("手柄失焦结束键盘手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const handle = handles(wrapper)[0]!;

        await pressAdjustKey(handle, "ArrowRight");
        handle.dispatchEvent(new FocusEvent("blur"));
        await nextTick();

        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({sizes: [38, 42, 20]});
    });

    it("Escape 取消进行中的手势，不产生提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        await nextTick();

        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toEqual({
            source: "keyboard",
            sash: "outline~editor",
            reason: "escape",
        });
    });

    it("pointercancel 同时复位上游拖动状态，后续无按键移动无效且下一次拖动可用", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);

        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 50, clientY: 10}));
        window.dispatchEvent(new Event("pointercancel"));
        await nextTick();
        const layoutsAfterCancel = wrapper.emitted("layout")?.length ?? 0;

        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 100, clientY: 10}));
        expect(wrapper.emitted("layout")).toHaveLength(layoutsAfterCancel);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toEqual({
            source: "pointer",
            sash: "outline~editor",
            reason: "pointercancel",
        });

        await dragSash(wrapper, 0, 20);
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
    });

    it("touchcancel 取消手势而不产生提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);

        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));
        const touchCancel = new Event("touchcancel");
        Object.defineProperty(touchCancel, "touches", {value: []});
        window.dispatchEvent(touchCancel);
        await nextTick();

        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({reason: "pointercancel"});
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
    });

    it("手势中约束变化先取消，程序重排不进入用户提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);
        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));

        await wrapper.setProps({panels: [FREE_PANELS[0]!, {...FREE_PANELS[1]!, maxSize: 40}, FREE_PANELS[2]!]});
        await nextTick();
        window.dispatchEvent(new MouseEvent("mouseup"));

        expect(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]).toMatchObject({reason: "context-changed"});
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
    });

    it("等值 panels 重建不中断指针手势，真实约束变化仍取消", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);
        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));

        await wrapper.setProps({panels: FREE_PANELS.map((panel) => ({...panel}))});
        await nextTick();
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 40, clientY: 10}));
        window.dispatchEvent(new MouseEvent("mouseup"));
        await nextTick();

        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);

        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        await wrapper.setProps({panels: [FREE_PANELS[0]!, {...FREE_PANELS[1]!, maxSize: 40}, FREE_PANELS[2]!]});
        expect(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]).toMatchObject({reason: "context-changed"});
    });

    it("等值 sashSizes 重建不中断手势，真实几何变化取消", async () => {
        const wrapper = mount(Splitter, {
            attachTo: attachContainer(),
            props: {panels: FREE_PANELS, sashSizes: [7, 1]},
        });
        wrappers.push(wrapper);
        await nextTick();

        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        await wrapper.setProps({sashSizes: [7, 1]});
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();

        await wrapper.setProps({sashSizes: [8, 1]});
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({reason: "context-changed"});
        expect(wrapper.emitted("gesture-end")).toBeUndefined();
    });

    it("窗口失焦取消指针手势，下一次键盘调整独立提交", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        stubLayoutMetrics(wrapper);
        const startX = SASH_LEFT(0);
        handles(wrapper)[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: startX, clientY: 10}));
        document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: startX + 20, clientY: 10}));
        window.dispatchEvent(new Event("blur"));
        await nextTick();

        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight", "keyup");

        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({source: "pointer", reason: "blur"});
        expect(wrapper.emitted("gesture-end")?.[0]?.[0]).toMatchObject({source: "keyboard"});
    });

    it("按边界应用 sash 像素，零值边界退出交互、命中与 Tab 顺序", async () => {
        const wrapper = mount(Splitter, {
            attachTo: attachContainer(),
            props: {panels: FREE_PANELS, sashSizes: [7, 0]},
        });
        wrappers.push(wrapper);
        await nextTick();
        const [first, second] = handles(wrapper);
        const before = panelSizes(wrapper);
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;

        expect(first?.style.width).toBe("7px");
        expect(first?.style.flexBasis).toBe("7px");
        expect(first?.getAttribute("tabindex")).toBe("0");
        expect(second?.style.width).toBe("0px");
        expect(second?.style.flexBasis).toBe("0px");
        expect(second?.getAttribute("tabindex")).toBe("-1");
        expect(second?.hasAttribute("data-disabled")).toBe(true);
        expect(second?.classList.contains("pointer-events-none")).toBe(true);

        await pressAdjustKey(second!, "Enter");
        expect(panelSizes(wrapper)).toEqual(before);
        expect(wrapper.emitted("layout")).toHaveLength(layoutsBefore);
        expect(wrapper.emitted("gesture-start")).toBeUndefined();
    });

    it("垂直 sash 使用高度，非法尺寸明确诊断并回退到 1px", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const wrapper = mount(Splitter, {
            attachTo: attachContainer(),
            props: {direction: "vertical", panels: FREE_PANELS, sashSizes: [Number.NaN, -2, 9]},
        });
        wrappers.push(wrapper);
        await nextTick();
        const [first, second] = handles(wrapper);

        expect(first?.style.height).toBe("1px");
        expect(second?.style.height).toBe("1px");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("sashSizes[0]"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("sashSizes[1]"));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("extra entries are ignored"));
    });

    it("Enter repeat 通过公开 Panel API 只折叠一次，DOM、layout 与提交一致", async () => {
        const panels: SplitterPanelConfig[] = [
            {id: "outline", defaultSize: 28, minSize: 18, collapsible: true},
            {id: "editor", defaultSize: 52, minSize: 30},
            {id: "inspector", defaultSize: 20, minSize: 15},
        ];
        const wrapper = mountSplitter(panels);
        await nextTick();
        const layoutsBefore = wrapper.emitted("layout")?.length ?? 0;

        const handle = handles(wrapper)[0]!;
        await pressAdjustKey(handle, "Enter");
        await pressAdjustKey(handle, "Enter");
        await pressAdjustKey(handle, "Enter");
        await pressAdjustKey(handle, "Enter", "keyup");

        expect(wrapper.emitted("layout")).toHaveLength(layoutsBefore + 1);
        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
        const submitted = wrapper.emitted("gesture-end")?.[0]?.[0] as {sizes: number[]};
        expect(submitted).toMatchObject({
            source: "keyboard",
            sash: "outline~editor",
            active: ["outline", "editor"],
            sizes: [0, 80, 20],
        });
        expect(panelSizes(wrapper)).toEqual(submitted.sizes);
        expect(lastLayout(wrapper)).toEqual(submitted.sizes);
    });

    it("同页实例的 DOM id 与 aria-controls 唯一，手势仍使用宿主语义 id", async () => {
        const Twin = defineComponent({
            render: () => h("div", [h(Splitter, {panels: FREE_PANELS}), h(Splitter, {panels: FREE_PANELS})]),
        });
        const wrapper = mountTemplate(Twin);
        await nextTick();
        const ids = wrapper.findAll("[data-panel]").map((panel) => panel.attributes("id"));
        expect(new Set(ids).size).toBe(ids.length);
        expect(wrapper.findAll("[role=separator]").map((handle) => handle.attributes("aria-controls")))
            .toSatisfy((controls: string[]) => new Set(controls).size === controls.length);

        const first = wrapper.findAllComponents(Splitter)[0]!;
        await pressAdjustKey(handles(first)[0]!, "ArrowRight");
        await pressAdjustKey(handles(first)[0]!, "ArrowRight", "keyup");
        expect(first.emitted("gesture-end")?.[0]?.[0]).toMatchObject({sash: "outline~editor"});
    });

    it("方向与面板身份变化取消进行中的手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        await wrapper.setProps({direction: "vertical"});
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({reason: "context-changed"});

        const next = mountSplitter(FREE_PANELS);
        await nextTick();
        await pressAdjustKey(handles(next)[0]!, "ArrowRight");
        await next.setProps({panels: [{id: "manuscript", defaultSize: 28}, ...FREE_PANELS.slice(1)]});
        expect(next.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({sash: "outline~editor", reason: "context-changed"});
    });

    it("禁用时方向键与 Enter 均不产生事件或改变布局", async () => {
        const panels: SplitterPanelConfig[] = [
            {...FREE_PANELS[0]!, collapsible: true},
            FREE_PANELS[1]!,
            FREE_PANELS[2]!,
        ];
        const wrapper = mountSplitter(panels, true);
        await nextTick();
        stubLayoutMetrics(wrapper);
        const layouts = wrapper.emitted("layout")?.length ?? 0;
        const before = panelSizes(wrapper);

        await dragSash(wrapper, 0, 50);
        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        await pressAdjustKey(handles(wrapper)[0]!, "Enter");

        for (const name of GESTURE_EVENTS) expect(wrapper.emitted(name), name).toBeUndefined();
        expect(wrapper.emitted("layout")).toHaveLength(layouts);
        expect(panelSizes(wrapper)).toEqual(before);
    });

    it("卸载取消进行中的手势", async () => {
        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();

        await pressAdjustKey(handles(wrapper)[0]!, "ArrowRight");
        wrapper.unmount();

        expect(wrapper.emitted("gesture-end")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")?.[0]?.[0]).toMatchObject({reason: "unmount"});
    });

    it("手势结束后解绑临时全局监听", async () => {
        // components.md 档位 C：注册了全局监听就必须在结束或卸载时解绑，只有监听簿记能观察到这一点
        const documentAdd = vi.spyOn(document, "addEventListener");
        const documentRemove = vi.spyOn(document, "removeEventListener");
        const windowAdd = vi.spyOn(window, "addEventListener");
        const windowRemove = vi.spyOn(window, "removeEventListener");
        const count = (spy: {mock: {calls: unknown[][]}}, type: string): number =>
            spy.mock.calls.filter((call) => call[0] === type).length;

        const wrapper = mountSplitter(FREE_PANELS);
        await nextTick();
        const handle = handles(wrapper)[0]!;

        await pressAdjustKey(handle, "ArrowRight");
        expect(count(documentAdd, "keydown")).toBeGreaterThan(0);
        expect(count(windowAdd, "pointercancel")).toBeGreaterThan(0);
        const touchCancelListener = windowAdd.mock.calls.find((call) => call[0] === "touchcancel" && call[2] === true)?.[1];
        expect(touchCancelListener).toBeTypeOf("function");
        expect(count(windowAdd, "blur")).toBeGreaterThan(0);

        await pressAdjustKey(handle, "ArrowRight", "keyup");
        expect(count(documentRemove, "keydown")).toBe(count(documentAdd, "keydown"));
        expect(count(windowRemove, "pointercancel")).toBe(count(windowAdd, "pointercancel"));
        expect(windowRemove.mock.calls).toContainEqual(["touchcancel", touchCancelListener, true]);
        expect(count(windowRemove, "blur")).toBe(count(windowAdd, "blur"));

        // 卸载时不再有可解绑的监听
        const removals = count(documentRemove, "keydown");
        wrapper.unmount();
        expect(count(documentRemove, "keydown")).toBe(removals);
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

        await pressAdjustKey(handles(inner)[0]!, "ArrowRight");
        await pressAdjustKey(handles(inner)[0]!, "ArrowRight", "keyup");

        expect(inner.emitted("gesture-end")).toHaveLength(1);
        expect(splitters[0]!.emitted("gesture-end")).toBeUndefined();
        expect(splitters[0]!.emitted("gesture-start")).toBeUndefined();
    });
});
