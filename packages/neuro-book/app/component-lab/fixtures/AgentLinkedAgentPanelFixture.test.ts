// @vitest-environment jsdom
import {createPinia, setActivePinia} from "pinia";
import * as vue from "vue";
import {createApp, defineComponent, h, ref, type App, type Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {agentLinkedAgentPanelScenes} from "./AgentExtraPanels.scenes";
import {LAB_DATA_SINK, LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";
import type {LabSceneInput} from "../lab-subject";

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

async function mountFixture(scene: string) {
    const found = agentLinkedAgentPanelScenes.find((entry) => entry.id === scene);
    if (!found) throw new Error(`缺少 AgentLinkedAgentPanel 场景 ${scene}`);
    const {default: fixture} = await import("./AgentLinkedAgentPanelFixture.vue");
    const input = ref<LabSceneInput>(structuredClone(found.input));
    const events: Array<{name: string; payload: unknown}> = [];
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
        setup: () => () => h(fixture as Component, {scene, input: input.value}),
    }));
    app.use(createPinia());
    app.provide(LAB_DATA_SINK, () => {});
    app.provide(LAB_INPUT_SINK, (layer, key, value) => {
        input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
    });
    app.provide(LAB_EVENT_SINK, (name, payload) => {events.push({name, payload});});
    mounted.push(app);
    app.mount(host);
    await vue.nextTick();
    return {host, input, events};
}

describe("AgentLinkedAgentPanelFixture 规范与场景验证", () => {
    it("正确渲染居中根容器并标记 data-lab-subject", async () => {
        const {host} = await mountFixture("populated");

        // 1. 验证视口承载容器：不含顶层 bg-[var(--bg-main)] 材质污染
        const root = host.firstElementChild as HTMLElement;
        expect(root).not.toBeNull();
        expect(root.className).not.toContain("bg-[var(--bg-main)]");

        // 2. 验证零件标定：包含 data-lab-subject
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });

    it("响应 populated 场景：展示具体的关联 Agent 条目", async () => {
        const {host} = await mountFixture("populated");

        expect(host.textContent).toContain("第一章初稿撰写");
        expect(host.textContent).toContain("角色资料检索");
        expect(host.textContent).not.toContain("agent.linkedAgents.emptyOwned");
    });

    it("响应 empty 场景：展示空状态说明文案", async () => {
        const {host} = await mountFixture("empty");

        // 空状态提示
        expect(host.textContent).toContain("agent.linkedAgents.empty");
        expect(host.textContent).not.toContain("第一章初稿撰写");
    });

    it("响应 loading 场景：刷新按钮处于禁用等待态", async () => {
        const {host} = await mountFixture("loading");

        const refreshBtn = host.querySelector("button[title='agent.linkedAgents.refresh']") as HTMLButtonElement | null;
        expect(refreshBtn).not.toBeNull();
        expect(refreshBtn?.disabled).toBe(true);
    });
    it("选中关联会话回写 sessionId，编辑 JSON 列表同步更新展示", async () => {
        const {host, input, events} = await mountFixture("populated");
        const target = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("第一章初稿撰写"));
        expect(target).toBeDefined();
        target!.click();
        await vue.nextTick();
        expect(input.value.props?.sessionId).toBe(201);
        expect(events.filter((event) => event.name === "select")).toHaveLength(1);

        input.value = {...input.value, props: {...input.value.props, ownedAgents: [], linkedByAgents: []}};
        await vue.nextTick();
        expect(host.textContent).toContain("agent.linkedAgents.empty");
        expect(host.textContent).not.toContain("第一章初稿撰写");
    });
});
