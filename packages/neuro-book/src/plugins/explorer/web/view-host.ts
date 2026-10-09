/**
 * 资源管理器视图的宿主（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：工作台为视图建的每个
 * 实例经它挂上会话，把控制器的状态折成 `FilesExplorerView` 的 props，把界面事件翻成命令或控制器调用。具名动作执行
 * 命令，组件不知道命令 id；树内的焦点移动、展开收起与选择直接调控制器。用渲染函数写：`bun test` 不能导入 `.vue`。
 */

import {defineComponent, h, onBeforeUnmount} from "vue";
import type {Component, ComputedRef, PropType} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {OPEN_PROJECT_COMMAND} from "nbook/plugins/projects/shared/contracts";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {COLLAPSE_ALL_COMMAND, REFRESH_FILES_COMMAND, TOGGLE_MANIFESTS_COMMAND} from "./commands";
import type {ExplorerSession} from "./session";
import type {TreeKey} from "./tree/keys";
import type {Modifiers} from "./tree/selection";

export interface ExplorerViewHostOptions {
    readonly session: ExplorerSession;
    readonly commands: Pick<CommandService, "execute">;
    readonly locale: ComputedRef<DisplayLocale>;
    /** 命令执行失败（界面已经可用时不该发生）：记诊断。 */
    readonly report: (id: string, reason: string) => void;
}

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
            return () => {
                const controller = session.controller.value;
                const selection = controller?.selection.value;
                return h(view, {
                    locale: options.locale.value,
                    rows: controller?.rows.value ?? [],
                    selected: selection?.selected ?? [],
                    focus: selection?.focus ?? null,
                    showManifests: controller?.showManifests.value ?? false,
                    ready: controller !== null,
                    notice: controller?.notice.value ?? null,
                    problem: session.problem.value,
                    handleKey: (key: TreeKey, page: number) => controller?.key(key, page) ?? false,
                    onToolbar: (action: "refresh" | "collapse-all" | "toggle-manifests") => {
                        if (action === "refresh") execute(REFRESH_FILES_COMMAND, {viewId: props.context.id, generation: props.context.generation});
                        else execute(action === "collapse-all" ? COLLAPSE_ALL_COMMAND : TOGGLE_MANIFESTS_COMMAND);
                    },
                    onRowPress: (id: string, modifiers: Modifiers, part: "twisty" | "row") => controller?.click(id, modifiers, part),
                    onRowActivate: (id: string) => controller?.activate(id),
                    onRowContext: (id: string) => controller?.contextSelect(id),
                    onRetry: (address: string) => controller?.model.retry(address),
                    onReconnect: (scheme: "project" | "user") => controller?.model.reconnect(scheme),
                    onOpenProject: () => execute(OPEN_PROJECT_COMMAND),
                    onDismissNotice: () => controller?.dismissNotice(),
                    onPrefsRetry: () => void session.store.value?.actions.retry(),
                    onPrefsDiscard: () => session.store.value?.actions.discard(),
                    onFocusChange: (focused: boolean) => {
                        session.treeFocused.value = focused;
                    },
                });
            };
        },
    });
}
