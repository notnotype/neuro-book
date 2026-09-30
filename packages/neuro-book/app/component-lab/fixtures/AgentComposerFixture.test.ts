// @vitest-environment jsdom
import {createPinia, defineStore, setActivePinia} from "pinia";
import * as vue from "vue";
import type {App, Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {findLabFixture} from "./index";
import {LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";

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

describe("AgentComposerFixture 挂载与场景渲染验证", {timeout: 20000}, () => {
    async function mountFixture(scene: string) {
        const definition = findLabFixture("AgentComposer")!;
        const input = vue.ref(structuredClone(definition.scenes.find((entry) => entry.id === scene)!.input!));
        const fixture = await definition.load();
        const host = document.createElement("div");
        document.body.append(host);
        const app = vue.createApp(vue.defineComponent({
            setup() {
                return () => vue.h(fixture as Component, {scene, input: input.value});
            },
        }));
        app.use(createPinia());
        app.provide(LAB_INPUT_SINK, (layer, key, value) => {
            input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
        });
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);
        await vue.nextTick();
        return {host, app, input};
    }

    it("正常挂载 ready 场景，并带有 data-lab-subject 标记", async () => {
        const {host} = await mountFixture("ready");
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });

    it("挂载 with-text 场景，能够渲染预填的提示词文本", async () => {
        const {host} = await mountFixture("with-text");
        expect(host.textContent).toContain("请根据第三幕大纲推演钟楼决战的心理细节");
    });

    it("挂载 queued 场景，渲染排队消息队列", async () => {
        const {host} = await mountFixture("queued");
        expect(host.textContent).toContain("注意钟摆撞击声在此处作为心跳节拍");
        expect(host.textContent).toContain("同时检查配角艾德温的手枪子弹数量");
    });

    it("挂载 user-input-prompt 场景，渲染用户决策向导", async () => {
        const {host} = await mountFixture("user-input-prompt");
        expect(host.textContent).toContain("主角在钟楼顶层发现神秘遗留物");
        expect(host.textContent).toContain("发现导师生前暗藏的怀表信件");
    });

    it("挂载 readonly-unselected 场景，渲染可用性状态横幅", async () => {
        const {host} = await mountFixture("readonly-unselected");
        // unselected 场景会展示未选择对话的可用性横幅
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });

    it("挂载 running 场景，正确渲染运行中状态", async () => {
        const {host} = await mountFixture("running");
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
    });
});
