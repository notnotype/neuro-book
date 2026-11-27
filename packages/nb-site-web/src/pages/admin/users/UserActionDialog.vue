<script setup lang="ts">
/**
 * 用户页行尾菜单里每一项的确认对话框（t10 计划 3.13；`site.admin` 输出 2 到 5）：先说清这一步的后果，确认后才发请求；失败写在页脚的
 * 状态行（`Dialog` 的 `status`），对话框留着，可以再试或取消。
 *
 * 用 `Dialog` 而不是 `AlertDialog`：计划要失败写在对话框里，`AlertDialog` 没有状态行，确认时就先关掉了（reka 的行为）。
 * 破坏性的几项确认按钮用危险色，读屏名字里有对象的用户名（标题与按钮文字都带）。
 *
 * 重置密码成功后同一个对话框换成新密码与复制按钮（输出 4：新密码只出现这一次），正文与底栏的按钮都用 nb-ui 的换内容过渡
 * （`nb-ui-switch`）。这时点遮罩、按 Esc 都不关，只有“完成”关：免得一下误点误按就再也看不到；
 * 关掉以后、内容卸载完（`closed`）才丢掉密码：在淡出的那一下就丢的话，对话框关到一半会变回确认的样子。再打开时是确认的那一步，
 * 页面上任何地方都不再有那个密码。
 *
 * `rate_limited` 时状态行倒数，倒数完之前确认不可用；状态行只给不带秒数的那句（`statusSteady`），polite 的 live region 不每秒播报。
 */

import type {AdminUserItem} from "@notnotype/nb-site-identity-contract/constants";
import {Button, CopyButton, Dialog} from "@notnotype/nb-ui/components";
import {computed, shallowRef, watch} from "vue";

import {useSite} from "../../../context";
import type {AdminApi} from "../../../http/admin";
import type {Result} from "../../../http/core";
import {useAdminText} from "../text";
import type {AdminTextKey} from "../text";
import {useFormFeedback} from "../../form-feedback";

/** 行尾菜单的六项（封禁与解封、设为与取消管理员按当前状态只出现一个）。 */
export type UserAction = "resetPassword" | "ban" | "unban" | "grantAdmin" | "revokeAdmin" | "revokeSessions";

const props = defineProps<{open: boolean; user: AdminUserItem | undefined; action: UserAction | undefined; api: AdminApi}>();
const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    /** 处置成功（重置密码之外的几项）：回处置之后的那一条。 */
    (event: "done", user: AdminUserItem): void;
    /** 对象已经不在了（`not_found`）：列表该重取。 */
    (event: "missing"): void;
}>();

const {clock} = useSite();
const t = useAdminText();

const DANGER: ReadonlySet<UserAction> = new Set(["resetPassword", "ban", "revokeAdmin", "revokeSessions"]);

const submitting = shallowRef(false);
/** 重置成功后的新密码；只在这个对话框里、只到它关完为止。 */
const password = shallowRef<string>();

const feedback = useFormFeedback<never>(shallowRef(null), clock);
const {statusSteady} = feedback;

// 每次打开都从确认那一步开始，状态行是空的。
watch(
    () => props.open,
    (open) => {
        if (open) feedback.reset();
    },
);

const textKey = (part: "title" | "description" | "confirm"): AdminTextKey => `admin.users.actions.${props.action ?? "ban"}.${part}`;
const username = computed(() => props.user?.username ?? "");
const title = computed(() => (password.value === undefined ? t(textKey("title"), {username: username.value}) : t("admin.users.password.title", {username: username.value})));

function request(api: AdminApi, user: AdminUserItem, action: Exclude<UserAction, "resetPassword">): Promise<Result<AdminUserItem>> {
    switch (action) {
        case "ban":
            return api.actOnUser(user.id, "ban");
        case "unban":
            return api.actOnUser(user.id, "unban");
        case "revokeSessions":
            return api.actOnUser(user.id, "revoke-sessions");
        case "grantAdmin":
            return api.setRole(user.id, "admin");
        case "revokeAdmin":
            return api.setRole(user.id, "user");
    }
}

async function confirm(): Promise<void> {
    const user = props.user;
    const action = props.action;
    if (user === undefined || action === undefined || submitting.value || feedback.waiting.value) return;
    submitting.value = true;
    feedback.reset();
    try {
        if (action === "resetPassword") {
            const result = await props.api.resetPassword(user.id);
            if (result.ok) password.value = result.value.password;
            else fail(result.failure);
            return;
        }
        const result = await request(props.api, user, action);
        if (!result.ok) {
            fail(result.failure);
            return;
        }
        emit("done", result.value);
        emit("update:open", false);
    } finally {
        submitting.value = false;
    }
}

function fail(failure: Parameters<typeof feedback.showFailure>[0]): void {
    if (!feedback.showFailure(failure)) return;
    if (failure.kind === "code" && failure.code === "not_found") emit("missing");
}
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="title"
        :status="statusSteady"
        :busy="submitting"
        :close-on-overlay="password === undefined"
        :close-on-esc="password === undefined"
        data-site-admin-user-dialog
        :data-site-admin-user-dialog-step="password === undefined ? 'confirm' : 'password'"
        @update:open="emit('update:open', $event)"
        @closed="password = undefined"
    >
        <Transition name="nb-ui-switch" mode="out-in">
            <div v-if="password === undefined" key="confirm">
                <p class="admin-dialog__text">{{ t(textKey("description")) }}</p>
            </div>
            <div v-else key="password">
                <p class="admin-dialog__text">{{ t("admin.users.password.description") }}</p>
                <div class="admin-dialog__secret">
                    <code data-site-admin-new-password>{{ password }}</code>
                    <CopyButton :text="password" :label="t('admin.users.password.copy')" />
                </div>
            </div>
        </Transition>
        <template #footer="{cancel}">
            <Transition name="nb-ui-switch" mode="out-in">
                <div v-if="password === undefined" key="confirm" class="admin-dialog-buttons">
                    <Button variant="secondary" :disabled="submitting" @click="cancel">{{ t("admin.list.cancel") }}</Button>
                    <Button
                        :variant="props.action !== undefined && DANGER.has(props.action) ? 'danger' : 'primary'"
                        :disabled="feedback.waiting.value"
                        :loading="submitting"
                        data-site-admin-user-confirm
                        @click="confirm"
                    >{{ t(textKey("confirm")) }}</Button>
                </div>
                <div v-else key="password" class="admin-dialog-buttons">
                    <Button data-site-admin-user-finish @click="cancel">{{ t("admin.list.done") }}</Button>
                </div>
            </Transition>
        </template>
    </Dialog>
</template>

<style scoped>
.admin-dialog__text {
    margin: 0;
    color: var(--text-secondary);
}

.admin-dialog__secret {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: var(--radius-control);
    border: var(--border-w) solid var(--border-color);
    background: var(--bg-input);
}

.admin-dialog__secret code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    user-select: all;
}
</style>
