<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";
import type {NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import NovelIdeAccountMenu from "nbook/app/components/novel-ide/NovelIdeAccountMenu.vue";
import Tooltip from "nbook/app/components/common/Tooltip.vue";
import {
    createWorkbenchActivityItems,
    resolveActivityBarSecondaryItems,
    type WorkbenchActivityItem,
    type WorkbenchActivityItemId,
} from "nbook/app/utils/workbench-chrome";

const props = defineProps<{
    activeTab: NovelIdeTab | null;
    desktopAvailable: boolean;
    surfaceActive: boolean;
    userAssetsMode: boolean;
    agentPanelOpen: boolean;
    currentUser: AuthUserDto | null;
}>();

const emit = defineEmits<{
    (event: "open-home"): void;
    (event: "open-tab", value: NovelIdeTab): void;
    (event: "open-world-engine"): void;
    (event: "open-trace-viewer"): void;
    (event: "open-history-inbox"): void;
    (event: "toggle-agent-panel"): void;
    (event: "open-settings"): void;
    (event: "open-profile"): void;
    (event: "open-admin"): void;
    (event: "logout"): void;
}>();

const {t} = useI18n();
const activityItems = computed(() => createWorkbenchActivityItems({
    desktopAvailable: props.desktopAvailable,
    surfaceActive: props.surfaceActive,
    userAssetsMode: props.userAssetsMode,
}));
const activityBarRef = ref<HTMLElement | null>(null);
const primaryGroupRef = ref<HTMLElement | null>(null);
const footerRef = ref<HTMLElement | null>(null);
const agentPanelRef = ref<HTMLElement | null>(null);
const moreRootRef = ref<HTMLElement | null>(null);
const moreButtonRef = ref<HTMLButtonElement | null>(null);
const moreItemRefs = ref<HTMLButtonElement[]>([]);
const visibleSecondaryCount = ref(activityItems.value.secondary.length);
const moreOpen = ref(false);
let resizeObserver: ResizeObserver | null = null;

const secondaryItems = computed(() => {
    const resolved = resolveActivityBarSecondaryItems(activityItems.value.secondary, {
        availableHeight: activityBarRef.value?.clientHeight ?? Number.POSITIVE_INFINITY,
        fixedHeight: resolveFixedActivityHeight(),
        itemHeight: 44,
        moreButtonHeight: 44,
    });
    return {
        visible: resolved.visible.slice(0, visibleSecondaryCount.value),
        overflow: resolved.overflow,
    };
});

const iconClasses: Record<WorkbenchActivityItemId, string> = {
    home: "i-lucide-library",
    files: "i-lucide-files",
    characters: "i-lucide-users-round",
    plot: "i-lucide-git-branch",
    world: "i-lucide-globe-2",
    trace: "i-lucide-activity",
    history: "i-lucide-inbox",
    "agent-panel": "i-lucide-bot",
    account: "i-lucide-user-round",
    settings: "i-lucide-settings",
};

const labels = computed<Record<WorkbenchActivityItemId, string>>(() => ({
    home: t("ide.header.bookshelfTitle"),
    files: t("ide.toolPanel.files"),
    characters: t("ide.toolPanel.characters"),
    plot: t("ide.header.plotWorkbench"),
    world: t("ide.header.worldEngine"),
    trace: t("ide.header.traceViewerTitle"),
    history: t("ide.header.historyInboxTitle"),
    "agent-panel": props.agentPanelOpen ? t("ide.header.closeAgentPanel") : t("ide.header.openAgentPanel"),
    account: t("ide.header.accountMenu"),
    settings: t("settings.title"),
}));

function active(item: WorkbenchActivityItem): boolean {
    switch (item.id) {
        case "home": return !props.surfaceActive;
        case "files":
        case "characters":
        case "plot":
            return props.activeTab === item.id;
        case "agent-panel": return props.agentPanelOpen;
        default: return false;
    }
}

function actionTitle(item: WorkbenchActivityItem): string {
    return item.disabled ? `${labels.value[item.id]} · 请先打开一个 Project` : labels.value[item.id];
}

function invoke(item: WorkbenchActivityItem): void {
    if (item.disabled) return;
    switch (item.id) {
        case "home": emit("open-home"); return;
        case "files":
        case "characters":
        case "plot": emit("open-tab", item.id); return;
        case "world": emit("open-world-engine"); return;
        case "trace": emit("open-trace-viewer"); return;
        case "history": emit("open-history-inbox"); return;
        case "agent-panel": emit("toggle-agent-panel"); return;
        case "settings": emit("open-settings"); return;
        case "account": return;
    }
}

function resolveFixedActivityHeight(): number {
    const activityBar = activityBarRef.value;
    if (!activityBar) return 0;
    const style = getComputedStyle(activityBar);
    const paddingBlock = Number.parseFloat(style.paddingTop || "0")
        + Number.parseFloat(style.paddingBottom || "0");
    return paddingBlock
        + (primaryGroupRef.value?.offsetHeight ?? 0)
        + (footerRef.value?.offsetHeight ?? 0)
        + (agentPanelRef.value ? 44 : 0);
}

function measureSecondaryItems(): void {
    const activityBar = activityBarRef.value;
    if (!activityBar) return;
    const resolved = resolveActivityBarSecondaryItems(activityItems.value.secondary, {
        availableHeight: activityBar.clientHeight,
        fixedHeight: resolveFixedActivityHeight(),
        itemHeight: 44,
        moreButtonHeight: 44,
    });
    visibleSecondaryCount.value = resolved.visible.length;
    if (resolved.overflow.length === 0) {
        closeMore(false);
    }
}

function closeMore(restoreFocus: boolean): void {
    moreOpen.value = false;
    if (restoreFocus) {
        nextTick(() => moreButtonRef.value?.focus());
    }
}

function focusMoreItem(startIndex: number, direction: 1 | -1): void {
    const items = secondaryItems.value.overflow;
    if (items.length === 0) return;
    let index = startIndex;
    for (let attempts = 0; attempts < items.length; attempts += 1) {
        index = (index + direction + items.length) % items.length;
        if (!items[index]?.disabled) {
            moreItemRefs.value[index]?.focus();
            return;
        }
    }
}

function openMore(focusLast = false): void {
    if (secondaryItems.value.overflow.length === 0) return;
    moreOpen.value = true;
    nextTick(() => {
        const startIndex = focusLast ? 0 : -1;
        focusMoreItem(startIndex, focusLast ? -1 : 1);
    });
}

function toggleMore(): void {
    if (moreOpen.value) {
        closeMore(false);
        return;
    }
    openMore();
}

function handleMoreButtonKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
        event.preventDefault();
        openMore();
        return;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        openMore(true);
    }
}

function handleMoreMenuKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusMoreItem(index, event.key === "ArrowDown" ? 1 : -1);
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        closeMore(true);
    }
}

function invokeOverflow(item: WorkbenchActivityItem): void {
    if (item.disabled) return;
    invoke(item);
    closeMore(true);
}

onMounted(() => {
    resizeObserver = new ResizeObserver(() => measureSecondaryItems());
    for (const target of [activityBarRef.value, primaryGroupRef.value, footerRef.value, agentPanelRef.value]) {
        if (target) resizeObserver.observe(target);
    }
    measureSecondaryItems();
});

watch(
    () => [
        props.desktopAvailable,
        props.surfaceActive,
        props.userAssetsMode,
        activityItems.value.secondary.map((item) => `${item.id}:${String(item.disabled)}`).join("|"),
    ],
    () => nextTick(() => {
        resizeObserver?.disconnect();
        for (const target of [activityBarRef.value, primaryGroupRef.value, footerRef.value, agentPanelRef.value]) {
            if (target) resizeObserver?.observe(target);
        }
        measureSecondaryItems();
    }),
);

onClickOutside(moreRootRef, () => closeMore(false));

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>

<template>
    <aside ref="activityBarRef" class="workbench-activity-bar flex w-12 shrink-0 flex-col items-center border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] py-2" aria-label="Workbench navigation">
        <div class="flex min-h-0 w-full flex-1 flex-col items-center">
            <div ref="primaryGroupRef" class="flex w-full shrink-0 flex-col items-center">
                <Tooltip
                    v-for="item in activityItems.primary"
                    :key="item.id"
                    :text="actionTitle(item)"
                    placement="right"
                >
                    <button
                        type="button"
                        class="workbench-activity-bar__item relative mb-1 flex h-10 w-10 items-center justify-center rounded-md border border-transparent transition-colors"
                        :class="active(item) ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        :disabled="item.disabled"
                        :aria-pressed="active(item)"
                        :data-activity-id="item.id"
                        @click="invoke(item)"
                    >
                        <span v-if="active(item)" class="absolute inset-y-1 left-0 w-0.5 rounded-r bg-[var(--accent-main)]"></span>
                        <span :class="iconClasses[item.id]" class="h-[18px] w-[18px]"></span>
                    </button>
                </Tooltip>

                <div class="my-1 h-px w-7 bg-[var(--border-color)]"></div>
            </div>

            <Tooltip
                v-for="item in secondaryItems.visible"
                :key="item.id"
                :text="actionTitle(item)"
                placement="right"
            >
                <button
                    type="button"
                    class="workbench-activity-bar__item relative mb-1 flex h-10 w-10 items-center justify-center rounded-md border border-transparent text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :class="active(item) ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : ''"
                    :disabled="item.disabled"
                    :aria-pressed="active(item)"
                    :data-activity-id="item.id"
                    @click="invoke(item)"
                >
                    <span :class="iconClasses[item.id]" class="h-[18px] w-[18px]"></span>
                </button>
            </Tooltip>

            <div v-if="secondaryItems.overflow.length > 0" ref="moreRootRef" class="relative mb-1 h-10 w-10 shrink-0">
                <Tooltip :text="moreOpen ? '' : t('ide.activityBar.more')" placement="right">
                    <button
                        ref="moreButtonRef"
                        type="button"
                        class="workbench-activity-bar__item flex h-10 w-10 items-center justify-center rounded-md border border-transparent text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                        aria-haspopup="menu"
                        :aria-expanded="moreOpen"
                        aria-controls="workbench-activity-more-menu"
                        @click="toggleMore"
                        @keydown="handleMoreButtonKeydown"
                    >
                        <span class="i-lucide-ellipsis h-[18px] w-[18px]"></span>
                    </button>
                </Tooltip>
                <div
                    v-if="moreOpen"
                    id="workbench-activity-more-menu"
                    class="absolute left-full top-0 z-[70] ml-2 w-52 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 shadow-xl"
                    role="menu"
                    :aria-label="t('ide.activityBar.moreActions')"
                >
                    <button
                        v-for="(item, index) in secondaryItems.overflow"
                        :key="item.id"
                        ref="moreItemRefs"
                        type="button"
                        role="menuitem"
                        class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                        :disabled="item.disabled"
                        :title="actionTitle(item)"
                        :data-activity-id="item.id"
                        @click="invokeOverflow(item)"
                        @keydown="handleMoreMenuKeydown($event, index)"
                    >
                        <span :class="iconClasses[item.id]" class="h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                        <span class="min-w-0 flex-1 truncate">{{ labels[item.id] }}</span>
                    </button>
                </div>
            </div>

            <Tooltip
                v-if="activityItems.agentPanel"
                :text="actionTitle(activityItems.agentPanel)"
                placement="right"
            >
                <button
                    ref="agentPanelRef"
                    type="button"
                    class="workbench-activity-bar__item relative mb-1 flex h-10 w-10 items-center justify-center rounded-md border border-transparent transition-colors"
                    :class="props.agentPanelOpen ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    :disabled="activityItems.agentPanel.disabled"
                    :aria-pressed="props.agentPanelOpen"
                    data-activity-id="agent-panel"
                    @click="invoke(activityItems.agentPanel)"
                >
                    <span :class="iconClasses['agent-panel']" class="h-[18px] w-[18px]"></span>
                </button>
            </Tooltip>
        </div>

        <div ref="footerRef" class="mt-auto flex w-full shrink-0 flex-col items-center gap-1">
            <div data-activity-id="account">
                <NovelIdeAccountMenu
                    :current-user="props.currentUser"
                    root-class="relative w-8 shrink-0"
                    menu-class="left-full bottom-0 ml-2 w-40"
                    @open-profile="emit('open-profile')"
                    @open-admin="emit('open-admin')"
                    @logout="emit('logout')"
                />
            </div>
            <Tooltip :text="labels.settings" placement="right">
                <button
                    type="button"
                    class="workbench-activity-bar__item flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    data-activity-id="settings"
                    @click="emit('open-settings')"
                >
                    <span :class="iconClasses.settings" class="h-[18px] w-[18px]"></span>
                </button>
            </Tooltip>
        </div>
    </aside>
</template>

<style scoped>
.workbench-activity-bar__item:disabled {
    cursor: not-allowed;
    opacity: 0.34;
}
</style>
