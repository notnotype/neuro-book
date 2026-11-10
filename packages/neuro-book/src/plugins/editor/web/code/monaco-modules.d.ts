/**
 * monaco-editor 里没有类型声明、而本插件要引入的模块。`monaco-languages.ts` 与 `load-monaco.ts` 用三斜线引用本文件：
 * 三份 tsconfig 的 include 不同，引用随导入链走，哪份都看得到。
 */

/** 编辑器的全部功能（查找、折叠、右键菜单等）：只为副作用引入。 */
declare module "monaco-editor/esm/vs/editor/editor.all.js" {}

/**
 * 自带语言的分词与编辑规则（`basic-languages/<名字>/<名字>.js`）。一般导出 `language` 与 `conf`；freemarker2 一个模块导出
 * 6 种写法，各是一对 `language` 与 `conf`。升级 Monaco 后 loader 用到了别的导出，类型检查会在 `monaco-languages.ts` 报出。
 */
declare module "monaco-editor/esm/vs/basic-languages/*" {
    import type {languages} from "monaco-editor/esm/vs/editor/editor.api.js";

    interface MonarchModule {
        readonly language: languages.IMonarchLanguage;
        readonly conf: languages.LanguageConfiguration;
    }

    export const language: languages.IMonarchLanguage;
    export const conf: languages.LanguageConfiguration;
    export const TagAngleInterpolationDollar: MonarchModule;
    export const TagBracketInterpolationDollar: MonarchModule;
    export const TagAngleInterpolationBracket: MonarchModule;
    export const TagBracketInterpolationBracket: MonarchModule;
    export const TagAutoInterpolationDollar: MonarchModule;
    export const TagAutoInterpolationBracket: MonarchModule;
}

/**
 * Monaco 记“上一次复制”的附带信息（整行复制、多光标各段）的地方，内部模块：菜单里的粘贴自己读剪贴板，要把这份信息
 * 一起交给 Monaco，结果才和 Ctrl+V 相同（docs/specs/workbench/editor.md 输出 64）。升级后路径或形状变了，这里会报出。
 */
declare module "monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js" {
    export class InMemoryClipboardMetadataManager {
        static readonly INSTANCE: InMemoryClipboardMetadataManager;
        /** 文字与上一次复制的相同才有；不同时为 null。 */
        get(pastedText: string): {readonly isFromEmptySelection?: boolean; readonly multicursorText?: ReadonlyArray<string> | null; readonly mode?: string | null} | null;
    }
}
