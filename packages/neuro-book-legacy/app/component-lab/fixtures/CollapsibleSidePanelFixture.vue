<script setup lang="ts">
import {computed} from "vue";
import CollapsibleSidePanel from "../CollapsibleSidePanel.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof CollapsibleSidePanel>(() => props.input);

// 行数只决定默认插槽内容，不是 CollapsibleSidePanel 的 prop。
const rows = computed(() => props.scene === "long" ? 40 : 6);

const side = computed(() => subject.bindings.value.side ?? "left");
// 零件自己不画边框（形状归使用方），所以这里补一条贴边用法的分割线，
// 否则内容层那一档与旁边的内容区同色，看不出栏在哪结束。
const seamClass = computed(() => (side.value === "left"
    ? "border-r-[length:var(--border-w)] border-[color:var(--divider)]"
    : "border-l-[length:var(--border-w)] border-[color:var(--divider)]"));

</script>

<template>
    <div class="flex h-full min-h-0">
        <CollapsibleSidePanel
            data-lab-subject
            v-bind="subject.bindings.value"
            :class="[subject.bindings.value.collapsed ? '' : 'w-[220px] shrink-0', seamClass]"
        >
            <template v-if="subject.slots.value.actions" #actions>
                <span class="i-lucide-settings h-4 w-4 text-[var(--text-muted)]"></span>
            </template>
            <template v-if="subject.slots.value.default" #default>
                <ul class="p-2 text-sm">
                    <li v-for="row in rows" :key="row" class="rounded px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                        条目 {{ row }}
                    </li>
                </ul>
            </template>

        </CollapsibleSidePanel>
        <div class="min-w-0 flex-1 p-4 text-sm text-[var(--text-muted)]">
            这块代表侧栏旁边的内容区。收起侧栏后它会变宽。
        </div>
    </div>
</template>
