<script setup lang="ts">
/** WorkbenchViewSection 的夹具：插槽放样例内容与一个动作按钮；收起开关写回 `collapsed`，让场景里真的能切换。 */
import {computed} from "vue";

import {IconButton} from "@notnotype/nb-ui/components";

import WorkbenchViewSection from "nbook/plugins/workbench/web/components/WorkbenchViewSection.vue";

import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchViewSection>(() => props.input, ["toggle-collapsed"]);
const rows = computed(() => (props.scene === "short" ? 4 : 40));
</script>

<template>
    <div class="h-full w-full bg-[var(--panel-surface)]">
        <WorkbenchViewSection
            data-lab-subject
            v-bind="subject.bindings.value"
            @toggle-collapsed="(collapsed: boolean) => subject.write('props', 'collapsed', collapsed)"
        >
            <template v-if="subject.slots.value.actions" #actions>
                <IconButton size="sm" icon-class="i-lucide-arrow-right-left" aria-label="移动到" />
            </template>
            <template v-if="subject.slots.value.default" #default>
                <ul v-if="subject.bindings.value.layout === 'scroll'" class="text-sm">
                    <li v-for="row in rows" :key="row" class="rounded px-2 py-1 hover:bg-[var(--bg-hover)]">条目 {{ row }}</li>
                </ul>
                <div v-else class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">fill：视图占满、自己滚动</div>
            </template>
        </WorkbenchViewSection>
    </div>
</template>
