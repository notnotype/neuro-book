import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

/**
 * 产物来源给评审板页面加上答题控件（t23）：HTML 回应里插一个脚本标签，脚本本身在保留路径 `_nbdev/` 下回。
 * 只改回应，磁盘上的页面、文件集与 `contentHash` 都不变。合同见 docs/panel.md 的“页面里作答”。
 */

/** 保留路径下的脚本文件名：`/a/<前缀>/_nbdev/answer-bridge.js`。 */
export const ANSWER_BRIDGE_FILE = "answer-bridge.js";
const SOURCE = fileURLToPath(new URL("../web/bridge/answer-bridge.ts", import.meta.url));

let compiled: Promise<string> | null = null;

/**
 * 转译好的桥接脚本，第一次要时转译、之后用缓存（改了源码要重启面板，和面板别的代码一样）。
 * 用 Bun 自带的转译器只去掉类型、不打包：脚本只依赖类型，不进 Vite 构建，也不用等前端构建。
 * 转译失败时下次再试，不把失败缓存下来。
 */
export function answerBridgeScript(): Promise<string> {
    compiled ??= readFile(SOURCE, "utf8").then((source) => new Bun.Transpiler({loader: "ts", target: "browser"}).transformSync(source)).catch((error: unknown) => {
        compiled = null;
        throw error;
    });
    return compiled;
}

/**
 * 在 `</body>` 前插入脚本标签，没有 `</body>` 就接在末尾。按最后一个 `</body>` 找：页面的内联脚本或注释里可能也写着这几个字。
 * `defer`：标签在页面末尾也照样等解析完才跑，题的元素都在了。
 */
export function injectAnswerBridge(html: string, scriptSrc: string): string {
    const tag = `<script src="${scriptSrc}" defer></script>`;
    const at = html.toLowerCase().lastIndexOf("</body>");
    return at < 0 ? `${html}\n${tag}\n` : `${html.slice(0, at)}${tag}\n${html.slice(at)}`;
}
