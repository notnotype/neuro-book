<script setup lang="ts">
import {Dialog} from "@notnotype/nb-ui/components";
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {generateComplexPassword} from "nbook/app/utils/password";
import type {AdminUserListItemDto, AuthSessionDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const users = ref<AdminUserListItemDto[]>([]);
const currentUser = ref<AuthSessionDto["user"]>(null);
const themeHostRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const dialogErrorMessage = ref("");
const createOpen = ref(false);
const editTarget = ref<AdminUserListItemDto | null>(null);
const resetTarget = ref<AdminUserListItemDto | null>(null);

const createForm = reactive({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "admin" | "user",
});
const editForm = reactive({
    displayName: "",
    role: "user" as "admin" | "user",
    status: "active" as "active" | "disabled",
});
const resetPassword = ref("");
const novelIdeStore = useNovelIdeStore();
const {activeThemeId, customThemes, themeVarsSnapshot} = storeToRefs(novelIdeStore);
const {mountThemeHost} = useIdeTheme(activeThemeId, customThemes, themeVarsSnapshot);
const {t} = useI18n();
const editOpen = computed({
    get: () => Boolean(editTarget.value),
    set: (open: boolean): void => {
        if (!open) {
            editTarget.value = null;
        }
    },
});
const resetOpen = computed({
    get: () => Boolean(resetTarget.value),
    set: (open: boolean): void => {
        if (!open) {
            resetTarget.value = null;
            resetPassword.value = "";
        }
    },
});

/**
 * 自动生成新用户初始密码。
 */
const generateCreatePassword = (): void => {
    createForm.password = generateComplexPassword();
};

/**
 * 自动生成重置密码。
 */
const generateResetPassword = (): void => {
    resetPassword.value = generateComplexPassword();
};

/**
 * 加载用户列表。
 */
const loadUsers = async (): Promise<void> => {
    loading.value = true;
    errorMessage.value = "";
    try {
        const [session, list] = await Promise.all([
            $fetch<AuthSessionDto>("/api/auth/me"),
            $fetch<AdminUserListItemDto[]>("/api/admin/users"),
        ]);
        currentUser.value = session.user;
        users.value = list;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : t("admin.loadUsersFailed");
    } finally {
        loading.value = false;
    }
};

/**
 * 创建新用户。
 */
const createUser = async (): Promise<void> => {
    dialogErrorMessage.value = "";
    try {
        await $fetch("/api/admin/users", {
            method: "POST",
            body: {
                username: createForm.username,
                displayName: createForm.displayName || undefined,
                password: createForm.password,
                role: createForm.role,
            },
        });
        createOpen.value = false;
        createForm.username = "";
        createForm.displayName = "";
        createForm.password = "";
        createForm.role = "user";
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : t("admin.createFailed");
    }
};

/**
 * 打开编辑窗口。
 */
const openEdit = (user: AdminUserListItemDto): void => {
    editTarget.value = user;
    editForm.displayName = user.displayName;
    editForm.role = user.role;
    editForm.status = user.status;
};

/**
 * 保存用户更新。
 */
const saveUser = async (): Promise<void> => {
    if (!editTarget.value) {
        return;
    }

    dialogErrorMessage.value = "";
    try {
        await $fetch(`/api/admin/users/${editTarget.value.id}`, {
            method: "PATCH",
            body: {
                displayName: editForm.displayName || undefined,
                role: editForm.role,
                status: editForm.status,
            },
        });
        editTarget.value = null;
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : t("admin.saveFailed");
    }
};

/**
 * 提交密码重置。
 */
const submitReset = async (): Promise<void> => {
    if (!resetTarget.value) {
        return;
    }

    dialogErrorMessage.value = "";
    try {
        await $fetch(`/api/admin/users/${resetTarget.value.id}/password`, {
            method: "PUT",
            body: {
                password: resetPassword.value,
            },
        });
        resetTarget.value = null;
        resetPassword.value = "";
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : t("admin.resetFailed");
    }
};

/**
 * 切换禁用/启用。
 */
const toggleStatus = async (user: AdminUserListItemDto): Promise<void> => {
    dialogErrorMessage.value = "";
    try {
        await $fetch(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: {
                status: user.status === "active" ? "disabled" : "active",
            },
        });
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : t("admin.updateFailed");
    }
};

/**
 * 退出登录并跳转登录页。
 */
const logout = async (): Promise<void> => {
    await $fetch("/api/auth/logout", {method: "POST"});
    await navigateTo("/login");
};

watch([createOpen, editOpen, resetOpen], () => {
    dialogErrorMessage.value = "";
});

onMounted(() => {
    mountThemeHost(themeHostRef.value);
    void loadUsers();
});
</script>

<template>
    <!-- 管理员用户后台 -->
    <div ref="themeHostRef" class="admin-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-6">
            <header class="flex items-center justify-between gap-4 border-b border-[var(--border-color)] pb-4">
                <div>
                    <div class="text-2xl font-semibold">{{ t("admin.usersTitle") }}</div>
                    <div class="mt-1 text-sm text-[var(--text-secondary)]">{{ t("admin.usersDescription") }}</div>
                </div>
                <div class="flex items-center gap-3">
                    <div class="text-right text-sm text-[var(--text-secondary)]">
                        <div>{{ currentUser?.displayName || currentUser?.username || t("admin.notLoggedIn") }}</div>
                        <div>{{ currentUser?.role || "" }}</div>
                    </div>
                    <button class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)]" @click="void logout()">
                        {{ t("common.logout") }}
                    </button>
                </div>
            </header>

            <div class="flex items-center justify-between">
                <div class="text-sm text-[var(--text-secondary)]">{{ t("admin.totalUsers", {count: users.length}) }}</div>
                <button class="rounded-lg bg-[var(--accent-main)] px-4 py-2 text-sm font-medium text-[var(--text-inverse)] hover:opacity-90" @click="createOpen = true">
                    {{ t("admin.createUser") }}
                </button>
            </div>

            <div v-if="errorMessage" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger)]">
                {{ errorMessage }}
            </div>

            <div class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]">
                <table class="w-full border-collapse text-sm">
                    <thead class="bg-[var(--bg-input)] text-[var(--text-secondary)]">
                        <tr>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.username") }}</th>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.displayName") }}</th>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.role") }}</th>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.status") }}</th>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.lastLogin") }}</th>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.lastSeen") }}</th>
                            <th class="px-4 py-3 text-left font-medium">{{ t("admin.actions") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="user in users" :key="user.id" class="border-t border-[var(--border-color)] bg-[var(--bg-panel)]">
                            <td class="px-4 py-3">{{ user.username }}</td>
                            <td class="px-4 py-3">{{ user.displayName || "-" }}</td>
                            <td class="px-4 py-3">{{ user.role }}</td>
                            <td class="px-4 py-3">{{ user.status }}</td>
                            <td class="px-4 py-3">{{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-" }}</td>
                            <td class="px-4 py-3">{{ user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : "-" }}</td>
                            <td class="px-4 py-3">
                                <div class="flex flex-wrap gap-2">
                                    <button class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]" @click="openEdit(user)">{{ t("admin.edit") }}</button>
                                    <button class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]" @click="resetTarget = user">{{ t("admin.resetPassword") }}</button>
                                    <button class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]" @click="void toggleStatus(user)">
                                        {{ user.status === 'active' ? t("admin.disable") : t("admin.enable") }}
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <Dialog v-model="createOpen" :title="t('admin.createUser')" width="520px" show-cancel closable :confirm-label="t('common.confirm')" :teleport-target="false" @confirm="void createUser()">
            <div class="space-y-4 text-sm">
                <div v-if="dialogErrorMessage" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[var(--status-danger)]">
                    {{ dialogErrorMessage }}
                </div>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">{{ t("admin.username") }}</div>
                    <FormInput v-model="createForm.username" placeholder="username" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">{{ t("admin.displayName") }}</div>
                    <FormInput v-model="createForm.displayName" :placeholder="t('common.optional')" />
                </label>
                <label class="block">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-[var(--text-secondary)]">{{ t("admin.password") }}</span>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="generateCreatePassword">
                            <span class="i-lucide-wand-sparkles h-3.5 w-3.5"></span>
                            <span>{{ t("admin.generate") }}</span>
                        </button>
                    </div>
                    <FormInput v-model="createForm.password" type="text" :placeholder="t('admin.passwordMinLength')" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">{{ t("admin.role") }}</div>
                    <FormSelect v-model="createForm.role" :options="[{label: 'user', value: 'user'}, {label: 'admin', value: 'admin'}]" />
                </label>
            </div>
        </Dialog>

        <Dialog v-model="editOpen" :title="t('admin.editUser')" width="520px" show-cancel closable :confirm-label="t('common.confirm')" :teleport-target="false" @confirm="void saveUser()">
            <div class="space-y-4 text-sm">
                <div v-if="dialogErrorMessage" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[var(--status-danger)]">
                    {{ dialogErrorMessage }}
                </div>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">{{ t("admin.displayName") }}</div>
                    <FormInput v-model="editForm.displayName" :placeholder="t('common.optional')" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">{{ t("admin.role") }}</div>
                    <FormSelect v-model="editForm.role" :options="[{label: 'user', value: 'user'}, {label: 'admin', value: 'admin'}]" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">{{ t("admin.status") }}</div>
                    <FormSelect v-model="editForm.status" :options="[{label: 'active', value: 'active'}, {label: 'disabled', value: 'disabled'}]" />
                </label>
            </div>
        </Dialog>

        <Dialog v-model="resetOpen" :title="t('admin.resetPassword')" width="480px" show-cancel closable :confirm-label="t('common.confirm')" :teleport-target="false" @confirm="void submitReset()">
            <div class="space-y-4 text-sm">
                <div v-if="dialogErrorMessage" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[var(--status-danger)]">
                    {{ dialogErrorMessage }}
                </div>
                <div class="text-[var(--text-secondary)]">{{ t("admin.setNewPasswordFor", {username: resetTarget?.username ?? ""}) }}</div>
                <label class="block">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-[var(--text-secondary)]">{{ t("admin.newPassword") }}</span>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="generateResetPassword">
                            <span class="i-lucide-wand-sparkles h-3.5 w-3.5"></span>
                            <span>{{ t("admin.generate") }}</span>
                        </button>
                    </div>
                    <FormInput v-model="resetPassword" type="text" :placeholder="t('admin.passwordMinLength')" />
                </label>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
.admin-page {
    --editor-bg: var(--bg-main);
}
</style>
