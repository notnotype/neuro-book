<script setup lang="ts">
/**
 * 强行解除独占写入的二次确认（同名 .md；docs/specs/canon/author-ui.md 输出 23）。受控：结果回来之前宿主让 `saving` 为真，
 * 对话框不关、按钮不可用，失败的原因写在对话框里。
 */
import {Button, Dialog} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    open: boolean;
    holder: string;
    saving?: boolean;
    error?: string;
}>(), {saving: false, error: ""});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "confirm"): void;
    (event: "closed"): void;
}>();

const text = useCanonText();
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="text('pending.breakExclusive.title', {holder: props.holder})"
        :busy="props.saving"
        :close-on-request="!props.saving"
        @update:open="(value: boolean) => emit('update:open', value)"
        @closed="emit('closed')"
    >
        <div class="flex flex-col gap-2 text-[length:var(--text-sm)]" data-break-exclusive-dialog>
            <p class="text-[var(--text-secondary)]">{{ text("pending.breakExclusive.body") }}</p>
            <p v-if="props.error !== ''" role="alert" class="text-[var(--status-danger)]">{{ props.error }}</p>
        </div>
        <template #footer="{cancel}">
            <Button variant="ghost" :disabled="props.saving" @click="cancel()">{{ text("pending.breakExclusive.cancel") }}</Button>
            <Button variant="primary" :disabled="props.saving" @click="emit('confirm')">{{ text("pending.breakExclusive.confirm") }}</Button>
        </template>
    </Dialog>
</template>
