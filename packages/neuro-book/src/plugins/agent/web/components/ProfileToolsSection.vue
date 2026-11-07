<script setup lang="ts">
import {Badge, Button, IconButton, InfoTip, Tooltip} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import type {ProfileToolsField, ToolChange} from "../profile-view";
import {useAgentPageText} from "../text";
import AddToolsDialog from "./AddToolsDialog.vue";

/** Profile 设置页的工具一节（同名 .md）。 */
const props = withDefaults(defineProps<{
    tools: ProfileToolsField;
    disabled?: boolean;
    addTools?: (change: ToolChange) => Promise<string | null>;
    initialAdd?: boolean;
}>(), {disabled: false, addTools: async () => null, initialAdd: false});

const emit = defineEmits<{
    (e: "remove", id: string): void;
    (e: "restore"): void;
}>();

const text = useAgentPageText();
const folded = ref(new Set<string>());
function fold(provider: string): void {
    const next = new Set(folded.value);
    if (!next.delete(provider)) next.add(provider);
    folded.value = next;
}

const adding = ref(props.initialAdd);
const busy = ref(false);
const failure = ref("");
async function done(change: ToolChange): Promise<void> {
    busy.value = true;
    failure.value = await props.addTools(change) ?? "";
    busy.value = false;
    if (failure.value === "") adding.value = false;
}
function openAdd(): void {
    failure.value = "";
    adding.value = true;
}
</script>

<template>
    <section class="profile-tools" data-profile-tools>
        <div class="profile-tools__title">
            <h4>{{ text("profiles.sections.tools") }}</h4>
            <InfoTip :text="text('profiles.tools.section.help')" />
            <span class="profile-tools__count">{{ text("profiles.tools.section.count", {count: tools.count}) }}</span>
            <span class="profile-tools__side">
                <Button v-if="tools.modified" size="sm" variant="ghost" :disabled="disabled" data-profile-tools-restore @click="emit('restore')">{{ text("profiles.tools.section.restore") }}</Button>
                <Button size="sm" variant="secondary" icon-class="i-lucide-plus" :disabled="disabled" data-profile-tools-add @click="openAdd">{{ text("profiles.tools.section.add") }}</Button>
            </span>
        </div>
        <section v-for="group in tools.groups" :key="group.provider" class="profile-tools__group" :data-profile-tool-group="group.provider">
            <button type="button" class="profile-tools__group-head nb-ui-focus-ring" :aria-expanded="!folded.has(group.provider)" @click="fold(group.provider)">
                <span :class="folded.has(group.provider) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" aria-hidden="true" />
                {{ group.provider }}<span class="profile-tools__group-count">{{ group.tools.length }}</span>
            </button>
            <ul v-if="!folded.has(group.provider)" class="profile-tools__rows">
                <li v-for="tool in group.tools" :key="tool.id" class="profile-tools__row" :class="{'is-gone': tool.gone}" :data-profile-tool="tool.id">
                    <code class="profile-tools__name">{{ tool.name }}</code>
                    <span class="profile-tools__effect" :class="{'is-danger': tool.danger}">{{ tool.effect }}</span>
                    <Tooltip :text="tool.detail">
                        <span class="profile-tools__summary" tabindex="0">{{ tool.summary }}</span>
                    </Tooltip>
                    <span class="profile-tools__action">
                        <Badge v-if="tool.required" size="sm" variant="soft" :tone="tool.gone ? 'warning' : undefined">{{ text("profiles.tools.required") }}</Badge>
                        <Tooltip v-else :text="text('profiles.tools.remove', {name: tool.name, id: tool.id})">
                            <IconButton size="xs" icon-class="i-lucide-x" :aria-label="text('profiles.tools.remove', {name: tool.name, id: tool.id})" :disabled="disabled" data-profile-tool-remove @click="emit('remove', tool.id)" />
                        </Tooltip>
                    </span>
                </li>
            </ul>
        </section>
        <AddToolsDialog v-model:open="adding" :candidates="tools.candidates" :busy="busy" :status="failure" @done="done" />
    </section>
</template>

<style scoped>
.profile-tools {
    display: flex;
    flex-direction: column;
}

.profile-tools__title {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
}

.profile-tools__title h4 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
}

.profile-tools__count {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.profile-tools__side {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
}

.profile-tools__group {
    margin-top: var(--space-2);
}

/* 同“服务商与模型”的模型系列。 */
.profile-tools__group-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
    cursor: pointer;
}

.profile-tools__group-count {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.profile-tools__rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* 名字、等级、说明各占一列，同一组里上下对齐；行高不随内容变。 */
.profile-tools__row {
    display: grid;
    min-height: 37px;
    grid-template-columns: 136px 28px minmax(0, 1fr) 40px;
    align-items: center;
    gap: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
}

.profile-tools__name {
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.profile-tools__row.is-gone .profile-tools__name {
    color: var(--text-muted);
    text-decoration: line-through;
}

.profile-tools__effect {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
}

.profile-tools__effect.is-danger {
    color: var(--status-warning);
}

.profile-tools__summary {
    min-width: 0;
    overflow: hidden;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.profile-tools__action {
    display: flex;
    justify-content: flex-end;
}

/* 页面不到 600px：一行变两行，说明放不下几个字时不如另起一行。 */
@container (max-width: 600px) {
    .profile-tools__row {
        grid-template-columns: minmax(0, 1fr) 28px 40px;
        row-gap: 0;
        padding-block: var(--space-1);
    }

    .profile-tools__summary {
        grid-column: 1 / -1;
        grid-row: 2;
    }

    .profile-tools__action {
        grid-column: 3;
        grid-row: 1;
    }
}
</style>
