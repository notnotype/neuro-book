// @vitest-environment jsdom
import {createPinia, setActivePinia} from "pinia";
import * as vue from "vue";
import {createApp, defineComponent, h, ref, type App, type Component} from "vue";
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {
    agentModeSessionSidebarScenes,
    agentSessionAttachmentPanelScenes,
    agentSessionDialogScenes,
    agentSessionTreeDialogScenes,
    agentWorkspaceChangesScenes,
} from "./AgentExtraPanels.scenes";
import AgentWorkspaceChangesFixture from "./AgentWorkspaceChangesFixture.vue";
import AgentSessionDialogFixture from "./AgentSessionDialogFixture.vue";
import AgentSessionTreeDialogFixture from "./AgentSessionTreeDialogFixture.vue";
import AgentSessionAttachmentPanelFixture from "./AgentSessionAttachmentPanelFixture.vue";
import AgentModeSessionSidebarFixture from "./AgentModeSessionSidebarFixture.vue";
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

async function mountSceneFixture(
    fixture: Component,
    scenes: ReadonlyArray<{id: string; input: LabSceneInput}>,
    scene: string,
) {
    const found = scenes.find((entry) => entry.id === scene);
    if (!found) throw new Error(`缺少场景 ${scene}`);
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
    app.provide(LAB_EVENT_SINK, (name, payload) => {
        events.push({name, payload});
    });
    mounted.push(app);
    app.mount(host);
    await vue.nextTick();
    await vue.nextTick();
    return {host, input, events};
}

describe("AgentSidebarView 5 个子组件 Fixture 规范与交互验证", () => {
    it("AgentWorkspaceChangesFixture：渲染变更分组与内联 Diff，点击分组切换 selectedPath", async () => {
        const {host, input, events} = await mountSceneFixture(
            AgentWorkspaceChangesFixture,
            agentWorkspaceChangesScenes,
            "expanded-diff",
        );

        expect(host.querySelector("[data-lab-subject]")).not.toBeNull();
        expect(host.textContent).toContain("chapters/chapter-01.md");
        expect(host.textContent).toContain("青铜齿轮咬合的闷响穿透水雾");

        const secondFileBtn = [...host.querySelectorAll("button")].find((btn) =>
            btn.textContent?.includes("settings/characters/lin-yuan.md"),
        );
        expect(secondFileBtn).toBeDefined();
        secondFileBtn!.click();
        await vue.nextTick();

        expect(input.value.props?.selectedPath).toBe("settings/characters/lin-yuan.md");
        expect(events.some((event) => event.name === "select-group")).toBe(true);
    });

    it("AgentSessionDialogFixture：内联挂载 Dialog，展示会话列表并响应选中、归档与单次重置筛选事件", async () => {
        const {host, input, events} = await mountSceneFixture(
            AgentSessionDialogFixture,
            agentSessionDialogScenes,
            "populated",
        );

        expect(host.querySelector("[data-lab-subject]")).not.toBeNull();
        expect(host.textContent).toContain("第三幕雨夜钟楼决战细纲推演");
        expect(host.textContent).toContain("第一章第3节正文初稿生成");

        const childCard = [...host.querySelectorAll(".group")].find((el) =>
            el.textContent?.includes("第一章第3节正文初稿生成"),
        ) as HTMLElement | undefined;
        expect(childCard).toBeDefined();
        childCard!.click();
        await vue.nextTick();

        expect(input.value.props?.activeSessionId).toBe(102);
        expect(events.some((event) => event.name === "select" && event.payload === 102)).toBe(true);

        const restoreBtn = [...host.querySelectorAll("button")].find((btn) =>
            btn.getAttribute("title") === "agent.session.restore",
        );
        expect(restoreBtn).toBeDefined();
        expect(restoreBtn!.disabled).toBe(false);
        restoreBtn!.click();
        await vue.nextTick();
        expect(events.some((event) => event.name === "restore")).toBe(true);

        const searchInput = host.querySelector("input.nb-ui-native-input") as HTMLInputElement | null;
        expect(searchInput).not.toBeNull();
        searchInput!.value = "不存在的关键词";
        searchInput!.dispatchEvent(new Event("input"));
        await vue.nextTick();

        const refreshCountBeforeReset = events.filter((event) => event.name === "refresh").length;
        const resetBtn = [...host.querySelectorAll("button")].find((btn) =>
            btn.textContent?.includes("agent.session.resetFilters"),
        );
        expect(resetBtn).toBeDefined();
        resetBtn!.click();
        await vue.nextTick();

        const refreshCountAfterReset = events.filter((event) => event.name === "refresh").length;
        expect(refreshCountAfterReset - refreshCountBeforeReset).toBe(1);
    });

    it("AgentSessionTreeDialogFixture：内联挂载分支树 Dialog，支持节点选中与复制 ID 事件", async () => {
        const {host, events} = await mountSceneFixture(
            AgentSessionTreeDialogFixture,
            agentSessionTreeDialogScenes,
            "branching",
        );

        expect(host.querySelector("[data-lab-subject]")).not.toBeNull();
        expect(host.textContent).toContain("采用方案 B！顺着怀表暗码的线索继续展开第一节细纲。");

        const copyBtn = host.querySelector("button[title='agent.sessionTree.copyEntryId']") as HTMLButtonElement | null;
        expect(copyBtn).not.toBeNull();
        copyBtn!.click();
        await vue.nextTick();

        expect(events.some((event) => event.name === "copy-id" && event.payload === "entry-user-0006b")).toBe(true);
    });

    it("AgentSessionAttachmentPanelFixture：渲染图片缩略图与文档下载项，触发插入事件", async () => {
        const {host, events} = await mountSceneFixture(
            AgentSessionAttachmentPanelFixture,
            agentSessionAttachmentPanelScenes,
            "mixed",
        );

        const subjectEl = host.querySelector("[data-lab-subject]");
        expect(subjectEl).not.toBeNull();
        expect(host.textContent).toContain("clock_tower_sketch.png");
        expect(host.textContent).toContain("mist_harbor_chronicle.pdf");

        const insertBtn = [...host.querySelectorAll("button")].find((btn) =>
            btn.textContent?.includes("agent.attachments.insert"),
        );
        expect(insertBtn).toBeDefined();
        insertBtn!.click();
        await vue.nextTick();

        expect(events.some((event) => event.name === "insert")).toBe(true);
    });

    it("AgentModeSessionSidebarFixture：直接撑满 ViewportCanvas 视口盒子（无固定内联宽度），受控管理置顶与归档权限，并在收起态展示占位提示", async () => {
        const {host, input, events} = await mountSceneFixture(
            AgentModeSessionSidebarFixture,
            agentModeSessionSidebarScenes,
            "expanded",
        );

        const subjectEl = host.querySelector("[data-lab-subject]") as HTMLElement | null;
        expect(subjectEl).not.toBeNull();
        expect(subjectEl?.tagName).toBe("ASIDE");
        expect(subjectEl?.className).toContain("w-full");
        expect(subjectEl?.className).toContain("h-full");
        expect(subjectEl?.style.width).toBe("");
        expect(host.querySelector("button button")).toBeNull();
        expect(host.textContent).toContain("第三幕雨夜钟楼决战细纲推演");

        const archiveButtons = [...host.querySelectorAll("button[title='agent.session.archive']")] as HTMLButtonElement[];
        const archivedSessionBtn = archiveButtons.at(-1);
        expect(archivedSessionBtn?.disabled).toBe(true);

        const pinBtn = host.querySelector("button[title='agent.session.pin']") as HTMLButtonElement | null;
        expect(pinBtn).not.toBeNull();
        pinBtn!.click();
        await vue.nextTick();

        expect(events.some((event) => event.name === "update:pinnedSessionIds")).toBe(true);
        expect(Array.isArray(input.value.model?.pinnedSessionIds)).toBe(true);
        expect((input.value.model?.pinnedSessionIds as number[]).length).toBeGreaterThan(1);

        const collapsedMount = await mountSceneFixture(
            AgentModeSessionSidebarFixture,
            agentModeSessionSidebarScenes,
            "collapsed",
        );
        expect(collapsedMount.host.textContent).toContain("Agent Mode 会话侧栏已收起");

        const emptyWorkspaceMount = await mountSceneFixture(
            AgentWorkspaceChangesFixture,
            agentWorkspaceChangesScenes,
            "collapsed",
        );
        emptyWorkspaceMount.input.value = {
            ...emptyWorkspaceMount.input.value,
            props: {...emptyWorkspaceMount.input.value.props, groups: []},
        };
        await vue.nextTick();
        expect(emptyWorkspaceMount.host.querySelector("[data-lab-subject]")).not.toBeNull();
        expect(emptyWorkspaceMount.host.textContent).toContain("当前无工作区文件变更（组件自动隐藏）");
    });
});
