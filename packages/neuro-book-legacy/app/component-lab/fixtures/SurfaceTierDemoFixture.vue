<script setup lang="ts">
import SurfaceTierDemo from "../SurfaceTierDemo.vue";
import type {LabFixtureProps} from "../lab-subject";

defineProps<LabFixtureProps>();

/**
 * SurfaceTierDemo 的 fixture。这个组件不接 props、没有交互，所以 fixture 只是一个空壳。
 * 它的作用是让 Lab 能挂载这个组件，而不是在画布里显示「还没有人为它写 fixture」。
 */
</script>

<template>
    <SurfaceTierDemo data-lab-subject />
</template>
