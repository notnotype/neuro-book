// @vitest-environment jsdom
import {mount, type VueWrapper} from "@vue/test-utils";

// dnd-kit 的 Vue 适配层在绑定拖动源/落点时用 ResizeObserver；jsdom 没有，先补一个空实现。
vi.hoisted(() => {
    if (typeof (globalThis as {ResizeObserver?: unknown}).ResizeObserver === "undefined") {
        Object.assign(globalThis, {
            ResizeObserver: class {
                observe(): void {}
                unobserve(): void {}
                disconnect(): void {}
            },
        });
    }
});
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";
import WorkbenchActivityBar, {type ActivityItem} from "nbook/app/components/workbench/WorkbenchActivityBar.vue";

/**
 * 通用活动栏的行为面：分组渲染与 aria、禁用不执行、溢出进 More（含禁用理由）、
 * 单项插槽替换。高度是外部给的，所以这里直接改元素的实测高度再驱动 ResizeObserver，
 * 不依赖布局引擎。
 */

class ResizeObserverStub {
    static instances: ResizeObserverStub[] = [];
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverStub.instances.push(this);
    }

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}

    static triggerAll(): void {
        for (const instance of ResizeObserverStub.instances) {
            instance.callback([], instance as unknown as ResizeObserver);
        }
    }
}

function setMeasuredHeight(element: Element | null, height: number): void {
    if (element === null) return;
    Object.defineProperty(element, "clientHeight", {configurable: true, value: height});
    Object.defineProperty(element, "offsetHeight", {configurable: true, value: height});
}

const primary: ActivityItem[] = [
    {id: "files", label: "文件", icon: "i-lucide-files", active: true},
    {id: "world", label: "世界引擎", icon: "i-lucide-globe-2", disabled: true, reason: "请先打开一个 Project"},
];

const secondary: ActivityItem[] = [
    {id: "trace", label: "链路查看器", icon: "i-lucide-activity"},
    {id: "history", label: "历史收件箱", icon: "i-lucide-inbox"},
    {id: "jobs", label: "任务中心", icon: "i-lucide-list-checks"},
];

const footer: ActivityItem[] = [
    {id: "account", label: "账户", icon: "i-lucide-user-round"},
    {id: "settings", label: "设置", icon: "i-lucide-settings"},
];

describe("WorkbenchActivityBar", () => {
    const wrappers: VueWrapper[] = [];

    function mountBar(options: {slots?: Record<string, string>} = {}): VueWrapper {
        const wrapper = mount(WorkbenchActivityBar, {
            attachTo: document.body,
            props: {primary, secondary, footer, label: "工作台导航", moreLabel: "更多"},
            slots: options.slots,
        });
        wrappers.push(wrapper);
        return wrapper;
    }

    beforeEach(() => {
        ResizeObserverStub.instances = [];
        vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    });

    afterEach(() => {
        for (const wrapper of wrappers.splice(0)) {
            wrapper.unmount();
        }
        vi.unstubAllGlobals();
    });

    it("按组渲染入口：aria 文案、active 与禁用理由", () => {
        const wrapper = mountBar();

        expect(wrapper.attributes("aria-label")).toBe("工作台导航");
        const files = wrapper.get("[data-activity-id=files]");
        expect(files.attributes("aria-label")).toBe("文件");
        expect(files.attributes("aria-pressed")).toBe("true");

        const world = wrapper.get("[data-activity-id=world]");
        expect(world.attributes("disabled")).toBeDefined();
        expect(world.attributes("aria-label")).toBe("世界引擎 · 请先打开一个 Project");

        expect(wrapper.get("[data-activity-group=footer] [data-activity-id=settings]").attributes("aria-pressed")).toBe("false");
    });

    it("点击触发 invoke；禁用项不触发", async () => {
        const wrapper = mountBar();

        await wrapper.get("[data-activity-id=trace]").trigger("click");
        await wrapper.get("[data-activity-id=world]").trigger("click");
        await wrapper.get("[data-activity-id=settings]").trigger("click");

        expect(wrapper.emitted("invoke")).toEqual([["trace"], ["settings"]]);
    });

    it("矮容器：次要入口从尾部进 More，菜单里保留禁用理由并可执行", async () => {
        const wrapper = mountBar();
        // 容器 263px，主入口组 88px、底部组 44px → 中段剩 131px：只摆得下 1 项，另 2 项进 More
        setMeasuredHeight(wrapper.element, 263);
        setMeasuredHeight(wrapper.get("[data-activity-group=primary]").element, 88);
        setMeasuredHeight(wrapper.get("[data-activity-group=footer]").element, 44);
        ResizeObserverStub.triggerAll();
        await nextTick();

        expect(wrapper.find("[data-activity-id=trace]").exists()).toBe(true);
        expect(wrapper.find("[data-activity-id=history]").exists()).toBe(false);
        expect(wrapper.find("[data-activity-id=jobs]").exists()).toBe(false);

        const more = wrapper.get("[data-activity-id=more]");
        expect(more.attributes("title")).toBe("更多");
        await more.trigger("click");
        await nextTick();

        const menuItems = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]"));
        expect(menuItems.map((item) => item.textContent?.trim())).toEqual(["历史收件箱", "任务中心"]);

        menuItems[1]!.click();
        await nextTick();
        expect(wrapper.emitted("invoke")).toEqual([["jobs"]]);
    });

    it("溢出菜单里禁用项带理由且不执行", async () => {
        const wrapper = mount(WorkbenchActivityBar, {
            attachTo: document.body,
            props: {
                primary,
                secondary: [
                    {id: "trace", label: "链路查看器", icon: "i-lucide-activity"},
                    {id: "jobs", label: "任务中心", icon: "i-lucide-list-checks", disabled: true, reason: "需要打开 Project"},
                ],
                footer: [],
                label: "工作台导航",
                moreLabel: "更多",
            },
        });
        wrappers.push(wrapper);

        setMeasuredHeight(wrapper.element, 175);
        setMeasuredHeight(wrapper.get("[data-activity-group=primary]").element, 88);
        ResizeObserverStub.triggerAll();
        await nextTick();

        await wrapper.get("[data-activity-id=more]").trigger("click");
        await nextTick();

        const jobItem = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]")).find((item) => item.textContent?.includes("任务中心"));
        expect(jobItem?.textContent).toContain("需要打开 Project");
        jobItem!.click();
        await nextTick();
        expect(wrapper.emitted("invoke")).toBeUndefined();
    });

    it("单项插槽只替换那一项，其余入口照常渲染", async () => {
        const wrapper = mountBar({
            slots: {
                "item-account": "<button class=\"account-probe\" data-activity-id=\"account\">账户菜单</button>",
            },
        });

        expect(wrapper.get(".account-probe").text()).toBe("账户菜单");
        expect(wrapper.get("[data-activity-id=settings]").attributes("aria-label")).toBe("设置");
        expect(wrapper.get("[data-activity-id=files]").attributes("aria-label")).toBe("文件");

        await wrapper.get(".account-probe").trigger("click");
        expect(wrapper.emitted("invoke")).toBeUndefined();
    });
});
