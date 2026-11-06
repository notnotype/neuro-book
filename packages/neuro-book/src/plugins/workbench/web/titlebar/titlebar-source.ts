/**
 * 外壳的标题栏、状态栏与活动栏底部要的数据（docs/specs/ui/workbench-shell.md 外壳四输出 28–35、输出 40）：应用菜单、命令搜索
 * 的快捷键、两侧的条目与活动栏底部的条目，以及视图标题动作（docs/specs/workbench/views.md 输出 10）。都是响应式读取：命令
 * 增减经 `onDidChange` 推进版本号；命令的可用性与勾选状态读公开状态，在 computed 里读会随值变化重算。组件只拿这里算好的
 * 数据，执行一律经命令服务。
 */

import {shallowRef} from "@vue/reactivity";

import {arrangeMenu, formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, KeyPlatform, MenuFacts, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";
import {assembleTitleActions} from "nbook/ui/menus/title-actions";
import type {TitleActionCandidate, TitleActionsModel} from "nbook/ui/menus/title-actions";

import {TITLEBAR_MENU_GROUPS} from "../../shared/menus";
import type {TitlebarMenuItemDeclaration, ViewTitleItemDeclaration} from "../../shared/menus";
import {workbenchText} from "../../shared/text";
import {VIEW_ACTIONS_MAX} from "../../shared/views";
import type {ViewAction} from "../../shared/views";

import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import type {ActivityItemRegistry, ShownActivityItem} from "../items/activity-items";
import type {ItemRegistry, StripEntry} from "../items/registry";
import type {MenuGroup} from "./menu-model";

/** 交给活动栏的一个底部条目：再带上命令此刻不可用的原因（有命令且不可用时）。 */
export type ActivityEntry = ShownActivityItem & {readonly disabledReason: string | null};

export interface ShellChrome {
    menus(text: TextResolver): MenuGroup[];
    /** 命令面板的快捷键，按平台写好；没有声明时为 null。 */
    searchShortcut(): string | null;
    statusEntries(text: TextResolver): StripEntry[];
    titleEntries(text: TextResolver): StripEntry[];
    activityEntries(text: TextResolver): ActivityEntry[];
    /** 点了一个条目：按它声明的命令执行；条目已不在（入口停止）时什么都不做。 */
    runItem(itemId: string): void;
    /**
     * 一个视图的标题动作此刻的样子（docs/specs/workbench/views.md 输出 10、11）：视图自己声明的 `actions` 在前，别的插件经
     * `workbench.view-title` 贡献的在后；按钮至多 8 个，多出的收进“⋯”。可用与否看命令的 `when`（不可用时带原因），按下态看
     * `toggled` 的公开键；视图实例还没建立（`instance` 为 null）时，要实例的动作不可用。
     */
    /** `maxButtons`：这一行还放得下几个按钮，放不下的收进“⋯”；缺省不再少。 */
    viewActions(viewId: string, actions: ReadonlyArray<ViewAction>, text: TextResolver, instance: ViewInstanceRef | null, maxButtons?: number): TitleActionsModel;
    /**
     * 点了视图标题的一个动作（按 `TitleActionEntry.key` 找，不按位置找：显示的列表会随 `when` 与按钮预算变）：执行它的命令，
     * 要实例的带上被点的视图实例；要实例而实例还没建立、或这一项已不在时不执行。
     */
    runViewAction(viewId: string, actions: ReadonlyArray<ViewAction>, key: string, instance: ViewInstanceRef | null): void;
}

/** 被点的视图实例：视图 id 与它这一次挂载的代际。 */
export interface ViewInstanceRef {
    readonly viewId: string;
    readonly generation: number;
}


/** 标题栏菜单没有位置参数。 */
const NO_CONTEXTS: ReadonlySet<string> = new Set();

/** `runItem` 只按 id 找条目，不用文字。 */
const NO_TEXT: TextResolver = {t: () => "", variants: () => []};

const OWN = "own:";

/** 视图标题的位置参数：实例总给得出，还没建立时由这里禁用（views.md 输出 10）。 */
const INSTANCE_CONTEXT: ReadonlySet<string> = new Set(["instance"]);

export interface ShellChromeOptions {
    readonly commands: CommandService;
    readonly state: Pick<PublicStateService, "read">;
    readonly statusItems: ItemRegistry;
    readonly titleItems: ItemRegistry;
    readonly activityItems: ActivityItemRegistry;
    /** 标题栏菜单的菜单项（`workbench.titlebar-menu`）。 */
    readonly titlebarMenu: MenuItemRegistry<TitlebarMenuItemDeclaration>;
    /** 别的插件给视图标题加的动作（`workbench.view-title`）。 */
    readonly viewTitle: MenuItemRegistry<ViewTitleItemDeclaration>;
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

    /** 命令此刻不可用的原因；没有命令或可用时为 null。 */
    const disabledReason = (item: {readonly title: string; readonly command: {readonly id: string} | null}, text: TextResolver): string | null => {
        if (item.command === null) return null;
        const enabled = commands.isEnabled(item.command.id);
        return enabled.ok ? (enabled.value ? null : item.title) : text.t(enabled.reason);
    };
    const entries = (registry: ItemRegistry, text: TextResolver): StripEntry[] => {
        void version.value;
        return registry.shown(text).map((item) => ({...item, disabledReason: disabledReason(item, text)}));
    };

    /** 菜单项求值要的事实：命令目录、可用性、公开状态；标题栏菜单没有位置参数，视图标题另给 `instance`。 */
    const facts = (text: TextResolver): MenuFacts => ({
        command: (id) => {
            const command = commands.get(id);
            return command.ok ? command.value : null;
        },
        isEnabled: (id) => commands.isEnabled(id),
        isOn: (key) => {
            const read = state.read(key);
            return read.status === "ready" && read.value === true;
        },
        text,
        platform: options.platform,
        current: null,
        contexts: NO_CONTEXTS,
    });

    return {
        menus: (text) => {
            void version.value;
            const items = options.titlebarMenu.items();
            return TITLEBAR_MENU_GROUPS
                .map((group) => ({id: group.id, label: text.t(group.title), sections: arrangeMenu(items.filter((item) => item.declaration.group === group.id), facts(text))}))
                .filter((group) => group.sections.length > 0);
        },
        searchShortcut: () => {
            void version.value;
            const command = commands.get(OPEN_COMMANDS_ID);
            return command.ok && command.value.keybinding !== undefined ? formatKeybinding(command.value.keybinding, options.platform) : null;
        },
        statusEntries: (text) => entries(options.statusItems, text),
        titleEntries: (text) => entries(options.titleItems, text),
        activityEntries: (text) => {
            void version.value;
            return options.activityItems.shown(text).map((item) => ({...item, disabledReason: disabledReason(item, text)}));
        },
        viewActions: (viewId, actions, text, instance, maxButtons = Number.POSITIVE_INFINITY) => {
            void version.value;
            const loading = text.t(workbenchText("viewActions.instanceLoading"));
            const own = actions.map((action, index): TitleActionCandidate => {
                const title = text.t(action.title);
                const enabled = commands.isEnabled(action.command);
                const read = action.toggled === undefined ? null : state.read(action.toggled);
                const waiting = action.args === "instance" && instance === null;
                const metadata = commands.get(action.command);
                const keybinding = metadata.ok ? metadata.value.keybinding : undefined;
                return {menu: action.placement === "menu", entry: {
                    key: `${OWN}${String(index)}`,
                    command: action.command,
                    title,
                    icon: action.icon,
                    disabledReason: waiting ? loading : enabled.ok ? (enabled.value ? null : title) : text.t(enabled.reason),
                    ...(read === null ? {} : {pressed: read.status === "ready" && read.value === true}),
                    ...(keybinding === undefined ? {} : {shortcut: formatKeybinding(keybinding, options.platform)}),
                }};
            });
            const contributed = arrangeMenu(options.viewTitle.items().filter((item) => item.declaration.view === viewId), {...facts(text), contexts: INSTANCE_CONTEXT})
                .map((section) => section.map((item): TitleActionCandidate => ({menu: item.placement === "menu", entry: {
                    key: item.id,
                    command: item.command,
                    title: item.label,
                    icon: item.icon,
                    disabledReason: item.context === "instance" && instance === null ? loading : item.enabled ? null : (item.reason ?? item.label),
                    ...(item.checked === null ? {} : {pressed: item.checked}),
                    ...(item.shortcut === null ? {} : {shortcut: item.shortcut}),
                }})));
            return assembleTitleActions(own, contributed, Math.min(VIEW_ACTIONS_MAX, maxButtons));
        },
        runViewAction: (viewId, actions, key, instance) => {
            const target = instance === null ? {} : {viewId: instance.viewId, generation: instance.generation};
            if (key.startsWith(OWN)) {
                const action = actions[Number(key.slice(OWN.length))];
                if (action === undefined || (action.args === "instance" && instance === null)) return;
                void commands.execute(action.command, action.args === "instance" ? target : {}, {source: "user"});
                return;
            }
            const item = options.viewTitle.items().find((candidate) => candidate.id === key && candidate.declaration.view === viewId);
            if (item === undefined || (item.declaration.context === "instance" && instance === null)) return;
            void commands.execute(item.declaration.command, item.declaration.context === "instance" ? target : (item.declaration.args ?? {}), {source: "user"});
        },
        runItem: (itemId) => {
            const item = [...options.statusItems.shown(NO_TEXT), ...options.titleItems.shown(NO_TEXT), ...options.activityItems.shown(NO_TEXT)].find((entry) => entry.id === itemId);
            if (item?.command == null) return;
            void commands.execute(item.command.id, item.command.args, {source: "user"});
        },
    };
}
