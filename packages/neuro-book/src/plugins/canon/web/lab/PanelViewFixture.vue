<script setup lang="ts">
/**
 * 面板的夹具：注入 canon 的翻译端口（`canon-text.ts`），`select`、`more`、`retry`、`change` 记成事件。
 */
import PanelView from "nbook/plugins/canon/web/components/groups/PanelView.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof PanelView>(() => props.input, ["select", "more", "retry", "change"]);
</script>

<template>
    <PanelView data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
