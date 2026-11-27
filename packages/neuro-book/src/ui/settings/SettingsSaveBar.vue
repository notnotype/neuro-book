<script setup lang="ts">
/**
 * 设置页面底部的保存栏（同名 .md，docs/specs/settings/settings-window.md“给页面用的组件”）：设置文件视图与 page 分区的草稿
 * 共用，两处的“保存”“放弃更改”长得一样、位置一样。组件只管外观与按钮的停用，不记草稿，不知道怎样保存：点了发出
 * `save`、`discard` 交给页面。
 */
import {Button} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed} from "vue";

import {settingsUiText} from "./text";
import type {SettingsUiKey} from "./text";

defineOptions({name: "SettingsSaveBar"});

const props = withDefaults(defineProps<{
    /** 有没有未保存的改动：没有时两个按钮停用、不写文字。 */
    dirty: boolean;
    /** 正在保存：两个按钮停用，避免重复提交与保存途中放弃。 */
    busy: boolean;
    /** 能不能保存（例如这一层暂时连不上时为假）：只停用“保存”；放弃只丢本地草稿，照常可用。缺省为真。 */
    canSave?: boolean;
    /** 栏左侧的状态文字（已按显示语言写好）；有改动时缺省为“有未保存的更改”，没有改动时不显示。 */
    message?: string;
}>(), {canSave: true, message: undefined});

const emit = defineEmits<{
    (event: "save"): void;
    (event: "discard"): void;
}>();

/** 三处固定文字在 `nbook.settings` 的目录里，经宿主注入的翻译端口翻译。 */
const port = useText();
const text = (key: SettingsUiKey): string => port.t(settingsUiText(key));
const note = computed(() => (props.dirty ? (props.message ?? text("saveBar.unsaved")) : null));
</script>

<template>
    <!-- 按钮一直在，没有改动时停用：停用的按钮留不住焦点，调用方在保存成功后把焦点放回编辑处；按钮不会因为状态变化而出现、消失，栏的高度不跳。 -->
    <footer class="settings-save-bar" data-settings-save-bar :data-dirty="dirty ? '' : undefined">
        <span v-if="note !== null" class="settings-save-bar__note" role="status" data-settings-save-bar-note>
            <span class="settings-save-bar__dot" aria-hidden="true"></span>
            <span>{{ note }}</span>
        </span>
        <Button size="sm" variant="ghost" :disabled="busy || !dirty" data-settings-save-bar-discard @click="emit('discard')">{{ text('saveBar.discard') }}</Button>
        <Button variant="primary" size="sm" :disabled="busy || !dirty || !canSave" data-settings-save-bar-save @click="emit('save')">{{ text('saveBar.save') }}</Button>
    </footer>
</template>

<style scoped>
/* 栏与内容之间只用一条线分节（不画框）；线在内容列的内边距之内，两端不碰边。 */
.settings-save-bar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-5);
    padding: var(--space-5) 0;
    border-top: var(--border-w) solid var(--divider);
}

.settings-save-bar__note {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3);
    margin-right: auto;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.settings-save-bar__dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--status-warning);
}
</style>
