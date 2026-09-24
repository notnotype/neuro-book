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
    globals.useI18n = () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (params && typeof params.answered !== "undefined") {
                return `已回答 ${params.answered} / ${params.total}`;
            }
            if (key === "agent.userInput.next") return "下一条";
            if (key === "agent.userInput.submitAll") return "确认并提交";
            if (key === "agent.userInput.pendingTitle") return "等待你的处理";
            if (key === "agent.userInput.terminateRun") return "终止本轮";
            if (key === "agent.userInput.otherAnswer") return "其他答案";
            return key;
        },
    });
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

describe("AgentUserInputPromptFixture 挂载与输入输出契约验证", {timeout: 20000}, () => {
    async function mountFixture(scene: string, data?: unknown) {
        const {default: AgentUserInputPromptFixture} = await import("./AgentUserInputPromptFixture.vue");
        const {LAB_DATA_SINK, LAB_EVENT_SINK} = await import("../lab-event-sink");

        const host = document.createElement("div");
        document.body.append(host);

        const dataSnapshots: unknown[] = [];
        const eventSnapshots: Array<{name: string; payload?: unknown}> = [];

        const pinia = createPinia();
        const app = vue.createApp(AgentUserInputPromptFixture as Component, {scene, data});
        app.use(pinia);
        app.provide(LAB_DATA_SINK, (val: unknown) => dataSnapshots.push(val));
        app.provide(LAB_EVENT_SINK, (name: string, payload?: unknown) => eventSnapshots.push({name, payload}));
        mounted.push(app);
        app.mount(host);

        await vue.nextTick();
        return {host, app, dataSnapshots, eventSnapshots};
    }

    it("正常挂载 single-choice 场景，标记 data-lab-subject 并正确渲染单选题", async () => {
        const {host, dataSnapshots} = await mountFixture("single-choice");
        const subject = host.querySelector("[data-lab-subject]");
        expect(subject).not.toBeNull();
        expect(host.textContent).toContain("接下来这一幕你希望以谁的视角展开叙述？");
        expect(host.textContent).toContain("主角（第一人称感知）");
        expect(host.textContent).toContain("观察者（第三人称全知）");
        expect(host.textContent).toContain("对手（限知视角）");

        // 验证单题情况下主按钮文案为“确认并提交”，未选时 disabled
        const primaryBtn = host.querySelector("button:last-child");
        expect(primaryBtn?.textContent).toContain("确认并提交");
        expect(primaryBtn?.hasAttribute("disabled")).toBe(true);

        // 验证终止按钮为 ban 图标而非空方形
        const terminateIcon = host.querySelector(".i-lucide-ban");
        expect(terminateIcon).not.toBeNull();

        // 验证 useLabDataSink 正确捕获并上报了数据
        expect(dataSnapshots.length).toBeGreaterThan(0);
        const latest = dataSnapshots.at(-1) as Record<string, unknown>;
        expect(latest.scene).toBe("single-choice");
        expect(latest.questionsCount).toBe(1);
    });

    it("支持通过 props.data 自定义题目并在组件中即时响应渲染", async () => {
        const customData = {
            questions: [
                {
                    header: "自定义测试分类",
                    question: "你希望故事的结局是开放式还是闭环？",
                    options: [
                        {label: "完全闭环大团圆", description: "交代所有人物命运"},
                        {label: "留白开放式", description: "引人遐思"},
                    ],
                },
            ],
        };
        const {host} = await mountFixture("single-choice", customData);
        expect(host.textContent).toContain("你希望故事的结局是开放式还是闭环？");
        expect(host.textContent).toContain("完全闭环大团圆");
        expect(host.textContent).toContain("留白开放式");
    });

    it("挂载 open-ended 简答题场景时，正确呈现开放式回答", async () => {
        const {host} = await mountFixture("open-ended");
        expect(host.textContent).toContain("请简述这一章你想表达的核心主题与关键情节转折：");
    });

    it("挂载 blocked 阻断场景时，正确显示危险警示横幅", async () => {
        const {host} = await mountFixture("blocked");
        expect(host.textContent).toContain("当前正在执行正文生成，请等待当前生成结束或中止后再回答。");
    });
});
