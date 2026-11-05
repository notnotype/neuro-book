/**
 * 编辑器区交给 Markdown 控件的菜单（docs/specs/workbench/markdown-editing.md）：内置项执行命令，贡献项按 `arrangeMenu` 排好。
 * 控件不引命令服务：它在按需加载的代码里，只认这一个接口。
 */

import {computed} from "@vue/reactivity";
import type {Ref} from "@vue/reactivity";

import {arrangeMenu, formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, KeyPlatform, MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import type {DisplayText, TextResolver} from "nbook/shared/localized-text";

import type {EditorMenus, EditorToolbarPlacement} from "../shared/contracts";
import {EDITING_ACTIONS, editingCommandId} from "../shared/editing";
import type {EditingActionId, EditingActionInfo} from "../shared/editing";
import {editorText} from "../shared/text";
import type {EditorArea} from "./area";
import {nameOf} from "./documents/address";

type Items = () => ReadonlyArray<{readonly id: string; readonly declaration: MenuItemDeclaration}>;

const RESOURCE: ReadonlySet<string> = new Set(["resource"]);
const NONE: ReadonlySet<string> = new Set();

export function createEditorMenus(options: {
    readonly area: () => Pick<EditorArea, "groups"> | null;
    readonly commands: Pick<CommandService, "get" | "isEnabled" | "execute">;
    readonly state: Pick<PublicStateService, "read">;
    readonly items: Readonly<Record<string, Items>>;
    readonly platform: KeyPlatform;
    readonly text: TextResolver;
    /** 命令增减不经响应式通知（同编辑区标题的动作）：读的时候依赖它。 */
    readonly version: Readonly<Ref<number>>;
    readonly toolbarVisible: Readonly<Ref<boolean>>;
    readonly toolbarPlacement: Readonly<Ref<EditorToolbarPlacement>>;
    readonly notify: (text: DisplayText) => void;
    readonly report: (error: unknown) => void;
}): EditorMenus {
    const activeAddress = (): string | null => {
        const groups = options.area()?.groups;
        const tab = groups?.activeTab() ?? null;
        return tab === null || tab.kind === "page" ? null : tab.address;
    };
    const execute = (command: string, args: Readonly<Record<string, unknown>> = {}): void => {
        void options.commands.execute(command, args, {source: "user"});
    };
    return {
        title: (action) => options.text.t(editorText(`commands.nbook.edit.${action}.title` as never)),
        label: (key) => options.text.t(editorText(`menus.${key}` as never)),
        shortcut: (action) => {
            const keybinding = (EDITING_ACTIONS[action] as EditingActionInfo).keybinding;
            return keybinding === undefined ? null : formatKeybinding(keybinding, options.platform);
        },
        has: (command) => {
            void options.version.value;
            return options.commands.get(command).ok;
        },
        run: (action: EditingActionId, args) => execute(editingCommandId(action), args),
        execute,
        contributed: (point) => {
            void options.version.value;
            const address = activeAddress();
            return arrangeMenu(options.items[point]?.() ?? [], {
                command: (id) => {
                    const command = options.commands.get(id);
                    return command.ok ? command.value : null;
                },
                isEnabled: (id) => options.commands.isEnabled(id),
                isOn: (key) => {
                    const read = options.state.read(key);
                    return read.status === "ready" && read.value === true;
                },
                text: options.text,
                platform: options.platform,
                current: address === null ? null : [nameOf(address)],
                contexts: address === null ? NONE : RESOURCE,
            });
        },
        runContributed: (point, id) => {
            const declaration = options.items[point]?.().find((item) => item.id === id)?.declaration;
            if (declaration === undefined) return;
            const address = activeAddress();
            if (declaration.context === "resource") {
                if (address !== null) execute(declaration.command, {address});
                return;
            }
            execute(declaration.command, declaration.args ?? {});
        },
        toolbarVisible: computed(() => options.toolbarVisible.value),
        toolbarPlacement: computed(() => options.toolbarPlacement.value),
        keyLabel: (keybinding) => formatKeybinding(keybinding, options.platform),
        notify: (key) => options.notify(editorText(`menus.${key}` as never)),
        reportError: options.report,
    };
}
