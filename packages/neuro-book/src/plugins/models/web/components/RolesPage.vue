<script setup lang="ts">
import {referenceOf} from "@notnotype/nb-models/config";
import type {RoleConfig} from "@notnotype/nb-models/config";
import type {ModelRow, SnapshotRole} from "@notnotype/nb-models/contract";
import {Badge, Button, DropdownMenu, IconButton, Input, SearchSelect, Select, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {ROLE_ICON_KEYS, ROLE_ICONS, roleIconClass} from "nbook/ui/role-icons";

import {requestEffort} from "nbook/plugins/models/shared/contracts";

import type {ModelsFailure, ModelsStore} from "../models-store";
import {failureReason, roleDescription, roleName, useModelsText} from "../text";

/**
 * “模型角色”页（docs/specs/models/settings-pages.md 输出 13 到 17）：梯度与专精两组角色，每行选一个模型（立即写）；未绑定的
 * 标红，绑定的模型不可用时写原因。自建的专精角色可以改名、改说明、删除。
 */
const props = withDefaults(defineProps<{
    store: ModelsStore;
    /** 当前标签那一层能不能写（页面上下文的 `writable`）。 */
    writable: boolean;
    /** 写失败交给窗口通知（页面上下文的 `reportWriteFailure`）。 */
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
    /** 打开设置时要定位到的东西（页面上下文的 `focus`，settings-pages.md 输出 18）；数据到了再经 `takeFocus` 取走。 */
    focus?: string | null;
    /** 取走 `focus` 并清空（页面上下文的 `takeFocus`）。写成函数类型：写成 `SettingsPageContext["takeFocus"]` 时，Vue 编译器按方法的返回值生成运行时校验（String | Null），开发模式下传函数会报类型不符。 */
    takeFocus?: () => string | null;
}>(), {focus: null, takeFocus: () => null});

const text = useModelsText();
const snapshot = props.store.snapshot;
const disabled = computed(() => !props.store.available.value || !props.writable);

onMounted(() => void props.store.start());

const selection = props.store.selection;
/** 选用数据换了（行读完、引用取到）：下面的计算属性随之重算。 */
const version = ref(0);
const stopSelection = selection.subscribe(() => {
    version.value += 1;
});
onBeforeUnmount(stopSelection);

/** 可选的模型：启用、可用（不缺字段、不在目录漂移里）的；没有密钥的照样列出，角色状态会写明。 */
const available = computed(() => {
    void version.value;
    const names = new Map((snapshot.value?.providers ?? []).map((provider) => [provider.id, provider.name] as const));
    return selection.rows.value.filter((row) => row.status === "ok").map((row) => ({value: referenceOf(row.provider, row.id), label: row.name, description: names.get(row.provider) ?? row.provider}));
});

/** 绑定下拉的搜索：本地过滤，最多给 100 项（几百个模型的服务商不能整份塞进下拉）。 */
const MENU_LIMIT = 100;
const searching = ref("");
const filtered = computed(() => {
    const needle = searching.value.trim().toLowerCase();
    const list = needle === "" ? available.value : available.value.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle) || option.description.toLowerCase().includes(needle));
    return list.slice(0, MENU_LIMIT);
});

/** 一行的选项：绑着的模型不在这一批里（被搜索截掉、停用了、不可用）时补一个项，下拉仍显示绑的是谁。 */
function optionsFor(role: SnapshotRole) {
    const base = [{value: "", label: text("roles.none")}, ...filtered.value];
    if (role.model === null || base.some((option) => option.value === role.model)) return base;
    const known = modelsByRef.value.get(role.model);
    const usable = known !== undefined && known !== null && known.enabled && known.status === "ok";
    return [...base, {value: role.model, label: known?.name ?? role.model, ...(usable ? {} : {description: text("roles.unavailable"), disabled: true})}];
}

/** 绑定的模型（含没启用的）：名字与角色的思考档选项取自按引用取到的行。 */
const modelsByRef = computed(() => {
    void version.value;
    return selection.lookup.value;
});
// 要名字的引用：每个角色绑着的。
watch(() => snapshot.value?.roles, (list) => selection.want((list ?? []).flatMap((role) => (role.model === null ? [] : [role.model]))), {immediate: true});

const LEVEL_LABELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const levelLabel = (level: string): string => ((LEVEL_LABELS as readonly string[]).includes(level) ? text(`roles.effort.levels.${level as (typeof LEVEL_LABELS)[number]}`) : level);

type RoleEffort = NonNullable<RoleConfig["effort"]>;
/** “跟随模型”这一项的值：下拉的选项值不能是空串（空串是“没选”，显示占位）。 */
const FOLLOW = "__follow__";
type EffortControl = {options: {value: string; label: string; description?: string; disabled?: boolean}[]; value: string; disabled: boolean; placeholder: string; clearable: boolean};

/**
 * 一行的思考档控件：选项来自绑定模型的推理能力，第一项“跟随模型”；没绑定、不推理、不能调档时停用并把原因写在框里（已存的档位
 * 仍显示、可清除）；档位不在新模型的选项里（改绑模型后）时补一个停用的项说明实际用哪一档。
 */
function effortControl(role: SnapshotRole): EffortControl {
    const stored = role.effort ?? "";
    const follow = {value: FOLLOW, label: text("roles.effort.follow")};
    const model: ModelRow | undefined = role.model === null ? undefined : modelsByRef.value.get(role.model) ?? undefined;
    const reasoning = model?.thinking;
    const reason = role.model === null ? text("roles.effort.unbound") : model === undefined ? text("roles.unavailable") : reasoning?.kind === "none" ? text("roles.effort.none") : reasoning?.kind === "fixed" ? text("roles.effort.fixed") : "";
    if (reasoning === undefined || reasoning.kind !== "levels") return {options: [follow], value: "", disabled: true, placeholder: stored === "" ? reason : text("roles.effort.storedWhy", {level: levelLabel(stored), reason}), clearable: stored !== ""};
    const keys = [...(reasoning.off === "disable" ? ["off"] : []), ...reasoning.levels];
    const options: EffortControl["options"] = [follow, ...keys.map((key) => ({value: key, label: levelLabel(key), ...(reasoning.verified ? {} : {description: text("roles.effort.unverified")})}))];
    if (stored !== "" && !keys.includes(stored)) {
        const actual = requestEffort(null, {info: {id: "", contextWindow: 0, capabilities: {vision: false, thinking: true}, efforts: reasoning.levels, reasoning}, defaultEffort: stored}).effective;
        options.push({value: stored, label: levelLabel(stored), description: text("roles.effort.notOffered", {actual: actual === null ? "—" : levelLabel(actual)}), disabled: true});
    }
    return {options, value: stored === "" ? FOLLOW : stored, disabled: false, placeholder: "", clearable: false};
}

/** 每行的思考档控件：随快照算一次，模板里按角色取（一行要读五项）。 */
const efforts = computed(() => new Map((snapshot.value?.roles ?? []).map((role) => [role.id, effortControl(role)] as const)));

async function setEffort(role: SnapshotRole, value: string): Promise<void> {
    const next = value === FOLLOW || value === "" ? null : value;
    if (next === (role.effort ?? null)) return;
    // 选项来自模型自己的档位，个别模型有合同枚举之外的档名：服务端的校验会拒收，失败走窗口通知。
    const result = await props.store.call("setRole", {id: role.id, effort: next as RoleEffort | null});
    if (!result.ok) report(role, result.failure);
}

async function setIcon(role: SnapshotRole, key: string): Promise<void> {
    const result = await props.store.call("setRole", {id: role.id, icon: key});
    if (!result.ok) report(role, result.failure);
}
/** 图标菜单：名字取自语言目录（`roles.icons.<键>`），当前的画勾（radio）。 */
function iconItemsFor(role: SnapshotRole) {
    const current = role.icon ?? null;
    return ROLE_ICON_KEYS.map((key) => ({id: key, type: "radio" as const, group: "icon", label: text(`roles.icons.${key}`), iconClass: ROLE_ICONS[key], checked: current === key}));
}

const groups = computed(() => [
    {axis: "gradient" as const, title: text("roles.gradient"), help: text("roles.gradientHelp")},
    {axis: "specialist" as const, title: text("roles.specialist"), help: text("roles.specialistHelp")},
].map((group) => ({...group, roles: (snapshot.value?.roles ?? []).filter((role) => role.axis === group.axis)})));

function report(role: SnapshotRole, failure: ModelsFailure): void {
    props.reportWriteFailure(text("subject.role", {name: roleName(text, role)}), {reason: failureReason(text, failure), uncertain: failure.code === "unknown-outcome"});
}

async function bind(role: SnapshotRole, model: string): Promise<void> {
    const next = model === "" ? null : model;
    if (next === role.model) return;
    const result = await props.store.call("setRole", {id: role.id, model: next});
    if (!result.ok) report(role, result.failure);
}

// ---- 自建角色的名字与说明：草稿，失焦或回车时写 ----
/**
 * 按角色增量更新：快照来了只换没在编辑的角色的草稿（输出 16），正在编辑的那个失焦后再以快照为准。`lastSent` 是最近一次交出去、
 * 还没在快照里回来的值，回车之后紧接着失焦不重复交。
 */
const drafts = ref(new Map<string, {name: string; description: string}>());
let editing: string | null = null;
const lastSent = new Map<string, string>();
function syncDrafts(): void {
    const roles = (snapshot.value?.roles ?? []).filter((role) => !role.builtin);
    const next = new Map(roles.map((role) => [role.id, role.id === editing ? drafts.value.get(role.id) ?? {name: role.name, description: role.description} : {name: role.name, description: role.description}]));
    for (const role of roles) if (lastSent.get(role.id) === `${role.name}\n${role.description}`) lastSent.delete(role.id);
    drafts.value = next;
}
watch(() => snapshot.value?.roles, syncDrafts, {immediate: true});

function startEditing(role: SnapshotRole): void {
    editing = role.id;
}

async function finishEditing(role: SnapshotRole): Promise<void> {
    await rename(role);
    if (editing === role.id) editing = null;
    syncDrafts();
}

async function rename(role: SnapshotRole): Promise<void> {
    const draft = drafts.value.get(role.id);
    if (draft === undefined) return;
    const name = draft.name.trim();
    if (name === "") {
        draft.name = role.name;
        return;
    }
    if (name === role.name && draft.description === role.description) return;
    const sent = `${name}\n${draft.description}`;
    if (lastSent.get(role.id) === sent) return;
    lastSent.set(role.id, sent);
    const result = await props.store.call("updateRole", {id: role.id, name, description: draft.description});
    if (!result.ok) lastSent.delete(role.id);
    if (result.ok) return;
    report(role, result.failure);
    // 写失败：草稿回到实际值（快照没变，上面的 watch 不会触发）。
    Object.assign(draft, {name: role.name, description: role.description});
}

const page = ref<HTMLElement | null>(null);

/**
 * 打开时定位到一个角色（settings-pages.md 输出 18，对话的“去绑定”用）：角色列表到了再取走，滚到那一行、聚焦它的模型选择框。
 * 不认识的角色 id 取走后忽略。
 */
watch([() => props.focus, () => snapshot.value?.roles], async ([focus, list]) => {
    if (focus === null || list === undefined) return;
    const id = props.takeFocus();
    if (id === null || !list.some((role) => role.id === id)) return;
    await nextTick();
    const row = [...(page.value?.querySelectorAll<HTMLElement>("[data-role-row]") ?? [])].find((element) => element.dataset.roleRow === id);
    row?.scrollIntoView({block: "nearest"});
    row?.querySelector<HTMLElement>("[data-role-model] button, [data-role-model] input")?.focus({preventScroll: true});
}, {immediate: true});

async function addRole(): Promise<void> {
    const result = await props.store.call("addRole", {name: text("roles.newName"), description: ""});
    if (!result.ok) {
        props.reportWriteFailure(text("subject.role", {name: text("roles.newName")}), {reason: failureReason(text, result.failure), uncertain: result.failure.code === "unknown-outcome"});
        return;
    }
    // 新角色经快照回来：等它出现后聚焦它的名字框并全选，接着就能改名。
    const id = result.value.id;
    if (!(snapshot.value?.roles ?? []).some((role) => role.id === id)) {
        await new Promise<void>((resolve) => {
            const stop = watch(() => snapshot.value?.roles, (roles) => {
                if (!(roles ?? []).some((role) => role.id === id)) return;
                stop();
                resolve();
            });
        });
    }
    await nextTick();
    const input = page.value?.querySelector<HTMLInputElement>(`[data-role-row="${CSS.escape(id)}"] input`);
    input?.focus();
    input?.select();
}

async function removeRole(role: SnapshotRole): Promise<void> {
    const result = await props.store.call("removeRole", {id: role.id});
    if (!result.ok) report(role, result.failure);
}

function problem(role: SnapshotRole): string {
    if (role.status === "unknown-model") return text("roles.status.unknown-model", {model: role.model ?? ""});
    if (role.status === "no-credentials") return text("roles.status.no-credentials", {model: role.model ?? ""});
    return "";
}
</script>

<template>
    <div ref="page" class="roles-page" data-models-roles-page>
        <p v-if="!store.available.value" class="roles-page__notice" role="status">{{ text("readOnly") }}</p>
        <p class="roles-page__intro">{{ text("roles.intro") }}</p>
        <p v-if="snapshot === null && store.available.value" class="roles-page__notice">{{ text("connection.key.loading") }}</p>
        <template v-else>
            <section v-for="group in groups" :key="group.axis" class="roles-page__group">
                <div class="roles-page__title">
                    <h3>{{ group.title }}</h3>
                    <span class="roles-page__muted">{{ group.help }}</span>
                </div>
                <ul class="roles-page__rows">
                    <li v-for="role in group.roles" :key="role.id" class="roles-page__row" :data-role-row="role.id">
                        <div class="roles-page__label">
                            <template v-if="role.builtin">
                                <span class="roles-page__name">
                                    <span :class="roleIconClass(role.id, role.icon)" class="roles-page__icon" aria-hidden="true" />
                                    {{ roleName(text, role) }}
                                    <Badge v-if="role.status === 'unbound'" size="sm" variant="soft" tone="danger" data-role-unbound>{{ text("roles.unbound") }}</Badge>
                                </span>
                                <span class="roles-page__muted">{{ roleDescription(text, role) }}</span>
                            </template>
                            <template v-else-if="drafts.get(role.id) !== undefined">
                                <span class="roles-page__name">
                                    <DropdownMenu :items="iconItemsFor(role)" :disabled="disabled" @select="(key: string) => setIcon(role, key)">
                                        <IconButton size="xs" :icon-class="roleIconClass(role.id, role.icon)" :aria-label="text('roles.effort.iconOf', {name: role.name})" :title="text('roles.effort.pickIcon')" :disabled="disabled" data-role-icon />
                                    </DropdownMenu>
                                    <Input v-model="drafts.get(role.id)!.name" size="sm" :aria-label="text('roles.nameOf', {name: role.name})" :disabled="disabled" @focusin="startEditing(role)" @focusout="finishEditing(role)" @keydown.enter="rename(role)" />
                                    <Badge v-if="role.status === 'unbound'" size="sm" variant="soft" tone="danger" data-role-unbound>{{ text("roles.unbound") }}</Badge>
                                </span>
                                <Input v-model="drafts.get(role.id)!.description" size="sm" :aria-label="text('roles.descriptionOf', {name: role.name})" :placeholder="text('roles.description')" :disabled="disabled" @focusin="startEditing(role)" @focusout="finishEditing(role)" @keydown.enter="rename(role)" />
                            </template>
                            <span v-if="problem(role) !== ''" class="roles-page__problem" data-role-problem>{{ problem(role) }}</span>
                        </div>
                        <div class="roles-page__control" data-role-model>
                            <SearchSelect
                                :model-value="role.model ?? ''"
                                :options="optionsFor(role)"
                                size="sm"
                                :placeholder="text('roles.choose')"
                                :empty-text="text('manage.noMatch')"
                                :invalid="role.status !== 'ok'"
                                :disabled="disabled"
                                :aria-label="roleName(text, role)"
                                :filter="false"
                                :selected-label="role.model === null ? '' : modelsByRef.get(role.model)?.name ?? role.model"
                                @search="(query: string) => (searching = query)"
                                @update:model-value="(value: string) => bind(role, value)"
                            />
                        </div>
                        <div class="roles-page__effort" data-role-effort>
                            <Select
                                :model-value="efforts.get(role.id)!.value"
                                :options="efforts.get(role.id)!.options"
                                size="sm"
                                :placeholder="efforts.get(role.id)!.placeholder"
                                :disabled="disabled || efforts.get(role.id)!.disabled"
                                :aria-label="text('roles.effort.of', {name: roleName(text, role)})"
                                @update:model-value="(value: string) => setEffort(role, value)"
                            />
                            <Tooltip v-if="efforts.get(role.id)!.clearable" :text="text('roles.effort.clear', {name: roleName(text, role)})">
                                <IconButton size="xs" icon-class="i-lucide-x" :aria-label="text('roles.effort.clear', {name: roleName(text, role)})" :disabled="disabled" data-role-effort-clear @click="setEffort(role, '')" />
                            </Tooltip>
                        </div>
                        <div class="roles-page__tail">
                            <Tooltip v-if="!role.builtin" :text="text('roles.remove', {name: role.name})">
                                <IconButton size="xs" icon-class="i-lucide-trash-2" :aria-label="text('roles.remove', {name: role.name})" :disabled="disabled" @click="removeRole(role)" />
                            </Tooltip>
                        </div>
                    </li>
                </ul>
                <Button v-if="group.axis === 'specialist'" size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="disabled" data-role-add @click="addRole">{{ text("roles.add") }}</Button>
            </section>
        </template>
    </div>
</template>

<style scoped>
.roles-page {
    display: flex;
    container-type: inline-size;
    max-width: 760px;
    flex-direction: column;
    gap: var(--space-6);
}

.roles-page__intro,
.roles-page__notice {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.roles-page__title {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
}

.roles-page__title h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
}

.roles-page__muted {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.roles-page__rows {
    margin: 0;
    padding: 0;
    list-style: none;
}

.roles-page__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(200px, 280px) minmax(140px, 180px) 24px;
    align-items: center;
    gap: var(--space-4);
    padding-block: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
}

.roles-page__label {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-1);
}

.roles-page__name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
}

.roles-page__problem {
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.roles-page__icon {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--text-secondary);
}

.roles-page__effort {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-1);
}

/* 够宽三列；中等宽度时思考档换到模型下面；窄时模型与思考档各占一行。 */
@container (max-width: 640px) {
    .roles-page__row {
        grid-template-columns: minmax(0, 1fr) minmax(140px, 180px) 24px;
    }

    .roles-page__control {
        grid-column: 1;
        grid-row: 2;
    }

    .roles-page__effort {
        grid-column: 2 / 4;
        grid-row: 2;
    }

    /* 删除按钮留在第一行行尾；不写位置时自动摆放会把它落进中间那一列。 */
    .roles-page__tail {
        grid-column: 3;
        grid-row: 1;
    }
}

@container (max-width: 520px) {
    .roles-page__row {
        grid-template-columns: minmax(0, 1fr) 24px;
    }

    .roles-page__control,
    .roles-page__effort {
        grid-column: 1 / -1;
    }

    .roles-page__control {
        grid-row: 2;
    }

    .roles-page__effort {
        grid-row: 3;
    }

    .roles-page__tail {
        grid-column: 2;
        grid-row: 1;
    }
}
</style>
