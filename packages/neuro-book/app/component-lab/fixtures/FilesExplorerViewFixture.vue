<script setup lang="ts">
import {ref, watch} from "vue";
import FilesExplorerView from "nbook/app/components/novel-ide/workspace/FilesExplorerView.vue";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFileClipboardIntent, WorkspaceFileMovePayload} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
// 事件由下面的处理函数按路径摘要上报，不交给 useLabSubject 再记一份整节点载荷。
const subject = useLabSubject<typeof FilesExplorerView>(() => props.input);
const emitLabEvent = useLabEventSink();
const clipboard = ref<WorkspaceFileClipboardIntent | null>(null);
const lastEvent = ref("");

watch(() => props.scene, () => {
    clipboard.value = null;
    lastEvent.value = "";
}, {immediate: true});

function report(name: string, payload?: unknown): void {
    lastEvent.value = payload === undefined ? name : `${name} ${JSON.stringify(payload)}`;
    emitLabEvent(name, payload);
}
function select(node: WorkspaceFileNode): void {
    subject.write("props", "selectedPath", node.path);
    report("select", node.path);
}
function open(node: WorkspaceFileNode): void {
    const path = node.isDirectory ? `${node.path}/index.md` : node.path;
    if (!subject.bindings.value.nodes.some(item => item.path === path && !item.isDirectory)) return;
    subject.write("props", "selectedPath", path);
    report("open", path);
}
function move(payload: WorkspaceFileMovePayload): void {
    report("move-intent", payload);
}
function clipboardIntent(intent: WorkspaceFileClipboardIntent): void {
    if (intent.kind === "clear") {
        clipboard.value = null;
    } else if (intent.kind === "copy" || intent.kind === "cut") {
        clipboard.value = intent;
    } else if (intent.kind === "paste") {
        const sources = clipboard.value && "sources" in clipboard.value ? clipboard.value.sources : [];
        report("paste-intent", {sources, destination: intent.destination});
    }
    report("clipboard-intent", intent);
}
function retry(): void {
    subject.write("props", "error", null);
    subject.write("props", "loading", false);
    report("retry");
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col">
        <FilesExplorerView
            data-lab-subject
            class="min-h-0 flex-1"
            v-bind="subject.bindings.value"
            @select="select" @open="open" @move="move" @clipboard-intent="clipboardIntent"
            @node-contextmenu="(node: WorkspaceFileNode) => report('node-contextmenu', node.path)"
            @root-contextmenu="report('root-contextmenu')"
            @create-root-content="report('create-root-content')" @retry="retry"
        />
        <p class="shrink-0 border-t border-[var(--divider)] px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
            {{ lastEvent || '本地文件场景' }}
        </p>
    </div>
</template>
