<script setup lang="ts">
/**
 * AgentSessionTreeDialog 的 Component Lab 规范夹具。
 */
import {computed, watch} from "vue";
import AgentSessionTreeDialog from "nbook/app/components/novel-ide/agent/dialogs/session-tree/AgentSessionTreeDialog.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {sampleSessionTree} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSessionTreeDialog>(() => props.input, ["select", "copy-id"]);
const syncLabData = useLabDataSink();
const emitLabEvent = useLabEventSink();

const open = computed(() => subject.bindings.value.modelValue);
const tree = computed(() => subject.bindings.value.tree);
const activeLeafId = computed(() => subject.bindings.value.activeLeafId);
const running = computed(() => subject.bindings.value.running);
const canActivate = computed(() => subject.bindings.value.canActivate);

watch([() => props.scene, open, tree, activeLeafId, running, canActivate], () => {
    syncLabData({
        scene: props.scene,
        open: open.value,
        nodeCount: tree.value.length,
        activeLeafId: activeLeafId.value,
        running: running.value,
        canActivate: canActivate.value,
    });
}, {immediate: true});

function handleActivateNode(entryId: string): void {
    const activeIds = new Set<string>();
    const nodeMap = new Map(tree.value.map((node) => [node.id, node]));
    let cursor: string | null = entryId;
    while (cursor) {
        activeIds.add(cursor);
        cursor = nodeMap.get(cursor)?.parentId ?? null;
    }
    const nextTree = tree.value.map((node) => ({
        ...node,
        active: activeIds.has(node.id),
    }));
    subject.write("props", "activeLeafId", entryId);
    subject.write("props", "tree", nextTree);
}

function toggleOpenControl(): void {
    const next = !open.value;
    emitLabEvent("update:modelValue", next);
    subject.write("model", "modelValue", next);
}

function toggleRunningControl(): void {
    const nextRunning = !running.value;
    subject.write("props", "running", nextRunning);
    subject.write("props", "canActivate", !nextRunning);
}

function toggleTreeControl(): void {
    if (tree.value.length > 0) {
        subject.write("props", "tree", []);
        subject.write("props", "activeLeafId", null);
    } else {
        subject.write("props", "tree", sampleSessionTree);
        subject.write("props", "activeLeafId", "entry-user-0006b");
    }
}
</script>

<template>
    <div class="novel-ide-theme relative flex h-full w-full items-center justify-center [transform:translateZ(0)]" data-lab-subject>
        <div v-if="!open" class="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--border-color)] px-8 py-8 text-xs text-[var(--text-muted)]">
            <span class="i-lucide-git-branch mb-2 h-6 w-6 opacity-40"></span>
            <span>会话节点树弹窗已关闭</span>
            <button
                type="button"
                class="mt-2 text-[var(--accent-text)] hover:underline cursor-pointer"
                @click="toggleOpenControl"
            >
                点击打开弹窗
            </button>
        </div>

        <AgentSessionTreeDialog
            v-bind="subject.bindings.value"
            @select="handleActivateNode"
        />
    </div>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">AgentSessionTreeDialog 调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleOpenControl"
                >
                    {{ open ? "关闭弹窗" : "打开弹窗" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleRunningControl"
                >
                    {{ running ? "恢复空闲可激活" : "模拟运行中禁用" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleTreeControl"
                >
                    {{ tree.length > 0 ? "清空节点树" : "恢复节点树" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
