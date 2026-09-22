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
import {computed, nextTick} from "vue";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";
import NovelIdeActivityBar, {type WorkbenchActivityContainer} from "./NovelIdeActivityBar.vue";

/**
 * 产品活动栏：上半是**主侧栏容器单选**，下半是非容器命令（工具组 + 账户 / 设置）。
 *
 * 这里钉三件事：容器条目的选中与回传、非容器命令的原有门禁与事件路由、账户格仍是插槽替换。
 * 「重复点击当前项保持选择并显式打开主侧栏」的语义在页面命令里，不在这一层。
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

const adminUser: AuthUserDto = {
    id: "user-1",
    username: "notnotype",
    displayName: "NotNotype",
    role: "admin",
    sessionVersion: 1,
};

const TOOLS_CONTAINER: WorkbenchActivityContainer = {
    containerId: "nbook.tools",
    title: "工具",
    icon: "i-lucide-files",
    location: "sidebar-left",
    partId: "left",
    viewIds: ["nbook.files"],
    canMoveContainer: true,
};
const PANEL_CONTAINER: WorkbenchActivityContainer = {
    containerId: "nbook.panel",
    title: "面板",
    icon: "i-lucide-panel-bottom",
    location: "sidebar-left",
    partId: "left",
    viewIds: [],
    canMoveContainer: true,
};

const mounted: VueWrapper[] = [];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // 账户菜单是依赖 Nuxt 自动导入的老组件，挂载它时补上它用到的运行期全局
    vi.stubGlobal("computed", computed);
    ResizeObserverStub.instances = [];
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

function mountBar(overrides: Record<string, unknown> = {}): VueWrapper {
    const wrapper = mount(NovelIdeActivityBar, {
        attachTo: document.body,
        props: {
            containers: [TOOLS_CONTAINER, PANEL_CONTAINER],
            activeContainerId: TOOLS_CONTAINER.containerId,
            desktopAvailable: true,
            surfaceActive: true,
            userAssetsMode: false,
            currentUser: null,
            ...overrides,
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

/** jsdom 没有布局：给容器一个真实高度，次要入口才不会被当成放不下。 */
async function measureBar(wrapper: VueWrapper, height = 720): Promise<void> {
    Object.defineProperty(wrapper.element, "clientHeight", {configurable: true, value: height});
    ResizeObserverStub.triggerAll();
    await nextTick();
}

describe("NovelIdeActivityBar", () => {
    it("上半只有容器条目：标题来自切片，选中态只跟活动容器走", async () => {
        const wrapper = mountBar();
        await measureBar(wrapper);

        expect(wrapper.get("[data-activity-group=primary]").findAll("[data-activity-id]").map((item) => item.attributes("data-activity-id")))
            .toEqual([TOOLS_CONTAINER.containerId, PANEL_CONTAINER.containerId]);
        expect(wrapper.get(`[data-activity-id="${TOOLS_CONTAINER.containerId}"]`).attributes("aria-pressed")).toBe("true");
        expect(wrapper.get(`[data-activity-id="${TOOLS_CONTAINER.containerId}"]`).attributes("aria-label")).toBe("工具");
        expect(wrapper.get(`[data-activity-id="${PANEL_CONTAINER.containerId}"]`).attributes("aria-pressed")).toBe("false");

        const switched = mountBar({activeContainerId: PANEL_CONTAINER.containerId});
        await measureBar(switched);
        expect(switched.get(`[data-activity-id="${PANEL_CONTAINER.containerId}"]`).attributes("aria-pressed")).toBe("true");
        expect(switched.get(`[data-activity-id="${TOOLS_CONTAINER.containerId}"]`).attributes("aria-pressed")).toBe("false");
    });

    it("点击条目：容器走 open-container，工具与底部命令走各自的原产品事件", async () => {
        const wrapper = mountBar();
        await measureBar(wrapper);

        await wrapper.get(`[data-activity-id="${PANEL_CONTAINER.containerId}"]`).trigger("click");
        await wrapper.get("[data-activity-id=plot]").trigger("click");
        await wrapper.get("[data-activity-id=world]").trigger("click");
        await wrapper.get("[data-activity-id=trace]").trigger("click");
        await wrapper.get("[data-activity-id=history]").trigger("click");
        await wrapper.get("[data-activity-id=settings]").trigger("click");

        expect(wrapper.emitted("open-container")).toEqual([[PANEL_CONTAINER.containerId]]);
        expect(wrapper.emitted("open-plot-workbench")).toEqual([[]]);
        expect(wrapper.emitted("open-world-engine")).toEqual([[]]);
        expect(wrapper.emitted("open-trace-viewer")).toEqual([[]]);
        expect(wrapper.emitted("open-history-inbox")).toEqual([[]]);
        expect(wrapper.emitted("open-settings")).toEqual([[]]);
        expect(wrapper.emitted("open-home")).toBeUndefined();
    });

    it("非容器命令保留原有门禁：没有 Project 时禁用并说明原因，书架态才出现 home", async () => {
        const wrapper = mountBar({surfaceActive: false, userAssetsMode: true});
        await measureBar(wrapper);

        const disabled = wrapper.get("[data-activity-id=world]");
        expect(disabled.attributes("disabled")).toBeDefined();
        expect(disabled.attributes("aria-label")).toBe("ide.header.worldEngine · ide.activityBar.needOpenProject");
        // 容器条目不是产品命令：Project 未打开时仍可选（选择只改可见性偏好）。
        expect(wrapper.get(`[data-activity-id="${TOOLS_CONTAINER.containerId}"]`).attributes("disabled")).toBeUndefined();

        const bookshelf = mountBar({desktopAvailable: false, surfaceActive: false});
        await measureBar(bookshelf);
        expect(bookshelf.get("[data-activity-id=home]").attributes("aria-label")).toBe("ide.header.bookshelfTitle");
        await bookshelf.get("[data-activity-id=home]").trigger("click");
        expect(bookshelf.emitted("open-home")).toEqual([[]]);
    });

    it("账户入口整项替换为账户菜单，其余底部入口仍走默认按钮", () => {
        const wrapper = mountBar({currentUser: adminUser});

        const account = wrapper.get("[data-activity-id=account]");
        expect(account.text()).toContain("N");
        expect(account.find("button").exists()).toBe(true);

        const settings = wrapper.get("[data-activity-id=settings]");
        expect(settings.element.tagName).toBe("BUTTON");
        expect(settings.attributes("aria-label")).toBe("settings.title");
    });
});
