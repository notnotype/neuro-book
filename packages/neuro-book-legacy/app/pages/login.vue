<script setup lang="ts">
import {ensureThemeHost} from "nbook/app/utils/theme/host";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const route = useRoute();
const router = useRouter();
const themeHostRef = ref<HTMLElement | null>(null);
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMessage = ref("");
const {t} = useI18n();

/**
 * 解析安全的登录后跳转地址。
 */
const resolveRedirect = (): string => {
    return typeof route.query.redirect === "string" && route.query.redirect.trim().startsWith("/") && !route.query.redirect.trim().startsWith("//")
        ? route.query.redirect
        : "/";
};

/**
 * 登录提交。
 */
const submit = async (): Promise<void> => {
    if (busy.value) {
        return;
    }

    busy.value = true;
    errorMessage.value = "";
    try {
        await $fetch<AuthSessionDto>("/api/auth/login", {
            method: "POST",
            body: {
                username: username.value,
                password: password.value,
            },
        });
        await router.push(resolveRedirect());
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : t("auth.loginFailed");
    } finally {
        busy.value = false;
    }
};

onMounted(() => {
    ensureThemeHost(themeHostRef.value);
    void (async () => {
        try {
            const session = await $fetch<AuthSessionDto>("/api/auth/me");
            if (!session.authEnabled || session.user) {
                await router.replace(resolveRedirect());
            }
        } catch {
            // 路由守卫已经处理常规鉴权失败；这里仅兜底 auth disabled / 已登录场景。
        }
    })();
});
</script>

<template>
    <!-- 登录页外壳 -->
    <div ref="themeHostRef" class="auth-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <div class="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
            <div class="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-2xl">
                <div class="mb-6">
                    <div class="text-2xl font-semibold">{{ t("auth.loginTitle") }}</div>
                    <div class="mt-2 text-sm text-[var(--text-secondary)]">{{ t("auth.loginDescription") }}</div>
                </div>

                <form class="space-y-4" @submit.prevent="submit">
                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">{{ t("auth.username") }}</div>
                        <FormInput v-model="username" autocomplete="username" :placeholder="t('auth.usernamePlaceholder')" />
                    </label>

                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">{{ t("auth.password") }}</div>
                        <FormInput v-model="password" type="password" autocomplete="current-password" :placeholder="t('auth.passwordPlaceholder')" />
                    </label>

                    <div v-if="errorMessage" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-sm text-[var(--status-danger)]">
                        {{ errorMessage }}
                    </div>

                    <button
                        type="submit"
                        class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--accent-main)] px-4 text-sm font-medium text-[var(--text-inverse)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="busy"
                    >
                        {{ busy ? t("auth.loggingIn") : t("auth.loginButton") }}
                    </button>

                    <!-- 首次部署与关闭认证指引 -->
                    <div class="space-y-2 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-3 text-xs text-[var(--text-secondary)]">
                        <div class="font-medium text-[var(--text-main)]">{{ t("auth.setupAdminTitle") }}</div>
                        <p>
                            {{ t("auth.setupAdminCommandBefore") }}
                            <code class="rounded bg-[var(--bg-main)] px-1.5 py-0.5 font-mono text-[var(--status-info)]">bun run create-admin</code>
                            {{ t("auth.setupAdminCommandAfter") }}
                        </p>
                        <p>
                            {{ t("auth.disableAuthBefore") }}
                            <code class="rounded bg-[var(--bg-main)] px-1.5 py-0.5 font-mono text-[var(--status-info)]">config.yaml</code>
                            {{ t("auth.disableAuthAfter") }}
                        </p>
                    </div>
                </form>
            </div>
        </div>
    </div>
</template>
