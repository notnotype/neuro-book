import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";
import {useAuthSessionState} from "nbook/app/composables/useAuthSessionState";

/**
 * 前端路由鉴权，只负责页面跳转体验。
 */
export default defineNuxtRouteMiddleware(async (to) => {
    const authSession = useAuthSessionState();
    /**
     * SSR 中使用 useRequestFetch 透传原始请求 cookie，避免已登录首屏被误判。
     */
    const fetchSession = async (): Promise<AuthSessionDto> => {
        if (import.meta.server) {
            const requestFetch = useRequestFetch();
            return await requestFetch<AuthSessionDto>("/api/auth/me").catch(() => ({authEnabled: true, user: null}));
        }

        return await $fetch<AuthSessionDto>("/api/auth/me").catch(() => ({authEnabled: true, user: null}));
    };

    const normalizeRedirect = (value: unknown): string => {
        if (typeof value !== "string") {
            return "/";
        }
        const trimmed = value.trim();
        return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : "/";
    };

    if (to.path === "/login") {
        const session = await fetchSession();
        authSession.setSession(session);
        if (!session.authEnabled || session.user) {
            return navigateTo(normalizeRedirect(to.query.redirect));
        }
        return;
    }
    if (useNuxtApp().$browserWindow?.state.value.status === "unauthorized") {
        return navigateTo({path: "/login", query: {redirect: to.fullPath}});
    }

    const session = await fetchSession();
    authSession.setSession(session);
    if (!session.authEnabled) {
        return;
    }

    if (!session.user) {
        return navigateTo({
            path: "/login",
            query: {
                redirect: to.fullPath,
            },
        });
    }

    if (to.path.startsWith("/admin") && session.user.role !== "admin") {
        throw createError({
            statusCode: 403,
            message: "需要管理员权限",
        });
    }
});
