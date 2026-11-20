<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from "vue";
import {AnchoredPopover, Input, SegmentedControl} from "@notnotype/nb-ui/components";
import {effortViewOf} from "../../composer-effort";
import {THINKING_LEVEL_KEYS, THINKING_SHORT_KEYS} from "../../composer-actions";
import {formatTokens} from "../../process-summary";
import type {ComposerEffortView, ComposerGroupView, ComposerIcon, ComposerModelView, ComposerRoleView} from "../../types";
import {useAgentText} from "../host";
import AgentIcon from "./AgentIcon.vue";

const props = withDefaults(defineProps<{
    roles: readonly ComposerRoleView[];
    models: readonly ComposerModelView[];
    modelKey: string | null;
    /** 现在实际用的模型；解析不到时为 null。 */
    effectiveModel?: string | null;
    thinkingLevels: readonly string[];
    thinking: string | null;
    /** 思考档的完整状态；不给时按 `thinkingLevels` 与 `thinking` 推出。 */
    effort?: ComposerEffortView | null;
    /** 模型库的分组；不给时按每个模型的 `group` 名分组。 */
    groups?: readonly ComposerGroupView[];
    /** 面板的锚点与宽度：输入框。没有时贴着触发器，用缺省宽度。 */
    anchor?: Element | null;
    disabled?: boolean;
    showImageSupport?: boolean;
    canManage?: boolean;
}>(), {
    effectiveModel: null,
    effort: null,
    groups: () => [],
    anchor: null,
    disabled: false,
    showImageSupport: true,
    canManage: false,
});

const emit = defineEmits<{
    (e: "select-model", modelKey: string): void;
    (e: "select-thinking", level: string): void;
    /** 回到“跟随”：不再明确选档。 */
    (e: "reset-thinking"): void;
    (e: "manage"): void;
}>();

defineOptions({inheritAttrs: false});

const {t} = useAgentText();

const FOLLOW_KEY = "";
const DEFAULT_WIDTH = 360;
/** 超过这个个数的组默认收起（只展开当前模型附近），搜索时不收。 */
const BIG_GROUP = 30;
/** 大组里当前模型前后各展开几行。 */
const WINDOW_ROWS = 10;
/** 面板窄于它或档位多于 5 个时，分段里写缩写。 */
const NARROW_WIDTH = 400;

const open = ref(false);
const page = ref<"roles" | "models">("roles");
const query = ref("");
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const popoverRef = ref<{contains(node: Node): boolean} | null>(null);
const width = ref(DEFAULT_WIDTH);
const noteId = useId();

const pages = computed(() => [{label: t("composer.model.roles"), value: "roles"}, {label: t("composer.model.models"), value: "models"}]);
const gradient = computed(() => props.roles.filter((role) => role.axis === "gradient"));
const specialist = computed(() => props.roles.filter((role) => role.axis === "specialist"));
const follow = computed(() => props.models.find((model) => model.key === FOLLOW_KEY) ?? null);
const currentRole = computed(() => props.roles.find((role) => role.key === props.modelKey) ?? null);
const currentModel = computed(() => props.models.find((model) => model.key === props.modelKey) ?? null);

function levelLabel(level: string): string {
    const key = THINKING_LEVEL_KEYS[level];
    return key === undefined ? level : t(key);
}
function shortLabel(level: string): string {
    const key = THINKING_SHORT_KEYS[level];
    return key === undefined ? level : t(key);
}

const selectedName = computed(() => currentRole.value?.name ?? currentModel.value?.label ?? props.modelKey ?? t("composer.model.none"));
/** 选的是角色或跟随默认时，实际用的模型另写一段；选的就是模型时不重复。 */
const usedModel = computed(() => (currentRole.value !== null || props.modelKey === FOLLOW_KEY ? props.effectiveModel : null));

// ─── 头部：当前选择 ──────────────────────────────────────────────────────

const ROLE_FALLBACK_ICON: ComposerIcon = {kind: "class", name: "i-lucide-sparkles"};
function groupOf(model: ComposerModelView | null): ComposerGroupView | null {
    if (model === null || model.groupId === undefined) return null;
    return props.groups.find((group) => group.id === model.groupId) ?? null;
}
/** 头部与触发器画的服务商图标：选了角色画它绑定的模型的；选了模型画它所在组的。 */
const currentModelIcon = computed<ComposerIcon | null>(() => currentRole.value?.modelIcon ?? groupOf(currentModel.value)?.icon ?? null);
const currentRoleIcon = computed<ComposerIcon | null>(() => (currentRole.value === null ? null : currentRole.value.icon ?? ROLE_FALLBACK_ICON));

// ─── 思考档 ──────────────────────────────────────────────────────────────

const effortView = computed(() => effortViewOf({effort: props.effort ?? undefined, thinkingLevels: [...props.thinkingLevels], thinking: props.thinking}));
/** 用户刚选、还没写出去的档：控件立刻跟手；写出去、宿主的值跟上之后撤掉。 */
const pending = ref<string | null>(null);
const shown = computed(() => pending.value ?? effortView.value.value);
/** 跟随来的当前档只画细框；用户刚选的不算。 */
const inherited = computed(() => pending.value === null && (effortView.value.source === "role" || effortView.value.source === "model"));
const compactLabels = computed(() => effortKeys.value.length > 5 || width.value < NARROW_WIDTH);
const effortKeys = computed(() => [...(effortView.value.canOff ? ["off"] : []), ...effortView.value.levels]);
const effortOptions = computed(() => effortKeys.value.map((key) => ({value: key, label: compactLabels.value ? shortLabel(key) : levelLabel(key), title: levelLabel(key)})));
const effortText = computed(() => (shown.value === null ? null : levelLabel(shown.value)));
/** 控件右边（窄时换到下一行）的说明：跟随来的写“跟随谁”，明确选的给“用默认”，没有控件时写原因。 */
const effortNote = computed(() => {
    const view = effortView.value;
    if (view.kind === "none") return t("composer.model.effortNone");
    if (view.kind === "fixed") return t("composer.model.effortFixed");
    if (inherited.value) return view.source === "role" ? t("composer.model.followRole", {name: view.follow?.name ?? ""}) : t("composer.model.followModel");
    if (view.value === null && view.source === null) return t("composer.model.effortProviderDefault");
    return null;
});
const resetLabel = computed(() => {
    const view = effortView.value;
    if (view.kind !== "levels" || view.source !== "session" || view.follow === null || view.follow === undefined) return null;
    return view.follow.source === "role" ? t("composer.model.useRole", {name: view.follow.name ?? ""}) : t("composer.model.useModel");
});

/**
 * 选档立刻显示、停 200 毫秒才写：方向键连按时每一档都写一次设置，多次写入的先后没有保证，停下时可能落在中间那一档。
 * 跟随来的当前档被再次选中也要写（钉成明确选择），所以不按“值没变就不发”过滤。
 */
const THINKING_SETTLE_MS = 200;
/** 写出去之后等宿主回写的上限：写失败时放手，别让控件停在没生效的档上。 */
const THINKING_RELEASE_MS = 1500;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
function clearTimers(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    settleTimer = null;
    releaseTimer = null;
}
/** 窗口内的选择立刻写出去（卸载、换角色或模型之前调：后到的动作不能排在它前面）。 */
function flushPending(): void {
    if (settleTimer === null || pending.value === null) return;
    clearTimeout(settleTimer);
    settleTimer = null;
    writePending(pending.value);
}
/** 取消还没写出去的选择（用户随后点了“用默认”：最后一个动作赢）。 */
function cancelPending(): void {
    clearTimers();
    pending.value = null;
}
function writePending(value: string): void {
    emit("select-thinking", value);
    // 上一次写出去留下的放手计时器要换掉：它到点会把新的 pending 清掉，控件在宿主回写之前跳回旧档。
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        releaseTimer = null;
        pending.value = null;
    }, THINKING_RELEASE_MS);
}
function onEffort(value: unknown): void {
    if (typeof value !== "string") return;
    pending.value = value;
    // 新的选择开始：上一次的放手计时器作废，宿主回写或新一轮的放手由这一次接管。
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = null;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        settleTimer = null;
        writePending(value);
    }, THINKING_SETTLE_MS);
}
function onReset(): void {
    cancelPending();
    emit("reset-thinking");
}
watch(() => [effortView.value.value, effortView.value.source], () => {
    if (pending.value !== null && effortView.value.source === "session" && effortView.value.value === pending.value && settleTimer === null) {
        pending.value = null;
        if (releaseTimer !== null) clearTimeout(releaseTimer);
        releaseTimer = null;
    }
});

const triggerText = computed(() => [selectedName.value, usedModel.value, effortText.value].filter((part) => part !== null).join(" · "));

// ─── 模型库：分组、大组收起、当前项附近 ───────────────────────────────────

const ungrouped = "";
type Section = {id: string; name: string; icon: ComposerIcon | null; models: ComposerModelView[]; total: number};
/** 同组的排在一起，搜索按显示名、组名与 key。“跟随默认”在角色页，这里不列。 */
const sections = computed<Section[]>(() => {
    const needle = query.value.trim().toLowerCase();
    const byId = new Map<string, Section>();
    for (const model of props.models) {
        if (model.key === FOLLOW_KEY) continue;
        const declared = groupOf(model);
        const id = model.groupId ?? model.group ?? ungrouped;
        const name = declared?.name ?? model.group ?? "";
        if (needle !== "" && ![model.label, name, model.key].some((text) => text.toLowerCase().includes(needle))) continue;
        const section = byId.get(id) ?? {id, name, icon: declared?.icon ?? null, models: [], total: 0};
        section.models.push(model);
        section.total = section.models.length;
        byId.set(id, section);
    }
    return [...byId.values()];
});
const searching = computed(() => query.value.trim() !== "");

/** 用户手动展开（true）或收起（false）过的组；没动过的按个数定。 */
const override = ref(new Map<string, boolean>());
function isBig(section: Section): boolean {
    return section.total > BIG_GROUP;
}
function rowsOf(section: Section): {rows: ComposerModelView[]; partial: boolean} {
    if (searching.value) return {rows: section.models, partial: false};
    const forced = override.value.get(section.id);
    if (forced === false) return {rows: [], partial: false};
    if (forced === true || !isBig(section)) return {rows: section.models, partial: false};
    // 大组默认收起；当前模型在里面时只展开它前后各几行，不一次渲染几百行。
    const at = section.models.findIndex((model) => model.key === props.modelKey);
    if (at < 0) return {rows: [], partial: false};
    return {rows: section.models.slice(Math.max(0, at - WINDOW_ROWS), at + WINDOW_ROWS + 1), partial: true};
}
function expandedRows(section: Section): boolean {
    const {rows, partial} = rowsOf(section);
    return rows.length > 0 && !partial;
}
function toggleSection(section: Section): void {
    const {rows} = rowsOf(section);
    override.value = new Map(override.value).set(section.id, rows.length === 0);
}
function showAll(section: Section): void {
    override.value = new Map(override.value).set(section.id, true);
}

function priceText(model: ComposerModelView): string | null {
    return model.price === undefined || model.price === null ? null : `$${String(model.price.input)} / $${String(model.price.output)}`;
}

function selectRole(key: string): void {
    // 选了角色通常还要看绑定的是谁、调思考档，面板不关。
    flushPending();
    emit("select-model", key);
}

function selectModel(model: ComposerModelView): void {
    if (model.unavailable !== undefined) return;
    flushPending();
    emit("select-model", model.key);
    close();
}

function close(): void {
    if (!open.value) return;
    open.value = false;
    triggerRef.value?.focus();
}

function toggle(): void {
    if (props.disabled) return;
    if (open.value) {
        close();
        return;
    }
    width.value = props.anchor?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
    query.value = "";
    page.value = "roles";
    override.value = new Map();
    open.value = true;
    // 面板传送到 body，焦点进去之后 Tab 才在面板里走。
    void nextTick(() => panelRef.value?.focus());
}

/** Tab 走出面板就关：面板传送在 body 上，焦点走出去之后再也回不来。 */
function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next !== null && !panelRef.value?.contains(next) && !triggerRef.value?.contains(next)) open.value = false;
}

/** `/model 参数`：打开模型库，参数填进搜索；没有参数时打开角色页。 */
function openPicker(search = ""): void {
    if (props.disabled) return;
    if (!open.value) toggle();
    query.value = search;
    page.value = search === "" ? "roles" : "models";
}

defineExpose({openPicker});

// ─── 键盘：行与组头、搜索框在同一条方向键序列里 ────────────────────────────

/** 当前页里能用方向键走到的元素，按页面顺序：搜索框、组头、行；折叠组的行不在 DOM 里，自然不在序列中。 */
function navigables(): HTMLElement[] {
    return [...(bodyRef.value?.querySelectorAll<HTMLElement>("input, [data-roving]:not(:disabled)") ?? [])];
}
function onBodyKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target === null || event.altKey || event.ctrlKey || event.metaKey) return;
    const inSearch = target.matches("input");
    // 搜索框里只认上下键：Home、End 是移动光标。
    if (inSearch && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = navigables();
    const from = items.indexOf(target);
    if (from < 0) return;
    let to = from;
    if (event.key === "ArrowDown") to = Math.min(items.length - 1, from + 1);
    else if (event.key === "ArrowUp") to = Math.max(0, from - 1);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = items.length - 1;
    else return;
    event.preventDefault();
    items[to]?.focus();
}

/** 焦点在行上、行被收起（搜索清空后回到默认的收起状态）时，焦点落到那一组的组头，不掉到页面上。 */
let lastGroup: string | null = null;
function onBodyFocusin(event: FocusEvent): void {
    const group = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-group]")?.dataset.group;
    if (group !== undefined) lastGroup = group;
}
watch(query, () => {
    void nextTick(() => {
        const panel = panelRef.value;
        if (panel === null || panel.contains(document.activeElement)) return;
        const head = lastGroup === null ? null : [...(bodyRef.value?.querySelectorAll<HTMLElement>("[data-group-head]") ?? [])].find((item) => item.dataset.groupHead === lastGroup);
        (head ?? panel).focus();
    });
});

watch(page, async (value) => {
    if (value !== "models") return;
    // 打开模型库时当前模型滚进可见（没有就不动）。
    await nextTick();
    (bodyRef.value?.querySelector("[data-model-picker-model][aria-current='true']") as HTMLElement | null)?.scrollIntoView?.({block: "nearest"});
});

function onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target === null || popoverRef.value?.contains(target) === true || triggerRef.value?.contains(target) === true) return;
    open.value = false;
}

watch(open, (value) => {
    if (value) document.addEventListener("pointerdown", onDocumentPointerDown, true);
    else document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});
watch(() => props.disabled, (disabled) => {
    if (disabled) open.value = false;
});
onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    // 窗口内选的档不丢：输入框随会话卸载时也照样写出去。
    flushPending();
    clearTimers();
});
</script>

<template>
    <button
        ref="triggerRef"
        type="button"
        class="acv-role-picker__trigger"
        :disabled="props.disabled"
        :title="triggerText"
        :aria-expanded="open"
        aria-haspopup="dialog"
        v-bind="$attrs"
        data-model-picker
        @click="toggle"
    >
        <AgentIcon v-if="currentRoleIcon !== null" :icon="currentRoleIcon" :size="12" class="acv-role-picker__ticon" />
        <span class="acv-role-picker__text">
            <!-- 选了角色：角色名 · 服务商图标 实际用的模型；选了模型或跟随默认：服务商图标 名字 · 实际用的模型。 -->
            <AgentIcon v-if="currentRole === null" :icon="currentModelIcon" :size="12" class="acv-role-picker__ticon" />
            <span class="acv-role-picker__name">{{ selectedName }}</span>
            <template v-if="usedModel !== null"> · </template>
            <AgentIcon v-if="currentRole !== null && usedModel !== null" :icon="currentModelIcon" :size="12" class="acv-role-picker__ticon" />
            <span v-if="usedModel !== null" class="acv-role-picker__used">{{ usedModel }}</span>
        </span>
        <span v-if="effortText !== null" class="acv-role-picker__level" :class="{'is-following': inherited}">· {{ effortText }}</span>
        <span class="i-lucide-chevron-down acv-role-picker__chevron" aria-hidden="true" />
    </button>
    <AnchoredPopover ref="popoverRef" :open="open" :anchor="props.anchor ?? triggerRef" side="top" :side-offset="6">
        <div
            ref="panelRef"
            class="acv-role-picker"
            :style="{width: `${String(width)}px`}"
            role="dialog"
            :aria-label="t('composer.model.title')"
            tabindex="-1"
            data-model-picker-panel
            @keydown.esc.stop.prevent="close"
            @focusout="onFocusOut"
        >
            <div class="acv-role-picker__head">
                <div class="acv-role-picker__current">
                    <AgentIcon v-if="currentRoleIcon !== null" :icon="currentRoleIcon" :size="14" class="acv-role-picker__role-icon" />
                    <span v-if="currentRole !== null" class="acv-role-picker__strong">{{ currentRole.name }}</span>
                    <span v-if="currentRole !== null && usedModel !== null" class="acv-role-picker__muted" aria-hidden="true">·</span>
                    <AgentIcon :icon="currentModelIcon" :size="14" />
                    <span :class="currentRole === null ? 'acv-role-picker__strong' : 'acv-role-picker__muted'" class="acv-role-picker__current-model">{{ usedModel ?? (currentRole === null ? selectedName : t("composer.model.unbound")) }}</span>
                    <span class="acv-role-picker__spacer" />
                    <SegmentedControl v-model="page" :options="pages" size="xs" class="acv-role-picker__pages" data-model-picker-pages />
                </div>
                <div class="acv-role-picker__effort" :class="{'is-many': effortKeys.length > 5}">
                    <span class="i-lucide-brain acv-role-picker__icon" aria-hidden="true" />
                    <span class="acv-role-picker__effort-label">{{ t("composer.model.thinking") }}</span>
                    <SegmentedControl
                        v-if="effortView.kind === 'levels'"
                        :model-value="shown"
                        :options="effortOptions"
                        variant="raised"
                        size="xs"
                        full-width
                        :inherited="inherited"
                        :describedby="noteId"
                        :aria-label="t('composer.model.thinking')"
                        class="acv-role-picker__levels"
                        data-model-picker-thinking
                        @update:model-value="onEffort"
                    />
                    <span :id="noteId" class="acv-role-picker__effort-note" data-model-picker-effort-note>
                        <template v-if="effortNote !== null">{{ effortNote }}</template>
                        <button v-else-if="resetLabel !== null" type="button" class="acv-role-picker__reset" data-model-picker-reset @click="onReset">
                            <span class="i-lucide-rotate-ccw" aria-hidden="true" />{{ resetLabel }}
                        </button>
                        <span v-if="effortView.kind === 'levels' && !effortView.verified" class="i-lucide-circle-help acv-role-picker__help" :title="t('composer.model.effortUnverified')" role="img" :aria-label="t('composer.model.effortUnverified')" />
                    </span>
                </div>
            </div>
            <div ref="bodyRef" class="acv-role-picker__body" @keydown="onBodyKeydown" @focusin="onBodyFocusin">
                <template v-if="page === 'roles'">
                    <button
                        v-if="follow !== null"
                        type="button"
                        class="acv-role-picker__row"
                        :class="{'is-active': props.modelKey === FOLLOW_KEY}"
                        :aria-current="props.modelKey === FOLLOW_KEY ? 'true' : undefined"
                        data-roving
                        data-model-picker-role=""
                        @click="selectRole(FOLLOW_KEY)"
                    >
                        <span class="i-lucide-corner-down-right acv-role-picker__role-icon" aria-hidden="true" />
                        <span class="acv-role-picker__row-name">{{ follow.label }}</span>
                        <span class="acv-role-picker__check" :class="{'i-lucide-check': props.modelKey === FOLLOW_KEY}" aria-hidden="true" />
                    </button>
                    <template v-for="(roles, index) in [gradient, specialist]" :key="index">
                        <div v-if="roles.length > 0 && index === 1" class="acv-role-picker__group">{{ t("composer.model.specialist") }}</div>
                        <div class="acv-role-picker__roles">
                            <button
                                v-for="role in roles"
                                :key="role.key"
                                type="button"
                                class="acv-role-picker__row"
                                :class="{'is-active': role.key === props.modelKey, 'is-off': role.unavailable !== undefined}"
                                :title="role.unavailable"
                                :aria-current="role.key === props.modelKey ? 'true' : undefined"
                                :data-model-picker-role="role.key"
                                data-roving
                                @click="selectRole(role.key)"
                            >
                                <AgentIcon :icon="role.icon ?? ROLE_FALLBACK_ICON" :size="14" class="acv-role-picker__role-icon" />
                                <span class="acv-role-picker__row-name">{{ role.name }}</span>
                                <span class="acv-role-picker__row-right">
                                    <template v-if="role.modelLabel !== null">
                                        <AgentIcon :icon="role.modelIcon ?? null" :size="13" />
                                        <span class="acv-role-picker__row-model" :class="{'is-off': role.unavailable !== undefined}">{{ role.modelLabel }}</span>
                                        <span v-if="role.effort !== undefined && role.effort !== null" class="acv-role-picker__row-effort">{{ levelLabel(role.effort) }}</span>
                                    </template>
                                    <span v-else class="acv-role-picker__unbound">{{ t("composer.model.unbound") }}</span>
                                </span>
                                <span class="acv-role-picker__check" :class="{'i-lucide-check': role.key === props.modelKey}" aria-hidden="true" />
                            </button>
                        </div>
                    </template>
                </template>
                <template v-else>
                    <div class="acv-role-picker__search"><Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="t('composer.model.search')" :aria-label="t('composer.model.search')" data-model-picker-search /></div>
                    <p v-if="sections.length === 0" class="acv-role-picker__hint">{{ t("composer.model.noMatch") }}</p>
                    <section v-for="section in sections" :key="section.id" class="acv-role-picker__section" :data-group="section.id">
                        <button
                            type="button"
                            class="acv-role-picker__group-head"
                            :aria-expanded="rowsOf(section).rows.length > 0"
                            :aria-label="t('composer.model.groupLabel', {name: section.name === '' ? t('composer.model.unusedGroup') : section.name, count: section.total})"
                            :data-group-head="section.id"
                            data-roving
                            @click="toggleSection(section)"
                        >
                            <span :class="rowsOf(section).rows.length > 0 ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="acv-role-picker__chev" aria-hidden="true" />
                            <AgentIcon :icon="section.icon ?? (section.name === '' ? null : {kind: 'initial', text: Array.from(section.name)[0] ?? '?'})" :size="14" />
                            <span>{{ section.name === "" ? t("composer.model.unusedGroup") : section.name }}</span>
                            <span class="acv-role-picker__count">{{ section.total }}</span>
                        </button>
                        <button
                            v-for="model in rowsOf(section).rows"
                            :key="model.key"
                            type="button"
                            class="acv-role-picker__row acv-role-picker__model-row"
                            :class="{'is-active': model.key === props.modelKey, 'is-off': model.unavailable !== undefined}"
                            :disabled="model.unavailable !== undefined"
                            :title="model.unavailable"
                            :aria-current="model.key === props.modelKey ? 'true' : undefined"
                            :data-model-picker-model="model.key"
                            data-roving
                            @click="selectModel(model)"
                        >
                            <span class="acv-role-picker__row-name">{{ model.label }}</span>
                            <span v-if="model.reasoning === true" class="i-lucide-brain acv-role-picker__cap" :title="t('composer.model.reasoning')" />
                            <span v-if="props.showImageSupport && !model.supportsImages" class="i-lucide-image-off acv-role-picker__cap" :title="t('composer.model.noImages')" />
                            <span class="acv-role-picker__row-right acv-role-picker__muted">
                                <template v-if="model.contextWindow !== undefined && model.contextWindow !== null">{{ formatTokens(model.contextWindow) }}</template>
                                <template v-if="priceText(model) !== null"> · {{ priceText(model) }}</template>
                            </span>
                            <span class="acv-role-picker__check" :class="{'i-lucide-check': model.key === props.modelKey}" aria-hidden="true" />
                        </button>
                        <button
                            v-if="!searching && rowsOf(section).partial"
                            type="button"
                            class="acv-role-picker__show-all"
                            data-roving
                            data-model-picker-show-all
                            @click="showAll(section)"
                        >{{ t("composer.model.showAll", {count: section.total}) }}</button>
                    </section>
                </template>
            </div>
            <div v-if="props.canManage" class="acv-role-picker__foot">
                <button type="button" class="acv-role-picker__manage" data-model-picker-manage @click="emit('manage'); close()">
                    <span class="i-lucide-settings-2 acv-role-picker__icon" aria-hidden="true" />{{ t("composer.model.manage") }}
                </button>
            </div>
        </div>
    </AnchoredPopover>
</template>

<style scoped>
.acv-role-picker__trigger {
    display: inline-flex;
    min-width: 0;
    height: 26px;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

.acv-role-picker__trigger:hover:not(:disabled),
.acv-role-picker__trigger[aria-expanded="true"] {
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
    color: var(--text-main);
}

.acv-role-picker__trigger:focus-visible,
.acv-role-picker__row:focus-visible,
.acv-role-picker__group-head:focus-visible,
.acv-role-picker__show-all:focus-visible,
.acv-role-picker__reset:focus-visible,
.acv-role-picker__manage:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-role-picker__trigger:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

/* 一行文字（开发者在评审板 review v5 选的）：靠颜色分主次，不靠边框。 */
.acv-role-picker__trigger .acv-role-picker__text {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
}

.acv-role-picker__trigger .acv-role-picker__name {
    color: var(--text-secondary);
    font-weight: 400;
}

/* text-overflow 只对块级的文字容器有效，对 flex 容器本身无效：省略写在各段文字自己身上，长了各段一起收缩。 */
.acv-role-picker__trigger .acv-role-picker__name,
.acv-role-picker__trigger .acv-role-picker__used {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-role-picker__trigger .acv-role-picker__level {
    flex: none;
    color: var(--accent-text);
}

/* 跟随来的档不是用户明确选的：次要色，和明确选的强调色分开。 */
.acv-role-picker__trigger .acv-role-picker__level.is-following {
    color: var(--text-muted);
}

.acv-role-picker__trigger .acv-role-picker__chevron {
    flex: none;
    width: 12px;
    height: 12px;
    color: var(--text-muted);
}

.acv-role-picker__ticon {
    color: var(--text-muted);
}

.acv-role-picker__icon {
    flex: none;
    width: 13px;
    height: 13px;
}

/* 省略只吃前两段（角色或模型名、实际用的模型）：档位放不下就没有意义了。 */
.acv-role-picker__text {
    min-width: 0;
    max-width: 18em;
    overflow: hidden;
    white-space: nowrap;
}

.acv-role-picker {
    display: flex;
    /* 两页同一高度：切页时面板不跳（开发者 2026-11-06）。 */
    height: min(400px, 60vh);
    flex-direction: column;
    outline: none;
    color: var(--text-main);
    font-size: var(--text-xs);
}

.acv-role-picker__head {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--divider, var(--border-color));
}

.acv-role-picker__current {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
}

.acv-role-picker__current-model {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-role-picker__spacer {
    flex: 1;
}

.acv-role-picker__strong {
    font-weight: var(--weight-strong);
}

.acv-role-picker__muted {
    color: var(--text-muted);
}

.acv-role-picker__hint {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-role-picker__pages {
    width: 124px;
    flex: none;
}

/* 图标与角色图标同一列、各档等宽；说明窄时换到下一行贴右。 */
.acv-role-picker__effort {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
}

.acv-role-picker__effort > .acv-role-picker__icon {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.acv-role-picker__effort-label {
    flex: none;
    margin-right: 6px;
    color: var(--text-secondary);
}

.acv-role-picker__levels {
    min-width: 0;
    flex: 1 1 200px;
}

.acv-role-picker__effort-note {
    display: inline-flex;
    min-width: 0;
    flex: 0 1 auto;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    color: var(--text-muted);
    white-space: nowrap;
}

/* 档位多时说明另起一行：分段要宽，缩写的档位才放得下。 */
.acv-role-picker__effort.is-many .acv-role-picker__effort-note {
    flex: 1 0 100%;
    justify-content: flex-end;
}

.acv-role-picker__reset {
    display: inline-flex;
    height: 22px;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
}

.acv-role-picker__reset:hover {
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
    color: var(--text-main);
}

.acv-role-picker__help {
    width: 14px;
    height: 14px;
    flex: none;
}

/* 角色两列单行项：面板内容宽不到 480px 时单列（容器查询，面板宽度跟输入框）。 */
.acv-role-picker__body {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    padding: 6px;
    container-type: inline-size;
}

.acv-role-picker__roles {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1px 6px;
}

@container (min-width: 480px) {
    .acv-role-picker__roles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.acv-role-picker__row {
    display: flex;
    min-width: 0;
    height: 28px;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border-radius: calc(var(--nb-popover-inner-radius, 8px) - 2px);
    color: inherit;
    text-align: left;
}

.acv-role-picker__row:hover:not(:disabled) {
    background: var(--overlay-item-active, var(--bg-hover));
}

.acv-role-picker__row.is-active {
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
}

.acv-role-picker__role-icon {
    flex: none;
    color: var(--text-secondary);
}

.acv-role-picker__row.is-active .acv-role-picker__role-icon {
    color: var(--accent-text);
}

.acv-role-picker__row-name {
    flex: none;
    font-weight: var(--weight-medium);
}

.acv-role-picker__row-right {
    display: inline-flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    overflow: hidden;
    white-space: nowrap;
}

.acv-role-picker__row-model {
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
}

.acv-role-picker__row-model.is-off {
    color: var(--status-warning);
}

.acv-role-picker__row-effort {
    flex: none;
    color: var(--text-muted);
}

.acv-role-picker__row-effort::before {
    content: "· ";
}

.acv-role-picker__unbound {
    color: var(--status-warning);
}

.acv-role-picker__check {
    width: 13px;
    height: 13px;
    flex: none;
    color: var(--accent-text);
}

.acv-role-picker__group {
    padding: 8px 8px 2px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-role-picker__search {
    flex: none;
    padding: 2px 2px 4px;
}

.acv-role-picker__section {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.acv-role-picker__group-head {
    display: flex;
    height: 26px;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding: 0 6px;
    border-radius: 6px;
    color: var(--text-secondary);
    font-weight: var(--weight-medium);
}

.acv-role-picker__group-head:hover {
    background: var(--overlay-item-active, var(--bg-hover));
}

.acv-role-picker__chev {
    width: 12px;
    height: 12px;
    color: var(--text-muted);
}

.acv-role-picker__count {
    color: var(--text-muted);
    font-weight: var(--weight-normal);
}

.acv-role-picker__model-row {
    padding-left: 26px;
}

.acv-role-picker__model-row .acv-role-picker__row-name {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    font-weight: var(--weight-normal);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-role-picker__model-row.is-active .acv-role-picker__row-name {
    color: var(--accent-text);
}

.acv-role-picker__row:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.acv-role-picker__cap {
    width: 12px;
    height: 12px;
    flex: none;
    color: var(--text-muted);
}

.acv-role-picker__show-all {
    align-self: flex-start;
    margin: 2px 0 2px 26px;
    padding: 2px 8px;
    border-radius: var(--radius-control);
    color: var(--accent-text);
}

.acv-role-picker__show-all:hover {
    background: var(--overlay-item-active, var(--bg-hover));
}

.acv-role-picker__foot {
    flex: none;
    padding: 4px 6px;
    border-top: 1px solid var(--divider, var(--border-color));
}

.acv-role-picker__manage {
    display: inline-flex;
    height: 26px;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.acv-role-picker__manage:hover {
    background: var(--overlay-item-active, var(--bg-hover));
    color: var(--text-main);
}
</style>
