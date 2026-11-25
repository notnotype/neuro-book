<script setup lang="ts">
/**
 * 就地改的确认条（docs/specs/canon/author-ui.md 输出 16、29、30）：在改哪个字段、按字段的声明给的输入控件、意图、预览（写回
 * 哪里与带来的变化）、原因、保存与取消。受控：填的值、意图、预览与原因都由宿主给，交互时发出新值。挂上时焦点进输入控件；
 * Escape 等同取消（输入法组字里的不算）。`inline` 时是专门界面里就地改的内容（输出 51）：没有标题与吸顶的外框，外框由宿主给。
 */
import {computed, nextTick, onMounted, ref} from "vue";

import {Button, SegmentedControl} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {ConfirmBarKind, EditIntent} from "./confirm-bar";
import type {EntryResults} from "./entry-picker";
import FieldInput from "./FieldInput.vue";

const props = withDefaults(defineProps<{
    label: string;
    kind: ConfirmBarKind;
    /** 选项字段的选项。 */
    options?: readonly string[];
    unit?: string;
    /** 填的值：数、文字、选项是字符串，是否是布尔，引用是条目 id 或 null，图片是 `{图片, 说明}` 或 null。 */
    value: unknown;
    /** 引用：条目选择器这一次的查找结果（宿主用 `useEntryFind`）与当前值的名字。 */
    refResults?: EntryResults;
    refName?: string;
    /** 可选的意图；只有一项时不显示选择。 */
    intents: readonly EditIntent[];
    intent: EditIntent;
    /** 预览：写回哪里与带来的变化；没有预览（还没填、正在预览、预览失败）时为 null。 */
    preview?: {readonly route: string; readonly impact: readonly string[]} | null;
    previewing?: boolean;
    /** 失败或说明（`role="alert"`）；没有时为空。 */
    error?: string;
    /** 结局不明：给“再查一次”。 */
    recheck?: boolean;
    /** 保存中：保存不可用。 */
    saving?: boolean;
    /** 保存不可用（例如累出来的数，输出 16）。“这个值刚刚变了”这类原因不锁：作者再点一次保存就行（输出 29）。 */
    locked?: boolean;
    /** `bar`：页面顶上的确认条（缺省）；`inline`：放进就地改的浮层或编辑层。 */
    variant?: "bar" | "inline";
    /** 文字输入的行数（成段的文字从原文的行数起步）；缺省 2。 */
    rows?: number;
}>(), {options: () => [], unit: "", refResults: () => ({kind: "idle"}), refName: undefined, preview: null, previewing: false, error: "", recheck: false, saving: false, locked: false, variant: "bar", rows: 2});

const emit = defineEmits<{
    (event: "update:value", value: unknown): void;
    /** 引用的条目选择器打开或打字：宿主按字段的 `targets` 查。 */
    (event: "search-ref", query: string): void;
    (event: "update:intent", value: EditIntent): void;
    (event: "save"): void;
    (event: "cancel"): void;
    (event: "recheck"): void;
}>();

const text = useCanonText();
const root = ref<HTMLElement | null>(null);
const canSave = computed(() => props.preview !== null && !props.previewing && !props.saving && !props.locked);

/**
 * `inline` 时预览与原因共用一块固定两行高的位置（输出 51）：预览回来、原因出现时保存与取消不移动，浮层不变高。先原因、再写回
 * 哪里、再第一条变化，放不下的变化收进“还有 N 项”（整句在悬停提示里）；只有一行时它可以折成两行。
 */
const inlineLines = computed(() => {
    const lines: {key: string; text: string; tone: "danger" | "main" | "secondary"; title: string}[] = [];
    if (props.error !== "") lines.push({key: "error", text: props.error, tone: "danger", title: props.error});
    if (props.previewing) lines.push({key: "previewing", text: text("edit.previewing"), tone: "secondary", title: ""});
    else if (props.preview !== null) {
        const {route, impact} = props.preview;
        lines.push({key: "route", text: route, tone: "main", title: route});
        if (impact.length > 0) lines.push({key: "impact", text: impact.length === 1 ? impact[0]! : text("edit.moreImpact", {first: impact[0]!, count: impact.length - 1}), tone: "secondary", title: impact.join("\n")});
    }
    return lines.slice(0, 2);
});
const TONE = {danger: "text-[var(--status-danger)]", main: "text-[var(--text-main)]", secondary: "text-[var(--text-secondary)]"} as const;

onMounted(() => {
    void nextTick(() => root.value?.querySelector<HTMLElement>("input, textarea, [role='combobox'], [role='switch']")?.focus());
});

const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    emit("cancel");
};
</script>

<template>
    <section
        ref="root"
        class="text-[length:var(--text-sm)]"
        :class="props.variant === 'bar' ? 'sticky top-0 z-[1] mb-3 rounded-[var(--radius-panel)] border border-[var(--accent-main)] bg-[var(--panel-surface)] p-3' : ''"
        :aria-label="text('edit.heading', {label: props.label})"
        :data-confirm-bar="props.variant === 'bar' ? '' : undefined"
        :data-inline-editor="props.variant === 'inline' ? '' : undefined"
        @keydown="onKeydown"
    >
        <h3 v-if="props.variant === 'bar'" class="mb-2 font-semibold text-[var(--text-main)]">{{ text("edit.heading", {label: props.label}) }}</h3>
        <FieldInput :kind="props.kind" :value="props.value" :label="props.label" :options="props.options" :unit="props.unit" :ref-results="props.refResults" :ref-name="props.refName" :rows="props.rows" @update:value="(value: unknown) => emit('update:value', value)" @search-ref="(query: string) => emit('search-ref', query)" />
        <div v-if="props.intents.length > 1" class="mt-2 flex items-center gap-2">
            <span class="text-[var(--text-secondary)]">{{ text("edit.intent") }}</span>
            <SegmentedControl size="sm" :aria-label="text('edit.intent')" :model-value="props.intent" :options="props.intents.map((intent) => ({value: intent, label: text(intent === 'creative' ? 'edit.creative' : 'edit.story')}))" @update:model-value="(value) => emit('update:intent', value as EditIntent)" />
        </div>
        <div v-if="props.variant === 'inline'" class="mt-2 h-10 overflow-hidden text-[length:var(--text-xs)] leading-5" data-confirm-preview>
            <Transition name="nb-ui-switch" mode="out-in">
                <div :key="inlineLines.map((line) => line.key).join()">
                    <p
                        v-for="line in inlineLines"
                        :key="line.key"
                        class="m-0"
                        :class="[TONE[line.tone], inlineLines.length === 1 ? 'line-clamp-2' : 'truncate']"
                        :role="line.tone === 'danger' ? 'alert' : undefined"
                        :title="line.title || undefined"
                    >{{ line.text }}</p>
                </div>
            </Transition>
        </div>
        <template v-else>
            <div class="mt-2 min-h-[1.5rem] text-[var(--text-secondary)]" data-confirm-preview>
                <p v-if="props.previewing">{{ text("edit.previewing") }}</p>
                <template v-else-if="props.preview !== null">
                    <p class="text-[var(--text-main)]">{{ props.preview.route }}</p>
                    <ul class="m-0 list-none p-0 text-[length:var(--text-xs)]">
                        <li v-for="(line, index) in props.preview.impact" :key="index">{{ line }}</li>
                    </ul>
                </template>
            </div>
            <p v-if="props.error !== ''" role="alert" class="mt-1 flex flex-wrap items-center gap-2 text-[var(--status-danger)]">
                {{ props.error }}
                <Button v-if="props.recheck" size="sm" variant="ghost" @click="emit('recheck')">{{ text("failure.recheck") }}</Button>
            </p>
        </template>
        <div class="mt-3 flex justify-end gap-2">
            <!-- inline 时“再查一次”放在这一行的左边，不占预览那两行。 -->
            <Button v-if="props.variant === 'inline' && props.error !== '' && props.recheck" class="mr-auto" size="sm" variant="ghost" @click="emit('recheck')">{{ text("failure.recheck") }}</Button>
            <Button size="sm" variant="ghost" @click="emit('cancel')">{{ text("edit.cancel") }}</Button>
            <Button size="sm" :disabled="!canSave" @click="emit('save')">{{ text("edit.save") }}</Button>
        </div>
    </section>
</template>
