<script setup lang="ts">
/** 首次启动向导的四步（docs/specs/runtime/desktop-shell.md 输出 34）；行为与数据见同名 `.md`。 */
import {computed, nextTick} from "vue";

import {Button, Dialog, SegmentedControl, Switch} from "@notnotype/nb-ui/components";

import NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";

import type {FirstRunChange} from "../first-run";
import {useDesktopText} from "../text";

type FirstRunStep = 1 | 2 | 3 | 4;
type Appearance = "light" | "dark" | "system";
type DesktopOption = "desktopShortcut" | "openAtLogin" | "tray";

const props = defineProps<{
    open: boolean;
    step: FirstRunStep;
    themes: ReadonlyArray<{id: string; name: string; thumbnails: {light: string; dark: string} | null}>;
    theme: string;
    appearance: Appearance;
    dark: boolean;
    locales: ReadonlyArray<{value: string; label: string}>;
    locale: string;
    options: Readonly<Record<DesktopOption, boolean>>;
    shownOptions: ReadonlyArray<DesktopOption>;
    places: {stateRoot: string | null; library: string | null};
    libraryMissing: boolean;
    error: string | null;
}>();

const emit = defineEmits<{
    (event: "change", change: FirstRunChange): void;
    (event: "open-place", place: "state-root" | "library"): void;
    (event: "next"): void;
    (event: "back"): void;
    (event: "skip"): void;
    (event: "finish"): void;
}>();

const text = useDesktopText();

const STEPS = [
    {key: "welcome", mood: "idle"},
    {key: "appearance", mood: "idea"},
    {key: "desktop", mood: "focus"},
    {key: "ready", mood: "done"},
] as const;
const current = computed(() => STEPS[props.step - 1]!);
const progress = computed(() => text("firstRun.progress", {step: props.step, total: STEPS.length, name: text(`firstRun.steps.${current.value.key}`)}));

const APPEARANCES: ReadonlyArray<Appearance> = ["light", "dark", "system"];
const OPTION_ICONS: Readonly<Record<DesktopOption, string>> = {desktopShortcut: "i-lucide-monitor", openAtLogin: "i-lucide-log-in", tray: "i-lucide-panel-bottom"};

/** 明暗卡片用所选主题的缩略图；所选主题没有缩略图时用第一个有缩略图的。 */
const schemeThumbnails = computed(() => props.themes.find((item) => item.id === props.theme)?.thumbnails ?? props.themes.find((item) => item.thumbnails !== null)?.thumbnails ?? null);

const primaryLabel = computed(() => text(props.step === 1 ? "firstRun.buttons.start" : props.step === 4 ? "firstRun.buttons.finish" : "firstRun.buttons.next"));
const primary = (): void => {
    if (props.step === 4) emit("finish");
    else emit("next");
};
const secondary = (): void => {
    if (props.step === 1) emit("skip");
    else emit("back");
};

/** Esc 当作跳过；点遮罩已关掉，别的原因（没有关闭按钮、没有取消按钮）不会来。 */
const onRequestClose = (reason: string): void => {
    if (reason === "escape") emit("skip");
};

/**
 * 卡片组的键盘（ui-development-spec 的复合选择控件）：方向键移动并选中，Home、End 到头尾；Tab 只停在选中的那张，都没选中时停在
 * 第一张。选中经 `change` 交宿主，焦点在下一拍挪到新卡片上。
 */
const onCardKeydown = (event: KeyboardEvent, ids: ReadonlyArray<string>, selected: string, choose: (id: string) => void): void => {
    const index = Math.max(0, ids.indexOf(selected));
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % ids.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + ids.length) % ids.length
            : event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const group = (event.currentTarget as HTMLElement | null);
    choose(ids[next]!);
    void nextTick(() => (group?.querySelectorAll<HTMLElement>("[role=radio]")[next])?.focus());
};
const themeIds = computed(() => props.themes.map((item) => item.id));
const tabStop = (ids: ReadonlyArray<string>, selected: string, id: string): number => (ids.includes(selected) ? id === selected : id === ids[0]) ? 0 : -1;

const chooseTheme = (id: string): void => emit("change", {key: "theme", value: id});
const chooseAppearance = (id: string): void => emit("change", {key: "appearance", value: id as Appearance});

/** 切换的方向固定（nb-ui `.nb-ui-switch`）；key 换了就是换步。 */
const contentKey = computed(() => `step-${props.step}`);
</script>

<template>
    <Dialog
        :open="open"
        size="md"
        :width="640"
        :height="540"
        :title="text('firstRun.title')"
        :show-header="false"
        :close-on-overlay="false"
        :close-on-request="false"
        :status="error ?? ''"
        initial-focus="[data-first-run-primary]"
        body-class="first-run__body"
        data-first-run-wizard
        :data-step="step"
        @request-close="onRequestClose"
    >
        <div class="first-run">
            <div class="first-run__progress" aria-hidden="true">
                <span v-for="index in STEPS.length" :key="index" class="first-run__segment" :class="{'is-on': index <= step}" />
            </div>
            <p class="sr-only" aria-live="polite" data-first-run-progress>{{ progress }}</p>

            <div class="first-run__stage" aria-hidden="true">
                <div class="first-run__mood" :class="{'is-hero': step === 1}">
                    <NeuroBookMood :state="current.mood" />
                </div>
            </div>

            <Transition name="nb-ui-switch" mode="out-in">
                <div :key="contentKey" class="first-run__content" :class="{'is-hero': step === 1}">
                    <template v-if="step === 1">
                        <h2 class="first-run__title first-run__title--hero">{{ text("firstRun.welcome.heading") }}</h2>
                        <p class="first-run__lead">{{ text("firstRun.welcome.lead") }}</p>
                    </template>

                    <template v-else-if="step === 2">
                        <h2 class="first-run__title">{{ text("firstRun.appearance.heading") }}</h2>
                        <div class="first-run__themes" role="radiogroup" :aria-label="text('firstRun.appearance.theme')" @keydown="onCardKeydown($event, themeIds, theme, chooseTheme)">
                            <button
                                v-for="item in themes"
                                :key="item.id"
                                type="button"
                                role="radio"
                                class="first-run__card nb-ui-focus-ring"
                                :aria-checked="item.id === theme"
                                :tabindex="tabStop(themeIds, theme, item.id)"
                                :data-theme-card="item.id"
                                @click="chooseTheme(item.id)"
                            >
                                <span class="first-run__thumb first-run__thumb--theme">
                                    <img v-if="item.thumbnails !== null" :src="dark ? item.thumbnails.dark : item.thumbnails.light" alt="" />
                                </span>
                                <span class="first-run__card-name">{{ item.name }}</span>
                            </button>
                        </div>
                        <div class="first-run__line">
                            <div class="first-run__schemes" role="radiogroup" :aria-label="text('firstRun.appearance.scheme')" @keydown="onCardKeydown($event, APPEARANCES, appearance, chooseAppearance)">
                                <button
                                    v-for="item in APPEARANCES"
                                    :key="item"
                                    type="button"
                                    role="radio"
                                    class="first-run__card first-run__card--scheme nb-ui-focus-ring"
                                    :aria-checked="item === appearance"
                                    :tabindex="tabStop(APPEARANCES, appearance, item)"
                                    :data-scheme-card="item"
                                    @click="chooseAppearance(item)"
                                >
                                    <span class="first-run__thumb first-run__thumb--scheme" :class="`is-${item}`">
                                        <template v-if="schemeThumbnails !== null">
                                            <img v-if="item !== 'dark'" :src="schemeThumbnails.light" alt="" class="first-run__half-light" />
                                            <img v-if="item !== 'light'" :src="schemeThumbnails.dark" alt="" class="first-run__half-dark" />
                                        </template>
                                    </span>
                                    <span class="first-run__card-name">{{ text(`firstRun.appearance.schemes.${item}`) }}</span>
                                </button>
                            </div>
                            <SegmentedControl
                                :model-value="locale"
                                :options="locales.map((item) => ({value: item.value, label: item.label}))"
                                :aria-label="text('firstRun.appearance.locale')"
                                data-first-run-locale
                                @update:model-value="(value) => emit('change', {key: 'locale', value: String(value)})"
                            />
                        </div>
                    </template>

                    <template v-else-if="step === 3">
                        <h2 class="first-run__title">{{ text("firstRun.desktop.heading") }}</h2>
                        <div class="first-run__rows">
                            <label v-for="option in shownOptions" :key="option" class="first-run__row" :data-desktop-option="option">
                                <span class="first-run__row-icon" :class="OPTION_ICONS[option]" aria-hidden="true" />
                                <span class="first-run__row-text">
                                    <span class="first-run__row-title">{{ text(`firstRun.desktop.${option}.title`) }}</span>
                                    <span class="first-run__row-detail">{{ text(`firstRun.desktop.${option}.detail`) }}</span>
                                </span>
                                <Switch
                                    :model-value="options[option]"
                                    :aria-label="text(`firstRun.desktop.${option}.title`)"
                                    @update:model-value="(value) => emit('change', {key: option, value: value === true})"
                                />
                            </label>
                        </div>
                    </template>

                    <template v-else>
                        <h2 class="first-run__title">{{ text("firstRun.ready.heading") }}</h2>
                        <p class="first-run__lead">{{ text("firstRun.ready.lead") }}</p>
                        <div class="first-run__rows">
                            <div class="first-run__row" data-place="state-root">
                                <span class="first-run__row-icon i-lucide-library" aria-hidden="true" />
                                <span class="first-run__row-text">
                                    <span class="first-run__row-title">{{ text("firstRun.ready.stateRoot") }}</span>
                                    <span class="first-run__path">{{ places.stateRoot ?? "" }}</span>
                                </span>
                                <Button variant="secondary" size="sm" @click="emit('open-place', 'state-root')">{{ text("firstRun.ready.open") }}</Button>
                            </div>
                            <div class="first-run__row" data-place="library">
                                <span class="first-run__row-icon i-lucide-folder-open" aria-hidden="true" />
                                <span class="first-run__row-text">
                                    <span class="first-run__row-title">{{ text("firstRun.ready.library") }}</span>
                                    <span class="first-run__path">{{ places.library ?? "" }}</span>
                                    <span v-if="libraryMissing" class="first-run__row-detail" data-library-missing>{{ text("firstRun.ready.missing") }}</span>
                                </span>
                                <Button variant="secondary" size="sm" @click="emit('open-place', 'library')">{{ text("firstRun.ready.open") }}</Button>
                            </div>
                        </div>
                    </template>
                </div>
            </Transition>
        </div>

        <template #status>
            <span v-if="step > 1">{{ text("firstRun.later") }}</span>
        </template>
        <template #footer>
            <Button :variant="step === 1 ? 'ghost' : 'secondary'" data-first-run-secondary @click="secondary">{{ text(step === 1 ? "firstRun.buttons.skip" : "firstRun.buttons.back") }}</Button>
            <Button variant="primary" data-first-run-primary @click="primary">{{ primaryLabel }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
:global(.first-run__body) {
    padding: 0 !important;
}

.first-run {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: var(--space-5) var(--space-8) var(--space-2);
}

.first-run__progress {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
}

.first-run__segment {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
    transition: background-color var(--motion-move) var(--ease-layout);
}

.first-run__segment.is-on {
    background: var(--accent-main);
}

/* 看板娘的位置固定：只占 48px 高；第一步用 transform 放大、下移到内容区中间，不改布局。 */
.first-run__stage {
    position: relative;
    height: 48px;
    margin: var(--space-5) 0 var(--space-4);
}

.first-run__mood {
    position: absolute;
    top: 0;
    left: 50%;
    width: 128px;
    margin-left: -64px;
    overflow: hidden;
    border-radius: 28px;
    transform: scale(0.375);
    transform-origin: top center;
    transition: transform var(--motion-move) var(--ease-layout);
}

.first-run__mood.is-hero {
    transform: translateY(48px) scale(1);
}

.first-run__content {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    min-height: 0;
    text-align: center;
}

/* 第一步：看板娘放大后占到 48 + 128 像素，标题排在它下面。 */
.first-run__content.is-hero {
    padding-top: 136px;
}

.first-run__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--text-main);
}

.first-run__title--hero {
    font-size: 30px;
}

.first-run__lead {
    margin: 0;
    font-size: var(--text-lg);
    line-height: 1.6;
    color: var(--text-muted);
}

.first-run__themes {
    display: grid;
    /* 正文宽时一行四张，窄屏（390 宽的对话框约 290 像素）两张。 */
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-3);
    width: 100%;
}

.first-run__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-panel);
    background: none;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-main);
    cursor: pointer;
}

.first-run__card[aria-checked="true"] .first-run__thumb {
    box-shadow: 0 0 0 2px var(--accent-main);
}

.first-run__card[aria-checked="true"] .first-run__card-name {
    font-weight: 600;
}

.first-run__card-name {
    max-width: 100%;
    overflow-wrap: anywhere;
}

.first-run__thumb {
    position: relative;
    display: block;
    overflow: hidden;
    border-radius: 8px;
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-main) 14%, transparent);
}

.first-run__thumb--theme {
    width: 100%;
    aspect-ratio: 4 / 3;
}

.first-run__thumb--scheme {
    width: 72px;
    height: 46px;
}

.first-run__thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top left;
}

.first-run__thumb--scheme.is-system .first-run__half-dark {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.first-run__line {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
}

.first-run__schemes {
    display: flex;
    gap: var(--space-3);
}

.first-run__rows {
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
    text-align: left;
}

.first-run__row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
}

.first-run__row + .first-run__row {
    border-top: 1px solid color-mix(in srgb, var(--text-main) 8%, transparent);
}

label.first-run__row {
    cursor: pointer;
}

.first-run__row-icon {
    flex: none;
    width: 20px;
    height: 20px;
    color: var(--text-muted);
}

.first-run__row-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.first-run__row-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-main);
}

.first-run__row-detail {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

/* 路径是内容：在不可选的外框里也要能选中复制（ui-development-spec 4.7）。 */
.first-run__path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
    user-select: text;
}
</style>
