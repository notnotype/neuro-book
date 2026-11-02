/**
 * 引用的目标分类与解析（docs/specs/workspace/markdown-dialect.md 输出 18、27）。
 */

import {describe, expect, it} from "bun:test";

import {classifyTarget} from "./targets";

const BASE = "project://正文/第一卷/第一章.md";

describe("Spec workspace.markdown-dialect 输出 18、27：引用的目标", () => {
    it("相对地址按所在文件的目录解析，`/` 开头按作品根；带 `..` 越出根的不显示", () => {
        expect(classifyTarget("../设定/林雪.md", BASE)).toEqual({kind: "work", address: "project://正文/设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("images/a.png", BASE)).toEqual({kind: "work", address: "project://正文/第一卷/images/a.png", name: "a.png"});
        expect(classifyTarget("/设定/林雪.md", BASE)).toEqual({kind: "work", address: "project://设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("../../../外面.md", BASE)).toEqual({kind: "work", address: null, name: "外面.md"});
        expect(classifyTarget("./a%20b.png#片段", BASE)).toEqual({kind: "work", address: "project://正文/第一卷/a b.png", name: "a b.png"});
    });

    it("`user://` 下的文件里 `/` 开头按用户资产根；带方案的作品与用户地址照常解析", () => {
        expect(classifyTarget("/图库/封面.png", "user://模板/说明.md")).toEqual({kind: "user", address: "user://图库/封面.png", name: "封面.png"});
        expect(classifyTarget("project://设定/林雪.md", null)).toEqual({kind: "work", address: "project://设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("user://a.png", BASE)).toEqual({kind: "user", address: "user://a.png", name: "a.png"});
    });

    it("没有所在文件（Composer、展示器）：`/` 开头按作品根，相对地址解析不了归为其它", () => {
        expect(classifyTarget("/设定/林雪.md", null)).toEqual({kind: "work", address: "project://设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("设定/林雪.md", null)).toEqual({kind: "other", address: null, name: "林雪.md"});
    });

    it("外部链接、附件与别的方案（包括旧应用的领域地址）", () => {
        expect(classifyTarget("https://example.com/a.png", BASE).kind).toBe("external");
        expect(classifyTarget("mailto:me@example.com", BASE).kind).toBe("external");
        expect(classifyTarget("session://attachments/截图.png", null)).toEqual({kind: "attachment", address: null, name: "截图.png"});
        expect(classifyTarget("SESSION://attachments/%E6%88%AA%E5%9B%BE.png", null)).toEqual({kind: "attachment", address: null, name: "截图.png"});
        // 会话工作区里别的文件不是附件。
        expect(classifyTarget("session://plan.md", null)).toEqual({kind: "other", address: null, name: ""});
        expect(classifyTarget("chapter://c1", null)).toEqual({kind: "other", address: null, name: ""});
    });
});
