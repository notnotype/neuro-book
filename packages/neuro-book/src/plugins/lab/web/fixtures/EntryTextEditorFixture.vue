<script setup lang="ts">
/**
 * 整篇编辑的夹具：注入 canon 的翻译端口；各动作记成事件，`update` 与 `insert` 另把文字写回这一场景自己的副本（受控组件要有人
 * 回写才看得到打的字）。输入框用组件自带的退路（普通文本框）：Lab 里没有编辑器区，代码输入框另有自己的场景。
 */
import {computed, shallowRef, watch} from "vue";

import EntryTextEditor from "nbook/plugins/canon/web/components/EntryTextEditor.vue";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof EntryTextEditor>(() => props.input, ["blur", "submit", "discard", "cancel", "take-over", "adopt", "retry"]);
const record = useLabEventSink();

const typed = shallowRef<string | null>(null);
watch(() => props.scene, () => {
    typed.value = null;
});
const text = computed(() => typed.value ?? subject.bindings.value.text ?? "");
/** 场景的输入是可以序列化的那几项：输入框组件（`input`）不在里面，用组件自带的退路。 */
const bindings = computed(() => {
    const {input: _input, ...rest} = subject.bindings.value;
    return rest;
});
const update = (value: string): void => {
    typed.value = value;
    record("update", value.length);
};
const insert = (snippet: string, offset: number | null): void => {
    const at = offset ?? text.value.length;
    typed.value = `${text.value.slice(0, at)}${snippet}${text.value.slice(at)}`;
    record("insert", snippet);
};
</script>

<template>
    <EntryTextEditor data-lab-subject class="w-full" v-bind="bindings" :text="text" @update="update" @insert="insert" />
</template>
