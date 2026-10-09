/**
 * 资源管理器视图的宿主（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：工作台为视图建的每个
 * 实例经它挂上会话，把控制器的状态折成 `FilesExplorerView` 的 props，把界面事件翻成命令或控制器调用。具名动作（工具栏、
 * 右键菜单）执行命令，组件不知道命令 id；树内的焦点移动、展开收起、选择，内联输入与确认框的提交直接调控制器。用
 * 渲染函数写：`bun test` 不能导入 `.vue`。
 */

import {defineComponent, h, onBeforeUnmount, shallowRef, watch} from "vue";
import type {Component, ComputedRef, PropType} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {OPEN_PROJECT_COMMAND} from "nbook/plugins/projects/shared/contracts";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {COLLAPSE_ALL_COMMAND, NEW_FILE_COMMAND, NEW_FOLDER_COMMAND, REFRESH_FILES_COMMAND, TOGGLE_MANIFESTS_COMMAND} from "./commands";
import type {DropZone} from "./actions/drop";
import type {CollisionChoice} from "./actions/paste-plan";
import type {KeyOutcome} from "./controller";
import {nameErrorText} from "./feedback-text";
import {menuEntries} from "./menu";
import type {ExplorerSession} from "./session";
import type {TreeKey} from "./tree/keys";
import {creatingId} from "./tree/rows";
import type {Modifiers} from "./tree/selection";

export interface ExplorerViewHostOptions {
    readonly session: ExplorerSession;
    readonly commands: Pick<CommandService, "execute">;
    readonly locale: ComputedRef<DisplayLocale>;
    /** 命令执行失败（界面已经可用时不该发生）：记诊断。 */
    readonly report: (id: string, reason: string) => void;
}

type ToolbarAction = "new-file" | "new-folder" | "refresh" | "collapse-all" | "toggle-manifests";

export function createExplorerViewHost(view: Component, options: ExplorerViewHostOptions): Component {
    const {session} = options;
    const execute = (id: string, args: Record<string, unknown> = {}): void => {
        void options.commands.execute(id, args).then((result) => {
            if (!result.ok) options.report(id, `${result.code}：${result.reason}`);
        });
    };
    return defineComponent({
        name: "ExplorerViewHost",
        props: {context: {type: Object as PropType<ViewContext>, required: true}},
        setup: (props) => {
            onBeforeUnmount(session.attach({id: props.context.id, generation: props.context.generation, visible: props.context.visible}));
            /** 打开着的右键菜单：属于这个视图实例，视图卸载即消失。 */
            const menu = shallowRef<{readonly x: number; readonly y: number; readonly row: string} | null>(null);
            // 切换显示清单文件：投影变了，未提交的菜单随之关闭（拖动由控制器取消）。
            onBeforeUnmount(watch(() => session.controller.value?.showManifests.value, () => {
                menu.value = null;
            }));
            // 视图卸载：这个实例上的拖动手势随之消失，控制器里的拖动也取消。
            onBeforeUnmount(() => session.controller.value?.cancelDrag());
            const toolbar: Readonly<Record<ToolbarAction, () => void>> = {
                "new-file": () => execute(NEW_FILE_COMMAND),
                "new-folder": () => execute(NEW_FOLDER_COMMAND),
                "refresh": () => execute(REFRESH_FILES_COMMAND, {viewId: props.context.id, generation: props.context.generation}),
                "collapse-all": () => execute(COLLAPSE_ALL_COMMAND),
                "toggle-manifests": () => execute(TOGGLE_MANIFESTS_COMMAND),
            };
            return () => {
                const controller = session.controller.value;
                const locale = options.locale.value;
                const selection = controller?.selection.value;
                const editing = controller?.editing.value ?? null;
                const opened = menu.value;
                const menuRow = opened === null || controller === null ? undefined : controller.rows.value.find((row) => row.id === opened.row);
                return h(view, {
                    locale,
                    rows: controller?.rows.value ?? [],
                    selected: selection?.selected ?? [],
                    focus: selection?.focus ?? null,
                    showManifests: controller?.showManifests.value ?? false,
                    ready: controller !== null,
                    notice: controller?.notice.value ?? null,
                    problem: session.problem.value,
                    canCreate: controller?.available.value.create ?? false,
                    editing: editing === null ? null : {
                        id: editing.mode === "create" ? creatingId(editing.creating.parent) : editing.address,
                        name: editing.name,
                        error: editing.error === null ? null : nameErrorText(locale, editing.error),
                        busy: editing.busy,
                    },
                    menu: opened === null || menuRow === undefined || controller === null ? null : {x: opened.x, y: opened.y, entries: menuEntries(menuRow, controller.available.value, locale)},
                    dialog: controller?.dialog.value ?? null,
                    report: controller?.report.value ?? null,
                    running: controller?.running.value ?? null,
                    unknown: controller?.unknown.value ?? null,
                    drag: controller?.drag.value ?? null,
                    startDrag: (id: string): boolean => controller?.startDrag(id) ?? false,
                    focusRequest: controller?.focusRequest.value ?? 0,
                    handleKey: (key: TreeKey, page: number): KeyOutcome => controller?.key(key, page) ?? "none",
                    onToolbar: (action: ToolbarAction) => toolbar[action](),
                    onRowPress: (id: string, modifiers: Modifiers, part: "twisty" | "row") => controller?.click(id, modifiers, part),
                    onRowActivate: (id: string) => controller?.activate(id),
                    onRowContext: (id: string, x: number, y: number) => {
                        controller?.contextSelect(id);
                        menu.value = {x, y, row: id};
                    },
                    onMenuCommand: (command: string) => execute(command),
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
                    onRecheck: () => controller?.recheck(),
                    onAbandon: () => controller?.abandon(),
                    onDragHover: (over: {readonly id: string; readonly zone: DropZone} | null) => controller?.hoverDrag(over),
                    onDragDrop: (over: {readonly id: string; readonly zone: DropZone} | null) => void controller?.dropDrag(over),
                    onDragCancel: () => controller?.cancelDrag(),
                });
            };
        },
    });
}
