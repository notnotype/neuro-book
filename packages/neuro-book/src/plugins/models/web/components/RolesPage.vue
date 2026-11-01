<script setup lang="ts">
import {Badge, Button, IconButton, Input, SearchSelect, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import type {SnapshotRole} from "../../shared/contracts";
import {referenceOf} from "../../shared/rules";
import type {ModelsFailure, ModelsStore} from "../models-store";
import {failureReason, roleDescription, roleName, useModelsText} from "../text";

/**
 * “模型角色”页（docs/specs/models/settings-pages.md 输出 13 到 17）：梯度与专精两组角色，每行选一个模型（立即写）；未绑定的
 * 标红，绑定的模型不可用时写原因。自建的专精角色可以改名、改说明、删除。
 */
const props = defineProps<{
    store: ModelsStore;
    /** 当前标签那一层能不能写（页面上下文的 `writable`）。 */
    writable: boolean;
    /** 写失败交给窗口通知（页面上下文的 `reportWriteFailure`）。 */
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
}>();

const text = useModelsText();
const snapshot = props.store.snapshot;
const disabled = computed(() => !props.store.available.value || !props.writable);

onMounted(() => void props.store.start());

/** 可选的模型：启用、可用（不缺字段、不在目录漂移里）的；没有密钥的照样列出，角色状态会写明。 */
const available = computed(() => (snapshot.value?.providers ?? []).flatMap((provider) => provider.models
    .filter((model) => model.enabled && model.status === "ok")
    .map((model) => ({value: referenceOf(provider.id, model.id), label: model.name, description: provider.name}))));

/** 一行的选项：绑着的模型现在不可用时补一个停用的项，下拉仍显示绑的是谁。 */
function optionsFor(role: SnapshotRole) {
    const base = [{value: "", label: text("roles.none")}, ...available.value];
    if (role.model === null || base.some((option) => option.value === role.model)) return base;
    return [...base, {value: role.model, label: role.model, description: text("roles.unavailable"), disabled: true}];
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
                                    {{ roleName(text, role) }}
                                    <Badge v-if="role.status === 'unbound'" size="sm" variant="soft" tone="danger" data-role-unbound>{{ text("roles.unbound") }}</Badge>
                                </span>
                                <span class="roles-page__muted">{{ roleDescription(text, role) }}</span>
                            </template>
                            <template v-else-if="drafts.get(role.id) !== undefined">
                                <span class="roles-page__name">
                                    <Input v-model="drafts.get(role.id)!.name" size="sm" :aria-label="text('roles.nameOf', {name: role.name})" :disabled="disabled" @focusin="startEditing(role)" @focusout="finishEditing(role)" @keydown.enter="rename(role)" />
                                    <Badge v-if="role.status === 'unbound'" size="sm" variant="soft" tone="danger" data-role-unbound>{{ text("roles.unbound") }}</Badge>
                                </span>
                                <Input v-model="drafts.get(role.id)!.description" size="sm" :aria-label="text('roles.descriptionOf', {name: role.name})" :placeholder="text('roles.description')" :disabled="disabled" @focusin="startEditing(role)" @focusout="finishEditing(role)" @keydown.enter="rename(role)" />
                            </template>
                            <span v-if="problem(role) !== ''" class="roles-page__problem" data-role-problem>{{ problem(role) }}</span>
                        </div>
                        <div class="roles-page__control">
                            <SearchSelect
                                :model-value="role.model ?? ''"
                                :options="optionsFor(role)"
                                size="sm"
                                :placeholder="text('roles.choose')"
                                :empty-text="text('manage.noMatch')"
                                :invalid="role.status !== 'ok'"
                                :disabled="disabled"
                                :aria-label="roleName(text, role)"
                                @update:model-value="(value: string) => bind(role, value)"
                            />
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
    grid-template-columns: minmax(0, 1fr) minmax(200px, 280px) 24px;
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

@container (max-width: 520px) {
    .roles-page__row {
        grid-template-columns: minmax(0, 1fr) 24px;
    }

    .roles-page__control {
        grid-column: 1 / -1;
        grid-row: 2;
    }
}
</style>
