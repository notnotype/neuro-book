/**
 * 属性栏里一个文字字段的草稿与提交（docs/specs/agent/stickers.md 输出 27）：回车或离开输入框时保存，值没变不保存，Esc 还原。
 * 草稿一直留到保存交回（页面写完并重取了目录）：不会闪回旧值；保存失败回到目录里的值并交出原因。目录里的值变了（别处改的）而字段
 * 没有焦点时，草稿跟着变，有焦点时不覆盖正在输入的字。
 */

import {ref} from "vue";
import type {Ref} from "vue";
import {watch} from "vue";

export interface CommittedText {
    readonly draft: Ref<string>;
    /** 上一次保存失败的原因；保存成功或重新输入后清空。 */
    readonly error: Ref<string>;
    readonly pending: Ref<boolean>;
    onFocus(): void;
    onBlur(): void;
    /** 回车：保存，留在输入框里。 */
    onEnter(): void;
    onEscape(): void;
}

/** `commit` 交回失败原因，成功交回 null。 */
export function useCommittedText(source: () => string, commit: (value: string) => Promise<string | null>): CommittedText {
    const draft = ref(source());
    const error = ref("");
    const pending = ref(false);
    let focused = false;
    let inFlight: string | null = null;
    /** 草稿被程序改回目录里的值时，不算用户重新输入，不清掉刚写下的失败原因。 */
    let revertedByCode = false;

    watch(source, (value) => {
        if (!focused || value === draft.value) draft.value = value;
    });
    watch(draft, () => {
        if (revertedByCode) {
            revertedByCode = false;
            return;
        }
        error.value = "";
    });

    async function submit(): Promise<void> {
        const value = draft.value;
        if (value === source() || value === inFlight) return;
        inFlight = value;
        pending.value = true;
        const reason = await commit(value);
        pending.value = false;
        inFlight = null;
        if (reason === null) return;
        revertedByCode = draft.value !== source();
        draft.value = source();
        error.value = reason;
    }

    return {
        draft,
        error,
        pending,
        onFocus: () => {
            focused = true;
        },
        onBlur: () => {
            focused = false;
            void submit();
        },
        onEnter: () => void submit(),
        onEscape: () => {
            draft.value = source();
        },
    };
}
