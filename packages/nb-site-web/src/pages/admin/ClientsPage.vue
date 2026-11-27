<script setup lang="ts">
/**
 * 管理面板的 OAuth 客户端页（t10 计划 3.13；t09 第 12 条：照数据表格，不另出图；`site.oauth-provider` 输出 9、16）。列表用
 * `site.admin` 的分页参数，没有筛选与搜索，地址里只有页码。右上角“登记客户端”；每行“…”里是改动、停用或启用、换密钥（只有机密客户端有）。
 *
 * 登记之后丢掉基准重取（`reload({fresh: true})`）：带着旧基准的列表里没有基准之后登记的那一个。改动、停用、换密钥之后照常重取当前页。
 * 回调地址那一格只写第一个，多的写“等 N 个”，全部放进 `title`。
 */

import type {OAuthClientItem} from "@notnotype/nb-site-identity-contract/constants";
import {Badge, Button, CopyButton, DataTable, DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData, TableColumn} from "@notnotype/nb-ui/components";
import {computed, shallowRef} from "vue";

import {useSite} from "../../context";
import {createAdminApi} from "../../http/admin";
import {locale} from "../../locale";
import {useAdminText} from "./text";
import AdminConfirmDialog from "./AdminConfirmDialog.vue";
import AdminListFrame from "./AdminListFrame.vue";
import ClientDialog from "./clients/ClientDialog.vue";
import RotateSecretDialog from "./clients/RotateSecretDialog.vue";
import {fullTime, shortDate} from "./format";
import type {ListSchema} from "./list-query";
import {ADMIN_PAGE_SIZE, useAdminList, useListRoute} from "./use-admin-list";

const ROUTE_NAME = "admin-clients";

/** 没有筛选与搜索：地址里只有页码。 */
const SCHEMA: ListSchema<never> = {};

/** 表格的一行：客户端那一项加上“状态”“…”两列的键（不对应字段）。 */
type ClientRow = OAuthClientItem & {readonly state?: undefined; readonly actions?: undefined};

const {api, clock} = useSite();
const admin = createAdminApi(api);
const t = useAdminText();

const listRoute = useListRoute(SCHEMA, ROUTE_NAME);
const state = listRoute.state;
const pager = listRoute.pager();
const page = pager.page;

const list = useAdminList<never, ClientRow>({
    schema: SCHEMA,
    state: () => state.value,
    fetch: (current, anchor) => admin.listOAuthClients({page: String(current.page), pageSize: String(ADMIN_PAGE_SIZE), ...(anchor === undefined ? {} : {anchor})}),
    onPastEnd: pager.pastEnd,
});

const columns = computed<TableColumn<ClientRow>[]>(() => [
    {key: "name", label: t("admin.clients.columns.name")},
    {key: "clientId", label: t("admin.clients.columns.clientId"), width: "300px"},
    {key: "type", label: t("admin.clients.columns.type"), width: "80px"},
    {key: "redirectUris", label: t("admin.clients.columns.redirectUris"), width: "280px"},
    {key: "skipConsent", label: t("admin.clients.columns.skipConsent"), width: "90px"},
    {key: "state", label: t("admin.clients.columns.state"), width: "100px"},
    {key: "createdAt", label: t("admin.clients.columns.createdAt"), width: "110px"},
    {key: "actions", label: "", width: "44px", align: "right"},
]);

function menuItems(client: OAuthClientItem): DropdownMenuItemData[] {
    return [
        {id: "edit", label: t("admin.clients.edit.menu"), iconClass: "i-lucide-pencil"},
        ...(client.type === "confidential" ? [{id: "rotate", label: t("admin.clients.rotate.menu"), iconClass: "i-lucide-key-round"}] : []),
        client.disabled
            ? {id: "enable", label: t("admin.clients.enable.menu"), iconClass: "i-lucide-circle-check"}
            : {id: "disable", label: t("admin.clients.disable.menu"), iconClass: "i-lucide-ban", tone: "danger"},
    ];
}

// ---- 对话框：开着没有与对哪一个，分开记（关掉的淡出期间标题还在） ----

const clientOpen = shallowRef(false);
/** 改动的那一个；登记时是 `undefined`。 */
const clientTarget = shallowRef<OAuthClientItem>();

const rotateOpen = shallowRef(false);
const rotateTarget = shallowRef<OAuthClientItem>();

const toggleOpen = shallowRef(false);
const toggleTarget = shallowRef<OAuthClientItem>();

function openRegister(): void {
    clientTarget.value = undefined;
    clientOpen.value = true;
}

function onMenu(client: OAuthClientItem, id: string): void {
    switch (id) {
        case "edit":
            clientTarget.value = client;
            clientOpen.value = true;
            return;
        case "rotate":
            rotateTarget.value = client;
            rotateOpen.value = true;
            return;
        case "disable":
        case "enable":
            toggleTarget.value = client;
            toggleOpen.value = true;
            return;
    }
}

function onClientDone(kind: "created" | "updated"): void {
    void list.reload(kind === "created" ? {fresh: true} : undefined);
}

/** 停用或启用确认框的文字，按打开时那一个现在的状态取。 */
const toggleAction = computed(() => (toggleTarget.value?.disabled === true ? "enable" : "disable"));
const toggleRun = computed(() => {
    const client = toggleTarget.value;
    return client === undefined ? undefined : () => admin.patchOAuthClient(client.clientId, {disabled: !client.disabled});
});

function moreUris(client: OAuthClientItem): string | undefined {
    const rest = client.redirectUris.length - 1;
    return rest > 0 ? t("admin.clients.moreUris", {count: rest}) : undefined;
}
</script>

<template>
    <AdminListFrame :title="t('admin.clients.title')" :page="ROUTE_NAME">
        <DataTable
            v-model:page="page"
            :columns="columns"
            :rows="list.rows.value"
            row-key="id"
            :total="list.total.value"
            :page-size="ADMIN_PAGE_SIZE"
            :loading="list.loading.value"
            :error="list.error.value"
            :empty-text="t('admin.clients.empty')"
            data-site-admin-list="oauth-clients"
            @retry="list.reload()"
        >
            <template #actions>
                <Button variant="primary" size="sm" data-site-admin-client-register @click="openRegister">{{ t("admin.clients.register.open") }}</Button>
            </template>
            <template #cell-name="{row}">
                <span class="admin-clients__name" :data-site-admin-client-row="row.clientId">{{ row.name }}</span>
            </template>
            <template #cell-clientId="{row}">
                <span class="admin-code">{{ row.clientId }}<CopyButton :text="row.clientId" :label="t('admin.clients.copyId', {clientId: row.clientId})" icon-only /></span>
            </template>
            <template #cell-type="{row}">
                <span :data-site-admin-client-type-cell="row.type">{{ t(`admin.clients.types.${row.type}`) }}</span>
            </template>
            <template #cell-redirectUris="{row}">
                <span class="admin-clients__uris" :title="row.redirectUris.join('\n')" data-site-admin-client-uris>
                    <span class="admin-clients__uri">{{ row.redirectUris[0] }}</span>
                    <span v-if="moreUris(row) !== undefined" class="admin-muted admin-clients__more">{{ moreUris(row) }}</span>
                </span>
            </template>
            <template #cell-skipConsent="{row}">
                <span :class="row.skipConsent ? undefined : 'admin-muted'" :data-site-admin-client-skip="row.skipConsent ? 'true' : 'false'">{{ row.skipConsent ? t("admin.clients.skipConsentYes") : t("admin.clients.skipConsentNo") }}</span>
            </template>
            <template #cell-state="{row}">
                <Badge v-if="row.disabled" tone="neutral" variant="soft" size="sm" :data-site-admin-client-state="'disabled'">{{ t("admin.clients.states.disabled") }}</Badge>
                <span v-else :data-site-admin-client-state="'enabled'">{{ t("admin.clients.states.enabled") }}</span>
            </template>
            <template #cell-createdAt="{row}">
                <time class="admin-muted admin-num" :datetime="row.createdAt" :title="fullTime(row.createdAt, locale)">{{ shortDate(row.createdAt, clock.now()) }}</time>
            </template>
            <template #cell-actions="{row}">
                <DropdownMenu :items="menuItems(row)" align="end" @select="onMenu(row, $event)">
                    <IconButton size="xs" icon-class="i-lucide-ellipsis" :title="t('admin.clients.rowActions', {name: row.name})" :data-site-admin-row-menu="row.clientId" />
                </DropdownMenu>
            </template>
        </DataTable>
        <ClientDialog v-model:open="clientOpen" :api="admin" :client="clientTarget" @done="onClientDone" @missing="list.reload()" />
        <RotateSecretDialog v-model:open="rotateOpen" :api="admin" :client="rotateTarget" @missing="list.reload()" />
        <AdminConfirmDialog
            v-if="toggleRun !== undefined"
            v-model:open="toggleOpen"
            :title="t(`admin.clients.${toggleAction}.title`, {name: toggleTarget?.name ?? ''})"
            :description="t(`admin.clients.${toggleAction}.description`)"
            :confirm-label="t(`admin.clients.${toggleAction}.confirm`)"
            :danger="toggleAction === 'disable'"
            :run="toggleRun"
            @done="list.reload()"
            @missing="list.reload()"
        />
    </AdminListFrame>
</template>

<style scoped>
.admin-clients__name {
    color: var(--text-main);
    font-weight: 600;
}

.admin-clients__uris {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    max-width: 100%;
    min-width: 0;
}

.admin-clients__uri {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.admin-clients__more {
    flex: none;
    font-size: var(--text-xs);
}
</style>
