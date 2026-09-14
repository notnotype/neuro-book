// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import ProjectPickerView from "./ProjectPickerView.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

const mounted: App[] = [];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (key === "ide.picker.projectCount") return `共 ${String(params?.count ?? 0)} 部作品`;
            if (key === "ide.picker.openProject") return `打开作品：${String(params?.title ?? "")}`;
            return {
                "ide.picker.title": "我的作品",
                "ide.picker.subtitle": "选择或创建本地作品工作区",
                "ide.picker.openUserAssets": "系统与用户资产",
                "ide.bookshelf.createBook": "新建作品",
                "ide.bookshelf.defaultTitle": "新作品",
                "ide.bookshelf.bookTitle": "作品名称",
                "ide.bookshelf.summary": "作品简介",
                "ide.bookshelf.cancel": "取消",
                "ide.bookshelf.create": "创建",
                "ide.bookshelf.creating": "创建中...",
                "ide.picker.loading": "正在读取作品列表...",
                "ide.picker.loadFailed": "读取作品列表失败",
                "ide.picker.retry": "重试",
                "ide.picker.emptyTitle": "还没有作品",
                "ide.picker.empty": "立即创建你的第一部作品，开启长篇写作旅程。",
                "ide.picker.recentProjects": "最近编辑",
                "ide.picker.recoveryTitle": "需要确认归属的会话",
                "ide.picker.recoverySummary": "版本迁移产生未关联的会话",
                "ide.picker.genreSelect": "作品题材",
                "ide.picker.previewBadge": "封面即时预览",
                "ide.picker.genres.general": "通用创作",
                "ide.picker.genres.xuanhuan": "玄幻修真",
                "ide.picker.genres.scifi": "科幻未来",
                "ide.picker.genres.urban": "都市职场",
                "ide.picker.genres.mystery": "悬疑惊悚",
                "ide.picker.genres.world": "世界设定",
            }[key] ?? key;
        },
        locale: ref("zh-CN"),
    }));
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

const SAMPLE_PROJECTS: ProjectMetadataDto[] = [
    {
        projectRoot: "workspace/projects/novel-a",
        kind: "novel",
        title: "第一部小说",
        summary: "这是第一部小说的简介",
        cover: undefined,
        manifestUpdatedAt: "2026-09-10T12:00:00Z",
    },
    {
        projectRoot: "workspace/projects/novel-b",
        kind: "novel",
        title: "第二部小说",
        summary: "这是第二部小说的简介",
        cover: "workspace/projects/novel-b/cover.png",
        manifestUpdatedAt: "2026-09-08T12:00:00Z",
    },
];

describe("ProjectPickerView", () => {
    it("renders project cards and project count in default mode", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: SAMPLE_PROJECTS,
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const cards = host.querySelectorAll("[data-project-card]");
        expect(cards.length).toBe(2);
        expect(host.textContent).toContain("第一部小说");
        expect(host.textContent).toContain("第二部小说");
        expect(host.textContent).toContain("共 2 部作品");
    });

    it("renders empty state when projects array is empty", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: [],
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        expect(host.textContent).toContain("还没有作品");
        expect(host.textContent).toContain("立即创建你的第一部作品");
    });

    it("renders full-screen loading state when isLoading is true", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: SAMPLE_PROJECTS,
                    isLoading: true,
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const statusSection = host.querySelector('[role="status"]');
        expect(statusSection).not.toBeNull();
        expect(statusSection?.textContent).toContain("正在读取作品列表...");
    });

    it("renders error state and emits retry-load when clicked", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const onRetryLoad = vi.fn();

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: [],
                    loadError: "500 Internal Server Error",
                    "onRetry-load": onRetryLoad,
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const alertSection = host.querySelector('[role="alert"]');
        expect(alertSection).not.toBeNull();
        expect(alertSection?.textContent).toContain("500 Internal Server Error");

        const retryButton = alertSection?.querySelector("button");
        expect(retryButton).not.toBeNull();
        retryButton?.click();
        expect(onRetryLoad).toHaveBeenCalledTimes(1);
    });

    it("emits open event when clicking a book card button", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const onOpen = vi.fn();

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: SAMPLE_PROJECTS,
                    onOpen,
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const firstCardButton = host.querySelector("[data-project-card] button") as HTMLButtonElement | null;
        expect(firstCardButton).not.toBeNull();
        firstCardButton?.click();

        expect(onOpen).toHaveBeenCalledWith("workspace/projects/novel-a");
    });

    it("shows create form when isCreateFormOpen is true and emits submit", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const onCreate = vi.fn();
        const onCancelCreateForm = vi.fn();

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: SAMPLE_PROJECTS,
                    isCreateFormOpen: true,
                    onCreate,
                    "onCancel-create-form": onCancelCreateForm,
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const form = document.body.querySelector("[data-project-create-form]");
        expect(form).not.toBeNull();

        const submitButton = document.body.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        expect(submitButton).not.toBeNull();
        submitButton?.click();

        expect(onCreate).toHaveBeenCalledWith({
            title: "新作品",
            summary: "",
            genre: "general",
        });

        // 验证表单中无未翻译裸 key 泄露
        expect(form?.textContent).not.toContain("ide.picker.genreSelect");
        expect(form?.textContent).not.toContain("ide.picker.previewBadge");
        expect(form?.textContent).toContain("作品题材");
        expect(form?.textContent).toContain("封面即时预览");
        expect(form?.textContent).toContain("通用创作");
    });

    it("renders bookshelf grid with container query classes for responsive mobile layout", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: SAMPLE_PROJECTS,
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        const grid = host.querySelector(".picker-bookshelf-grid");
        expect(grid).not.toBeNull();
        expect(grid?.children.length).toBe(2);

        const headerSection = host.querySelector(".picker-header-section");
        expect(headerSection).not.toBeNull();
    });

    it("renders corresponding view when layoutMode is specified", async () => {
        const layouts = [
            {mode: "compact" as const, selector: "[data-classic-compact-view]"},
            {mode: "editorial" as const, selector: "[data-classic-editorial-view]"},
            {mode: "classic-compact" as const, selector: "[data-classic-compact-view]"},
            {mode: "classic-editorial" as const, selector: "[data-classic-editorial-view]"},
        ];

        for (const {mode, selector} of layouts) {
            const host = document.createElement("div");
            document.body.appendChild(host);

            const app = createApp(defineComponent({
                setup() {
                    return () => h(ProjectPickerView, {
                        projects: SAMPLE_PROJECTS,
                        layoutMode: mode,
                    });
                },
            }));
            mounted.push(app);
            app.mount(host);
            await nextTick();

            expect(host.querySelector(selector)).not.toBeNull();
        }
    });

    it("supports custom slots for views", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const app = createApp(defineComponent({
            setup() {
                return () => h(ProjectPickerView, {
                    projects: SAMPLE_PROJECTS,
                    layoutMode: "compact",
                }, {
                    compact: () => h("div", {"data-custom-compact-slot": "true"}, "自定义列表视图"),
                });
            },
        }));
        mounted.push(app);
        app.mount(host);
        await nextTick();

        expect(host.querySelector("[data-custom-compact-slot]")).not.toBeNull();
        expect(host.textContent).toContain("自定义列表视图");
    });
});
