<script setup lang="ts">
/**
 * 给机密客户端换密钥（t10 计划 3.13；`site.oauth-provider` 输出 9）：先说清后果，确认后发请求；成功后同一个对话框换成新密钥与复制按钮，
 * 只显示这一次。照用户页重置密码（`users/UserActionDialog.vue`）的做法：对话框关掉（`closed`）就丢掉密钥，显示密钥期间点遮罩、按 Esc 都不关；
 * 换到密钥那一步用 nb-ui 的换内容过渡（`nb-ui-switch`）。
 *
 * 失败写页脚的状态行、对话框留着。`not_found`（客户端已经不在了）另发 `missing`；公开客户端回 `client_public`（菜单里本来没有这一项，
 * 列表旧了才会撞上）同样写状态行。
 */

import type {OAuthClientItem} from "@notnotype/nb-site-identity-contract/constants";
import {Button, CopyButton, Dialog} from "@notnotype/nb-ui/components";
import {computed, shallowRef, watch} from "vue";

import {useSite} from "../../../context";
import type {AdminApi} from "../../../http/admin";
import {useAdminText} from "../text";
import {useFormFeedback} from "../../form-feedback";

const props = defineProps<{open: boolean; api: AdminApi; client?: OAuthClientItem | undefined}>();
const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "missing"): void;
}>();

const {clock} = useSite();
const t = useAdminText();

const submitting = shallowRef(false);
/** 换出来的新密钥；有它时对话框显示密钥。 */
const secret = shallowRef<string>();
const feedback = useFormFeedback<never>(shallowRef(null), clock);
const {statusSteady} = feedback;

watch(
    () => props.open,
    (open) => {
        if (open) feedback.reset();
    },
);

const name = computed(() => props.client?.name ?? "");

async function confirm(): Promise<void> {
    const client = props.client;
    if (client === undefined || submitting.value || feedback.waiting.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        const result = await props.api.rotateOAuthClientSecret(client.clientId);
        if (result.ok) {
            secret.value = result.value.clientSecret;
            return;
        }
        if (feedback.showFailure(result.failure) && result.failure.kind === "code" && result.failure.code === "not_found") emit("missing");
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="secret === undefined ? t('admin.clients.rotate.title', {name}) : t('admin.clients.rotate.doneTitle', {name})"
        :status="statusSteady"
        :busy="submitting"
        :close-on-overlay="secret === undefined"
        :close-on-esc="secret === undefined"
        data-site-admin-rotate-dialog
        :data-site-admin-rotate-step="secret === undefined ? 'confirm' : 'secret'"
        @update:open="emit('update:open', $event)"
        @closed="secret = undefined"
    >
        <Transition name="nb-ui-switch" mode="out-in">
            <p v-if="secret === undefined" key="confirm" class="admin-rotate__text">{{ t("admin.clients.rotate.description") }}</p>
            <div v-else key="secret">
                <p class="admin-rotate__text">{{ t("admin.clients.register.secretNote") }}</p>
                <div class="admin-rotate__secret">
                    <code data-site-admin-rotated-secret>{{ secret }}</code>
                    <CopyButton :text="secret" :label="t('admin.clients.credentials.copySecret')" />
                </div>
            </div>
        </Transition>
        <template #footer="{cancel}">
            <Transition name="nb-ui-switch" mode="out-in">
                <div v-if="secret === undefined" key="confirm" class="admin-dialog-buttons">
                    <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("admin.list.cancel") }}</Button>
                    <Button variant="danger" :disabled="feedback.waiting.value" :loading="submitting" data-site-admin-rotate-confirm @click="confirm">{{ t("admin.clients.rotate.confirm") }}</Button>
                </div>
                <div v-else key="secret" class="admin-dialog-buttons">
                    <Button variant="primary" data-site-admin-rotate-finish @click="cancel">{{ t("admin.list.done") }}</Button>
                </div>
            </Transition>
        </template>
    </Dialog>
</template>

<style scoped>
.admin-rotate__text {
    margin: 0;
    color: var(--text-secondary);
}

.admin-rotate__secret {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    padding: 10px 12px;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-input);
}

.admin-rotate__secret code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    user-select: all;
}
</style>
