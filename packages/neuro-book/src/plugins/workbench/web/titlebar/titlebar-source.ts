/**
 * 外壳的标题栏与状态栏要的数据（docs/specs/ui/workbench-shell.md 外壳四输出 28–35）：应用菜单、命令搜索的快捷键、两侧
 * 的条目。都是响应式读取：命令增减经 `onDidChange` 推进版本号；命令的可用性与勾选状态读公开状态，在 computed 里读会
 * 随值变化重算。组件只拿这里算好的数据，执行一律经命令服务。
 */

import {shallowRef} from "@vue/reactivity";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {formatKeybinding} from "../commands/keymap";
import type {KeyPlatform} from "../commands/keymap";
import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import type {ItemRegistry, StripEntry} from "../items/registry";
import {buildMenus, TITLEBAR_MENUS} from "./menu-model";
import type {MenuGroup} from "./menu-model";

export interface ShellChrome {
    menus(locale: DisplayLocale): MenuGroup[];
    /** 命令面板的快捷键，按平台写好；没有声明时为 null。 */
    searchShortcut(): string | null;
    statusEntries(locale: DisplayLocale): StripEntry[];
    titleEntries(locale: DisplayLocale): StripEntry[];
    /** 点了一个条目：按它声明的命令执行；条目已不在（入口停止）时什么都不做。 */
    runItem(itemId: string): void;
}

export interface ShellChromeOptions {
    readonly commands: CommandService;
    readonly state: Pick<PublicStateService, "read">;
    readonly statusItems: ItemRegistry;
    readonly titleItems: ItemRegistry;
    readonly platform: KeyPlatform;
    readonly signal: AbortSignal;
}

export function createShellChrome(options: ShellChromeOptions): ShellChrome {
    const {commands, state} = options;
    const version = shallowRef(0);
    const release = commands.onDidChange(() => {
        version.value += 1;
    });
    options.signal.addEventListener("abort", () => release(), {once: true});

    const entries = (registry: ItemRegistry, locale: DisplayLocale): StripEntry[] => {
        void version.value;
        return registry.shown(locale).map((item) => {
            if (item.command === null) return {...item, disabledReason: null};
            const enabled = commands.isEnabled(item.command.id);
            return {...item, disabledReason: enabled.ok ? (enabled.value ? null : item.title) : enabled.reason};
        });
    };

    return {
        menus: (locale) => {
            void version.value;
            return buildMenus(TITLEBAR_MENUS, {
                commands: commands.list(),
                isEnabled: (id) => commands.isEnabled(id),
                checked: (key) => {
                    const read = state.read(key);
                    return read.status === "ready" && read.value === true;
                },
                desktop: false,
                locale,
                platform: options.platform,
            });
        },
        searchShortcut: () => {
            void version.value;
            const command = commands.get(OPEN_COMMANDS_ID);
            return command.ok && command.value.keybinding !== undefined ? formatKeybinding(command.value.keybinding, options.platform) : null;
        },
        statusEntries: (locale) => entries(options.statusItems, locale),
        titleEntries: (locale) => entries(options.titleItems, locale),
        runItem: (itemId) => {
            const item = [...options.statusItems.shown("en-US"), ...options.titleItems.shown("en-US")].find((entry) => entry.id === itemId);
            if (item?.command == null) return;
            void commands.execute(item.command.id, item.command.args, {source: "user"});
        },
    };
}
