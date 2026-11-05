/**
 * nb-ui 自带目录（docs/specs/ui/i18n.md 的“目录与键”）的核对。
 *
 * 防止迁移改错文字：`LEGACY` 是迁移前组件里写死的中文，逐字抄自提交 e1cc7b22b 的对应文件（出处写在每行末尾）；
 * 带参数的按迁移前模板字符串里的写法给出参数，期望值是迁移前代入后的结果。目录里每个键都要在表里、表里每个键都要
 * 在目录里，中文值翻出来与旧字面量逐字相同。以后有意改文字时，同一次改动里同步改这张表；新加的键也登记在这里，行末写明是新增。
 *
 * 英文是迁移时新写的（迁移前不存在），这里只核对两种语言的键集与占位符一致。
 */

import {describe, expect, it} from "vitest";

import {flattenCatalog} from "../text";
import type {TextParams} from "../text";
import {createMinimalTranslator} from "../text/minimal";
import {NB_UI_CATALOGS, NB_UI_NAMESPACE, uiRef} from "./index";
import type {NbUiTextKey} from "./index";

interface Legacy {
    readonly key: NbUiTextKey;
    readonly params?: TextParams;
    readonly zh: string;
}

const LEGACY: readonly Legacy[] = [
    {key: "alertDialog.title", zh: "确认操作"}, // feedback/AlertDialog.vue 的 title 缺省
    {key: "alertDialog.confirm", zh: "确定"}, // 同上，confirmLabel 缺省
    {key: "alertDialog.cancel", zh: "取消"}, // 同上，cancelLabel 缺省
    {key: "banner.close", zh: "关闭"}, // feedback/Banner.vue 的 closeLabel 缺省
    {key: "breadcrumb.label", zh: "面包屑导航"}, // navigation/Breadcrumb.vue 模板里的 aria-label
    {key: "codeBlock.empty", zh: "无内容"}, // display/CodeBlock.vue 的 emptyText 缺省
    {key: "codeBlock.truncated", zh: "只公开了部分内容"}, // 同上，truncatedText 缺省
    {key: "diffView.mode", zh: "显示方式"}, // display/DiffView.vue，切换行内与两栏的读屏名称
    {key: "diffView.inline", zh: "行内"}, // 同上
    {key: "diffView.split", zh: "两栏"}, // 同上
    {key: "diffView.unchanged", zh: "没有改动"}, // 同上，两段文字相同时标题行的说明
    {key: "diffView.foldedLines", zh: "展开 8 行没变的内容", params: {count: 8}}, // 同上，收起的连续行
    {key: "diffView.foldedChars", zh: "…（812 字）…", params: {count: 812}}, // 同上，一行之内收起的文字
    {key: "colorPicker.value", zh: "颜色值"}, // form/ColorPickerPanel.vue 颜色值输入的 aria-label
    {key: "colorPicker.presets", zh: "预设颜色"}, // 同上，预设色板的 aria-label
    {key: "colorSwatches.label", zh: "颜色"}, // form/ColorSwatches.vue 的 label 缺省
    {key: "dialog.untitled", zh: "对话框"}, // feedback/Dialog.vue 标题为空时的 `props.title || "对话框"`
    {key: "dialog.cancel", zh: "取消"}, // 同上，cancelLabel 缺省
    {key: "dialog.confirm", zh: "确认"}, // 同上，confirmLabel 缺省
    {key: "dialog.close", zh: "关闭"}, // 同上，closeLabel 缺省
    {key: "drawer.untitled", zh: "面板"}, // feedback/Drawer.vue 没有 title 时只给读屏的标题（0.4 新增，原来没有）
    {key: "drawer.close", zh: "关闭"}, // 同上，closeLabel 缺省（0.4 新增，原来关闭按钮没有名字）
    {key: "emptyState.title", zh: "暂无数据"}, // display/EmptyState.vue 的 title 缺省
    {key: "floatingWindow.resizeWidth", zh: "调整窗口宽度"}, // composables/useFloatingWindow.ts 右边手柄的 label
    {key: "floatingWindow.resizeHeight", zh: "调整窗口高度"}, // 同上，下边手柄
    {key: "floatingWindow.resize", zh: "调整窗口大小"}, // 同上，四个角
    {key: "infoTip.label", zh: "说明"}, // feedback/InfoTip.vue 的 label 缺省
    {key: "input.clear", zh: "清空输入"}, // form/Input.vue 的 clearLabel 缺省
    {key: "notification.close", zh: "关闭通知"}, // feedback/Notification.vue 与 NotificationStack.vue 的 closeLabel 缺省
    {key: "notification.inProgress", zh: "进行中"}, // feedback/Notification.vue 不确定进度条的 aria-valuetext
    {key: "numberInput.increase", zh: "增加"}, // form/NumberInput.vue 的 incrementLabel 缺省
    {key: "numberInput.decrease", zh: "减少"}, // 同上，decrementLabel 缺省
    {key: "searchSelect.empty", zh: "没有匹配的选项"}, // form/SearchSelect.vue 的 emptyText 缺省
    {key: "slider.thumb", params: {index: 2}, zh: "滑块 2"}, // form/Slider.vue 的 `滑块 ${index}`
    {key: "spinner.loading", zh: "加载中"}, // display/Spinner.vue 的 label 缺省
    {key: "splitter.resizeWidth", params: {before: "outline", after: "editor"}, zh: "调整 outline 与 editor 的宽度"}, // layout/Splitter.vue 分隔线 aria-label，主轴为宽度
    {key: "splitter.resizeHeight", params: {before: "outline", after: "editor"}, zh: "调整 outline 与 editor 的高度"}, // 同上，主轴为高度
    {key: "splitter.collapsed", zh: "已收起"}, // 同上，aria-valuetext
    {key: "splitter.pixels", params: {size: 200}, zh: "200 像素"}, // 同上，`${size} 像素`
    {key: "table.empty", zh: "暂无数据"}, // display/Table.vue 的 emptyText 缺省
    {key: "tabs.more", zh: "更多"}, // controls/Tabs.vue 的 moreLabel 缺省
    {key: "toolbar.label", zh: "工具栏"}, // controls/Toolbar.vue 的 ariaLabel 缺省
];

const strict = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS}, strict: true});

describe("nb-ui 目录", () => {
    it("中文值与迁移前写死的字面量逐字相同", () => {
        for (const entry of LEGACY) {
            expect(strict.translate(uiRef(entry.key, entry.params), "zh-CN"), entry.key).toBe(entry.zh);
        }
    });

    it("目录里的每个键都在对照表里，对照表里的每个键都在目录里", () => {
        const catalogKeys = Object.keys(flattenCatalog(NB_UI_CATALOGS["zh-CN"] ?? {})).sort();
        expect(LEGACY.map((entry) => entry.key).sort()).toEqual(catalogKeys);
    });

    it("英文目录与中文目录的键、占位符一致，每个键都能翻出非空文字", () => {
        const zh = flattenCatalog(NB_UI_CATALOGS["zh-CN"] ?? {});
        const en = flattenCatalog(NB_UI_CATALOGS["en-US"] ?? {});
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
        const placeholders = (text: string): string[] => [...text.matchAll(/\{\{\s*(\w+)/gu)].map((match) => match[1] ?? "").sort();
        for (const [key, text] of Object.entries(zh)) {
            expect(placeholders(en[key] ?? ""), key).toEqual(placeholders(text));
            expect((en[key] ?? "").trim(), key).not.toBe("");
        }
        for (const entry of LEGACY) {
            // 严格模式下缺键、缺参数会抛错，所以这一步同时核对英文每个键带参数都能翻出来。
            expect(strict.translate(uiRef(entry.key, entry.params), "en-US"), entry.key).not.toBe("");
        }
    });
});
