// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import ProjectPickerViewFixture from "./ProjectPickerViewFixture.vue";
import {projectPickerViewScenes} from "./SettingsProject.scenes";
import {LAB_INPUT_SINK, LAB_EVENT_SINK} from "../lab-event-sink";
const mounted: App[] = [];

function mountScene(host: HTMLElement, scene: string) {
    const definition = projectPickerViewScenes.find((entry) => entry.id === scene);
    if (!definition) throw new Error(`未登记 ProjectPickerView 场景：${scene}`);
    const input = ref(structuredClone(definition.input));
    const app = createApp(defineComponent({setup: () => () => h(ProjectPickerViewFixture, {scene, input: input.value})}));
    app.provide(LAB_INPUT_SINK, (layer, key, value) => {
        input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
    });
    app.provide(LAB_EVENT_SINK, () => {});
    mounted.push(app);
    app.mount(host);
    return {input, app};
}

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (params?.title) return `${key}:${String(params.title)}`;
            if (params?.count !== undefined) return `${key}:${String(params.count)}`;
            return key;
        },
        locale: {value: "zh-CN"},
    }));
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe("ProjectPickerViewFixture", () => {
    it("default 场景渲染书架卡片并支持打开与删除", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        mountScene(host, "default");

        const cards = host.querySelectorAll("[data-project-card]");
        expect(cards.length).toBe(14);
        const firstCard = cards[0];
        expect(firstCard).toBeDefined();

        // 点击第一本书
        const openBtn = firstCard?.querySelector<HTMLButtonElement>("button");
        expect(openBtn).not.toBeNull();
        openBtn?.click();
        await nextTick();

        // 验证删除
        const deleteBtn = firstCard?.querySelectorAll<HTMLButtonElement>("button")[2];
        expect(deleteBtn).toBeDefined();
        deleteBtn?.click();
        await nextTick();

        expect(host.querySelectorAll("[data-project-card]").length).toBe(13);
    });

    it("empty 场景展示零项目空态", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "empty");
        await nextTick();

        expect(host.querySelectorAll("[data-project-card]").length).toBe(0);
        expect(host.textContent).toContain("ide.picker.emptyTitle");
    });

    it("create-dialog 场景唤起 DialogWindow 新建对话框并支持创建", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "create-dialog");
        await nextTick();

        const form = document.body.querySelector("[data-project-create-form]");
        expect(form).not.toBeNull();

        const titleInput = form!.querySelector<HTMLInputElement>("#create-book-title");
        expect(titleInput).not.toBeNull();
        titleInput!.value = "测试新书标题";
        titleInput!.dispatchEvent(new Event("input", {bubbles: true}));

        const submitBtn = document.body.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submitBtn).not.toBeNull();
        submitBtn!.click();
        await nextTick();

        // 新书已就地添加到卡片网格首位
        const cards = host.querySelectorAll("[data-project-card]");
        const firstCard = cards[0];
        expect(firstCard?.textContent).toContain("测试新书标题");
    });

    it("creating 场景展示创建中 loading 状态", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "creating");
        await nextTick();

        const form = document.body.querySelector("[data-project-create-form]");
        expect(form).not.toBeNull();
        const submitBtn = document.body.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submitBtn!.disabled).toBe(true);
        expect(submitBtn!.textContent).toContain("ide.bookshelf.creating");
    });

    it("loading 场景展示全局加载状态指示器", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "loading");

        expect(host.querySelector("[role='status']")).not.toBeNull();
        expect(host.textContent).toContain("ide.picker.loading");
    });

    it("load-error 场景展示错误提示与重试按钮", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "load-error");

        expect(host.querySelector("[role='alert']")).not.toBeNull();
        expect(host.textContent).toContain("ide.picker.loadFailed");
        expect(host.textContent).toContain("503 Service Unavailable");
    });

    it("封面图片加载失败时自动平滑回退到排版封面", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "default");

        const cards = host.querySelectorAll("[data-project-card]");
        const firstCard = cards[0];
        expect(firstCard).toBeDefined();

        const img = firstCard?.querySelector<HTMLImageElement>("img");
        expect(img).not.toBeNull();

        // 模拟网络或图片路径破损触发 error 事件
        img?.dispatchEvent(new Event("error"));
        await nextTick();

        // 原 img 移除，自动显示 fallback
        expect(firstCard?.querySelector("img")).toBeNull();
        expect(firstCard?.querySelector(".project-cover-fallback")).not.toBeNull();
        expect(firstCard?.querySelector(".project-cover-fallback")?.textContent).toContain("赛博霓虹：仿生纪元");
    });

    it("phone 场景正确渲染", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        mountScene(host, "phone");
        await nextTick();

        const labSubject = host.querySelector("[data-lab-subject]");
        expect(labSubject).not.toBeNull();
        expect(labSubject?.className).toContain("w-full");
    });

    it("支持切换至各个视图方案场景 (compact, editorial)", async () => {
        const scenes = ["compact", "editorial"] as const;
        for (const scene of scenes) {
            const host = document.createElement("div");
            document.body.append(host);

            mountScene(host, scene);
            await nextTick();

            if (scene === "compact") {
                expect(host.querySelector("[data-classic-compact-view]")).not.toBeNull();
            } else if (scene === "editorial") {
                expect(host.querySelector("[data-classic-editorial-view]")).not.toBeNull();
            }
        }
    });

    it("密集列表与宽幅图文遇到封面加载失败时平滑回退，不产生裂图", async () => {
        for (const scene of ["compact", "editorial"] as const) {
            const host = document.createElement("div");
            document.body.append(host);

            mountScene(host, scene);
            await nextTick();

            const img = host.querySelector<HTMLImageElement>("img");
            expect(img).not.toBeNull();

            // 触发错误事件
            img?.dispatchEvent(new Event("error"));
            await nextTick();

            // 确保图片标签安全回退，不产生裂图
            const selector = scene === "compact" ? "[data-classic-compact-view]" : "[data-classic-editorial-view]";
            const viewRoot = host.querySelector(selector);
            expect(viewRoot).not.toBeNull();
            expect(viewRoot?.textContent).toContain("赛博霓虹");
        }
    });
});
