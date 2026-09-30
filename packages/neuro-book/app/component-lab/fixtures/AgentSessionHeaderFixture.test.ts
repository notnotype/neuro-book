// @vitest-environment jsdom
import {createPinia, setActivePinia} from "pinia";
import * as vue from "vue";
import {createApp, type App, type Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {agentSessionHeaderScenes} from "./AgentConversation.scenes";
import {LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";
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
    const {default: Fixture} = await import("./AgentSessionHeaderFixture.vue");
    const input = vue.ref<LabSceneInput>(structuredClone(agentSessionHeaderScenes.find(entry => entry.id === scene)!.input));
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(vue.defineComponent({
        setup() { return () => vue.h(Fixture as Component, {scene, input: input.value}); },
    }));
    app.use(createPinia());
    app.provide(LAB_INPUT_SINK, (layer, key, value) => {
        input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
    });
    app.provide(LAB_EVENT_SINK, () => {});
    mounted.push(app);
    app.mount(host);
    await vue.nextTick();
    return {host, input};
}

describe("AgentSessionHeaderFixture 规范与场景验证", () => {
    it("正确渲染居中根容器并标记 data-lab-subject", async () => {
        const {host} = await mountFixture("default");

        // 1. 验证视口承载容器：不含顶层 bg-[var(--bg-main)] 材质污染
        const root = host.firstElementChild as HTMLElement;
        expect(root).not.toBeNull();
        expect(root.className).not.toContain("bg-[var(--bg-main)]");

        // 2. 验证零件标定：包含 data-lab-subject
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });

    it("响应 default 场景：渲染活跃标题，不展示下拉和总结器", async () => {
        const {host} = await mountFixture("default");

        expect(host.textContent).toContain("第一卷：青云宗试炼（分支A）");
        expect(host.textContent).not.toContain("已更新");
    });

    it("响应 with-badges 场景：渲染摘要已更新徽标与附件数量", async () => {
        const {host} = await mountFixture("with-badges");

        expect(host.textContent).toContain("已更新");
        expect(host.textContent).toContain("3");
        expect(host.textContent).toContain("2");
    });
});
