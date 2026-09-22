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

describe("AgentLinkedAgentPanelFixture 规范与场景验证", () => {
    it("正确渲染居中根容器并标记 data-lab-subject", async () => {
        const {default: AgentLinkedAgentPanelFixture} = await import("./AgentLinkedAgentPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentLinkedAgentPanelFixture as Component, {scene: "populated"});
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

    it("响应 populated 场景：展示具体的关联 Agent 条目", async () => {
        const {default: AgentLinkedAgentPanelFixture} = await import("./AgentLinkedAgentPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentLinkedAgentPanelFixture as Component, {scene: "populated"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        expect(host.textContent).toContain("第一章初稿撰写");
        expect(host.textContent).toContain("角色资料检索");
        expect(host.textContent).not.toContain("agent.linkedAgents.emptyOwned");
    });

    it("响应 empty 场景：展示空状态说明文案", async () => {
        const {default: AgentLinkedAgentPanelFixture} = await import("./AgentLinkedAgentPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentLinkedAgentPanelFixture as Component, {scene: "empty"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        // 空状态提示
        expect(host.textContent).toContain("agent.linkedAgents.empty");
        expect(host.textContent).not.toContain("第一章初稿撰写");
    });

    it("响应 loading 场景：刷新按钮处于禁用等待态", async () => {
        const {default: AgentLinkedAgentPanelFixture} = await import("./AgentLinkedAgentPanelFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(AgentLinkedAgentPanelFixture as Component, {scene: "loading"});
        app.use(createPinia());
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();

        const refreshBtn = host.querySelector("button[title='agent.linkedAgents.refresh']") as HTMLButtonElement | null;
        expect(refreshBtn).not.toBeNull();
        expect(refreshBtn?.disabled).toBe(true);
    });
});
