<script setup lang="ts">
/**
 * 管理面板的审计页（t10 计划 3.13；`site.admin` 的 `GET audit` 与输出 8；t09 第 12 条的数据表格，没有单独的图）：工具条左边按操作者、
 * 对象、动作筛。操作者写数字 id 或 `cli`（命令行），对象是种类加可选的 id（只给 id 合同回 `validation_failed`，所以没选种类时
 * id 那一格不可用），动作从合同的动作名里选，文案按动作名取（`tests/catalog.test.ts` 保证每个动作都有文案）。
 *
 * 筛选放在地址里（`?actorId=7&targetType=user&targetId=12&action=user.ban&page=2`）。两个要打字的格子与用户页的搜索一样，停 300 毫秒
 * 才写进地址；写得不合规则时格子标红、不取，状态行不另写（格子的读屏名字里就是规则）。
 */

import {AUDIT_ACTIONS, AUDIT_CLI_ACTOR, AUDIT_TARGET_TYPES, DECIMAL_ID_PATTERN} from "@notnotype/nb-site-identity-contract/constants";
import type {AuditAction, AuditItem} from "@notnotype/nb-site-identity-contract/constants";
import {DataTable, Input, Select} from "@notnotype/nb-ui/components";
import type {SelectOption, TableColumn} from "@notnotype/nb-ui/components";
import {computed, shallowRef, watch} from "vue";

import {useSite} from "../../context";
import {createAdminApi} from "../../http/admin";
import {locale} from "../../locale";
import {useSiteText} from "../../text";
import AdminListFrame from "./AdminListFrame.vue";
import {fullTime} from "./format";
import {matching, memberOf, oneOf, withField} from "./list-query";
import type {ListSchema} from "./list-query";
import {ADMIN_PAGE_SIZE, useAdminList, useListRoute, useSearchPause} from "./use-admin-list";

const ROUTE_NAME = "admin-audit";

/** 不筛这一项。Select 的选项不能用空串当值（reka），所以“全部”另有一个值，写地址时它是缺省、不写。 */
const ALL = "all";

const ID_PATTERN = new RegExp(DECIMAL_ID_PATTERN, "u");
const ACTOR_PATTERN = new RegExp(`^(?:${AUDIT_CLI_ACTOR}|${DECIMAL_ID_PATTERN.slice(1, -1)})$`, "u");

type Field = "actorId" | "targetType" | "targetId" | "action";
const SCHEMA: ListSchema<Field> = {
    actorId: matching(ACTOR_PATTERN),
    targetType: oneOf([ALL, ...AUDIT_TARGET_TYPES], ALL),
    targetId: matching(ID_PATTERN),
    action: oneOf([ALL, ...AUDIT_ACTIONS], ALL),
};

const {api, clock} = useSite();
const admin = createAdminApi(api);
const t = useSiteText();

const listRoute = useListRoute(SCHEMA, ROUTE_NAME);
const state = listRoute.state;

const list = useAdminList<Field, AuditItem>({
    schema: SCHEMA,
    state: () => state.value,
    fetch: (current, anchor) => {
        const {actorId, targetId} = current.fields;
        const targetType = memberOf([ALL, ...AUDIT_TARGET_TYPES], current.fields.targetType, ALL);
        const action = memberOf([ALL, ...AUDIT_ACTIONS], current.fields.action, ALL);
        return admin.listAudit({
            page: String(current.page),
            pageSize: String(ADMIN_PAGE_SIZE),
            ...(anchor === undefined ? {} : {anchor}),
            ...(actorId === "" ? {} : {actorId}),
            // 只给 id 不给种类，合同回 `validation_failed`：没选种类时地址里的 id 不发。
            ...(targetType === ALL ? {} : {targetType, ...(targetId === "" ? {} : {targetId})}),
            ...(action === ALL ? {} : {action}),
        });
    },
    onPastEnd: (page) => {
        if (state.value !== undefined) listRoute.go({...state.value, page}, "replace");
    },
});

const page = computed({
    get: () => state.value?.page ?? 1,
    set: (value: number) => {
        if (state.value !== undefined) listRoute.go({...state.value, page: value}, "push");
    },
});

/** 一个要打字的筛选格：框里的字、合不合规则，停下后合规则才写进地址；后退到别的值时框跟着换。 */
function typedFilter(field: "actorId" | "targetId", pattern: RegExp) {
    const input = shallowRef(state.value?.fields[field] ?? "");
    const valid = computed(() => input.value.trim() === "" || pattern.test(input.value.trim()));
    const pause = useSearchPause(clock, (value) => {
        const current = state.value;
        const term = value.trim();
        if (current === undefined || term === current.fields[field] || !(term === "" || pattern.test(term))) return;
        listRoute.go(withField(current, field, term), "replace");
    });
    watch(
        () => state.value?.fields[field],
        (value) => {
            if (value === undefined || input.value.trim() === value) return;
            pause.cancel();
            input.value = value;
        },
    );
    return {
        input,
        valid,
        pause,
        onInput(value: string) {
            input.value = value;
            pause.schedule(value);
        },
    };
}

const actor = typedFilter("actorId", ACTOR_PATTERN);
const targetIdFilter = typedFilter("targetId", ID_PATTERN);

const targetType = computed(() => state.value?.fields.targetType ?? ALL);
const action = computed(() => state.value?.fields.action ?? ALL);

const targetOptions = computed<SelectOption[]>(() => [{value: ALL, label: t("admin.audit.allTargets")}, ...AUDIT_TARGET_TYPES.map((type) => ({value: type, label: t(`admin.audit.targets.${type}`)}))]);
const actionOptions = computed<SelectOption[]>(() => [{value: ALL, label: t("admin.audit.allActions")}, ...AUDIT_ACTIONS.map((name) => ({value: name, label: actionLabel(name)}))]);

function setSelect(field: "targetType" | "action", value: string): void {
    const current = state.value;
    if (current === undefined || value === current.fields[field]) return;
    let next = withField(current, field, value);
    // 不选种类时对象 id 没有意义（也发不出去）：一起清掉，框里的字跟着清。
    if (field === "targetType" && value === ALL) next = withField(next, "targetId", "");
    listRoute.go(next, "push");
}

function actionLabel(name: AuditAction): string {
    return t(`admin.audit.actions.${name}`);
}

const columns = computed<TableColumn<AuditItem>[]>(() => [
    {key: "createdAt", label: t("admin.audit.columns.createdAt"), width: "160px"},
    {key: "actor", label: t("admin.audit.columns.actor"), width: "140px"},
    {key: "action", label: t("admin.audit.columns.action"), width: "180px"},
    {key: "target", label: t("admin.audit.columns.target"), width: "160px"},
    {key: "params", label: t("admin.audit.columns.params"), wrap: true},
]);

/** 动作的参数（输出 8）按“名：值”逐项写，名是合同里的键，不翻译：参数随动作追加，页面不认识的也照样显示。 */
function paramsText(params: AuditItem["params"]): string {
    const entries = Object.entries(params);
    if (entries.length === 0) return t("admin.audit.noParams");
    return entries.map(([name, value]) => t("admin.audit.param", {name, value: String(value)})).join(t("admin.audit.paramsSeparator"));
}
</script>

<template>
    <AdminListFrame :title="t('admin.audit.title')" :page="ROUTE_NAME">
        <DataTable
            v-model:page="page"
            :columns="columns"
            :rows="list.rows.value"
            row-key="id"
            :total="list.total.value"
            :page-size="ADMIN_PAGE_SIZE"
            :loading="list.loading.value"
            :error="list.error.value"
            :empty-text="t('admin.audit.empty')"
            data-site-admin-list="audit"
            @retry="list.reload()"
        >
            <template #filters>
                <div class="admin-audit__filters">
                    <div class="admin-audit__actor">
                        <Input
                            :model-value="actor.input.value"
                            size="sm"
                            icon-class="i-lucide-user"
                            :placeholder="t('admin.audit.actorPlaceholder')"
                            :aria-label="t('admin.audit.actor')"
                            :aria-description="actor.valid.value ? undefined : t('admin.audit.actorRule')"
                            :invalid="!actor.valid.value"
                            :title="actor.valid.value ? undefined : t('admin.audit.actorRule')"
                            data-site-admin-audit-actor
                            @update:model-value="actor.onInput"
                            @keydown.enter="actor.pause.flush()"
                        />
                    </div>
                    <div class="admin-audit__target">
                        <div class="admin-audit__target-type">
                            <Select :model-value="targetType" :options="targetOptions" size="sm" class="w-full" :aria-label="t('admin.audit.target')" data-site-admin-audit-target-type @update:model-value="setSelect('targetType', $event)" />
                        </div>
                        <div class="admin-audit__target-id">
                            <Input
                                :model-value="targetIdFilter.input.value"
                                size="sm"
                                inputmode="numeric"
                                :placeholder="t('admin.audit.targetId')"
                                :aria-label="t('admin.audit.targetId')"
                                :aria-description="targetIdFilter.valid.value ? undefined : t('admin.audit.targetIdRule')"
                                :invalid="!targetIdFilter.valid.value"
                                :disabled="targetType === ALL"
                                data-site-admin-audit-target-id
                                @update:model-value="targetIdFilter.onInput"
                                @keydown.enter="targetIdFilter.pause.flush()"
                            />
                        </div>
                    </div>
                    <div class="admin-audit__action">
                        <Select :model-value="action" :options="actionOptions" size="sm" class="w-full" :aria-label="t('admin.audit.action')" data-site-admin-audit-action @update:model-value="setSelect('action', $event)" />
                    </div>
                </div>
            </template>
            <template #cell-createdAt="{row}">
                <time class="admin-muted admin-num" :datetime="row.createdAt">{{ fullTime(row.createdAt, locale) }}</time>
            </template>
            <template #cell-actor="{row}">
                <span v-if="row.actor !== null" :title="`#${row.actor.id}`">{{ row.actor.username }}</span>
                <span v-else class="admin-muted">{{ t("admin.audit.cli") }}</span>
            </template>
            <template #cell-action="{row}"><span :data-site-admin-audit-action-of="row.action">{{ actionLabel(row.action) }}</span></template>
            <template #cell-target="{row}">
                <span class="admin-num">{{ t("admin.audit.targetRef", {type: t(`admin.audit.targets.${row.target.type}`), id: row.target.id}) }}</span>
            </template>
            <template #cell-params="{row}"><span class="admin-audit__params">{{ paramsText(row.params) }}</span></template>
        </DataTable>
    </AdminListFrame>
</template>

<style scoped>
.admin-audit__filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.admin-audit__actor {
    width: 160px;
}

.admin-audit__target {
    display: flex;
    align-items: center;
    gap: 4px;
}

.admin-audit__target-type {
    width: 140px;
}

.admin-audit__target-id {
    width: 96px;
}

.admin-audit__action {
    width: 200px;
}

.admin-audit__params {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

.admin-muted {
    color: var(--text-secondary);
}

.admin-num {
    font-variant-numeric: tabular-nums;
}
</style>
