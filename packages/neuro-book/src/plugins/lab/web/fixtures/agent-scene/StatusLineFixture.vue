<script setup lang="ts">
/** “状态栏”设置页的夹具：设置放在这里，勾选与移动照真实的算法改，预览跟着变；插件的项是场景给的样本（只有声明）。 */
import {ref} from "vue";
import {moveStatusItem, statusLineCatalog, toggleStatusItem} from "@notnotype/nb-agent-ui";
import type {StatusLineItem, StatusLineSetting} from "@notnotype/nb-agent-ui";

import StatusLinePage from "nbook/plugins/agent/web/components/StatusLinePage.vue";

import type {LabSceneInput} from "../../lab-subject";

const props = defineProps<{scene: string; input?: LabSceneInput}>();
const page = (props.input?.props ?? {}) as {setting?: StatusLineSetting; pluginItems?: StatusLineItem[]; writable?: boolean};
const setting = ref<StatusLineSetting>(page.setting ?? {});
const catalog = statusLineCatalog(page.pluginItems ?? []);
</script>

<template>
    <div class="status-line-fixture">
        <StatusLinePage
            :setting="setting"
            :plugin-items="page.pluginItems ?? []"
            :writable="page.writable ?? true"
            @toggle="setting = toggleStatusItem(catalog, setting, $event)"
            @move="(id: string, to: number) => (setting = moveStatusItem(catalog, setting, id, to))"
        />
    </div>
</template>

<style scoped>
.status-line-fixture {
    max-width: 720px;
    padding: 16px;
}
</style>
