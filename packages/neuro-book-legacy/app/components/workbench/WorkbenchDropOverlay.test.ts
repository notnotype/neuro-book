// @vitest-environment jsdom
import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";
import type {GridDropRect} from "@notnotype/nb-ui/layout";
import type {WorkbenchDropPreview} from "nbook/app/utils/workbench/workbench-drop";
import WorkbenchDropOverlay from "nbook/app/components/workbench/WorkbenchDropOverlay.vue";

/**
 * 适配器只承诺业务侧的三件事：kind → 图标、三个 `data-drop-*` 语义标记、以及把 preview/label 原样
 * 交给公共覆盖层。绘制、内缩、标签夹紧、观察器生命周期是 `DropFeedbackOverlay` 的合同，在 nb-ui 里
 * 用 `DropFeedbackOverlay.test.ts` 覆盖，这里不重复一套几何断言。
 *
 * kind 词汇里 `detach-view`（View 落条目带 / 空正文新建容器）与另外三种同档；切换器的预览只有一条
 * 插入线：条目高亮按新合同删除，`entryRect` 恒为 `null`，区域也只在整区落点上才出现。
 */

const wrappers: VueWrapper[] = [];

const rect = (left: number, top: number, width: number, height: number): GridDropRect => ({left, top, right: left + width, bottom: top + height});

function preview(patch: Partial<WorkbenchDropPreview> = {}): WorkbenchDropPreview {
    return {areaRect: null, entryRect: null, indicator: null, orientation: "vertical", count: 1, ...patch};
}

async function render(value: WorkbenchDropPreview | null, label = "移动视图", kind = "move-view"): Promise<VueWrapper> {
    const wrapper = mount(WorkbenchDropOverlay, {attachTo: document.body, props: {preview: value, label, kind}});
    wrappers.push(wrapper);
    await nextTick();
    await nextTick();
    return wrapper;
}

function overlayElement(): HTMLElement {
    const element = document.querySelector<HTMLElement>("[data-drop-feedback]");
    expect(element).not.toBeNull();
    return element!;
}

function iconElement(): HTMLElement {
    const element = document.querySelector<HTMLElement>(".nb-ui-drop-indicator-label__icon");
    expect(element).not.toBeNull();
    return element!;
}

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
});

describe("WorkbenchDropOverlay 适配器", () => {
    it("按 kind 选业务图标，未知 kind 只留文案", async () => {
        const wrapper = await render(preview({indicator: rect(12, 20, 2, 60)}), "并入 3 个视图", "merge-container");
        expect(iconElement().className).toContain("i-lucide-combine");
        await wrapper.setProps({kind: "move-container"});
        await nextTick();
        expect(iconElement().className).toContain("i-lucide-panels-top-left");
        await wrapper.setProps({kind: "move-view"});
        await nextTick();
        expect(iconElement().className).toContain("i-lucide-move");
        // `detach-view`（View 落到条目带 / 空正文时新建容器）走另一枚图标。
        await wrapper.setProps({kind: "detach-view"});
        await nextTick();
        expect(iconElement().className).toContain("i-lucide-panel-top");
        // `noop` 带预览（中央保持布局 / 原位锚点）：图标与 Editor 的 keep 档同源。
        await wrapper.setProps({kind: "noop"});
        await nextTick();
        expect(iconElement().className).toContain("i-lucide-layout-dashboard");
        await wrapper.setProps({kind: "constructor"});
        await nextTick();
        expect(document.querySelector(".nb-ui-drop-indicator-label__icon")).toBeNull();
        expect(document.querySelector("[data-drop-feedback-label]")?.textContent).toContain("并入 3 个视图");
    });

    it("把落点种类、轴与并入数量透传到覆盖层根；切换器只有一条线，没有条目框也没有区域", async () => {
        await render(
            preview({indicator: rect(12, 20, 2, 40), orientation: "horizontal", count: 2}),
            "新建容器",
            "detach-view",
        );
        const overlay = overlayElement();
        expect(overlay.getAttribute("data-drop-kind")).toBe("detach-view");
        expect(overlay.getAttribute("data-drop-orientation")).toBe("horizontal");
        expect(overlay.getAttribute("data-drop-count")).toBe("2");
        // 插入位画的就是那一条线：条目高亮按新合同删除，整区反馈的 `areaRect` 也不在这条路上。
        expect(overlay.querySelector("[data-drop-feedback-line]")).not.toBeNull();
        expect(overlay.querySelector("[data-drop-feedback-entry]")).toBeNull();
        expect(overlay.querySelector("[data-drop-feedback-area]")).toBeNull();
    });

    it("没有有效目标时整层不渲染，恢复预览后重新出现", async () => {
        const wrapper = await render(null);
        expect(document.querySelector("[data-drop-feedback]")).toBeNull();
        await wrapper.setProps({preview: preview({areaRect: rect(10, 20, 200, 120)})});
        await nextTick();
        expect(document.querySelector("[data-drop-feedback-area]")).not.toBeNull();
    });
});
