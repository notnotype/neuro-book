/**
 * 编辑区标题的动作（docs/specs/workbench/editor.md 输出 34）：真实的命令注册表与编辑组布局。编辑器自己的“向右拆分”是按钮、
 * “用其它编辑器重新打开”在“⋯”里；别的插件的项排在后面，按后缀与当前文件显示，`context: "resource"` 的收到活动标签的
 * 地址；按钮至多 4 个；“⋯”的菜单身份随活动组与活动标签变。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {ref} from "@vue/reactivity";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";

import {CODE_EDITOR, MARKDOWN_EDITOR} from "./shared/contracts";
import type {EditorTitleItemDeclaration} from "./shared/contracts";
import {REOPEN_WITH_COMMAND, SPLIT_RIGHT_COMMAND} from "./web/commands";
import {createEditorGroups} from "./web/groups/groups";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import {TOGGLE_COMMENT_MARGIN_COMMAND} from "./web/editing-commands";
import {createEditorTitleActions} from "./web/title-actions";
import {BADGE_EXTRA_PX, titleModelFor} from "nbook/ui/menus/title-actions";
import {testTextPort} from "nbook/shared/testing/text-port";
import {editorCatalogs} from "./web/text";

/** 窗口同款的翻译端口，登记了编辑器的目录（严格模式：缺键直接抛错）。 */
const zh = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});

const PREVIEW = "nbook.editor.preview-test";

function setup(items: ReadonlyArray<{readonly id: string; readonly declaration: EditorTitleItemDeclaration}>) {
    const calls: Array<[string, unknown]> = [];
    const commands = createCommandRegistry({contextKeys: contextTable({}, () => ({})), report: () => undefined});
    for (const [id, title, keybinding] of [[SPLIT_RIGHT_COMMAND, "向右拆分", undefined], [REOPEN_WITH_COMMAND, "用其它编辑器重新打开", "Mod+Alt+R"], [PREVIEW, "预览", undefined]] as const) {
        const registered = commands.register({
            id,
            source: "nbook.test",
            declaration: {title: {"zh-CN": title, "en-US": title}, description: "test", args: Type.Object({address: Type.Optional(Type.String())}, {additionalProperties: false}), effect: "read", ...(keybinding === undefined ? {} : {keybinding})},
            run: (args) => {
                calls.push([id, args]);
                return {ok: true, value: null};
            },
        });
        if (!registered.ok) throw new Error(registered.reason);
    }
    const groups = createEditorGroups(createMemoryEditorPanels());
    const titles = createEditorTitleActions({area: () => ({groups}), commands, state: {read: () => ({status: "undeclared"})}, items: () => items, platform: "other"});
    return {titles, groups, calls};
}

const keys = (entries: ReadonlyArray<{readonly key: string}>) => entries.map((entry) => entry.key);
const preview = (extra: Partial<EditorTitleItemDeclaration> = {}) => ({id: "acme.preview.button", declaration: {section: "1", command: PREVIEW, icon: "i-lucide-eye", extensions: [".md"], context: "resource", ...extra}});

describe("编辑区标题的动作（editor.md 输出 34）", () => {
    it("编辑器自己的：向右拆分是按钮、用其它编辑器重新打开在“⋯”里；贡献的按后缀出现在后面，活动标签换成别的后缀或页面就消失", () => {
        const {titles, groups} = setup([preview()]);
        groups.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        const md = titles.current(zh)!;
        expect(md.group).toBe(groups.activeGroup.value);
        expect(keys(md.model(4).buttons)).toEqual(["own:split-right", "acme.preview.button"]);
        expect(md.model(4).menu.map(keys)).toEqual([["own:reopen-with"]]);
        // “⋯”里的项带命令的快捷键，按平台写好。
        expect(md.model(4).menu[0]![0]!.shortcut).toBe("Ctrl+Alt+R");
        expect(md.model(4).buttons.map((entry) => entry.title)).toEqual(["向右拆分", "预览"]);

        groups.open("project://b.txt", {mode: "permanent", editor: CODE_EDITOR});
        expect(keys(titles.current(zh)!.model(4).buttons)).toEqual(["own:split-right"]);
        groups.openPage("page://nbook.projects.welcome");
        expect(keys(titles.current(zh)!.model(4).buttons)).toEqual(["own:split-right"]);
    });

    it("context resource 的项收到点下去时活动标签的地址；活动标签不是文件时不执行；编辑器自己的动作参数是 {}", async () => {
        const {titles, groups, calls} = setup([preview(), {id: "acme.preview.args", declaration: {section: "2", command: PREVIEW, placement: "menu", args: {address: "fixed"}}}]);
        groups.open("project://notes/a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        titles.run("acme.preview.button");
        titles.run("own:split-right");
        titles.run("acme.preview.args");
        groups.openPage("page://nbook.projects.welcome");
        titles.run("acme.preview.button");
        await Promise.resolve();
        expect(calls).toEqual([[PREVIEW, {address: "project://notes/a.md"}], [SPLIT_RIGHT_COMMAND, {}], [PREVIEW, {address: "fixed"}]]);
    });

    it("按钮至多 4 个、组窄时按组给出的个数，放不下的贡献按钮回到它的节、排在编辑器自己的“⋯”项之后；菜单身份随活动组与活动标签变", () => {
        const many = Array.from({length: 4}, (_, index) => ({id: `acme.many.b${String(index)}`, declaration: {section: "1", order: index, command: PREVIEW, icon: "i-lucide-square"}}));
        const {titles, groups} = setup(many);
        const first = groups.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        const model = titles.current(zh)!.model(4);
        expect(keys(model.buttons)).toEqual(["own:split-right", "acme.many.b0", "acme.many.b1", "acme.many.b2"]);
        expect(model.menu.map(keys)).toEqual([["own:reopen-with"], ["acme.many.b3"]]);
        // 编辑组窄时由组给出更少的个数；给得再多也至多 4 个。
        expect(keys(titles.current(zh)!.model(1).buttons)).toEqual(["own:split-right"]);
        expect(titles.current(zh)!.model(1).menu.map(keys)).toEqual([["own:reopen-with"], ["acme.many.b0", "acme.many.b1", "acme.many.b2", "acme.many.b3"]]);
        expect(titles.current(zh)!.model(8).buttons).toHaveLength(4);
        const before = titles.current(zh)!.identity;
        groups.open("project://b.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        expect(titles.current(zh)!.identity).not.toBe(before);
        groups.activate(first.tab.id);
        expect(titles.current(zh)!.identity).toBe(before);
    });
});

describe("批注页边的开关（markdown-editing.md 输出 33）", () => {
    /** 带 `when: hasComments` 的真实命令，活动控件有没有 `comments` 决定它出不出现；开关与条数是响应式的。 */
    function withComments() {
        const hasComments = ref(false);
        const count = ref(3);
        const margin = ref(false);
        const commands = createCommandRegistry({contextKeys: contextTable({"nbook.editor/hasComments": "当前编辑器没有批注页边"}, () => ({"nbook.editor/hasComments": hasComments.value})), report: () => undefined});
        for (const [id, title, when] of [[SPLIT_RIGHT_COMMAND, "向右拆分", undefined], [REOPEN_WITH_COMMAND, "用其它编辑器重新打开", undefined], [TOGGLE_COMMENT_MARGIN_COMMAND, "显示或隐藏批注页边", {requires: ["nbook.editor/hasComments"]}]] as const) {
            const registered = commands.register({id, source: "nbook.test", declaration: {title: {"zh-CN": title, "en-US": title}, description: "test", args: Type.Object({}, {additionalProperties: false}), effect: "read", ...(when === undefined ? {} : {when})}, run: () => ({ok: true, value: null})});
            if (!registered.ok) throw new Error(registered.reason);
        }
        const groups = createEditorGroups(createMemoryEditorPanels());
        const activeHandle = {get value() {
            return hasComments.value ? {comments: {count}} : {};
        }};
        const titles = createEditorTitleActions({
            area: () => ({groups, activeHandle} as never),
            commands,
            state: {read: (key: string) => (key === "nbook.editor/commentMargin" ? {status: "ready", value: margin.value} : {status: "undeclared"})} as never,
            items: () => [],
            platform: "other",
        });
        groups.open("project://a.md", {mode: "permanent", editor: MARKDOWN_EDITOR});
        return {titles, hasComments, count, margin};
    }

    it("活动控件没有 comments 时不出现；有时是拆分之后的按钮，带条数，按下态读开关，条数变了当场变", () => {
        const {titles, hasComments, count, margin} = withComments();
        expect(keys(titles.current(zh)!.model(4).buttons)).toEqual(["own:split-right"]);
        hasComments.value = true;
        let button = titles.current(zh)!.model(4).buttons[1]!;
        expect(button.key).toBe("own:comment-margin");
        expect(button.badge).toBe("3");
        expect(button.pressed).toBe(false);
        margin.value = true;
        count.value = 120;
        button = titles.current(zh)!.model(4).buttons[1]!;
        expect(button.pressed).toBe(true);
        expect(button.badge).toBe("99+");
        count.value = 0;
        expect(titles.current(zh)!.model(4).buttons[1]!.badge).toBe("0");
    });

    it("按钮放不下时收进“⋯”，仍是开关（按下态）", () => {
        const {titles, hasComments, margin} = withComments();
        hasComments.value = true;
        margin.value = true;
        const model = titles.current(zh)!.model(1);
        expect(keys(model.buttons)).toEqual(["own:split-right"]);
        expect(model.menu[0]!.find((entry) => entry.key === "own:comment-margin")?.pressed).toBe(true);
    });

    it("带数字的按钮比 24px 宽：预算扣掉多出的宽度，保住标签条的最小宽度", () => {
        const {titles, hasComments} = withComments();
        hasComments.value = true;
        const model = (maxButtons: number) => titles.current(zh)!.model(maxButtons);
        // 宽度刚好放下两个普通按钮加“⋯”（24 + 26 + 26 = 76，加保底 104）时，带数字的那个放不下，按预算少一个。
        const width = 104 + 24 + 26 * 2;
        expect(keys(titleModelFor(model, width, 104, 4).buttons)).toEqual(["own:split-right"]);
        expect(keys(titleModelFor(model, width + BADGE_EXTRA_PX, 104, 4).buttons)).toEqual(["own:split-right", "own:comment-margin"]);
        // 没有带数字的按钮时就是个数预算。
        expect(keys(titleModelFor(model, null, 104, 4).buttons)).toEqual(["own:split-right", "own:comment-margin"]);
    });
});
