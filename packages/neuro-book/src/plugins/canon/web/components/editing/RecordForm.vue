<script setup lang="ts">
/**
 * 记一笔（docs/specs/canon/author-ui.md 输出 17）：面板流水上面的输入。精确档填变化量与一句发生了什么，语义档只填一句。受控：
 * 填的内容、原因与保存中由宿主给；不可用时写原因（选着最初时“先选一章”、算着计划时“先不算计划”、世界写不了）。
 */
import {computed} from "vue";

import {Button, Input} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    /** 语义档：只填一句。 */
    semantic?: boolean;
    delta: string;
    text: string;
    /** 不可用的原因；可用时为空。 */
    blockedReason?: string;
    /** 上一次没记进去的原因（`role="alert"`）。 */
    error?: string;
    saving?: boolean;
}>(), {semantic: false, blockedReason: "", error: "", saving: false});

const emit = defineEmits<{
    (event: "update:delta", value: string): void;
    (event: "update:text", value: string): void;
    (event: "submit"): void;
}>();

const t = useCanonText();
const deltaValid = computed(() => props.semantic || (props.delta.trim() !== "" && Number.isFinite(Number(props.delta.trim().replace(/,/gu, "")))));
const canSubmit = computed(() => props.blockedReason === "" && !props.saving && props.text.trim() !== "" && deltaValid.value);
</script>

<template>
    <form class="mb-3 text-[length:var(--text-sm)]" :aria-label="t('record.heading')" data-record-form @submit.prevent="canSubmit && emit('submit')">
        <div class="flex flex-wrap items-center gap-2">
            <Input class="min-w-0 flex-1 basis-48" size="sm" :aria-label="t('record.text')" :placeholder="t('record.textPlaceholder')" :disabled="props.blockedReason !== ''" :model-value="props.text" @update:model-value="(value: string) => emit('update:text', value)" />
            <Input v-if="!props.semantic" class="w-32" size="sm" inputmode="decimal" :aria-label="t('record.delta')" :placeholder="t('record.deltaPlaceholder')" :disabled="props.blockedReason !== ''" :model-value="props.delta" @update:model-value="(value: string) => emit('update:delta', value)" />
            <Button size="sm" variant="secondary" type="submit" :disabled="!canSubmit">{{ t("record.submit") }}</Button>
        </div>
        <p v-if="props.blockedReason !== ''" class="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ props.blockedReason }}</p>
        <p v-if="props.error !== ''" role="alert" class="mt-1 text-[var(--status-danger)]">{{ props.error }}</p>
    </form>
</template>
