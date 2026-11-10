import DOMPurify from "dompurify";
import {marked} from "marked";

/**
 * Markdown 渲染：`marked` 转 HTML，DOMPurify 清洗，再改写链接与图片。
 * - 文档与记录都是 Agent 写的：去掉 `style`、表单与控件（能把整页盖住或伪造表单，t10 有了写操作就是 UI 劫持），见 docs/panel.md 的 CSP。
 * - 相对链接按文档所在目录解析成仓库路径：`.md` 转成文档页，产物目录转成产物页，`.agents/works/` 下的其它文件与图片走产物来源；
 *   其余仓库文件面板不提供，链接去掉、图片不显示（单页应用里直接点会落到 index.html）。
 */

export type MarkdownContext = {checkoutKey: string; path: string; artifactBase: string | null};

const FORBID_TAGS = ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"];
/**
 * 清洗时给外站图片做的记号（值是原地址），清洗完在同一棵 DOM 上换成链接。也列进 `FORBID_ATTR`：属性过滤在
 * `afterSanitizeAttributes` 钩子之前，作者自己写的这个属性先被去掉，只有钩子写的留下（第 4 批审查第 1 条）。
 */
const EXTERNAL_MARK = "data-nbdev-external";
const isWebUrl = (value: string) => /^https?:/iu.test(value.trim());
/** `srcset` 里有没有外站的候选（逗号分隔，每项第一段是地址）。 */
const hasWebCandidate = (srcset: string) => srcset.split(",").some((candidate) => isWebUrl(candidate.trim().split(/\s+/u)[0] ?? ""));

function resolveRepoPath(fromPath: string, target: string): string | null {
    const parts = fromPath.split("/").slice(0, -1);
    for (const segment of target.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
            if (parts.length === 0) return null;
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return parts.join("/");
}

function decode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch (error) {
        // 不是合法的百分号编码：按字面路径处理。
        if (!(error instanceof URIError)) throw error;
        return text;
    }
}

/** 仓库路径对应的面板地址；没有对应页面时为 null。 */
export function panelLinkFor(repoPath: string, checkoutKey: string, artifactBase: string | null): {href: string; internal: boolean} | null {
    if (repoPath.endsWith(".md")) return {href: `/docs?checkout=${encodeURIComponent(checkoutKey)}&path=${encodeURIComponent(repoPath)}`, internal: true};
    const task = /^\.agents\/works\/([^/]+)\/tasks\/([^/]+)\/artifacts\/([^/]+)(?:\/|$)/u.exec(repoPath);
    if (task) return {href: `/artifact/${task[1]}/${task[2]}/${task[3]}`, internal: true};
    const work = /^\.agents\/works\/([^/]+)\/artifacts\/([^/]+)(?:\/|$)/u.exec(repoPath);
    if (work) return {href: `/artifact/${work[1]}/-/${work[2]}`, internal: true};
    if (repoPath.startsWith(".agents/works/") && artifactBase) return {href: `${artifactBase}/${encodeURIComponent(checkoutKey)}/${repoPath.split("/").map(encodeURIComponent).join("/")}`, internal: false};
    return null;
}

export function renderMarkdown(text: string, context: MarkdownContext): string {
    return sanitize(marked.parse(text, {async: false, gfm: true}) as string, context);
}

/**
 * 行内 Markdown 去掉标记后的纯文字：链接只留文字，反引号、强调符号去掉。给只放得下两行摘要、不放链接的地方（首页 Work 卡片的目标）。
 * 只在浏览器里用：`DOMParser` 解析出的文档不执行脚本、不加载图片，只取文字。
 */
export function inlineMarkdownText(text: string): string {
    const html = marked.parseInline(text, {async: false, gfm: true}) as string;
    return new DOMParser().parseFromString(html, "text/html").body.textContent ?? text;
}

/** 行内 Markdown（表格里的“当前情况”这类一行字）：只认行内语法，不出段落；清洗与链接改写同 renderMarkdown。 */
export function renderInlineMarkdown(text: string, context: MarkdownContext): string {
    return sanitize(marked.parseInline(text, {async: false, gfm: true}) as string, context);
}

function sanitize(html: string, context: MarkdownContext): string {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
            const href = node.getAttribute("href") ?? "";
            if (href === "" || href.startsWith("#")) return;
            if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) {
                node.setAttribute("target", "_blank");
                node.setAttribute("rel", "noopener noreferrer");
                return;
            }
            const [pathPart = ""] = href.split(/[?#]/u);
            const repoPath = href.startsWith("/") ? decode(pathPart.slice(1)) : resolveRepoPath(context.path, decode(pathPart));
            const link = repoPath === null ? null : panelLinkFor(repoPath, context.checkoutKey, context.artifactBase);
            if (!link) {
                node.removeAttribute("href");
                node.setAttribute("title", `面板不提供这个文件：${repoPath ?? href}`);
                return;
            }
            node.setAttribute("href", link.href);
            if (link.internal) node.setAttribute("data-internal", "");
            else {
                node.setAttribute("target", "_blank");
                node.setAttribute("rel", "noopener noreferrer");
            }
        } else if (node.tagName === "PRE" || node.tagName === "TABLE") {
            // 代码块与表格放不下时自己横向滚动：能聚焦，键盘才滚得动（axe scrollable-region-focusable）。
            node.setAttribute("tabindex", "0");
        } else if (node.tagName === "SOURCE") {
            // `<picture>` 里给明暗两套图的 `<source>`：外站的候选去掉，退回同一个 `<picture>` 里的 `<img>`（它会被换成链接）。
            if (hasWebCandidate(node.getAttribute("srcset") ?? "")) node.removeAttribute("srcset");
        } else if (node.tagName === "IMG") {
            // `srcset` 只在有外站候选时去掉；同源与 data: 的候选浏览器照常挑。
            if (hasWebCandidate(node.getAttribute("srcset") ?? "")) node.removeAttribute("srcset");
            const src = node.getAttribute("src") ?? "";
            if (/^data:/iu.test(src)) return;
            if (isWebUrl(src)) {
                // 外站图片不加载（面板的 CSP 也拦着）：打开文档就发请求，会把“开发者在看”与本机地址带给外站；清洗后换成链接，见 `replaceExternalImages`。
                node.setAttribute(EXTERNAL_MARK, src);
                node.removeAttribute("src");
                return;
            }
            const repoPath = src.startsWith("/") ? decode(src.slice(1)) : resolveRepoPath(context.path, decode(src.split(/[?#]/u)[0] ?? ""));
            if (repoPath !== null && repoPath.startsWith(".agents/works/") && context.artifactBase) {
                node.setAttribute("src", `${context.artifactBase}/${encodeURIComponent(context.checkoutKey)}/${repoPath.split("/").map(encodeURIComponent).join("/")}`);
            } else {
                node.removeAttribute("src");
            }
        }
    });
    try {
        // 在 DOMPurify 返回的同一棵 DOM 上换外站图片，最后只序列化一次，不多一轮“序列化再解析”。
        const fragment = DOMPurify.sanitize(html, {FORBID_TAGS, FORBID_ATTR: ["style", EXTERNAL_MARK], RETURN_DOM_FRAGMENT: true});
        replaceExternalImages(fragment);
        const holder = fragment.ownerDocument.createElement("div");
        holder.appendChild(fragment);
        return holder.innerHTML;
    } finally {
        DOMPurify.removeHook("afterSanitizeAttributes");
    }
}

/**
 * 外站图片换成一个链接“外站图片：<alt 或文件名>（<域名>）”，新标签页打开原图；外面已经是链接的只换成文字（t15 阶段 4 第 4 批，后续清单的推迟事项）。
 * 不放宽面板的 CSP：文档来自各个 worktree，Agent 写进去的外站图片一打开就会发请求；徽章这类图片在面板里也没有信息量。
 * 记号只能是清洗钩子写的（作者写的已被 `FORBID_ATTR` 去掉），这里仍只认解析得出、协议是 http 或 https 的地址；文字走 `textContent`。
 */
function replaceExternalImages(fragment: DocumentFragment): void {
    const doc = fragment.ownerDocument;
    for (const image of fragment.querySelectorAll(`img[${EXTERNAL_MARK}]`)) {
        const src = image.getAttribute(EXTERNAL_MARK) ?? "";
        let url: URL | null = null;
        try {
            url = new URL(src);
        } catch (error) {
            if (!(error instanceof TypeError)) throw error;
        }
        if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
            image.removeAttribute(EXTERNAL_MARK);
            continue;
        }
        const name = decode(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
        // 徽章常套在链接里（`[![…](图)](链接)`）：外面已经是链接时只换成文字，链接里不能再套链接。
        const replacement = doc.createElement(image.closest("a") === null ? "a" : "span");
        if (replacement.tagName === "A") {
            replacement.setAttribute("href", url.href);
            replacement.setAttribute("target", "_blank");
            replacement.setAttribute("rel", "noopener noreferrer");
        }
        replacement.className = "nbdev-external-image";
        replacement.textContent = `外站图片：${image.getAttribute("alt") || name || "图片"}（${url.host}）`;
        image.replaceWith(replacement);
    }
}
