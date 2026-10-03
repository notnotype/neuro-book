import {nextTick, ref, type Ref} from "vue";
import type {MarkdownEditorHandle, MarkdownInlineCommentItem} from "nbook/app/components/markdown-studio/markdown-editor.types";

/** 只管理当前富文本实例的批注交互，不持有正文或文件会话。 */
export function useMarkdownEditorController(handle: Ref<MarkdownEditorHandle | null>) {
    const commentViewOpen = ref(false);
    const inlineComments = ref<MarkdownInlineCommentItem[]>([]);
    const activeInlineCommentIndex = ref<number | null>(null);
    function setInlineComments(comments: MarkdownInlineCommentItem[]): void {
        inlineComments.value = comments;
        activeInlineCommentIndex.value = comments.find((comment) => comment.active)?.index
            ?? (comments.some((comment) => comment.index === activeInlineCommentIndex.value) ? activeInlineCommentIndex.value : null);
    }
    async function selectInlineComment(index: number): Promise<void> {
        activeInlineCommentIndex.value = index;
        commentViewOpen.value = true;
        await nextTick();
        handle.value?.selectInlineComment?.(index);
    }
    async function activateInlineComment(index: number): Promise<void> {
        activeInlineCommentIndex.value = index;
        commentViewOpen.value = true;
        await nextTick();
        handle.value?.activateInlineComment?.(index);
    }
    return {commentViewOpen, inlineComments, activeInlineCommentIndex, setInlineComments, selectInlineComment, activateInlineComment};
}
