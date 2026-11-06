<script setup lang="ts">
/**
 * 设置的一行（同名 .md）：按配置服务的 `inspect` 与当前标签算出控件、沿用标签、已修改、覆盖提示与停用；恢复默认与移除
 * 本作品的设置经传入的配置服务写这一层。规则见 docs/specs/settings/settings-window.md 输出 9–13、18。
 */
import {IconButton, Tooltip} from "@notnotype/nb-ui/components";
import type {TextParams} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, ref, useId} from "vue";

import type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService} from "nbook/shared/settings";

import {isReadOnlySetting, projectOverride, settingsRowState} from "./row-state";
import type {SettingsRowReason} from "./row-state";
import HighlightedText from "./HighlightedText.vue";
import {settingAppliesText, settingValueText} from "./setting-text";
import {settingsUiText} from "./text";
import type {SettingsUiKey} from "./text";

defineOptions({name: "SettingsRow"});

const props = withDefaults(defineProps<{
    settings: SettingsService;
    setting: SettingDefinition<unknown>;
    layer: SettingLayer;
    projectTitle?: string | null;
    wide?: boolean;
    /**
     * 标题后面状态图标的原因（出错、选项拿不到、“已不存在”之类），由调用方给：行不认识控件里的状态。只画一个图标，色调取
     * 最重的（error > warning > muted），提示逐条列出；读屏文字合进插槽的 `describedby`。
     */
    reasons?: ReadonlyArray<SettingsRowReason>;
    /** 搜索结果里要标出的词（小写）：标题与说明里命中的字标底色，文字本身不变。缺省不标。 */
    highlight?: ReadonlyArray<string>;
}>(), {projectTitle: null, wide: false, reasons: () => [], highlight: () => []});

type RowAction = "reset" | "remove";

const emit = defineEmits<{
    (event: "write-failed", failure: {action: RowAction; code: SettingsFailure; detail: string}): void;
}>();

defineSlots<{
    /**
     * `value` 是这一层此刻显示的值：写了取这一层，本作品标签下没写取用户层的（沿用）。控件改值由调用方写当前标签那一层，
     * 所以沿用的行一改就写进本作品层。`id` 给控件，行的 `<label for>` 指向它；组合控件（单选组、复选组）拿不到
     * `<label for>` 的名字，用 `labelId` 作 `aria-labelledby`。`describedby` 是行里沿用标签、生效时机、说明与状态原因的
     * id，都没有时为 undefined。
     */
    default(props: {value: unknown; disabled: boolean; id: string; label: string; labelId: string; describedby: string | undefined}): unknown;
}>();

/** 状态原因的图标，画法同 nb-form 的字段外壳（`FieldShell`）：出错、警告、其余。类名写成字面量，图标才会被生成。 */
const REASON_ICON = {error: "i-lucide-circle-alert", warning: "i-lucide-triangle-alert", muted: "i-lucide-info"} as const;
/** 严重程度，大的重。 */
const SEVERITY = {error: 2, warning: 1, muted: 0} as const;

/** 翻译端口由宿主注入：行自己的文字在 `nbook.settings` 的目录里，声明里的文字（标题、说明、选项名）也经它翻译。 */
const declared = useText();
const text = (key: SettingsUiKey, params?: TextParams): string => declared.t(settingsUiText(key, params));

const controlId = useId();
const labelId = `${controlId}-label`;
const descriptionId = `${controlId}-description`;
const inheritedId = `${controlId}-inherited`;
const appliesId = `${controlId}-applies`;
const reasonsId = `${controlId}-reasons`;
/**
 * 本实例接受的声明（登记时补全过，标题总有值）；没被接受时退回写下的样子，标题显示键。插件页面传进来的是自己的定义，
 * 省略的标题只在接受的声明里有。
 */
const declaration = computed(() => props.settings.declaration(props.setting) ?? props.setting.declaration);
const inspection = computed(() => props.settings.inspect(props.setting));
const state = computed(() => settingsRowState(inspection.value, declaration.value.layers, props.layer));
const override = computed(() => projectOverride(inspection.value, declaration.value.layers, props.layer));
const title = computed(() => (declaration.value.title === undefined ? props.setting.key : declared.t(declaration.value.title)));
const description = computed(() => (declaration.value.description === undefined ? null : declared.t(declaration.value.description)));
const applies = computed(() => settingAppliesText(declaration.value.applies, declared));
/** schema 写了 `readOnly`：不画控件，只写当前值（输出 9）。 */
const readOnly = computed(() => isReadOnlySetting(declaration.value));
const reasonTone = computed(() => props.reasons.reduce<SettingsRowReason["tone"] | null>((worst, reason) => (worst === null || SEVERITY[reason.tone] > SEVERITY[worst] ? reason.tone : worst), null));
/** 行自己要念的原因：控件已经念过的（`announced`）不再写一份。 */
const reasonsText = computed(() => props.reasons.filter((reason) => reason.announced !== true).map((reason) => reason.text).join("；"));
/**
 * 本作品标签下沿用用户层的值：标题后一枚描边标签（输出 12）。只能写在本作品层的项没写时显示的是默认值，不是“来自用户设置”，
 * 和用户标签里没写的项一样不标。
 */
const inheritsUser = computed(() => state.value.kind === "inherit" && declaration.value.layers.includes("user"));
const describedby = computed(() => [inheritsUser.value ? inheritedId : null, applies.value === null ? null : appliesId, description.value === null ? null : descriptionId, reasonsText.value === "" ? null : reasonsId].filter((id) => id !== null).join(" ") || undefined);
const modified = computed(() => state.value.kind === "edit" && state.value.written);
/** 标题后的“已修改”圆点与最右一格的恢复默认：只读的项没有这两样，值改不了，也没有“默认”可回。 */
const marked = computed(() => modified.value && !readOnly.value);
const blocked = computed(() => state.value.kind !== "not-allowed" && state.value.blocked);
/** 此刻这一层显示的值：写了取这一层，没写取下一层；控件与只读行都用它。 */
const shown = computed(() => (state.value.kind === "edit" ? state.value.value : state.value.kind === "inherit" ? state.value.inherited : undefined));
const valueText = (value: unknown): string => settingValueText(declaration.value, value, declared);
/** 最右一格的动作：用户标签是“恢复默认”，本作品标签是“移除本作品的设置”，同一个图标按钮。 */
const resetText = computed(() => text(props.layer === "user" ? "row.reset" : "row.remove"));

/**
 * 焦点在行里的控件上时，原因的提示也显示（键盘用户悬停不到图标）。只认放控件的两处（`__field`、`__wide`）：右边那一格的
 * 按钮拿到焦点不算。焦点在同一处里移动不算离开；移到控件弹出的浮层里（下拉的选项）算离开。
 */
const controlFocused = ref(false);
function onFocusIn(): void {
    controlFocused.value = true;
}
function onFocusOut(event: FocusEvent): void {
    const host = event.currentTarget;
    if (host instanceof Node && event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
    controlFocused.value = false;
}

/** 进行中的动作：同一行一次只发一个，按钮停用到它结算。 */
const busy = ref<RowAction | null>(null);

async function run(action: RowAction): Promise<void> {
    const current = state.value;
    if (busy.value !== null || current.kind === "not-allowed" || current.blocked) return;
    busy.value = action;
    try {
        // 两种动作都是删掉这一层的键：恢复默认删当前层，移除本作品的设置删本作品层。
        const layer: SettingLayer = action === "reset" ? props.layer : "project";
        const result = await props.settings.update(props.setting, undefined, {layer});
        if (!result.ok) emit("write-failed", {action, code: result.code, detail: result.detail});
    } finally {
        busy.value = null;
    }
}
</script>

<template>
    <div
        class="settings-row"
        :class="{'settings-row--wide': wide}"
        :data-settings-row="setting.key"
        :data-settings-row-state="state.kind"
        :data-settings-row-modified="modified ? '' : undefined"
        :data-settings-row-blocked="blocked ? '' : undefined"
    >
        <div class="settings-row__main">
            <div class="settings-row__text">
                <div class="settings-row__title">
                    <label :id="labelId" :for="controlId"><HighlightedText :text="title" :words="highlight" /></label>
                    <Tooltip v-if="marked" :text="text('row.modified')">
                        <span class="settings-row__dot" role="img" :aria-label="text('row.modified')" data-settings-row-dot></span>
                    </Tooltip>
                    <Tooltip v-if="reasonTone !== null" side="right" :force-open="controlFocused">
                        <span class="settings-row__reason" :class="`settings-row__reason--${reasonTone}`" :data-tone="reasonTone" aria-hidden="true" data-settings-row-reason>
                            <span :class="REASON_ICON[reasonTone]"></span>
                        </span>
                        <template #content>
                            <span v-for="(reason, index) in reasons" :key="index" class="settings-row__reason-line" :data-tone="reason.tone" data-settings-row-reason-line>{{ reason.text }}</span>
                        </template>
                    </Tooltip>
                    <!-- 沿用标签与生效时机不在 `<label>` 里：它们不是控件的名字，经 `describedby` 当说明念（审查 S5 Sonnet 3）。 -->
                    <span v-if="inheritsUser" :id="inheritedId" class="settings-row__inherited" data-settings-row-inherited>{{ text('row.inherited') }}</span>
                    <span v-if="applies !== null" :id="appliesId" class="settings-row__applies">{{ applies }}</span>
                </div>
                <p v-if="description !== null" :id="descriptionId" class="settings-row__description"><HighlightedText :text="description" :words="highlight" /></p>
            </div>
            <!--
                控件靠右，最右一格固定宽（没改过的行也留着）：各行控件的右缘因此对齐。宽排法里这一块只剩标题那一行右端的东西，
                控件另起一行（见下面的 `__wide`）。
            -->
            <div class="settings-row__control" :data-settings-row-head="wide ? '' : undefined">
                <div v-if="state.kind === 'not-allowed' || readOnly || !wide" class="settings-row__field" @focusin="onFocusIn" @focusout="onFocusOut">
                    <span v-if="state.kind === 'not-allowed'" class="settings-row__not-allowed">{{ text(layer === 'project' ? 'row.userOnly' : 'row.projectOnly') }}</span>
                    <span v-else-if="readOnly" class="settings-row__value" data-settings-row-value>{{ valueText(shown) }}</span>
                    <slot v-else :value="shown" :disabled="blocked" :id="controlId" :label="title" :labelId="labelId" :describedby="describedby" />
                </div>
                <span class="settings-row__cell" data-settings-row-cell>
                    <Tooltip v-if="readOnly && state.kind !== 'not-allowed'" :text="text('row.readOnly')">
                        <span class="settings-row__lock" role="img" :aria-label="text('row.readOnly')" data-settings-row-lock><span class="i-lucide-lock"></span></span>
                    </Tooltip>
                    <Tooltip v-else-if="marked" :text="resetText">
                        <IconButton
                            size="xs"
                            icon-class="i-lucide-rotate-ccw"
                            :aria-label="resetText"
                            :disabled="blocked || busy !== null"
                            :data-settings-row-reset="layer === 'user' ? '' : undefined"
                            :data-settings-row-remove="layer === 'user' ? undefined : ''"
                            @click="run(layer === 'user' ? 'reset' : 'remove')"
                        />
                    </Tooltip>
                </span>
            </div>
        </div>
        <div v-if="wide && !readOnly && state.kind !== 'not-allowed'" class="settings-row__wide" data-settings-row-wide @focusin="onFocusIn" @focusout="onFocusOut">
            <slot :value="shown" :disabled="blocked" :id="controlId" :label="title" :labelId="labelId" :describedby="describedby" />
        </div>
        <!-- 读屏用：状态原因的文字，看得见的是标题后的图标与提示。 -->
        <span v-if="reasonsText !== ''" :id="reasonsId" class="settings-row__sr-only" data-settings-row-reasons>{{ reasonsText }}</span>
        <p v-if="override !== null" class="settings-row__override" data-settings-row-overridden>
            <span class="i-lucide-info settings-row__override-icon" aria-hidden="true"></span>
            <span>{{ text(projectTitle === null ? 'row.overriddenUntitled' : 'row.overridden', {value: valueText(override.value), title: projectTitle ?? ""}) }}</span>
        </p>
    </div>
</template>

<style scoped>
/*
 * 整数行高：标题 20px、说明 18px、两者之间 --space-1（2px），文字块高 40px，34px 高的控件在它里面居中时上下各 3px，不落在
 * 半像素上。改其中一个数时保持文字块是偶数高。
 */
.settings-row {
    --settings-line-ui: var(--leading-ui);
    /* 最右一格的宽：IconButton 的 xs 档（24px）。 */
    --settings-row-slot: 24px;
    /* 标题与说明占的最小宽度，放不下时控件换到标题下面；单行输入的宽度（SettingsListSection）也按它与下面两个算。 */
    --settings-row-text-min: 200px;
    --settings-row-gap-x: var(--space-7);
    --settings-row-cell-gap: var(--space-3);
    --settings-row-title-h: 20px;
    --settings-row-description-h: 18px;

    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block: var(--space-4);
}

/*
 * 行里的小字用整数像素的行高：`--leading-ui` 是倍数，乘上有的主题的字号（例如 macOS 的 11px × 1.35）是小数，一行行累下去，
 * 后面的控件都落在半像素上、描边发虚。`1em` 在用到这个变量的元素上才求值，所以各处按自己的字号取整。`round()` 不支持时
 * 退回倍数。
 */
@supports (line-height: round(nearest, 1.5px, 1px)) {
    .settings-row {
        --settings-line-ui: round(nearest, calc(1em * var(--leading-ui)), 1px);
    }
}

.settings-row--wide {
    gap: var(--space-4);
}

.settings-row__main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--settings-row-gap-x);
    min-height: var(--control-h-md);
}

.settings-row__text {
    display: flex;
    min-width: 0;
    flex: 1 1 var(--settings-row-text-min);
    flex-direction: column;
    gap: var(--space-1);
}

.settings-row__title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--settings-row-title-h);
    color: var(--text-main);
}

/* 圆点与状态图标各占 14px 见方（悬停的范围也是这么大），在标题行里居中，不改变行高。 */
.settings-row__dot,
.settings-row__reason {
    display: inline-flex;
    width: 14px;
    height: 14px;
    flex: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 0;
}

.settings-row__dot::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
}

.settings-row__reason--error {
    color: var(--status-danger);
}

.settings-row__reason--warning {
    color: var(--status-warning);
}

.settings-row__reason--muted {
    color: var(--text-muted);
}

/* 提示里一条原因一行。 */
.settings-row__reason-line {
    display: block;
}

/* 生效时机是个小标签：只有几个字，用 --text-2xs（规范允许承载短角标）。 */
.settings-row__applies {
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--text-main) 7%, transparent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-normal);
    line-height: var(--settings-row-description-h);
    color: var(--text-secondary);
}

/*
 * 沿用标签（输出 12）：描边不填色，和填色的生效时机标签分得开；字号同它。描边占掉上下各一条线，行高少两条，外高仍是
 * 说明那一行的高度。
 */
.settings-row__inherited {
    padding: 0 var(--space-3);
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-pill);
    font-size: var(--text-2xs);
    font-weight: var(--weight-normal);
    line-height: calc(var(--settings-row-description-h) - 2 * var(--border-w));
    white-space: nowrap;
    color: var(--text-muted);
}

.settings-row__description {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--settings-row-description-h);
    color: var(--text-muted);
}

.settings-row__control {
    display: flex;
    min-width: 0;
    max-width: 100%;
    flex: 0 1 auto;
    align-items: center;
    justify-content: flex-end;
    gap: var(--settings-row-cell-gap);
    margin-left: auto;
}

.settings-row__field {
    display: flex;
    min-width: 0;
    max-width: 100%;
    flex: 0 1 auto;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
}

/* 最右一格：“恢复默认”、本作品标签下的“移除本作品的设置”或只读的锁；没有的行也留着，控件的右缘才对齐。 */
.settings-row__cell {
    display: inline-flex;
    width: var(--settings-row-slot);
    flex: none;
    align-items: center;
    justify-content: flex-end;
}

.settings-row__lock {
    display: inline-flex;
    width: var(--settings-row-slot);
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
}

.settings-row__lock > span,
.settings-row__reason > span {
    width: 14px;
    height: 14px;
}

/* 宽排法：这一块只剩标题那一行右端的东西，高度同标题行，居中的按钮与标题文字对齐。 */
.settings-row--wide .settings-row__main {
    flex-wrap: nowrap;
    align-items: flex-start;
}

.settings-row--wide .settings-row__control {
    height: var(--settings-row-title-h);
}

.settings-row__wide {
    min-width: 0;
}

.settings-row__not-allowed {
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--settings-line-ui);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}

/* 只读：只写值，正文色，可以选中复制。 */
.settings-row__value {
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--settings-line-ui);
    color: var(--text-main);
    text-align: right;
    overflow-wrap: anywhere;
    user-select: text;
}

.settings-row__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.settings-row__override {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--settings-line-ui);
    color: var(--status-info);
    overflow-wrap: anywhere;
}

.settings-row__override-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
    margin-top: var(--space-1);
}
</style>
