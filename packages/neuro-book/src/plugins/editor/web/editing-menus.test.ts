/**
 * 编辑器区交给控件的菜单（`editing-menus.ts`）里的通知：键带参数时按参数填进文字（docs/specs/workbench/markdown-editing.md 输出 55：
 * 粘贴失败的通知要写明是哪一张）。命令、贡献项排序的部分由 `editing-commands.test.ts` 与命令服务自己的测试负责。
 */

import {describe, expect, it} from "bun:test";
import {ref} from "@vue/reactivity";

import type {DisplayText} from "nbook/shared/localized-text";

import {editorText} from "../shared/text";
import {createEditorMenus} from "./editing-menus";

function menus() {
    const notified: DisplayText[] = [];
    const created = createEditorMenus({
        area: () => null,
        commands: {get: () => ({ok: false, code: "not-found", detail: ""}), isEnabled: () => false, execute: () => Promise.resolve({ok: true, value: null})} as never,
        state: {read: () => ({status: "absent"})} as never,
        items: {},
        platform: "other",
        text: {t: () => ""} as never,
        version: ref(0),
        toolbarVisible: ref(true),
        toolbarPlacement: ref("full"),
        commentMargin: ref(false),
        notify: (text) => notified.push(text),
        report: () => undefined,
    });
    return {created, notified};
}

describe("notify", () => {
    it("按键取 `menus.<键>` 的文字，带参数时把参数交给文字；不带参数照旧", () => {
        const {created, notified} = menus();
        created.notify("imageTooLarge", {name: "a.png"});
        created.notify("pasteDenied");
        expect(notified).toEqual([editorText("menus.imageTooLarge", {name: "a.png"}), editorText("menus.pasteDenied")]);
    });
});
