/**
 * 输入的本地草稿（docs/specs/theme/editor.md 输出 7 的“防抖”）：输入先留在本地，停手 250ms 后交给 `commit`，不会每个按键写一次记录。
 *
 * - 外面的值变了（别处改、换了主题、导入后自动选中）：本地待交出的作废，草稿跟着外面的值走，免得把旧输入写进新的对象；
 * - 焦点离开或卸载时立刻交出还在等的值：输入完马上点别的按钮，那个按钮读到的必须是刚输入的值。
 */

import {onBeforeUnmount, ref, watch} from "vue";
import type {Ref} from "vue";

export const DRAFT_DELAY_MS = 250;

export function useDebouncedDraft(source: () => string, commit: (value: string) => void): {readonly draft: Ref<string>; input(value: string): void; flush(): void} {
    const draft = ref(source());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    watch(source, (value) => {
        cancel();
        draft.value = value;
    });
    const input = (value: string): void => {
        draft.value = value;
        cancel();
        timer = setTimeout(() => {
            timer = null;
            if (value !== source()) commit(value);
        }, DRAFT_DELAY_MS);
    };
    const flush = (): void => {
        if (timer === null) return;
        cancel();
        if (draft.value !== source()) commit(draft.value);
    };
    onBeforeUnmount(flush);
    return {draft, input, flush};
}
