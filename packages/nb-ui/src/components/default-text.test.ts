/**
 * 组件的缺省文案走翻译端口（docs/specs/ui/i18n.md 输出 8）：没有宿主时是中文，宿主注入端口后跟着端口的语言，
 * 调用方显式传属性时以属性为准，换语言不重新挂载。迁移前写死的中文由 `../locales/locales.test.ts` 逐字核对。
 *
 * 浮层类组件（Dialog、AlertDialog）的内容在 body 里，所以统一从 body 读。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {nextTick, ref} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {createNotificationQueue} from "../composables/useNotification";
import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "../locales";
import {TEXT_PORT_KEY} from "../text-port";
import type {TextPort} from "../text-port";
import {createMinimalTranslator} from "../text/minimal";
import Spinner from "./display/Spinner.vue";
import Banner from "./feedback/Banner.vue";
import Dialog from "./feedback/Dialog.vue";
import AlertDialog from "./feedback/AlertDialog.vue";
import InfoTip from "./feedback/InfoTip.vue";
import Notification from "./feedback/Notification.vue";
import NotificationStack from "./feedback/NotificationStack.vue";
import CodeBlock from "./display/CodeBlock.vue";
import EmptyState from "./display/EmptyState.vue";
import Table from "./display/Table.vue";
import Toolbar from "./controls/Toolbar.vue";
import Breadcrumb from "./navigation/Breadcrumb.vue";
import ColorSwatches from "./form/ColorSwatches.vue";
import Input from "./form/Input.vue";
import NumberInput from "./form/NumberInput.vue";
import SearchSelect from "./form/SearchSelect.vue";
import Slider from "./form/Slider.vue";
import Splitter from "./layout/Splitter.vue";

const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS}, strict: true});

/** 自建一个可以换语言的端口，做法同宿主：端口的 `t` 读语言的 ref，组件里的 `computed` 就跟着变。 */
function makePort(initial: string): {port: TextPort; locale: ReturnType<typeof ref<string>>} {
    const locale = ref(initial);
    return {locale, port: {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)}};
}

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const attr = (selector: string, name: string) => (): string | null => document.body.querySelector(selector)?.getAttribute(name) ?? null;
const text = (selector: string) => (): string | null => document.body.querySelector(selector)?.textContent?.trim() ?? null;

interface Case {
    readonly name: string;
    /** 泛型组件（Table）的类型对不上 `Component`，这里只当挂载入口用。 */
    readonly component: any;
    readonly props: Record<string, unknown>;
    /** 读出被检查的那段文案。 */
    readonly read: () => string | null;
    readonly zh: string;
    readonly en: string;
    /** 显式传属性时的属性名与值：以属性为准。 */
    readonly override?: {readonly props: Record<string, unknown>; readonly expected: string};
}

const queue = createNotificationQueue();

const CASES: readonly Case[] = [
    {name: "Banner 关闭按钮", component: Banner, props: {dismissible: true, message: "m"}, read: attr("button[aria-label]", "aria-label"), zh: "关闭", en: "Close", override: {props: {closeLabel: "收起横幅"}, expected: "收起横幅"}},
    {name: "Spinner 读屏名", component: Spinner, props: {}, read: attr("[role=status]", "aria-label"), zh: "加载中", en: "Loading", override: {props: {label: "保存中"}, expected: "保存中"}},
    {name: "EmptyState 标题", component: EmptyState, props: {}, read: text("p"), zh: "暂无数据", en: "No data", override: {props: {title: "没有章节"}, expected: "没有章节"}},
    {name: "Table 空态", component: Table, props: {columns: [{key: "a", label: "A"}], rows: []}, read: text("tbody"), zh: "暂无数据", en: "No data", override: {props: {emptyText: "没有行"}, expected: "没有行"}},
    {name: "CodeBlock 空态", component: CodeBlock, props: {lines: []}, read: text(".nb-code-block__empty"), zh: "无内容", en: "No content", override: {props: {emptyText: "空"}, expected: "空"}},
    {name: "CodeBlock 截断说明", component: CodeBlock, props: {lines: [], truncated: true}, read: text(".nb-code-block__note"), zh: "只公开了部分内容", en: "Only part of the content is shown", override: {props: {truncatedText: "已截断"}, expected: "已截断"}},
    {name: "Toolbar 读屏名", component: Toolbar, props: {}, read: attr("[role=toolbar]", "aria-label"), zh: "工具栏", en: "Toolbar", override: {props: {ariaLabel: "编辑工具"}, expected: "编辑工具"}},
    {name: "Breadcrumb 读屏名", component: Breadcrumb, props: {items: [{label: "首页"}]}, read: attr("nav", "aria-label"), zh: "面包屑导航", en: "Breadcrumb"},
    {name: "Input 清空按钮", component: Input, props: {modelValue: "x", clearable: true}, read: attr("button[aria-label]", "aria-label"), zh: "清空输入", en: "Clear input", override: {props: {clearLabel: "清掉"}, expected: "清掉"}},
    {name: "NumberInput 增加按钮", component: NumberInput, props: {modelValue: "1"}, read: attr("button[aria-label]", "aria-label"), zh: "增加", en: "Increase", override: {props: {incrementLabel: "加一"}, expected: "加一"}},
    {name: "Slider 滑块名", component: Slider, props: {modelValue: [10, 20]}, read: attr("[role=slider]", "aria-label"), zh: "滑块 1", en: "Slider 1", override: {props: {ariaLabel: "音量"}, expected: "音量"}},
    {name: "InfoTip 读屏名", component: InfoTip, props: {text: "说明文字"}, read: attr("button", "aria-label"), zh: "说明", en: "Info", override: {props: {label: "主题色说明"}, expected: "主题色说明"}},
    {name: "Notification 关闭按钮", component: Notification, props: {dismissible: true, message: "m"}, read: attr("button[aria-label]", "aria-label"), zh: "关闭通知", en: "Dismiss notification", override: {props: {closeLabel: "知道了"}, expected: "知道了"}},
    {name: "Notification 不确定进度", component: Notification, props: {message: "m", progress: null}, read: attr("[role=progressbar]", "aria-valuetext"), zh: "进行中", en: "In progress"},
    {name: "NotificationStack 关闭按钮", component: NotificationStack, props: {queue}, read: attr("button[aria-label]", "aria-label"), zh: "关闭通知", en: "Dismiss notification", override: {props: {closeLabel: "知道了"}, expected: "知道了"}},
    {name: "Dialog 页脚按钮", component: Dialog, props: {modelValue: true, showCancel: true, title: "标题"}, read: () => [...document.body.querySelectorAll("footer button")].map((node) => node.textContent?.trim()).join("|"), zh: "取消|确认", en: "Cancel|Confirm", override: {props: {cancelLabel: "算了", confirmLabel: "好的"}, expected: "算了|好的"}},
    {name: "Dialog 关闭按钮", component: Dialog, props: {modelValue: true, closable: true, title: "标题"}, read: attr("header button[aria-label]", "aria-label"), zh: "关闭", en: "Close", override: {props: {closeLabel: "收起"}, expected: "收起"}},
    {name: "Dialog 无标题时的名字", component: Dialog, props: {modelValue: true, title: ""}, read: text("[role=dialog] h2"), zh: "对话框", en: "Dialog"},
    {name: "Dialog 浮动窗口缩放手柄", component: Dialog, props: {modelValue: true, modal: false, resizable: true, teleportTarget: false, title: "窗口"}, read: attr("[data-dialog-resize='right']", "aria-label"), zh: "调整窗口宽度", en: "Resize window width"},
    {name: "AlertDialog 标题与按钮", component: AlertDialog, props: {open: true}, read: () => [text("[role=alertdialog] h2")(), ...[...document.body.querySelectorAll("[role=alertdialog] button")].map((node) => node.textContent?.trim() ?? "")].join("|"), zh: "确认操作|取消|确定", en: "Confirm action|Cancel|OK", override: {props: {title: "删除？", cancelLabel: "留着", confirmLabel: "删掉"}, expected: "删除？|留着|删掉"}},
    {name: "Splitter 分隔线名与取值文字", component: Splitter, props: {panels: [{id: "outline", defaultSizePx: 200, sizing: "fixed"}, {id: "editor", defaultSizePx: 300}]}, read: () => `${attr("[role=separator]", "aria-label")()}|${attr("[role=separator]", "aria-valuetext")()}`, zh: "调整 outline 与 editor 的宽度|200 像素", en: "Resize width between outline and editor|200 pixels"},
    {name: "ColorSwatches 读屏名", component: ColorSwatches, props: {modelValue: null, colors: ["#ff0000"]}, read: attr("[role=listbox]", "aria-label"), zh: "颜色", en: "Color", override: {props: {label: "主题色"}, expected: "主题色"}},
    {name: "SearchSelect 无匹配提示", component: SearchSelect, props: {modelValue: "", options: [{value: "a", label: "Alpha"}]}, read: text("[data-suggestion-menu-empty]"), zh: "没有匹配的选项", en: "No matching options", override: {props: {emptyText: "没有结果"}, expected: "没有结果"}},
];

async function mountCase(entry: Case, extra: Record<string, unknown>, port?: TextPort) {
    const wrapper = mount(entry.component, {
        props: {...entry.props, ...extra},
        attachTo: document.body,
        ...(port === undefined ? {} : {global: {provide: {[TEXT_PORT_KEY as symbol]: port}}}),
    });
    mounted.push(wrapper);
    if (entry.component === NotificationStack) queue.notify({message: "消息", duration: 0});
    if (entry.component === SearchSelect) {
        const field = wrapper.get("input");
        await field.setValue("zzz");
        await field.trigger("focus");
        await field.trigger("click");
    }
    await flushPromises();
    await nextTick();
    return wrapper;
}

describe("组件缺省文案走翻译端口", () => {
    for (const entry of CASES) {
        describe(entry.name, () => {
            it("没有宿主时是中文", async () => {
                await mountCase(entry, {});
                expect(entry.read()).toBe(entry.zh);
            });

            it("注入英文端口后是英文", async () => {
                await mountCase(entry, {}, makePort("en-US").port);
                expect(entry.read()).toBe(entry.en);
            });

            if (entry.override !== undefined) {
                it("显式传属性时以属性为准，与语言无关", async () => {
                    await mountCase(entry, entry.override!.props, makePort("en-US").port);
                    expect(entry.read()).toBe(entry.override!.expected);
                });
            }
        });
    }

    it("端口换语言后文案更新，组件不重新挂载", async () => {
        const {port, locale} = makePort("zh-CN");
        const wrapper = mount(Banner, {props: {dismissible: true, message: "m"}, attachTo: document.body, global: {provide: {[TEXT_PORT_KEY as symbol]: port}}});
        mounted.push(wrapper);
        const button = wrapper.get("button[aria-label]").element;
        expect(button.getAttribute("aria-label")).toBe("关闭");
        locale.value = "en-US";
        await nextTick();
        expect(wrapper.get("button[aria-label]").element).toBe(button);
        expect(button.getAttribute("aria-label")).toBe("Close");
        expect(button.getAttribute("title")).toBe("Close");
    });
});
