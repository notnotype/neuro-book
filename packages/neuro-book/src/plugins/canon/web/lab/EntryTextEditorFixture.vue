<script setup lang="ts">
/**
 * 整篇编辑的夹具：注入 canon 的翻译端口；各动作记成事件，`update` 另把文字写回这一场景自己的副本（受控组件要有人回写才
 * 看得到打的字；“插入”也是经它交出来的）。源文字的输入框用组件自带的退路（普通文本框）：Lab 里没有编辑器区，代码输入框另有自己的场景。
 *
 * 富文本要的东西（字段、值表、找条目、基线）场景输入里放不下（函数与 Set 不能 JSON 往返），夹具当宿主给：小块的值在产品里由
 * 世界服务按整篇算，这里源文照条目文法读，每个活的标签给一项写死的假值，打字后马上换上。场景写 `sourceOnly: true` 时不给（只有源文字）。
 */
import {computed, shallowRef, watch} from "vue";

import EntryTextEditor from "nbook/plugins/canon/web/components/text/EntryTextEditor.vue";
import type {EntryFind} from "nbook/plugins/canon/web/components/entries/entry-picker";
import type {EntryTextValue} from "nbook/plugins/canon/web/components/text/entry-text";
import type {RichContext} from "nbook/plugins/canon/web/components/text/entry-text-editor";
import {baselineOf} from "nbook/plugins/canon/web/entry-check";
import type {EntryField} from "nbook/plugins/canon/web/entry-chip";
import {parseEntryText} from "@notnotype/nb-canon/grammar";

import {type LabFixtureProps, useLabEventSink, useLabSubject} from "nbook/plugins/lab/web/scene-kit";

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
/** 场景的输入是可以序列化的那几项：输入框组件（`input`）不在里面，用组件自带的退路；`sourceOnly` 是夹具自己的开关。 */
const bindings = computed(() => {
    const {input: _input, sourceOnly: _sourceOnly, ...rest} = subject.bindings.value as typeof subject.bindings.value & {sourceOnly?: boolean};
    return rest;
});
const sourceOnly = computed(() => (subject.bindings.value as {sourceOnly?: boolean}).sourceOnly === true);
const update = (value: string): void => {
    typed.value = value;
    record("update", value.length);
};

/** 每个活的标签按条目文法给一项假的值（取值看字段表，没有的写 12,345；条件取第一支；引用叫“星瑾”）。 */
const FIELDS: EntryField[] = [
    {path: "panel.存款", label: "存款", group: "面板", display: "12,345"},
    {path: "panel.魔力", label: "魔力", group: "面板", display: "1,200"},
    {path: "character.外观", label: "外观", group: "人物", display: "银白色长发"},
];
const sample = (source: string): EntryTextValue[] => parseEntryText(source).tags.filter((tag) => tag.place === "live" && tag.kind !== "close" && tag.kind !== "malformed" && tag.name !== "Else").map((tag): EntryTextValue => {
    const attribute = (name: string) => tag.attributes.find((candidate) => candidate.name === name)?.value;
    switch (tag.name) {
        case "V": {
            const of = attribute("of") ?? "";
            const field = FIELDS.find((item) => item.path === of);
            return {tag: "V", start: tag.start, path: of, entry: null, label: field?.label ?? of, raw: 0, display: field?.display ?? "12,345"};
        }
        case "If": return {tag: "If", start: tag.start, result: true, taken: 0};
        case "ElseIf": return {tag: "ElseIf", start: tag.start, result: false};
        case "Ref": return {tag: "Ref", start: tag.start, id: attribute("id") ?? "", name: "星瑾", deleted: false};
        case "Image": return {tag: "Image", start: tag.start, path: null, caption: attribute("alt") ?? ""};
        default: return {tag: tag.name, start: tag.start, needsPlugin: true};
    }
});
const ENTRIES = [{id: "e2", name: "星瑾", kind: "人物"}, {id: "e3", name: "星辰议会", kind: "组织"}];
const find: EntryFind = async (query) => ({ok: true, items: ENTRIES.filter((entry) => entry.name.includes(query))});
const marks = {"panel.存款": "第 3 章改过"};
const baseline = computed(() => baselineOf(subject.bindings.value.text ?? ""));
const rich = computed((): RichContext | null => {
    if (sourceOnly.value) return null;
    return {self: "xingxia", fields: FIELDS, marks, values: {source: text.value, values: sample(text.value)}, computing: true, find, baseline: baseline.value};
});
</script>

<template>
    <EntryTextEditor
        data-lab-subject
        class="w-full"
        v-bind="bindings"
        :text="text"
        :rich="rich"
        @update="update"
    />
</template>
