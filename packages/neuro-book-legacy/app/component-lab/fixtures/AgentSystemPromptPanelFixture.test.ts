// @vitest-environment jsdom
import {createPinia, setActivePinia} from "pinia";
import * as vue from "vue";
import {createApp, defineComponent, h, ref, type App, type Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {agentSystemPromptPanelScenes} from "./AgentExtraPanels.scenes";
import {LAB_DATA_SINK, LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";
import type {LabSceneInput} from "../lab-subject";

let fixture: Component;
beforeAll(async () => {
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
    fixture = (await import("./AgentSystemPromptPanelFixture.vue")).default as Component;
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
    const found = agentSystemPromptPanelScenes.find((entry) => entry.id === scene);
    if (!found) throw new Error(`缺少 AgentSystemPromptPanel 场景 ${scene}`);
    // 冷模块转换属于套件准备，不计入挂载交互的单用例时间。
    const input = ref<LabSceneInput>(structuredClone(found.input));
    const events: Array<{name: string; payload: unknown}> = [];
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
        setup: () => () => h(fixture, {scene, input: input.value}),
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

describe("AgentSystemPromptPanelFixture 规范与场景验证", () => {
    it("正确渲染居中根容器并标记 data-lab-subject", async () => {
        const {host} = await mountFixture("expanded");

        // 1. 验证视口承载容器：不含顶层 bg-[var(--bg-main)] 材质污染
        const root = host.firstElementChild as HTMLElement;
        expect(root).not.toBeNull();
        expect(root.className).not.toContain("bg-[var(--bg-main)]");

        // 2. 验证零件标定：包含 data-lab-subject
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });

    it("响应 expanded 场景：正确渲染 Markdown 角色定义正文", async () => {
        const {host} = await mountFixture("expanded");

        expect(host.textContent).toContain("角色定义");
        expect(host.textContent).toContain("情节构思");
        expect(host.querySelector(".i-lucide-loader-circle")).toBeNull();
    });

    it("响应 loading 场景：展示加载转圈动画与文案", async () => {
        const {host} = await mountFixture("loading");

        // 渲染加载中
        expect(host.querySelector(".i-lucide-loader-circle")).not.toBeNull();
        expect(host.textContent).toContain("agent.systemPrompt.loading");
    });

    it("响应 error 场景：展示错误文案与重试按钮", async () => {
        const {host} = await mountFixture("error");

        expect(host.textContent).toContain("加载 System Prompt 失败");
        expect(host.textContent).toContain("agent.systemPrompt.retry");
    });

    it("响应 empty 场景：展示空状态提示", async () => {
        const {host} = await mountFixture("empty");

        expect(host.textContent).toContain("agent.systemPrompt.empty");
    });
    it("关闭面板回写 model，并可由 JSON 输入重新展开且更新正文", async () => {
        const {host, input, events} = await mountFixture("expanded");
        const close = host.querySelector("button[title='agent.systemPrompt.close']") as HTMLButtonElement;
        close.click();
        await vue.nextTick();
        expect(input.value.model?.modelValue).toBe(false);
        expect(events.filter((event) => event.name === "update:modelValue")).toHaveLength(1);
        expect(host.textContent).toContain("System Prompt 面板已收起");

        input.value = {...input.value, model: {modelValue: true}, props: {...input.value.props, value: "修改后的系统提示", loading: false}};
        await vue.nextTick();
        expect(host.textContent).toContain("修改后的系统提示");
        expect(host.textContent).not.toContain("System Prompt 面板已收起");
    });
});
