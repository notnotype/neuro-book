/**
 * 命令面板（workbench.quick-open 场景 1–6）：真实的 nb-ui QuickInput、真实的命令表与面板宿主。
 * QuickInput 的关闭交接跨一个宏任务，测试等可观察的结果（焦点归还、执行记录），不推进假时钟。
 */

import {mount} from "@vue/test-utils";
import {Type} from "typebox";
import {afterEach, describe, expect, it, vi} from "vitest";
import {nextTick, ref, shallowRef} from "vue";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import type {ContextValues} from "nbook/plugins/commands/shared/context-keys";
import type {CommandDeclaration, CommandExecutionEvent, CommandResult} from "nbook/plugins/commands/shared/contracts";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {createPaletteHost} from "../commands/palette-host";
import type {PaletteHost} from "../commands/palette-host";
import WorkbenchCommandPalette from "./WorkbenchCommandPalette.vue";

const target = {workspaceKey: "lab", generation: 1, documentId: "doc", path: "lab/doc.txt"};
const NO_ARGS = Type.Object({}, {additionalProperties: false});

let cleanups: Array<() => void> = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.innerHTML = "";
});

function harness() {
    const context = shallowRef<ContextValues>({});
    const registry = createCommandRegistry({
        contextKeys: contextTable({"editor-active": "需要活动编辑器", "editor-line-navigation": "当前编辑器不支持行号跳转"}, () => context.value),
        report: (error) => {
            throw error;
        },
    });
    const executed: CommandExecutionEvent[] = [];
    registry.onDidExecute((event) => executed.push(event));
    const locale = ref<DisplayLocale>("zh-CN");
    const host = createPaletteHost({commands: registry, locale});
    const opener = document.createElement("button");
    opener.textContent = "打开前的焦点";
    document.body.append(opener);
    const wrapper = mount(WorkbenchCommandPalette, {props: {host}, attachTo: document.body});
    cleanups.push(() => {
        wrapper.unmount();
        host.dispose();
    });
    const register = (id: string, declaration: Partial<CommandDeclaration> = {}, run: (args: unknown) => CommandResult<unknown> = () => ({ok: true, value: null})): void => {
        const result = registry.register({id, source: "nbook.test", declaration: {title: {"zh-CN": id, "en-US": id}, description: id, args: NO_ARGS, effect: "read", ...declaration}, run});
        if (!result.ok) throw new Error(result.reason);
    };
    return {host, context, executed, opener, register, locale};
}

async function open(host: PaletteHost, mode: "commands" | "line" = "commands"): Promise<void> {
    host.openPalette(mode);
    await vi.waitFor(() => expect(input()).not.toBeNull());
}

function input(): HTMLInputElement | null {
    return document.body.querySelector<HTMLInputElement>('[role="combobox"]');
}

function options(): string[] {
    return [...document.body.querySelectorAll('[role="option"]')].map((option) => option.id.split("-option-")[1] ?? "");
}

function selected(): string | null {
    return document.body.querySelector('[role="option"][aria-selected="true"]')?.id.split("-option-")[1] ?? null;
}

async function type(text: string): Promise<void> {
    const field = input();
    if (field === null) throw new Error("面板没有打开");
    field.value = text;
    field.dispatchEvent(new Event("input", {bubbles: true}));
    await nextTick();
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
    input()?.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true, ...init}));
    await nextTick();
}

describe("WorkbenchCommandPalette", () => {
    it("候选只含人类可见且当前可用的命令，可用性随上下文变化重算", async () => {
        const app = harness();
        app.register("nbook.edit.undo", {effect: "write", when: {requires: ["editor-active"]}});
        app.register("nbook.quick-open.open-commands", {expose: {human: false}});

        await open(app.host);
        expect(options()).toEqual([]);
        expect(document.body.textContent).toContain("没有匹配的命令");

        app.context.value = {"editor-active": true};
        await vi.waitFor(() => expect(options()).toEqual(["nbook.edit.undo"]));
    });

    it("Enter 先关面板、焦点归还后才执行一次并记入 MRU；方向键首尾回绕", async () => {
        const app = harness();
        for (const id of ["nbook.app.alpha", "nbook.app.beta", "nbook.app.gamma"]) app.register(id);
        app.opener.focus();
        await open(app.host);
        expect(selected()).toBe("nbook.app.alpha");
        await press("ArrowUp");
        expect(selected()).toBe("nbook.app.gamma");

        await press("Enter");
        await press("Enter");
        expect(app.host.open.value).toBe(false);
        expect(app.executed).toEqual([]);
        await vi.waitFor(() => expect(app.executed.map((event) => event.id)).toEqual(["nbook.app.gamma"]));
        expect(document.activeElement).toBe(app.opener);
        expect(app.host.recent.value).toEqual(["nbook.app.gamma"]);
    });

    it("输入法组合中的 Enter 不提交；Escape 只关面板，不传到下层，不执行", async () => {
        const app = harness();
        app.register("nbook.app.alpha");
        const lowerLayer: string[] = [];
        const onKeydown = (event: KeyboardEvent): void => {
            lowerLayer.push(event.key);
        };
        window.addEventListener("keydown", onKeydown);
        cleanups.push(() => window.removeEventListener("keydown", onKeydown));
        app.opener.focus();
        await open(app.host);

        await press("Enter", {isComposing: true});
        expect(app.host.open.value).toBe(true);
        await press("Escape");
        expect(app.host.open.value).toBe(false);
        expect(lowerLayer).not.toContain("Escape");
        await vi.waitFor(() => expect(document.activeElement).toBe(app.opener));
        expect(app.executed).toEqual([]);
    });

    it("行号模式：非法输入不产生候选并显示原因，合法行号执行 go-to-line", async () => {
        const app = harness();
        const received: unknown[] = [];
        app.register("nbook.editor.go-to-line", {
            args: Type.Object({target: Type.Object({}, {additionalProperties: true}), line: Type.Integer({minimum: 1})}, {additionalProperties: false}),
            expose: {human: false},
        }, (args) => {
            received.push(args);
            return {ok: true, value: null};
        });
        app.host.editor.value = {target, lineCount: () => 60};
        await open(app.host, "line");
        expect(input()?.value).toBe(":");
        expect(document.body.textContent).toContain("输入行号（1–60）");

        await type(":0");
        expect(options()).toEqual([]);
        expect(document.body.textContent).toContain("行号无效：0");
        await type(":61");
        expect(document.body.textContent).toContain("行号超出范围：61（共 60 行）");
        await type(":15");
        expect(options()).toEqual(["quick-open:line"]);
        expect(document.body.textContent).toContain("跳转到第 15 行");

        await press("Enter");
        await vi.waitFor(() => expect(received).toEqual([{target, line: 15}]));
        expect(app.host.recent.value).toEqual([]);
    });

    it("没有活动编辑器、编辑器不支持行号跳转时行号模式给出原因", async () => {
        const app = harness();
        await open(app.host, "line");
        expect(document.body.textContent).toContain("没有活动编辑器");
        app.host.closePalette();

        app.host.editor.value = {target, lineCount: null};
        await open(app.host, "line");
        expect(document.body.textContent).toContain("当前编辑器不支持行号跳转");
    });

    it("关闭期间活动文档换代：这次选择作废，不执行", async () => {
        const app = harness();
        app.register("nbook.edit.undo");
        app.host.editor.value = {target, lineCount: () => 3};
        app.opener.focus();
        await open(app.host);

        await press("Enter");
        app.host.editor.value = {target: {...target, generation: 2}, lineCount: () => 3};
        await vi.waitFor(() => expect(document.activeElement).toBe(app.opener));
        await nextTick();
        expect(app.executed).toEqual([]);
    });

    it("open-line 是同层切换：面板不关，查询原位改成 `:`，成功后记入 MRU", async () => {
        const app = harness();
        app.register("nbook.quick-open.open-line", {when: {requires: ["editor-line-navigation"]}}, () => {
            app.host.openPalette("line");
            return {ok: true, value: null};
        });
        app.context.value = {"editor-line-navigation": true};
        app.host.editor.value = {target, lineCount: () => 3};
        await open(app.host);

        await press("Enter");
        await vi.waitFor(() => expect(app.host.query.value).toBe(":"));
        expect(app.host.open.value).toBe(true);
        expect(app.host.recent.value).toEqual(["nbook.quick-open.open-line"]);
    });

    it("执行失败的选中项不记入 MRU", async () => {
        const app = harness();
        app.register("nbook.edit.undo", {}, () => ({ok: false, code: "unavailable", reason: "不行"}));
        await open(app.host);
        await press("Enter");
        await vi.waitFor(() => expect(app.executed).toHaveLength(1));
        expect(app.host.recent.value).toEqual([]);
    });
    it("选择模式：同一浮层列出请求的候选，标签与说明都参与匹配；Enter 关面板、焦点归还后才给出选中项", async () => {
        const app = harness();
        app.opener.focus();
        const request = {
            title: "打开项目",
            placeholder: "选择项目，或输入目录路径",
            items: [{id: "alpha", label: "alpha", detail: "/books/alpha"}, {id: "book", label: "book", detail: "/drafts/book"}],
            text: {label: (text: string) => `登记并打开 ${text}`},
        };
        const result = app.host.openPick(request);
        await vi.waitFor(() => expect(input()).not.toBeNull());
        expect(options()).toEqual(["alpha", "book"]);
        expect(document.body.textContent).toContain("打开项目");
        expect(document.body.textContent).toContain("/drafts/book");

        await type("drafts");
        expect(options()).toEqual(["book", "quick-pick:text"]);
        let settled: unknown = null;
        void result.then((value) => {
            settled = {value, focusReturned: document.activeElement === app.opener};
        });
        await press("Enter");
        expect(app.host.open.value).toBe(false);
        await vi.waitFor(() => expect(settled).toEqual({value: {kind: "item", id: "book"}, focusReturned: true}));
        expect(app.host.pick.value).toBeNull();
        expect(app.executed).toEqual([]);
    });

    it("选择模式：提交输入的文字为 text，Escape 为 cancelled；切回命令模式取消这次选择", async () => {
        const app = harness();
        app.register("nbook.app.alpha");
        const request = {title: "打开项目", placeholder: "目录", items: [], text: {label: (text: string) => `登记并打开 ${text}`}, empty: "还没有登记的项目"};

        const typed = app.host.openPick(request);
        await vi.waitFor(() => expect(input()).not.toBeNull());
        expect(document.body.textContent).toContain("还没有登记的项目");
        await type("/new/book");
        expect(options()).toEqual(["quick-pick:text"]);
        await press("Enter");
        expect(await typed).toEqual({kind: "text", text: "/new/book"});

        const escaped = app.host.openPick(request);
        await vi.waitFor(() => expect(input()).not.toBeNull());
        await press("Escape");
        expect(await escaped).toEqual({kind: "cancelled"});

        const replaced = app.host.openPick(request);
        await vi.waitFor(() => expect(input()).not.toBeNull());
        app.host.openPalette("commands");
        expect(await replaced).toEqual({kind: "cancelled"});
        await vi.waitFor(() => expect(options()).toEqual(["nbook.app.alpha"]));
    });

    it("显示语言：打开中的选择与面板随语言切换换文字，输入与选中项保留；字符串原样显示", async () => {
        const app = harness();
        const request = {
            title: {"zh-CN": "切换主题", "en-US": "Change Theme"},
            placeholder: {"zh-CN": "选中后立即生效", "en-US": "Takes effect immediately"},
            items: [{id: "nbook", label: "NeuroBook", detail: {"zh-CN": "当前", "en-US": "current"}}, {id: "macos", label: "macOS"}],
            empty: {"zh-CN": "没有匹配的项", "en-US": "No matching items"},
        };
        const result = app.host.openPick(request);
        await vi.waitFor(() => expect(input()).not.toBeNull());
        expect(document.body.textContent).toContain("切换主题");
        expect(document.body.textContent).toContain("当前");
        await type("o");
        await press("ArrowDown");
        const chosen = selected();

        app.locale.value = "en-US";
        await nextTick();
        expect(document.body.textContent).toContain("Change Theme");
        expect(document.body.textContent).toContain("current");
        expect(document.body.textContent).not.toContain("切换主题");
        expect(input()?.placeholder).toBe("Takes effect immediately");
        expect(input()?.value).toBe("o");
        expect(selected()).toBe(chosen);
        await type("zzz");
        expect(document.body.textContent).toContain("No matching items");
        await press("Escape");
        expect(await result).toEqual({kind: "cancelled"});

        // 命令模式的面板文案同样按当前语言。
        await open(app.host);
        expect(input()?.placeholder).toBe("Type a command, or : to go to a line");
        app.locale.value = "zh-CN";
        await nextTick();
        expect(input()?.placeholder).toBe("输入命令，或输入 : 跳到某一行");
    });
});
