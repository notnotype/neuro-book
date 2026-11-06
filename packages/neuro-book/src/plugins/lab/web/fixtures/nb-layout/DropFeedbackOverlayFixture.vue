<script setup lang="ts">
/**
 * DropFeedbackOverlay 的场景：静态的三种预览绑定场景输入；“拖动会话”场景是真实的一场拖动，覆盖层画的是会话发布的落点，
 * 也是 `createDragSession` 的验收场景（它不是组件，在 Lab 里没有自己的条目）。
 */
import {DropFeedbackOverlay} from "@notnotype/nb-layout/vue";

import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import DragSessionScene from "./DragSessionScene.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof DropFeedbackOverlay>(() => props.input);
</script>

<template>
    <DragSessionScene v-if="props.scene === 'session'" />
    <DropFeedbackOverlay v-else data-lab-subject class="h-full w-full" v-bind="subject.bindings.value" />
</template>
