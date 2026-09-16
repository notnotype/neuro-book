// @vitest-environment jsdom
/**
 * 探针 P3（jsdom + 真组件，不启动任何产品服务）：**宿主驱动**的展开态（`openMenu` 由 v-model 直接给值、
 * 没有经过任何点击/按键）下面板还能不能定位到锚点下。
 *
 * 试图证伪的声明：
 *   1. `DesktopTitleBarChrome.md`「布局」：下拉层传送后**自带 `position: fixed` 坐标（贴着触发按钮下沿）**；
 *   2. t50 实施记录 §六：Lab 场景是「portal / outside / Escape / 焦点 / 方向键」的证据面——Lab 场景
 *      `openMenu: "File"` / `"View"` / `"Edit"` 全部走宿主驱动这条路径（fixture:78-80 `watch(props.scene)` 直接写 `openMenu`）。
 *
 * **修复轮更新（R3 后）**：首轮在这里实测到「受控路径面板无定位」（内联 style 为空 + 样式表无 position）
 * 并交回 t50；实现者加了 `anchorForOpenMenu()`（按菜单名回查触发按钮）。第三段改为断言修复后的口径；
 * 第四段继续探 `openMenu: "project"` 这条分支（标题栏里 Project 触发按钮**没有** `data-menu-button` 属性）。
 *
 * 运行（cwd = worktree 根）：
 *   bunx vitest run --reporter=verbose --silent false --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/vitest.probe.config.ts
 */
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, ref} from "vue";
import DesktopTitleBarChrome from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import type {TitleBarHostCapabilities} from "nbook/app/utils/workbench-chrome";

const mounted: VueWrapper[] = [];

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function mountChrome(initialMenu: string | null): {openMenu: ReturnType<typeof ref<string | null>>} {
    const openMenu = ref<string | null>(initialMenu);
    const capabilities: TitleBarHostCapabilities = {desktop: false, surfaceActive: true, editTarget: "native"};
    const wrapper = mount(defineComponent({
        setup() {
            return () => h(DesktopTitleBarChrome, {
                openMenu: openMenu.value,
                "onUpdate:openMenu": (value: string | null) => {
                    openMenu.value = value;
                },
                title: "命定之诗 — NeuroBook",
                projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                currentProjectRoot: "novels/destiny-poem",
                capabilities,
                projectUrl: (projectRoot: string | null) => projectRoot === null ? "/" : `/?project=${projectRoot}`,
                agentPanelAvailable: true,
                agentPanelOpen: false,
                rendererMenus: true,
                customWindowControls: false,
                connection: null,
            });
        },
    }), {attachTo: document.body});
    mounted.push(wrapper);
    return {openMenu};
}

function panel(name = "group"): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-titlebar-menu-panel="${name}"]`);
}

/** SFC 里 `.desktop-title-bar__dropdown` 规则体：面板在样式表里还剩哪些定位属性。 */
function dropdownRule(): string {
    const candidates = [
        "packages/neuro-book/app/components/common/DesktopTitleBarChrome.vue",
        "app/components/common/DesktopTitleBarChrome.vue",
    ].map((candidate) => resolve(process.cwd(), candidate));
    const path = candidates.find((candidate) => existsSync(candidate));
    if (path === undefined) throw new Error(`找不到 DesktopTitleBarChrome.vue；尝试过：${candidates.join(" | ")}`);
    const source = readFileSync(path, "utf8");
    const match = /\.desktop-title-bar__dropdown \{[^}]*\}/u.exec(source);
    if (match === null) throw new Error("找不到 .desktop-title-bar__dropdown 规则");
    return match[0];
}

describe("P3 宿主驱动展开态下的面板定位", () => {
    it("样式表里已无绝对定位：面板的坐标只能来自内联 style", () => {
        const rule = dropdownRule();
        console.log(`[P3/CSS] ${rule.replace(/\s+/gu, " ").trim()}`);
        expect(rule.includes("position")).toBe(false);
        expect(rule.includes("top:")).toBe(false);
        expect(rule.includes("left:")).toBe(false);
    });

    it("点击路径：面板带 position: fixed 与锚点算出的 top / left", async () => {
        const {openMenu} = mountChrome(null);
        const trigger = document.querySelector<HTMLElement>('[data-menu-button="View"]');
        expect(trigger).not.toBeNull();
        trigger!.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
        await Promise.resolve();
        await Promise.resolve();
        const opened = panel();
        expect(opened).not.toBeNull();
        const style = opened!.getAttribute("style") ?? "";
        console.log(`[P3/click] openMenu=${String(openMenu.value)}；面板内联 style=${JSON.stringify(style)}`);
        expect(style).toContain("position: fixed");
        expect(style).toContain("top:");
        expect(style).toContain("left:");
    });

    it("宿主驱动路径（Lab 场景 openMenu 预置）：面板照样带 position: fixed 与触发按钮坐标", async () => {
        const {openMenu} = mountChrome("View");
        await Promise.resolve();
        await Promise.resolve();
        const opened = panel();
        expect(opened).not.toBeNull();
        const style = opened!.getAttribute("style") ?? "";
        const rule = dropdownRule();
        console.log(`[P3/host] openMenu=${String(openMenu.value)}；面板内联 style=${JSON.stringify(style)}`);
        console.log(`[P3/host] 面板父节点=${String(opened!.parentElement?.tagName)}；样式表是否提供定位=${String(rule.includes("position"))}`);
        expect(opened!.parentElement).toBe(document.body);
        expect(style).toContain("position: fixed");
        expect(style).toContain("top:");
        expect(style).toContain("left:");
        expect(rule.includes("position")).toBe(false);
    });

    it("宿主驱动 openMenu=\"project\"：Project 面板仍然没有定位（R3 残留分支）", async () => {
        mountChrome("project");
        await Promise.resolve();
        await Promise.resolve();
        const opened = panel("project");
        expect(opened).not.toBeNull();
        const style = opened!.getAttribute("style") ?? "";
        const trigger = document.querySelector('[data-titlebar-action="project-switcher"]');
        console.log(`[P3/project] 面板内联 style=${JSON.stringify(style)}；Project 触发按钮是否有 data-menu-button=${String(trigger?.hasAttribute("data-menu-button") ?? null)}`);
        expect(trigger).not.toBeNull();
        expect(trigger!.hasAttribute("data-menu-button")).toBe(false);
        expect(style.includes("position")).toBe(false);
    });
});
