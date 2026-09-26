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
        if (!stateMap.has(key)) stateMap.set(key, vue.ref(init ? init() : undefined));
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
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
});

describe("ModelPickerContent 与 ModelPickerPopover 场景交互", {timeout: 20000}, () => {
    async function mountFixture(component: "ModelPickerContent" | "ModelPickerPopover", scene: string) {
        const definition = findLabFixture(component)!;
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
        return {host, input};
    }

    it("Popover 默认场景在触发按钮展示当前角色", async () => {
        const {host} = await mountFixture("ModelPickerPopover", "default");
        expect(host.textContent).toContain("主力");
    });

    it("Content 直接嵌入并展示梯度与专精角色", async () => {
        const {host} = await mountFixture("ModelPickerContent", "content-only");
        expect(host.textContent).toContain("Claude 3.7 Sonnet");
        expect(host.textContent).toContain("极轻量");
        expect(host.textContent).toContain("深度");
    });

    it("Content 梯度场景隐藏专精角色，专精场景展示它", async () => {
        const gradient = await mountFixture("ModelPickerContent", "gradient-only");
        expect(gradient.host.textContent).toContain("主力");
        expect(gradient.host.textContent).not.toContain("小说正文与段落润色");
        const specialist = await mountFixture("ModelPickerContent", "specialist-enabled");
        expect(specialist.host.textContent).toContain("写作");
        expect(specialist.host.textContent).toContain("叙事");
    });

    it("Content JSON 输入更新立即改变选中角色和思考等级", async () => {
        const {host, input} = await mountFixture("ModelPickerContent", "content-only");
        input.value = {...input.value, model: {...input.value.model, modelValue: "role:deep", thinkingLevel: "max"}};
        await vue.nextTick();
        expect(host.textContent).toContain("深度");
        expect(host.textContent).toContain("最大满载");
        input.value = {...input.value, props: {...input.value.props, showSpecialistInPicker: false}, model: {...input.value.model, modelValue: "role:fast", thinkingLevel: "off"}};
        await vue.nextTick();
        expect(host.textContent).toContain("快速");
        expect(host.textContent).toContain("关闭思考");
        expect(host.textContent).not.toContain("小说正文与段落润色");
    });

    it("Popover 控制条关闭与打开同步更新登记 model", async () => {
        const {host, input} = await mountFixture("ModelPickerPopover", "default");
        const toggle = host.querySelector('[aria-label="切换弹层打开状态"]') as HTMLElement;
        toggle.click();
        await vue.nextTick();
        expect(input.value.model?.open).toBe(false);
        toggle.click();
        await vue.nextTick();
        expect(input.value.model?.open).toBe(true);
    });
});
