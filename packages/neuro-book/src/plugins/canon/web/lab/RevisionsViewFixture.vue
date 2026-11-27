<script setup lang="ts">
/**
 * 改动记录视图骨架的夹具：注入 canon 的翻译端口（`canon-text.ts`）。两个筛选与当前行是场景的双向绑定，由 Lab 管；`receipt`、
 * `revert`、`more`、`retry` 记成事件。视图在底部面板里又宽又矮，夹具给一个同样的高度（视图声明 `layout: "fill"`，自己滚动）。
 */
import RevisionsView from "nbook/plugins/canon/web/components/revisions/RevisionsView.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof RevisionsView>(() => props.input, ["receipt", "revert", "more", "retry"]);
</script>

<template>
    <RevisionsView data-lab-subject class="h-72 w-full" v-bind="subject.bindings.value" />
</template>
