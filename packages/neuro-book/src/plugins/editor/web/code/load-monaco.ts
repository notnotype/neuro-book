/**
 * Monaco 的按需加载（docs/specs/workbench/editor.md 输出 20）：第一次打开源码文件时才加载 ESM 入口、语言与 worker，
 * 首屏不含它。加载失败时下次重试，不缓存失败。
 */

export type MonacoApi = typeof import("monaco-editor/esm/vs/editor/editor.api.js");

let loading: Promise<MonacoApi> | null = null;

export function loadMonaco(): Promise<MonacoApi> {
    loading ??= (async () => {
        const [api, , , , , , , , , editorWorker, jsonWorker] = await Promise.all([
            import("monaco-editor/esm/vs/editor/editor.api.js"),
            import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
            import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/css/css.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/html/html.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
            import("monaco-editor/esm/vs/editor/editor.worker.js?worker"),
            import("monaco-editor/esm/vs/language/json/json.worker.js?worker"),
        ]);
        // 语言服务在模型释放后取消在途的请求，用 Monaco 自己的取消错误（名字与消息都是 "Canceled"）reject，没有人接，
        // 页面上就多一条未处理的拒绝。取消不是失败（VS Code 的 onUnexpectedError 同样忽略它）：只认这一种，其余照常报出。
        window.addEventListener("unhandledrejection", (event) => {
            const reason: unknown = event.reason;
            if (reason instanceof Error && reason.name === "Canceled" && reason.message === "Canceled") event.preventDefault();
        });
        // JSON 的语言服务要自己的 worker，其余走通用的 editor worker。
        globalThis.MonacoEnvironment = {
            getWorker: (_moduleId: string, label: string) => (label === "json" ? new jsonWorker.default() : new editorWorker.default()),
        };
        return api;
    })().catch((error: unknown) => {
        loading = null;
        throw error;
    });
    return loading;
}

const LANGUAGES: Readonly<Record<string, string>> = {
    md: "markdown",
    markdown: "markdown",
    json: "json",
    js: "javascript",
    mjs: "javascript",
    ts: "typescript",
    css: "css",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
};

/** 按扩展名取 Monaco 的语言；不认识的为纯文本。 */
export function languageOf(address: string): string {
    const name = address.slice(address.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "plaintext" : LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? "plaintext";
}
