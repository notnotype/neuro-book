<script setup lang="ts">
/**
 * 资源管理器的 Lab 集成场景（docs/specs/workbench/files-explorer.md 验收 13，同名 .md）：产品里同一个视图宿主、视图、
 * 控制器、树模型与命令实现，文件客户端换成内存适配器（`memory-files.ts`）。删除、剪切粘贴、拖动都真的改变场景数据；
 * 偏好不读写存储（Lab 不碰产品 Storage），切场景时控制器、订阅、意图与命令表一起释放。
 */
import {SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, shallowRef} from "vue";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {Release} from "nbook/plugins/commands/shared/contracts";
import {EXPLORER_COMMAND_DECLARATIONS, explorerCommands} from "nbook/plugins/explorer/web/commands";
import FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";
import {createExplorerController} from "nbook/plugins/explorer/web/controller";
import type {ExplorerController} from "nbook/plugins/explorer/web/controller";
import type {AttachedView, ExplorerSession} from "nbook/plugins/explorer/web/session";
import {explorerState, explorerStateValues} from "nbook/plugins/explorer/web/state";
import {createExplorerViewHost} from "nbook/plugins/explorer/web/view-host";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {localize} from "nbook/shared/localized-text";

import {LAB_LOCALE} from "../../lab-locale";
import {useLabEventSink} from "../../lab-event-sink";
import LabFixtureControls from "../../LabFixtureControls.vue";
import {createMemoryFiles} from "./memory-files";
import type {BatchMode} from "./memory-files";

const SOURCE = "nbook.explorer";

const record = useLabEventSink();
const memory = createMemoryFiles({
    project: [
        ["lore.content/content.xml", ""],
        ["lore.content/alice/notes.md", "A"],
        ["lore.content/bob/index.md", "BOB"],
        ["lore.content/stray.md", "S"],
        ["plain/a.md", "PA"],
        ["plain/b.md", "PB"],
        ["plain/sub/x.md", "X"],
        "plain/empty/",
        ["drafts/a.md", "OLD"],
    ],
    user: [["notes.md", "U"]],
    manifests: {"project://lore.content": [{name: "alice", title: "爱丽丝"}, {name: "bob", title: "鲍勃"}, {name: "gone", title: "已删除的条目"}]},
});

const controller = shallowRef<ExplorerController | null>(null);
const view = shallowRef<AttachedView | null>(null);
const values = explorerStateValues(controller);
const keys = Object.fromEntries(Object.entries(explorerState.declarations).map(([name, declaration]) => [explorerState.key(name as keyof typeof explorerState.declarations), localize(declaration.reason, LAB_LOCALE)]));
const registry = createCommandRegistry({
    contextKeys: contextTable(keys, () => Object.fromEntries(Object.entries(values).map(([name, value]) => [explorerState.key(name as keyof typeof values), value.value]))),
    report: (error) => record("command-error", error.message),
});

// Lab 的会话：没有偏好记录，其余与产品的会话同形（命令与视图宿主只用到这些）。
const session: ExplorerSession = {
    controller,
    store: shallowRef(null),
    view,
    problem: computed(() => null),
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
    files: memory.files,
    commands: registry,
    bound: true,
    expanded: ["project://", "project://lore.content", "project://plain"],
    report: (error) => record("error", error instanceof Error ? error.message : String(error)),
});

const releases: Release[] = [];
const implementations = explorerCommands(session, () => LAB_LOCALE);
for (const [id, declaration] of Object.entries(EXPLORER_COMMAND_DECLARATIONS)) {
    const run = implementations[id]?.run;
    if (run === undefined) continue;
    const registered = registry.register({id, source: SOURCE, declaration, run: (args) => {
        record("command", id);
        return run(args);
    }});
    if (registered.ok) releases.push(registered.value);
    else record("command-error", `${id}：${registered.reason}`);
}

const Host = createExplorerViewHost(FilesExplorerView, {
    session,
    commands: registry,
    locale: computed(() => LAB_LOCALE),
    report: (id, reason) => record("command-failed", `${id}：${reason}`),
});
const context: ViewContext = {id: "nbook.explorer", generation: 1, visible: ref(true), location: ref("sidebar")};

const modes: Array<{value: BatchMode; label: string}> = [
    {value: "normal", label: "正常"},
    {value: "fail-second", label: "第二项失败"},
    {value: "unknown", label: "结果未知"},
    {value: "slow", label: "慢速"},
];
const chooseMode = (value: string | number | boolean | null): void => {
    memory.next.value = value as BatchMode;
};
let external = 0;
const createExternal = (): void => {
    external += 1;
    memory.externalCreate(`project://plain/external-${String(external)}.md`, "E");
};

onBeforeUnmount(() => {
    session.dispose();
    for (const release of releases.splice(0)) release();
    memory.dispose();
});
</script>

<template>
    <component :is="Host" :context="context" class="h-full w-full bg-[var(--bg-panel)]" data-lab-subject />
    <LabFixtureControls>
        <div class="flex flex-wrap items-center gap-3 text-xs" data-lab-explorer-controls>
            <span class="text-[var(--text-secondary)]">下一次批量</span>
            <SegmentedControl :model-value="memory.next.value" :options="modes" aria-label="下一次批量" size="sm" data-lab-explorer-batch @update:model-value="chooseMode" />
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-explorer-external @click="createExternal">外部新建文件</button>
            <span class="text-[var(--text-muted)]" data-lab-explorer-watchers>订阅 {{ memory.watchers.value }}</span>
        </div>
    </LabFixtureControls>
</template>
