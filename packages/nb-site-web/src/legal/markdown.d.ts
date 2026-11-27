// 条款正文的 `.md` 由构建插件转成 `LegalDocument`（`build/legal-docs.ts`）。插件只转 `legal/<语言>/` 下的文件，
// 别处的 `.md`（组件说明）不该被导入。
declare module "*.md" {
    const document: import("./document").LegalDocument;
    export default document;
}
