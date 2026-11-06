<script setup lang="ts">
/** 设置窗口里的“主题”页（同名 .md）：主题编辑器的入口，加正在用的主题与我的主题的预览卡片。 */
import {computed} from "vue";

import {Button} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {USER_THEME_PLUGIN} from "../../../shared/user-themes";
import {useWorkbenchText} from "../../text";
import type {ThemeEntry} from "../../themes";
import type {ThemeSwatch} from "./theme-swatch";

defineOptions({name: "ThemeSettingsPage"});

const props = defineProps<{
    /** 设置窗口给的页面上下文；这一页不用它（没有自己的设置项）。 */
    context?: unknown;
    themes: ReadonlyArray<ThemeEntry>;
    /** 现在生效的主题 id（设置里的值，找不到时已退回缺省）。 */
    currentId: string;
    /** 一套主题在当前明暗下的预览色；卡片用它画一小块“这套主题长什么样”。 */
    swatch: (entry: ThemeEntry) => ThemeSwatch;
}>();
const emit = defineEmits<{(event: "open", where: "tab" | "floating"): void}>();

const text = useWorkbenchText();
const resolver = useText();
const titleOf = (entry: ThemeEntry): string => resolver.t(entry.declaration.title);

const current = computed(() => props.themes.find((entry) => entry.id === props.currentId) ?? null);
const mine = computed(() => props.themes.filter((entry) => entry.plugin === USER_THEME_PLUGIN));
</script>

<template>
    <div class="theme-settings-page" data-theme-settings-page>
        <section class="theme-settings-page__hero">
            <span class="theme-settings-page__hero-icon" aria-hidden="true"><span class="i-lucide-palette"></span></span>
            <div class="theme-settings-page__hero-body">
                <h3 class="theme-settings-page__hero-title">{{ text("themeEditor.entry.heroTitle") }}</h3>
                <p class="theme-settings-page__hero-text">{{ text("themeEditor.entry.intro") }}</p>
                <div class="theme-settings-page__hero-actions">
                    <Button icon-class="i-lucide-panel-top" data-open-tab @click="emit('open', 'tab')">{{ text("themeEditor.entry.openTab") }}</Button>
                    <Button variant="secondary" icon-class="i-lucide-app-window" data-open-floating @click="emit('open', 'floating')">{{ text("themeEditor.entry.openFloating") }}</Button>
                </div>
            </div>
        </section>

        <section v-if="current !== null" class="theme-settings-page__block" data-current-theme>
            <h3 class="theme-settings-page__title">{{ text("themeEditor.entry.current") }}</h3>
            <div class="theme-settings-page__cards">
                <article class="theme-settings-page__card" data-in-use-card>
                    <span class="theme-settings-page__swatch" :style="{background: swatch(current).background ?? undefined, color: swatch(current).text ?? undefined}" aria-hidden="true">
                        <span class="theme-settings-page__swatch-text">Aa</span>
                        <span class="theme-settings-page__swatch-accent" :style="{background: swatch(current).accent ?? undefined}"></span>
                    </span>
                    <span class="theme-settings-page__name">{{ titleOf(current) }}</span>
                </article>
            </div>
            <p class="theme-settings-page__hint">{{ text("themeEditor.entry.switchHint") }}</p>
        </section>

        <section class="theme-settings-page__block" data-my-themes>
            <h3 class="theme-settings-page__title">{{ text("themeEditor.entry.mine") }}</h3>
            <p v-if="mine.length === 0" class="theme-settings-page__hint" data-my-themes-empty>{{ text("themeEditor.entry.mineEmpty") }}</p>
            <div v-else class="theme-settings-page__cards">
                <article v-for="entry in mine" :key="entry.id" class="theme-settings-page__card" :data-in-use="entry.id === currentId ? '' : undefined" :data-my-theme="entry.id">
                    <span class="theme-settings-page__swatch" :style="{background: swatch(entry).background ?? undefined, color: swatch(entry).text ?? undefined}" aria-hidden="true">
                        <span class="theme-settings-page__swatch-text">Aa</span>
                        <span class="theme-settings-page__swatch-accent" :style="{background: swatch(entry).accent ?? undefined}"></span>
                    </span>
                    <span class="theme-settings-page__name">{{ titleOf(entry) }}</span>
                    <span v-if="entry.id === currentId" class="theme-settings-page__badge" data-in-use-badge>{{ text("themeEditor.entry.inUse") }}</span>
                </article>
            </div>
        </section>
    </div>
</template>

<style scoped>
.theme-settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

/* 入口：一块带图标的卡片，两个按钮并排。图标底取强调色的淡底。 */
.theme-settings-page__hero {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-6);
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent-main) 6%, transparent);
}

.theme-settings-page__hero-icon {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--accent-bg);
    color: var(--accent-text);
    font-size: 22px;
}

.theme-settings-page__hero-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}

.theme-settings-page__hero-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
}

.theme-settings-page__hero-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.theme-settings-page__hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-2);
}

.theme-settings-page__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.theme-settings-page__title {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-settings-page__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-settings-page__cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: var(--space-4);
}

.theme-settings-page__card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
}

.theme-settings-page__card[data-in-use] {
    border-color: var(--accent-main);
}

/* 预览块的颜色全由行内样式给：背景、文字、强调都是那套主题自己的取值，不取设置窗口的 token。 */
.theme-settings-page__swatch {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 72px;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-md);
}

.theme-settings-page__swatch-text {
    font-size: 24px;
    font-weight: 600;
}

.theme-settings-page__swatch-accent {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-3);
    width: 14px;
    height: 14px;
    border-radius: 999px;
}

.theme-settings-page__name {
    overflow: hidden;
    padding: 0 var(--space-1);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.theme-settings-page__badge {
    position: absolute;
    top: var(--space-4);
    left: var(--space-4);
    padding: 0 var(--space-3);
    border-radius: 999px;
    background: var(--accent-main);
    color: var(--text-inverse);
    font-size: var(--text-xs);
}
</style>
