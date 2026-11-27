<script setup lang="ts">
/**
 * “通知”视图的 Lab 场景：真实的通知服务与中心，在底部面板大小的框里摆。发出时刻用固定的时钟（今天上午、昨天），场景每次
 * 一样；前三条在视图“可见”时发出所以算看过，后两条没看过。场景 id 带 `empty` 的不发通知，带 `narrow` 的按默认布局的宽度摆。
 */
import {useText} from "@notnotype/nb-ui/text-port";
import {onBeforeUnmount, ref} from "vue";

import {createNotifications} from "nbook/plugins/workbench/web/notifications";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import WorkbenchNotificationsView from "nbook/plugins/workbench/web/components/WorkbenchNotificationsView.vue";

import {type LabFixtureProps} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();

const today = new Date();
const at = (daysAgo: number, hour: number, minute: number): number => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).getTime();
const times = [at(1, 22, 10), at(0, 9, 12), at(0, 9, 40), at(0, 10, 20), at(0, 10, 31)];
let index = 0;
const notifications = createNotifications(() => undefined, useText(), () => times[Math.min(index++, times.length - 1)]!);
onBeforeUnmount(() => notifications.dispose());

if (!props.scene.includes("empty")) {
    notifications.center.setVisible(true);
    notifications.notify({tone: "info", title: "布局没有保存", message: "这次的改动只在本窗口里，刷新后回到上次保存的布局。"});
    notifications.notify({tone: "success", title: "已导出《雾港》", message: "保存在 导出/雾港.epub。", action: {label: "打开", run: () => undefined}});
    notifications.notify({tone: "warning", title: "书架没有更新", message: "取不到作品列表：连接已断开。显示的是上次的数据。", action: {label: "重试", run: () => undefined}});
    notifications.center.setVisible(false);
    notifications.notify({tone: "success", title: "初始化 Skill epub-check", message: "完成，用时 1 分 12 秒"});
    notifications.notify({tone: "error", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", action: {label: "重试", run: () => undefined}, detail: "bun install v1.4.4\nerror: GET https://registry.npmjs.org/pdf-lib - ETIMEDOUT"});
}

const context: ViewContext = {id: "nbook.workbench.notifications", generation: 1, visible: ref(false), location: ref("panel")};
</script>

<template>
    <div class="notifications-fixture" :style="{width: scene.includes('narrow') ? 'min(648px, 100%)' : 'min(1040px, 100%)'}">
        <WorkbenchNotificationsView :context="context" :center="notifications.center" />
    </div>
</template>

<style scoped>
/* 底部面板在 1440×900 的默认布局里约 196px 高（扣掉 32px 的面板头）。 */
.notifications-fixture {
    height: 164px;
    border-radius: var(--radius-panel);
    background: var(--panel-surface);
}
</style>
