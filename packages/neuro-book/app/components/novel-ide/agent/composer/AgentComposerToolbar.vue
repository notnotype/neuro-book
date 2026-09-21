<script setup lang="ts">
import {IconButton} from "@notnotype/nb-ui/components";
import {AGENT_MODE_META} from "nbook/app/components/novel-ide/agent/agent-composer-presentation";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    composerExpanded: boolean;
    composerReadonly: boolean;
    running: boolean;
    canRegisterImages: boolean;
    agentMode: AgentMode;
    sendDisabled: boolean;
    sendButtonTitle: string;
    sendIconClass: string;
}>();

const emit = defineEmits<{
    (e: "toggle-expand"): void;
    (e: "cycle-mode"): void;
    (e: "select-images"): void;
    (e: "submit", event: MouseEvent): void;
}>();

const {t} = useI18n();

const agentModeMeta = computed(() => AGENT_MODE_META[props.agentMode]);
const agentModeLabel = computed(() => t(`agent.mode.${props.agentMode}`));
const modeButtonTitle = computed(() => t("agent.composer.cycleModeTitle", {mode: agentModeLabel.value}));
const expandButtonTitle = computed(() => props.composerExpanded ? t("agent.composer.collapseEditor") : t("agent.composer.expandEditor"));
const expandButtonIcon = computed(() => props.composerExpanded ? "i-lucide-minimize-2" : "i-lucide-maximize-2");
</script>

<template>
    <div class="flex min-w-0 items-center gap-2 border-t border-[var(--border-color)] px-2 py-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <slot name="model-controls" />

            <IconButton
                size="sm"
                variant="default"
                :disabled="!props.canRegisterImages"
                title="选择图片（可多选，也可拖拽或粘贴）"
                aria-label="选择图片"
                @click="emit('select-images')"
            >
                <span class="i-lucide-image-plus h-3.5 w-3.5" />
            </IconButton>

            <IconButton
                size="sm"
                :variant="props.composerExpanded ? 'accent' : 'default'"
                :title="expandButtonTitle"
                :aria-label="expandButtonTitle"
                @click="emit('toggle-expand')"
            >
                <span :class="expandButtonIcon" class="h-3.5 w-3.5" />
            </IconButton>

            <!-- 三态模式切换按钮：normal → discuss → plan 循环 -->
            <IconButton
                size="sm"
                :variant="props.agentMode !== 'normal' ? 'accent' : 'default'"
                :disabled="props.composerReadonly || props.running"
                :title="modeButtonTitle"
                :aria-label="modeButtonTitle"
                @click="emit('cycle-mode')"
            >
                <span :class="agentModeMeta.icon" class="h-3.5 w-3.5" />
            </IconButton>
        </div>

        <button
            type="button"
            class="nb-ui-focus-ring flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-[0_1px_2px_color-mix(in_srgb,var(--accent-main)_25%,transparent)] transition-all [transition-duration:var(--motion-fast)] hover:bg-[color-mix(in_srgb,var(--accent-main)_86%,var(--text-main))] hover:shadow-[0_2.5px_8px_color-mix(in_srgb,var(--accent-main)_40%,transparent)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none disabled:active:transform-none"
            :disabled="props.sendDisabled"
            :title="props.sendButtonTitle"
            :aria-label="props.sendButtonTitle"
            @click.prevent="emit('submit', $event)"
        >
            <span :class="props.sendIconClass" class="h-3.5 w-3.5"></span>
        </button>
    </div>
</template>
