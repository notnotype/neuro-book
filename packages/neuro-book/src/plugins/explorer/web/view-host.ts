/**
 * 资源管理器视图的宿主（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：工作台为视图建的每个
 * 实例经它挂上会话，把控制器的状态折成 `FilesExplorerView` 的 props，把界面事件翻成命令或控制器调用。具名动作（工具栏、
 * 右键菜单）执行命令，组件不知道命令 id；树内的焦点移动、展开收起、选择，内联输入与确认框的提交直接调控制器。用
 * 渲染函数写：`bun test` 不能导入 `.vue`。
 */

import {defineComponent, h, onBeforeUnmount, shallowRef, watch} from "vue";
import type {Component, ComputedRef, PropType} from "vue";

import {arrangeMenu, currentKeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {OPEN_PROJECT_COMMAND} from "nbook/plugins/projects/shared/contracts";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {diagnosticText} from "nbook/shared/localized-text";
import type {TextResolver} from "nbook/shared/localized-text";

import type {DropAction, DropOver} from "./actions/drop";
import type {CollisionChoice} from "./actions/paste-plan";
import type {KeyOutcome} from "./controller";
import {nameErrorText} from "./feedback-text";
import type {ExplorerContextItemDeclaration} from "../shared/contracts";
import {menuEntries} from "./menu";
import type {MenuEntry} from "./menu";
import type {ExplorerSession} from "./session";
import type {TreeKey} from "./tree/keys";
import {creatingId} from "./tree/rows";
import type {Row} from "./tree/rows";
import type {Modifiers} from "./tree/selection";

export interface ExplorerViewHostOptions {
    readonly session: ExplorerSession;
    readonly commands: Pick<CommandService, "execute" | "get" | "isEnabled">;
    /** 读菜单项的 `when` 与 `toggled`。 */
    readonly state: Pick<PublicStateService, "read">;
    /** 别的插件经 `explorer.context` 贡献的菜单项。 */
    readonly contextMenu: MenuItemRegistry<ExplorerContextItemDeclaration>;
    /** 菜单项与重命名错误的文字，以及贡献的菜单项标题（可能是 `TextRef`）经窗口端口解析。 */
    readonly text: TextResolver;
    /** 窗口绑定的作品的显示名，项目根显示它；没有绑定项目时为 null。 */
    readonly projectTitle: string | null;
    /** 资源管理器的两个设置项（`shared/settings.ts`），改了即时生效。 */
    readonly display: ComputedRef<{readonly indentGuides: "none" | "hover" | "always"; readonly hideMarkdownExtension: boolean}>;
    /** 命令执行失败（界面已经可用时不该发生）：记诊断。 */
    readonly report: (id: string, reason: string) => void;
}

/** 贡献项的 key 前缀：与固定动作的命令 id 分开，点了以后按贡献 id 找回菜单项、带上选择执行。 */
const CONTRIBUTED = "menu:";

const SELECTION_CONTEXT: ReadonlySet<string> = new Set(["selection"]);

/** 一次右键作用的对象：被右键的选择里的资源，按树里的顺序；文件夹没有可匹配后缀的名字（`name` 为 null）。 */
type MenuTarget = {readonly address: string; readonly name: string | null};

/**
 * 别的插件贡献的右键菜单项（docs/specs/workbench/files-explorer.md 的“右键菜单”）：排在固定动作之后，每节前一条分隔线；
 * 根行没有贡献项。
 */
function contributedEntries(row: Row, targets: ReadonlyArray<MenuTarget>, options: ExplorerViewHostOptions): MenuEntry[] {
    if (row.kind !== "entry" || targets.length === 0) return [];
    const sections = arrangeMenu(options.contextMenu.items(), {
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
        platform: currentKeyPlatform(),
        current: targets.map((target) => target.name),
        contexts: SELECTION_CONTEXT,
    });
    return sections.flatMap((section): MenuEntry[] => [
        {kind: "separator"},
        ...section.map((entry): MenuEntry => ({kind: "item", key: `${CONTRIBUTED}${entry.id}`, label: entry.label, disabled: !entry.enabled, reason: entry.enabled ? null : (entry.reason ?? entry.label), checked: entry.checked, danger: false, shortcut: entry.shortcut})),
    ]);
}

export function createExplorerViewHost(view: Component, options: ExplorerViewHostOptions): Component {
    const {session} = options;
    const execute = (id: string, args: Record<string, unknown> = {}): void => {
        void options.commands.execute(id, args).then((result) => {
            if (!result.ok) options.report(id, `${result.code}：${diagnosticText(result.reason)}`);
        });
    };
    return defineComponent({
        name: "ExplorerViewHost",
        props: {context: {type: Object as PropType<ViewContext>, required: true}},
        setup: (props) => {
            onBeforeUnmount(session.attach({id: props.context.id, generation: props.context.generation, visible: props.context.visible}));
            /**
             * 打开着的右键菜单：属于这个视图实例，视图卸载即消失。`targets` 是打开那一刻被右键的选择（贡献项执行时收到的就是它，
             * 不是点下去时的选择）。
             */
            const menu = shallowRef<{readonly x: number; readonly y: number; readonly row: string; readonly targets: ReadonlyArray<MenuTarget>} | null>(null);
            /** 菜单原语先执行选中的项、再报关闭；这里留着最近一次打开时的对象，执行贡献项时不受关闭的先后影响。 */
            let lastTargets: ReadonlyArray<MenuTarget> = [];
            const runContributed = (id: string): void => {
                const item = options.contextMenu.items().find((candidate) => candidate.id === id);
                if (item === undefined) return;
                const {declaration} = item;
                execute(declaration.command, declaration.context === "selection" ? {addresses: lastTargets.map((target) => target.address)} : {...(declaration.args ?? {})});
            };
            // 切换显示清单文件：投影变了，未提交的菜单随之关闭（拖动由控制器取消）。
            onBeforeUnmount(watch(() => session.controller.value?.showManifests.value, () => {
                menu.value = null;
            }));
            // 视图卸载：这个实例上的拖动手势随之消失，控制器里的拖动也取消。
            onBeforeUnmount(() => session.controller.value?.cancelDrag());
            return () => {
                const controller = session.controller.value;
                const selection = controller?.selection.value;
                const editing = controller?.editing.value ?? null;
                const opened = menu.value;
                const menuRow = opened === null || controller === null ? undefined : controller.rows.value.find((row) => row.id === opened.row);
                return h(view, {
                    rows: controller?.rows.value ?? [],
                    selected: selection?.selected ?? [],
                    focus: selection?.focus ?? null,
                    ready: controller !== null,
                    projectTitle: options.projectTitle,
                    indentGuides: options.display.value.indentGuides,
                    hideMarkdownExtension: options.display.value.hideMarkdownExtension,
                    notice: controller?.notice.value ?? null,
                    problem: session.problem.value,
                    editing: editing === null ? null : {
                        id: editing.mode === "create" ? creatingId(editing.creating.parent) : editing.address,
                        name: editing.name,
                        error: editing.error === null ? null : nameErrorText(options.text, editing.error),
                        busy: editing.busy,
                    },
                    menu: opened === null || menuRow === undefined || controller === null ? null : {x: opened.x, y: opened.y, entries: [...menuEntries(menuRow, controller.available.value, options.text), ...contributedEntries(menuRow, opened.targets, options)]},
                    dialog: controller?.dialog.value ?? null,
                    report: controller?.report.value ?? null,
                    running: controller?.running.value ?? null,
                    unknown: controller?.unknown.value ?? null,
                    drag: controller?.drag.value ?? null,
                    motion: controller?.motion.value ?? null,
                    startDrag: (id: string): boolean => controller?.startDrag(id) ?? false,
                    previewDrop: (over: DropOver | null): DropAction => controller?.previewDrop(over) ?? {kind: "none"},
                    focusRequest: controller?.focusRequest.value ?? 0,
                    handleKey: (key: TreeKey, page: number): KeyOutcome => controller?.key(key, page) ?? "none",
                    onRowPress: (id: string, modifiers: Modifiers, part: "twisty" | "row") => controller?.click(id, modifiers, part),
                    onRowActivate: (id: string) => controller?.activate(id),
                    onRowContext: (id: string, x: number, y: number) => {
                        if (controller === null) return;
                        controller.contextSelect(id);
                        const chosen = new Set(controller.selection.value.selected);
                        lastTargets = controller.rows.value.flatMap((row): MenuTarget[] => (row.kind === "entry" && chosen.has(row.id) ? [{address: row.address, name: row.type === "directory" ? null : row.name}] : []));
                        menu.value = {x, y, row: id, targets: lastTargets};
                    },
                    onMenuCommand: (key: string) => (key.startsWith(CONTRIBUTED) ? runContributed(key.slice(CONTRIBUTED.length)) : execute(key)),
                    onMenuClose: () => {
                        menu.value = null;
                    },
                    onRetry: (address: string) => controller?.model.retry(address),
                    onReconnect: (scheme: "project" | "user") => controller?.model.reconnect(scheme),
                    onOpenProject: () => execute(OPEN_PROJECT_COMMAND),
                    onDismissNotice: () => controller?.dismissNotice(),
                    onDismissReport: () => controller?.dismissReport(),
                    onCancelRunning: () => controller?.running.value?.cancel(),
                    onPrefsRetry: () => void session.retryPreferences(),
                    onPrefsDiscard: () => session.discardPreferences(),
                    onEditInput: (name: string) => controller?.editName(name),
                    onEditCommit: () => void controller?.commitEdit(),
                    onEditCancel: () => controller?.cancelEdit(),
                    onDeleteConfirm: () => void controller?.confirmDelete(),
                    onDisplayCommit: (title: string, icon: string) => void controller?.commitDisplay(title, icon),
                    onDialogClose: () => controller?.closeDialog(),
                    onCollision: (choice: CollisionChoice, all: boolean) => controller?.resolveCollision(choice, all),
                    onDirtyCopy: (choice: "save" | "disk" | "cancel") => controller?.answerDirtyCopy(choice),
                    onRecheck: () => controller?.recheck(),
                    onAbandon: () => controller?.abandon(),
                    onDragHover: (over: DropOver | null) => controller?.hoverDrag(over),
                    onDragDrop: (over: DropOver | null) => void controller?.dropDrag(over),
                    onDragExpand: (id: string) => controller?.model.expand(id),
                    onDragCancel: () => controller?.cancelDrag(),
                });
            };
        },
    });
}
