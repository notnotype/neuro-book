/**
 * 上传的进行状态（忙、成功提示、失败原因）：属于发起上传时的那个目标（主题加明暗），只在界面当前正是那个目标时显示。
 * 上传要几百毫秒到几秒，期间用户可能切了主题或明暗；状态若挂在组件上，别的目标会看到不属于它的转圈、体积和失败原因。
 * 同一时刻只跟踪一次上传：进行中时 `busy` 为真，不管显示的是哪个目标，调用方据此不让再发起一次。
 */

import {computed, shallowRef} from "vue";

import type {Appearance} from "./editor-state";
import type {ThemeEditorModel} from "./theme-editor-model";

export interface UploadTarget {
    readonly id: string;
    readonly appearance: Appearance;
}

export function useUploadStatus(model: ThemeEditorModel) {
    const owner = shallowRef<UploadTarget | null>(null);
    const running = shallowRef(false);
    const failureText = shallowRef<string | null>(null);
    const noteText = shallowRef<string | null>(null);
    /** 界面当前是不是发起上传的那个目标。 */
    const here = computed(() => owner.value !== null && owner.value.id === model.selectedId.value && owner.value.appearance === model.appearance.value);

    return {
        /** 有上传在进行（不分目标）：按钮据此停用。 */
        busy: running,
        /** 只在目标是当前时有值的显示用状态。 */
        shownBusy: computed(() => running.value && here.value),
        failure: computed(() => (here.value ? failureText.value : null)),
        note: computed(() => (here.value ? noteText.value : null)),
        /** 当前目标：发起上传时存进去，目标就此定下。没有选中的主题时为 null。 */
        current: (): UploadTarget | null => {
            const id = model.selectedId.value;
            return id === null ? null : {id, appearance: model.appearance.value};
        },
        begin(target: UploadTarget): void {
            owner.value = target;
            running.value = true;
            failureText.value = null;
            noteText.value = null;
        },
        fail(reason: string): void {
            failureText.value = reason;
        },
        succeed(message: string): void {
            noteText.value = message;
        },
        /** 清掉成功提示与失败原因（例如移除了素材：旧的“123 KB”不再说明任何东西）。 */
        clear(): void {
            failureText.value = null;
            noteText.value = null;
        },
        end(): void {
            running.value = false;
        },
    };
}
