<script setup lang="ts">
import {ref} from "vue";
import AlertDialog from "../../../src/components/feedback/AlertDialog.vue";
import Dialog from "../../../src/components/feedback/Dialog.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * 对话框分档的验收夹具（w00032 t09，e2e/dialog-surfaces.spec.ts）：面的透明度与二级对话框的圆角要在真实样式引擎里读，
 * 单元测试只能看到类名。场景 `single` 只开一个对话框；`nested` 在对话框里再开一个对话框；`alert` 在对话框里开确认框。
 * 打开时就是开着的，不经点击：要量的是静止的面，不是打开的手势。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});
const outer = ref(true);
const inner = ref(props.sceneId === "nested");
const alert = ref(props.sceneId === "alert");
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" class="dialog-surfaces-stage">
            <Dialog v-model="outer" title="外层对话框" size="md" :show-footer="false" data-fixture-outer>
                <p>外层的正文。</p>
                <Dialog v-model="inner" title="二级对话框" :show-footer="false" data-fixture-inner>
                    <p>叠在外层上的对话框。</p>
                </Dialog>
                <AlertDialog v-model:open="alert" title="删除服务商？" description="确认框叠在外层上。" />
            </Dialog>
        </div>
    </FixtureShell>
</template>

<style scoped>
.dialog-surfaces-stage {
    min-height: 420px;
}
</style>
