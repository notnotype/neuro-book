/**
 * 页面导入一份条款正文（`legal/<语言>/*.md`）得到的样子。转换在构建时由 `build/legal-docs.ts` 做，浏览器里没有 Markdown 库。
 */
export interface LegalDocument {
    /** 条款版本，`YYYY-MM-DD`；所有正文共用一个，等于同意页显示的 `meta` 里的版本（`site.accounts` 的条款版本）。 */
    readonly version: string;
    /** 正文转成的 HTML，标题从 `h2` 起。来自仓库自己的文件，不含用户输入。 */
    readonly html: string;
}
