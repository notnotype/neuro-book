/**
 * 宿主的文字同时交给 nb-ui 与 nb-layout（docs/specs/ui/i18n.md 输出 8 的例外，docs/specs/ui/nested-grid.md 输出 143）。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

import {LAYOUT_TEXT_KEY} from "@notnotype/nb-layout/text";
import type {LayoutTranslate} from "@notnotype/nb-layout/text";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import {hostTextProvides} from "./host-text";
import {createHostTextEngine} from "./text-engine";

describe("hostTextProvides", () => {
    it("两样一起提供：nb-ui 拿到端口本身，nb-layout 拿到的函数跟着端口的语言、翻出文字而不是键名", () => {
        const text = createHostTextEngine({locale: "zh-CN", strict: true});
        const provides = hostTextProvides(text.port);
        expect(provides[TEXT_PORT_KEY as symbol]).toBe(text.port);
        const layout = provides[LAYOUT_TEXT_KEY as symbol] as LayoutTranslate;
        expect(layout("sortable.handle", {name: "章节"})).toBe("移动章节");
        text.setLocale("en-US");
        expect(layout("sortable.handle", {name: "Chapter"})).toBe("Move Chapter");
        expect(layout("floatWindow.move")).not.toBe("floatWindow.move");
    });
});

/**
 * 应用源码里直接提供 nb-ui 端口的写法：`provide(TEXT_PORT_KEY, …)`、`app.provide(TEXT_PORT_KEY, …)` 与注入表的键。对全文匹配，
 * 括号后换行的写法也拦得到；导入时改名（`TEXT_PORT_KEY as K`）的不管。
 */
const DIRECT_PROVIDE = /(?:\bprovide\(|\.provide\(|\[)\s*TEXT_PORT_KEY\b/gu;

const SRC = join(import.meta.dirname, "../..");
/** 帮手自己，与组件测试的工具（`shared/testing`）：后者经帮手建注入表，测试文件里直接提供的不挂 nb-layout 组件或用缺省目录。 */
const EXEMPT = new Set(["web/host/host-text.ts"]);

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path);
        return /\.(ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

describe("应用里提供文字端口的地方", () => {
    it("都经 web/host/host-text.ts，不直接提供 TEXT_PORT_KEY（否则那棵树里 nb-layout 的文字不跟语言）", () => {
        const offenders = sourceFiles(SRC).flatMap((file) => {
            const path = relative(SRC, file);
            if (EXEMPT.has(path)) return [];
            const text = readFileSync(file, "utf8");
            return [...text.matchAll(DIRECT_PROVIDE)].map((match) => `${path}:${String(text.slice(0, match.index).split("\n").length)}`);
        });
        expect(offenders).toEqual([]);
    });

    it("这条检查拦得下三种写法（含换行的），放过只读注入的", () => {
        const hits = (text: string): number => [...text.matchAll(DIRECT_PROVIDE)].length;
        for (const text of ["provide(TEXT_PORT_KEY, engine.port);", "createApp(X).provide(TEXT_PORT_KEY, port)", "return {[TEXT_PORT_KEY as symbol]: port};", "app\n    .provide(\n        TEXT_PORT_KEY, port)"]) expect(hits(text)).toBe(1);
        for (const text of ["const port = inject(TEXT_PORT_KEY);", "import {TEXT_PORT_KEY} from \"@notnotype/nb-ui/text-port\";"]) expect(hits(text)).toBe(0);
    });
});
