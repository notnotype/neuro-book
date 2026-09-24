// @vitest-environment jsdom
import {createPinia, defineStore, setActivePinia} from "pinia";
import * as vue from "vue";
import type {App, Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";

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

describe("ModelPickerFixture 挂载与场景渲染验证", {timeout: 20000}, () => {
    async function mountFixture(scene: string) {
        const {default: ModelPickerFixture} = await import("./ModelPickerFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const pinia = createPinia();
        const app = vue.createApp(ModelPickerFixture as Component, {scene});
        app.use(pinia);
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);

        await vue.nextTick();
        return {host, app};
    }

    it("正常挂载 default 场景，渲染 popover 触发按钮与弹层", async () => {
        const {host} = await mountFixture("default");
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
        expect(host.textContent).toContain("主力");
    });

    it("挂载 content-only 场景，直接嵌入渲染 ModelPickerContent", async () => {
        const {host} = await mountFixture("content-only");
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
        expect(host.textContent).toContain("Claude 3.7 Sonnet");
        expect(host.textContent).toContain("极轻量");
        expect(host.textContent).toContain("深度");
    });

    it("挂载 gradient-only 场景，仅显示梯度轴角色", async () => {
        const {host} = await mountFixture("gradient-only");
        expect(host.textContent).toContain("极轻量");
        expect(host.textContent).toContain("主力");
        expect(host.textContent).not.toContain("小说正文与段落润色");
    });

    it("挂载 specialist-enabled 场景，同时显示专精轴角色", async () => {
        const {host} = await mountFixture("specialist-enabled");
        expect(host.textContent).toContain("写作");
        expect(host.textContent).toContain("叙事");
    });

    it("支持通过 props.data 响应式自定义数据并在组件中即时响应渲染", async () => {
        const {default: ModelPickerFixture} = await import("./ModelPickerFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const dataRef = vue.ref({
            selectedValue: "role:deep",
            thinkingLevel: "max",
            showSpecialist: true,
        });

        const RootComponent = vue.defineComponent({
            setup() {
                return () => vue.h(ModelPickerFixture as Component, {
                    scene: "content-only",
                    data: dataRef.value,
                });
            },
        });

        const pinia = createPinia();
        const app = vue.createApp(RootComponent);
        app.use(pinia);
        app.provide(LAB_DATA_SINK, () => {});
        app.provide(LAB_EVENT_SINK, () => {});
        mounted.push(app);
        app.mount(host);

        await vue.nextTick();
        expect(host.textContent).toContain("深度");
        expect(host.textContent).toContain("最大满载");

        // 修改 data 中的假数据，组件实时响应
        dataRef.value = {
            selectedValue: "role:fast",
            thinkingLevel: "off",
            showSpecialist: false,
        };
        await vue.nextTick();
        expect(host.textContent).toContain("快速");
        expect(host.textContent).toContain("关闭思考");
        expect(host.textContent).not.toContain("小说正文与段落润色");
    });
});
