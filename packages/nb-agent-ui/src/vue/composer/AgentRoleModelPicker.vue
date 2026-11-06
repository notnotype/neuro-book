<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {AnchoredPopover, Input, SegmentedControl, Slider} from "@notnotype/nb-ui/components";
import {THINKING_LEVEL_KEYS} from "../../composer-actions";
import {formatTokens} from "../../process-summary";
import type {ComposerModelView, ComposerRoleView} from "../../types";
import {useAgentText} from "../host";

const props = withDefaults(defineProps<{
    roles: readonly ComposerRoleView[];
    models: readonly ComposerModelView[];
    modelKey: string | null;
    /** 现在实际用的模型；解析不到时为 null。 */
    effectiveModel?: string | null;
    thinkingLevels: readonly string[];
    thinking: string | null;
    /** 面板的锚点与宽度：输入框。没有时贴着触发器，用缺省宽度。 */
    anchor?: Element | null;
    disabled?: boolean;
    showImageSupport?: boolean;
    canManage?: boolean;
}>(), {
    effectiveModel: null,
    anchor: null,
    disabled: false,
    showImageSupport: true,
    canManage: false,
});

const emit = defineEmits<{
    (e: "select-model", modelKey: string): void;
    (e: "select-thinking", level: string): void;
    (e: "manage"): void;
}>();

defineOptions({inheritAttrs: false});

const {t} = useAgentText();

const FOLLOW_KEY = "";
const DEFAULT_WIDTH = 360;

const open = ref(false);
const page = ref<"roles" | "models">("roles");
const query = ref("");
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const popoverRef = ref<{contains(node: Node): boolean} | null>(null);
const width = ref(DEFAULT_WIDTH);

const pages = computed(() => [{label: t("composer.model.roles"), value: "roles"}, {label: t("composer.model.models"), value: "models"}]);
const gradient = computed(() => props.roles.filter((role) => role.axis === "gradient"));
const specialist = computed(() => props.roles.filter((role) => role.axis === "specialist"));
const follow = computed(() => props.models.find((model) => model.key === FOLLOW_KEY) ?? null);
const currentRole = computed(() => props.roles.find((role) => role.key === props.modelKey) ?? null);
const currentModel = computed(() => props.models.find((model) => model.key === props.modelKey) ?? null);

function thinkingLabel(level: string): string {
    const key = THINKING_LEVEL_KEYS[level];
    return key === undefined ? level : t(key);
}

const selectedName = computed(() => currentRole.value?.name ?? currentModel.value?.label ?? props.modelKey ?? t("composer.model.none"));
/** 选的是角色或跟随默认时，实际用的模型另写一段；选的就是模型时不重复。 */
const usedModel = computed(() => (currentRole.value !== null || props.modelKey === FOLLOW_KEY ? props.effectiveModel : null));
const triggerText = computed(() => [selectedName.value, usedModel.value, thinkingText.value].filter((part) => part !== null).join(" · "));

/**
 * 拖动时滑块跟手，停下才发一次：一格一次写设置，多次写入的先后没有保证，停下时可能落在中间那一档。
 */
const THINKING_SETTLE_MS = 200;
const draggingIndex = ref<number | null>(null);
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const thinkingIndex = computed(() => draggingIndex.value ?? Math.max(0, props.thinking === null ? 0 : props.thinkingLevels.indexOf(props.thinking)));
const thinkingText = computed(() => {
    const level = draggingIndex.value === null ? props.thinking : props.thinkingLevels[draggingIndex.value] ?? props.thinking;
    return level === null ? null : thinkingLabel(level);
});
function onThinking(value: number | number[]): void {
    // 单值滑块只交数字；类型是给范围滑块留的。
    if (typeof value !== "number") return;
    draggingIndex.value = value;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        settleTimer = null;
        const level = props.thinkingLevels[value];
        draggingIndex.value = null;
        if (level !== undefined && level !== props.thinking) emit("select-thinking", level);
    }, THINKING_SETTLE_MS);
}

/** 同组的排在一起，搜索按显示名、组名与 key。“跟随默认”在角色页，这里不列。 */
const groups = computed(() => {
    const needle = query.value.trim().toLowerCase();
    const result = new Map<string, ComposerModelView[]>();
    for (const model of props.models) {
        if (model.key === FOLLOW_KEY) continue;
        const group = model.group ?? "";
        if (needle !== "" && ![model.label, group, model.key].some((text) => text.toLowerCase().includes(needle))) continue;
        result.set(group, [...(result.get(group) ?? []), model]);
    }
    return [...result].map(([name, models]) => ({name, models}));
});

function priceText(model: ComposerModelView): string | null {
    return model.price === undefined || model.price === null ? null : `$${String(model.price.input)} / $${String(model.price.output)}`;
}

function selectRole(key: string): void {
    // 选了角色通常还要看绑定的是谁、调思考档，面板不关。
    emit("select-model", key);
}

function selectModel(model: ComposerModelView): void {
    if (model.unavailable !== undefined) return;
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
    if (settleTimer !== null) clearTimeout(settleTimer);
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
        <span class="acv-role-picker__text">
            <span class="acv-role-picker__name">{{ selectedName }}</span>
            <template v-if="usedModel !== null"> · {{ usedModel }}</template>
            <template v-if="thinkingText !== null"> · <span class="acv-role-picker__level">{{ thinkingText }}</span></template>
        </span>
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
                    <div class="acv-role-picker__current-text">
                        <div class="acv-role-picker__name">
                            {{ selectedName }}<span v-if="usedModel !== null" class="acv-role-picker__muted"> · {{ usedModel }}</span>
                        </div>
                        <div class="acv-role-picker__hint">{{ t("composer.model.sessionOnly") }}</div>
                    </div>
                    <SegmentedControl v-model="page" :options="pages" size="xs" class="acv-role-picker__pages" data-model-picker-pages />
                </div>
                <div v-if="props.thinkingLevels.length > 1" class="acv-role-picker__thinking">
                    <span class="i-lucide-brain acv-role-picker__icon" aria-hidden="true" />
                    <span>{{ t("composer.model.thinking") }}</span>
                    <span class="acv-role-picker__thinking-value" data-model-picker-thinking>{{ thinkingText }}</span>
                    <Slider
                        :model-value="thinkingIndex"
                        :min="0"
                        :max="props.thinkingLevels.length - 1"
                        :step="1"
                        size="sm"
                        :aria-label="t('composer.model.thinking')"
                        class="acv-role-picker__slider"
                        @update:model-value="onThinking"
                    />
                </div>
            </div>
            <div class="acv-role-picker__body">
                <template v-if="page === 'roles'">
                    <button
                        v-if="follow !== null"
                        type="button"
                        class="acv-role-picker__role acv-role-picker__follow"
                        :class="{'is-active': props.modelKey === FOLLOW_KEY}"
                        data-model-picker-role=""
                        @click="selectRole(FOLLOW_KEY)"
                    >
                        <span class="acv-role-picker__role-name">{{ follow.label }}</span>
                        <span v-if="props.modelKey === FOLLOW_KEY" class="i-lucide-check acv-role-picker__check" aria-hidden="true" />
                    </button>
                    <div class="acv-role-picker__roles">
                        <button
                            v-for="role in gradient"
                            :key="role.key"
                            type="button"
                            class="acv-role-picker__role"
                            :class="{'is-active': role.key === props.modelKey, 'is-off': role.unavailable !== undefined}"
                            :title="role.unavailable"
                            :data-model-picker-role="role.key"
                            @click="selectRole(role.key)"
                        >
                            <span class="acv-role-picker__role-name">
                                {{ role.name }}
                                <span v-if="role.key === props.modelKey" class="i-lucide-check acv-role-picker__check" aria-hidden="true" />
                            </span>
                            <span class="acv-role-picker__role-model">{{ role.modelLabel ?? t("composer.model.unbound") }}</span>
                        </button>
                    </div>
                    <template v-if="specialist.length > 0">
                        <div class="acv-role-picker__group">{{ t("composer.model.specialist") }}</div>
                        <div class="acv-role-picker__roles">
                            <button
                                v-for="role in specialist"
                                :key="role.key"
                                type="button"
                                class="acv-role-picker__role"
                                :class="{'is-active': role.key === props.modelKey, 'is-off': role.unavailable !== undefined}"
                                :title="role.unavailable"
                                :data-model-picker-role="role.key"
                                @click="selectRole(role.key)"
                            >
                                <span class="acv-role-picker__role-name">
                                    {{ role.name }}
                                    <span v-if="role.key === props.modelKey" class="i-lucide-check acv-role-picker__check" aria-hidden="true" />
                                </span>
                                <span class="acv-role-picker__role-model">{{ role.modelLabel ?? t("composer.model.unbound") }}</span>
                            </button>
                        </div>
                    </template>
                </template>
                <template v-else>
                    <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="t('composer.model.search')" :aria-label="t('composer.model.search')" data-model-picker-search />
                    <p v-if="groups.length === 0" class="acv-role-picker__hint">{{ t("composer.model.noMatch") }}</p>
                    <section v-for="group in groups" :key="group.name">
                        <div v-if="group.name !== ''" class="acv-role-picker__group">{{ group.name }}</div>
                        <button
                            v-for="model in group.models"
                            :key="model.key"
                            type="button"
                            class="acv-role-picker__model"
                            :class="{'is-active': model.key === props.modelKey}"
                            :disabled="model.unavailable !== undefined"
                            :title="model.unavailable"
                            :data-model-picker-model="model.key"
                            @click="selectModel(model)"
                        >
                            <span class="acv-role-picker__model-name">{{ model.label }}</span>
                            <span v-if="model.reasoning === true" class="i-lucide-brain acv-role-picker__cap" :title="t('composer.model.reasoning')" />
                            <span v-if="props.showImageSupport && !model.supportsImages" class="i-lucide-image-off acv-role-picker__cap" :title="t('composer.model.noImages')" />
                            <span v-if="model.contextWindow !== undefined && model.contextWindow !== null" class="acv-role-picker__muted">{{ formatTokens(model.contextWindow) }}</span>
                            <span v-if="priceText(model) !== null" class="acv-role-picker__price">{{ priceText(model) }}</span>
                        </button>
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
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.acv-role-picker__trigger:hover:not(:disabled),
.acv-role-picker__trigger[aria-expanded="true"] {
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
    color: var(--text-main);
}

.acv-role-picker__trigger:focus-visible,
.acv-role-picker__role:focus-visible,
.acv-role-picker__model:focus-visible,
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
    color: var(--text-muted);
}

.acv-role-picker__trigger .acv-role-picker__name {
    color: var(--text-secondary);
    font-weight: 400;
}

.acv-role-picker__trigger .acv-role-picker__level {
    color: var(--accent-text);
}

.acv-role-picker__trigger .acv-role-picker__chevron {
    flex: none;
    width: 12px;
    height: 12px;
    color: var(--text-muted);
}

.acv-role-picker__icon {
    flex: none;
    width: 13px;
    height: 13px;
}

.acv-role-picker__chevron {
    color: var(--text-muted);
}

.acv-role-picker__text {
    min-width: 0;
    max-width: 18em;
    overflow: hidden;
    text-overflow: ellipsis;
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
    padding: 10px;
    border-bottom: 1px solid var(--divider, var(--border-color));
}

.acv-role-picker__current {
    display: flex;
    align-items: center;
    gap: 8px;
}

.acv-role-picker__current-text {
    min-width: 0;
    flex: 1;
}

.acv-role-picker__name {
    overflow: hidden;
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-role-picker__muted {
    color: var(--text-muted);
    font-weight: var(--weight-normal);
}

.acv-role-picker__hint {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-role-picker__pages {
    width: 124px;
    flex: none;
}

.acv-role-picker__thinking {
    display: flex;
    align-items: center;
    gap: 6px;
}

/* 固定宽度：档位文字长短不同时滑块不动。 */
.acv-role-picker__thinking-value {
    width: 5.5em;
    flex: none;
    color: var(--accent-text);
    font-weight: var(--weight-strong);
}

.acv-role-picker__slider {
    min-width: 0;
    flex: 1;
}

.acv-role-picker__body {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding: 10px;
}

.acv-role-picker__roles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}

.acv-role-picker__role {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-control);
    color: inherit;
    text-align: left;
}

.acv-role-picker__role:hover {
    background: var(--bg-hover);
}

.acv-role-picker__role.is-active {
    border-color: var(--focus-outline);
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
}

.acv-role-picker__role.is-off .acv-role-picker__role-model {
    color: var(--status-warning);
}

.acv-role-picker__follow {
    flex: none;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
}

.acv-role-picker__role-name {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: var(--weight-medium);
}

.acv-role-picker__role-model {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-role-picker__check {
    width: 13px;
    height: 13px;
    flex: none;
    margin-left: auto;
    color: var(--accent-text);
}

.acv-role-picker__group {
    padding: 2px 2px 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-role-picker__model {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: var(--radius-control);
    color: inherit;
    font-size: var(--text-xs);
    text-align: left;
}

.acv-role-picker__model:hover:not(:disabled) {
    background: var(--bg-hover);
}

.acv-role-picker__model.is-active {
    color: var(--accent-text);
}

.acv-role-picker__model:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.acv-role-picker__model-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-role-picker__cap {
    width: 13px;
    height: 13px;
    flex: none;
    color: var(--text-muted);
}

.acv-role-picker__price {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-role-picker__foot {
    flex: none;
    padding: 4px;
    border-top: 1px solid var(--divider, var(--border-color));
}

.acv-role-picker__manage {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.acv-role-picker__manage:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}
</style>
