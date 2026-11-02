<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from "vue";
import AlertDialog from "../../../src/components/feedback/AlertDialog.vue";
import Dialog from "../../../src/components/feedback/Dialog.vue";
import Drawer from "../../../src/components/feedback/Drawer.vue";
import FloatingWindow from "../../../src/components/feedback/FloatingWindow.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * 对话框分档的验收夹具（w00032 t09，e2e/dialog-surfaces.spec.ts）：面的透明度与二级对话框的圆角要在真实样式引擎里读，
 * 单元测试只能看到类名。打开时就是开着的，不经点击：要量的是静止的面，不是打开的手势。
 *
 * - `single`、`nested`、`alert`：nbook 的真实取值（一个对话框；对话框里再开一个；对话框里开确认框）。
 * - `*-probe`：nbook 里二级与一级的面同为 90%、确认框的圆角又等于窗口圆角，嵌套生没生效从外观上分不出来。这几个场景在
 *   根元素上用行内样式把二级那档与相关圆角改成可区分的值，验的是“二级读的是二级那档”这条机制，不是 nbook 的取值。
 *   `window-probe` 的外层是浮动窗口（`FloatingWindow`），里面再开一个浮动窗口：它的圆角应当仍是窗口那档。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const PROBE_OVERRIDES: Record<string, Record<string, string>> = {
    "nested-probe": {"--dialog-surface-nested": "color-mix(in srgb, var(--bg-panel) 50%, transparent)"},
    "alert-probe": {"--dialog-surface-nested": "color-mix(in srgb, var(--bg-panel) 50%, transparent)", "--radius-dialog-compact": "20px"},
    "window-probe": {"--dialog-surface-nested": "color-mix(in srgb, var(--bg-panel) 50%, transparent)", "--radius-dialog": "8px"},
};
// 写在 onMounted 里：playground 会做服务端渲染，那时没有 document。
const overrides = PROBE_OVERRIDES[props.sceneId] ?? {};
onMounted(() => {
    for (const [name, value] of Object.entries(overrides)) document.documentElement.style.setProperty(name, value);
});
onBeforeUnmount(() => {
    for (const name of Object.keys(overrides)) document.documentElement.style.removeProperty(name);
});

const controls = ref<Record<string, string | boolean>>({});
const floating = props.sceneId === "window-probe" || props.sceneId === "alert-in-window";
/** 外层与内层用同一种：浮动窗口场景两层都是窗口，其余都是模态对话框。 */
const Frame = floating ? FloatingWindow : Dialog;
const outer = ref(true);
const inner = ref(props.sceneId === "nested" || props.sceneId === "nested-probe" || props.sceneId === "window-probe");
const alert = ref(props.sceneId === "alert" || props.sceneId === "alert-probe" || props.sceneId === "alert-in-window");
const drawer = ref(props.sceneId === "drawer-in-dialog");
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" class="dialog-surfaces-stage">
            <component :is="Frame" v-model:open="outer" title="外层对话框" size="md" :show-footer="false" data-fixture-outer>
                <p>外层的正文。</p>
                <component :is="Frame" v-model:open="inner" title="二级对话框" :show-footer="false" data-fixture-inner>
                    <p>叠在外层上的对话框。</p>
                </component>
                <AlertDialog v-model:open="alert" title="删除服务商？" description="确认框叠在外层上。" />
                <Drawer v-model:open="drawer" title="设定详情" data-fixture-drawer><p>从对话框里打开的抽屉。</p></Drawer>
            </component>
        </div>
    </FixtureShell>
</template>

<style scoped>
.dialog-surfaces-stage {
    min-height: 420px;
}
</style>
