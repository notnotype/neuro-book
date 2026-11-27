<script setup lang="ts">
/**
 * 变更详情页骨架的夹具：注入 canon 的翻译端口（`canon-text.ts`）；点了什么都记成事件。场景 id 带 `-editing` 的在 `bar` 插槽里放
 * 一条确认条，看它与页面放在一起的样子。
 */
import {computed} from "vue";

import ChangePage from "nbook/plugins/canon/web/components/revisions/ChangePage.vue";
import ConfirmBar from "nbook/plugins/canon/web/components/editing/ConfirmBar.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ChangePage>(() => props.input, ["open-entry", "open-chapter", "edit", "activate", "activation-save", "activation-cancel", "retry"]);
const editing = computed(() => props.scene.includes("-editing"));
</script>

<template>
    <ChangePage data-lab-subject class="w-full" v-bind="subject.bindings.value">
        <template #bar>
            <ConfirmBar v-if="editing" label="星瑕的存款" kind="number" value="-2000" :intents="['creative']" intent="creative" :preview="{route: '会写回这条情节', impact: ['星瑕的存款：2,400 → 700', '少了 1 条待处理']}" />
        </template>
    </ChangePage>
</template>
