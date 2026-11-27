<script setup lang="ts">
/**
 * 待处理视图骨架的夹具：注入 canon 的翻译端口（`canon-text.ts`）。展开的组是场景的双向绑定，由 Lab 管；选中、更多、点开对象、
 * 打开章节、强行解除与重试记成事件。视图在底部面板里又宽又矮，夹具给一个同样的高度（视图声明 `layout: "fill"`，自己滚动）。
 */
import PendingView from "nbook/plugins/canon/web/components/revisions/PendingView.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof PendingView>(() => props.input, ["select", "more", "open", "open-chapter", "break-exclusive", "retry"]);
</script>

<template>
    <PendingView data-lab-subject class="h-80 w-full" v-bind="subject.bindings.value" />
</template>
