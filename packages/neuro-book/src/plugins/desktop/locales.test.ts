/**
 * `nbook.desktop` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）：中英两份的键一一对应、都不空，引用的命名空间是插件 id。
 * 现有的内联双语配置项不在目录里，迁移时再加对照表。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {descriptor} from "./plugin";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {desktopText} from "./shared/text";
import {desktopCatalogs} from "./web/text";

describe("nbook.desktop 的目录", () => {
    it("两份目录的键一一对应，值都不是空串", () => {
        const zh = flattenCatalog(zhCN);
        const en = flattenCatalog(enUS);
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
        for (const value of [...Object.values(zh), ...Object.values(en)]) expect(value.trim()).not.toBe("");
    });

    it("占位符两边相同", () => {
        const zh = flattenCatalog(zhCN);
        const en = flattenCatalog(enUS);
        const params = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]!).sort();
        for (const key of Object.keys(zh)) expect({key, params: params(en[key]!)}).toEqual({key, params: params(zh[key]!)});
    });

    it("取文字函数的命名空间是插件 id，目录以中文为源语言", () => {
        expect(desktopText("firstRun.title").ns).toBe(descriptor.id);
        expect(desktopCatalogs.source).toBe("zh-CN");
    });
});
