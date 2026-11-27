<script setup lang="ts">
/**
 * 设置场景里的 column 页面（示例插件“常用片段”）：用 SettingsRow 画自己声明的两项，按 `context.layer` 只写这一层。列表
 * 编辑只给一个“添加一条”，足够看出按层写入。完整的同类页面在示例插件 `plugin-sdk/examples/plugins/snippets/` 里；Lab 属于产品代码
 * （只在开发模式加载），按 `src/architecture.test.ts` 不能引用 `examples/`，所以这里另写一份最小的。
 */
import {Button, Switch} from "@notnotype/nb-ui/components";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingsService} from "nbook/shared/settings";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {snippetsSettings} from "./scene-settings";

const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
}>();

type Snippet = {readonly name: string; readonly text: string};

async function add(current: unknown): Promise<void> {
    const items = Array.isArray(current) ? current as ReadonlyArray<Snippet> : [];
    await props.settings.update(snippetsSettings.items, [...items, {name: `片段 ${String(items.length + 1)}`, text: "……"}], {layer: props.context.layer.value});
}

async function setAutoInsert(value: boolean): Promise<void> {
    await props.settings.update(snippetsSettings.autoInsert, value, {layer: props.context.layer.value});
}
</script>

<template>
    <div class="sample-snippets">
        <SettingsRow v-slot="row" :settings="settings" :setting="snippetsSettings.items" :layer="context.layer.value" :project-title="context.projectTitle.value" wide>
            <ul class="sample-snippets__list">
                <li v-for="item in (row.value as ReadonlyArray<Snippet>)" :key="item.name" class="sample-snippets__item">
                    <span class="sample-snippets__name">{{ item.name }}</span>
                    <span class="sample-snippets__text">{{ item.text }}</span>
                </li>
            </ul>
            <Button size="sm" variant="secondary" icon-class="i-lucide-plus" :disabled="row.disabled" @click="add(row.value)">添加一条</Button>
        </SettingsRow>
        <SettingsRow v-slot="row" :settings="settings" :setting="snippetsSettings.autoInsert" :layer="context.layer.value" :project-title="context.projectTitle.value">
            <Switch :id="row.id" :model-value="row.value === true" :disabled="row.disabled" :aria-label="row.label" @update:model-value="setAutoInsert" />
        </SettingsRow>
    </div>
</template>

<style scoped>
.sample-snippets {
    display: flex;
    flex-direction: column;
}

.sample-snippets__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-4);
    padding: 0;
    list-style: none;
}

.sample-snippets__item {
    display: flex;
    gap: var(--space-5);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
}

.sample-snippets__name {
    width: 80px;
    flex-shrink: 0;
    color: var(--text-main);
}

.sample-snippets__text {
    min-width: 0;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}
</style>
