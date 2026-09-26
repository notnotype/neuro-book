<script setup lang="ts">
import {ref, watch} from "vue";
import EditorWelcome from "nbook/app/components/editor-workbench/EditorWelcome.vue";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EditorWelcome>(() => props.input);
const emitLabEvent = useLabEventSink();
const lastEvent = ref("（还没有事件）");

watch(() => props.scene, () => { lastEvent.value = "（还没有事件）"; }, {immediate: true});

/** 事件名与载荷一起显示：主按钮落在「继续 X」还是「新建章节」，只有载荷看得出来。 */
function forward(name: string, payload?: unknown): void {
    lastEvent.value = payload === undefined ? name : `${name} ${JSON.stringify(payload)}`;
    emitLabEvent(name, payload);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col">
        <EditorWelcome
            data-lab-subject
            v-bind="subject.bindings.value"
            class="min-h-0 flex-1"
            @select-tab="(path: string) => forward('select-tab', path)"
            @open-path="(path: string) => forward('open-path', path)"
            @open-files="forward('open-files')"
            @create-chapter="forward('create-chapter')"
            @create-markdown-file="forward('create-markdown-file')"
            @create-lorebook-entry="forward('create-lorebook-entry')"
            @open-agent-panel="forward('open-agent-panel')"
            @open-profile-workbench="forward('open-profile-workbench')"
        />
        <p class="shrink-0 border-t border-[var(--divider)] px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
            最近事件：{{ lastEvent }}
        </p>
    </div>
</template>
