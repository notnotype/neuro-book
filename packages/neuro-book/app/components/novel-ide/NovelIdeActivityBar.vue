<script setup lang="ts">
import type {ToolPartId, ToolPartLocation} from "nbook/app/utils/workbench/view-placements";
import {computed} from "vue";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";
import NovelIdeAccountMenu from "nbook/app/components/novel-ide/NovelIdeAccountMenu.vue";
import WorkbenchActivityBar, {type ActivityItem} from "nbook/app/components/workbench/WorkbenchActivityBar.vue";
import type {WorkbenchTitleActionItems} from "nbook/app/utils/workbench/view-title-actions";
import {
    createWorkbenchActivityItems,
    type WorkbenchActivityItem,
    type WorkbenchActivityItemId,
} from "nbook/app/utils/workbench-chrome";

/**
 * 产品活动栏：**上半是主侧栏容器的单选**，下半是非容器命令（工具组 + 账户 / 设置）。
 *
 * 分工与接入前一致——这一层只做图标表、译文表与条目到事件的路由，测量与溢出在通用组件里：
 * - **容器**由页面按生效落位求值后传入（`containers` / `activeContainerId`），选择只回传 `open-container`，
 *   「重复点击当前项」的语义（保持选择并显式打开被隐藏 / 拖收起的主侧栏）归页面；
 * - **非容器命令**来自 `createWorkbenchActivityItems` 的能力表，禁用与原因按原有 Project / user-assets 门禁；
 * - `files` / `characters` 这类工具视图与 `agent-panel` 不再是活动项：它们分别归主侧栏容器里的视图
 *   与 Agent 面板自己的入口，这里不画第二个开关。
 */

/** 一个可选的容器项：标题与图标已由页面解析（组件不读 descriptor、不做 i18n）。 */
export type WorkbenchActivityContainer = Readonly<{
    containerId: string;
    title: string;
    icon: string;
    /** 生效落位与所属 Part：容器条目要能作为拖动源与落点，判定按它们复核来源。 */
    location: ToolPartLocation;
    partId: ToolPartId;
    /** 全部已登记生效成员的有序快照（整组并入按它搬）。 */
    viewIds: readonly string[];
    /** 明确 false 的容器不提供容器拖动源。 */
    canMoveContainer: boolean;
}>;

const props = defineProps<{
    /** 当前实际位于主侧栏的容器；顺序就是活动栏顺序。 */
    containers: readonly WorkbenchActivityContainer[];
    /** 主侧栏的活动容器；`null` = 主侧栏里一个容器都没有。 */
    activeContainerId: string | null;
    desktopAvailable: boolean;
    surfaceActive: boolean;
    userAssetsMode: boolean;
    currentUser: AuthUserDto | null;
    /** 容器条目是否可作为拖动源 / 落点（主侧栏的容器切换就在这条活动栏上）。 */
    allowContainerMove?: boolean;
    allowViewMove?: boolean;
    /** 会话上下文代际：容器拖动载荷冻结它。 */
    contextKey?: string;
    containerActions?: WorkbenchTitleActionItems;
}>();

const emit = defineEmits<{
    (event: "open-home"): void;
    (event: "open-container", containerId: string): void;
    (event: "open-world-engine"): void;
    (event: "open-trace-viewer"): void;
    (event: "open-history-inbox"): void;
    (event: "open-plot-workbench"): void;
    (event: "open-settings"): void;
    (event: "open-profile"): void;
    (event: "open-admin"): void;
    (event: "logout"): void;
    (event: "container-action", containerId: string, actionId: string): void;
}>();

const {t} = useI18n();

const activityItems = computed(() => createWorkbenchActivityItems({
    desktopAvailable: props.desktopAvailable,
    surfaceActive: props.surfaceActive,
    userAssetsMode: props.userAssetsMode,
}));

const iconClasses: Record<WorkbenchActivityItemId, string> = {
    home: "i-lucide-library",
    plot: "i-lucide-git-branch",
    world: "i-lucide-globe-2",
    trace: "i-lucide-activity",
    history: "i-lucide-inbox",
    account: "i-lucide-user-round",
    settings: "i-lucide-settings",
};

const labels = computed<Record<WorkbenchActivityItemId, string>>(() => ({
    home: t("ide.header.bookshelfTitle"),
    plot: t("ide.header.plotWorkbench"),
    world: t("ide.header.worldEngine"),
    trace: t("ide.header.traceViewerTitle"),
    history: t("ide.header.historyInboxTitle"),
    account: t("ide.header.accountMenu"),
    settings: t("settings.title"),
}));

/** 产品条目 → 通用条目：图标、译文与禁用原因都在这层解析，通用组件不认识它们。 */
function toActivityItem(item: WorkbenchActivityItem): ActivityItem {
    return {
        id: item.id,
        label: labels.value[item.id],
        icon: iconClasses[item.id],
        disabled: item.disabled,
        reason: item.disabled ? t("ide.activityBar.needOpenProject") : undefined,
    };
}

/**
 * 上半：容器条目——标题与图标都来自页面求值的容器切片，选中态只跟活动容器走。
 * 容器清单为空时整组不画（活动栏不留一个假的"展开入口"）。
 */
const containerItems = computed<ActivityItem[]>(() => props.containers.map((container) => ({
    id: container.containerId,
    label: container.title,
    icon: container.icon,
    active: container.containerId === props.activeContainerId,
})));

const toolItems = computed<ActivityItem[]>(() => activityItems.value.tools.map(toActivityItem));
const footerItems = computed<ActivityItem[]>(() => activityItems.value.footer.map(toActivityItem));

function invoke(id: string): void {
    if (props.containers.some((container) => container.containerId === id)) {
        emit("open-container", id);
        return;
    }
    switch (id) {
        case "home": emit("open-home"); return;
        case "plot": emit("open-plot-workbench"); return;
        case "world": emit("open-world-engine"); return;
        case "trace": emit("open-trace-viewer"); return;
        case "history": emit("open-history-inbox"); return;
        case "settings": emit("open-settings"); return;
        case "account": return;
    }
}
</script>

<template>
    <WorkbenchActivityBar
        :containers="props.containers"
        :allow-container-move="props.allowContainerMove === true"
        :allow-view-move="props.allowViewMove === true"
        :context-key="props.contextKey ?? ''"
        :primary="containerItems"
        :secondary="toolItems"
        :footer="footerItems"
        label="Workbench navigation"
        :more-label="t('ide.activityBar.more')"
        :container-actions="props.containerActions"
        @invoke="invoke"
        @container-action="(containerId: string, actionId: string) => emit('container-action', containerId, actionId)"
    >
        <template #item-account>
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
        </template>
    </WorkbenchActivityBar>
</template>
