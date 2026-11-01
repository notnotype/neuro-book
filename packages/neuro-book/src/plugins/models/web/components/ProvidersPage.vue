<script setup lang="ts">
import {AlertDialog, Button, EmptyState, IconButton, Select, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";

import type {CatalogProvider, SnapshotModel, SnapshotProvider} from "../../shared/contracts";
import {referenceOf, rolesUsing} from "../../shared/rules";
import type {ModelConfig} from "../../shared/settings";
import type {ModelsFailure, ModelsRemote, ModelsStore} from "../models-store";
import {failureReason, roleName, useModelsText} from "../text";
import AddProviderDialog from "./AddProviderDialog.vue";
import AllModelsView from "./AllModelsView.vue";
import ManageModelsDialog from "./ManageModelsDialog.vue";
import type {ModelCandidate} from "./ManageModelsDialog.vue";
import ModelEditDialog from "./ModelEditDialog.vue";
import ProviderDetail from "./ProviderDetail.vue";
import ProviderRail from "./ProviderRail.vue";

/**
 * “服务商与模型”页（docs/specs/models/settings-pages.md 输出 1 到 12、15 到 17）：左边服务商列表、右边详情的 fill 页面。读写都经
 * 数据模块；写失败交给窗口通知（`reportWriteFailure`），控件随后以快照为准。
 */
type ProviderPatch = Parameters<ModelsRemote["updateProvider"]>[0]["patch"];
type ProviderSource = Parameters<ModelsRemote["addProvider"]>[0]["source"];

const props = defineProps<{
    store: ModelsStore;
    /** 当前标签那一层能不能写（页面上下文的 `writable`）。 */
    writable: boolean;
    /** 写失败交给窗口通知（页面上下文的 `reportWriteFailure`）。 */
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];
}>();

const text = useModelsText();
const snapshot = props.store.snapshot;
const providers = computed(() => snapshot.value?.providers ?? []);
const roles = computed(() => snapshot.value?.roles ?? []);
const disabled = computed(() => !props.store.available.value || !props.writable);

onMounted(() => void props.store.start());

// ---- 选择 ----
const selected = ref<string>("all");
const current = computed(() => providers.value.find((provider) => provider.id === selected.value) ?? null);
// 第一次拿到快照时选第一家；当前这家被删了（别处删的也算）时回到“全部模型”。
watch(providers, (list, previous) => {
    if (previous === undefined || previous.length === 0) {
        if (list.length > 0 && selected.value === "all") selected.value = list[0]!.id;
        return;
    }
    if (selected.value !== "all" && !list.some((provider) => provider.id === selected.value)) selected.value = "all";
}, {immediate: true});
const pickerOptions = computed(() => [{value: "all", label: text("rail.all")}, ...providers.value.map((provider) => ({value: provider.id, label: provider.name}))]);

/** 这家每个模型被哪些角色用着（角色名）。 */
function roleUsage(provider: SnapshotProvider): Map<string, string[]> {
    const usage = new Map<string, string[]>();
    for (const role of rolesUsing(roles.value, provider.id)) {
        const model = role.model!.slice(provider.id.length + 1);
        usage.set(model, [...(usage.get(model) ?? []), roleName(text, role)]);
    }
    return usage;
}

// ---- 写入 ----
/** 写入失败交给窗口通知；`partially-applied` 之外失败的控件随快照回到实际值。 */
/** 写失败后详情里的输入框回到实际值（输出 15）：快照没变时它们自己看不出要回去，靠这个序号。 */
const resetToken = ref(0);
function report(subject: string, failure: ModelsFailure): void {
    props.reportWriteFailure(subject, {reason: failureReason(text, failure), uncertain: failure.code === "unknown-outcome"});
    resetToken.value += 1;
}
const subjectOf = (provider: SnapshotProvider): string => text("subject.provider", {name: provider.name});

async function setKey(provider: SnapshotProvider, value: string): Promise<void> {
    const result = await props.store.call("setKey", {provider: provider.id, value});
    // `partially-applied` 也走通知：快照随后给出实际的密钥状态（service.md 输出 13）。
    if (!result.ok) report(text("subject.key", {provider: provider.name}), result.failure);
}

async function clearKey(provider: SnapshotProvider): Promise<void> {
    const result = await props.store.call("clearKey", {provider: provider.id});
    if (!result.ok) report(text("subject.key", {provider: provider.name}), result.failure);
}

async function updateProvider(provider: SnapshotProvider, patch: ProviderPatch): Promise<void> {
    const result = await props.store.call("updateProvider", {id: provider.id, patch});
    if (!result.ok) report(subjectOf(provider), result.failure);
}

/** 快照里的模型转回设置的形状（启用开关只改 `enabled`，其余照原样；服务端会去掉目录模型没改过的字段）。 */
function configOf(model: SnapshotModel, enabled: boolean): ModelConfig {
    return {
        id: model.id,
        enabled,
        name: model.name,
        group: model.group,
        ...(model.contextWindow === null ? {} : {contextWindow: model.contextWindow}),
        ...(model.maxOutput === null ? {} : {maxOutput: model.maxOutput}),
        vision: model.vision,
        reasoning: model.reasoning,
        efforts: [...model.efforts],
        ...(model.compactAt === null ? {} : {compactAt: model.compactAt}),
        price: model.price,
        headers: {...model.headers},
    };
}

async function toggleModel(provider: SnapshotProvider, id: string, enabled: boolean): Promise<void> {
    const model = provider.models.find((item) => item.id === id);
    if (model === undefined) return;
    const result = await props.store.call("upsertModel", {provider: provider.id, model: configOf(model, enabled)});
    if (!result.ok) report(text("subject.model", {name: model.name}), result.failure);
}

// ---- 检测 ----
// 检测与取消都在数据模块里：离开页面不取消，回来还能取消，结果也还在（输出 8）。
/** 这家最近一次“没检成”的原因（不是模型的检测失败）。 */
function checkError(provider: SnapshotProvider): string {
    const failure = props.store.checkErrors.get(provider.id);
    return failure === undefined ? "" : text("check.notRun", {reason: failureReason(text, failure)});
}

// ---- 添加服务商 ----
const adding = ref(false);
const addCatalog = ref<readonly CatalogProvider[] | null>(null);
const addError = ref("");
const addBusy = ref(false);

async function openAdd(): Promise<void> {
    adding.value = true;
    addError.value = "";
    addCatalog.value = null;
    const result = await props.store.call("catalogProviders", {});
    if (result.ok) addCatalog.value = result.value;
    else addError.value = failureReason(text, result.failure);
}

async function addProvider(source: ProviderSource): Promise<void> {
    addBusy.value = true;
    const result = await props.store.call("addProvider", {source});
    addBusy.value = false;
    if (!result.ok) {
        addError.value = failureReason(text, result.failure);
        return;
    }
    adding.value = false;
    selected.value = result.value.id;
}

// ---- 编辑与手动添加 ----
const editTarget = ref<{readonly provider: string; readonly model: string | null} | null>(null);
const editProvider = computed(() => providers.value.find((provider) => provider.id === editTarget.value?.provider) ?? null);
const editModel = computed(() => editProvider.value?.models.find((model) => model.id === editTarget.value?.model) ?? null);
const editBusy = ref(false);
const editError = ref("");

// 编辑着的模型（或它的服务商）被别处删了：关掉对话框，不让它退化成“手动添加”。
watch([editProvider, editModel], ([provider, model]) => {
    if (editTarget.value === null) return;
    if (provider === null || (editTarget.value.model !== null && model === null)) editTarget.value = null;
});

function openEdit(provider: string, model: string | null): void {
    editError.value = "";
    editTarget.value = {provider, model};
}

async function saveModel(model: ModelConfig): Promise<void> {
    const provider = editProvider.value;
    if (provider === null) return;
    editBusy.value = true;
    const result = await props.store.call("upsertModel", {provider: provider.id, model});
    editBusy.value = false;
    if (!result.ok) {
        editError.value = failureReason(text, result.failure);
        return;
    }
    editTarget.value = null;
}

// ---- 管理模型 ----
const managing = ref(false);
const candidates = ref<readonly ModelCandidate[] | null>(null);
const discovered = new Map<string, {readonly contextWindow: number | null; readonly maxOutput: number | null}>();
const manageError = ref("");
const manageBusy = ref(false);
let manageToken = 0;

async function loadCandidates(provider: SnapshotProvider): Promise<void> {
    const token = (manageToken += 1);
    candidates.value = null;
    manageError.value = "";
    if (provider.kind === "catalog") {
        const result = await props.store.call("catalogModels", {provider: provider.id});
        // 对话框关了或又发起了一次：迟到的结果丢掉（输出 10）。
        if (token !== manageToken || !managing.value) return;
        if (result.ok) candidates.value = result.value.map((model) => ({id: model.id, name: model.name, vision: model.vision, reasoning: model.reasoning, incomplete: false}));
        else manageError.value = failureReason(text, result.failure);
        return;
    }
    const result = await props.store.call("discover", {provider: provider.id});
    if (token !== manageToken || !managing.value) return;
    if (!result.ok) {
        manageError.value = failureReason(text, result.failure);
        return;
    }
    discovered.clear();
    for (const model of result.value) discovered.set(model.id, {contextWindow: model.suggested?.contextWindow ?? null, maxOutput: model.suggested?.maxOutput ?? null});
    candidates.value = result.value.map((model) => ({id: model.id, name: model.name, vision: model.suggested?.vision ?? false, reasoning: model.suggested?.reasoning ?? false, incomplete: (model.suggested?.contextWindow ?? null) === null}));
}

/** 打开“管理模型”时这家列表里的模型：“完成”只提交相对它的改动，打开期间别处加的模型不会被当成“要移出”。 */
const manageOpenedWith = ref<readonly string[]>([]);

function openManage(provider: SnapshotProvider): void {
    manageOpenedWith.value = provider.models.map((model) => model.id);
    managing.value = true;
    void loadCandidates(provider);
}

watch(managing, (open) => {
    if (!open) manageToken += 1;
});
// 管理着的服务商被别处删了：关掉对话框（否则选中另一家时它会带着上一家的候选自己弹出来）。
watch(current, (provider, previous) => {
    if (managing.value && provider?.id !== previous?.id) managing.value = false;
});

async function applyManage(provider: SnapshotProvider, change: {add: ModelCandidate[]; remove: string[]}): Promise<void> {
    const add: ModelConfig[] = change.add.map((item) => {
        if (provider.kind === "catalog") return {id: item.id, enabled: true};
        const suggested = discovered.get(item.id);
        return {
            id: item.id,
            // 缺上下文窗口的加入后停用，补上字段才能启用（输出 7）。
            enabled: !item.incomplete,
            ...(item.name === item.id ? {} : {name: item.name}),
            ...(suggested?.contextWindow === null || suggested === undefined ? {} : {contextWindow: suggested.contextWindow}),
            ...(suggested?.maxOutput === null || suggested === undefined ? {} : {maxOutput: suggested.maxOutput}),
            vision: item.vision,
            reasoning: item.reasoning,
        };
    });
    manageBusy.value = true;
    const result = await props.store.call("setModels", {provider: provider.id, add, remove: change.remove});
    manageBusy.value = false;
    if (!result.ok) {
        manageError.value = failureReason(text, result.failure);
        return;
    }
    managing.value = false;
}

// ---- 删除服务商 ----
/**
 * 正在确认删除的那家：打开确认框时取定。确认框不能跟着“当前服务商”挂载——删掉之后当前项变了，确认框会在发出 `closed` 之前
 * 被卸掉，焦点就没人管了。
 */
const removing = ref(false);
/** 按 id 记：确认框开着时快照可能又来一份，对象身份就不作数了。 */
const removeId = ref<string | null>(null);
/** 确认框里写的那家：取最新的快照；这期间被别处删了时留着打开时的样子。 */
let removeOpenedWith: SnapshotProvider | null = null;
const removeTarget = computed(() => providers.value.find((provider) => provider.id === removeId.value) ?? (removeId.value === null ? null : removeOpenedWith));
function openRemove(): void {
    removeOpenedWith = current.value;
    removeId.value = current.value?.id ?? null;
    removing.value = current.value !== null;
}
const removeDescription = computed(() => {
    const target = removeTarget.value;
    if (target === null) return "";
    const affected = rolesUsing(roles.value, target.id).map((role) => {
        const model = target.models.find((item) => referenceOf(target.id, item.id) === role.model);
        return `${roleName(text, role)}（${model?.name ?? role.model}）`;
    });
    const models = text("remove.models", {count: target.models.length});
    return affected.length === 0 ? models : `${models}${text("remove.roles", {roles: affected.join("、")})}`;
});
const page = ref<HTMLElement | null>(null);

/**
 * 进行中的删除：交回删除后焦点去的地方（下一家，没有时上一家，都没有时“添加服务商”，输出 12），失败为 null。确认框在“删除”
 * 按下时就开始关闭，它的 `closed` 可能早于删除的结果，所以关闭的处理等这个 Promise。
 */
let removal: Promise<string | null> | null = null;

function removeProvider(): void {
    const provider = removeTarget.value;
    if (provider === null) return;
    const others = providers.value.filter((item) => item.id !== provider.id);
    const index = providers.value.findIndex((item) => item.id === provider.id);
    // 下一家（删掉后同一个位置上的那家），没有时上一家。
    const neighbour = index < 0 ? others[0] ?? null : others[index] ?? others[index - 1] ?? null;
    removal = (async () => {
        const result = await props.store.call("removeProvider", {id: provider.id});
        if (!result.ok) {
            report(subjectOf(provider), result.failure);
            return null;
        }
        selected.value = neighbour?.id ?? "all";
        return neighbour?.id ?? "add";
    })();
}

async function onRemoveClosed(): Promise<void> {
    const removed = removeId.value ?? undefined;
    const pending = removal;
    removal = null;
    removeId.value = null;
    removeOpenedWith = null;
    const target = pending === null ? null : await pending;
    // 取消或删除失败：焦点回到“删除”按钮（确认框没有触发器，nb-ui 不替它归还焦点）。它在窗口的标题区里，不在本页的 DOM 下。
    if (target === null) {
        await nextTick();
        document.querySelector<HTMLElement>("[data-provider-remove]")?.focus();
        return;
    }
    // 删除的结果经快照事件回来，可能晚于写入返回：等这家从快照里消失、界面重画之后再移焦点。
    if (removed !== undefined && providers.value.some((provider) => provider.id === removed)) {
        await new Promise<void>((resolve) => {
            const stop = watch(providers, (list) => {
                if (list.some((provider) => provider.id === removed)) return;
                stop();
                resolve();
            });
        });
    }
    await nextTick();
    focusVisible(target === "add" ? ["[data-provider-add]"] : [`[data-provider-rail-item="${CSS.escape(target)}"]`, "[data-provider-picker]"]);
}

/** 聚焦第一个看得见的：窄布局里左栏整个隐藏，聚焦它的项不生效，换成顶上的下拉。 */
function focusVisible(selectors: readonly string[]): void {
    for (const selector of selectors) {
        for (const element of page.value?.querySelectorAll<HTMLElement>(selector) ?? []) {
            if (element.offsetParent === null) continue;
            element.focus();
            return;
        }
    }
}
</script>

<template>
    <div ref="page" class="providers-page" data-models-providers-page>
        <SettingsPageActions v-if="current !== null">
            <Tooltip :text="text('remove.button')">
                <IconButton size="sm" variant="danger" icon-class="i-lucide-trash-2" :aria-label="text('remove.label', {name: current.name})" :disabled="disabled" data-provider-remove @click="openRemove" />
            </Tooltip>
        </SettingsPageActions>
        <p v-if="!store.available.value" class="providers-page__notice" role="status">{{ text("readOnly") }}</p>
        <p v-if="snapshot === null && store.available.value" class="providers-page__loading">{{ text("connection.key.loading") }}</p>
        <div v-else-if="snapshot !== null" class="providers-page__split">
            <ProviderRail v-if="providers.length > 0" class="providers-page__rail" :providers="providers" :current="selected" :checks="store.checks" :disabled="disabled" @select="(id) => (selected = id)" @add="openAdd" />
            <div class="providers-page__detail">
                <div v-if="providers.length > 0" class="providers-page__picker">
                    <Select :model-value="selected" :options="pickerOptions" size="sm" :aria-label="text('rail.label')" data-provider-picker @update:model-value="(value: string) => (selected = value)" />
                    <Button size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="disabled" data-provider-add @click="openAdd">{{ text("rail.addShort") }}</Button>
                </div>
                <EmptyState v-if="providers.length === 0" icon-class="i-lucide-cloud" :title="text('empty.title')" :description="text('empty.description')">
                    <template #action>
                        <Button size="sm" icon-class="i-lucide-plus" :disabled="disabled" data-provider-add @click="openAdd">{{ text("rail.add") }}</Button>
                    </template>
                </EmptyState>
                <template v-else-if="current !== null">
                    <h3 class="providers-page__heading">{{ current.name }}</h3>
                    <ProviderDetail
                        :key="current.id"
                        :provider="current"
                        :checks="store.checks"
                        :role-usage="roleUsage(current)"
                        :disabled="disabled"
                        :reset-token="resetToken"
                        @set-key="(value) => setKey(current!, value)"
                        @clear-key="clearKey(current!)"
                        @update="(patch) => updateProvider(current!, patch)"
                        @toggle-model="(id, enabled) => toggleModel(current!, id, enabled)"
                        :check-error="checkError(current)"
                        @check="(id) => store.check(current!.id, id)"
                        @check-all="store.checkAll(current!.id)"
                        @cancel-checks="store.cancel(current!.id)"
                        @cancel-check="(id) => store.cancel(current!.id, id)"
                        @edit-model="(id) => openEdit(current!.id, id)"
                        @add-model="openEdit(current!.id, null)"
                        @manage="openManage(current!)"
                    />
                </template>
                <template v-else>
                    <h3 class="providers-page__heading">{{ text("rail.all") }}</h3>
                    <AllModelsView :providers="providers" :checks="store.checks" :disabled="disabled" @edit="openEdit" />
                </template>
            </div>
        </div>
        <AddProviderDialog v-model:open="adding" :catalog="addCatalog" :error="addError" :busy="addBusy" @add-catalog="(id) => addProvider({kind: 'catalog', id})" @add-custom="(source) => addProvider({kind: 'custom', ...source})" />
        <ModelEditDialog
            v-if="editProvider !== null"
            :open="editTarget !== null"
            :provider-kind="editProvider.kind"
            :model="editModel"
            :taken-ids="editProvider.models.map((model) => model.id)"
            :busy="editBusy"
            :error="editError"
            @update:open="(value) => { if (!value) editTarget = null; }"
            @save="saveModel"
        />
        <ManageModelsDialog
            v-if="current !== null"
            v-model:open="managing"
            :provider-name="current.name"
            :discoverable="current.kind === 'custom'"
            :candidates="candidates"
            :current="manageOpenedWith"
            :role-usage="roleUsage(current)"
            :error="manageError"
            :busy="manageBusy"
            @refetch="loadCandidates(current!)"
            @done="(change) => applyManage(current!, change)"
        />
        <AlertDialog v-if="removeTarget !== null" v-model:open="removing" :title="text('remove.title', {name: removeTarget.name})" :description="removeDescription" :confirm-text="text('remove.confirm')" @confirm="removeProvider" @closed="onRemoveClosed" />
    </div>
</template>

<style scoped>
.providers-page {
    height: 100%;
    min-height: 0;
    container-type: inline-size;
}

.providers-page__notice,
.providers-page__loading {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.providers-page__split {
    display: flex;
    height: 100%;
    min-height: 0;
    gap: var(--space-5);
}

/* 自己滚动的区域会裁掉贴边控件的焦点环：两侧留一点内边距。 */
.providers-page__detail {
    min-width: 0;
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) var(--space-2) var(--space-5);
}

.providers-page__heading {
    margin: 0 0 var(--space-5);
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
}

.providers-page__picker {
    display: none;
}

/* 页面不到 600px：左栏收成顶上的下拉加“添加”（输出 1）。 */
@container (max-width: 600px) {
    .providers-page__rail {
        display: none;
    }

    .providers-page__picker {
        display: flex;
        gap: var(--space-2);
        margin-bottom: var(--space-4);
    }

    .providers-page__picker > :first-child {
        flex: 1;
    }
}
</style>
