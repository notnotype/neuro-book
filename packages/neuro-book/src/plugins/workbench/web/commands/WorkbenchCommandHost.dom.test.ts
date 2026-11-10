/**
 * 页面上的命令宿主（workbench.commands 场景 13 的组件半边）：挂载后按 `Ctrl+Shift+P` 打开面板；卸载后快捷键不再响应，
 * 面板槽位断开；快捷键执行的命令失败时经 `notify` 弹警告。用真实的命令表与工作台的面板入口命令；产品页上的整条接线由 `src/web/mount.dom.test.ts` 覆盖。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";

import {Type} from "typebox";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {provideText} from "nbook/shared/testing/text-port";

import type {NotificationInput} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import {completedCommand} from "../../testing/declarations";
import {failureText, workbenchTestText} from "../../testing/text";
import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./open-commands";
import WorkbenchCommandHost from "./WorkbenchCommandHost.vue";

/** 通知标题是文字引用，视口显示时才翻：按给定语言翻出标题来比对；正文原样留着（有的用例要核对引用本身）。 */
const titled = (locale: "zh-CN" | "en-US") => (notice: NotificationInput) => ({...notice, title: workbenchTestText(locale).t(notice.title ?? "")});

afterEach(() => {
    document.body.innerHTML = "";
});

function shortcut(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "P", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true});
    document.body.dispatchEvent(event);
    return event;
}

describe("WorkbenchCommandHost", () => {
    it("挂载后快捷键打开面板；卸载后快捷键不再拦截，面板命令得到 unavailable", async () => {
        const reported: string[] = [];
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: (error) => reported.push(error.message)});
        const slot = new PaletteSlot();
        const registered = registry.register({id: OPEN_COMMANDS_ID, source: "nbook.workbench", declaration: completedCommand(OPEN_COMMANDS_ID, OPEN_COMMANDS_DECLARATION), run: () => slot.command.run({})});
        expect(registered.ok).toBe(true);

        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message)},
            attachTo: document.body,
            global: {provide: provideText(workbenchTestText("zh-CN"))},
        });
        await nextTick();
        expect(shortcut().defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(document.body.querySelector('[role="combobox"]')).not.toBeNull());

        wrapper.unmount();
        await nextTick();
        expect(document.body.querySelector('[role="combobox"]')).toBeNull();
        expect(shortcut().defaultPrevented).toBe(false);
        const detached = await registry.execute(OPEN_COMMANDS_ID);
        expect(detached).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(detached, "zh-CN")).toBe("当前页面没有命令面板");
        expect(failureText(detached, "en-US")).toBe("This page has no command palette");
        expect(reported).toEqual([]);
    });

    it("快捷键执行的命令失败：弹一条警告，标题是命令名、正文是原因；stale-target 不弹", async () => {
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: () => undefined});
        const declaration = (title: string, keybinding: string) => ({title: {"zh-CN": title, "en-US": title}, description: title, args: Type.Object({}, {additionalProperties: false}), effect: "read" as const, keybinding});
        registry.register({id: "nbook.app.broken", source: "nbook.test", declaration: declaration("坏命令", "Mod+Shift+K"), run: () => ({ok: false, code: "execution-error", reason: "磁盘满了"})});
        registry.register({id: "nbook.app.stale", source: "nbook.test", declaration: declaration("过期命令", "Mod+Shift+J"), run: () => ({ok: false, code: "stale-target", reason: "目标已换"})});
        const notices: NotificationInput[] = [];
        const reported: string[] = [];
        const slot = new PaletteSlot();
        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message), notify: (input: NotificationInput) => notices.push(input)},
            attachTo: document.body,
            global: {provide: provideText(workbenchTestText("zh-CN"))},
        });
        await nextTick();
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "J", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}));
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(notices.map(titled("zh-CN"))).toEqual([{tone: "warning", title: "坏命令没有完成", message: "磁盘满了"}]));
        // 诊断照记，两条失败都在。
        expect(reported).toHaveLength(2);
        wrapper.unmount();
    });

    it("面板执行的命令失败：同样记诊断并弹警告；invalid-args 照原因写（命令自己返回的不一定是缺参数）", async () => {
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: () => undefined});
        const slot = new PaletteSlot();
        registry.register({id: OPEN_COMMANDS_ID, source: "nbook.workbench", declaration: completedCommand(OPEN_COMMANDS_ID, OPEN_COMMANDS_DECLARATION), run: () => slot.command.run({})});
        registry.register({
            id: "nbook.app.count",
            source: "nbook.test",
            declaration: {title: {"zh-CN": "统计", "en-US": "Count"}, description: "count", args: Type.Object({}, {additionalProperties: false}), effect: "read"},
            run: () => ({ok: false, code: "invalid-args", reason: "选区里没有文字"}),
        });
        const notices: NotificationInput[] = [];
        const reported: string[] = [];
        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message), notify: (input: NotificationInput) => notices.push(input)},
            attachTo: document.body,
            global: {provide: provideText(workbenchTestText("zh-CN"))},
        });
        await nextTick();
        shortcut();
        await vi.waitFor(() => expect(document.body.querySelector('[role="option"][id$="-option-nbook.app.count"]')).not.toBeNull());
        document.body.querySelector('[role="combobox"]')?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(notices.map(titled("zh-CN"))).toEqual([{tone: "warning", title: "统计没有完成", message: "选区里没有文字"}]));
        expect(reported).toEqual(["Command nbook.app.count failed (invalid-args): 选区里没有文字"]);
        wrapper.unmount();
    });

    it("面板执行的命令抛异常：通知正文是“命令执行出错”，异常原文脱敏后放在通知的详情里，诊断带上原文（commands 验收 21）", async () => {
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: () => undefined});
        const slot = new PaletteSlot();
        registry.register({id: OPEN_COMMANDS_ID, source: "nbook.workbench", declaration: completedCommand(OPEN_COMMANDS_ID, OPEN_COMMANDS_DECLARATION), run: () => slot.command.run({})});
        registry.register({
            id: "nbook.app.crash",
            source: "nbook.test",
            declaration: {title: {"zh-CN": "崩溃", "en-US": "Crash"}, description: "crash", args: Type.Object({}, {additionalProperties: false}), effect: "read"},
            run: () => {
                throw new Error("token=abc boom");
            },
        });
        const notices: NotificationInput[] = [];
        const reported: string[] = [];
        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message), notify: (input: NotificationInput) => notices.push(input)},
            attachTo: document.body,
            global: {provide: provideText(workbenchTestText("zh-CN"))},
        });
        await nextTick();
        shortcut();
        await vi.waitFor(() => expect(document.body.querySelector('[role="option"][id$="-option-nbook.app.crash"]')).not.toBeNull());
        document.body.querySelector('[role="combobox"]')?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(notices).toHaveLength(1));
        const [notice] = notices.map(titled("zh-CN"));
        expect(notice).toMatchObject({tone: "warning", title: "崩溃没有完成"});
        // 正文是语言映射，视口按当前语言取；两种语言都是固定的一句，不含异常原文。
        expect(workbenchTestText("zh-CN").t(notice?.message ?? "")).toBe("命令执行出错");
        expect(workbenchTestText("en-US").t(notice?.message ?? "")).toBe("The command failed while running");
        expect(notice?.detail).toContain("boom");
        expect(notice?.detail).not.toContain("abc");
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain("(execution-error)");
        expect(reported[0]).toContain("boom");
        wrapper.unmount();
    });

    it("命令给的原因是文字引用：通知正文原样交出，由视口按当前语言翻；诊断写成键名", async () => {
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: () => undefined});
        const reason = workbenchText("palette.unavailable");
        registry.register({
            id: "nbook.app.broken",
            source: "nbook.test",
            declaration: {title: {"zh-CN": "坏命令", "en-US": "Broken"}, description: "broken", args: Type.Object({}, {additionalProperties: false}), effect: "read", keybinding: "Mod+Shift+K"},
            run: () => ({ok: false, code: "unavailable", reason}),
        });
        const notices: NotificationInput[] = [];
        const reported: string[] = [];
        const slot = new PaletteSlot();
        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message), notify: (input: NotificationInput) => notices.push(input)},
            attachTo: document.body,
            global: {provide: provideText(workbenchTestText("en-US"))},
        });
        await nextTick();
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(notices.map(titled("en-US"))).toEqual([{tone: "warning", title: "Broken did not complete", message: reason}]));
        // 同一条通知按中文显示：标题的框架换成中文，代入的命令名停在发通知时的语言。
        expect(titled("zh-CN")(notices[0]!).title).toBe("Broken没有完成");
        expect(workbenchTestText("zh-CN").t(notices[0]!.message)).toBe("当前页面没有命令面板");
        expect(workbenchTestText("en-US").t(notices[0]!.message)).toBe("This page has no command palette");
        expect(reported).toEqual(["Command nbook.app.broken failed (unavailable): nbook.workbench:palette.unavailable"]);
        wrapper.unmount();
    });

    it("面板的失败通知随界面语言：英文界面写 “did not complete”", async () => {
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: () => undefined});
        const slot = new PaletteSlot();
        registry.register({id: OPEN_COMMANDS_ID, source: "nbook.workbench", declaration: completedCommand(OPEN_COMMANDS_ID, OPEN_COMMANDS_DECLARATION), run: () => slot.command.run({})});
        registry.register({
            id: "nbook.app.count",
            source: "nbook.test",
            declaration: {title: {"zh-CN": "统计", "en-US": "Count"}, description: "count", args: Type.Object({}, {additionalProperties: false}), effect: "read"},
            run: () => ({ok: false, code: "invalid-args", reason: "no text selected"}),
        });
        const notices: NotificationInput[] = [];
        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: () => undefined, notify: (input: NotificationInput) => notices.push(input)},
            attachTo: document.body,
            global: {provide: provideText(workbenchTestText("en-US"))},
        });
        await nextTick();
        shortcut();
        await vi.waitFor(() => expect(document.body.querySelector('[role="option"][id$="-option-nbook.app.count"]')).not.toBeNull());
        document.body.querySelector('[role="combobox"]')?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(notices.map(titled("en-US"))).toEqual([{tone: "warning", title: "Count did not complete", message: "no text selected"}]));
        wrapper.unmount();
    });
});
