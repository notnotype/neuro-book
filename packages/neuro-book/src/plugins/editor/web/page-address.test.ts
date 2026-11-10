import {describe, expect, it} from "bun:test";

import {pageAddress, pageArgOf, pageIdOf} from "./page-address";

describe("Spec workbench.editor 输出 33：页面标签的地址", () => {
    it("不带参数的地址与原来一样；带参数的把参数编码在问号后面，取回来逐字相同，参数里可以有任何字符", () => {
        expect(pageAddress("nbook.editor.welcome")).toBe("page://nbook.editor.welcome");
        expect(pageIdOf("page://nbook.editor.welcome")).toBe("nbook.editor.welcome");
        expect(pageArgOf("page://nbook.editor.welcome")).toBeUndefined();
        for (const arg of ["e12", "b?#/", "带 空格", "a=b&c", "100%", "?"]) {
            const address = pageAddress("nbook.canon.entry", arg);
            expect(pageIdOf(address)).toBe("nbook.canon.entry");
            expect(pageArgOf(address)).toBe(arg);
        }
        // 不同的参数是不同的地址（标签的身份）。
        expect(pageAddress("nbook.canon.entry", "a")).not.toBe(pageAddress("nbook.canon.entry", "b"));
    });

    it("文件地址不是页面：页面 id 为 null，参数为 undefined，哪怕路径里有问号", () => {
        expect(pageIdOf("project://正文/第一章?.md")).toBeNull();
        expect(pageArgOf("project://正文/第一章?.md")).toBeUndefined();
    });
});
