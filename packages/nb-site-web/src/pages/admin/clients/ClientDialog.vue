<script setup lang="ts">
/**
 * 登记与改动 OAuth 客户端的对话框（t10 计划 3.13；`site.oauth-provider` 输出 9、16；字段规则取合同的 `OAUTH_CLIENT_NAME`、
 * `REDIRECT_URI`）。`client` 不给时是登记，给了时是改动那一个（种类登记后不能改，改动时不出现）。
 *
 * - 回调地址写在多行输入框里，一行一个；首尾空白与空行不算。一到五个、每个至多 500 个字符由这里先查（离开时写规则、提交按钮不可用），
 *   按种类的规则（`https`、本机回环等）只有服务端判，不合回 `redirect_uri_invalid`，标红这一项。`validation_failed` 按 `fields` 标红。
 * - 登记成功后同一个对话框换成客户端 id 与密钥（公开客户端只有 id），各带复制，列表由页面重取。密钥只在这一次的回答里（输出 9）：
 *   对话框关掉（淡出结束，`closed`）就丢掉，再打开是空白的表单；显示密钥期间点遮罩、按 Esc 都不关，只有“完成”关，免得没复制就丢了。
 *   表单换到密钥那一步用 nb-ui 的换内容过渡（`nb-ui-switch`），正文与底栏的按钮一起换。
 * - 改动只发改了的几项；一项都没改时“保存”不可用（合同不收空的改动）。成功后关掉，列表由页面重取。`not_found`（客户端已经不在了）
 *   写状态行并发 `missing`。
 */

import {OAUTH_CLIENT_NAME, OAUTH_CLIENT_TYPES, REDIRECT_URI, codePointLength} from "@notnotype/nb-site-identity-contract/constants";
import type {CreateOAuthClientResponse, OAuthClientItem, OAuthClientType, PatchOAuthClientRequest} from "@notnotype/nb-site-identity-contract/constants";
import {Button, Checkbox, CopyButton, Dialog, Field, Input, RadioGroup, Textarea} from "@notnotype/nb-ui/components";
import type {RadioOption} from "@notnotype/nb-ui/components";
import {computed, shallowRef, useTemplateRef, watch} from "vue";

import {useSite} from "../../../context";
import type {AdminApi} from "../../../http/admin";
import type {Failure} from "../../../http/core";
import {adminRef, useAdminText} from "../text";
import {useFormFeedback} from "../../form-feedback";

type ClientField = "name" | "redirectUris" | "type" | "skipConsent";
const FIELDS: readonly ClientField[] = ["name", "redirectUris", "type", "skipConsent"];

const props = defineProps<{open: boolean; api: AdminApi; client?: OAuthClientItem | undefined}>();
const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    /** 登记或改动成功：列表该重取（登记的要丢掉基准）。 */
    (event: "done", kind: "created" | "updated"): void;
    /** 要改的客户端已经不在了：列表该重取。 */
    (event: "missing"): void;
}>();

const {clock} = useSite();
const t = useAdminText();

const name = shallowRef("");
const redirectText = shallowRef("");
const type = shallowRef<OAuthClientType>("confidential");
const skipConsent = shallowRef(false);
const submitting = shallowRef(false);
/** 登记成功的回答；有它时对话框显示客户端 id 与密钥。 */
const created = shallowRef<CreateOAuthClientResponse>();

/** 打开时改的是哪一个：对话框淡出期间 `client` 可能被页面换掉，标题与“改了什么”按打开时的算。 */
const editing = shallowRef<OAuthClientItem>();

const trimmedName = computed(() => name.value.trim());
const redirectUris = computed(() => redirectText.value.split("\n").map((line) => line.trim()).filter((line) => line !== ""));

const nameFits = computed(() => {
    const length = codePointLength(trimmedName.value);
    return length >= OAUTH_CLIENT_NAME.minLength && length <= OAUTH_CLIENT_NAME.maxLength;
});
const urisCountFits = computed(() => redirectUris.value.length >= REDIRECT_URI.minCount && redirectUris.value.length <= REDIRECT_URI.maxCount);
const urisLengthFit = computed(() => redirectUris.value.every((uri) => codePointLength(uri) <= REDIRECT_URI.maxLength));

function redirectRule() {
    if (!urisLengthFit.value) return adminRef("admin.clients.form.rules.redirectUriLength", {max: REDIRECT_URI.maxLength});
    if (redirectUris.value.length > REDIRECT_URI.maxCount) return adminRef("admin.clients.form.rules.redirectUrisCount", {max: REDIRECT_URI.maxCount});
    return undefined;
}

const form = useTemplateRef<HTMLFormElement>("form");
const feedback = useFormFeedback<ClientField>(form, clock, {
    rules: {
        name: () => (nameFits.value ? undefined : adminRef("admin.clients.form.rules.name", {max: OAUTH_CLIENT_NAME.maxLength})),
        redirectUris: redirectRule,
    },
});
const {statusSteady, fieldError} = feedback;

/** 改动时要发的几项：与打开时的那一项比，只放改了的。 */
const changes = computed<PatchOAuthClientRequest>(() => {
    const before = editing.value;
    if (before === undefined) return {};
    const sameUris = before.redirectUris.length === redirectUris.value.length && before.redirectUris.every((uri, index) => uri === redirectUris.value[index]);
    return {
        ...(trimmedName.value === before.name ? {} : {name: trimmedName.value}),
        ...(sameUris ? {} : {redirectUris: redirectUris.value}),
        ...(skipConsent.value === before.skipConsent ? {} : {skipConsent: skipConsent.value}),
    };
});

const canSubmit = computed(() => {
    if (!nameFits.value || !urisCountFits.value || !urisLengthFit.value || submitting.value || feedback.waiting.value) return false;
    return editing.value === undefined || Object.keys(changes.value).length > 0;
});

const typeOptions = computed<RadioOption[]>(() =>
    OAUTH_CLIENT_TYPES.map((value) => ({value, label: t(`admin.clients.form.${value}`), description: t(`admin.clients.form.${value}Description`)})),
);

// 每次打开都从这一次要改的那一项（或空白）开始。
watch(
    () => props.open,
    (open) => {
        if (!open) return;
        const client = props.client;
        editing.value = client;
        name.value = client?.name ?? "";
        redirectText.value = client?.redirectUris.join("\n") ?? "";
        type.value = client?.type ?? "confidential";
        skipConsent.value = client?.skipConsent ?? false;
        feedback.reset();
    },
);

const title = computed(() => {
    if (created.value !== undefined) return t("admin.clients.register.doneTitle");
    const client = editing.value;
    return client === undefined ? t("admin.clients.register.title") : t("admin.clients.edit.title", {name: client.name});
});

function setType(value: string): void {
    const next = OAUTH_CLIENT_TYPES.find((candidate) => candidate === value);
    if (next !== undefined) type.value = next;
}

function showFailure(failure: Failure): void {
    if (!feedback.showFailure(failure) || failure.kind !== "code") return;
    switch (failure.code) {
        case "validation_failed":
            void feedback.mark(FIELDS.filter((field) => failure.fields?.includes(field) === true));
            return;
        case "redirect_uri_invalid":
            // 这个码不带 `fields`（不是 schema 的校验）：说的总是回调地址。
            void feedback.mark(["redirectUris"]);
            return;
        case "not_found":
            emit("missing");
            return;
    }
}

async function submit(): Promise<void> {
    if (!canSubmit.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        const client = editing.value;
        if (client === undefined) {
            const result = await props.api.createOAuthClient({name: trimmedName.value, redirectUris: redirectUris.value, type: type.value, skipConsent: skipConsent.value});
            if (!result.ok) {
                showFailure(result.failure);
                return;
            }
            created.value = result.value;
            emit("done", "created");
            return;
        }
        const result = await props.api.patchOAuthClient(client.clientId, changes.value);
        if (!result.ok) {
            showFailure(result.failure);
            return;
        }
        emit("done", "updated");
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
        :title="title"
        :status="statusSteady"
        :busy="submitting"
        :close-on-overlay="created === undefined"
        :close-on-esc="created === undefined"
        :initial-focus="created === undefined ? 'input' : undefined"
        data-site-admin-client-dialog
        :data-site-admin-client-step="created === undefined ? 'form' : 'created'"
        @update:open="emit('update:open', $event)"
        @closed="created = undefined"
    >
        <Transition name="nb-ui-switch" mode="out-in">
            <form v-if="created === undefined" key="form" id="admin-client-form" ref="form" class="site-form" novalidate @submit.prevent="submit" @input="feedback.onEdited" @change="feedback.onEdited" @focusout="feedback.onLeave">
                <Field :label="t('admin.clients.form.name')" :error="fieldError('name')">
                    <Input v-model="name" name="name" :placeholder="t('admin.clients.form.namePlaceholder')" :maxlength="OAUTH_CLIENT_NAME.maxLength" autocomplete="off" />
                </Field>
                <Field :label="t('admin.clients.form.redirectUris')" :description="t('admin.clients.form.redirectUrisHint', {max: REDIRECT_URI.maxCount})" :error="fieldError('redirectUris')">
                    <Textarea v-model="redirectText" name="redirectUris" :rows="3" autosize :max-rows="6" spellcheck="false" autocomplete="off" placeholder="https://" />
                </Field>
                <Field v-if="editing === undefined" group :label="t('admin.clients.form.type')" :description="t('admin.clients.form.typeHint')" :error="fieldError('type')">
                    <RadioGroup :model-value="type" name="type" :options="typeOptions" data-site-admin-client-type @update:model-value="setType" />
                </Field>
                <Checkbox v-model="skipConsent" name="skipConsent" :invalid="feedback.isInvalid('skipConsent')" data-site-admin-client-skip-consent>{{ t("admin.clients.form.skipConsent") }}</Checkbox>
            </form>
            <div v-else key="created">
                <p class="admin-client__text">{{ created.clientSecret === null ? t("admin.clients.register.publicNote") : t("admin.clients.register.secretNote") }}</p>
                <dl class="admin-client__credentials">
                    <dt>{{ t("admin.clients.credentials.clientId") }}</dt>
                    <dd class="admin-client__secret">
                        <code data-site-admin-created-client-id>{{ created.client.clientId }}</code>
                        <CopyButton :text="created.client.clientId" :label="t('admin.clients.credentials.copyId')" />
                    </dd>
                    <template v-if="created.clientSecret !== null">
                        <dt>{{ t("admin.clients.credentials.secret") }}</dt>
                        <dd class="admin-client__secret">
                            <code data-site-admin-created-secret>{{ created.clientSecret }}</code>
                            <CopyButton :text="created.clientSecret" :label="t('admin.clients.credentials.copySecret')" />
                        </dd>
                    </template>
                </dl>
            </div>
        </Transition>
        <template #footer="{cancel}">
            <Transition name="nb-ui-switch" mode="out-in">
                <div v-if="created === undefined" key="form" class="admin-dialog-buttons">
                    <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("admin.list.cancel") }}</Button>
                    <Button variant="primary" type="submit" form="admin-client-form" :disabled="!canSubmit" :loading="submitting" data-site-admin-client-submit>{{
                        editing === undefined ? t("admin.clients.register.submit") : t("admin.clients.edit.submit")
                    }}</Button>
                </div>
                <div v-else key="created" class="admin-dialog-buttons">
                    <Button variant="primary" data-site-admin-client-finish @click="cancel">{{ t("admin.list.done") }}</Button>
                </div>
            </Transition>
        </template>
    </Dialog>
</template>

<style scoped>
.admin-client__text {
    margin: 0;
    color: var(--text-secondary);
}

.admin-client__credentials {
    display: grid;
    gap: 6px;
    margin: 14px 0 0;
}

.admin-client__credentials dt {
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.admin-client__credentials dd {
    margin: 0 0 8px;
}

.admin-client__secret {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-input);
}

.admin-client__secret code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    user-select: all;
}
</style>
