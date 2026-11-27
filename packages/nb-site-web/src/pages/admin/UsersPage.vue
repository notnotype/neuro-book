<script setup lang="ts">
/**
 * 管理面板的用户页（t10 计划 3.13；`site.admin` 的 `GET users` 与五种处置；版式照 t09 定稿 r3 `users`）：工具条左边四个筛选项
 * （条数取回答的 `counts`），右边按用户名、显示名或邮箱的前缀搜；每行最后是“…”菜单，四项处置各自先确认（`UserActionDialog`）。
 *
 * 页码、筛选与搜索放在地址里（`?filter=banned&q=foo&page=3`），刷新、后退回到同一页；取数的约定在 `use-admin-list.ts`。
 * 一次处置成功后重取当前这一页：行的状态变了，筛选项的条数也跟着变，被封禁的账号在“已封禁”之外的筛选里可能就不在这一页了。
 *
 * 对自己的账号不能封禁、不能改角色（输出 5）：这两项在自己那一行不可用，`title` 写原因；服务端照样会拒（`self_forbidden`），
 * 对话框把它写在状态行。用户详情（`GET users/:id`）这一片不做（D11 没有图）。
 */

import {LOGIN_IDENTIFIER, USER_FILTERS} from "@notnotype/nb-site-identity-contract/constants";
import type {AdminUserItem, UserListResponse} from "@notnotype/nb-site-identity-contract/constants";
import {Badge, DataTable, DropdownMenu, IconButton, Input, SegmentedControl} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData, SegmentedControlValue, TableColumn} from "@notnotype/nb-ui/components";
import {computed, shallowRef, watch} from "vue";

import {useSite} from "../../context";
import {createAdminApi} from "../../http/admin";
import {locale} from "../../locale";
import {useAdminText} from "./text";
import {recentTime} from "../recent-time";
import AdminListFrame from "./AdminListFrame.vue";
import {fullTime, shortDate} from "./format";
import {memberOf, oneOf, searchTerm, searchText, withField} from "./list-query";
import type {ListSchema} from "./list-query";
import {ADMIN_PAGE_SIZE, useAdminList, useListRoute, useSearchPause} from "./use-admin-list";
import UserActionDialog from "./users/UserActionDialog.vue";
import type {UserAction} from "./users/UserActionDialog.vue";

const ROUTE_NAME = "admin-users";

type Field = "filter" | "q";
const SCHEMA: ListSchema<Field> = {filter: oneOf(USER_FILTERS, "all"), q: searchText(LOGIN_IDENTIFIER.maxLength)};

/** 表格的一行：账号那一条加上“…”那一列的键（它不对应任何字段）。 */
type UserRow = AdminUserItem & {readonly actions?: undefined};

const {api, clock, account} = useSite();
const admin = createAdminApi(api);
const t = useAdminText();

const listRoute = useListRoute(SCHEMA, ROUTE_NAME);
const state = listRoute.state;
const pager = listRoute.pager();
const page = pager.page;

const list = useAdminList<Field, UserRow, UserListResponse["counts"]>({
    schema: SCHEMA,
    state: () => state.value,
    fetch: (current, anchor) => {
        const filter = memberOf(USER_FILTERS, current.fields.filter, "all");
        return admin.listUsers({
            page: String(current.page),
            pageSize: String(ADMIN_PAGE_SIZE),
            ...(anchor === undefined ? {} : {anchor}),
            ...(current.fields.q === "" ? {} : {q: current.fields.q}),
            ...(filter === "all" ? {} : {filter}),
        });
    },
    onPastEnd: pager.pastEnd,
});

const numberFormat = computed(() => new Intl.NumberFormat(locale.value));

const filterOptions = computed(() =>
    USER_FILTERS.map((filter) => {
        const count = list.counts.value?.[filter];
        return {value: filter, label: t(`admin.users.filters.${filter}`), ...(count === undefined ? {} : {count: numberFormat.value.format(count)})};
    }),
);

function setFilter(value: SegmentedControlValue): void {
    if (state.value === undefined || typeof value !== "string" || value === state.value.fields.filter) return;
    void listRoute.go(withField(state.value, "filter", value), "push");
}

// 搜索框里的字与地址里的搜索词分开：打字时先只改框里的，停下 300 毫秒才写进地址（`replace`）。后退到别的搜索词时框跟着换。
const searchInput = shallowRef(state.value?.fields.q ?? "");
const pause = useSearchPause(clock, (value) => {
    const current = state.value;
    const term = searchTerm(value);
    if (current !== undefined && term !== current.fields.q) void listRoute.go(withField(current, "q", term), "replace");
});

watch(
    () => state.value?.fields.q,
    (q) => {
        if (q === undefined || searchTerm(searchInput.value) === q) return;
        pause.cancel();
        searchInput.value = q;
    },
);

function onSearchInput(value: string): void {
    searchInput.value = value;
    pause.schedule(value);
}

const myId = computed(() => (account.state.value.kind === "signed-in" ? account.state.value.me.id : undefined));

const columns = computed<TableColumn<UserRow>[]>(() => [
    {key: "id", label: t("admin.users.columns.id"), width: "64px", align: "right"},
    {key: "username", label: t("admin.users.columns.username")},
    {key: "displayName", label: t("admin.users.columns.displayName")},
    {key: "email", label: t("admin.users.columns.email")},
    {key: "banned", label: t("admin.users.columns.state"), width: "120px"},
    {key: "createdAt", label: t("admin.users.columns.createdAt"), width: "110px"},
    {key: "lastLoginAt", label: t("admin.users.columns.lastLoginAt"), width: "110px"},
    {key: "actions", label: "", width: "44px", align: "right"},
]);

/**
 * 最后登录：近的写相对说法（“刚刚”“3 小时前”“昨天”，与账号页同一个函数），更早的写表格的短日期（t09 定稿 r3 `users`）。
 * “现在”在表格每次重画时取注入的时钟，不另起计时：停在页面上略旧可以接受，翻页、重取时就新了。
 */
function lastLogin(iso: string): string {
    const now = clock.now();
    return recentTime(iso, now, locale.value, t("admin.users.justNow")) ?? shortDate(iso, now);
}

function menuItems(user: AdminUserItem): DropdownMenuItemData[] {
    const self = user.id === myId.value;
    // 对自己不能封禁、不能改角色（输出 5）；结束会话与重置密码不受此限。
    const selfLock = self ? {disabled: true, title: t("admin.users.selfForbidden")} : {};
    return [
        {id: "resetPassword", label: t("admin.users.actions.resetPassword.menu"), iconClass: "i-lucide-key-round"},
        user.banned
            ? {id: "unban", label: t("admin.users.actions.unban.menu"), iconClass: "i-lucide-circle-check"}
            : {id: "ban", label: t("admin.users.actions.ban.menu"), iconClass: "i-lucide-ban", tone: "danger", ...selfLock},
        user.role === "admin"
            ? {id: "revokeAdmin", label: t("admin.users.actions.revokeAdmin.menu"), iconClass: "i-lucide-shield-off", ...selfLock}
            : {id: "grantAdmin", label: t("admin.users.actions.grantAdmin.menu"), iconClass: "i-lucide-shield"},
        {id: "revokeSessions", label: t("admin.users.actions.revokeSessions.menu"), iconClass: "i-lucide-log-out", tone: "danger"},
    ];
}

const USER_ACTIONS: readonly UserAction[] = ["resetPassword", "ban", "unban", "grantAdmin", "revokeAdmin", "revokeSessions"];

/** 对话框开着没有，与对哪一行做哪一项：分开记，关掉的淡出期间标题与文字还在。 */
const dialogOpen = shallowRef(false);
const dialogUser = shallowRef<AdminUserItem>();
const dialogAction = shallowRef<UserAction>();

function onMenu(user: AdminUserItem, id: string): void {
    const action = USER_ACTIONS.find((candidate) => candidate === id);
    if (action === undefined) return;
    dialogUser.value = user;
    dialogAction.value = action;
    dialogOpen.value = true;
}

function rowActionsLabel(user: AdminUserItem): string {
    return t("admin.users.rowActions", {username: user.username});
}
</script>

<template>
    <AdminListFrame :title="t('admin.users.title')" :page="ROUTE_NAME">
        <DataTable
            v-model:page="page"
            :columns="columns"
            :rows="list.rows.value"
            row-key="id"
            :total="list.total.value"
            :page-size="ADMIN_PAGE_SIZE"
            :loading="list.loading.value"
            :error="list.error.value"
            :empty-text="t('admin.users.empty')"
            data-site-admin-list="users"
            @retry="list.reload()"
        >
            <template #filters>
                <SegmentedControl :model-value="state?.fields.filter ?? 'all'" :options="filterOptions" :aria-label="t('admin.users.filterLabel')" data-site-admin-filter @update:model-value="setFilter" />
            </template>
            <template #actions>
                <div class="admin-users__search">
                    <Input
                        :model-value="searchInput"
                        type="search"
                        size="sm"
                        icon-class="i-lucide-search"
                        :placeholder="t('admin.users.search')"
                        :aria-label="t('admin.users.searchLabel')"
                        :maxlength="LOGIN_IDENTIFIER.maxLength"
                        data-site-admin-search
                        @update:model-value="onSearchInput"
                        @keydown.enter="pause.enter"
                    />
                </div>
            </template>
            <template #cell-id="{row}"><span class="admin-num">{{ row.id }}</span></template>
            <template #cell-username="{row}">
                <span class="admin-users__name">{{ row.username }}<Badge v-if="row.role === 'admin'" tone="accent" variant="soft" size="sm">{{ t("admin.users.admin") }}</Badge></span>
            </template>
            <template #cell-email="{row}">
                <span v-if="row.email !== null">{{ row.email }}</span>
                <Badge v-else tone="warning" variant="soft" size="sm">{{ t("admin.users.emailPending") }}</Badge>
            </template>
            <template #cell-banned="{row}">
                <Badge v-if="row.banned" tone="danger" variant="soft" size="sm" dot>{{ t("admin.users.banned") }}</Badge>
                <span v-else class="admin-muted">{{ t("admin.users.normal") }}</span>
            </template>
            <template #cell-createdAt="{row}">
                <time class="admin-muted admin-num" :datetime="row.createdAt" :title="fullTime(row.createdAt, locale)">{{ shortDate(row.createdAt, clock.now()) }}</time>
            </template>
            <template #cell-lastLoginAt="{row}">
                <time v-if="row.lastLoginAt !== null" class="admin-muted admin-num" :datetime="row.lastLoginAt" :title="fullTime(row.lastLoginAt, locale)">{{ lastLogin(row.lastLoginAt) }}</time>
                <span v-else class="admin-muted">{{ t("admin.users.neverSignedIn") }}</span>
            </template>
            <template #cell-actions="{row}">
                <DropdownMenu :items="menuItems(row)" align="end" @select="onMenu(row, $event)">
                    <IconButton size="xs" icon-class="i-lucide-ellipsis" :title="rowActionsLabel(row)" :data-site-admin-row-menu="row.username" />
                </DropdownMenu>
            </template>
        </DataTable>
        <UserActionDialog v-model:open="dialogOpen" :user="dialogUser" :action="dialogAction" :api="admin" @done="list.reload()" @missing="list.reload()" />
    </AdminListFrame>
</template>

<style scoped>
.admin-users__search {
    width: 260px;
    max-width: 100%;
}

.admin-users__name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-main);
    font-weight: 600;
}
</style>
