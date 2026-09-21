// @vitest-environment jsdom
import {createPinia, defineStore, setActivePinia} from "pinia";
import * as vue from "vue";
import type {App, Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

beforeAll(() => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    Object.assign(globals, vue);
    globals.defineStore = defineStore;
    globals.piniaPluginPersistedstate = {sessionStorage: () => ({})};
    globals.useI18n = () => ({t: (key: string) => key});
    const stateMap = new Map<string, unknown>();
    globals.useState = (key: string, init?: () => unknown) => {
        if (!stateMap.has(key)) {
            stateMap.set(key, vue.ref(init ? init() : undefined));
        }
        return stateMap.get(key);
    };
    if (typeof globals.ResizeObserver === "undefined") {
        globals.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }
});

const mounted: App[] = [];

beforeEach(() => {
    setActivePinia(createPinia());
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
});

describe("AgentSidebarViewFixture 挂载与 Teleport 目标验证", () => {
    it("挂载 delivery-unknown 与 sessions 场景时不抛出 Invalid Teleport target 警告", async () => {
        const {default: AgentSidebarViewFixture} = await import("./AgentSidebarViewFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const host = document.createElement("div");
        document.body.append(host);

        const pinia = createPinia();
        const app = createApp(AgentSidebarViewFixture as Component, {scene: "delivery-unknown"});
        app.use(pinia);
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);

        await vue.nextTick();

        // 验证没有 Invalid Teleport target 的警告
        const teleportWarns = warnSpy.mock.calls.filter((call) =>
            call.some((arg) => typeof arg === "string" && arg.includes("Invalid Teleport target")),
        );
        expect(teleportWarns).toHaveLength(0);

        warnSpy.mockRestore();
    }, 15000);

    it("正确渲染 AgentSidebarView 结构", async () => {
        const {default: AgentSidebarViewFixture} = await import("./AgentSidebarViewFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const pinia = createPinia();
        const app = createApp(AgentSidebarViewFixture as Component, {scene: "conversation"});
        app.use(pinia);
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);

        await vue.nextTick();

        const view = host.querySelector(".agent-sidebar-view");
        expect(view).not.toBeNull();
    }, 15000);

    it("正确挂载全新用户入口场景（包含最近会话与带 $skill 的推荐提示词）", async () => {
        const {default: AgentSidebarViewFixture} = await import("./AgentSidebarViewFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        // 1. 验证 empty 场景：包含最近会话和推荐提示词
        const hostEmpty = document.createElement("div");
        document.body.append(hostEmpty);
        const appEmpty = createApp(AgentSidebarViewFixture as Component, {scene: "empty"});
        appEmpty.use(createPinia());
        appEmpty.provide(LAB_DATA_SINK, () => {});
        appEmpty.provide(LAB_EVENT_SINK, () => {});
        mounted.push(appEmpty);
        appEmpty.mount(hostEmpty);
        await vue.nextTick();

        // 验证最近会话右侧箭头一直显示（不再带有 opacity-0）
        const recentArrow = hostEmpty.querySelector(".flex.flex-col.gap-1\\.5 button .i-lucide-arrow-right");
        expect(recentArrow).not.toBeNull();
        expect(recentArrow?.className).not.toContain("opacity-0");

        // 验证推荐创作指令极简行（最多 3 条，前置图标 + 纯正文 + Tooltip 悬停展示全文）
        const promptButtons = hostEmpty.querySelectorAll(".flex.flex-col.gap-1 button");
        expect(promptButtons.length).toBe(3);

        // 验证每条指令的前置特色图标
        expect(hostEmpty.querySelector(".i-lucide-feather")).not.toBeNull();
        expect(hostEmpty.querySelector(".i-lucide-git-merge")).not.toBeNull();
        expect(hostEmpty.querySelector(".i-lucide-shield-check")).not.toBeNull();

        // 验证不使用浏览器原生 title 属性，而是使用组件库 Tooltip 浮层
        expect(promptButtons[0].getAttribute("title")).toBeNull();
        expect(promptButtons[0].textContent).toContain("帮我润色一段环境描写");
    }, 20000);
});
