<script setup lang="ts">
/**
 * 管理面板的外壳（t10 计划 3.13 第一条；照 t09 定稿 `SiteAdminShellDraft`）：左栏 216 像素的导航，左下角当前用户的菜单（账号页、
 * 退出登录），右边是这一页。看板与四个列表页共用它，它是 `/admin` 这条父路由的组件，自己单独一个块（`router.ts`）。
 *
 * 外壳占满窗口的高度，自己不滚：滚的是右边的内容区。所以内容区有确定的高度，列表页（B6）让数据表格占满它
 * （`.admin-main__page` 是纵向的弹性盒，页面根元素设 `flex: 1` 即可）；看板比它高，在内容区里往下滚。
 * 管理面板只做桌面宽（t09 定）：窄窗口里左栏不收起，内容区跟着变窄，页面自己负责不横向溢出。
 */

import {Button, DropdownMenu} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import type {TextRef} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, shallowRef} from "vue";
import {RouterLink, RouterView, useRouter} from "vue-router";

import FormStatus from "../../components/FormStatus.vue";
import {useSite} from "../../context";
import {failureText} from "../../http/failure-text";
import {signOut} from "../../session/sign-out";
import {useSiteText} from "../../text";
import {useAdminText} from "./text";
import type {AdminTextKey} from "./text";

const t = useAdminText();
// 外壳上有几处与站点别处同一句话（退出登录、产品名、账号菜单），用站点目录里的那条，不在管理面板的目录里再抄一份。
const siteT = useSiteText();
const port = useText();
const {account, identity, storage} = useSite();
const router = useRouter();

const NAV = [
    {route: "admin-dashboard", icon: "i-lucide-chart-line", title: "admin.dashboard.title"},
    {route: "admin-users", icon: "i-lucide-users", title: "admin.users.title"},
    {route: "admin-codes", icon: "i-lucide-ticket", title: "admin.codes.title"},
    {route: "admin-clients", icon: "i-lucide-key-round", title: "admin.clients.title"},
    {route: "admin-audit", icon: "i-lucide-scroll-text", title: "admin.audit.title"},
] as const satisfies readonly {route: string; icon: string; title: AdminTextKey}[];

const me = computed(() => (account.state.value.kind === "signed-in" ? account.state.value.me : undefined));
const initial = computed(() => Array.from(me.value?.displayName ?? me.value?.username ?? "")[0] ?? "");

const menuItems = computed<DropdownMenuItemData[]>(() => [
    {id: "account", label: t("admin.accountPage")},
    {id: "sign-out", label: siteT("account.signOut")},
]);

const signingOut = shallowRef(false);
const signOutStatus = shallowRef<{readonly reason: string; readonly text: TextRef}>();

async function onMenu(id: string): Promise<void> {
    if (id === "account") {
        await router.push("/account");
        return;
    }
    if (id !== "sign-out" || signingOut.value) return;
    signingOut.value = true;
    signOutStatus.value = undefined;
    try {
        const result = await signOut(identity, account, storage);
        if (!result.ok) {
            const failure = result.failure;
            if (failure.kind !== "code" || failure.handled !== true) {
                signOutStatus.value = {reason: failure.kind === "code" ? failure.code : failure.kind, text: failureText("identity", failure)};
            }
            return;
        }
        await router.replace("/");
    } catch (error) {
        // 已经登出、当前账号已清空，只是去首页的跳转没成：守卫在下一次导航时照样把他当访客。
        console.warn("登出之后没能回到首页", error);
    } finally {
        signingOut.value = false;
    }
}
</script>

<template>
    <div class="admin-shell" data-site-admin-shell>
        <nav class="admin-nav" :aria-label="t('admin.nav')">
            <div class="admin-brand">{{ siteT("paper.title") }}</div>
            <RouterLink v-for="item in NAV" :key="item.route" :to="{name: item.route}" class="admin-nav__item nb-ui-focus-ring-inset" :data-site-admin-nav="item.route">
                <span :class="item.icon" aria-hidden="true" />
                <span class="admin-nav__label">{{ t(item.title) }}</span>
            </RouterLink>
            <div class="admin-nav__foot">
                <FormStatus :text="signOutStatus === undefined ? '' : port.t(signOutStatus.text)" :reason="signOutStatus?.reason" />
                <DropdownMenu v-if="me !== undefined" :items="menuItems" side="top" align="start" @select="onMenu">
                    <Button variant="ghost" class="admin-me" :aria-label="siteT('account.menu', {username: me.username})" :loading="signingOut" data-site-admin-menu>
                        <span class="admin-avatar" aria-hidden="true">{{ initial }}</span>
                        <span class="admin-me__name">{{ me.username }}</span>
                        <span class="i-lucide-chevrons-up-down admin-me__more" aria-hidden="true" />
                    </Button>
                </DropdownMenu>
            </div>
        </nav>

        <main class="admin-main">
            <div class="admin-main__page">
                <RouterView />
            </div>
        </main>
    </div>
</template>

<style scoped>
.admin-shell {
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    height: 100svh;
    overflow: hidden;
    background: var(--bg-main);
    color: var(--text-main);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
}

.admin-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 16px 10px 12px;
    overflow-y: auto;
}

.admin-brand {
    padding: 4px 10px 18px;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 600;
}

.admin-nav__item {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: var(--control-h-md);
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    text-decoration: none;
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

.admin-nav__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.admin-nav__item:hover {
    background: var(--overlay-item-active);
    color: var(--text-main);
}

.admin-nav__item[aria-current="page"] {
    background: var(--overlay-item-active);
    color: var(--text-main);
    font-weight: 600;
}

.admin-nav__foot {
    display: grid;
    gap: 4px;
    margin-top: auto;
}

.admin-me {
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    padding: 0 10px;
    color: var(--text-secondary);
}

.admin-me__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.admin-me__more {
    color: var(--text-muted);
}

.admin-avatar {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent-bg);
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 600;
}

/* 内容区：占满右边的高度，自己滚；页面最宽 1280 像素，宽窗口里靠左（照定稿）。 */
.admin-main {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
}

.admin-main__page {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-height: 100%;
    max-width: 1280px;
    padding: 14px 20px 20px 6px;
}
</style>
