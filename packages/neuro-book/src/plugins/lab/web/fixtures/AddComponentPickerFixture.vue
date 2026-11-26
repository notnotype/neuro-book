<script setup lang="ts">
/**
 * “添加一组设定”浮层的夹具：注入 canon 的翻译端口（`canon-text.ts`）。锚不是可序列化的场景输入，这里放一个“＋”扮演条目页的按钮：
 * 打开场景时浮层就开着；关上以后点“＋”再开。各项与种类来自场景，选了什么、关上记成事件。
 */
import {onMounted, shallowRef, useTemplateRef} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import AddComponentPicker from "nbook/plugins/canon/web/components/AddComponentPicker.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof AddComponentPicker>(() => props.input, ["add", "show", "close"]);
const holder = useTemplateRef<HTMLElement>("holder");
const anchor = shallowRef<HTMLElement | null>(null);
onMounted(() => {
    anchor.value = holder.value?.querySelector("button") ?? null;
});
const toggle = (event: MouseEvent): void => {
    anchor.value = anchor.value === null ? (event.currentTarget as HTMLElement) : null;
};
const close = (refocus: boolean): void => {
    const button = anchor.value;
    anchor.value = null;
    if (refocus) button?.focus();
};
</script>

<template>
    <div ref="holder" class="flex h-full w-full justify-end p-4">
        <IconButton size="sm" icon-class="i-lucide-plus" aria-label="添加一组设定" aria-haspopup="listbox" :aria-expanded="anchor !== null" @click="toggle" />
        <AddComponentPicker data-lab-subject v-bind="subject.bindings.value" :anchor="anchor" @close="close" />
    </div>
</template>
