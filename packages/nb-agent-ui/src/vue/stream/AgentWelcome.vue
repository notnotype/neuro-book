<script setup lang="ts">
/** 对话还没有消息时的第一屏（同名 .md）：欢迎、最近对话、试试这些。 */
import {computed} from "vue";
import {Tooltip} from "@notnotype/nb-ui/components";

import {formatListTime} from "../../format";
import type {AgentWelcomeView} from "../../types";
import {useAgentText} from "../host";

defineOptions({name: "AgentWelcome"});

const props = defineProps<{
    welcome: AgentWelcomeView;
    now: number;
    canOpenSessions: boolean;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: string): void;
    (e: "open-sessions"): void;
    (e: "starter", text: string): void;
}>();

const {t, locale} = useAgentText();

/** 两块都只显示前 3 条：多给的不显示（Profile 声明的指令不设条数上限）。 */
const LIMIT = 3;
const recent = computed(() => props.welcome.recent.slice(0, LIMIT));
const starters = computed(() => props.welcome.starters.slice(0, LIMIT));
const subtitle = computed(() => t(recent.value.length > 0 ? "welcome.withRecent" : starters.value.length > 0 ? "welcome.withStarters" : "welcome.plain"));
</script>

<template>
    <section class="acv-welcome" data-agent-welcome>
        <div class="acv-welcome__hero">
            <span class="acv-welcome__badge" aria-hidden="true"><span class="i-lucide-sparkles" /></span>
            <h2 class="acv-welcome__title">{{ props.welcome.title ?? t("welcome.title") }}</h2>
            <p class="acv-welcome__subtitle">{{ subtitle }}</p>
        </div>

        <section v-if="recent.length > 0" class="acv-welcome__group" :aria-label="t('welcome.recent')" data-welcome-recent>
            <div class="acv-welcome__group-head">
                <span class="acv-welcome__group-title"><span class="i-lucide-history acv-welcome__group-icon" aria-hidden="true" />{{ t("welcome.recent") }}</span>
                <button v-if="props.canOpenSessions" type="button" class="acv-welcome__link nb-ui-focus-ring" data-welcome-all @click="emit('open-sessions')">
                    {{ t("welcome.viewAll", {total: props.welcome.total}) }}
                    <span class="i-lucide-arrow-right acv-welcome__link-arrow" aria-hidden="true" />
                </button>
            </div>
            <ul class="acv-welcome__list">
                <li v-for="session in recent" :key="session.id">
                    <button type="button" class="acv-welcome__card nb-ui-focus-ring" :data-welcome-session="session.id" @click="emit('select', session.id)">
                        <span class="i-lucide-message-square acv-welcome__card-icon" aria-hidden="true" />
                        <span class="acv-welcome__card-title">{{ session.title || t("header.untitled") }}</span>
                        <span class="acv-welcome__card-time">{{ formatListTime(session.at, props.now, locale) }}</span>
                        <span class="i-lucide-arrow-right acv-welcome__card-arrow" aria-hidden="true" />
                    </button>
                </li>
            </ul>
        </section>

        <section v-if="starters.length > 0" class="acv-welcome__group" :aria-label="t('welcome.starters')" data-welcome-starters>
            <div class="acv-welcome__group-head">
                <span class="acv-welcome__group-title"><span class="i-lucide-sparkles acv-welcome__group-icon" aria-hidden="true" />{{ t("welcome.starters") }}</span>
                <span class="acv-welcome__hint">{{ t("welcome.startersHint") }}</span>
            </div>
            <ul class="acv-welcome__list">
                <li v-for="(starter, index) in starters" :key="index">
                    <Tooltip :text="starter.text" side="top">
                        <button type="button" class="acv-welcome__starter nb-ui-focus-ring" data-welcome-starter @click="emit('starter', starter.text)">
                            <span :class="[starter.icon ?? 'i-lucide-sparkles', 'acv-welcome__starter-icon']" aria-hidden="true" />
                            <span class="acv-welcome__starter-text">{{ starter.text }}</span>
                        </button>
                    </Tooltip>
                </li>
            </ul>
        </section>
    </section>
</template>

<style scoped>
.acv-welcome {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    max-width: 460px;
    margin: auto;
    padding: 8px 0;
    user-select: none;
}

.acv-welcome__hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.acv-welcome__badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin-bottom: 10px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-panel);
    background: var(--panel-surface);
    color: var(--accent-text);
    font-size: 20px;
}

.acv-welcome__title {
    margin: 0;
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: 600;
}

.acv-welcome__subtitle {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-welcome__group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.acv-welcome__group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-inline: 4px;
}

.acv-welcome__group-title {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 600;
}

.acv-welcome__group-icon {
    width: 14px;
    height: 14px;
    color: var(--accent-text);
}

.acv-welcome__link {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-control);
    color: var(--accent-text);
    font-size: var(--text-2xs);
}

.acv-welcome__link:hover {
    text-decoration: underline;
}

.acv-welcome__link-arrow {
    width: 12px;
    height: 12px;
}

.acv-welcome__hint {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-welcome__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.acv-welcome__card {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-panel);
    background: var(--panel-surface);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout), border-color var(--motion-fast) var(--ease-layout);
}

.acv-welcome__card:hover {
    border-color: var(--accent-main);
    background: var(--bg-hover);
}

.acv-welcome__card-icon,
.acv-welcome__card-arrow {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.acv-welcome__card:hover .acv-welcome__card-icon,
.acv-welcome__card:hover .acv-welcome__card-arrow {
    color: var(--accent-text);
}

.acv-welcome__card-title {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-welcome__card-time {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-welcome__starter {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.acv-welcome__starter:hover {
    background: var(--bg-hover);
}

.acv-welcome__starter-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--accent-text);
}

.acv-welcome__starter-text {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-welcome__starter:hover .acv-welcome__starter-text {
    color: var(--accent-text);
}
</style>
