<script setup lang="ts">
/**
 * NotificationStack 的夹具：自建一份队列传给视口，场景调位置与初始通知（按场景 id：`detail` 带详情，`six`、`top-right-six` 六条看折叠）。视口是固定定位的，这里给它一个 `contain: layout`
 * 的框当“视口”，通知落在框里而不是整页的角落。控制区能发四种色调与一条带进度的通知，看堆叠、消失与进度。
 */
import {computed, onBeforeUnmount} from "vue";

import {Button, NotificationStack} from "@notnotype/nb-ui/components";
import type {NotificationPosition} from "@notnotype/nb-ui/components";
import {createNotificationQueue} from "@notnotype/nb-ui/composables";

import LabFixtureControls from "../../LabFixtureControls.vue";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
const position = computed(() => (props.input?.props?.position as NotificationPosition | undefined) ?? "bottom-right");

const queue = createNotificationQueue();
const DETAIL = [
    "EditorSaveError: EACCES: permission denied, open '/books/长夜行/第三章.md'",
    "    code: workspace.file-write-denied",
    "    at saveFile (editor/shared/files.ts:88:13)",
    "    trace: 4f2a9c1e",
].join("\n");
// 带详情的通知缺省常驻是工作台服务的规则；这里直接用队列，所以自己给 duration: 0。
const saveFailed = (): void => {
    queue.error("没有写入权限，第三章仍是上次保存的内容。", {title: "文件没有保存", action: {label: "重试", run: () => {}}, detail: DETAIL, duration: 0});
};
// 场景一打开就有东西看，都常驻，不然截图时已经消失了。
queue.notify({tone: "info", title: "已切换到项目「长夜行」", message: "上次的标签与展开的目录已恢复。", duration: 0});
if (props.scene === "six" || props.scene === "top-right-six") {
    queue.notify({tone: "success", title: "已保存", message: "第十六章 雾港", duration: 0});
    queue.notify({tone: "warning", title: "没能移动 3 个文件", message: "目标目录里已有同名文件。", detail: "MoveConflict: 第一章.md, 第二章.md, 设定/人物.md", duration: 0});
    queue.notify({tone: "info", title: "正在统计字数", message: "已统计 2 部，共 6 部", progress: 33, duration: 0});
    queue.notify({tone: "warning", title: "书架没有更新", message: "连接已断开，显示的是上次的数据。", action: {label: "重试", run: () => {}}, duration: 0});
    saveFailed();
} else if (props.scene === "detail") {
    saveFailed();
} else {
    queue.notify({tone: "warning", title: "书架没有更新", message: "取不到作品列表：连接已断开。显示的是上次的数据。", action: {label: "重试", run: () => {}}, duration: 0});
    queue.notify({tone: "info", title: "正在统计字数", message: "已统计 2 部，共 6 部", progress: 33, duration: 0});
}

onBeforeUnmount(() => queue.clearAll());

let progressId: string | null = null;
function startProgress(): void {
    progressId = queue.notify({tone: "info", title: "正在导出", message: "第 1 章", progress: 0, duration: 0});
    const id = progressId;
    let value = 0;
    const timer = setInterval(() => {
        value += 20;
        if (value >= 100) {
            clearInterval(timer);
            queue.update(id, {tone: "success", title: "导出完成", message: "全部 5 章", progress: 100, duration: 3200});
            return;
        }
        queue.update(id, {message: `第 ${String(value / 20 + 1)} 章`, progress: value});
    }, 500);
}
</script>

<template>
    <div class="flex w-full flex-col gap-3">
        <div class="relative h-[640px] w-full overflow-hidden rounded-[var(--radius-panel)] border border-[var(--divider)] bg-[var(--bg-main)] [contain:layout]" data-lab-subject>
            <p class="p-4 text-sm text-[var(--text-muted)]">这块框代替窗口：通知按 position 固定在框的边缘。</p>
            <NotificationStack :queue="queue" :position="position" />
        </div>
        <LabFixtureControls>
            <Button size="sm" variant="secondary" @click="queue.success('已保存', {title: '第十七章 雪线'})">成功</Button>
            <Button size="sm" variant="secondary" @click="queue.error('磁盘已满（ENOSPC）。', {title: '保存失败', action: {label: '重试', run: () => {}}, duration: 0})">错误（常驻）</Button>
            <Button size="sm" variant="secondary" @click="saveFailed">带详情的错误</Button>
            <Button size="sm" variant="secondary" @click="startProgress">带进度</Button>
            <Button size="sm" variant="ghost" @click="queue.clearAll()">清空</Button>
        </LabFixtureControls>
    </div>
</template>
