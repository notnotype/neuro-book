<script setup lang="ts">
/**
 * 关联一个上游之前要当前密码的对话框（t10 计划 3.12；`site.accounts` 输出 15）。只给有密码的账号开：没有密码的账号免，由
 * “登录与安全”一节直接发起。发起成功就带浏览器去上游，离开期间按钮不可用；他在上游页点返回、页面从往返缓存恢复时放开
 * （`SiteContext.leave`）。上游带着 `social_error` 回到 `/account` 时由账号页显示（计划 3.1 的 `social_error` 表）。
 *
 * 密码不对（`invalid_credentials`）、没带（`validation_failed`）标那一格；别的失败（`provider_disabled`、`rate_limited` 等）写在页脚的状态行，
 * 倒数时只写一句不带秒数的话（页脚状态行是 polite 的 live region）。
 */

import {PASSWORD} from "@notnotype/nb-site-identity-contract/constants";
import type {SocialProvider} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Dialog, Field, Input} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef, watch} from "vue";

import {useSite} from "../../context";
import {useSiteText} from "../../text";
import {useFormFeedback} from "../form-feedback";

type LinkField = "currentPassword";

const props = defineProps<{open: boolean; provider: SocialProvider}>();
const emit = defineEmits<{(event: "update:open", value: boolean): void}>();

const {identity, clock, leave} = useSite();
const t = useSiteText();

const currentPassword = shallowRef("");
/** 请求在路上，或已拿到上游地址、页面正在离开。 */
const starting = shallowRef(false);
const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<LinkField>(form, clock);
const {statusSteady, fieldError} = feedback;

const canSubmit = computed(() => currentPassword.value !== "" && !starting.value && !feedback.waiting.value);

watch(
    () => props.open,
    (open) => {
        if (!open) return;
        currentPassword.value = "";
        feedback.reset();
    },
);

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    starting.value = true;
    feedback.reset();
    const result = await identity.socialStart(props.provider, {intent: "link", currentPassword: currentPassword.value});
    if (result.ok) {
        await leave(result.value.url);
        starting.value = false;
        return;
    }
    starting.value = false;
    const failure = result.failure;
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    if (failure.code === "invalid_credentials" || (failure.code === "validation_failed" && failure.fields?.includes("currentPassword") === true)) {
        void feedback.mark(["currentPassword"]);
    }
}
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="t('account.security.linkTitle', {provider: t(`account.security.provider.${props.provider}`)})"
        :status="statusSteady"
        :busy="starting"
        initial-focus="input"
        data-site-account-link-dialog
        @update:open="emit('update:open', $event)"
    >
        <form id="account-link-form" ref="form" class="site-form" novalidate @submit.prevent="submit" @input="feedback.onEdited">
            <Field :label="t('account.security.currentPassword')" :error="fieldError('currentPassword')">
                <Input v-model="currentPassword" name="currentPassword" type="password" autocomplete="current-password" :maxlength="PASSWORD.maxLength" />
            </Field>
        </form>
        <template #footer="{cancel}">
            <Button variant="secondary" :disabled="starting" @click="cancel">{{ t("account.cancel") }}</Button>
            <Button variant="primary" type="submit" form="account-link-form" :disabled="!canSubmit" :loading="starting">{{ t("account.security.linkContinue") }}</Button>
        </template>
    </Dialog>
</template>
