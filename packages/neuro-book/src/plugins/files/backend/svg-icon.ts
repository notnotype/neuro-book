/**
 * 主题图标的 SVG 检查（docs/specs/theme/editor.md 的“写图标素材”）。服务端没有 DOM，所以这里是一个严格的词法状态机：整个输入逐个 token
 * 消费，认不得的一律拒绝。不用正则跳过任何一段（注释、CDATA、处理指令、实体都会让跳过的那段成为检查的盲区），所以通过检查的文件里
 * 构造上不可能有脚本、引用或样式：元素与属性都是白名单，值里没有 `url(`、实体和反斜杠（CSS 转义）。
 *
 * 图标是 CSS `mask-image`，浏览器按“SVG 作为图片”的静态模式处理；同一个文件也能被 raw 路由直接访问，那里只有 `nosniff` 与 `sandbox`
 * （限制脚本，不限制资源加载），所以防线是这里，不是响应头。
 */

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const ELEMENTS: ReadonlySet<string> = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "title", "desc"]);
/** 只有文字内容的元素：别的元素里不许有文字，这两个里不许有元素。 */
const TEXT_ELEMENTS: ReadonlySet<string> = new Set(["title", "desc"]);
const ATTRIBUTES: ReadonlySet<string> = new Set([
    "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points", "transform",
    "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
    "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "viewBox",
]);
/** 只允许根元素带的属性。 */
const ROOT_ATTRIBUTES: ReadonlySet<string> = new Set(["xmlns", "version"]);
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const NAME = /[A-Za-z][A-Za-z0-9-]*/uy;
const SPACE = /[ \t\r\n]+/uy;
/** 值里不许有：引号以外的 XML 转义、CSS 转义、能引资源或脚本的写法。 */
const FORBIDDEN_VALUE = /[&<\\]|url\s*\(|javascript:/iu;
/** 除制表、换行、回车外的控制字符（含 NUL）。 */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_DEPTH = 8;

export type SvgIconCheck = {readonly ok: true} | {readonly ok: false; readonly detail: string};

class Rejected extends Error {}

const reject = (detail: string): never => {
    throw new Rejected(detail);
};

/** 从 `at` 起按粘性正则读一个 token；读不到返回 null。 */
function take(pattern: RegExp, text: string, at: number): string | null {
    pattern.lastIndex = at;
    return pattern.exec(text)?.[0] ?? null;
}

export function checkSvgIcon(bytes: Uint8Array): SvgIconCheck {
    let text: string;
    try {
        text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);
    } catch {
        return {ok: false, detail: "不是合法的 UTF-8"};
    }
    try {
        scan(text);
        return {ok: true};
    } catch (error) {
        if (error instanceof Rejected) return {ok: false, detail: error.message};
        throw error;
    }
}

function scan(text: string): void {
    if (text.startsWith("﻿")) reject("不收 BOM");
    if (CONTROL.test(text)) reject("含控制字符");
    let at = text.startsWith(XML_DECLARATION) ? XML_DECLARATION.length : 0;
    const stack: string[] = [];
    let rootSeen = false;
    while (at < text.length) {
        if (text[at] !== "<") {
            const end = text.indexOf("<", at);
            const run = text.slice(at, end === -1 ? text.length : end);
            const top = stack[stack.length - 1];
            if (top !== undefined && TEXT_ELEMENTS.has(top)) {
                if (/[&\\]/u.test(run)) reject(`${top} 的文字里不收 & 与反斜杠`);
            } else if (run.trim() !== "") {
                reject("元素之外不收文字");
            }
            at += run.length;
            continue;
        }
        if (text.startsWith("</", at)) {
            const name = take(NAME, text, at + 2) ?? reject("结束标签没有名字");
            let next = at + 2 + name.length;
            next += take(SPACE, text, next)?.length ?? 0;
            if (text[next] !== ">") reject(`结束标签 ${name} 没有闭合`);
            if (stack.pop() !== name) reject(`结束标签 ${name} 与开始标签不配对`);
            at = next + 1;
            continue;
        }
        // `<!`（注释、CDATA、DOCTYPE）、`<?`（处理指令）都不是字母开头，在这里被拒绝。
        const name = take(NAME, text, at + 1) ?? reject("只收元素标签：不收注释、CDATA、DOCTYPE 与处理指令");
        if (!ELEMENTS.has(name)) reject(`不收元素 ${name}`);
        const top = stack[stack.length - 1];
        if (top !== undefined && TEXT_ELEMENTS.has(top)) reject(`${top} 里只能有文字`);
        const isRoot = stack.length === 0;
        if (isRoot) {
            if (rootSeen) reject("只能有一个根元素");
            if (name !== "svg") reject("根元素要是 svg");
            rootSeen = true;
        } else if (name === "svg") {
            reject("不收嵌套的 svg");
        }
        at += 1 + name.length;
        const seen = new Set<string>();
        for (;;) {
            const space = take(SPACE, text, at);
            at += space?.length ?? 0;
            if (text.startsWith("/>", at)) {
                at += 2;
                break;
            }
            if (text[at] === ">") {
                at += 1;
                if (stack.length >= MAX_DEPTH) reject(`嵌套超过 ${String(MAX_DEPTH)} 层`);
                stack.push(name);
                break;
            }
            if (space === null) reject(`元素 ${name} 的标签格式不对`);
            const attribute = take(/[A-Za-z][A-Za-z0-9:_.-]*/uy, text, at) ?? reject(`元素 ${name} 的标签格式不对`);
            const allowed = ATTRIBUTES.has(attribute) || (isRoot && ROOT_ATTRIBUTES.has(attribute));
            if (!allowed) reject(`不收属性 ${attribute}`);
            if (seen.has(attribute)) reject(`属性 ${attribute} 重复`);
            seen.add(attribute);
            at += attribute.length;
            if (!text.startsWith('="', at)) reject(`属性 ${attribute} 的值要写成 =\"…\"`);
            const close = text.indexOf('"', at + 2);
            if (close === -1) reject(`属性 ${attribute} 的值没有闭合`);
            const value = text.slice(at + 2, close);
            if (FORBIDDEN_VALUE.test(value)) reject(`属性 ${attribute} 的值不收 & < 反斜杠 url( javascript:`);
            if (attribute === "xmlns" && value !== SVG_NAMESPACE) reject("xmlns 只能是 SVG 的命名空间");
            if (attribute === "version" && value !== "1.1" && value !== "1.0") reject("version 只能是 1.0 或 1.1");
            at = close + 1;
        }
        if (isRoot && !seen.has("viewBox")) reject("根元素要有 viewBox");
    }
    if (!rootSeen) reject("没有 svg 元素");
    if (stack.length > 0) reject(`元素 ${stack[stack.length - 1] ?? ""} 没有闭合`);
}
