/** 链接卡片的输入换成链接（markdown-editing.md 输出 52、57）：真实的目标分类与编码，当前文件的地址是 `base`。 */

import {describe, expect, it} from "bun:test";

import {classifyTarget} from "../../../shared/targets";
import {linkRequest} from "./link-input";

const BASE = "project://卷一/第一章.md";

describe("linkRequest：地址", () => {
    it("project:// 开头的作品地址改写成相对当前文件的写法；外部网址、user://、相对地址原样", () => {
        expect(linkRequest("project://设定/林雪.md", BASE)?.href).toBe("../设定/林雪.md");
        expect(linkRequest("project://卷一/第二章.md", BASE)?.href).toBe("第二章.md");
        expect(linkRequest("https://example.com/a?b=1#c", BASE)?.href).toBe("https://example.com/a?b=1#c");
        expect(linkRequest("mailto:a@example.com", BASE)?.href).toBe("mailto:a@example.com");
        expect(linkRequest("user://笔记.md", BASE)?.href).toBe("user://笔记.md");
        expect(linkRequest("../设定/林雪.md", BASE)?.href).toBe("../设定/林雪.md");
        expect(linkRequest("  https://example.com  ", BASE)?.href).toBe("https://example.com");
    });

    it("文件名里的 % 按方言读取一侧的规则编码，输入里的 # 与 ? 是片段与查询的开头、原样接在后面；读回来指向同一个文件", () => {
        const href = linkRequest("project://设定/100% 版.md?x=1#标题", BASE)?.href ?? "";
        expect(href).toBe("../设定/100%25 版.md?x=1#标题");
        expect(classifyTarget(href, BASE).address).toBe("project://设定/100% 版.md");
    });

    it("当前文件不知道时作品地址原样写（没有相对的写法）", () => {
        expect(linkRequest("project://设定/林雪.md", null)?.href).toBe("project://设定/林雪.md");
    });

    it("空的、不安全的方案（javascript:、vbscript:、data:）为 null", () => {
        for (const bad of ["", "   ", "javascript:alert(1)", " JavaScript:alert(1)", "vbscript:x", "data:text/html,x"]) expect([bad, linkRequest(bad, BASE)]).toEqual([bad, null]);
    });
});

describe("linkRequest：光标处插入时的文字", () => {
    it("作品里的文件取文件名（去掉扩展名）；外部网址取网址本身", () => {
        expect(linkRequest("project://设定/林雪.md", BASE)?.label).toBe("林雪");
        expect(linkRequest("../设定/林雪.md", BASE)?.label).toBe("林雪");
        expect(linkRequest("第二章.v2.md", BASE)?.label).toBe("第二章.v2");
        expect(linkRequest("插图/a.png", BASE)?.label).toBe("a");
        expect(linkRequest("https://example.com/林雪", BASE)?.label).toBe("https://example.com/林雪");
        expect(linkRequest("mailto:a@example.com", BASE)?.label).toBe("mailto:a@example.com");
    });

    it("没有扩展名、以点开头的文件名原样；解析不出文件名的取输入本身", () => {
        expect(linkRequest("project://设定/总览", BASE)?.label).toBe("总览");
        expect(linkRequest("project://.gitignore", BASE)?.label).toBe(".gitignore");
        expect(linkRequest("#标题", BASE)?.label).toBe("#标题");
    });
});
