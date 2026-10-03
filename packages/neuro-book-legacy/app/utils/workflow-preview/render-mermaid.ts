/**
 * workflow 可视化共用的 Mermaid 惰性单例渲染器（preview + Agent 气泡）。
 * 图源全部来自服务端投影（trace / CFG / skeleton / session 树），前端只负责渲染字符串。
 */
let mermaidReady: Promise<typeof import("mermaid")["default"]> | null = null;
let renderCount = 0;

/** Mermaid 渲染结果；组件用失败分支展示源码兜底。 */
export type MermaidRenderResult =
    | {ok: true; svg: string}
    | {ok: false; error: string};

async function loadMermaid() {
    if (!mermaidReady) {
        mermaidReady = import("mermaid").then((mod) => {
            mod.default.initialize({startOnLoad: false, theme: "neutral", flowchart: {curve: "basis"}});
            return mod.default;
        });
    }
    return mermaidReady;
}

/** 渲染 Mermaid 源码；语法错误收窄为失败结果，不向组件抛出。 */
export async function renderMermaid(code: string): Promise<MermaidRenderResult> {
    try {
        const mermaid = await loadMermaid();
        const {svg} = await mermaid.render(`wf-mermaid-${renderCount++}`, code);
        return {ok: true, svg};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {ok: false, error: message};
    }
}

/**
 * 兼容旧调用方的字符串入口。新组件优先使用 renderMermaid，才能在失败时展示源码。
 */
export async function renderMermaidSvg(code: string): Promise<string> {
    const result = await renderMermaid(code);
    return result.ok
        ? result.svg
        : `<pre style="font-size:12px;white-space:pre-wrap;">mermaid 渲染失败: ${escapeHtml(result.error)}</pre>`;
}

/** v-html 兼容入口的最小 HTML 转义。 */
function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
