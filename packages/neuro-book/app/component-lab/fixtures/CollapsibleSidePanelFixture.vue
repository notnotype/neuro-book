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
        layer: data.layer === "content" ? "content" as const : "nav" as const,
    };
});

// 内容层那一档也摆在右边：产品里用它的正是右栏，摆左边看不出它要对比的是什么。
const side = computed(() => (props.scene === "right" || props.scene === "content" ? "right" : "left") as "left" | "right");

// 切场景时回到该场景的初始状态，否则重复打开同一场景看到的不是同一件事。
watch(() => props.scene, (scene) => {
    collapsed.value = scene === "collapsed";
}, {immediate: true});

// 零件自己不画边框（形状归使用方），所以这里补一条贴边用法的分割线，
// 否则内容层那一档与旁边的内容区同色，看不出栏在哪结束。
const seamClass = computed(() => (side.value === "left"
    ? "border-r-[length:var(--border-w)] border-[color:var(--divider)]"
    : "border-l-[length:var(--border-w)] border-[color:var(--divider)]"));

function onCollapsedChange(value: boolean): void {
    collapsed.value = value;
    emitLabEvent("update:collapsed", value);
}
</script>

<template>
    <div class="flex h-full min-h-0">
        <CollapsibleSidePanel
            data-lab-subject
            :collapsed="collapsed"
            :title="knobs.title"
            :side="side"
            :layer="knobs.layer"
            :collapsed-width="knobs.collapsedWidth"
            :class="[collapsed ? '' : 'w-[220px] shrink-0', seamClass]"
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
