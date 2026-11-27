<script setup lang="ts">
import {Badge, Button, IconButton, InfoTip, Tooltip} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import type {ProfileToolsField, ToolChange} from "../profile-view";
import {useAgentPageText} from "../text";
import AddToolsDialog from "./AddToolsDialog.vue";

/**
 * Profile 设置页的绑定列表一节（同名 .md）：工具一节，也是“可派的子代理”“Skill”“表情包”三节（`kind` 选文字）。几节的行、分组、添加与恢复默认
 * 相同；表情包的行首多一张缩略图（第一个常用表情）。
 */
const props = withDefaults(defineProps<{
    tools: ProfileToolsField;
    disabled?: boolean;
    addTools?: (change: ToolChange) => Promise<string | null>;
    initialAdd?: boolean;
    kind?: "tools" | "agents" | "skills" | "stickers";
}>(), {disabled: false, addTools: async () => null, initialAdd: false, kind: "tools"});

const emit = defineEmits<{
    (e: "remove", id: string): void;
    (e: "restore"): void;
    /** 用户去掉的那一行点了“加回”（Skill、表情包两节有）。 */
    (e: "add-back", id: string): void;
}>();

const text = useAgentPageText();
/** 几节的文字在目录里结构相同，只是前缀不同。返回类型列出几节的全部键：哪一节缺了键，类型检查就报。 */
type SectionText = "section.help" | "section.count" | "section.restore" | "section.add" | "required" | "remove";
const key = (rest: SectionText): `profiles.${"tools" | "agents" | "skills" | "stickers"}.${SectionText}` => `profiles.${props.kind}.${rest}`;
const sectionKey: `profiles.sections.${"tools" | "agents" | "skills" | "stickers"}` = `profiles.sections.${props.kind}`;
/** “加回”只有 Skill、表情包两节有，文字各在自己的前缀下。 */
const addBackKey = (rest: "addBack" | "addBackLabel"): `profiles.${"skills" | "stickers"}.${"addBack" | "addBackLabel"}` => `profiles.${props.kind === "stickers" ? "stickers" : "skills"}.${rest}`;
const folded = ref(new Set<string>());
function fold(id: string): void {
    const next = new Set(folded.value);
    if (!next.delete(id)) next.add(id);
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
    <section class="profile-tools" :class="{'profile-tools--skills': props.kind === 'skills' || props.kind === 'stickers', 'profile-tools--stickers': props.kind === 'stickers'}" :data-profile-section="props.kind" data-profile-tools>
        <div class="profile-tools__title">
            <h4>{{ text(sectionKey) }}</h4>
            <InfoTip :text="text(key('section.help'))" />
            <span class="profile-tools__count">{{ text(key('section.count'), {count: tools.count}) }}</span>
            <span class="profile-tools__side">
                <Button v-if="tools.modified" size="sm" variant="ghost" :disabled="disabled" data-profile-tools-restore @click="emit('restore')">{{ text(key('section.restore')) }}</Button>
                <Button size="sm" variant="secondary" icon-class="i-lucide-plus" :disabled="disabled" data-profile-tools-add @click="openAdd">{{ text(key('section.add')) }}</Button>
            </span>
        </div>
        <section v-for="group in tools.groups" :key="group.id" class="profile-tools__group" :data-profile-tool-group="group.id">
            <button type="button" class="profile-tools__group-head nb-ui-focus-ring" :aria-expanded="!folded.has(group.id)" @click="fold(group.id)">
                <span :class="folded.has(group.id) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" aria-hidden="true" />
                {{ group.provider }}<span class="profile-tools__group-count">{{ group.tools.length }}</span>
            </button>
            <ul v-if="!folded.has(group.id)" class="profile-tools__rows">
                <li v-for="tool in group.tools" :key="tool.id" class="profile-tools__row" :class="{'is-gone': tool.gone}" :data-profile-tool="tool.id" :data-profile-tool-object="tool.object">
                    <span v-if="props.kind === 'stickers'" class="profile-tools__name-cell">
                        <img v-if="tool.thumbnail !== undefined" class="profile-tools__thumb" :src="tool.thumbnail" alt="" loading="lazy" decoding="async" />
                        <span v-else class="profile-tools__thumb" aria-hidden="true"></span>
                        <span class="profile-tools__name" :title="tool.name">{{ tool.name }}</span>
                    </span>
                    <code v-else class="profile-tools__name" :title="tool.name">{{ tool.name }}</code>
                    <span class="profile-tools__effect" :class="{'is-danger': tool.danger}">{{ tool.effect }}</span>
                    <Tooltip :text="tool.detail">
                        <span class="profile-tools__summary" :class="{'is-warning': tool.warning}" tabindex="0"><span v-if="tool.warning" class="i-lucide-triangle-alert profile-tools__reason" aria-hidden="true" />{{ tool.summary }}</span>
                    </Tooltip>
                    <span class="profile-tools__action">
                        <Badge v-if="tool.required" size="sm" variant="soft" :tone="tool.gone ? 'warning' : undefined">{{ text(key('required')) }}</Badge>
                        <Button v-else-if="tool.restorable === true" size="sm" variant="ghost" :aria-label="text(addBackKey('addBackLabel'), {name: tool.name, id: tool.label ?? tool.id})" :disabled="disabled" data-profile-tool-add-back @click="emit('add-back', tool.id)">{{ text(addBackKey('addBack')) }}</Button>
                        <Tooltip v-else :text="text(key('remove'), {name: tool.name, id: tool.label ?? tool.id})">
                            <IconButton size="xs" icon-class="i-lucide-x" :aria-label="text(key('remove'), {name: tool.name, id: tool.label ?? tool.id})" :disabled="disabled" data-profile-tool-remove @click="emit('remove', tool.id)" />
                        </Tooltip>
                    </span>
                </li>
            </ul>
        </section>
        <AddToolsDialog
            :kind="props.kind" v-model:open="adding" :candidates="tools.candidates" :busy="busy" :status="failure" @done="done" />
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
    /* 等级与最右一格按英文定宽（Write、Required），中文也用同样的宽度：行与行才对得齐。 */
    grid-template-columns: 136px 36px minmax(0, 1fr) 64px;
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

/* 这一行有问题（全局对象要先加入 eval）：与模型一栏的提示同一个图标与颜色。 */
.profile-tools__summary.is-warning {
    color: var(--status-warning);
}

.profile-tools__reason {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    margin-right: var(--space-1);
    vertical-align: -0.2em;
}

.profile-tools__action {
    display: flex;
    justify-content: flex-end;
}

/* Skill 一节的状态写“未初始化”“无效”，最右一格是“加回”：这两列按它们定宽，整节的行照样对齐。 */
.profile-tools--skills .profile-tools__row {
    grid-template-columns: 136px 6.5em minmax(0, 1fr) 72px;
}

/* 表情包：名字是显示名（中文居多），不用等宽；行首一张 24px 的缩略图，没有表情时留同样大的空位，名字对齐。 */
.profile-tools__name-cell {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
}

.profile-tools--stickers .profile-tools__name {
    font-family: inherit;
}

.profile-tools__thumb {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    object-fit: contain;
}

/* 页面不到 600px：一行变两行，说明放不下几个字时不如另起一行。 */
@container (max-width: 600px) {
    .profile-tools__row {
        grid-template-columns: minmax(0, 1fr) 36px 64px;
        row-gap: 0;
        padding-block: var(--space-1);
    }

    .profile-tools--skills .profile-tools__row {
        grid-template-columns: minmax(0, 1fr) 6.5em 72px;
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
