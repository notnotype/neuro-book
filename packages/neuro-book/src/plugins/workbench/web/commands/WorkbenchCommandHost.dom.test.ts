/**
 * 页面上的命令宿主（workbench.commands 场景 13 的组件半边）：挂载后按 `Ctrl+Shift+P` 打开面板；卸载后快捷键不再响应，
 * 面板槽位断开。用真实的命令表与工作台的面板入口命令；产品页上的整条接线由 `src/web/mount.dom.test.ts` 覆盖。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";

import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";

import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./open-commands";
import WorkbenchCommandHost from "./WorkbenchCommandHost.vue";

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
        const registry = createCommandRegistry({contextKeys: {}, report: (error) => reported.push(error.message)});
        const slot = new PaletteSlot();
        const registered = registry.register({id: OPEN_COMMANDS_ID, source: "nbook.workbench", declaration: OPEN_COMMANDS_DECLARATION, run: () => slot.command.run({})});
        expect(registered.ok).toBe(true);

        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message)},
            attachTo: document.body,
        });
        await nextTick();
        expect(shortcut().defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(document.body.querySelector('[role="combobox"]')).not.toBeNull());

        wrapper.unmount();
        await nextTick();
        expect(document.body.querySelector('[role="combobox"]')).toBeNull();
        expect(shortcut().defaultPrevented).toBe(false);
        expect(await registry.execute(OPEN_COMMANDS_ID)).toEqual({ok: false, code: "unavailable", reason: "当前页面没有命令面板"});
        expect(reported).toEqual([]);
    });
});
