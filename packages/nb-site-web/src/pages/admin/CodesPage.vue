<script setup lang="ts">
/**
 * 管理面板的注册码与邀请码页（t10 计划 3.13；`site.admin` 的 `registration-codes` 与 `invite-codes`；版式照 t09 定稿 r3 `codes`）：
 * 页名旁边的页签切两种码，页签上是两种码各自的总数，所以进页时两份列表各取第一页。注册码那一份有筛选项与右上角的“发放注册码”，
 * 每行的“…”里能停用；邀请码由用户自己生成、停用（`site.accounts` 输出 18），这里只看。
 *
 * 地址里是当前页签的状态（`?kind=invite&page=2`，注册码页签与它的筛选项不写 `kind`）；另一个页签的列表留在内存里，
 * 切回来时按地址再取。页签上的数：注册码取 `counts.all`（不随筛选变），邀请码没有筛选，取 `total`。
 */

import {REGISTRATION_CODE_FILTERS} from "@notnotype/nb-site-identity-contract/constants";
import type {AdminInviteCodeItem, RegistrationCodeItem, RegistrationCodeListResponse} from "@notnotype/nb-site-identity-contract/constants";
import {Button, CopyButton, DataTable, DropdownMenu, IconButton, SegmentedControl, Tabs} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData, SegmentedControlValue, TableColumn} from "@notnotype/nb-ui/components";
import {computed, shallowRef, watch} from "vue";

import {useSite} from "../../context";
import {createAdminApi} from "../../http/admin";
import {locale} from "../../locale";
import {useAdminText} from "./text";
import AdminConfirmDialog from "./AdminConfirmDialog.vue";
import AdminListFrame from "./AdminListFrame.vue";
import IssueCodeDialog from "./codes/IssueCodeDialog.vue";
import {fullTime, shortDate} from "./format";
import {memberOf, oneOf, withField} from "./list-query";
import type {ListSchema, ListState} from "./list-query";
import {ADMIN_PAGE_SIZE, useAdminList, useListRoute} from "./use-admin-list";

const ROUTE_NAME = "admin-codes";

const KINDS = ["registration", "invite"] as const;
type Kind = (typeof KINDS)[number];

type Field = "kind" | "filter";
const SCHEMA: ListSchema<Field> = {kind: oneOf(KINDS, "registration"), filter: oneOf(REGISTRATION_CODE_FILTERS, "all")};

/** 一种码列表的第一页、不筛：进页时另一个页签就取这一份。 */
const firstPage = (kind: Kind): ListState<Field> => ({page: 1, fields: {kind, filter: "all"}});

/** 表格的一行：码那一项加上“状态”“…”两列的键（不对应字段）。 */
type CodeRow = RegistrationCodeItem & {readonly state?: undefined; readonly actions?: undefined};
type InviteRow = AdminInviteCodeItem & {readonly state?: undefined};

const {api, clock} = useSite();
const admin = createAdminApi(api);
const t = useAdminText();

const listRoute = useListRoute(SCHEMA, ROUTE_NAME);
const state = listRoute.state;
const kind = computed<Kind>(() => memberOf(KINDS, state.value?.fields.kind ?? "registration", "registration"));

// 两份列表各自的状态：当前页签跟着地址，另一个留着上次的（进页时是第一页）。邀请码没有筛选项，地址里带了也不算。
const registrationState = shallowRef(firstPage("registration"));
const inviteState = shallowRef(firstPage("invite"));
watch(
    state,
    (current) => {
        if (current === undefined) return;
        if (current.fields.kind === "invite") inviteState.value = {page: current.page, fields: {kind: "invite", filter: "all"}};
        else registrationState.value = current;
    },
    {immediate: true},
);

// 每份列表只在自己的页签显示着时翻页、越界改页；不显示的那份留在内存里，不该改地址。
const registrationPager = listRoute.pager(() => (kind.value === "registration" ? registrationState.value : undefined));
const invitePager = listRoute.pager(() => (kind.value === "invite" ? inviteState.value : undefined));

const registrations = useAdminList<Field, CodeRow, RegistrationCodeListResponse["counts"]>({
    schema: SCHEMA,
    state: () => (state.value === undefined ? undefined : registrationState.value),
    fetch: (current, anchor) => {
        const filter = memberOf(REGISTRATION_CODE_FILTERS, current.fields.filter, "all");
        return admin.listRegistrationCodes({page: String(current.page), pageSize: String(ADMIN_PAGE_SIZE), ...(anchor === undefined ? {} : {anchor}), ...(filter === "all" ? {} : {filter})});
    },
    onPastEnd: registrationPager.pastEnd,
});

const invites = useAdminList<Field, InviteRow>({
    schema: SCHEMA,
    state: () => (state.value === undefined ? undefined : inviteState.value),
    fetch: (current, anchor) => admin.listInviteCodes({page: String(current.page), pageSize: String(ADMIN_PAGE_SIZE), ...(anchor === undefined ? {} : {anchor})}),
    onPastEnd: invitePager.pastEnd,
});

const numberFormat = computed(() => new Intl.NumberFormat(locale.value));
const formatCount = (count: number | null | undefined): string | undefined => (count === null || count === undefined ? undefined : numberFormat.value.format(count));

const tabs = computed(() =>
    KINDS.map((value) => {
        const count = formatCount(value === "registration" ? registrations.counts.value?.all : invites.total.value);
        return {value, label: t(`admin.codes.${value}`), ...(count === undefined ? {} : {count})};
    }),
);

function setKind(value: string): void {
    const next = KINDS.find((candidate) => candidate === value);
    if (next === undefined || next === kind.value) return;
    void listRoute.go(firstPage(next), "push");
}

const filterOptions = computed(() =>
    REGISTRATION_CODE_FILTERS.map((filter) => {
        const count = formatCount(registrations.counts.value?.[filter]);
        return {value: filter, label: t(`admin.codes.filters.${filter}`), ...(count === undefined ? {} : {count})};
    }),
);

function setFilter(value: SegmentedControlValue): void {
    if (typeof value !== "string" || value === registrationState.value.fields.filter) return;
    void listRoute.go(withField(registrationState.value, "filter", value), "push");
}

const registrationPage = registrationPager.page;
const invitePage = invitePager.page;

/** 一个码现在的样子。不能用的码按先停用、再用完、再过期的次序说原因（合同只给“还能不能用”，原因由字段推出）。 */
type CodeState = "usable" | "exhausted" | "expired" | "disabled";
function codeState(item: {readonly usable: boolean; readonly usedCount: number; readonly maxUses: number | null; readonly expiresAt: string | null; readonly disabled?: boolean}): CodeState {
    if (item.disabled === true) return "disabled";
    if (item.usable) return "usable";
    if (item.maxUses !== null && item.usedCount >= item.maxUses) return "exhausted";
    if (item.expiresAt !== null && Date.parse(item.expiresAt) <= clock.now()) return "expired";
    // 邀请码没有“已停用”这个字段：不能用、又没用完没过期的，就是主人停用了。注册码有这个字段、又没停用，
    // 那就是过期了，只是浏览器的时钟比服务端慢、看起来还没到。
    return item.disabled === undefined ? "disabled" : "expired";
}

function usage(item: {readonly usedCount: number; readonly maxUses: number | null}): string {
    return t("admin.codes.usedOf", {used: numberFormat.value.format(item.usedCount), max: item.maxUses === null ? t("admin.codes.unlimited") : numberFormat.value.format(item.maxUses)});
}

const registrationColumns = computed<TableColumn<CodeRow>[]>(() => [
    {key: "code", label: t("admin.codes.columns.code"), width: "230px"},
    {key: "note", label: t("admin.codes.columns.note"), wrap: true, width: "240px"},
    {key: "usedCount", label: t("admin.codes.columns.used"), width: "100px", align: "right"},
    {key: "expiresAt", label: t("admin.codes.columns.expiresAt"), width: "110px"},
    {key: "state", label: t("admin.codes.columns.state"), width: "100px"},
    {key: "createdAt", label: t("admin.codes.columns.createdAt"), width: "110px"},
    {key: "actions", label: "", width: "44px", align: "right"},
]);

const inviteColumns = computed<TableColumn<InviteRow>[]>(() => [
    {key: "code", label: t("admin.codes.inviteColumns.code"), width: "230px"},
    {key: "owner", label: t("admin.codes.inviteColumns.owner")},
    {key: "usedCount", label: t("admin.codes.inviteColumns.used"), width: "100px", align: "right"},
    {key: "expiresAt", label: t("admin.codes.inviteColumns.expiresAt"), width: "110px"},
    {key: "state", label: t("admin.codes.inviteColumns.state"), width: "100px"},
    {key: "createdAt", label: t("admin.codes.inviteColumns.createdAt"), width: "110px"},
]);

function menuItems(item: RegistrationCodeItem): DropdownMenuItemData[] {
    return [{id: "disable", label: t("admin.codes.disable.menu"), iconClass: "i-lucide-ban", tone: "danger", disabled: item.disabled}];
}

const issueOpen = shallowRef(false);

/** 发放成功：新码排在最前，回到第 1 页去看它；以当时为基准重取，带着旧基准的列表里没有它。 */
function afterIssue(): void {
    if (registrationPage.value === 1) {
        void registrations.reload({fresh: true});
        return;
    }
    registrations.forgetAnchor();
    registrationPage.value = 1;
}

const disableOpen = shallowRef(false);
const disabling = shallowRef<RegistrationCodeItem>();

function onMenu(item: RegistrationCodeItem, id: string): void {
    if (id !== "disable") return;
    disabling.value = item;
    disableOpen.value = true;
}

/** 停用当前要停用的那个码。对话框第一次要用时才画出来，之后一直留着（关掉的淡出期间标题还在）。 */
const disableRun = computed(() => {
    const item = disabling.value;
    return item === undefined ? undefined : () => admin.disableRegistrationCode(item.id);
});
</script>

<template>
    <AdminListFrame :title="t('admin.codes.title')" :page="ROUTE_NAME">
        <template #head>
            <Tabs :model-value="kind" :items="tabs" size="sm" :baseline="false" :aria-label="t('admin.codes.kinds')" data-site-admin-code-tabs @update:model-value="setKind" />
        </template>
        <DataTable
            v-if="kind === 'registration'"
            v-model:page="registrationPage"
            :columns="registrationColumns"
            :rows="registrations.rows.value"
            row-key="id"
            :total="registrations.total.value"
            :page-size="ADMIN_PAGE_SIZE"
            :loading="registrations.loading.value"
            :error="registrations.error.value"
            :empty-text="t('admin.codes.emptyRegistration')"
            data-site-admin-list="registration-codes"
            @retry="registrations.reload()"
        >
            <template #filters>
                <SegmentedControl :model-value="registrationState.fields.filter" :options="filterOptions" :aria-label="t('admin.codes.filterLabel')" data-site-admin-filter @update:model-value="setFilter" />
            </template>
            <template #actions>
                <Button variant="primary" size="sm" data-site-admin-issue @click="issueOpen = true">{{ t("admin.codes.issue.open") }}</Button>
            </template>
            <template #cell-code="{row}">
                <span class="admin-code">{{ row.code }}<CopyButton :text="row.code" :label="t('admin.codes.copy', {code: row.code})" icon-only /></span>
            </template>
            <template #cell-note="{row}">
                <span v-if="row.note !== null && row.note !== ''">{{ row.note }}</span>
                <span v-else class="admin-muted">{{ t("admin.codes.noNote") }}</span>
            </template>
            <template #cell-usedCount="{row}"><span class="admin-num">{{ usage(row) }}</span></template>
            <template #cell-expiresAt="{row}">
                <time v-if="row.expiresAt !== null" class="admin-muted admin-num" :datetime="row.expiresAt" :title="fullTime(row.expiresAt, locale)">{{ shortDate(row.expiresAt, clock.now()) }}</time>
                <span v-else class="admin-muted">{{ t("admin.codes.neverExpires") }}</span>
            </template>
            <template #cell-state="{row}">
                <span :class="codeState(row) === 'usable' ? undefined : 'admin-muted'" :data-site-admin-code-state="codeState(row)">{{ t(`admin.codes.states.${codeState(row)}`) }}</span>
            </template>
            <template #cell-createdAt="{row}">
                <time class="admin-muted admin-num" :datetime="row.createdAt" :title="fullTime(row.createdAt, locale)">{{ shortDate(row.createdAt, clock.now()) }}</time>
            </template>
            <template #cell-actions="{row}">
                <DropdownMenu :items="menuItems(row)" align="end" @select="onMenu(row, $event)">
                    <IconButton size="xs" icon-class="i-lucide-ellipsis" :title="t('admin.codes.rowActions', {code: row.code})" :data-site-admin-row-menu="row.code" />
                </DropdownMenu>
            </template>
        </DataTable>
        <DataTable
            v-else
            v-model:page="invitePage"
            :columns="inviteColumns"
            :rows="invites.rows.value"
            row-key="id"
            :total="invites.total.value"
            :page-size="ADMIN_PAGE_SIZE"
            :loading="invites.loading.value"
            :error="invites.error.value"
            :empty-text="t('admin.codes.emptyInvite')"
            data-site-admin-list="invite-codes"
            @retry="invites.reload()"
        >
            <template #cell-code="{row}">
                <span class="admin-code">{{ row.code }}<CopyButton :text="row.code" :label="t('admin.codes.copy', {code: row.code})" icon-only /></span>
            </template>
            <template #cell-owner="{row}">
                <span v-if="row.owner !== null">{{ row.owner.username }}</span>
                <span v-else class="admin-muted">{{ t("admin.codes.noOwner") }}</span>
            </template>
            <template #cell-usedCount="{row}"><span class="admin-num">{{ usage(row) }}</span></template>
            <template #cell-expiresAt="{row}">
                <time v-if="row.expiresAt !== null" class="admin-muted admin-num" :datetime="row.expiresAt" :title="fullTime(row.expiresAt, locale)">{{ shortDate(row.expiresAt, clock.now()) }}</time>
                <span v-else class="admin-muted">{{ t("admin.codes.neverExpires") }}</span>
            </template>
            <template #cell-state="{row}">
                <span :class="codeState(row) === 'usable' ? undefined : 'admin-muted'" :data-site-admin-code-state="codeState(row)">{{ t(`admin.codes.states.${codeState(row)}`) }}</span>
            </template>
            <template #cell-createdAt="{row}">
                <time class="admin-muted admin-num" :datetime="row.createdAt" :title="fullTime(row.createdAt, locale)">{{ shortDate(row.createdAt, clock.now()) }}</time>
            </template>
        </DataTable>
        <IssueCodeDialog v-model:open="issueOpen" :api="admin" @done="afterIssue" />
        <AdminConfirmDialog
            v-if="disableRun !== undefined"
            v-model:open="disableOpen"
            :title="t('admin.codes.disable.title', {code: disabling?.code ?? ''})"
            :description="t('admin.codes.disable.description')"
            :confirm-label="t('admin.codes.disable.confirm')"
            danger
            :run="disableRun"
            @done="registrations.reload()"
            @missing="registrations.reload()"
        />
    </AdminListFrame>
</template>
