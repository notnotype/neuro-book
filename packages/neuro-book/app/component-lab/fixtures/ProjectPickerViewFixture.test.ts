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

        const app = createApp(ProjectPickerViewFixture, {sceneId: "empty"});
        mounted.push(app);
        app.mount(host);

        expect(host.querySelectorAll("[data-project-card]").length).toBe(0);
        expect(host.textContent).toContain("ide.picker.emptyTitle");
    });

    it("create-open 场景展开就地新建表单并支持创建", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {sceneId: "create-open"});
        mounted.push(app);
        app.mount(host);

        const form = host.querySelector("[data-project-create-form]");
        expect(form).not.toBeNull();

        const titleInput = form!.querySelector<HTMLInputElement>("#create-book-title");
        expect(titleInput).not.toBeNull();
        titleInput!.value = "测试新书标题";
        titleInput!.dispatchEvent(new Event("input", {bubbles: true}));

        const submitBtn = form!.querySelector<HTMLButtonElement>("button[type='submit']");
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

        const app = createApp(ProjectPickerViewFixture, {sceneId: "creating"});
        mounted.push(app);
        app.mount(host);

        const form = host.querySelector("[data-project-create-form]");
        expect(form).not.toBeNull();
        const submitBtn = form!.querySelector<HTMLButtonElement>("button[type='submit']");
        expect(submitBtn!.disabled).toBe(true);
        expect(form!.textContent).toContain("ide.bookshelf.creating");
    });

    it("loading 场景展示全局加载状态指示器", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {sceneId: "loading"});
        mounted.push(app);
        app.mount(host);

        expect(host.querySelector("[role='status']")).not.toBeNull();
        expect(host.textContent).toContain("ide.picker.loading");
    });

    it("load-error 场景展示错误提示与重试按钮", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {sceneId: "load-error"});
        mounted.push(app);
        app.mount(host);

        expect(host.querySelector("[role='alert']")).not.toBeNull();
        expect(host.textContent).toContain("ide.picker.loadFailed");
        expect(host.textContent).toContain("503 Service Unavailable");
    });

    it("recovery 场景默认展开并支持归属分配", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {sceneId: "recovery"});
        mounted.push(app);
        app.mount(host);

        const recoveryArticles = host.querySelectorAll("article.rounded-\\[var\\(--radius-control\\)\\]");
        expect(recoveryArticles.length).toBe(2);
        expect(host.textContent).toContain("第十二章 暴风雨前夜细化");

        // 设为工作区会话
        const firstArticle = recoveryArticles[0];
        expect(firstArticle).toBeDefined();
        const workspaceBtn = firstArticle?.querySelectorAll<HTMLButtonElement>("button")[1];
        expect(workspaceBtn).toBeDefined();
        workspaceBtn?.click();
        await nextTick();

        // 列表中被恢复的 session 已移除
        expect(host.querySelectorAll("article.rounded-\\[var\\(--radius-control\\)\\]").length).toBe(1);
    });

    it("phone 场景包含 390 移动视口约束", async () => {
        const host = document.createElement("div");
        document.body.append(host);

        const app = createApp(ProjectPickerViewFixture, {sceneId: "phone"});
        mounted.push(app);
        app.mount(host);

        const labSubject = host.querySelector("[data-lab-subject]");
        expect(labSubject?.className).toContain("max-w-[390px]");
    });
});
