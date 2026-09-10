<script setup lang="ts">
import {computed, nextTick, ref, useId, type ComponentPublicInstance} from "vue";
import {Button, SegmentedControl, Tooltip} from "@notnotype/nb-ui/components";
import type {SegmentedControlOption} from "@notnotype/nb-ui/components";
import type {
    NovelIdeSettingsViewEmits,
    NovelIdeSettingsViewProps,
    SettingsScopeId,
    SettingsSectionOption,
} from "./NovelIdeSettingsView.types";

const props = withDefaults(defineProps<NovelIdeSettingsViewProps>(), {
    targetLabel: "",
    versionLabel: "",
    githubUrl: "",
    loading: false,
    loadError: "",
});
const emit = defineEmits<NovelIdeSettingsViewEmits>();

const headingId = `settings-sections-${useId()}`;
const mobileNavOpen = ref(false);
const detailTitleRef = ref<HTMLElement | null>(null);
const chooseSectionBtnRef = ref<ComponentPublicInstance | HTMLButtonElement | null>(null);
const mobileNavBackBtnRef = ref<ComponentPublicInstance | HTMLButtonElement | null>(null);

function getBtnElement(button: ComponentPublicInstance | HTMLButtonElement | null): HTMLElement | null {
    if (!button) return null;
    return "$el" in button ? (button.$el as HTMLElement) : (button as HTMLElement);
}

function openMobileNav(): void {
    mobileNavOpen.value = true;
    void nextTick(() => {
        getBtnElement(mobileNavBackBtnRef.value)?.focus();
    });
}

function closeMobileNav(): void {
    mobileNavOpen.value = false;
    void nextTick(() => {
        getBtnElement(chooseSectionBtnRef.value)?.focus();
    });
}

const scopeOptions = computed<SegmentedControlOption[]>(() => props.scopes.map((scope) => ({
    value: scope.value,
    label: scope.label,
    title: scope.disabledReason || scope.description,
    disabled: Boolean(scope.disabledReason),
})));

/** 当前作用域下真正存在的区段；作用域与区段都受控，视图只做交集。 */
const visibleSections = computed<SettingsSectionOption[]>(() =>
    props.sections.filter((section) => section.scopes.includes(props.scope)));

const activeSection = computed<SettingsSectionOption | null>(() =>
    visibleSections.value.find((section) => section.value === props.modelValue) ?? null);

function selectScope(scope: SettingsScopeId | string | number | boolean | null): void {
    const next = String(scope) as SettingsScopeId;
    if (next === props.scope) return;
    emit("update:scope", next);
    // 作用域换了以后旧区段可能不存在：直接改选新作用域的第一个区段，宿主不必自己兜底。
    const nextSections = props.sections.filter((section) => section.scopes.includes(next));
    if (!nextSections.some((section) => section.value === props.modelValue)) {
        emit("update:modelValue", nextSections[0]?.value ?? "");
    }
}

function selectSection(value: string): void {
    const wasMobileOpen = mobileNavOpen.value;
    emit("update:modelValue", value);
    mobileNavOpen.value = false;
    if (wasMobileOpen) {
        void nextTick(() => {
            detailTitleRef.value?.focus();
        });
    }
}
</script>

<template>
    <div class="settings-view-root flex h-full min-h-0 min-w-0 flex-col" data-lab-subject>
        <div class="flex min-h-0 flex-1">
            <!-- 导航轨自带右分割线，不画卡片面；内边距由轨道提供。 -->
            <aside
                class="settings-nav-aside shrink-0 flex-col gap-[var(--space-4)] p-[var(--space-6)]"
                :class="{'is-mobile-open': mobileNavOpen}"
            >
                <div class="settings-mobile-bar shrink-0 items-center justify-between border-b border-[var(--divider)] px-4 py-2 mb-2">
                    <span class="text-xs font-semibold text-[var(--text-main)]">设置</span>
                    <Button
                        ref="mobileNavBackBtnRef"
                        size="sm"
                        variant="secondary"
                        @click="closeMobileNav"
                    >
                        <span class="i-lucide-arrow-left mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                        返回
                    </Button>
                </div>

                <SegmentedControl
                    :model-value="props.scope"
                    :options="scopeOptions"
                    size="sm"
                    full-width
                    aria-label="配置作用域"
                    @update:model-value="selectScope"
                />

                <div v-if="props.targetLabel" class="flex min-w-0 shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] pb-[var(--space-3)]">
                    <span class="i-lucide-folder-cog h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1 truncate text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]" :title="props.targetLabel">{{ props.targetLabel }}</span>
                </div>

                <nav :aria-labelledby="headingId" class="flex min-h-0 min-w-0 flex-1 flex-col">
                    <h2 :id="headingId" class="sr-only">设置区段</h2>
                    <ul class="custom-scrollbar flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto pr-[var(--space-1)]">
                        <li v-for="section in visibleSections" :key="section.value" class="min-w-0">
                            <button
                                type="button"
                                class="group relative flex w-full min-w-0 cursor-pointer items-start gap-[var(--space-2)] overflow-hidden rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-2)] text-left transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                                :class="props.modelValue === section.value ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                                :aria-current="props.modelValue === section.value ? 'page' : undefined"
                                @click="selectSection(section.value)"
                            >
                                <span
                                    class="mt-[var(--space-1)] h-4 w-4 shrink-0"
                                    :class="[section.iconClass, props.modelValue === section.value ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)]']"
                                    aria-hidden="true"
                                ></span>
                                <span class="min-w-0 flex-1">
                                    <span class="block truncate text-[var(--text-sm)] leading-[var(--leading-ui)] [font-weight:var(--weight-medium)]" :class="props.modelValue === section.value ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ section.label }}</span>
                                    <span class="mt-[var(--space-1)] block truncate text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ section.description }}</span>
                                </span>
                            </button>
                        </li>
                    </ul>
                </nav>

                <div v-if="props.versionLabel" class="shrink-0 text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">
                    {{ props.versionLabel }}
                </div>
            </aside>

            <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                <section class="settings-detail-section min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div class="settings-mobile-bar shrink-0 items-center justify-between border-b border-[var(--divider)] px-4 py-2">
                        <span ref="detailTitleRef" tabindex="-1" class="truncate text-xs font-semibold text-[var(--text-main)] outline-none">
                            {{ activeSection?.label ?? "" }}
                        </span>
                        <Button
                            ref="chooseSectionBtnRef"
                            size="sm"
                            variant="secondary"
                            @click="openMobileNav"
                        >
                            <span class="i-lucide-list mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                            区段
                        </Button>
                    </div>

                    <div v-if="props.loadError" class="shrink-0 px-[var(--space-6)] pt-[var(--space-3)]">
                        <div class="rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger)]">
                            <p>{{ props.loadError }}</p>
                            <Button class="mt-2" size="sm" variant="ghost" @click="emit('reload')">重新加载</Button>
                        </div>
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto p-[var(--space-6)]">
                        <div v-if="props.loading" class="max-w-3xl space-y-3" aria-busy="true">
                            <div class="h-6 w-40 animate-pulse rounded bg-[var(--bg-input)]"></div>
                            <div class="h-24 animate-pulse rounded bg-[var(--bg-input)]"></div>
                            <div class="h-40 animate-pulse rounded bg-[var(--bg-input)]"></div>
                        </div>
                        <slot v-else :section="activeSection"></slot>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.settings-view-root {
    container-type: inline-size;
}

/* 栏间竖线与区段横线同款：1px --divider，两端留出内边距，不与标题栏或内容边线相接。 */
.settings-nav-aside {
    position: relative;
    display: flex;
    /* 导航轨自带 16px 内边距，宽度在此之上补足。 */
    width: 276px;
}

.settings-nav-aside::after {
    content: "";
    position: absolute;
    top: var(--space-6);
    right: 0;
    bottom: var(--space-6);
    width: var(--border-w);
    background: var(--divider);
}

.settings-detail-section {
    display: flex;
}

/* 只有窄容器才出现切换条；宽容器两栏常驻。 */
.settings-mobile-bar {
    display: none;
}

/* 窄容器退化为单列：导航与详情互斥，靠切换条往返。显示态只在这里声明，元素上不挂 display 工具类。 */
@container (max-width: 699px) {
    .settings-nav-aside {
        display: none;
    }
    .settings-nav-aside::after {
        display: none;
    }
    .settings-nav-aside.is-mobile-open {
        display: flex;
        width: 100%;
    }
    .settings-detail-section.is-mobile-open {
        display: none;
    }
    .settings-mobile-bar {
        display: flex;
    }
}
</style>
