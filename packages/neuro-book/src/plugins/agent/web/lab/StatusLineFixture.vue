<script setup lang="ts">
/**
 * “状态栏”设置页的夹具：设置放在这里，勾选与移动照真实的算法改，预览跟着变；插件的项是场景给的样本（只有声明）。拖动的写入
 * 像真实的配置服务一样是异步的（几十毫秒后才采纳），`write-fails` 场景不采纳（写入失败）。
 */
import {ref} from "vue";
import {moveStatusItem, shiftStatusItem, statusLineCatalog, toggleStatusItem} from "@notnotype/nb-agent-ui";
import type {StatusLineItem, StatusLineSetting, StatusLineSlot} from "@notnotype/nb-agent-ui";

import StatusLinePage from "nbook/plugins/agent/web/components/StatusLinePage.vue";

import {type LabSceneInput} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<{scene: string; input?: LabSceneInput}>();
const page = (props.input?.props ?? {}) as {setting?: StatusLineSetting; pluginItems?: StatusLineItem[]; writable?: boolean};
const setting = ref<StatusLineSetting>(page.setting ?? {});
const catalog = statusLineCatalog(page.pluginItems ?? []);

function onMove(id: string, to: StatusLineSlot): Promise<void> {
    return new Promise((resolve) => setTimeout(() => {
        if (props.scene !== "write-fails") setting.value = moveStatusItem(catalog, setting.value, id, to);
        resolve();
    }, 40));
}
</script>

<template>
    <div class="status-line-fixture">
        <StatusLinePage
            :setting="setting"
            :plugin-items="page.pluginItems ?? []"
            :writable="page.writable ?? true"
            @toggle="setting = toggleStatusItem(catalog, setting, $event)"
            @move="onMove"
            @shift="(id: string, delta: -1 | 1) => (setting = shiftStatusItem(catalog, setting, id, delta))"
        />
    </div>
</template>

<style scoped>
.status-line-fixture {
    max-width: 720px;
    padding: 16px;
}
</style>
