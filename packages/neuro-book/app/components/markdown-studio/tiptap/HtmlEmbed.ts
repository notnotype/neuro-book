import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {findMarkdownBlockTagStart} from "nbook/shared/markdown-workbench";
import {THEME_HOST_SELECTOR} from "nbook/app/utils/theme/host";

/**
 * 显式 HTML 嵌入块，Markdown 序列化为开闭标签独立成行的 <html>：
 *
 * <html>
 * <div class="card">…</div>
 * </html>
 *
 * 这是唯一具备「渲染」能力的 HTML 语法（未知标签兜底只保源码，见 HtmlFallback.ts）。
 * 默认显示源码卡片，用户点击「渲染」后才挂 sandbox iframe。
 *
 * 安全模型：iframe sandbox="allow-scripts"（不含 allow-same-origin）——
 * 脚本运行在隔离 opaque origin 中，拿不到 NeuroBook 的 DOM / cookie / 存储，
 * fetch 同源接口也会被 CORS 拒绝；与宿主的唯一通道是 postMessage bridge。
 *
 * Bridge 协议（为未来开放 NeuroBook 数据接口预留）：
 * - iframe → host：{source:"nbook-embed", kind:"resize", height} 高度自适应上报
 * - iframe → host：{source:"nbook-embed", kind:"request", id, type, payload} 数据请求
 * - host → iframe：{source:"nbook-host", kind:"response", id, ok, result?, error?}
 * iframe 内可用 `window.nbook.request(type, payload)`；宿主侧由 options.resolveDataApi
 * 处理请求路由，未注入时统一拒绝（本版默认）。开放数据面时只需注入该回调。
 */

interface HtmlEmbedToken extends MarkdownToken {
    html?: string;
}

export interface HtmlEmbedLabels {
    render: string;
    viewSource: string;
    caption: string;
}

/** 宿主数据接口路由；type 为请求类别，payload 为请求参数，返回值会原样回传 iframe */
export type HtmlEmbedDataApi = (type: string, payload: unknown) => Promise<unknown>;

interface HtmlEmbedOptions {
    /** NodeView 按钮文案；NodeView 是纯 DOM，无法直接消费 i18n，由宿主注入 */
    resolveLabels: () => HtmlEmbedLabels;
    /** 可选数据接口路由；不注入时 iframe 内所有 nbook.request 都会被拒绝 */
    resolveDataApi?: HtmlEmbedDataApi;
}

const HTML_EMBED_PATTERN = /^<html>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/html>[ \t]*(?=\r?\n|$)/;

export const HtmlEmbed = Node.create<HtmlEmbedOptions>({
    name: "htmlEmbed",
    group: "block",
    atom: true,
    selectable: true,
    priority: 870,

    addOptions() {
        return {
            resolveLabels: () => ({
                render: "渲染",
                viewSource: "查看源码",
                caption: "HTML",
            }),
        };
    },

    addAttributes() {
        return {
            html: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "pre[data-nb-html-embed]",
            getAttrs: (dom) => ({
                html: (dom as HTMLElement).textContent ?? "",
            }),
        }];
    },

    renderHTML({node}) {
        return ["pre", mergeAttributes({"data-nb-html-embed": "true"}), String(node.attrs.html ?? "")];
    },

    renderText({node}) {
        return `<html>\n${String(node.attrs.html ?? "")}\n</html>`;
    },

    markdownTokenizer: {
        name: "htmlEmbed",
        level: "block",
        start(src: string) {
            // 只认「换行后的行首 <html> 且开标签后换行」，防止段落中断伪装（见 findMarkdownBlockTagStart 注释）
            return findMarkdownBlockTagStart(src, "html");
        },
        tokenize(src: string) {
            const matched = HTML_EMBED_PATTERN.exec(src);
            if (!matched) {
                return undefined;
            }
            return {
                type: "htmlEmbed",
                raw: matched[0],
                html: matched[1] ?? "",
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const embedToken = token as HtmlEmbedToken;
        return helpers.createNode("htmlEmbed", {
            html: String(embedToken.html ?? ""),
        });
    },

    renderMarkdown: (node) => {
        return `<html>\n${String(node.attrs?.html ?? "")}\n</html>`;
    },

    addNodeView() {
        const options = this.options;
        return ({node}) => {
            let currentNode = node;
            let rendered = false;
            let teardownFrame: (() => void) | null = null;
            const wrapper = document.createElement("div");
            wrapper.className = "nb-html-embed";
            wrapper.contentEditable = "false";
            const rerender = (): void => {
                teardownFrame?.();
                teardownFrame = null;
                teardownFrame = renderHtmlEmbedElement(wrapper, String(currentNode.attrs.html ?? ""), rendered, options, () => {
                    rendered = !rendered;
                    rerender();
                });
            };
            rerender();
            return {
                dom: wrapper,
                update: (nextNode) => {
                    if (nextNode.type.name !== "htmlEmbed") {
                        return false;
                    }
                    currentNode = nextNode;
                    rerender();
                    return true;
                },
                // 按钮与渲染区交互不进编辑器；卡片其余部分放行，保证可点选/删除节点
                stopEvent: (event) => {
                    const target = event.target as HTMLElement | null;
                    return Boolean(target?.closest(".nb-html-embed__toggle, .nb-html-embed__frame"));
                },
                ignoreMutation: () => true,
                destroy: () => {
                    teardownFrame?.();
                    teardownFrame = null;
                },
            };
        };
    },
});

/**
 * 渲染嵌入卡片 DOM：源码态显示代码预览，渲染态挂 sandbox iframe。
 * 返回清理函数（渲染态时解除 message 监听）。
 */
function renderHtmlEmbedElement(wrapper: HTMLElement, html: string, rendered: boolean, options: HtmlEmbedOptions, onToggle: () => void): (() => void) | null {
    const labels = options.resolveLabels();
    const header = document.createElement("div");
    header.className = "nb-html-embed__header";

    const caption = document.createElement("span");
    caption.className = "nb-html-embed__caption";
    const icon = document.createElement("span");
    icon.className = "nb-html-embed__icon i-lucide-code-xml";
    caption.append(icon, document.createTextNode(labels.caption));

    const toggle = document.createElement("button");
    toggle.type = "button";
    // 源码态的「渲染」是主操作（accent 视觉），渲染态的「查看源码」是次操作
    toggle.className = `nb-html-embed__toggle ${rendered ? "is-rendered" : "is-idle"}`;
    const toggleIcon = document.createElement("span");
    toggleIcon.className = `nb-html-embed__toggle-icon ${rendered ? "i-lucide-code-xml" : "i-lucide-play"}`;
    toggle.append(toggleIcon, document.createTextNode(rendered ? labels.viewSource : labels.render));
    toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
    });

    header.append(caption, toggle);

    const body = document.createElement("div");
    body.className = "nb-html-embed__body";
    let teardown: (() => void) | null = null;
    if (rendered) {
        teardown = mountHtmlEmbedFrame(body, wrapper, html, options.resolveDataApi);
    } else {
        const source = document.createElement("pre");
        source.className = "nb-html-embed__source";
        source.textContent = html;
        body.appendChild(source);
    }

    wrapper.replaceChildren(header, body);
    return teardown;
}

/**
 * 挂载渲染 iframe 并建立 postMessage bridge；返回清理函数。
 */
function mountHtmlEmbedFrame(container: HTMLElement, themeHost: HTMLElement, html: string, dataApi: HtmlEmbedDataApi | undefined): () => void {
    const frame = document.createElement("iframe");
    frame.className = "nb-html-embed__frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = buildHtmlEmbedDocument(themeHost, html);
    // srcdoc 加载完成前保持透明，加载后渐入，避免闪一帧空白
    frame.addEventListener("load", () => {
        frame.classList.add("is-loaded");
    });
    container.appendChild(frame);

    const onMessage = (event: MessageEvent): void => {
        // 只信任本 iframe 发出的消息，防止其他窗口冒充
        if (event.source !== frame.contentWindow) {
            return;
        }
        const data = event.data as {source?: string; kind?: string; id?: number; type?: string; payload?: unknown; height?: number} | null;
        if (!data || data.source !== "nbook-embed") {
            return;
        }
        if (data.kind === "resize" && typeof data.height === "number") {
            frame.style.height = `${Math.min(Math.max(data.height + 8, 40), 800)}px`;
            return;
        }
        if (data.kind === "request" && typeof data.id === "number") {
            void respondHtmlEmbedRequest(frame, data.id, String(data.type ?? ""), data.payload, dataApi);
        }
    };
    window.addEventListener("message", onMessage);
    return () => {
        window.removeEventListener("message", onMessage);
    };
}

/**
 * 处理 iframe 数据请求并回传结果；未注入数据接口时统一拒绝。
 */
async function respondHtmlEmbedRequest(frame: HTMLIFrameElement, id: number, type: string, payload: unknown, dataApi: HtmlEmbedDataApi | undefined): Promise<void> {
    let ok = false;
    let result: unknown = null;
    let error = "";
    if (!dataApi) {
        error = "NeuroBook data API is not enabled for HTML embeds";
    } else {
        try {
            result = await dataApi(type, payload);
            ok = true;
        } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }
    frame.contentWindow?.postMessage({source: "nbook-host", kind: "response", id, ok, result, error}, "*");
}

/**
 * 组装 iframe srcdoc：主题基础样式 + bridge 脚本 + 用户 HTML。
 */
function buildHtmlEmbedDocument(themeHost: HTMLElement, html: string): string {
    const themeVars = getComputedStyle(themeHost.closest(THEME_HOST_SELECTOR) ?? document.documentElement);
    const textColor = themeVars.getPropertyValue("--text-main").trim() || "#1f2937";
    const fontFamily = themeVars.getPropertyValue("--nb-markdown-editor-font-family").trim() || "inherit";
    return [
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>",
        `body{margin:0;padding:4px 2px;color:${textColor};font-family:${fontFamily};font-size:15px;line-height:1.6;background:transparent;}`,
        "img,video{max-width:100%;}",
        "</style><script>",
        HTML_EMBED_BRIDGE_SCRIPT,
        "</script></head><body>",
        html,
        "</body></html>",
    ].join("");
}

/**
 * 注入 iframe 的 bridge 脚本：暴露 window.nbook.request(type, payload) 并上报内容高度。
 * 固定字符串，不拼接用户内容。
 */
const HTML_EMBED_BRIDGE_SCRIPT = [
    "(function(){",
    "var seq=0;var pending=new Map();",
    "window.nbook={request:function(type,payload){return new Promise(function(resolve,reject){",
    "var id=++seq;pending.set(id,{resolve:resolve,reject:reject});",
    "parent.postMessage({source:'nbook-embed',kind:'request',id:id,type:type,payload:payload},'*');",
    "});}};",
    "window.addEventListener('message',function(event){",
    "var data=event.data;if(!data||data.source!=='nbook-host'||data.kind!=='response')return;",
    "var entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);",
    "if(data.ok)entry.resolve(data.result);else entry.reject(new Error(data.error||'request failed'));",
    "});",
    "function report(){parent.postMessage({source:'nbook-embed',kind:'resize',height:document.documentElement.scrollHeight},'*');}",
    "if(window.ResizeObserver)new ResizeObserver(report).observe(document.documentElement);",
    "window.addEventListener('load',report);setTimeout(report,50);",
    "})();",
].join("");
