<script setup lang="ts">
import {Button, IconButton, Input, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {useModelsText} from "../text";

/**
 * 自定义请求头的编辑（docs/specs/models/settings-pages.md 输出 5）：一行一个名称与值。行数组是这里的局部草稿，没填完的行也留着；
 * 名称非空、不重复（不分大小写）且值非空的行才写出，失焦、回车或删行时把合格的行一起交给 `commit`，与当前值相同时不交。
 */
const props = withDefaults(defineProps<{
    /** 已保存的请求头（受控）。 */
    headers: Readonly<Record<string, string>>;
    disabled?: boolean;
    /** 每行下面的淡色提示（例如“中转站、网关常要”）。 */
    hint?: string;
}>(), {disabled: false, hint: ""});

const emit = defineEmits<{
    /** 合格的行合成的请求头；与 `headers` 不同时才发。 */
    (e: "commit", headers: Record<string, string>): void;
}>();

const text = useModelsText();

type Row = {readonly key: number; name: string; value: string; touched: boolean};
let nextKey = 0;
const toRows = (headers: Readonly<Record<string, string>>): Row[] => Object.entries(headers).map(([name, value]) => ({key: (nextKey += 1), name, value, touched: true}));
const rows = ref<Row[]>(toRows(props.headers));

const CREDENTIAL_NAME = /key|token|secret|password|authorization|cookie/iu;

/** 每行的问题：错误不写出；`warning` 只提示。没碰过的空行不报。 */
const problems = computed(() => {
    const seen = new Set<string>();
    return rows.value.map((row) => {
        const name = row.name.trim();
        const blank = name === "" && row.value === "";
        if (blank && !row.touched) return {error: null, warning: null};
        let error: string | null = null;
        if (name === "") error = text("headers.nameEmpty");
        else if (seen.has(name.toLowerCase())) error = text("headers.duplicate");
        else if (row.value === "") error = text("headers.valueEmpty");
        if (name !== "") seen.add(name.toLowerCase());
        const warning = error === null && CREDENTIAL_NAME.test(name) && !row.value.startsWith("env:") ? text("headers.credentialLike") : null;
        return {error, warning};
    });
});

const valid = (): Record<string, string> => Object.fromEntries(rows.value.filter((row, index) => problems.value[index]!.error === null && row.name.trim() !== "").map((row) => [row.name.trim(), row.value]));

const same = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean => {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

function commit(): void {
    for (const row of rows.value) row.touched = true;
    const next = valid();
    if (!same(next, props.headers)) emit("commit", next);
}

function remove(index: number): void {
    rows.value.splice(index, 1);
    commit();
}

function add(): void {
    rows.value.push({key: (nextKey += 1), name: "", value: "", touched: false});
}

// 别处改了（另一个窗口、设置文件）：合格的行换成新值，没填完的行留着。
watch(() => props.headers, (headers) => {
    if (same(headers, valid())) return;
    const pending = rows.value.filter((row, index) => problems.value[index]!.error !== null);
    rows.value = [...toRows(headers), ...pending];
});
</script>

<template>
    <div class="headers-editor">
        <div v-for="(row, index) in rows" :key="row.key" class="headers-editor__row">
            <div class="headers-editor__inputs">
                <Input v-model="row.name" size="sm" placeholder="X-Team" :aria-label="text('headers.nameOf', {index: index + 1})" :disabled="disabled" :invalid="problems[index]!.error !== null && row.name.trim() === ''" @focusout="commit" @keydown.enter="commit" />
                <Input v-model="row.value" size="sm" :placeholder="text('headers.value')" :aria-label="text('headers.valueOf', {index: index + 1})" :disabled="disabled" @focusout="commit" @keydown.enter="commit" />
                <Tooltip :text="text('headers.remove', {index: index + 1})">
                    <IconButton size="xs" icon-class="i-lucide-x" :aria-label="text('headers.remove', {index: index + 1})" :disabled="disabled" @click="remove(index)" />
                </Tooltip>
            </div>
            <p v-if="problems[index]!.error !== null" class="headers-editor__problem headers-editor__problem--error" data-headers-problem>{{ problems[index]!.error }}</p>
            <p v-else-if="problems[index]!.warning !== null" class="headers-editor__problem" data-headers-warning>{{ problems[index]!.warning }}</p>
        </div>
        <div class="headers-editor__foot">
            <Button size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="disabled" @click="add">{{ text("headers.add") }}</Button>
            <span v-if="hint !== ''" class="headers-editor__hint">{{ hint }}</span>
        </div>
    </div>
</template>

<style scoped>
.headers-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.headers-editor__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.headers-editor__inputs {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto;
    align-items: center;
    gap: var(--space-2);
}

.headers-editor__problem {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--status-warning);
}

.headers-editor__problem--error {
    color: var(--status-danger);
}

.headers-editor__foot {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.headers-editor__hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
}
</style>
