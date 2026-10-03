<script setup lang="ts">
import {computed, ref} from "vue";
import {Badge, Tooltip} from "@notnotype/nb-ui/components";
import type {BadgeTone} from "@notnotype/nb-ui/components";

const props = defineProps<{
    /** 启动期 auth.enabled 的运行时状态；null 表示还没读到 session */
    authEnabled: boolean | null;
}>();

const {t} = useI18n();

const statusLabel = computed(() => {
    if (props.authEnabled === null) {
        return t("settings.security.statusUnknown");
    }
    return props.authEnabled ? t("settings.security.statusEnabled") : t("settings.security.statusDisabled");
});

const statusTone = computed<BadgeTone>(() => {
    if (props.authEnabled === null) {
        return "neutral";
    }
    return props.authEnabled ? "success" : "warning";
});

const statusHint = computed(() => {
    if (props.authEnabled === null) {
        return t("settings.security.statusUnknownHint");
    }
    return props.authEnabled
        ? t("settings.security.statusEnabledHint")
        : t("settings.security.statusDisabledHint");
});

/** 与根目录 config.yaml 的字面对应：状态未知时给出可枚举的占位，不假装知道。 */
const authExample = computed(() => `auth:\n    enabled: ${props.authEnabled === null ? "<true|false>" : String(props.authEnabled)}`);

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

/** 复制示例：只写剪贴板，不改任何状态；失败就静默（示例本来就能手抄）。 */
async function copyExample(): Promise<void> {
    try {
        await navigator.clipboard.writeText(authExample.value);
    } catch {
        return;
    }
    copied.value = true;
    if (copiedTimer !== null) {
        clearTimeout(copiedTimer);
    }
    copiedTimer = setTimeout(() => {
        copiedTimer = null;
        copied.value = false;
    }, 1500);
}
</script>

<template>
    <div class="security-view-root flex min-w-0 max-w-3xl flex-col" data-lab-subject>
        <!-- 这一页只解释，不写回：先把这件事说清楚，避免用户在这里找开关 -->
        <header class="flex items-start gap-[var(--space-3)]">
            <span class="i-lucide-shield-check mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info)]" aria-hidden="true"></span>
            <div class="min-w-0">
                <div class="flex items-center gap-[var(--space-2)]">
                    <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.security.title") }}</h2>
                    <!-- 「写到哪里、为什么改不了」属于元信息：按规范走 tooltip，不占正文行 -->
                    <Tooltip :text="t('settings.security.descriptionDetail')">
                        <button type="button" class="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" :aria-label="t('settings.security.descriptionDetailLabel')">
                            <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                        </button>
                    </Tooltip>
                </div>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.security.description") }}</p>
            </div>
        </header>

        <!-- 当前状态：值 + 徽标 + 一句「这个值是什么时候的」 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <div class="font-mono text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">auth.enabled</div>
                    <div class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ statusHint }}</div>
                </div>
                <Badge class="shrink-0" variant="soft" :tone="statusTone">{{ statusLabel }}</Badge>
            </div>
        </section>

        <!-- 配置示例：这一页唯一可以带走的东西 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex items-center justify-between gap-[var(--space-3)]">
                <h3 class="text-[var(--text-2xs)] [font-weight:var(--weight-strong)] tracking-[0.16em] text-[var(--text-muted)]">{{ t("settings.security.exampleTitle") }}</h3>
                <button
                    type="button"
                    class="inline-flex h-6 shrink-0 items-center gap-[var(--space-1)] rounded-[var(--radius-control)] px-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    @click="void copyExample()"
                >
                    <span class="h-3.5 w-3.5" :class="copied ? 'i-lucide-check text-[var(--status-success)]' : 'i-lucide-copy'" aria-hidden="true"></span>
                    {{ copied ? t("settings.security.copied") : t("settings.security.copy") }}
                </button>
            </div>
            <pre class="mt-[var(--space-2)] overflow-x-auto rounded-[var(--radius-control)] border border-[var(--divider)] bg-[var(--bg-input)] p-[var(--space-4)] font-mono text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ authExample }}</pre>
        </section>

        <!-- 代价：说清关掉之后会发生什么 -->
        <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <p class="flex items-start gap-[var(--space-2)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--status-warning)]">
                <span class="i-lucide-triangle-alert mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                <span class="min-w-0">{{ t("settings.security.warning") }}</span>
            </p>
        </section>
    </div>
</template>
