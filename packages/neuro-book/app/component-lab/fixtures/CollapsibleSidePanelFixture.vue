<script setup lang="ts">
import {computed, ref, watch} from "vue";
import CollapsibleSidePanel from "../CollapsibleSidePanel.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const collapsed = ref(false);

const knobs = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        title: typeof data.title === "string" ? data.title : "示例侧栏",
        collapsedWidth: typeof data.collapsedWidth === "number" ? data.collapsedWidth : 40,
        rows: typeof data.rows === "number" ? data.rows : 6,
    };
});

const side = computed(() => (props.scene === "right" ? "right" : "left") as "left" | "right");

// 切场景时回到该场景的初始状态，否则重复打开同一场景看到的不是同一件事。
watch(() => props.scene, (scene) => {
    collapsed.value = scene === "collapsed";
}, {immediate: true});

function onCollapsedChange(value: boolean): void {
    collapsed.value = value;
    emitLabEvent("update:collapsed", value);
}
</script>

<template>
    <div class="flex h-full min-h-0">
        <CollapsibleSidePanel
            :collapsed="collapsed"
            :title="knobs.title"
            :side="side"
            :collapsed-width="knobs.collapsedWidth"
            :class="collapsed ? '' : 'w-[220px] shrink-0'"
            @update:collapsed="onCollapsedChange"
        >
            <template #actions>
                <span class="i-lucide-settings h-4 w-4 text-[var(--text-muted)]"></span>
            </template>
            <ul class="p-2 text-sm">
                <li v-for="row in knobs.rows" :key="row" class="rounded px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                    条目 {{ row }}
                </li>
            </ul>
        </CollapsibleSidePanel>

        <div class="min-w-0 flex-1 p-4 text-sm text-[var(--text-muted)]">
            这块代表侧栏旁边的内容区。收起侧栏后它会变宽。
        </div>
    </div>
</template>
