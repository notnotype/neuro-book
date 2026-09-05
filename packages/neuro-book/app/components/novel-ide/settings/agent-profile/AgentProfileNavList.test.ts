// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App, Ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import AgentProfileNavList from "./AgentProfileNavList.vue";
import type {AgentProfileNavItem} from "./AgentProfileNavList.types";

const mounted: App[] = [];

const translations: Record<string, string> = {
    "settings.panels.profileModels.nav.defaults": "默认设置",
    "settings.panels.profileModels.nav.defaultsDescription": "所有 Profile 的继承基线",
    "settings.panels.profileModels.nav.searchPlaceholder": "搜索 Profile",
    "settings.panels.profileModels.nav.noMatch": "没有匹配的 Profile",
    "settings.panels.profileModels.nav.empty": "没有可配置的 Profile",
    "settings.panels.profileModels.nav.profilesHint": "点击 Profile 覆盖它的参数",
    "settings.panels.profileModels.overrideCount": "已覆盖 {count} 项",
    "settings.panels.profileModels.unsavedChanges": "有未保存的修改",
    "settings.panels.profileModels.currentDefault": "当前默认",
    "settings.panels.profileModels.status.loaded": "已加载",
    "settings.panels.profileModels.status.compiling": "编译中",
    "settings.panels.profileModels.status.compile_failed": "编译失败",
    "settings.panels.profileModels.status.not_compiled": "未编译",
    "settings.panels.profileModels.status.compile_stale": "需要重新编译",
    "settings.panels.profileModels.status.compiled_load_failed": "加载失败",
    "settings.panels.profileModels.status.source_error": "源文件错误",
};

const translator = (key: string, params?: Record<string, unknown>): string => {
    const text = translations[key] ?? key;
    return text.replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? `{${name}}`));
};

type MountOptions = {
    items: AgentProfileNavItem[];
    activeKey: string;
    search: string;
    defaultsDirty: boolean;
};

type MountedNav = {
    host: HTMLElement;
    app: App;
    activeKey: Ref<string>;
    search: Ref<string>;
    activePayloads: string[];
    searchPayloads: string[];
};

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: translator}));
});

afterEach(() => {
    for (const app of mounted.splice(0)) {
        app.unmount();
    }
    document.body.replaceChildren();
});

function mountNav(initial: MountOptions): MountedNav {
    const host = document.createElement("div");
    document.body.append(host);
    const activeKey = ref(initial.activeKey);
    const search = ref(initial.search);
    const activePayloads: string[] = [];
    const searchPayloads: string[] = [];
    const app = createApp(defineComponent({
        setup() {
            return () => h(AgentProfileNavList, {
                items: initial.items,
                activeKey: activeKey.value,
                search: search.value,
                defaultsDirty: initial.defaultsDirty,
                "onUpdate:activeKey": (value: string) => {
                    activePayloads.push(value);
                    activeKey.value = value;
                },
                "onUpdate:search": (value: string) => {
                    searchPayloads.push(value);
                    search.value = value;
                },
            });
        },
    }));
    mounted.push(app);
    app.mount(host);
    return {host, app, activeKey, search, activePayloads, searchPayloads};
}

function item(overrides: Partial<AgentProfileNavItem> = {}): AgentProfileNavItem {
    return {
        profileKey: "writer",
        name: "Writer",
        status: "loaded",
        overrideCount: 0,
        dirty: false,
        isDefault: false,
        ...overrides,
    };
}

function inputOf(host: HTMLElement): HTMLInputElement {
    const input = host.querySelector("input[type='search']");
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
}

function enterSearch(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

describe("AgentProfileNavList", () => {
    it("按 name 和 profileKey 大小写不敏感过滤，默认入口始终可见并保留原始搜索值", async () => {
        const nav = mountNav({
            items: [item(), item({profileKey: "review-agent", name: "Editor"})],
            activeKey: "writer",
            search: "",
            defaultsDirty: false,
        });
        const input = inputOf(nav.host);

        enterSearch(input, "  EDITOR  ");
        await nextTick();

        expect(nav.searchPayloads).toEqual(["  EDITOR  "]);
        expect(nav.host.textContent).toContain("默认设置");
        expect(nav.host.textContent).toContain("review-agent");
        expect(nav.host.textContent).toContain("Editor");
        expect(nav.host.textContent).not.toContain("writer");
    });

    it("点击默认和 Profile 发出受控 key，重复点击与非 loaded 状态仍可选择", async () => {
        const nav = mountNav({
            items: [
                item({profileKey: "compiling", name: "Compiling", status: "compiling"}),
                item({profileKey: "failed", name: "Failed", status: "source_error"}),
            ],
            activeKey: "compiling",
            search: "",
            defaultsDirty: false,
        });

        const buttons = () => [...nav.host.querySelectorAll<HTMLButtonElement>("button")];
        buttons().find((button) => button.textContent?.includes("默认设置"))?.click();
        await nextTick();
        buttons().find((button) => button.textContent?.includes("Compiling"))?.click();
        await nextTick();
        buttons().find((button) => button.textContent?.includes("Compiling"))?.click();
        buttons().find((button) => button.textContent?.includes("Failed"))?.click();

        expect(nav.activePayloads).toEqual(["", "compiling", "compiling", "failed"]);
        expect(nav.activeKey.value).toBe("failed");
    });

    it("只为可见的当前入口输出 aria-current，过滤或未知 key 不伪造 current", async () => {
        const nav = mountNav({
            items: [item(), item({profileKey: "editor", name: "Editor"})],
            activeKey: "editor",
            search: "",
            defaultsDirty: false,
        });

        expect(nav.host.querySelectorAll("[aria-current='page']")).toHaveLength(1);
        expect(nav.host.querySelector("[aria-current='page']")?.textContent).toContain("editor");

        enterSearch(inputOf(nav.host), "writer");
        await nextTick();
        expect(nav.host.querySelectorAll("[aria-current='page']")).toHaveLength(0);

        nav.activeKey.value = "missing";
        await nextTick();
        expect(nav.host.querySelectorAll("[aria-current='page']")).toHaveLength(0);
    });

    it("建立 nav、标题、可见搜索 label 与 input 的 ARIA 关联", () => {
        const nav = mountNav({items: [item()], activeKey: "", search: "", defaultsDirty: false});
        const root = nav.host.querySelector("nav");
        const heading = nav.host.querySelector("h2");
        const label = nav.host.querySelector("label");
        const input = inputOf(nav.host);

        expect(root).not.toBeNull();
        expect(heading?.textContent).toContain("Agent Profiles");
        expect(root?.getAttribute("aria-labelledby")).toBe(heading?.id);
        expect(label?.textContent).toContain("搜索 Profile");
        expect(label?.getAttribute("for")).toBe(input.id);
    });

    it("七种状态使用 success 1、accent 1、warning 2、danger 3 的 Badge tone", () => {
        const statuses: AgentProfileNavItem["status"][] = [
            "loaded",
            "compiling",
            "not_compiled",
            "compile_stale",
            "compile_failed",
            "compiled_load_failed",
            "source_error",
        ];
        const nav = mountNav({
            items: statuses.map((status, index) => item({profileKey: `p${index}`, name: `Profile ${index}`, status})),
            activeKey: "",
            search: "",
            defaultsDirty: false,
        });
        const badges = [...nav.host.querySelectorAll<HTMLElement>(".nb-badge")];

        expect(badges).toHaveLength(7);
        expect(badges.filter((badge) => badge.classList.contains("nb-badge--success"))).toHaveLength(1);
        expect(badges.filter((badge) => badge.classList.contains("nb-badge--accent"))).toHaveLength(1);
        expect(badges.filter((badge) => badge.classList.contains("nb-badge--warning"))).toHaveLength(2);
        expect(badges.filter((badge) => badge.classList.contains("nb-badge--danger"))).toHaveLength(3);
        expect(nav.host.textContent).toContain("已加载");
        expect(nav.host.textContent).toContain("编译中");
        expect(nav.host.textContent).toContain("未编译");
        expect(nav.host.textContent).toContain("需要重新编译");
        expect(nav.host.textContent).toContain("编译失败");
        expect(nav.host.textContent).toContain("加载失败");
        expect(nav.host.textContent).toContain("源文件错误");
    });

    it("将默认、dirty、覆盖数和默认页未保存状态表达为可读 Badge，零覆盖不显示", () => {
        const nav = mountNav({
            items: [item({isDefault: true, dirty: true, overrideCount: 3})],
            activeKey: "",
            search: "",
            defaultsDirty: true,
        });

        expect(nav.host.textContent).toContain("当前默认");
        expect(nav.host.textContent).toContain("有未保存的修改");
        expect(nav.host.textContent).toContain("已覆盖 3 项");
        expect(nav.host.textContent).not.toContain("已覆盖 0 项");
    });

    it("空列表与无匹配态保留默认入口并允许通过编辑 input 恢复列表", async () => {
        const empty = mountNav({items: [], activeKey: "", search: "", defaultsDirty: false});
        expect(empty.host.textContent).toContain("没有可配置的 Profile");
        expect(empty.host.querySelector("button")?.textContent).toContain("默认设置");

        const noMatch = mountNav({
            items: [item({profileKey: "editor", name: "Editor"})],
            activeKey: "editor",
            search: "不存在",
            defaultsDirty: false,
        });
        expect(noMatch.host.textContent).toContain("没有匹配的 Profile");
        const input = inputOf(noMatch.host);
        input.focus();
        enterSearch(input, "");
        await nextTick();

        expect(noMatch.host.textContent).toContain("Editor");
        expect(document.activeElement).toBe(input);
        expect(noMatch.host.querySelector("[aria-label='清空输入']")).toBeNull();
    });

    it("所有装饰图标显式 aria-hidden，状态信息不依赖 title", () => {
        const nav = mountNav({
            items: [item({status: "compiling", isDefault: true, dirty: true, overrideCount: 2})],
            activeKey: "writer",
            search: "",
            defaultsDirty: true,
        });
        const icons = [...nav.host.querySelectorAll<HTMLElement>("[class*='i-lucide-']")];

        expect(icons.length).toBeGreaterThan(0);
        expect(icons.every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
        expect(nav.host.querySelector("[title='编译中']")).toBeNull();
        expect(nav.host.querySelector("[title='有未保存的修改']")).toBeNull();
    });
});
