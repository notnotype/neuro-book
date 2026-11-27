<script setup lang="ts">
/**
 * 页面面包屑的夹具。场景的输入会被结构化复制，写不了函数：场景里每段只写文字，哪几段可以点另列在 `actions`（段的下标），
 * 这里补上“点了要做的事”（记一条事件）。
 */
import {computed} from "vue";

import EditorPageBreadcrumbs from "nbook/plugins/editor/web/components/EditorPageBreadcrumbs.vue";

import {type LabFixtureProps, useLabEventSink, useLabSubject} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EditorPageBreadcrumbs>(() => props.input, ["escape"]);
const record = useLabEventSink();

const ACTIONS: Readonly<Record<string, ReadonlyArray<number>>> = {entry: [0, 2], long: [0, 1], plain: []};
const items = computed(() => (subject.bindings.value.items ?? []).map((item, index) => ((ACTIONS[props.scene] ?? []).includes(index) ? {...item, run: () => record("run", item.label)} : item)));
</script>

<template>
    <EditorPageBreadcrumbs data-lab-subject class="w-full" v-bind="subject.bindings.value" :items="items" />
</template>
