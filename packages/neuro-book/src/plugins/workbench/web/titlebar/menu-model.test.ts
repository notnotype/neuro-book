/**
 * 应用菜单的能力模型（docs/specs/ui/workbench-shell.md 外壳四输出 29）：真实的命令注册表与上下文键，按宿主能力与
 * 命令目录裁出此刻能画的菜单。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import type {ContextValues} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";

import {buildMenus, TITLEBAR_MENUS} from "./menu-model";
import type {MenuGroupDefinition, MenuSource} from "./menu-model";

/** 测试命令的 id：注册表要求 `nbook.<已登记的域>.<动作>`，借用 `view` 域。 */
const cmd = (name: string): string => `nbook.view.${name}`;

function registry(ids: ReadonlyArray<string>, options: {keybindings?: Readonly<Record<string, string>>; gated?: ReadonlyArray<string>} = {}) {
    let context: ContextValues = {};
    const commands = createCommandRegistry({contextKeys: contextTable({"editor-active": "没有活动的编辑器"}, () => context), report: () => undefined});
    for (const name of ids) {
        const id = cmd(name);
        const registered = commands.register({
            id,
            source: "nbook.test",
            declaration: {
                title: {"zh-CN": `标题 ${name}`, "en-US": `Title ${name}`},
                description: "test command",
                args: Type.Object({part: Type.Optional(Type.String())}, {additionalProperties: false}),
                effect: "read",
                keybinding: options.keybindings?.[name],
                when: options.gated?.includes(name) === true ? {requires: ["editor-active"]} : undefined,
            },
            run: () => ({ok: true, value: null}),
        });
        if (!registered.ok) throw new Error(registered.reason);
    }
    return {commands, setContext: (values: ContextValues) => {
        context = values;
    }};
}

function source(commands: ReturnType<typeof registry>["commands"], overrides: Partial<MenuSource> = {}): MenuSource {
    return {commands: commands.list(), isEnabled: (id) => commands.isEnabled(id), checked: () => false, desktop: false, locale: "zh-CN", platform: "other", ...overrides};
}

const labels = (menus: ReturnType<typeof buildMenus>) => menus.map((group) => [group.id, group.sections.map((section) => section.map((entry) => entry.command.replace("nbook.view.", "")))]);

describe("裁剪", () => {
    it("命令不在目录里的项不画；空节不画（分隔线不落在两端、不连着出现）；整组被裁掉时不画这一组", () => {
        const {commands} = registry(["b", "d"]);
        const definitions: MenuGroupDefinition[] = [
            {id: "one", title: {"zh-CN": "一", "en-US": "One"}, sections: [[{command: cmd("a")}], [{command: cmd("b")}], [{command: cmd("c")}], [{command: cmd("d")}]]},
            {id: "two", title: {"zh-CN": "二", "en-US": "Two"}, sections: [[{command: cmd("x")}, {command: cmd("y")}]]},
        ];
        expect(labels(buildMenus(definitions, source(commands)))).toEqual([["one", [["b"], ["d"]]]]);
    });

    it("只属于桌面的项在浏览器里不画，在桌面宿主里画", () => {
        const {commands} = registry(["quit", "save"]);
        const definitions: MenuGroupDefinition[] = [{id: "file", title: {"zh-CN": "文件", "en-US": "File"}, sections: [[{command: cmd("save")}], [{command: cmd("quit"), desktopOnly: true}]]}];
        expect(labels(buildMenus(definitions, source(commands)))).toEqual([["file", [["save"]]]]);
        expect(labels(buildMenus(definitions, source(commands, {desktop: true})))).toEqual([["file", [["save"], ["quit"]]]]);
    });
});

describe("条目", () => {
    it("不可用的项画成禁用并带命令给的原因；上下文变了重新生成就可用", () => {
        const {commands, setContext} = registry(["undo"], {gated: ["undo"]});
        const definitions: MenuGroupDefinition[] = [{id: "edit", title: {"zh-CN": "编辑", "en-US": "Edit"}, sections: [[{command: cmd("undo")}]]}];
        const disabled = buildMenus(definitions, source(commands))[0]!.sections[0]![0]!;
        expect([disabled.enabled, disabled.reason]).toEqual([false, "没有活动的编辑器"]);
        setContext({"editor-active": true});
        const enabled = buildMenus(definitions, source(commands))[0]!.sections[0]![0]!;
        expect([enabled.enabled, enabled.reason]).toEqual([true, null]);
    });

    it("标题按语言取命令的标题，定义给了标题时用定义的；快捷键按平台写；勾选项读公开键；同一命令带不同参数各成一项", () => {
        const {commands} = registry(["toggle", "palette"], {keybindings: {palette: "Mod+Shift+P"}});
        const definitions: MenuGroupDefinition[] = [{id: "view", title: {"zh-CN": "视图", "en-US": "View"}, sections: [[
            {command: cmd("palette")},
            {command: cmd("toggle"), args: {part: "sidebar"}, checkedBy: "k/sidebar", label: {"zh-CN": "侧栏", "en-US": "Sidebar"}},
            {command: cmd("toggle"), args: {part: "activitybar"}, checkedBy: "k/activitybar", label: {"zh-CN": "活动栏", "en-US": "Activity Bar"}},
        ]]}];
        const visible = new Set(["k/sidebar"]);
        const [mac] = buildMenus(definitions, source(commands, {platform: "mac", checked: (key) => visible.has(key)}));
        expect(mac!.label).toBe("视图");
        expect(mac!.sections[0]!.map((entry) => [entry.label, entry.shortcut, entry.checked, entry.args])).toEqual([
            ["标题 palette", "⇧⌘P", null, {}],
            ["侧栏", null, true, {part: "sidebar"}],
            ["活动栏", null, false, {part: "activitybar"}],
        ]);
        expect(new Set(mac!.sections[0]!.map((entry) => entry.id)).size).toBe(3);
        const [other] = buildMenus(definitions, source(commands, {locale: "en-US"}));
        expect(other!.sections[0]!.map((entry) => [entry.label, entry.shortcut])).toEqual([["Title palette", "Ctrl+Shift+P"], ["Sidebar", null], ["Activity Bar", null]]);
    });
});

describe("产品的菜单定义", () => {
    it("四组；每个条目都是带命名空间的 canonical 命令；不画的旧桌面项（打开文件、设置、剪贴板、缩放、关于）不在定义里", () => {
        expect(TITLEBAR_MENUS.map((group) => group.id)).toEqual(["file", "edit", "view", "help"]);
        const commandIds = TITLEBAR_MENUS.flatMap((group) => group.sections.flat().map((entry) => entry.command));
        for (const id of commandIds) expect(id.startsWith("nbook."), id).toBe(true);
        for (const legacy of ["file.open", "file.settings", "edit.cut", "edit.copy", "edit.paste", "edit.select-all", "view.zoom-in", "help.about"]) {
            expect(commandIds.some((id) => id.endsWith(legacy)), legacy).toBe(false);
        }
    });
});
