<script setup lang="ts">
/** BackgroundSettingsBlock 的 Lab 场景：写设置由 Lab 扮演宿主，写回场景输入；上传没有文件服务，直接报失败看状态行。 */
import type {EditorBackgroundSetting} from "nbook/plugins/workbench/shared/contracts";
import BackgroundSettingsBlock from "nbook/plugins/workbench/web/components/BackgroundSettingsBlock.vue";

import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof BackgroundSettingsBlock>(() => props.input, []);

async function write(value: EditorBackgroundSetting): Promise<boolean> {
    subject.write("props", "value", value);
    return true;
}
const upload = async () => ({ok: false as const, reason: "Lab 里没有文件服务"});
</script>

<template>
    <div class="h-full w-full overflow-auto p-4">
        <BackgroundSettingsBlock data-lab-subject v-bind="subject.bindings.value" :write="write" :upload="upload" />
    </div>
</template>
