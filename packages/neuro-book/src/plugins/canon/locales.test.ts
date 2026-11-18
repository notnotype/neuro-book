/**
 * `nbook.canon` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）：两种语言的键一一对应，命名空间是插件 id。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {descriptor} from "./plugin";
import {CANON_TEXT_NAMESPACE} from "./shared/text";

describe("nbook.canon 的目录", () => {
    it("两种语言的键一一对应，占位符相同；命名空间是插件 id", () => {
        const zh = flattenCatalog(zhCN);
        const en = flattenCatalog(enUS);
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
        const slots = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]).sort();
        for (const key of Object.keys(zh)) expect({key, slots: slots(en[key]!)}).toEqual({key, slots: slots(zh[key]!)});
        expect(CANON_TEXT_NAMESPACE).toBe(descriptor.id);
    });
});
