<script setup lang="ts">
import SideDetailPanel from "nbook/app/components/common/SideDetailPanel.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof SideDetailPanel>(() => props.input);
const longBody = Array.from({length: 12}, (_, index) => `第 ${String(index + 1)} 条：主角在旧城档案里找到守钟人的手记，记录时间比钟楼停摆早了三年。`);
</script>

<template>
    <SideDetailPanel
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
        @close="subject.write('props', 'visible', false)"
    >
        <template v-if="subject.slots.value.header" #header>
            <span class="min-w-0 truncate text-sm font-semibold text-[var(--text-main)]">章节详情</span>
        </template>
        <template v-if="subject.slots.value.actions" #actions>
            <span class="text-xs text-[var(--text-secondary)]">只读操作区</span>
        </template>
        <template v-if="subject.slots.value.default">
            <div class="space-y-2 p-3 text-sm text-[var(--text-main)]">
                <p>第八章：钟楼停摆后的清晨</p>
                <template v-if="props.scene === 'long'">
                    <p v-for="line in longBody" :key="line" class="text-[var(--text-secondary)]">{{ line }}</p>
                </template>
                <p v-else class="text-[var(--text-secondary)]">主角在旧城档案中找到守钟人的手记，发现记录时间比钟楼停摆早了三年。</p>
            </div>
        </template>
    </SideDetailPanel>
    <LabFixtureControls>
        <span class="text-xs text-[var(--text-secondary)]">拖动面板顶部手柄调整高度；使用面板标题或收起按钮折叠内容。</span>
    </LabFixtureControls>
</template>
