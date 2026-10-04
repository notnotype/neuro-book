<script setup lang="ts">
/** `/lab` 页面：Component Lab 外壳占满整个视口，滚动发生在各栏内部。 */
import LabShell from "./LabShell.vue";
</script>

<template>
    <div class="h-screen w-screen overflow-hidden" data-lab-page>
        <LabShell />
    </div>
</template>
