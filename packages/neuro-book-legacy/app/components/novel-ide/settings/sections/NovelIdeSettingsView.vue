<script setup lang="ts">
import {computed, nextTick, ref, useId, type ComponentPublicInstance} from "vue";
import {Button, SegmentedControl, Tooltip} from "@notnotype/nb-ui/components";
import type {SegmentedControlOption} from "@notnotype/nb-ui/components";
import SettingsLoadState from "./components/SettingsLoadState.vue";
import type {
    NovelIdeSettingsViewEmits,
    NovelIdeSettingsViewProps,
    SettingsScopeId,
    SettingsSectionOption,
} from "./NovelIdeSettingsView.types";

const props = withDefaults(defineProps<NovelIdeSettingsViewProps>(), {
    versionLabel: "",
    /** 环境标注（Lab / 本地 / 生产）；只影响左下角那枚小标 */
    environmentLabel: "",
    projects: () => [],
    activeProjectId: null,
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

/** 每个作用域记住上次停留的区段；切回来时回到原处，而不是每次都跳第一个。 */
const lastSectionByScope = ref<Record<string, string>>({});

watch(() => props.modelValue, (value) => {
    if (value) {
        lastSectionByScope.value = {...lastSectionByScope.value, [props.scope]: value};
    }
}, {immediate: true});

/** 当前作用域下真正存在的区段；作用域与区段都受控，视图只做交集。 */
const visibleSections = computed<SettingsSectionOption[]>(() =>
    props.sections.filter((section) => section.scopes.includes(props.scope)));

const activeSection = computed<SettingsSectionOption | null>(() =>
    visibleSections.value.find((section) => section.value === props.modelValue) ?? null);

function sectionsForScope(scope: SettingsScopeId): SettingsSectionOption[] {
    return props.sections.filter((section) => section.scopes.includes(scope));
}

function selectScope(scope: SettingsScopeId | string | number | boolean | null): void {
    const next = String(scope) as SettingsScopeId;
    if (next === props.scope) return;
    emit("update:scope", next);
    // 换作用域时回到这一档上次停留的区段；没记过或记的那个在这档不存在，就取第一个。
    const nextSections = sectionsForScope(next);
    const remembered = lastSectionByScope.value[next];
    const target = remembered && nextSections.some((section) => section.value === remembered)
        ? remembered
        : nextSections[0]?.value ?? "";
    if (target !== props.modelValue) {
        emit("update:modelValue", target);
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

                <!-- 左下角元信息：版本走等宽数字，环境是一枚软标注，与导航之间用发丝线分开 -->
                <div
                    v-if="props.versionLabel || props.environmentLabel || props.githubUrl"
                    class="flex shrink-0 items-center gap-[var(--space-2)] text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]"
                >
                    <!-- 版本串可以很长（canary + commit）：整行不换行、截断，完整值走 title -->
                    <span v-if="props.versionLabel" class="min-w-0 flex-1 truncate font-mono [font-variant-numeric:tabular-nums]" :title="props.versionLabel">{{ props.versionLabel }}</span>
                    <span v-if="props.environmentLabel" class="shrink-0 rounded-[var(--radius-pill)] bg-[var(--bg-input)] px-1.5 py-0.5 [font-weight:var(--weight-medium)]">{{ props.environmentLabel }}</span>
                    <a
                        v-if="props.githubUrl"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                        :href="props.githubUrl"
                        target="_blank"
                        rel="noreferrer"
                        :title="'打开 GitHub 仓库'"
                    >
                        <span class="i-lucide-github h-3.5 w-3.5" aria-hidden="true"></span>
                    </a>
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

                    <!-- 加载与失败都由共享组件呈现：占满内容区、居中，不推动布局 -->
                    <SettingsLoadState
                        v-if="props.loading"
                        variant="loading"
                    />
                    <SettingsLoadState
                        v-else-if="props.loadError"
                        variant="error"
                        :message="props.loadError"
                        @retry="emit('reload')"
                    />

                    <!-- 布局由区段自己声明：scroll 型由外壳给内边距并拥有滚动，fill 型区段自己占满并管理内部滚动 -->
                    <!-- 布局类挂在过渡内的 keyed 子元素上，而不是外层：out-in 期间离场内容还在渲染，
                         若类跟着「已选中区段」走，离场那一帧会被套上新区段的布局（fill↔scroll 互串，表现为闪一下贴边） -->
                    <div
                        v-if="!props.loading && !props.loadError"
                        class="min-h-0 flex-1"
                    >
                        <!-- 区段切换：短位移 + 淡入，时长与缓动走动效 token -->
                        <Transition name="nb-ui-switch" mode="out-in">
                            <!-- 高度必须给足：父节点是块级，flex-1 在 fill 型下不生效，缺 h-full 会让内容槽的百分比高度退化成 auto -->
                            <div
                                :key="activeSection?.value ?? ''"
                                class="flex h-full min-h-0 flex-col"
                                :class="activeSection?.layout === 'fill' ? 'overflow-hidden' : 'overflow-y-auto p-[var(--space-6)]'"
                            >
                                <slot :section="activeSection"></slot>
                            </div>
                        </Transition>
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
