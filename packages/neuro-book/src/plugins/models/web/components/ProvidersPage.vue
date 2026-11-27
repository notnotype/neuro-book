<script setup lang="ts">
import {referenceOf, rolesUsing} from "@notnotype/nb-models/config";
import type {ModelConfig} from "@notnotype/nb-models/config";
import {PROVIDER_ICON_FILES} from "nbook/ui/provider-icons";
import type {ModelRow, SnapshotProvider} from "@notnotype/nb-models/contract";
import {AlertDialog, Button, EmptyState, IconButton, Select, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import {CHECK_CONCURRENCY, CHECK_CONFIRM_ABOVE, detailText} from "../models-store";
import type {ModelsFailure, ModelsRemote, ModelsStore} from "../models-store";
import {failureReason, roleName, useModelsText} from "../text";
import AddProviderDialog from "./AddProviderDialog.vue";
import type {AddInput} from "./AddProviderDialog.vue";
import AllModelsView from "./AllModelsView.vue";
import type {ApiDetectState} from "./ApiDetectResults.vue";
import ManageModelsDialog from "./ManageModelsDialog.vue";
import type {ModelCandidate} from "./ManageModelsDialog.vue";
import ModelEditDialog from "./ModelEditDialog.vue";
import ProviderDetail from "./ProviderDetail.vue";
import ProviderHeader from "./ProviderHeader.vue";
import ProviderRail from "./ProviderRail.vue";

/**
 * “服务商与模型”页（docs/specs/models/settings-pages.md 输出 1 到 12、15 到 17）：左边服务商列表、右边详情的 fill 页面。读写都经
 * 数据模块；写失败交给窗口通知（`reportWriteFailure`），控件随后以快照为准。
 */
type ProviderPatch = Parameters<ModelsRemote["updateProvider"]>[0]["patch"];

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

// ---- 当前这家的模型行 ----
// 这家的版本变了（别处改了、自己写了）就重读；模板表也在页面打开时读好（地区与协议要用）。
watch(() => current.value?.modelsRevision, () => {
    if (current.value !== null) void props.store.loadRows(current.value.id);
}, {immediate: true});
watch(current, (provider) => {
    if (provider !== null) void props.store.loadRows(provider.id);
});
/** “全部模型”要的各家行与读取状态（数据模块按服务商缓存）。 */
const allRows = computed(() => {
    const states = providers.value.map((provider) => [provider.id, props.store.rowsOf(provider.id)] as const);
    return {
        rows: Object.fromEntries(states.map(([id, state]) => [id, state.rows])),
        loading: new Set(states.filter(([, state]) => state.loading).map(([id]) => id)),
        failures: Object.fromEntries(states.flatMap(([id, state]) => (state.failure === null ? [] : [[id, failureReason(text, state.failure)]]))),
    };
});
const currentRows = computed(() => (current.value === null ? null : props.store.rowsOf(current.value.id)));
const currentTemplate = computed(() => templates.value?.find((template) => template.id === current.value?.template) ?? null);
/** 内置图标可选的键：模板用到的 logo，且图标表里有。 */
const builtinKeys = computed(() => [...new Set((templates.value ?? []).flatMap((template) => (template.logo !== null && template.logo in PROVIDER_ICON_FILES ? [template.logo] : [])))].sort());
const takenNames = computed(() => new Set(providers.value.filter((provider) => provider.id !== current.value?.id).map((provider) => provider.name.trim().toLowerCase())));

// ---- 标题区：改名、图标、复制 ----
const iconBusy = ref(false);
const iconError = ref("");
const duplicating = ref(false);
// 换一家服务商时上一家的图标失败不再显示。
watch(selected, () => {
    iconError.value = "";
});
async function renameProvider(provider: SnapshotProvider, name: string): Promise<void> {
    await updateProvider(provider, {name});
}
async function setIcon(provider: SnapshotProvider, icon: Parameters<ModelsRemote["setIcon"]>[0]["icon"]): Promise<void> {
    iconBusy.value = true;
    iconError.value = "";
    const result = await props.store.call("setIcon", {provider: provider.id, icon});
    iconBusy.value = false;
    if (!result.ok) iconError.value = result.failure.code === "icon-rejected" ? text("header.icon.errors.rejected", {detail: detailText(result.failure.detail)}) : failureReason(text, result.failure);
}
async function duplicateProvider(provider: SnapshotProvider): Promise<void> {
    duplicating.value = true;
    const result = await props.store.call("duplicateProvider", {id: provider.id});
    duplicating.value = false;
    if (!result.ok) {
        // 密钥没复制成功：副本在，选中它并说明；别的失败照常通知。
        if (result.failure.code === "partially-applied") {
            const id = (result.failure.detail as {id?: string}).id;
            if (id !== undefined) selected.value = id;
            const copy = providers.value.find((item) => item.id === id)?.name ?? provider.name;
            props.reportWriteFailure(subjectOf(provider), {reason: text("header.keyNotCopied", {name: copy}), uncertain: false});
            return;
        }
        report(subjectOf(provider), result.failure);
        return;
    }
    selected.value = result.value.id;
    await nextTick();
    page.value?.querySelector<HTMLElement>("[data-provider-name]")?.focus();
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

/**
 * 重新拉取列表：受理即回，结果经快照的 `source` 显示在模型区。没受理（没有可用的密钥、设置读不到、服务商不在了）的原因写在模型区的
 * 来源一行下，不走“设置没保存”的通知：这不是一次写入，输入框也不用回到实际值。
 */
const sourceErrors = ref(new Map<string, string>());
async function refreshSource(provider: SnapshotProvider): Promise<void> {
    const result = await props.store.call("refreshSource", {provider: provider.id});
    const next = new Map(sourceErrors.value);
    if (result.ok) next.delete(provider.id);
    else next.set(provider.id, failureReason(text, result.failure));
    sourceErrors.value = next;
}

/**
 * 还没回来的连接写入（地址、协议、认证、密钥）：协议检测要等它们写完，只测已保存的配置。鼠标从密钥框直接点“检测协议”时，失焦交出的
 * 密钥与检测几乎同时发出，服务端的检测不排在写队列里，不等就会读到旧密钥。
 */
const pendingWrites = new Set<Promise<unknown>>();
function tracked<T>(work: Promise<T>): Promise<T> {
    pendingWrites.add(work);
    void work.finally(() => pendingWrites.delete(work));
    return work;
}

async function setKey(provider: SnapshotProvider, value: string): Promise<void> {
    const result = await tracked(props.store.call("setKey", {provider: provider.id, value}));
    // `partially-applied` 也走通知：快照随后给出实际的密钥状态（service.md 输出 13）。
    if (!result.ok) report(text("subject.key", {provider: provider.name}), result.failure);
}

async function clearKey(provider: SnapshotProvider): Promise<void> {
    const result = await tracked(props.store.call("clearKey", {provider: provider.id}));
    if (!result.ok) report(text("subject.key", {provider: provider.name}), result.failure);
}

async function updateProvider(provider: SnapshotProvider, patch: ProviderPatch): Promise<void> {
    const result = await tracked(props.store.call("updateProvider", {id: provider.id, patch}));
    if (!result.ok) report(subjectOf(provider), result.failure);
}

// ---- 协议检测（输出 21）----
// 状态在页面：换服务商、离开页面时取消在途的检测，结果不跨服务商留。
const detection = ref<{provider: string; state: ApiDetectState} | null>(null);
let detectController: AbortController | null = null;
const IDLE: ApiDetectState = {status: "idle"};
const detectState = (provider: SnapshotProvider): ApiDetectState => (detection.value?.provider === provider.id ? detection.value.state : IDLE);
function stopDetect(): void {
    detectController?.abort();
    detectController = null;
    detection.value = null;
}
async function detectApi(provider: SnapshotProvider, model?: string): Promise<void> {
    detectController?.abort();
    const controller = new AbortController();
    detectController = controller;
    detection.value = {provider: provider.id, state: {status: "running"}};
    // 点按钮前地址框里的草稿已经交出去了（失焦或点击时）：等它写完，检测读到的才是新地址。
    await Promise.allSettled([...pendingWrites]);
    if (controller.signal.aborted) return;
    const result = await props.store.call("detectApi", {provider: provider.id, ...(model === undefined ? {} : {model})}, {signal: controller.signal});
    if (controller.signal.aborted) return;
    detectController = null;
    detection.value = {provider: provider.id, state: result.ok ? {status: "done", detection: result.value} : {status: "failed", code: result.failure.code, reason: failureReason(text, result.failure)}};
}
async function adoptApi(provider: SnapshotProvider, api: NonNullable<ProviderPatch["api"]>, connection: string): Promise<void> {
    const result = await tracked(props.store.call("adoptApi", {provider: provider.id, api, connection}));
    // 检测之后配置变过：快照随之换了连接版本，结果块自己置灰并写“请重新检测”，不另发通知。
    if (!result.ok && result.failure.code !== "connection-changed") report(subjectOf(provider), result.failure);
}
watch(selected, stopDetect);
onBeforeUnmount(stopDetect);

// ---- 检测全部 ----
/** 超过 `CHECK_CONFIRM_ABOVE` 个先确认：个数与“会产生真实调用”。确认的是这一份名单，检测的也是它。 */
const checkConfirm = ref<{provider: string; name: string; models: readonly string[]} | null>(null);
const checkConfirmOpen = ref(false);
async function checkAll(provider: SnapshotProvider): Promise<void> {
    const models = await props.store.checkTargets(provider.id);
    if (models.length <= CHECK_CONFIRM_ABOVE) {
        void props.store.checkAll(provider.id, models);
        return;
    }
    checkConfirm.value = {provider: provider.id, name: provider.name, models};
    checkConfirmOpen.value = true;
}
function confirmCheckAll(): void {
    const target = checkConfirm.value;
    if (target !== null) void props.store.checkAll(target.provider, target.models);
}
/** 对话框没有触发器：关上后焦点回到模型区头上（确认了就是“取消检测”，取消了就是“检测全部”）。 */
async function onCheckConfirmClosed(): Promise<void> {
    checkConfirm.value = null;
    await nextTick();
    page.value?.querySelector<HTMLElement>("[data-models-cancel], [data-models-check-all]")?.focus();
}

/** 模型行转回设置的形状（启用开关只改 `enabled`，其余照原样；服务端会去掉来源模型没改过的字段）。 */
function configOf(model: ModelRow, enabled: boolean): ModelConfig {
    return {
        id: model.id,
        enabled,
        origin: model.origin,
        name: model.name,
        group: model.group,
        ...(model.contextWindow === null ? {} : {contextWindow: model.contextWindow}),
        ...(model.maxOutput === null ? {} : {maxOutput: model.maxOutput}),
        vision: model.vision,
        reasoning: model.reasoning,
        efforts: [...model.efforts],
        ...(model.compaction === null ? {} : {compaction: model.compaction}),
        price: model.price,
        headers: {...model.headers},
    };
}

async function toggleModel(provider: SnapshotProvider, id: string, enabled: boolean): Promise<void> {
    const model = props.store.rowsOf(provider.id).rows.find((item) => item.id === id);
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
const addError = ref("");
const addBusy = ref(false);
const templates = props.store.templates;
const addedTemplates = computed(() => [...new Set(providers.value.map((provider) => provider.template))]);

async function openAdd(): Promise<void> {
    adding.value = true;
    addError.value = "";
    await props.store.loadTemplates();
    if (templates.value === null) addError.value = failureReason(text, {code: "unavailable", detail: ""});
}

async function addProvider(input: AddInput): Promise<void> {
    addBusy.value = true;
    const result = await props.store.call("addProvider", input);
    addBusy.value = false;
    if (!result.ok) {
        addError.value = failureReason(text, result.failure);
        return;
    }
    adding.value = false;
    selected.value = result.value.id;
    // 新服务商要密钥时焦点直接到密钥框（下一步就是填它）；不要认证的没有密钥框，焦点留给对话框还回的位置。
    await nextTick();
    focusKeyInput();
}
/** 详情里的 API 密钥框：nb-ui 的 `Input` 把钩子放在外层，取里面的 `input`。 */
function focusKeyInput(): void {
    const key = page.value?.querySelector<HTMLElement>("[data-key-input]");
    (key instanceof HTMLInputElement ? key : key?.querySelector<HTMLElement>("input") ?? key)?.focus();
}

// ---- 编辑与手动添加 ----
const editTarget = ref<{readonly provider: string; readonly model: string | null} | null>(null);
const editProvider = computed(() => providers.value.find((provider) => provider.id === editTarget.value?.provider) ?? null);
const editModel = computed(() => (editProvider.value === null ? null : props.store.rowsOf(editProvider.value.id).rows.find((model) => model.id === editTarget.value?.model) ?? null));
const editRows = computed(() => (editProvider.value === null ? [] : props.store.rowsOf(editProvider.value.id).rows));
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
    void props.store.loadRows(provider);
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
const manageError = ref("");
const manageBusy = ref(false);
let manageToken = 0;

/** 候选是这家来源里的全部模型：在列表里的，加上可加的（移出过的、没加过的、类型不明的）。 */
async function loadCandidates(provider: SnapshotProvider): Promise<void> {
    const token = (manageToken += 1);
    candidates.value = null;
    manageError.value = "";
    await Promise.all([props.store.loadRows(provider.id, "listed"), props.store.loadRows(provider.id, "available")]);
    // 对话框关了或又发起了一次：迟到的结果丢掉（输出 10）。
    if (token !== manageToken || !managing.value) return;
    const failure = props.store.rowsOf(provider.id, "listed").failure ?? props.store.rowsOf(provider.id, "available").failure;
    // “完成”只提交相对打开时的改动：以这次读到的列表为准（打开前刚拉过列表、选用数据还没换过来时，旧的缓存会少几行）。
    manageOpenedWith.value = props.store.rowsOf(provider.id, "listed").rows.map((model) => model.id);
    if (failure !== null) manageError.value = failureReason(text, failure);
    else candidates.value = [...props.store.rowsOf(provider.id, "listed").rows, ...props.store.rowsOf(provider.id, "available").rows].map((model) => ({id: model.id, name: model.name, vision: model.vision, reasoning: model.reasoning, incomplete: model.status === "incomplete", unknown: model.kind === "unknown"}));
}

/** 打开“管理模型”时这家列表里的模型：“完成”只提交相对它的改动，打开期间别处加的模型不会被当成“要移出”。 */
const manageOpenedWith = ref<readonly string[]>([]);

function openManage(provider: SnapshotProvider): void {
    manageOpenedWith.value = props.store.rowsOf(provider.id).rows.map((model) => model.id);
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
    // 都是来源里的模型：设置里只记“在列表里、启用与否”，能力字段跟着来源走。缺上下文窗口的加入后停用，补上字段才能启用（输出 7）。
    const add: ModelConfig[] = change.add.map((item) => ({id: item.id, enabled: !item.incomplete}));
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
/** 左栏条目上的删除图标、右键菜单与 Delete 键，以及窄布局下拉旁的按钮（输出 12）。 */
function openRemove(id: string): void {
    const target = providers.value.find((provider) => provider.id === id) ?? null;
    removeOpenedWith = target;
    removeId.value = target?.id ?? null;
    removing.value = target !== null;
}
const removeDescription = computed(() => {
    const target = removeTarget.value;
    if (target === null) return "";
    const known = props.store.rowsOf(target.id).rows;
    const affected = rolesUsing(roles.value, target.id).map((role) => {
        const model = known.find((item) => referenceOf(target.id, item.id) === role.model);
        return `${roleName(text, role)}（${model?.name ?? role.model}）`;
    });
    const models = text("remove.models", {count: target.modelCount});
    return affected.length === 0 ? models : `${models}${text("remove.roles", {roles: affected.join("、")})}`;
});
const page = ref<HTMLElement | null>(null);

/**
 * 打开时定位（settings-pages.md 输出 18，对话的提示卡用）：`"add"` 打开添加窗口；服务商 id 选中这家、聚焦密钥框。快照到了再取走；
 * 不认识的取走后忽略。
 */
watch([() => props.focus, snapshot], async ([focus, current]) => {
    if (focus === null || current === null) return;
    const target = props.takeFocus();
    // 取走之后再看能不能写：不能写时页面上的“添加服务商”是停用的，这里也不替用户打开（取走免得等着的值留下来）。
    if (target === null || (target === "add" && disabled.value)) return;
    if (target === "add") {
        await openAdd();
        return;
    }
    if (!current.providers.some((provider) => provider.id === target)) return;
    selected.value = target;
    await nextTick();
    focusKeyInput();
}, {immediate: true});

/**
 * 进行中的删除：交回删除后焦点去的地方，失败为 null（输出 12）。删的是当前选中的那家时选中并聚焦下一家（没有时上一家，都没有时
 * “添加服务商”）；删的是别的一家时选中不变，焦点回到当前项。确认框在“删除”按下时就开始关闭，它的 `closed` 可能早于删除的结果，
 * 所以关闭的处理等这个 Promise。
 */
let removal: Promise<string | null> | null = null;

function removeProvider(): void {
    const provider = removeTarget.value;
    if (provider === null) return;
    const others = providers.value.filter((item) => item.id !== provider.id);
    const index = providers.value.findIndex((item) => item.id === provider.id);
    // 下一家（删掉后同一个位置上的那家），没有时上一家。
    const neighbour = index < 0 ? others[0] ?? null : others[index] ?? others[index - 1] ?? null;
    // 删之前定：快照事件可能先于写入的结果到，那时上面的 watch 已把选中改成“全部模型”，再看选中就认不出删的是当前这家。
    const wasSelected = selected.value === provider.id;
    removal = (async () => {
        const result = await props.store.call("removeProvider", {id: provider.id});
        if (!result.ok) {
            report(subjectOf(provider), result.failure);
            return null;
        }
        if (!wasSelected) return selected.value;
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
    // 取消或删除失败：焦点回到那家的条目（确认框没有触发器，nb-ui 不替它归还焦点）；窄布局里是下拉旁的删除按钮。
    if (target === null) {
        await nextTick();
        if (removed !== undefined) focusVisible([`[data-provider-rail-item="${CSS.escape(removed)}"]`, "[data-provider-remove-current]"]);
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
        <p v-if="!store.available.value" class="providers-page__notice" role="status">{{ text("readOnly") }}</p>
        <p v-if="snapshot === null && store.available.value" class="providers-page__loading">{{ text("connection.key.loading") }}</p>
        <div v-else-if="snapshot !== null" class="providers-page__split">
            <ProviderRail v-if="providers.length > 0" class="providers-page__rail" :providers="providers" :current="selected" :checks="store.checks" :disabled="disabled" @select="(id) => (selected = id)" @add="openAdd" @remove="openRemove" />
            <div class="providers-page__detail">
                <div v-if="providers.length > 0" class="providers-page__picker">
                    <Select :model-value="selected" :options="pickerOptions" size="sm" :aria-label="text('rail.label')" data-provider-picker @update:model-value="(value: string) => (selected = value)" />
                    <Tooltip v-if="current !== null" :text="text('remove.button')">
                        <IconButton size="sm" icon-class="i-lucide-trash-2" :aria-label="text('remove.label', {name: current.name})" :disabled="disabled" data-provider-remove-current @click="openRemove(current.id)" />
                    </Tooltip>
                    <Button size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="disabled" data-provider-add @click="openAdd">{{ text("rail.addShort") }}</Button>
                </div>
                <EmptyState v-if="providers.length === 0" icon-class="i-lucide-cloud" :title="text('empty.title')" :description="text('empty.description')">
                    <template #action>
                        <Button variant="primary" size="sm" icon-class="i-lucide-plus" :disabled="disabled" data-provider-add @click="openAdd">{{ text("rail.add") }}</Button>
                    </template>
                </EmptyState>
                <template v-else-if="current !== null">
                    <ProviderHeader
                        :key="`header-${current.id}`"
                        :provider="current"
                        :taken-names="takenNames"
                        :builtin-keys="builtinKeys"
                        :disabled="disabled"
                        :icon-busy="iconBusy"
                        :icon-error="iconError"
                        :duplicating="duplicating"
                        @rename="(name) => renameProvider(current!, name)"
                        @set-icon="(icon) => setIcon(current!, icon)"
                        @duplicate="duplicateProvider(current!)"
                    />
                    <ProviderDetail
                        :key="current.id"
                        :provider="current"
                        :rows="currentRows?.rows ?? []"
                        :rows-loading="currentRows?.loading ?? false"
                        :rows-failure="currentRows?.failure === null || currentRows === null ? '' : failureReason(text, currentRows.failure)"
                        :template="currentTemplate"
                        @reload-rows="store.loadRows(current!.id)"
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
                        @check-all="checkAll(current!)"
                        :check-run="store.checkRuns.get(current.id) ?? null"
                        :detect="detectState(current)"
                        @detect="(model) => detectApi(current!, model)"
                        @cancel-detect="stopDetect"
                        @adopt="(api, connection) => adoptApi(current!, api, connection)"
                        @cancel-checks="store.cancel(current!.id)"
                        @cancel-check="(id) => store.cancel(current!.id, id)"
                        @edit-model="(id) => openEdit(current!.id, id)"
                        @add-model="openEdit(current!.id, null)"
                        @manage="openManage(current!)"
                        :source-error="sourceErrors.get(current.id) ?? ''"
                        @refresh-source="refreshSource(current!)"
                    />
                </template>
                <template v-else>
                    <h3 class="providers-page__heading">{{ text("rail.all") }}</h3>
                    <AllModelsView :providers="providers" :rows="allRows.rows" :loading="allRows.loading" :failures="allRows.failures" :checks="store.checks" :disabled="disabled" @edit="openEdit" @load="(id) => store.loadRows(id)" />
                </template>
            </div>
        </div>
        <AddProviderDialog v-model:open="adding" :templates="templates" :added="addedTemplates" :error="addError" :busy="addBusy" @add="addProvider" />
        <ModelEditDialog
            v-if="editProvider !== null"
            :open="editTarget !== null"
            :model="editModel"
            :taken-ids="editRows.map((model) => model.id)"
            :busy="editBusy"
            :error="editError"
            @update:open="(value) => { if (!value) editTarget = null; }"
            @save="saveModel"
        />
        <ManageModelsDialog
            v-if="current !== null"
            v-model:open="managing"
            :provider-name="current.name"
            :candidates="candidates"
            :current="manageOpenedWith"
            :role-usage="roleUsage(current)"
            :error="manageError"
            :busy="manageBusy"
            @done="(change) => applyManage(current!, change)"
        />
        <AlertDialog
            v-if="checkConfirm !== null"
            v-model:open="checkConfirmOpen"
            :title="text('models.confirmCheckAll.title', {count: String(checkConfirm.models.length), provider: checkConfirm.name})"
            :description="text('models.confirmCheckAll.description', {concurrency: String(CHECK_CONCURRENCY)})"
            :confirm-label="text('models.confirmCheckAll.action')"
            tone="neutral"
            data-check-all-confirm
            @confirm="confirmCheckAll"
            @closed="onCheckConfirmClosed"
        />
        <AlertDialog v-if="removeTarget !== null" v-model:open="removing" :title="text('remove.title', {name: removeTarget.name})" :description="removeDescription" :confirm-label="text('remove.confirm')" @confirm="removeProvider" @closed="onRemoveClosed" />
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
