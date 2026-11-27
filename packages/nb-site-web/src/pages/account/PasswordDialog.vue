<script setup lang="ts">
/**
 * 设置或修改密码的对话框（t10 计划 3.12；`site.accounts` 输出 9）。有密码的账号要填当前密码；没有密码的账号直接设，不出现那一格。
 * 失败写在对话框页脚的状态行（`Dialog` 的 `status`）：当前密码不对（`invalid_credentials`）标那一格，`validation_failed` 按
 * `fields` 标，`rate_limited` 倒数完之前不能再提交（页脚只写一句不带秒数的话：那是 polite 的 live region，带秒数就每秒播报一遍）。
 * 成功后关掉，交给“登录与安全”一节写结果、重取设备列表（别的会话已被结束）。
 *
 * 有没有当前密码那一格、标题写“设置”还是“修改”，取打开那一刻的 `hasPassword`：设好之后一节马上把账号换成“有密码”，
 * 这时对话框还在淡出，跟着换的话关到一半变成“修改密码”、多出一格（B4 审查第 10 条）。
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
/** 打开那一刻的 `hasPassword`。 */
const hasPassword = shallowRef(props.hasPassword);

const newPasswordFits = computed(() => {
    const length = codePointLength(newPassword.value);
    return length >= PASSWORD.minLength && length <= PASSWORD.maxLength;
});

const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<PasswordField>(form, clock, {
    rules: {newPassword: () => (newPasswordFits.value ? undefined : siteRef("account.rules.newPassword"))},
});
const {statusSteady, fieldError} = feedback;

const canSubmit = computed(() => (!hasPassword.value || currentPassword.value !== "") && newPasswordFits.value && !submitting.value && !feedback.waiting.value);

// 每次打开都从空白开始：上一次填过的密码不留在页面里。
watch(
    () => props.open,
    (open) => {
        if (!open) return;
        hasPassword.value = props.hasPassword;
        currentPassword.value = "";
        newPassword.value = "";
        feedback.reset();
    },
);

function showFailure(failure: Failure): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    switch (failure.code) {
        case "invalid_credentials":
            void feedback.mark(["currentPassword"]);
            return;
        case "validation_failed": {
            const fields: readonly PasswordField[] = hasPassword.value ? ["currentPassword", "newPassword"] : ["newPassword"];
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
    const body: ChangePasswordRequest = hasPassword.value ? {currentPassword: currentPassword.value, newPassword: newPassword.value} : {newPassword: newPassword.value};
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
        :title="t(hasPassword ? 'account.security.changePassword' : 'account.security.setPassword')"
        :status="statusSteady"
        :busy="submitting"
        initial-focus="input"
        data-site-account-password-dialog
        @update:open="emit('update:open', $event)"
    >
        <form id="account-password-form" ref="form" class="site-form" novalidate @submit.prevent="submit" @input="feedback.onEdited" @focusout="feedback.onLeave">
            <Field v-if="hasPassword" :label="t('account.security.currentPassword')" :error="fieldError('currentPassword')">
                <Input v-model="currentPassword" name="currentPassword" type="password" autocomplete="current-password" :maxlength="PASSWORD.maxLength" />
            </Field>
            <Field :label="t('account.security.newPassword')" :error="fieldError('newPassword')">
                <Input v-model="newPassword" name="newPassword" type="password" autocomplete="new-password" />
            </Field>
        </form>
        <template #footer="{cancel}">
            <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("account.cancel") }}</Button>
            <Button variant="primary" type="submit" form="account-password-form" :disabled="!canSubmit" :loading="submitting">{{ t("account.save") }}</Button>
        </template>
    </Dialog>
</template>
