/**
 * 资源管理器的公开状态（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：只有命令 `when` 要读的
 * 布尔键，不公开选择本身。`when` 只说明有没有可作用的选择，执行时再按选择核对。
 */

import {computed} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";

import type {Availability, ExplorerController} from "./controller";

const reason = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});

export const explorerState = definePublicState("nbook.explorer", {
    ready: {type: "boolean", unready: false, reason: reason("资源管理器尚未打开", "The explorer is not open yet")},
    canCreate: {type: "boolean", unready: false, reason: reason("没有可以新建的位置", "No place to create in")},
    hasSelection: {type: "boolean", unready: false, reason: reason("没有选中资源", "Nothing is selected")},
    canPaste: {type: "boolean", unready: false, reason: reason("剪贴板为空、没有可以粘贴的位置，或上一次批量的结果未知", "The clipboard is empty, there is no place to paste, or the last batch outcome is unknown")},
    canReorder: {type: "boolean", unready: false, reason: reason("选中的项不能在清单里调整顺序", "The selection cannot be reordered")},
    canCreateContent: {type: "boolean", unready: false, reason: reason("选中的不是没有正文的内容节点", "The selection is not a content node without content")},
    canConvert: {type: "boolean", unready: false, reason: reason("选中的不是可以转换的文件夹", "The selection is not a folder that can be converted")},
    canEditManifest: {type: "boolean", unready: false, reason: reason("选中的项不在内容文件夹里", "The selection is not in a content folder")},
});

/** 各公开键此刻的值：由控制器的选择与可用性算出；没有控制器时都为假。产品入口与 Lab 场景共用。 */
export function explorerStateValues(controller: Readonly<ShallowRef<ExplorerController | null>>): Record<keyof typeof explorerState.declarations, ComputedRef<boolean>> {
    const available = (pick: (available: Availability) => boolean) => computed(() => controller.value !== null && pick(controller.value.available.value));
    return {
        ready: computed(() => controller.value !== null),
        canCreate: available((can) => can.create),
        hasSelection: computed(() => (controller.value?.selection.value.selected.length ?? 0) > 0),
        canPaste: available((can) => can.paste),
        canReorder: available((can) => can.moveUp || can.moveDown),
        canCreateContent: available((can) => can.createContent),
        canConvert: available((can) => can.convert),
        canEditManifest: available((can) => can.display || can.include || can.drop),
    };
}
