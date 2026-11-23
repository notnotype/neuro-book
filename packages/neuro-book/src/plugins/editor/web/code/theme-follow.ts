/**
 * 让 Monaco 的主题跟着产品主题走（docs/specs/workbench/editor.md 输出 65）。Monaco 的主题整页只有一份（`defineTheme`、
 * `setTheme` 都是全局的），所以页面上不管有几个编辑器实例，只留一个盯着文档根的观察器：按使用方计数，第一个使用方到来时
 * 生成主题并开始观察，最后一个离开时停止。没有使用方的期间主题变了不要紧，下一个使用方到来时会重新生成。
 */

import type {MonacoApi} from "./load-monaco";
import {buildMonacoTheme, MONACO_THEME} from "./monaco-theme";

let users = 0;
let observer: MutationObserver | null = null;

/** 开始跟随；返回的函数在编辑器实例释放时调用（多调无效）。要在建编辑器实例之前调用：实例按 `MONACO_THEME` 创建。 */
export function followMonacoTheme(api: MonacoApi): () => void {
    if (users === 0) {
        const apply = (): void => {
            api.editor.defineTheme(MONACO_THEME, buildMonacoTheme(document.documentElement));
            api.editor.setTheme(MONACO_THEME);
        };
        apply();
        // 主题或明暗变了（文档根上的 token 换了）：重新生成。
        observer = new MutationObserver(apply);
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ["style", "class", "data-nb-appearance", "data-nb-theme"]});
    }
    users += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        users -= 1;
        if (users === 0) {
            observer?.disconnect();
            observer = null;
        }
    };
}
