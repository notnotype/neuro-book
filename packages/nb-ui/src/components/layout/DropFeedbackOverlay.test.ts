import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";
import DropFeedbackOverlay, {type DropFeedbackPreview} from "./DropFeedbackOverlay.vue";
import type {GridDropRect} from "./grid-drop";

/**
 * 共享覆盖层的合同：几何全部来自 `preview`（viewport 语义矩形），内缩只改绘制盒、不回写语义矩形；
 * 无效几何不伪造形状；提示药丸独立定位、独立测量、独立播报；覆盖层消失即解除观察。
 *
 * happy-dom 没有布局引擎（尺寸全 0），所以只桩掉 `offsetWidth/offsetHeight` 与 viewport；
 * 内缩、锚点、夹紧、观察器生命周期都是组件真实实现。真实可见性由 Lab 与浏览器验收。
 */

class ResizeObserverProbe {
    static instances: ResizeObserverProbe[] = [];
    readonly observed = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverProbe.instances.push(this);
    }
    observe(element: Element): void { this.observed.add(element); }
    unobserve(element: Element): void { this.observed.delete(element); }
    disconnect(): void { this.observed.clear(); }
    trigger(): void { this.callback([], this as unknown as ResizeObserver); }
}

const wrappers: VueWrapper[] = [];
const originalViewport = {width: window.innerWidth, height: window.innerHeight};
let viewport = {width: 320, height: 240};
let labelSize = {width: 120, height: 28};

const rect = (left: number, top: number, width: number, height: number): GridDropRect => ({left, top, right: left + width, bottom: top + height});

function preview(patch: Partial<DropFeedbackPreview>): DropFeedbackPreview {
    return {areaRect: null, entryRect: null, indicator: null, orientation: "vertical", ...patch};
}

/** happy-dom 的 innerWidth/innerHeight 是可写访问器；jsdom 不是，所以这里不做跨环境抽象。 */
function setViewport(width: number, height: number): void {
    viewport = {width, height};
    window.innerWidth = width;
    window.innerHeight = height;
}

async function render(value: DropFeedbackPreview | null, label = "移动视图", iconClass?: string, attrs: Record<string, string> = {}): Promise<VueWrapper> {
    const wrapper = mount(DropFeedbackOverlay, {attachTo: document.body, props: {preview: value, label, iconClass}, attrs});
    wrappers.push(wrapper);
    await nextTick();
    await nextTick();
    return wrapper;
}

function labelElement(): HTMLElement {
    const element = document.querySelector<HTMLElement>("[data-drop-feedback-label]");
    expect(element).not.toBeNull();
    return element!;
}

function labelPosition(): {left: number; top: number} {
    const element = labelElement();
    expect(element.style.visibility).not.toBe("hidden");
    return {left: Number.parseFloat(element.style.left), top: Number.parseFloat(element.style.top)};
}

function iconElement(): HTMLElement {
    const element = document.querySelector<HTMLElement>(".nb-ui-drop-indicator-label__icon");
    expect(element).not.toBeNull();
    return element!;
}

beforeEach(() => {
    setViewport(320, 240);
    labelSize = {width: 120, height: 28};
    ResizeObserverProbe.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverProbe);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-drop-feedback-label") ? labelSize.width : viewport.width;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-drop-feedback-label") ? labelSize.height : viewport.height;
    });
});
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setViewport(originalViewport.width, originalViewport.height);
});

describe("DropFeedbackOverlay", () => {
    it.each([[40, 40], [100, 18]])("小条目 %sx%s 的提示独立于命中盒显示", async (width, height) => {
        await render(preview({entryRect: rect(12, 20, width, height)}));
        expect(labelElement().textContent).toContain("移动视图");
        const entry = document.querySelector("[data-drop-feedback-entry]")!;
        expect(entry.contains(labelElement())).toBe(false);
        expect(labelPosition()).toEqual({left: 8, top: 20 + height + 6});
    });

    it("只有2px插线时仍画线并给语义提示，短轴与插入边界不漂移，底部不足改放上方", async () => {
        await render(preview({indicator: rect(290, 210, 2, 20), orientation: "horizontal"}));
        const line = document.querySelector<HTMLElement>("[data-drop-feedback-line]")!;
        expect([line.style.left, line.style.top, line.style.width, line.style.height]).toEqual(["290px", "212px", "2px", "16px"]);
        expect(document.querySelector("[data-drop-feedback-area]")).toBeNull();
        expect(document.querySelector("[data-drop-feedback-entry]")).toBeNull();
        expect(labelPosition()).toEqual({left: 192, top: 176});
        expect(document.querySelector("[data-drop-feedback-live]")?.textContent).toContain("移动视图");
    });

    it("内容落点只画一个内缩矩形，插线不叠加，原始命中几何不被回写", async () => {
        const value = preview({areaRect: rect(10, 20, 400, 160), indicator: rect(10, 60, 400, 2)});
        await render(value);
        const shape = document.querySelector<HTMLElement>("[data-drop-feedback-area]")!;
        expect([shape.style.left, shape.style.top, shape.style.width, shape.style.height]).toEqual(["16px", "26px", "388px", "148px"]);
        expect(document.querySelector("[data-drop-feedback-line]")).toBeNull();
        expect(value.areaRect).toEqual(rect(10, 20, 400, 160));
        expect(value.indicator).toEqual(rect(10, 60, 400, 2));
    });

    it("窄半区的比例内缩仍保住正面积，半区非法时不吞有效插线", async () => {
        const wrapper = await render(preview({areaRect: rect(10, 20, 4, 2), indicator: rect(10, 20, 120, 2)}));
        const shape = document.querySelector<HTMLElement>("[data-drop-feedback-area]")!;
        expect([shape.style.left, shape.style.top, shape.style.width, shape.style.height]).toEqual(["11px", "20.5px", "2px", "1px"]);
        expect(document.querySelector("[data-drop-feedback-line]")).toBeNull();

        await wrapper.setProps({preview: preview({areaRect: rect(10, 20, 0, 2), indicator: rect(10, 20, 120, 2)})});
        await nextTick();
        expect(document.querySelector("[data-drop-feedback-area]")).toBeNull();
        const line = document.querySelector<HTMLElement>("[data-drop-feedback-line]")!;
        expect([line.style.left, line.style.top, line.style.width, line.style.height]).toEqual(["12px", "20px", "116px", "2px"]);
        expect(labelElement().textContent).toContain("移动视图");
    });

    it("全部几何非法时不渲染，合法条目不受另一处非法几何影响", async () => {
        const wrapper = await render(preview({areaRect: rect(0, 0, 0, 20), indicator: rect(Number.NaN, 0, 2, 20)}));
        expect(document.querySelector("[data-drop-feedback]")).toBeNull();
        await wrapper.setProps({preview: preview({areaRect: rect(0, 0, 0, 20), entryRect: rect(10, 20, 40, 40)})});
        await nextTick();
        expect(labelElement().textContent).toContain("移动视图");
        expect(document.querySelector("[data-drop-feedback-area]")).toBeNull();
    });

    it("文字变化重测，视口缩小重新夹紧，坐标变化不改变播报文本", async () => {
        const wrapper = await render(preview({areaRect: rect(10, 10, 280, 190)}));
        expect(labelPosition()).toEqual({left: 90, top: 91});
        labelSize = {width: 180, height: 28};
        await wrapper.setProps({label: "并入全部已隐藏和收起的视图"});
        await nextTick();
        expect(labelPosition()).toEqual({left: 60, top: 91});
        setViewport(200, 130);
        for (const observer of ResizeObserverProbe.instances) observer.trigger();
        await nextTick();
        expect(labelPosition()).toEqual({left: 12, top: 91});
        await wrapper.setProps({preview: preview({entryRect: rect(160, 110, 30, 18)})});
        await nextTick();
        expect(labelPosition()).toEqual({left: 12, top: 76});
        expect(document.querySelector("[data-drop-feedback-live]")?.textContent).toContain("并入全部已隐藏和收起的视图");
    });

    it("连续换区只保留一份区域与标签，新几何与文案立即成为过渡目标", async () => {
        const wrapper = await render(preview({areaRect: rect(10, 10, 280, 190)}), "移动到左侧");
        expect(document.querySelector<HTMLElement>("[data-drop-feedback-area]")!.style.left).toBe("16px");

        await wrapper.setProps({label: "移动到右侧", preview: preview({areaRect: rect(30, 10, 280, 190)})});
        await nextTick();
        expect(document.querySelectorAll("[data-drop-feedback-area]")).toHaveLength(1);
        expect(document.querySelectorAll("[data-drop-feedback-label]")).toHaveLength(1);
        expect(document.querySelector<HTMLElement>("[data-drop-feedback-area]")!.style.left).toBe("36px");
        expect(labelElement().textContent).toContain("移动到右侧");
    });

    it("预览结束释放观察，重新出现可以再次测量，卸载后无残留", async () => {
        const wrapper = await render(preview({entryRect: rect(10, 20, 40, 40)}));
        expect(ResizeObserverProbe.instances.some((observer) => observer.observed.size > 0)).toBe(true);
        await wrapper.setProps({preview: null});
        expect(document.querySelector("[data-drop-feedback]")).toBeNull();
        expect(ResizeObserverProbe.instances.every((observer) => observer.observed.size === 0)).toBe(true);
        await wrapper.setProps({preview: preview({entryRect: rect(10, 20, 40, 40)})});
        await nextTick();
        expect(labelPosition()).toEqual({left: 8, top: 66});
        wrapper.unmount();
        wrappers.splice(wrappers.indexOf(wrapper), 1);
        expect(ResizeObserverProbe.instances.every((observer) => observer.observed.size === 0)).toBe(true);
        expect(document.querySelector("[data-drop-feedback]")).toBeNull();
    });

    it("视口为 0 时只画形状，不渲染标签", async () => {
        await render(preview({entryRect: rect(10, 20, 40, 40)}));
        expect(labelElement()).not.toBeNull();
        setViewport(0, 0);
        for (const observer of ResizeObserverProbe.instances) observer.trigger();
        await nextTick();
        expect(document.querySelector("[data-drop-feedback-label]")).toBeNull();
        expect(document.querySelector("[data-drop-feedback-entry]")).not.toBeNull();
        expect(document.querySelector("[data-drop-feedback-live]")?.textContent).toContain("移动视图");
    });

    it("视口比标签还小时按 0 边距夹紧，不出负坐标", async () => {
        setViewport(60, 40);
        await render(preview({entryRect: rect(10, 12, 30, 16)}));
        const position = labelPosition();
        expect(position).toEqual({left: 0, top: 6});
        expect(position.left).toBeGreaterThanOrEqual(0);
        expect(position.top + labelSize.height).toBeLessThanOrEqual(viewport.height);
    });

    it("空白标签不渲染药丸，形状照常", async () => {
        await render(preview({entryRect: rect(12, 20, 40, 40)}), "   ");
        expect(document.querySelector("[data-drop-feedback-entry]")).not.toBeNull();
        expect(document.querySelector("[data-drop-feedback-label]")).toBeNull();
        expect(document.querySelector("[data-drop-indicator-label]")).toBeNull();
        expect(document.querySelector("[data-drop-feedback-live]")?.textContent?.trim()).toBe("");
    });

    it("图标随 iconClass：给了就渲染图标，没给只留文案", async () => {
        const wrapper = await render(preview({entryRect: rect(12, 20, 200, 60)}), "并入 3 个视图", "i-lucide-combine");
        expect(iconElement().className).toContain("i-lucide-combine");
        await wrapper.setProps({iconClass: "i-lucide-panels-top-left"});
        await nextTick();
        expect(iconElement().className).toContain("i-lucide-panels-top-left");
        await wrapper.setProps({iconClass: undefined});
        await nextTick();
        expect(document.querySelector(".nb-ui-drop-indicator-label__icon")).toBeNull();
        expect(labelElement().textContent).toContain("并入 3 个视图");
    });

    it("调用方的 data-* 透传到覆盖层根，业务标记不用改公共组件的接口", async () => {
        await render(preview({entryRect: rect(12, 20, 40, 40)}), "移动容器", undefined, {
            "data-drop-kind": "move-container",
            "data-drop-orientation": "horizontal",
            "data-drop-count": "2",
        });
        const overlay = document.querySelector("[data-drop-feedback]")!;
        expect(overlay.getAttribute("data-drop-kind")).toBe("move-container");
        expect(overlay.getAttribute("data-drop-orientation")).toBe("horizontal");
        expect(overlay.getAttribute("data-drop-count")).toBe("2");
    });
});
