<script setup lang="ts">
/**
 * 设置或修改密码的对话框（t10 计划 3.12；`site.accounts` 输出 9）。有密码的账号要填当前密码；没有密码的账号直接设，不出现那一格。
 * 失败写在对话框页脚的状态行（`Dialog` 的 `status`）：当前密码不对（`invalid_credentials`）标那一格，`validation_failed` 按
 * `fields` 标，`rate_limited` 倒数完之前不能再提交。成功后关掉，交给“登录与安全”一节写结果、重取设备列表（别的会话已被结束）。
 */

import {PASSWORD, codePointLength} from "@notnotype/nb-site-identity-contract/constants";
import type {ChangePasswordRequest} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Dialog, Field, Input} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef, watch} from "vue";

import type {Failure} from "../../http/core";
import {useSite} from "../../context";
import {siteRef, useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";

type PasswordField = "currentPassword" | "newPassword";

const props = defineProps<{open: boolean; hasPassword: boolean}>();
const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    /** 改好了（或设好了）。 */
    (event: "done"): void;
}>();

const {identity, clock} = useSite();
const t = useSiteText();

const currentPassword = shallowRef("");
const newPassword = shallowRef("");
const submitting = shallowRef(false);
const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<PasswordField>(form, clock);
const {statusText, fieldError} = feedback;

const newPasswordFits = computed(() => {
    const length = codePointLength(newPassword.value);
    return length >= PASSWORD.minLength && length <= PASSWORD.maxLength;
});
const canSubmit = computed(() => (!props.hasPassword || currentPassword.value !== "") && newPasswordFits.value && !submitting.value && !feedback.waiting.value);

// 每次打开都从空白开始：上一次填过的密码不留在页面里。
watch(
    () => props.open,
    (open) => {
        if (!open) return;
        currentPassword.value = "";
        newPassword.value = "";
        feedback.reset();
    },
);

function onFocusOut(event: FocusEvent): void {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "newPassword" || newPassword.value === "" || newPasswordFits.value) return;
    feedback.status.value = {reason: "rule:newPassword", text: siteRef("account.rules.newPassword")};
    void feedback.mark(["newPassword"], {focus: false});
}

function onEdited(): void {
    feedback.unmark();
    if (feedback.status.value?.reason.startsWith("rule:") === true) feedback.status.value = undefined;
}

function showFailure(failure: Failure): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    switch (failure.code) {
        case "invalid_credentials":
            void feedback.mark(["currentPassword"]);
            return;
        case "validation_failed": {
            const fields: readonly PasswordField[] = props.hasPassword ? ["currentPassword", "newPassword"] : ["newPassword"];
            void feedback.mark(fields.filter((field) => failure.fields?.includes(field) === true));
            return;
        }
    }
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    feedback.reset();
    // 没有密码的账号不带当前密码（`site.accounts` 输出 9）。
    const body: ChangePasswordRequest = props.hasPassword ? {currentPassword: currentPassword.value, newPassword: newPassword.value} : {newPassword: newPassword.value};
    try {
        const result = await identity.changePassword(body);
        if (!result.ok) {
            showFailure(result.failure);
            return;
        }
        emit("done");
        emit("update:open", false);
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="t(props.hasPassword ? 'account.security.changePassword' : 'account.security.setPassword')"
        :status="statusText"
        :busy="submitting"
        initial-focus="input"
        data-site-account-password-dialog
        @update:open="emit('update:open', $event)"
    >
        <form id="account-password-form" ref="form" class="site-form" novalidate @submit.prevent="submit" @input="onEdited" @focusout="onFocusOut">
            <Field v-if="props.hasPassword" :label="t('account.security.currentPassword')" :error="fieldError('currentPassword')">
                <Input v-model="currentPassword" name="currentPassword" type="password" autocomplete="current-password" :maxlength="PASSWORD.maxLength" />
            </Field>
            <Field :label="t('account.security.newPassword')" :error="fieldError('newPassword')">
                <Input v-model="newPassword" name="newPassword" type="password" autocomplete="new-password" />
            </Field>
        </form>
        <template #footer="{cancel}">
            <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("account.cancel") }}</Button>
            <Button type="submit" form="account-password-form" :disabled="!canSubmit" :loading="submitting">{{ t("account.save") }}</Button>
        </template>
    </Dialog>
</template>
