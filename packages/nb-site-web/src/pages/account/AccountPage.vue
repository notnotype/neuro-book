<script setup lang="ts">
/**
 * 账号页（t10 计划 3.12；t09 第 3、8、11 条：一页到底、左边目录、没有横幅；两种账号版式相同）。顶上是站名与账号菜单（管理面板、
 * 外观、退出登录），下面左边是目录、右边是五节。
 *
 * - 页面级的加载（计划 3.1）：四份列表（`account-lists.ts`）与 `meta` 都回来了才画各节；超过 200 毫秒才显示“正在载入”，列表失败时
 *   同一位置写原因与重试。`meta` 决定“登录与安全”列出哪几个上游，晚到时那几行会消失、把下面的节往上拉，所以一起等；它失败不挡页面，
 *   这时没关联的上游照样列出。
 * - 目录随滚动高亮：顶边已滚过视口上部四分之一处的最后一节；滚到底时是最后一节（最后几节矮，顶边到不了那里）。点目录滚到那一节、
 *   焦点给那一节的标题，并钉住它到这次滚动结束（`scrollend`），之后高亮就是那一节：否则滚到底时会高亮成最后一节，矮的一节下面
 *   那节也会过线。途中他自己滚动（滚轮、触摸、按键）就放开。手机宽时目录是顶上一排标签，高亮换了就把当前标签横向滚进来。
 * - 社交关联没完成时上游把人带回 `/account?social_error=<码>`（计划 3.1 的 `social_error` 表）：交给“登录与安全”一节写在它的状态行，
 *   把参数从地址去掉、滚到那一节。
 */

import {SOCIAL_ERROR_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import {Button, DropdownMenu, Spinner} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import type {TextRef} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch} from "vue";
import {useRoute, useRouter} from "vue-router";

import FormStatus from "../../components/FormStatus.vue";
import {failureText} from "../../http/failure-text";
import {useSite} from "../../context";
import {signOut} from "../../session/sign-out";
import {useSiteText} from "../../text";
import type {SiteTextKey} from "../../text";
import {appearanceMenuItem, selectedAppearance} from "../appearance-menu";
import {readSocialError, stripSocialError} from "../social-error";
import {usePageMeta} from "../use-meta";
import {useAccountLists} from "./account-lists";
import GrantsSection from "./GrantsSection.vue";
import InvitesSection from "./InvitesSection.vue";
import ProfileSection from "./ProfileSection.vue";
import SecuritySection from "./SecuritySection.vue";
import SessionsSection from "./SessionsSection.vue";

type SectionId = "profile" | "security" | "sessions" | "invites" | "apps";

const SECTIONS: readonly {readonly id: SectionId; readonly title: SiteTextKey}[] = [
    {id: "profile", title: "account.profile.title"},
    {id: "security", title: "account.security.title"},
    {id: "sessions", title: "account.sessions.title"},
    {id: "invites", title: "account.invites.title"},
    {id: "apps", title: "account.apps.title"},
];

/** 超过这么久还没取到才显示“正在载入”（计划 3.1“页面级的加载”）：快的时候不闪一下。 */
const LOADING_DELAY_MS = 200;

const {identity, account, clock, storage, theme} = useSite();
const route = useRoute();
const router = useRouter();
const t = useSiteText();
const port = useText();

const me = computed(() => (account.state.value.kind === "signed-in" ? account.state.value.me : undefined));
const lists = useAccountLists(identity);
const meta = usePageMeta(identity);
const providers = computed(() => meta.latest.value?.providers);

// ---- 页面级的加载 ----

const loadingShown = shallowRef(false);
/** 第一次取 `meta` 还没有结果（成功失败都算有结果）。之后重取不再挡页面。 */
const metaPending = shallowRef(true);
let stopLoadingDelay: (() => void) | undefined;

function stopDelay(): void {
    stopLoadingDelay?.();
    stopLoadingDelay = undefined;
}

async function load(): Promise<void> {
    stopDelay();
    loadingShown.value = false;
    stopLoadingDelay = clock.every(LOADING_DELAY_MS, () => {
        stopDelay();
        loadingShown.value = true;
    });
    const metaSettled = meta.ensure().then(() => {
        metaPending.value = false;
    });
    await Promise.all([lists.load(), metaSettled]);
    stopDelay();
    loadingShown.value = false;
}

/** 主区画哪一块：列表到了而 `meta` 还没回来时仍是“正在载入”。 */
const pageKind = computed(() => (lists.state.value.kind === "ready" && metaPending.value ? "loading" : lists.state.value.kind));

const loadFailureText = computed(() => (lists.state.value.kind === "failed" ? failureText("identity", lists.state.value.failure) : undefined));

// ---- 社交关联回来时的 `social_error` ----

const socialError = shallowRef<string>();

watch(
    () => route.query[SOCIAL_ERROR_PARAM],
    () => {
        const code = readSocialError(route.query);
        if (code !== undefined) socialError.value = code;
        // 空的码当作没带：只去掉参数，不跳到那一节。
        stripSocialError(route, router, code === undefined ? {} : {hash: "#security"});
    },
    {immediate: true},
);

// ---- 目录 ----

const main = useTemplateRef<HTMLElement>("main");
const toc = useTemplateRef<HTMLElement>("toc");
const spied = shallowRef<SectionId>("profile");
/** 点目录或带锚点进来时钉住的那一节；这次滚动结束或他自己滚动时放开。 */
const pinned = shallowRef<SectionId>();
const current = computed(() => pinned.value ?? spied.value);

function sectionElement(id: SectionId): HTMLElement | null {
    return main.value?.querySelector<HTMLElement>(`[data-site-account-section="${id}"]`) ?? null;
}

function spy(): void {
    const sections = SECTIONS.map((section) => ({id: section.id, element: sectionElement(section.id)}));
    const scroller = document.documentElement;
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= scroller.scrollHeight - 2) {
        spied.value = SECTIONS[SECTIONS.length - 1]!.id;
        return;
    }
    const line = window.innerHeight / 4;
    let found: SectionId = "profile";
    for (const {id, element} of sections) if (element !== null && element.getBoundingClientRect().top <= line) found = id;
    spied.value = found;
}

function unpin(): void {
    pinned.value = undefined;
}

/** 钉住的那次滚动结束：高亮留在钉住的那一节，之后照滚动位置判。 */
function onScrollEnd(): void {
    if (pinned.value === undefined) return;
    spied.value = pinned.value;
    pinned.value = undefined;
}

function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 滚到那一节并钉住。已经在那个位置时不会滚、也就没有 `scrollend`，这时直接放开；否则等 `scrollend`（瞬时滚动也有，滚动事件在下一帧
 * 才到，当场放开会被它判成别的节）。
 */
function scrollToSection(element: HTMLElement, id: SectionId, behavior: ScrollBehavior): void {
    const scroller = document.documentElement;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const maxScroll = Math.max(0, scroller.scrollHeight - window.innerHeight);
    const target = Math.min(Math.max(0, window.scrollY + element.getBoundingClientRect().top - margin), maxScroll);
    pinned.value = id;
    element.scrollIntoView({behavior, block: "start"});
    if (Math.abs(target - window.scrollY) < 1) onScrollEnd();
}

function goTo(id: SectionId): void {
    const element = sectionElement(id);
    if (element !== null) {
        scrollToSection(element, id, prefersReducedMotion() ? "auto" : "smooth");
        // 焦点给标题，读屏读出到了哪一节、下一次 Tab 从这一节接着走；不再滚动，免得打断上面的平滑滚动。
        element.querySelector<HTMLElement>("[data-site-account-section-title]")?.focus({preventScroll: true});
    }
    router.replace({path: route.path, query: route.query, hash: `#${id}`}).catch((error: unknown) => {
        console.warn("没能把目录的锚点写进地址", error);
    });
}

/**
 * 带着锚点进来（`/account#sessions`、关联回来的 `#security`）：各节画出来之后滚到那里。各节在主区的过渡里换上（`mode="out-in"`），
 * 先等“正在载入”淡出才插进页面，所以挂在过渡的 `enter` 上，不在列表取到的那一刻滚：那时各节还不在页面里。
 */
function onMainEnter(element: Element): void {
    if (element.matches("[data-site-account-sections]")) scrollToHash();
}

function scrollToHash(): void {
    const id = SECTIONS.find((section) => `#${section.id}` === route.hash)?.id;
    if (id === undefined) return;
    // 不抢焦点：他是从地址进来的，焦点留在页面开头。
    const element = sectionElement(id);
    if (element !== null) scrollToSection(element, id, "auto");
}

/**
 * 手机宽时目录是一排横向滚动的标签，高亮换了就把当前标签滚进这一排。只动这一排的 `scrollLeft`：`scrollIntoView` 会连页面一起纵向滚。
 */
watch(
    current,
    (id) => {
        const nav = toc.value;
        if (nav === null || nav.scrollWidth <= nav.clientWidth) return;
        const item = nav.querySelector<HTMLElement>(`[data-site-account-toc-item="${id}"]`);
        if (item === null) return;
        const padding = Number.parseFloat(getComputedStyle(nav).paddingLeft) || 0;
        const navBox = nav.getBoundingClientRect();
        const itemBox = item.getBoundingClientRect();
        let delta = 0;
        if (itemBox.left < navBox.left + padding) delta = itemBox.left - navBox.left - padding;
        else if (itemBox.right > navBox.right - padding) delta = itemBox.right - navBox.right + padding;
        if (delta !== 0) nav.scrollTo({left: nav.scrollLeft + delta, behavior: prefersReducedMotion() ? "auto" : "smooth"});
    },
    {flush: "post"},
);

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown"] as const;

onMounted(() => {
    window.addEventListener("scroll", spy, {passive: true});
    window.addEventListener("scrollend", onScrollEnd, {passive: true});
    window.addEventListener("resize", spy, {passive: true});
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, unpin, {passive: true});
    void load();
});

onBeforeUnmount(() => {
    stopDelay();
    window.removeEventListener("scroll", spy);
    window.removeEventListener("scrollend", onScrollEnd);
    window.removeEventListener("resize", spy);
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, unpin);
});

// ---- 改了密码之后重取设备 ----

const sessionsSection = useTemplateRef<InstanceType<typeof SessionsSection>>("sessionsSection");

function onPasswordChanged(): void {
    void sessionsSection.value?.reload();
}

// ---- 账号菜单 ----

const signingOut = shallowRef(false);
const signOutStatus = shallowRef<{readonly reason: string; readonly text: TextRef}>();

const menuItems = computed<DropdownMenuItemData[]>(() => [
    ...(me.value?.role === "admin" ? [{id: "admin", label: t("account.admin")}] : []),
    appearanceMenuItem(t, theme.appearance.value),
    {id: "sign-out", label: t("account.signOut")},
]);

const initial = computed(() => Array.from(me.value?.displayName ?? me.value?.username ?? "")[0] ?? "");

async function onMenu(id: string): Promise<void> {
    const appearance = selectedAppearance(id);
    if (appearance !== undefined) {
        theme.setAppearance(appearance);
        return;
    }
    if (id === "admin") {
        await router.push("/admin");
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
    <div class="account-page" data-site-page="account">
        <header class="account-top">
            <span class="account-brand">{{ t("paper.title") }}</span>
            <FormStatus class="account-top__status" :text="signOutStatus === undefined ? '' : port.t(signOutStatus.text)" :reason="signOutStatus?.reason" />
            <DropdownMenu v-if="me !== undefined" :items="menuItems" align="end" @select="onMenu">
                <Button variant="ghost" class="account-me" :aria-label="t('account.menu', {username: me.username})" :loading="signingOut" data-site-account-menu>
                    <span class="account-avatar" aria-hidden="true">{{ initial }}</span>
                    <span class="account-me__name">{{ me.username }}</span>
                    <span class="i-lucide-chevron-down" aria-hidden="true" />
                </Button>
            </DropdownMenu>
        </header>

        <div class="account-body">
            <h1 class="sr-only">{{ t("account.title") }}</h1>
            <nav ref="toc" class="account-toc" :aria-label="t('account.toc')" data-site-account-toc>
                <a
                    v-for="section in SECTIONS"
                    :key="section.id"
                    :href="`#${section.id}`"
                    class="account-toc__item"
                    :class="{'is-current': current === section.id}"
                    :aria-current="current === section.id ? 'location' : undefined"
                    :data-site-account-toc-item="section.id"
                    @click.prevent="goTo(section.id)"
                >
                    {{ t(section.title) }}
                    <!-- 每一项行尾都留着点的位置；只有资料一节在邮箱待补时显形（t09 第 11 条）。 -->
                    <span
                        class="account-toc__dot"
                        :class="{'is-on': section.id === 'profile' && me?.emailPending === true}"
                        :role="section.id === 'profile' && me?.emailPending === true ? 'img' : undefined"
                        :aria-label="section.id === 'profile' && me?.emailPending === true ? t('account.pending') : undefined"
                        :data-site-account-toc-dot="section.id === 'profile' && me?.emailPending === true ? 'on' : 'off'"
                    />
                </a>
            </nav>

            <main ref="main" class="account-main">
                <Transition name="account-fade" mode="out-in" @enter="onMainEnter">
                    <div v-if="pageKind === 'loading'" key="loading" class="account-state" aria-busy="true" data-site-account-loading>
                        <template v-if="loadingShown">
                            <Spinner />
                            <p role="status">{{ t("account.loading") }}</p>
                        </template>
                    </div>
                    <div v-else-if="pageKind === 'failed'" key="failed" class="account-state" role="alert" data-site-account-failed>
                        <p>{{ t("account.loadFailed") }}</p>
                        <p v-if="loadFailureText !== undefined" class="account-state__reason">{{ port.t(loadFailureText) }}</p>
                        <Button variant="secondary" @click="load">{{ t("account.retry") }}</Button>
                    </div>
                    <div v-else-if="me !== undefined" key="ready" class="account-sections" data-site-account-sections>
                        <ProfileSection :me="me" />
                        <SecuritySection :me="me" :identities="lists.identities" :providers="providers" :social-error="socialError" @password-changed="onPasswordChanged" />
                        <SessionsSection ref="sessionsSection" :sessions="lists.sessions" />
                        <InvitesSection :invites="lists.invites" />
                        <GrantsSection :grants="lists.grants" />
                    </div>
                </Transition>
            </main>
        </div>
    </div>
</template>

<style scoped>
.account-page {
    min-height: 100svh;
    background: var(--bg-main);
    color: var(--text-main);
    font-size: var(--text-md);
    line-height: var(--leading-ui);
}

.account-top {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 52px;
    padding: 0 24px;
}

.account-brand {
    flex: none;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 600;
}

.account-top__status {
    flex: 1 1 0;
    min-width: 0;
    text-align: right;
}

.account-me {
    flex: none;
    gap: 8px;
}

.account-avatar {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent-bg);
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 600;
}

/* 目录加内容一起居中；内容列封顶 640px，宽窗口里不拉满。 */
.account-body {
    display: grid;
    grid-template-columns: 180px minmax(0, 640px);
    gap: 32px;
    justify-content: center;
    padding: 20px 24px 48px;
}

.account-toc {
    position: sticky;
    top: 20px;
    display: grid;
    gap: 2px;
    align-self: start;
}

.account-toc__item {
    display: flex;
    align-items: center;
    height: var(--control-h-md);
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    text-decoration: none;
    white-space: nowrap;
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

.account-toc__item:hover {
    color: var(--text-main);
}

.account-toc__item:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: -2px;
}

/* 当前项加粗：字宽变了也不推动点，点靠右（宽屏）或紧跟文字但每项都留着位置（窄屏）。 */
.account-toc__item.is-current {
    background: var(--overlay-item-active);
    color: var(--text-main);
    font-weight: 600;
}

.account-toc__dot {
    flex: none;
    width: 6px;
    height: 6px;
    margin-left: auto;
    border-radius: 50%;
    background: var(--status-warning);
    visibility: hidden;
}

.account-toc__dot.is-on {
    visibility: visible;
}

.account-main {
    min-width: 0;
}

.account-sections {
    display: grid;
    gap: 16px;
}

.account-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 240px;
    color: var(--text-secondary);
    text-align: center;
}

.account-state p {
    margin: 0;
}

.account-state__reason {
    font-size: var(--text-sm);
}

.account-fade-enter-active,
.account-fade-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.account-fade-enter-from,
.account-fade-leave-to {
    opacity: 0;
}

/* 手机宽：目录变成顶上一排可以横向滑动的标签，钉在视口顶上；内容单列。 */
@media (max-width: 720px) {
    .account-top {
        padding: 0 16px;
    }

    .account-body {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
        padding: 0 12px 32px;
    }

    .account-toc {
        top: 0;
        z-index: 1;
        display: flex;
        gap: 2px;
        margin: 0 -12px;
        padding: 8px 12px;
        overflow-x: auto;
        background: var(--bg-main);
        scrollbar-width: none;
    }

    .account-toc__item {
        flex: none;
    }

    .account-toc__dot {
        margin-left: 6px;
    }

    .account-sections :deep(.account-section) {
        scroll-margin-top: 64px;
    }
}
</style>
