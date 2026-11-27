<script setup lang="ts">
/**
 * 管理面板里一次处置的确认（t10 计划 3.13）：说清后果，确认后才调 `run`；失败写在页脚的状态行（`Dialog` 的 `status`），对话框留着。
 * 成功时关掉并发 `done`。用 `Dialog` 而不是 `AlertDialog` 的理由与倒数的读屏写法同用户页的 `users/UserActionDialog.vue`。
 *
 * `not_found`（对象已经不在了）另发 `missing`，列表该重取。
 */

import {Button, Dialog} from "@notnotype/nb-ui/components";
import {shallowRef, watch} from "vue";

import {useSite} from "../../context";
import type {Result} from "../../http/core";
import {useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";

const props = defineProps<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    /** 不能撤回或会让人失去访问的处置：确认按钮用危险色。 */
    danger?: boolean;
    run: () => Promise<Result<unknown>>;
}>();
const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "done"): void;
    (event: "missing"): void;
}>();

const {clock} = useSite();
const t = useSiteText();

const submitting = shallowRef(false);
const feedback = useFormFeedback<never>(shallowRef(null), clock);
const {statusSteady} = feedback;

watch(
    () => props.open,
    (open) => {
        if (open) feedback.reset();
    },
);

async function confirm(): Promise<void> {
    if (submitting.value || feedback.waiting.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        const result = await props.run();
        if (result.ok) {
            emit("done");
            emit("update:open", false);
            return;
        }
        if (feedback.showFailure(result.failure) && result.failure.kind === "code" && result.failure.code === "not_found") emit("missing");
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <Dialog :open="props.open" size="md" :title="props.title" :status="statusSteady" :busy="submitting" data-site-admin-confirm @update:open="emit('update:open', $event)">
        <p class="admin-confirm__text">{{ props.description }}</p>
        <template #footer="{cancel}">
            <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("admin.list.cancel") }}</Button>
            <Button :variant="props.danger ? 'danger' : 'primary'" :disabled="feedback.waiting.value" :loading="submitting" data-site-admin-confirm-button @click="confirm">{{ props.confirmLabel }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.admin-confirm__text {
    margin: 0;
    color: var(--text-secondary);
}
</style>
