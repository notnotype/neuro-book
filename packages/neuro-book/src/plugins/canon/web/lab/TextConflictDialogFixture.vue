<script setup lang="ts">
/**
 * 主文字冲突对话框的夹具：注入 canon 的翻译端口；开关是场景的双向绑定；`choose` 记成事件并写回这一场景自己的选择（受控）。
 */
import {computed, shallowRef, watch} from "vue";

import TextConflictDialog from "nbook/plugins/canon/web/components/text/TextConflictDialog.vue";
import type {ConflictChoice, ConflictItem} from "nbook/plugins/canon/web/components/text/text-conflict-dialog";

import {type LabFixtureProps, useLabEventSink, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof TextConflictDialog>(() => props.input, ["confirm"]);
const record = useLabEventSink();

const chosen = shallowRef<Readonly<Record<string, ConflictChoice>>>({});
watch(() => props.scene, () => {
    chosen.value = {};
});
const items = computed((): ConflictItem[] => (subject.bindings.value.items ?? []).map((item) => ({...item, choice: chosen.value[item.id] ?? item.choice})));
const choose = (id: string, choice: ConflictChoice): void => {
    chosen.value = {...chosen.value, [id]: choice};
    record("choose", `${id}:${choice}`);
};
</script>

<template>
    <TextConflictDialog data-lab-subject v-bind="subject.bindings.value" :items="items" @choose="choose" />
</template>
