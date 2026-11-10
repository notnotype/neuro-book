/**
 * 压缩方法与放回交给宿主填的东西：摘要的提示词与内置工具在宿主里的 id。
 */

/** 摘要的提示词：小节与规则由宿主定（开发者 2026-11-10：摘要的小节由应用决定），`require` 是 Profile 追加的要求。 */
export interface CompactionPrompts {
    /** 就地压缩追加在原样对话之后的那条消息。 */
    inplace(require: readonly string[]): string;
    /** 摘要模型的系统提示词。 */
    system(require: readonly string[]): string;
    /** 摘要模型的那条消息：对话的文字，分段时后一段带前一段的摘要。 */
    input(segment: string, previous: string | null): string;
}

/** 内置工具在宿主里的 id：shake 的占位、放回找“最近读过或改过的文件”都按它认。 */
export interface BuiltinToolIds {
    readonly read: string;
    readonly write: string;
    readonly edits: readonly string[];
    readonly search: readonly string[];
    readonly shell: string;
}
