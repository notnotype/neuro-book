// @vitest-environment jsdom
import {createPinia, setActivePinia} from "pinia";
import * as vue from "vue";
import {createApp, type App, type Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";

beforeAll(() => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    Object.assign(globals, vue);
    globals.useI18n = () => ({t: (key: string) => key});
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

describe("AgentSystemPromptPanelFixture 规范与场景验证", () => {
    it("正确渲染居中根容器并标记 data-lab-subject", async () => {
        const {default: AgentSystemPromptPanelFixture} = await import("./AgentSystemPromptPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentSystemPromptPanelFixture as Component, {scene: "expanded"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        // 1. 验证视口承载容器：不含顶层 bg-[var(--bg-main)] 材质污染
        const root = host.firstElementChild as HTMLElement;
        expect(root).not.toBeNull();
        expect(root.className).not.toContain("bg-[var(--bg-main)]");

        // 2. 验证零件标定：包含 data-lab-subject
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });

    it("响应 expanded 场景：正确渲染 Markdown 角色定义正文", async () => {
        const {default: AgentSystemPromptPanelFixture} = await import("./AgentSystemPromptPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentSystemPromptPanelFixture as Component, {scene: "expanded"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        expect(host.textContent).toContain("角色定义");
        expect(host.textContent).toContain("情节构思");
        expect(host.querySelector(".i-lucide-loader-circle")).toBeNull();
    });

    it("响应 loading 场景：展示加载转圈动画与文案", async () => {
        const {default: AgentSystemPromptPanelFixture} = await import("./AgentSystemPromptPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentSystemPromptPanelFixture as Component, {scene: "loading"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        // 渲染加载中
        expect(host.querySelector(".i-lucide-loader-circle")).not.toBeNull();
        expect(host.textContent).toContain("agent.systemPrompt.loading");
    });

    it("响应 error 场景：展示错误文案与重试按钮", async () => {
        const {default: AgentSystemPromptPanelFixture} = await import("./AgentSystemPromptPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentSystemPromptPanelFixture as Component, {scene: "error"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        expect(host.textContent).toContain("加载 System Prompt 失败");
        expect(host.textContent).toContain("agent.systemPrompt.retry");
    });

    it("响应 empty 场景：展示空状态提示", async () => {
        const {default: AgentSystemPromptPanelFixture} = await import("./AgentSystemPromptPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentSystemPromptPanelFixture as Component, {scene: "empty"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        expect(host.textContent).toContain("agent.systemPrompt.empty");
    });
});
