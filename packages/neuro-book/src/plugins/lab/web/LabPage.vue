<script setup lang="ts">
/** `/lab` 页面：Component Lab 外壳占满整个视口，滚动发生在各栏内部。 */
import LabShell from "./LabShell.vue";
import type {LabStore} from "./lab-preferences-store";

defineProps<{store: LabStore}>();
</script>

<template>
    <div class="h-[var(--nb-viewport-block,100vh)] w-full overflow-hidden" data-lab-page>
        <LabShell :store="store" />
    </div>
</template>
