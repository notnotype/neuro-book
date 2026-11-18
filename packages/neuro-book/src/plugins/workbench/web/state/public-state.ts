/**
 * 工作台的公开状态（docs/specs/ui/workbench-layout.md 输出 36）：命令的 `when` 读其中的布尔键，字符串键只供读取。布局 store 还没创建或记录没读完时，依赖它们的布尔键为 false。
 */

import {regionOf} from "@notnotype/nb-workbench-layout";
import {computed} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";
import type {PublicBindings} from "nbook/shared/store/public";

import {workbenchText} from "../../shared/text";
import type {LayoutDocStore} from "./layout-doc-store";

export const workbenchState = definePublicState("nbook.workbench", {
    layoutReady: {type: "boolean", unready: false, reason: workbenchText("state.layoutReady.reason")},
    /** 还没有手机呈现：就绪后恒为真。 */
    nonPhone: {type: "boolean", unready: false, reason: workbenchText("state.nonPhone.reason")},
    hasCurrentPanel: {type: "boolean", unready: false, reason: workbenchText("state.hasCurrentPanel.reason")},
    maximized: {type: "boolean", unready: false, reason: workbenchText("state.maximized.reason")},
    panelVisible: {type: "boolean", unready: false, reason: workbenchText("state.panelVisible.reason")},
    sidebarVisible: {type: "boolean", unready: false, reason: workbenchText("state.sidebarVisible.reason")},
    auxiliaryBarVisible: {type: "boolean", unready: false, reason: workbenchText("state.auxiliaryBarVisible.reason")},
    activityBarVisible: {type: "boolean", unready: false, reason: workbenchText("state.activityBarVisible.reason")},
    focusedPart: {type: "string", unready: "editor"},
});

export function workbenchStateBindings(layout: Readonly<ShallowRef<LayoutDocStore | null>>): PublicBindings<typeof workbenchState.declarations> {
    const ready = computed(() => layout.value?.state.ready ?? false);
    const current = computed(() => {
        const store = layout.value;
        const id = store?.state.currentPanel ?? null;
        return id === null ? null : (store?.state.doc.panels[id] ?? null);
    });
    /** 当前面板所在的区域；编辑组、浮动窗不在区域里。读原文档：`state.doc` 是深只读代理，`regionOf` 要原对象的类型。 */
    const region = computed(() => {
        const store = layout.value;
        const id = store?.state.currentPanel ?? null;
        return id === null || store === null || store === undefined ? null : regionOf(store.actions.document(), id);
    });
    const panelIsFloating = computed(() => {
        const store = layout.value;
        const id = store?.state.currentPanel ?? null;
        return id !== null && store !== null && store !== undefined && store.state.doc.floats.some((float) => float.panel === id);
    });
    return {
        layoutReady: ready,
        nonPhone: computed(() => ready.value),
        hasCurrentPanel: computed(() => ready.value && current.value !== null),
        maximized: computed(() => (layout.value?.state.maximized ?? null) !== null),
        panelVisible: computed(() => layout.value?.actions.partVisible("panel") ?? false),
        sidebarVisible: computed(() => layout.value?.actions.partVisible("sidebar") ?? false),
        auxiliaryBarVisible: computed(() => layout.value?.actions.partVisible("auxiliarybar") ?? false),
        activityBarVisible: computed(() => layout.value?.actions.partVisible("activitybar") ?? false),
        // 当前面板所在区域的名字（输出 36）；浮动的是 `float`，编辑组是 `editor`。不在区域里又不浮动的工具面板骨架里放不下，留着 `tool` 只是不把它说成编辑组。
        focusedPart: computed(() => (panelIsFloating.value ? "float" : (region.value ?? (current.value?.role === "tool" ? "tool" : "editor")))),
    };
}
