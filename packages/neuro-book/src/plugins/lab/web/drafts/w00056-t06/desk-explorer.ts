/**
 * 首页工作台里的资源管理器：产品里同一个视图宿主、控制器与命令（接法同 `fixtures/explorer-scene/ExplorerLiveScene.vue`），
 * 文件是工作台的内存文件；“打开”命令另登记一条，交给同一张桌子的编辑器区，点文件就在编辑组里打开。
 */
import type {TextPort} from "@notnotype/nb-ui/text-port";
import {computed, ref, shallowRef} from "vue";
import type {Component, Ref} from "vue";

import {completeCommandDeclaration, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, Release, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {CommandDefinition} from "nbook/plugins/commands/shared/registry";
import {editorText} from "nbook/plugins/editor/shared/text";
import {EDITOR_COMMAND_DECLARATIONS, OPEN_COMMAND} from "nbook/plugins/editor/web/commands";
import {EXPLORER_COMMAND_DECLARATIONS, explorerCommands} from "nbook/plugins/explorer/web/commands";
import FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";
import {createExplorerController} from "nbook/plugins/explorer/web/controller";
import type {ExplorerController} from "nbook/plugins/explorer/web/controller";
import type {AttachedView, ExplorerSession} from "nbook/plugins/explorer/web/session";
import {explorerState, explorerStateValues} from "nbook/plugins/explorer/web/state";
import {createExplorerViewHost} from "nbook/plugins/explorer/web/view-host";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import type {PanelName} from "@notnotype/nb-workbench-layout";

import type {MemoryFiles} from "../../../../explorer/web/lab/memory-files";

export interface DeskExplorer {
    readonly Host: Component;
    readonly context: ViewContext;
    /** 视图现在在哪个区域：搬到右栏后跟着改（视图按它决定窄宽下的样子）。 */
    readonly location: Ref<PanelName>;
    dispose(): void;
}

export function createDeskExplorer(options: {
    readonly files: MemoryFiles["files"];
    readonly text: TextPort;
    readonly title: string;
    readonly open: (address: string, mode: "preview" | "permanent") => boolean;
    readonly report: (message: string) => void;
}): DeskExplorer {
    const {text} = options;
    const controller = shallowRef<ExplorerController | null>(null);
    const view = shallowRef<AttachedView | null>(null);
    const values = explorerStateValues(controller);
    const keys = Object.fromEntries(Object.entries(explorerState.declarations).map(([name, declaration]) => [explorerState.key(name as keyof typeof explorerState.declarations), text.t(declaration.reason)]));
    const registry = createCommandRegistry({
        contextKeys: contextTable(keys, () => Object.fromEntries(Object.entries(values).map(([name, value]) => [explorerState.key(name as keyof typeof values), value.value]))),
        report: (error) => options.report(error.message),
    });

    // 没有偏好记录的会话，其余与产品的会话同形。
    const session: ExplorerSession = {
        controller,
        store: shallowRef(null),
        view,
        problem: computed(() => null),
        prepare: () => undefined,
        attach: (attached) => {
            view.value = attached;
            return () => {
                if (view.value === attached) view.value = null;
            };
        },
        setShowManifests: (show) => controller.value?.setShowManifests(show),
        retryPreferences: async () => undefined,
        discardPreferences: () => undefined,
        dispose: () => {
            controller.value?.dispose();
            controller.value = null;
            view.value = null;
        },
    };
    controller.value = createExplorerController({
        files: options.files,
        commands: registry,
        bound: true,
        expanded: ["project://", "project://正文", "project://设定"],
        report: (error) => options.report(error instanceof Error ? error.message : String(error)),
    });

    const releases: Release[] = [];
    const register = (id: string, plugin: string, declaration: WrittenCommandDeclaration, run: CommandDefinition["run"]): void => {
        const registered = registry.register({id, source: plugin, declaration: completeCommandDeclaration({plugin, id, declaration}) as CommandDeclaration, run});
        if (registered.ok) releases.push(registered.value);
        else options.report(`${id}：${registered.reason}`);
    };
    const implementations = explorerCommands(session, text);
    for (const [id, declaration] of Object.entries(EXPLORER_COMMAND_DECLARATIONS)) {
        const run = implementations[id]?.run;
        if (run !== undefined) register(id, "nbook.explorer", declaration, run);
    }
    // 编辑器区的“打开”：产品里由 nbook.editor 登记，这里只要这一条。
    const openDeclaration = EDITOR_COMMAND_DECLARATIONS[OPEN_COMMAND];
    if (openDeclaration !== undefined) {
        register(OPEN_COMMAND, "nbook.editor", openDeclaration, (args) => {
            const {address, mode} = args as {readonly address: string; readonly mode: "preview" | "permanent"};
            return options.open(address, mode) ? {ok: true, value: null} : {ok: false, code: "unavailable", reason: editorText("refusal.noPage", {id: address})};
        });
    }

    const scene = new AbortController();
    const Host = createExplorerViewHost(FilesExplorerView, {
        session,
        commands: registry,
        state: {read: () => ({status: "undeclared"})},
        text,
        contextMenu: new MenuItemRegistry([], scene.signal),
        projectTitle: options.title,
        display: computed(() => ({indentGuides: "hover" as const, hideMarkdownExtension: true})),
        report: (id, reason) => options.report(`${id}：${reason}`),
    });
    const location = ref<PanelName>("sidebar");
    const context: ViewContext = {id: "nbook.explorer", generation: 1, visible: ref(true), location};

    return {
        Host,
        context,
        location,
        dispose: () => {
            session.dispose();
            for (const release of releases.splice(0)) release();
            scene.abort();
        },
    };
}
