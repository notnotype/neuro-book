<script setup lang="ts">
import {Button, Select} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, watch} from "vue";
import {statusLabel} from "../host/format.js";

/**
 * Work 页与 Task 页的状态切换：平时只是一个“改状态”按钮（状态本身由标题旁的徽标显示，页面上只显示一处，t15 阶段 4 第 2 批）；
 * 点了才出下拉，选了不立即写，先在原地确认一次（“把 t09 改成完成”），确认后发 `confirm`，由页面发请求。
 * 不能切换时（来自分支、主工作区不能写）只显示原因。
 */
const props = defineProps<{
    /** 现在的状态取值；没有字段或不合规时为 null。 */
    status: string | null;
    /** 可选的取值（Work：active、done、shelved；Task 另有 planned）。 */
    options: readonly string[];
    /** 确认句里的主语，例如 t09 或 w00022。 */
    subject: string;
    disabledReason: string | null;
    pending: boolean;
    slow: boolean;
}>();
const emit = defineEmits<{confirm: [status: string]}>();

const choice = ref<string | null>(null);
/** 点了“改状态”：出下拉。状态变了（改成功、推送来了新状态）就收起。 */
const editing = ref(false);
const root = ref<HTMLElement | null>(null);
const selectBox = ref<HTMLElement | null>(null);
/**
 * 换形态时焦点所在的按钮会被 v-if 换掉、掉到 body：打开时把焦点给下拉；收起时焦点原本在这块里，就放回“改状态”按钮。
 */
function startEdit(): void {
    editing.value = true;
    void nextTick(() => selectBox.value?.querySelector<HTMLElement>("button, [role='combobox'], select, input")?.focus());
}
/**
 * 按“确认”之后按钮进入 loading、被禁用，焦点会先掉到 body；所以记下“是在这里确认的”，写完收起时照样把焦点放回“改状态”。
 * 写失败（状态没变、还开着下拉）时把焦点还给下拉。
 */
let confirmedHere = false;
function confirm(value: string): void {
    confirmedHere = true;
    emit("confirm", value);
}
watch(() => props.pending, (now, was) => {
    if (!was || now || !editing.value) return;
    confirmedHere = false;
    if (document.activeElement === document.body) void nextTick(() => selectBox.value?.querySelector<HTMLElement>("button, [role='combobox'], select, input")?.focus());
});
function collapse(): void {
    const hadFocus = confirmedHere || root.value?.contains(document.activeElement) === true;
    confirmedHere = false;
    choice.value = null;
    editing.value = false;
    if (hadFocus) void nextTick(() => root.value?.querySelector<HTMLElement>("[data-status-toggle]")?.focus());
}
watch(() => props.status, collapse);
const cancel = collapse;
const selectOptions = computed(() => props.options.map((value) => ({value, label: statusLabel(value)})));
</script>

<template>
    <div ref="root" class="flex flex-wrap items-center gap-2 nbdev-small">
        <template v-if="disabledReason">
            <span class="nbdev-empty">{{ disabledReason }}</span>
        </template>
        <Button v-else-if="!editing" data-status-toggle size="sm" variant="ghost" icon-class="i-lucide-pencil-line" @click="startEdit">改状态</Button>
        <template v-else>
            <div ref="selectBox" class="w-32">
                <Select :model-value="choice ?? status ?? ''" :options="selectOptions" aria-label="改状态" placeholder="未标" size="sm" :disabled="pending" @update:model-value="(value: string) => (choice = value === status ? null : value)" />
            </div>
            <template v-if="choice">
                <span>把 {{ subject }} 改成{{ statusLabel(choice) }}？</span>
                <Button variant="primary" size="sm" :loading="pending" @click="confirm(choice)">确认</Button>
                <span class="nbdev-secondary" v-if="slow">在等别的写入完成…</span>
            </template>
            <Button size="sm" variant="ghost" :disabled="pending" @click="cancel">取消</Button>
        </template>
    </div>
</template>
