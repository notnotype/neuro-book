<script setup lang="ts">
/**
 * 整篇编辑的夹具：注入 canon 的翻译端口；各动作记成事件，`update` 另把文字写回这一场景自己的副本（受控组件要有人回写才
 * 看得到打的字；“插入”也是经它交出来的）。输入框用组件自带的退路（普通文本框）：Lab 里没有编辑器区，代码输入框另有自己的场景。
 *
 * 预览栏里的内容在产品里由世界服务渲染；这里没有世界服务，照最简单的规则画个样子：空行分段、`#` 开头是标题、花括号是一个
 * 写死的值。场景给了 `previewNote`（写得不对）时停在场景开始时的那一份，像产品里留着上一次读得出来的样子。
 */
import {computed, shallowRef, watch} from "vue";

import EntryText from "nbook/plugins/canon/web/components/EntryText.vue";
import EntryTextEditor from "nbook/plugins/canon/web/components/EntryTextEditor.vue";
import type {EntryTextBlock, EntryTextNode} from "nbook/plugins/canon/web/components/entry-text";

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

/** 一段里的字：花括号换成一个值，没配平的花括号（写得不对的那一段）不画。 */
const inline = (source: string): EntryTextNode[] => source.split(/(\{[^{}]*\})/u).filter((part) => part !== "").map((part): EntryTextNode => (part.startsWith("{") ? {type: "canonValue", path: part.slice(1, -1), entry: null, label: part.slice(1, -1).split(".").at(-1) ?? "", display: "12,345"} : {type: "text", value: part}));
const sample = (source: string): EntryTextBlock[] => {
    const children: EntryTextNode[] = [];
    let line = 1;
    for (const part of source.split("\n\n")) {
        const heading = /^(#{1,6})\s+(.*)$/u.exec(part);
        if (heading !== null) children.push({type: "heading", depth: heading[1]!.length, position: {start: {line}}, children: inline(heading[2]!)});
        else if (part.trim() !== "" && !/\{[^}]*$/u.test(part)) children.push({type: "paragraph", position: {start: {line}}, children: inline(part)});
        line += part.split("\n").length + 1;
    }
    return children.length === 0 ? [] : [{id: "source", tree: {type: "root", children}}];
};
const previewBlocks = computed(() => sample(bindings.value.previewNote === undefined || bindings.value.previewNote === "" ? text.value : subject.bindings.value.text ?? ""));
</script>

<template>
    <EntryTextEditor data-lab-subject class="w-full" v-bind="bindings" :text="text" @update="update">
        <template #preview>
            <EntryText :blocks="previewBlocks" self="xingxia" :interactive="false" />
        </template>
    </EntryTextEditor>
</template>
