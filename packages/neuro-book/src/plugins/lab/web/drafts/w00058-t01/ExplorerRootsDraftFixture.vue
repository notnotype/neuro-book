<script setup lang="ts">
/** w00058 t01 资源管理器静态稿的台子：草稿铺满画布。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import ExplorerRootsDraft from "./ExplorerRootsDraft.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ExplorerRootsDraft>(() => props.input, []);
</script>

<template>
    <div class="h-full w-full bg-[var(--bg-sidebar)]" data-lab-subject>
        <ExplorerRootsDraft v-bind="subject.bindings.value" />
    </div>
</template>
