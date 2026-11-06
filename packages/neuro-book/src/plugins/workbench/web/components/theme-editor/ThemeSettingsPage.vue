<script setup lang="ts">
/** 设置窗口里的“主题”页（同名 .md）：主题编辑器的入口，加当前用的主题与我的主题列表。 */
import {computed} from "vue";

import {Button} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";

import {USER_THEME_PLUGIN} from "../../../shared/user-themes";
import {useWorkbenchText} from "../../text";
import type {ThemeEntry} from "../../themes";

defineOptions({name: "ThemeSettingsPage"});

const props = defineProps<{
    /** 设置窗口给的页面上下文；这一页不用它（没有自己的设置项）。 */
    context?: unknown;
    themes: ReadonlyArray<ThemeEntry>;
    /** 现在生效的主题 id（设置里的值，找不到时已退回缺省）。 */
    currentId: string;
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
        <SettingsPageActions>
            <Button size="sm" variant="secondary" icon-class="i-lucide-app-window" data-open-floating @click="emit('open', 'floating')">{{ text("themeEditor.entry.openFloating") }}</Button>
            <Button size="sm" icon-class="i-lucide-palette" data-open-tab @click="emit('open', 'tab')">{{ text("themeEditor.entry.openTab") }}</Button>
        </SettingsPageActions>

        <p class="theme-settings-page__intro">{{ text("themeEditor.entry.intro") }}</p>

        <section class="theme-settings-page__block" data-current-theme>
            <h3 class="theme-settings-page__title">{{ text("themeEditor.entry.current") }}</h3>
            <p class="theme-settings-page__current">{{ current === null ? props.currentId : titleOf(current) }}</p>
            <p class="theme-settings-page__hint">{{ text("themeEditor.entry.switchHint") }}</p>
        </section>

        <section class="theme-settings-page__block" data-my-themes>
            <h3 class="theme-settings-page__title">{{ text("themeEditor.entry.mine") }}</h3>
            <p v-if="mine.length === 0" class="theme-settings-page__hint" data-my-themes-empty>{{ text("themeEditor.entry.mineEmpty") }}</p>
            <ul v-else class="theme-settings-page__list">
                <li v-for="entry in mine" :key="entry.id" class="theme-settings-page__item" :data-my-theme="entry.id">
                    <span class="theme-settings-page__name">{{ titleOf(entry) }}</span>
                    <span v-if="entry.id === currentId" class="theme-settings-page__badge" data-in-use>{{ text("themeEditor.entry.inUse") }}</span>
                </li>
            </ul>
        </section>
    </div>
</template>

<style scoped>
.theme-settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.theme-settings-page__intro,
.theme-settings-page__current {
    margin: 0;
    font-size: var(--text-sm);
}

.theme-settings-page__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.theme-settings-page__title {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-settings-page__current {
    font-weight: 600;
}

.theme-settings-page__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-settings-page__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.theme-settings-page__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
}

.theme-settings-page__badge {
    padding: 0 var(--space-3);
    border: var(--border-w) solid currentColor;
    border-radius: 999px;
    color: var(--accent-text);
    font-size: var(--text-xs);
}
</style>
