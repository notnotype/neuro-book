// @vitest-environment jsdom
import {createApp, nextTick} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import ProjectPickerViewFixture from "./ProjectPickerViewFixture.vue";

const mounted: App[] = [];

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
        const events: Array<{name: string; payload?: unknown}> = [];

        const app = createApp(ProjectPickerViewFixture, {sceneId: "default"});
        mounted.push(app);
        const vm = app.mount(host);

        // 监听 fixture 向上派发的 event
        (vm as any).$emit = (name: string, payload?: unknown) => {
            events.push({name, payload});
        };

        const cards = host.querySelectorAll("[data-project-card]");
        expect(cards.length).toBe(5);
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

        expect(host.querySelectorAll("[data-project-card]").length).toBe(4);
    });

    it("empty 场景展示零项目空态", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {scene: "empty"});
        mounted.push(app);
        app.mount(host);
        await nextTick();

        expect(host.querySelectorAll("[data-project-card]").length).toBe(0);
        expect(host.textContent).toContain("ide.picker.emptyTitle");
    });

    it("create-dialog 场景唤起 DialogWindow 新建对话框并支持创建", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {scene: "create-dialog"});
        mounted.push(app);
        app.mount(host);
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

        const app = createApp(ProjectPickerViewFixture, {scene: "creating"});
        mounted.push(app);
        app.mount(host);
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

        const app = createApp(ProjectPickerViewFixture, {scene: "loading"});
        mounted.push(app);
        app.mount(host);

        expect(host.querySelector("[role='status']")).not.toBeNull();
        expect(host.textContent).toContain("ide.picker.loading");
    });

    it("load-error 场景展示错误提示与重试按钮", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {scene: "load-error"});
        mounted.push(app);
        app.mount(host);

        expect(host.querySelector("[role='alert']")).not.toBeNull();
        expect(host.textContent).toContain("ide.picker.loadFailed");
        expect(host.textContent).toContain("503 Service Unavailable");
    });

    it("封面图片加载失败时自动平滑回退到排版封面", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {scene: "default"});
        mounted.push(app);
        app.mount(host);

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

    it("phone 场景包含 390 移动视口约束", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {scene: "phone"});
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const labSubject = host.querySelector("[data-lab-subject]");
        expect(labSubject?.className).toContain("max-w-[390px]");
    });

    it("支持切换至各个典藏设计方案场景 (walnut-shelf, velvet-lectern, gilded-folio)", async () => {
        const scenes = ["walnut-shelf", "velvet-lectern", "gilded-folio"] as const;
        for (const scene of scenes) {
            const host = document.createElement("div");
            document.body.append(host);

            const app = createApp(ProjectPickerViewFixture, {scene});
            mounted.push(app);
            app.mount(host);
            await nextTick();

            if (scene === "walnut-shelf") {
                expect(host.querySelector("[data-walnut-shelf-collector-view]")).not.toBeNull();
            } else if (scene === "velvet-lectern") {
                expect(host.querySelector("[data-velvet-lectern-collector-view]")).not.toBeNull();
            } else if (scene === "gilded-folio") {
                expect(host.querySelector("[data-gilded-folio-collector-view]")).not.toBeNull();
            }
        }
    });
});
