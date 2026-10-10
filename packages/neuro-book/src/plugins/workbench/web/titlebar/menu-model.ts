/**
 * 标题栏应用菜单的能力模型（docs/specs/ui/workbench-shell.md 外壳四输出 29）：按宿主能力与命令目录把菜单定义裁成
 * 此刻能画的菜单。纯函数，不碰 DOM、不执行命令；执行由菜单组件经命令服务 `execute(command, args)` 完成。
 *
 * 菜单定义里的命令 id 按字符串写：它们是命令的公开合同，工作台不为画菜单去依赖各贡献方的模块。贡献方没加载时命令
 * 不在目录里，这一项自然不画。
 */

import type {CommandMetadata, CommandResult} from "nbook/plugins/commands/shared/contracts";
import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {formatKeybinding} from "../commands/keymap";
import type {KeyPlatform} from "../commands/keymap";

export interface MenuEntryDefinition {
    readonly command: string;
    /** 执行时的固定参数；省略为 `{}`。 */
    readonly args?: Readonly<Record<string, unknown>>;
    /** 只属于桌面宿主（退出、缩放这类）：浏览器里不画。 */
    readonly desktopOnly?: boolean;
    /** 勾选项：读这个工作台公开键得到勾选状态。 */
    readonly checkedBy?: string;
    /** 条目自己的标题；省略时用命令的标题。同一命令带不同参数出现几次时（侧栏、右栏、活动栏）各给一个。 */
    readonly label?: LocalizedText;
}

export interface MenuGroupDefinition {
    readonly id: string;
    readonly title: LocalizedText;
    /** 分节：节与节之间画分隔线；空节不画，分隔线因此不会落在两端或连着出现。 */
    readonly sections: ReadonlyArray<ReadonlyArray<MenuEntryDefinition>>;
}

export interface MenuEntry {
    /** 组内唯一：命令 id 加固定参数（同一命令带不同参数可以出现多次）。 */
    readonly id: string;
    readonly command: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly label: string;
    readonly enabled: boolean;
    /** 不可用的原因；可用为 null。 */
    readonly reason: string | null;
    /** 按平台写好的快捷键；命令没有声明键位为 null。 */
    readonly shortcut: string | null;
    /** 勾选项的状态；不是勾选项为 null。 */
    readonly checked: boolean | null;
}

export interface MenuGroup {
    readonly id: string;
    readonly label: string;
    readonly sections: ReadonlyArray<ReadonlyArray<MenuEntry>>;
}

export interface MenuSource {
    readonly commands: ReadonlyArray<CommandMetadata>;
    readonly isEnabled: (id: string) => CommandResult<boolean>;
    /** 读工作台的布尔公开键（勾选项用）。 */
    readonly checked: (key: string) => boolean;
    readonly desktop: boolean;
    readonly locale: DisplayLocale;
    readonly platform: KeyPlatform;
}

export function buildMenus(definitions: ReadonlyArray<MenuGroupDefinition>, source: MenuSource): MenuGroup[] {
    const catalog = new Map(source.commands.map((command) => [command.id, command]));
    const groups: MenuGroup[] = [];
    for (const group of definitions) {
        const sections: MenuEntry[][] = [];
        for (const section of group.sections) {
            const entries: MenuEntry[] = [];
            for (const definition of section) {
                const command = catalog.get(definition.command);
                if (command === undefined || (definition.desktopOnly === true && !source.desktop)) continue;
                const enabled = source.isEnabled(command.id);
                const args = definition.args ?? {};
                entries.push({
                    id: Object.keys(args).length === 0 ? command.id : `${command.id} ${JSON.stringify(args)}`,
                    command: command.id,
                    args,
                    label: localize(definition.label ?? command.title, source.locale),
                    enabled: enabled.ok && enabled.value,
                    reason: enabled.ok ? null : enabled.reason,
                    shortcut: command.keybinding === undefined ? null : formatKeybinding(command.keybinding, source.platform),
                    checked: definition.checkedBy === undefined ? null : source.checked(definition.checkedBy),
                });
            }
            if (entries.length > 0) sections.push(entries);
        }
        if (sections.length > 0) groups.push({id: group.id, label: localize(group.title, source.locale), sections});
    }
    return groups;
}

const WORKBENCH = "nbook.workbench";

/** 外壳四输出 29 的条目表。 */
export const TITLEBAR_MENUS: ReadonlyArray<MenuGroupDefinition> = [
    {
        id: "file",
        title: {"zh-CN": "文件", "en-US": "File"},
        sections: [
            [{command: "nbook.project.open"}],
            [{command: "nbook.editor.save"}, {command: "nbook.editor.save-all"}, {command: "nbook.editor.revert"}],
            [{command: "nbook.editor.close"}, {command: "nbook.editor.close-others"}],
            [{command: "nbook.app.quit", desktopOnly: true}],
        ],
    },
    {
        id: "edit",
        title: {"zh-CN": "编辑", "en-US": "Edit"},
        sections: [[{command: "nbook.edit.undo"}, {command: "nbook.edit.redo"}]],
    },
    {
        id: "view",
        title: {"zh-CN": "视图", "en-US": "View"},
        sections: [
            [{command: "nbook.quick-open.open-commands"}],
            [
                {command: "nbook.view.set-part-hidden", args: {part: "sidebar"}, checkedBy: `${WORKBENCH}/sidebarVisible`, label: {"zh-CN": "侧栏", "en-US": "Sidebar"}},
                {command: "nbook.view.set-part-hidden", args: {part: "auxiliarybar"}, checkedBy: `${WORKBENCH}/auxiliaryBarVisible`, label: {"zh-CN": "右栏", "en-US": "Auxiliary Bar"}},
                {command: "nbook.view.set-part-hidden", args: {part: "activitybar"}, checkedBy: `${WORKBENCH}/activityBarVisible`, label: {"zh-CN": "活动栏", "en-US": "Activity Bar"}},
                {command: "nbook.view.set-panel-hidden", checkedBy: `${WORKBENCH}/panelVisible`, label: {"zh-CN": "面板", "en-US": "Panel"}},
                {command: "nbook.view.set-panel-position"},
                {command: "nbook.view.toggle-panel-maximized"},
            ],
            [{command: "nbook.editor.split-right"}, {command: "nbook.editor.split-down"}, {command: "nbook.editor.reopen-with"}],
            [{command: "nbook.settings.switch-theme"}, {command: "nbook.settings.switch-appearance"}, {command: "nbook.settings.switch-locale"}],
            [{command: "nbook.app.reload"}],
        ],
    },
    {
        id: "help",
        title: {"zh-CN": "帮助", "en-US": "Help"},
        sections: [[{command: "nbook.help.documentation"}]],
    },
];
