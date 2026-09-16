// @vitest-environment jsdom
/**
 * 探针 P5（修复轮追加，jsdom + 产品代码原样）：独立复现 R1（编辑目标会话）与 R2（通知让位）。
 *
 * 试图证伪的声明（t50 修复轮）：
 *   R1a 焦点进标题栏（键盘路径）后 Edit 六条仍可用，且执行前会把焦点还给记忆的可编辑元素；
 *   R1b 记忆只在「最近一次真实可编辑焦点」上——元素已经不在文档里时不该再冒充可编辑；
 *   R2  通知视口的让位量按「标题栏真在场 + SHELL_TITLEBAR_HEIGHT」，浏览器档不再从 y=16 起画。
 *
 * 运行（cwd = worktree 根）：
 *   bunx vitest run --reporter=verbose --silent false --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/vitest.probe.config.ts
 */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {nextTick, ref} from "vue";
import {mount, type VueWrapper} from "@vue/test-utils";
import {useTitleBarEditTarget} from "nbook/app/composables/useTitleBarEditTarget";
import {markTitleBarPresent} from "nbook/app/composables/useTitleBarPresent";
import NotificationViewport from "nbook/app/components/common/NotificationViewport.vue";
import {SHELL_TITLEBAR_HEIGHT} from "nbook/app/utils/workbench/layout";
import {resolveTitleBarEditRoute, resolveTitleBarMenuGroups, type TitleBarEditTarget} from "nbook/app/utils/workbench-chrome";

const mounted: VueWrapper[] = [];
const created: HTMLElement[] = [];

beforeEach(() => {
    const states: Record<string, unknown> = {};
    vi.stubGlobal("useState", <T>(key: string, init: () => T) => {
        const existing = states[key];
        if (existing !== undefined) return existing;
        const createdState = ref(init());
        states[key] = createdState;
        return createdState;
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const node of created.splice(0)) node.remove();
    document.body.replaceChildren();
    markTitleBarPresent(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** 页面骨架：一个输入框 + 标题栏（含触发按钮与 Teleport 出去的面板）+ 页面上的普通按钮。 */
function pageTree(): {input: HTMLInputElement; trigger: HTMLButtonElement; panelItem: HTMLButtonElement; pageButton: HTMLButtonElement} {
    const host = document.createElement("div");
    const input = document.createElement("input");
    const bar = document.createElement("div");
    bar.className = "desktop-title-bar";
    const trigger = document.createElement("button");
    trigger.setAttribute("data-menu-button", "Edit");
    bar.append(trigger);
    const panel = document.createElement("div");
    panel.setAttribute("data-titlebar-menu-panel", "group");
    const panelItem = document.createElement("button");
    panel.append(panelItem);
    const pageButton = document.createElement("button");
    host.append(input, bar, panel, pageButton);
    document.body.append(host);
    created.push(host);
    return {input, trigger, panelItem, pageButton};
}

function editItems(target: TitleBarEditTarget) {
    return resolveTitleBarMenuGroups({desktop: false, surfaceActive: true, editTarget: target})
        .find((group) => group.label === "Edit")!.items;
}

describe("P5/R1 编辑目标会话", () => {
    it("R1a 键盘进标题栏（含面板）后沿用记忆目标：六条只禁用粘贴，执行前焦点还给输入框", async () => {
        const {input, trigger, panelItem, pageButton} = pageTree();
        const activeElement = ref<Element | null>(input);
        const session = useTitleBarEditTarget({editorActive: () => false, activeElement});
        await nextTick();

        const rows = (target: TitleBarEditTarget) => editItems(target).map((item) => [item.label, item.disabled]);
        console.log(`[P5/R1] 焦点在输入框：target=${session.target.value}；可点项=${String(editItems(session.target.value).filter((item) => !item.disabled).length)}`);
        expect(session.target.value).toBe("native");
        expect(rows(session.target.value)).toEqual([["撤销", false], ["重做", false], ["剪切", false], ["复制", false], ["粘贴", true], ["全选", false]]);

        activeElement.value = trigger;
        await nextTick();
        console.log(`[P5/R1] 键盘进标题栏（触发按钮）：target=${session.target.value}；titleBarOwnsFocus=${String(session.titleBarOwnsFocus.value)}；可点项=${String(editItems(session.target.value).filter((item) => !item.disabled).length)}`);
        expect(session.titleBarOwnsFocus.value).toBe(true);
        expect(session.target.value).toBe("native");
        expect(editItems(session.target.value).filter((item) => !item.disabled).length).toBe(5);
        expect(resolveTitleBarEditRoute("edit.undo", {desktop: false, surfaceActive: true, editTarget: session.target.value})).toBe("native");

        activeElement.value = panelItem;
        await nextTick();
        expect(session.target.value).toBe("native");

        // 执行前把焦点还给记忆元素（index.vue:311-316 的同一条路径）。
        expect(session.rememberedElement.value).toBe(input);
        pageButton.focus();
        session.rememberedElement.value?.focus();
        expect(document.activeElement).toBe(input);

        activeElement.value = pageButton;
        await nextTick();
        console.log(`[P5/R1] 焦点移到页面普通按钮：target=${session.target.value}（不得沿用记忆）`);
        expect(session.target.value).toBe("none");
    });

    it("R1b 记忆元素已从文档里移除时，标题栏不该再报可编辑", async () => {
        const {input, trigger} = pageTree();
        const activeElement = ref<Element | null>(input);
        const session = useTitleBarEditTarget({editorActive: () => false, activeElement});
        await nextTick();
        expect(session.target.value).toBe("native");

        // 真实过程：对话框/内联编辑器卸载，被记下的输入框离开文档（焦点回 body），随后键盘进标题栏。
        input.remove();
        activeElement.value = document.body;
        await nextTick();
        activeElement.value = trigger;
        await nextTick();

        const connected = session.rememberedElement.value?.isConnected ?? null;
        console.log(`[P5/R1b] 记忆元素 isConnected=${String(connected)}；键盘进标题栏后 target=${session.target.value}；可点项=${String(editItems(session.target.value).filter((item) => !item.disabled).length)}`);
        expect(session.target.value).toBe("none");
    });
});

/** `ClientOnly` 是 Nuxt 内建组件，vitest 里给一个直通替身。 */
const ClientOnlyStub = {setup: (_props: unknown, {slots}: {slots: {default?: () => unknown}}) => () => slots.default?.()};

describe("P5/R2 通知视口让位", () => {
    it("标题栏在场 → 容器让出 SHELL_TITLEBAR_HEIGHT；不在场 → 不留 top", () => {
        const withBar = mount(NotificationViewport, {props: {titlebar: true}, global: {stubs: {ClientOnly: ClientOnlyStub}}});
        mounted.push(withBar);
        const style = withBar.get(".pointer-events-none.fixed").attributes("style") ?? "";
        console.log(`[P5/R2] titlebar=true → 容器内联 style=${JSON.stringify(style)}；卡片首行 top=${String(SHELL_TITLEBAR_HEIGHT + 16)}（offsetY 默认 16）`);
        expect(style).toContain(`top: ${String(SHELL_TITLEBAR_HEIGHT)}px`);
        expect(SHELL_TITLEBAR_HEIGHT + 16).toBeGreaterThan(SHELL_TITLEBAR_HEIGHT);

        const withoutBar = mount(NotificationViewport, {props: {titlebar: false}, global: {stubs: {ClientOnly: ClientOnlyStub}}});
        mounted.push(withoutBar);
        const bare = withoutBar.get(".pointer-events-none.fixed").attributes("style") ?? "";
        console.log(`[P5/R2] titlebar=false → 容器内联 style=${JSON.stringify(bare)}`);
        expect(bare.includes("top:")).toBe(false);

        markTitleBarPresent(true);
        expect(withBar.get(".pointer-events-none.fixed").attributes("style")).toContain(`top: ${String(SHELL_TITLEBAR_HEIGHT)}px`);
    });
});
