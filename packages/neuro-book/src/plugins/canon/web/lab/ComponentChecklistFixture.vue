<script setup lang="ts">
/**
 * 模块勾选列表的夹具：注入 canon 的翻译端口（`canon-text.ts`）。各项、种类、模板与勾着的来自场景；点已添加的那一行、Ctrl 加回车
 * 记成事件。
 */
import ComponentChecklist from "nbook/plugins/canon/web/components/entry-page/ComponentChecklist.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ComponentChecklist>(() => props.input, ["present", "submit"]);
</script>

<template>
    <div class="w-full max-w-[28rem] p-4">
        <ComponentChecklist data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
