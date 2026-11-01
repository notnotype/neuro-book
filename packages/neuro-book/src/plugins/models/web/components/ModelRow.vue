<script setup lang="ts">
import {Button, IconButton, Popover, Switch, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import type {SnapshotModel} from "../../shared/contracts";
import type {CheckState} from "../models-store";
import {priceText, tokensText, useModelsText} from "../text";
import CapabilityIcons from "./CapabilityIcons.vue";

/**
 * 服务商详情里的一行模型（docs/specs/models/settings-pages.md 输出 6 到 8）：启用开关、名称、能力、淡色的窗口与单价、检测状态、
 * 检测与编辑。停用被角色用着的模型时先在行内确认。
 */
const props = withDefaults(defineProps<{
    model: SnapshotModel;
    check?: CheckState;
    /** 绑着这个模型的角色名。 */
    roles?: readonly string[];
    disabled?: boolean;
}>(), {check: undefined, roles: () => [], disabled: false});

const emit = defineEmits<{
    (e: "toggle", enabled: boolean): void;
    (e: "check"): void;
    (e: "edit"): void;
}>();

const text = useModelsText();
const confirming = ref(false);
const detailOpen = ref(false);
const incomplete = computed(() => props.model.status === "incomplete");
const missing = computed(() => props.model.status === "missing");

function toggle(enabled: boolean): void {
    if (!enabled && props.roles.length > 0) {
        confirming.value = true;
        return;
    }
    emit("toggle", enabled);
}

function confirmDisable(): void {
    confirming.value = false;
    emit("toggle", false);
}

const failed = computed(() => (props.check?.status === "done" && !props.check.result.ok ? props.check.result : null));
const failedReason = computed(() => {
    if (failed.value === null) return "";
    const kind = failed.value.kind;
    return ["network", "rate_limit", "auth", "quota", "context_overflow", "provider", "local"].includes(kind) ? text(`check.kinds.${kind}` as "check.kinds.other") : text("check.kinds.other");
});
const failedAt = computed(() => (props.check?.status === "done" ? new Date(props.check.at).toLocaleTimeString() : ""));

function retry(): void {
    detailOpen.value = false;
    emit("check");
}
</script>

<template>
    <li class="model-row" :data-model-row="model.id">
        <div class="model-row__main">
            <Tooltip :text="text('models.incompleteTip')" :disabled="!incomplete">
                <span class="model-row__switch">
                    <Switch :model-value="model.enabled" size="sm" :aria-label="text('models.enable', {name: model.name})" :disabled="disabled || (incomplete && !model.enabled)" @update:model-value="toggle" />
                </span>
            </Tooltip>
            <span class="model-row__name">{{ model.name }}<span v-if="model.name !== model.id" class="model-row__id">{{ model.id }}</span></span>
            <span v-for="role in roles" :key="role" class="model-row__role">{{ role }}</span>
            <CapabilityIcons :vision="model.vision" :reasoning="model.reasoning" :efforts="model.efforts" />
            <span v-if="missing" class="model-row__warn">{{ text("models.missing") }}</span>
            <span v-else-if="incomplete" class="model-row__warn">{{ text("models.incomplete") }}</span>
            <template v-else>
                <span class="model-row__fact">{{ model.contextWindow === null ? "" : tokensText(model.contextWindow) }}</span>
                <span class="model-row__fact model-row__fact--price">{{ priceText(text, model.price) }}</span>
            </template>
            <span class="model-row__status">
                <span v-if="check?.status === 'running'" class="i-lucide-loader-circle model-row__spin" role="img" :aria-label="text('check.running')" />
                <Popover v-else-if="failed !== null" :open="detailOpen" side="bottom" align="end" @update:open="(value: boolean) => (detailOpen = value)">
                    <template #trigger>
                        <button type="button" class="model-row__failed nb-ui-focus-ring" :aria-label="text('check.failedOf', {name: model.name})" data-check-failed>
                            <span class="i-lucide-circle-alert" aria-hidden="true" />
                        </button>
                    </template>
                    <div class="model-row__detail" data-check-detail>
                        <strong>{{ text("check.failedAt", {time: failedAt}) }}</strong>
                        <p>{{ failedReason }}</p>
                        <code v-if="failed.raw !== ''">{{ failed.raw }}</code>
                        <Button size="sm" variant="secondary" icon-class="i-lucide-play" @click="retry">{{ text("check.retry") }}</Button>
                    </div>
                </Popover>
                <Tooltip v-else-if="check?.status === 'done'" :text="text('check.ok')">
                    <span class="i-lucide-circle-check model-row__ok" role="img" :aria-label="text('check.ok')" data-check-ok />
                </Tooltip>
            </span>
            <span class="model-row__actions">
                <Tooltip :text="text('models.checkTip')">
                    <IconButton size="xs" icon-class="i-lucide-play" :aria-label="text('models.check', {name: model.name})" :disabled="disabled || !model.enabled || check?.status === 'running'" @click="emit('check')" />
                </Tooltip>
                <Tooltip :text="text('models.editTip')">
                    <IconButton size="xs" icon-class="i-lucide-settings-2" :aria-label="text('models.edit', {name: model.name})" :disabled="disabled" @click="emit('edit')" />
                </Tooltip>
            </span>
        </div>
        <div v-if="confirming" class="model-row__confirm" role="alert" data-model-confirm>
            <span>{{ text("models.confirmDisable", {roles: roles.join("、")}) }}</span>
            <Button size="sm" variant="ghost" @click="confirming = false">{{ text("models.cancel") }}</Button>
            <Button size="sm" variant="danger" @click="confirmDisable">{{ text("models.confirmDisableAction") }}</Button>
        </div>
    </li>
</template>

<style scoped>
.model-row {
    border-bottom: var(--border-w) solid var(--divider);
}

.model-row__main {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-3);
}

.model-row__switch {
    display: inline-flex;
}

.model-row__name {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: baseline;
    gap: var(--space-2);
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.model-row__id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.model-row__role {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
    font-size: var(--text-2xs);
    color: var(--accent-text);
}

.model-row__fact {
    flex-shrink: 0;
    width: 44px;
    font-size: var(--text-xs);
    text-align: right;
    color: var(--text-muted);
}

.model-row__fact--price {
    width: 84px;
}

.model-row__warn {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--status-warning);
}

.model-row__status {
    display: inline-flex;
    width: 16px;
    flex-shrink: 0;
    justify-content: center;
}

.model-row__ok {
    color: var(--status-success);
}

.model-row__spin {
    color: var(--text-muted);
    animation: model-row-spin 1s linear infinite;
}

@keyframes model-row-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .model-row__spin {
        animation: none;
    }
}

.model-row__failed {
    display: inline-flex;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--status-danger);
    cursor: pointer;
}

.model-row__detail {
    display: flex;
    max-width: 320px;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-sm);
}

.model-row__detail p {
    margin: 0;
    color: var(--text-secondary);
}

.model-row__detail code {
    max-width: 100%;
    max-height: 160px;
    padding: var(--space-2);
    overflow: auto;
    overflow-wrap: anywhere;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

.model-row__actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-1);
}

.model-row__confirm {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 0 var(--space-3) var(--space-8);
    font-size: var(--text-xs);
    color: var(--status-warning);
}

.model-row__confirm > span {
    flex: 1;
}
</style>
