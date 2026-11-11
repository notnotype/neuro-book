/**
 * `@notnotype/nb-markdown/prompt-text`：提示词文字的纯 TS 部分，不引 DOM 与编辑内核，宿主服务端认 `$` 标签用它。分词与编辑器、
 * 展示器是同一份（`prompt-text.ts`），所以服务端认出的标签与编辑器里显示成小块的一致（docs/specs/ui/prompt-editor.md）。
 * 能引的文件由 `src/boundary.test.ts` 核对。
 */

export {promptSkillTokens} from "./prompt-text";
