/**
 * 表情包页的包装（docs/specs/agent/stickers.md 输出 25 到 38）：页面组件只画与发出动作，这里建取数与写入的模型（`createPacksModel`），
 * 订阅目录变化，把动作接到模型上。组件卸载时停订阅。设置窗口传来的 `context` 不用：页面写的是 `user://stickers/` 里的文件，不看设置层的
 * `writable`。
 */

import {defineComponent, h, onBeforeUnmount} from "vue";
import type {Component, PropType} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import type {StickerDisplayService} from "../shared/contracts";
import {createPacksModel} from "./packs-page";
import type {PacksModelDeps} from "./packs-page";
import {previewZip} from "./zip-preview";

/** `display` 是按贴纸显示的偏好（输出 47）；没有时属性栏不画那个开关。 */
export function stickersPage(component: Component, deps: PacksModelDeps, display: StickerDisplayService | null = null): Component {
    return defineComponent({
        name: "StickerPacksHost",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: false}},
        setup: () => {
            const model = createPacksModel(deps);
            const stop = model.start();
            onBeforeUnmount(stop);
            return () => h(component, {
                state: model.state.value,
                packs: model.packs.value,
                selected: model.selected.value,
                detail: model.detail.value,
                uploads: model.uploads.value,
                createPack: model.createPack,
                renamePack: model.renamePack,
                copyPack: model.copyPack,
                importZip: model.importZip,
                updatePack: model.updatePack,
                updateSticker: model.updateSticker,
                deletePack: model.deletePack,
                deleteSticker: model.deleteSticker,
                deleteFile: model.deleteFile,
                listFiles: model.listFiles,
                allowlistUsage: model.allowlistUsage,
                previewZip,
                display,
                onSelect: (id: string) => model.select(id),
                onAddImages: (id: string, files: File[], folders: string[]) => void model.addImages(id, files, folders),
                onExport: (id: string) => void model.exportPack(id),
                onReveal: (id: string) => void model.revealPack(id),
                onRetry: () => model.retry(),
            });
        },
    });
}
