<script setup lang="ts">
import {IconButton, SearchSelect, Select, Tooltip} from "@notnotype/nb-ui/components";
import {useId} from "vue";

import SettingsNotice from "nbook/ui/settings/SettingsNotice.vue";

import type {ProfileView} from "../profile-view";
import {useAgentPageText} from "../text";

/** Profile 设置页右边的一个 Profile（同名 .md）。 */
withDefaults(defineProps<{
    profile: ProfileView;
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (e: "model", value: string): void;
    (e: "approval", value: string): void;
    (e: "open-file"): void;
    (e: "delete"): void;
}>();

const text = useAgentPageText();
const modelHintId = useId();
const approvalHintId = useId();
</script>

<template>
    <div class="profile-detail" :data-profile-detail="profile.key">
        <header class="profile-detail__head">
            <Tooltip side="bottom">
                <div class="profile-detail__title" tabindex="0" data-profile-title>
                    <h3>{{ profile.name }}</h3>
                    <p>{{ profile.description }}</p>
                </div>
                <template #content>
                    <span v-if="profile.description !== ''" class="profile-detail__tip-line">{{ profile.description }}</span>
                    <span class="profile-detail__tip-line">{{ text("profiles.head.meta", {key: profile.key, source: profile.source}) }}</span>
                </template>
            </Tooltip>
            <Tooltip v-if="profile.notice !== null" side="bottom">
                <SettingsNotice class="profile-detail__notice" :tone="profile.notice.tone" focusable data-profile-notice>{{ profile.notice.text }}</SettingsNotice>
                <template #content>
                    <span v-for="(line, index) in profile.notice.lines" :key="index" class="profile-detail__tip-line">{{ line }}</span>
                </template>
            </Tooltip>
            <div v-if="profile.user" class="profile-detail__actions">
                <Tooltip :text="text('profiles.head.openFile')">
                    <IconButton size="sm" icon-class="i-lucide-file-code" :aria-label="text('profiles.head.openFile')" data-profile-open-file @click="emit('open-file')" />
                </Tooltip>
                <Tooltip :text="text('profiles.head.delete')">
                    <IconButton size="sm" icon-class="i-lucide-trash-2" :aria-label="text('profiles.head.delete')" :disabled="disabled" data-profile-delete @click="emit('delete')" />
                </Tooltip>
            </div>
        </header>

        <section class="profile-detail__group">
            <h4 class="profile-detail__section">{{ text("profiles.sections.model") }}</h4>
            <div class="profile-detail__row" data-profile-model>
                <div class="profile-detail__label">
                    <span class="profile-detail__label-title">
                        {{ text("profiles.model.label") }}
                        <span v-if="profile.model.warning" class="i-lucide-triangle-alert profile-detail__reason" aria-hidden="true" />
                    </span>
                    <Tooltip :text="profile.model.hint" :disabled="profile.model.hint === ''">
                        <small :id="modelHintId" :class="{'is-warning': profile.model.warning}" data-profile-model-hint>{{ profile.model.hint }}</small>
                    </Tooltip>
                </div>
                <SearchSelect
                    :model-value="profile.model.value"
                    :options="[...profile.model.options]"
                    :disabled="disabled || profile.model.disabled"
                    size="sm"
                    :aria-label="text('profiles.model.label')"
                    :aria-describedby="modelHintId"
                    @update:model-value="(value: string) => emit('model', value)"
                />
            </div>
            <div v-if="profile.approval !== null" class="profile-detail__row" data-profile-approval>
                <div class="profile-detail__label">
                    <span class="profile-detail__label-title">{{ text("profiles.approval.label") }}</span>
                    <Tooltip :text="profile.approval.hint">
                        <small :id="approvalHintId">{{ profile.approval.hint }}</small>
                    </Tooltip>
                </div>
                <Select
                    :model-value="profile.approval.value"
                    :options="[...profile.approval.options]"
                    :disabled="disabled"
                    size="sm"
                    :aria-label="text('profiles.approval.label')"
                    :aria-describedby="approvalHintId"
                    @update:model-value="(value: string) => emit('approval', value)"
                />
            </div>
        </section>

        <slot />
    </div>
</template>

<style scoped>
.profile-detail {
    display: flex;
    max-width: 720px;
    flex-direction: column;
    gap: var(--space-5);
}

.profile-detail__head {
    display: flex;
    min-width: 0;
    height: var(--control-h-sm);
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-3);
}

.profile-detail__title {
    display: flex;
    min-width: 0;
    flex: 1 1 0;
    align-items: baseline;
    gap: var(--space-3);
    border-radius: var(--radius-control);
}

.profile-detail__title h3 {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.profile-detail__title p {
    min-width: 0;
    flex: 1 1 0;
    overflow: hidden;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.profile-detail__notice {
    max-width: 62%;
    flex: 0 1 auto;
}

.profile-detail__tip-line {
    display: block;
    overflow-wrap: anywhere;
}

.profile-detail__actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-1);
}

.profile-detail__group {
    display: flex;
    flex-direction: column;
}

.profile-detail__section {
    margin: 0;
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
}

.profile-detail__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(200px, 280px);
    align-items: center;
    gap: var(--space-4);
    padding-block: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
}

/* 文字块固定两行（20、2、18），同 SettingsRow：有没有问题、说明换成哪句，这一行都一样高。 */
.profile-detail__label {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.profile-detail__label-title {
    display: flex;
    height: 20px;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    line-height: 20px;
}

.profile-detail__label small {
    height: 18px;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.profile-detail__label small.is-warning {
    color: var(--status-warning);
}

.profile-detail__reason {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--status-warning);
}

/* 页面不到 600px：控件换到标题下面，同 SettingsRow；问题块让位给名称，全文在提示里。 */
@container (max-width: 600px) {
    .profile-detail__notice {
        max-width: 45%;
    }

    .profile-detail__row {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-2);
    }
}
</style>
