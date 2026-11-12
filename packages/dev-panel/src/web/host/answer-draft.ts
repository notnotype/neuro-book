import {ref, watch, type Ref} from "vue";
import {emptyAnswerDraft, type AnswerDraft} from "./answers.js";
import {readAnswerDraft, writeAnswerDraft} from "./prefs.js";

/**
 * 产物页的答复草稿（t21）：打开时读回这块评审上次没交的填写，之后每改一处就存一次（没有防抖：输入框里的字少，
 * 防抖反而会在离开页面时丢掉最后几个字）。提交成功、开发者自己关闭评审时由页面调 `clear()`。
 *
 * `target` 是“Work/Task/产物”，一个页面实例只对应一块评审：路由按路径参数重建产物页（`host/routes.ts` 的 `pageKey`），
 * 所以这里不跟着换键。同一块评审开两个标签页时各存各的，后存的覆盖先存的。
 */
export function useAnswerDraft(target: string): {draft: Ref<AnswerDraft>; clear: () => void} {
    const draft = ref<AnswerDraft>(readAnswerDraft(target));
    watch(draft, (value) => writeAnswerDraft(target, value), {deep: true});
    return {draft, clear: () => (draft.value = emptyAnswerDraft())};
}
