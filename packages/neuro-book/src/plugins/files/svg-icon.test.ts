/**
 * 主题图标的 SVG 检查（docs/specs/theme/editor.md 验收 17）：合格的图标通过，每条拒绝规则一个反例。判据是通过检查的文件里
 * 不可能有脚本、引用或样式，所以反例覆盖各种把它们藏进去的写法。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {checkSvgIcon} from "./backend/svg-icon";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const ok = (text: string) => checkSvgIcon(encode(text));
const wrap = (inner: string, attributes = ""): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"${attributes}>${inner}</svg>`;

describe("合格的图标", () => {
    it("书房自带的图标都通过", () => {
        const directory = join(import.meta.dir, "..", "theme-study", "assets", "icons");
        const files = readdirSync(directory).filter((name) => name.endsWith(".svg"));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(checkSvgIcon(readFileSync(join(directory, file)))).toEqual({ok: true});
    });

    it("lucide 的全部图标（包成 24x24 的 SVG）都通过：白名单没有误拒真实图标", () => {
        // 图标集的数据在仓库根的依赖里；找不到时让测试失败，不静默跳过。
        const data = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "node_modules", "@iconify-json", "lucide", "icons.json"), "utf8")) as {icons: Record<string, {body: string}>};
        const names = Object.keys(data.icons);
        expect(names.length).toBeGreaterThan(1000);
        const rejected = names.flatMap((name) => {
            const result = ok(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${data.icons[name]?.body ?? ""}</svg>`);
            return result.ok ? [] : [`${name}: ${result.detail}`];
        });
        expect(rejected).toEqual([]);
    });

    it("单引号的属性值也收：打包器内联后的 SVG 就是这样的（内置主题的图标到浏览器时是 data: 地址）", () => {
        expect(ok("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000'><path d='M0 0h4'/></svg>")).toEqual({ok: true});
        expect(ok("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M0 0' fill='url(#a)'/></svg>").ok).toBe(false);
        expect(ok("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M0 0\"' onclick='x'/></svg>").ok).toBe(false);
    });

    it("可带 XML 声明、元素之间的空白、title 与 desc 的文字、嵌套的 g", () => {
        expect(ok(`<?xml version="1.0" encoding="UTF-8"?>\n${wrap('\n  <title>文件</title>\n  <desc>示意</desc>\n  <g transform="translate(1 1)"><path d="M0 0h4"/></g>\n')}\n`)).toEqual({ok: true});
    });
});

describe("拒绝", () => {
    it.each<[string, string]>([
        ["脚本元素", wrap("<script>alert(1)</script>")],
        ["事件属性", wrap('<path d="M0 0" onload="x()"/>')],
        ["事件属性（大小写变体）", wrap('<path d="M0 0" OnClick="x()"/>')],
        ["href", wrap('<use href="#a"/>')],
        ["xlink:href", wrap('<path d="M0 0" xlink:href="https://example.com/x"/>')],
        ["use 元素", wrap('<use/>')],
        ["foreignObject", wrap("<foreignObject/>")],
        ["image 元素", wrap('<image width="1" height="1"/>')],
        ["style 元素", wrap("<style>path{fill:red}</style>")],
        ["style 属性", wrap('<path d="M0 0" style="fill:red"/>')],
        ["animate", wrap('<animate attributeName="d"/>')],
        ["set", wrap("<set/>")],
        ["元素名大小写变体", wrap("<PATH/>")],
        ["属性名大小写变体", wrap('<path D="M0 0"/>')],
        ["fill 里的 url(", wrap('<path d="M0 0" fill="url(#a)"/>')],
        ["fill 里的 URL (（大小写与空白）", wrap('<path d="M0 0" fill="URL (https://example.com/x)"/>')],
        ["值里的 javascript:", wrap('<path d="M0 0" fill="javascript:alert(1)"/>')],
        ["值里的实体", wrap('<path d="M0 0" fill="&#117;rl(x)"/>')],
        ["值里的 CSS 转义", wrap('<path d="M0 0" fill="u\\72l(x)"/>')],
        ["值里的 <", wrap('<path d="M0 0" fill="a<b"/>')],
        ["值没有引号", wrap("<path d=M0/>")],
        ["值的引号没有闭合", wrap('<path d="M0/>')],
        ["重复属性", wrap('<path d="M0 0" d="M1 1"/>')],
        ["带命名空间前缀的元素", wrap("<svg:path/>")],
        ["不认识的属性", wrap('<path d="M0 0" data-x="1"/>')],
        ["注释", wrap("<!-- <script> -->")],
        ["CDATA", wrap("<![CDATA[<script>]]>")],
        ["DOCTYPE", `<!DOCTYPE svg>${wrap("")}`],
        ["实体声明", `<!DOCTYPE svg [<!ENTITY a "b">]>${wrap("")}`],
        ["其它处理指令", `<?xml-stylesheet href="x.css"?>${wrap("")}`],
        ["XML 声明写法不同", `<?xml version='1.0'?>${wrap("")}`],
        ["嵌套的 svg", wrap('<svg viewBox="0 0 1 1"/>')],
        ["两个根元素", `${wrap("")}${wrap("")}`],
        ["根不是 svg", '<g viewBox="0 0 1 1"/>'],
        ["根没有 viewBox", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
        ["xmlns 不是 SVG 的命名空间", '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 1 1"></svg>'],
        ["xmlns 出现在非根元素上", wrap('<g xmlns="http://www.w3.org/2000/svg"/>')],
        ["元素之外的文字", `${wrap("")}x`],
        ["svg 里的文字", wrap("hello")],
        ["title 里的元素", wrap("<title><path/></title>")],
        ["title 里的实体", wrap("<title>&lt;</title>")],
        ["没有闭合的标签", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path/>'],
        ["标签不配对", wrap("<g></path></g>")],
        ["标签没有结束符", '<svg viewBox="0 0 1 1"'],
        ["属性没有空白隔开", wrap('<path d="M0 0"fill="red"/>')],
        ["空输入", ""],
        ["只有空白", "  \n"],
        ["不是 SVG 的文本", "hello"],
        ["标签之间的不间断空格", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">\u00a0</svg>`],
        ["标签之间的全角空格", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">\u2003</svg>`],
        ["根元素之后的行分隔符 U+2028", `${wrap("")}\u2028`],
        ["根元素之后的 U+FEFF", `${wrap("")}\ufeff`],
        ["控制字符", wrap("<title>a\u0000b</title>")],
        ["开头的 BOM", `﻿${wrap("")}`],
        ["嵌套过深", wrap("<g>".repeat(9) + "</g>".repeat(9))],
    ])("%s", (_name, text) => {
        expect(ok(text).ok).toBe(false);
    });

    it("不是 UTF-8 的字节", () => {
        expect(checkSvgIcon(new Uint8Array([0x3c, 0xff, 0xfe]))).toMatchObject({ok: false});
    });

    it("拒绝时说明哪里不合格", () => {
        expect(ok(wrap("<script/>"))).toEqual({ok: false, detail: "不收元素 script"});
    });
});
