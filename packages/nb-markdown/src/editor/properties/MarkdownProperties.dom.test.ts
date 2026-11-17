/**
 * MarkdownProperties（同名 .md；docs/specs/workbench/markdown-editing.md 输出 39–51）：收起与摘要、各类型的写回、添加改名移除、
 * 改类型、表示不了的属性与源码、写错、只读、键盘进出与结算。宿主用测试里的一层代替：收到 `commit` 就把新原文交回 `raw`，
 * 收到 `update:open` 就改 `open`。日期用真实的 nb-ui `DateInput`（reka-ui）在这里按键；日历与真实的焦点移动在 e2e（`markdown-properties.e2e.ts`）里测。
 */

import {flushPromises, mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick, ref} from "vue";

import type {PropertyDescription} from "./model";

import MarkdownProperties from "./MarkdownProperties.vue";

const SAMPLE = "---\n# 本章\n视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山]\n字数目标: 4000\n已定稿: false\n---\n";

interface Mounted {
    readonly wrapper: VueWrapper<InstanceType<typeof MarkdownProperties>>;
    readonly commits: string[];
    readonly opens: boolean[];
    readonly leaves: number[];
    raw(): string;
}

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function panel(raw: string, options: {open?: boolean; readonly?: boolean; describe?: (name: string) => PropertyDescription | null} = {}): Mounted {
    const commits: string[] = [];
    const opens: boolean[] = [];
    const leaves: number[] = [];
    const wrapper = mount(MarkdownProperties, {
        props: {
            raw,
            open: options.open ?? true,
            readonly: options.readonly ?? false,
            ...(options.describe === undefined ? {} : {describe: options.describe}),
            onCommit: (next: string) => {
                commits.push(next);
                void wrapper.setProps({raw: next});
            },
            "onUpdate:open": (open: boolean) => {
                opens.push(open);
                void wrapper.setProps({open});
            },
            onLeave: () => leaves.push(leaves.length),
        },
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return {wrapper, commits, opens, leaves, raw: () => wrapper.props("raw")};
}

/** 某个属性那一行里、名为 `label` 的输入。 */
const field = (wrapper: VueWrapper, label: string) => wrapper.get<HTMLInputElement>(`input[aria-label="${label}"]`);
const row = (wrapper: VueWrapper, name: string) => wrapper.get(`[data-property-name="${name}"]`);

/** 类型菜单：与用户从类型按钮按下方向键的路径一致（nb-ui `DropdownMenu.test.ts` 的做法）。 */
async function openKinds(line: ReturnType<typeof row>): Promise<void> {
    const trigger = line.get<HTMLButtonElement>("button.markdown-properties__type");
    trigger.element.focus();
    await trigger.trigger("keydown", {key: "ArrowDown"});
    await flushPromises();
}
const menuItems = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>("[role=menuitemradio]")];

async function typeInto(input: ReturnType<typeof field>, value: string): Promise<void> {
    input.element.focus();
    await input.setValue(value);
}

describe("收起与摘要（输出 40、41）", () => {
    it("收起时顶上一行是摘要；点它发 update:open，展开后每个属性一行，最后是“添加属性”", async () => {
        const {wrapper, opens} = panel(SAMPLE, {open: false});
        expect(wrapper.get("[data-property-summary]").text()).toBe("视角 林雪 · 时间 2025-12-21 · 地点 青石镇、北山 · 字数目标 4000 · 已定稿 否");
        expect(wrapper.find("[data-property-name]").exists()).toBe(false);
        await wrapper.get("button[aria-expanded]").trigger("click");
        expect(opens).toEqual([true]);
        expect(wrapper.findAll("[data-property-name]").map((item) => item.attributes("data-property-name"))).toEqual(["视角", "时间", "地点", "字数目标", "已定稿"]);
        expect(wrapper.text()).toContain("添加属性");
    });

    it("空值、表示不了的属性在摘要里只写名字；没有属性时没有摘要", () => {
        expect(panel("---\n甲:\n乙:\n  a: 1\n---\n", {open: false}).wrapper.get("[data-property-summary]").text()).toBe("甲 · 乙");
        expect(panel("---\n---\n", {open: false}).wrapper.get("[data-property-summary]").text()).toBe("");
    });
});

describe("改值（输出 42）", () => {
    it("文字回车写回，只换这一行；照字面会被读成别的值加引号；焦点离开同样写回", async () => {
        const {wrapper, commits} = panel(SAMPLE);
        await typeInto(field(wrapper, "视角"), "yes");
        expect(commits).toEqual([]);
        await field(wrapper, "视角").trigger("keydown", {key: "Enter"});
        expect(commits).toEqual([SAMPLE.replace("视角: 林雪", '视角: "yes"')]);
        await typeInto(field(wrapper, "视角"), "沈舟");
        await field(wrapper, "视角").trigger("focusout");
        // 原来带双引号（上一次写回加的）：保留双引号。
        expect(commits.at(-1)).toBe(SAMPLE.replace("视角: 林雪", '视角: "沈舟"'));
    });

    it("数字不是数时不写回、回到原值；清空写成空值", async () => {
        const {wrapper, commits, raw} = panel(SAMPLE);
        await typeInto(field(wrapper, "字数目标"), "四千");
        await field(wrapper, "字数目标").trigger("keydown", {key: "Enter"});
        expect(commits).toEqual([]);
        expect(field(wrapper, "字数目标").element.value).toBe("4000");
        await typeInto(field(wrapper, "字数目标"), "");
        await field(wrapper, "字数目标").trigger("keydown", {key: "Enter"});
        expect(raw()).toBe(SAMPLE.replace("字数目标: 4000", "字数目标:"));
        // 清空的数字仍按数字输入，不变回文字。
        expect(row(wrapper, "字数目标").get("[data-property-kind]").attributes("data-property-kind")).toBe("number");
    });

    it("勾选与列表立即写回：点勾选；列表里打一项回车", async () => {
        const {wrapper, raw} = panel(SAMPLE);
        await row(wrapper, "已定稿").get("button[role=checkbox], input[type=checkbox]").trigger("click");
        expect(raw()).toBe(SAMPLE.replace("已定稿: false", "已定稿: true"));
        const tag = row(wrapper, "地点").get<HTMLInputElement>("[data-property-kind=list] input");
        tag.element.focus();
        await tag.setValue("渡口");
        await tag.trigger("keydown", {key: "Enter"});
        expect(raw()).toBe(SAMPLE.replace("地点: [青石镇, 北山]", "地点: [青石镇, 北山, 渡口]").replace("已定稿: false", "已定稿: true"));
    });
});

describe("日期（输出 42）", () => {
    it("在年份那一段从头打 2026：中途不到 1000 年的不写回，打完写回一次，日期输入一直在", async () => {
        const {wrapper, commits} = panel("---\n时间: 2025-12-21\n---\n");
        const year = () => wrapper.find("[data-property-kind='date'] [data-reka-date-field-segment='year']");
        for (const key of ["2", "0", "2", "6"]) {
            expect(year().exists()).toBe(true);
            (year().element as HTMLElement).focus();
            await year().trigger("keydown", {key});
            await nextTick();
        }
        expect(commits).toEqual(["---\n时间: 2026-12-21\n---\n"]);
        expect(year().exists()).toBe(true);
    });
});

describe("添加、改名与移除（输出 47）", () => {
    it("添加：名字回车写回 `名字:`，焦点到它的值；同名时这一行留着并提示，不写回", async () => {
        const {wrapper, commits, raw} = panel(SAMPLE);
        await wrapper.get("button.markdown-properties__add").trigger("click");
        await nextTick();
        const name = field(wrapper, "属性名");
        expect(document.activeElement).toBe(name.element);
        await name.setValue("视角");
        await name.trigger("keydown", {key: "Enter"});
        expect(commits).toEqual([]);
        expect(wrapper.text()).toContain("已有同名属性");
        await field(wrapper, "属性名").setValue("天气");
        await field(wrapper, "属性名").trigger("keydown", {key: "Enter"});
        expect(raw()).toBe(SAMPLE.replace("已定稿: false\n", "已定稿: false\n天气:\n"));
        await nextTick();
        expect(document.activeElement).toBe(field(wrapper, "天气").element);
    });

    it("一个属性都没有时，新属性的名字空着按退格：这一行消失，发 leave（backspace）；有字时退格是删字", async () => {
        const {wrapper, leaves} = panel("---\n---\n");
        const vm = wrapper.vm as unknown as {focusNewName(): void};
        vm.focusNewName();
        await nextTick();
        await field(wrapper, "属性名").setValue("甲");
        await field(wrapper, "属性名").trigger("keydown", {key: "Backspace"});
        expect(leaves).toEqual([]);
        await field(wrapper, "属性名").setValue("");
        await field(wrapper, "属性名").trigger("keydown", {key: "Backspace"});
        expect(wrapper.emitted("leave")).toEqual([["backspace"]]);
        expect(wrapper.find("input[aria-label='属性名']").exists()).toBe(false);
    });

    it("改名：与别的属性同名时不写回、回到原名；移除删掉这一行，上方的注释留着", async () => {
        const {wrapper, commits, raw} = panel(SAMPLE);
        await typeInto(field(wrapper, "属性名：视角"), "时间");
        await field(wrapper, "属性名：视角").trigger("keydown", {key: "Enter"});
        expect(commits).toEqual([]);
        expect(field(wrapper, "属性名：视角").element.value).toBe("视角");
        await typeInto(field(wrapper, "属性名：视角"), "视点");
        await field(wrapper, "属性名：视角").trigger("keydown", {key: "Enter"});
        expect(raw()).toBe(SAMPLE.replace("视角: 林雪", "视点: 林雪"));
        await row(wrapper, "视点").get("button[title='移除属性 视点']").trigger("click");
        expect(raw()).toBe(SAMPLE.replace("视角: 林雪\n", ""));
    });
});

describe("改类型（输出 46）", () => {
    it("空值换成数字不写回，这一行按数字输入；有值的日期换不成文字", async () => {
        const {wrapper, commits} = panel("---\n甲:\n乙: 2025-12-21\n---\n");
        await openKinds(row(wrapper, "甲"));
        const items = menuItems();
        expect(items.map((item) => item.textContent?.trim())).toEqual(["文字", "数字", "勾选", "日期", "列表"]);
        items[1]?.focus();
        items[1]?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        items[1]?.click();
        await flushPromises();
        expect(commits).toEqual([]);
        expect(row(wrapper, "甲").get("[data-property-kind]").attributes("data-property-kind")).toBe("number");
        await openKinds(row(wrapper, "乙"));
        const dateItems = menuItems();
        expect(dateItems.filter((item) => item.hasAttribute("data-disabled")).map((item) => item.textContent?.trim())).toEqual(["文字", "数字", "勾选", "列表"]);
    });
});

describe("表示不了、源码与写错（输出 43–45）", () => {
    it("表示不了的一行只读、显示源码；点它的按钮打开源码，光标在这一项", async () => {
        const raw = "---\n视角: 林雪\n人物:\n  林雪: 姐妹\n---\n";
        const {wrapper} = panel(raw);
        expect(row(wrapper, "人物").get("[data-property-kind]").text()).toBe("林雪: 姐妹");
        expect(row(wrapper, "人物").get("[data-property-kind]").find("input").exists()).toBe(false);
        await row(wrapper, "人物").get("button[title='在源码里改 人物']").trigger("click");
        await nextTick();
        await nextTick();
        const area = wrapper.get<HTMLTextAreaElement>("textarea");
        // 末尾的换行不显示（写回时补上）。
        expect(area.element.value).toBe("视角: 林雪\n人物:\n  林雪: 姐妹");
        expect(document.activeElement).toBe(area.element);
        expect(area.element.selectionStart).toBe("视角: 林雪\n".length);
    });

    it("源码 Ctrl+Enter 写回，开栏与闭栏原样；有只写着 --- 的一行时不写回、说明原因，切回按属性显示就放弃", async () => {
        const raw = "---  \r\n视角: 林雪\r\n---\r\n";
        const {wrapper, commits} = panel(raw);
        await wrapper.get("button[aria-pressed]").trigger("click");
        const area = wrapper.get<HTMLTextAreaElement>("textarea");
        await area.setValue("视角: 沈舟\n");
        await area.trigger("keydown", {key: "Enter", ctrlKey: true});
        expect(commits).toEqual(["---  \r\n视角: 沈舟\r\n---\r\n"]);
        await wrapper.get<HTMLTextAreaElement>("textarea").setValue("视角: 沈舟\n---\n乙: 1\n");
        await wrapper.get("textarea").trigger("keydown", {key: "Enter", ctrlKey: true});
        expect(commits).toHaveLength(1);
        expect(wrapper.get("[role=alert]").text()).toContain("只写着 ---");
        expect((wrapper.vm as unknown as {pending: boolean}).pending).toBe(false);
        await wrapper.get("button[aria-pressed]").trigger("click");
        expect(wrapper.find("textarea").exists()).toBe(false);
        expect(field(wrapper, "视角").element.value).toBe("沈舟");
    });

    it("写错：收着也先展开，显示源码与出错的行号（不算开栏），不能切回；收起后摘要是出错提示；改好回到按属性显示", async () => {
        const {wrapper} = panel("---\n视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山\n---\n", {open: false});
        expect(wrapper.find("textarea").exists()).toBe(true);
        expect(wrapper.get("[role=alert]").text()).toContain("第 3 行");
        expect(wrapper.get(".markdown-properties__mirror-error").text()).toBe("地点: [青石镇, 北山");
        expect(wrapper.get("button[aria-pressed]").attributes("disabled")).toBeDefined();
        expect(wrapper.text()).not.toContain("添加属性");
        await wrapper.get("button[aria-expanded]").trigger("click");
        expect(wrapper.get(".markdown-properties__summary").text()).toBe("YAML 有误");
        await wrapper.get("button[aria-expanded]").trigger("click");
        await wrapper.get<HTMLTextAreaElement>("textarea").setValue("视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山]\n");
        await wrapper.get("textarea").trigger("focusout");
        expect(wrapper.find("textarea").exists()).toBe(false);
        expect(wrapper.findAll("[data-property-name]")).toHaveLength(3);
    });
});

describe("表示不了的属性与键盘、收起时看源码", () => {
    it("上下方向键经过表示不了的一行时停在它的“在源码里改”上", async () => {
        const {wrapper} = panel("---\n甲: 一\n乙:\n  a: 1\n丙: 三\n---\n");
        field(wrapper, "甲").element.focus();
        await field(wrapper, "甲").trigger("keydown", {key: "ArrowDown"});
        const source = row(wrapper, "乙").get<HTMLButtonElement>("button[title='在源码里改 乙']");
        expect(document.activeElement).toBe(source.element);
        await source.trigger("keydown", {key: "ArrowDown"});
        expect(document.activeElement).toBe(field(wrapper, "丙").element);
        await field(wrapper, "丙").trigger("keydown", {key: "ArrowUp"});
        expect(document.activeElement).toBe(source.element);
    });

    it("看着源码时收起，再点源码切换：展开并显示源码", async () => {
        const {wrapper, opens} = panel("---\n甲: 一\n---\n");
        await wrapper.get("button[aria-pressed]").trigger("click");
        expect(wrapper.find("textarea").exists()).toBe(true);
        await wrapper.get("button[aria-expanded]").trigger("click");
        expect(wrapper.find("textarea").exists()).toBe(false);
        await wrapper.get("button[aria-pressed]").trigger("click");
        expect(opens.at(-1)).toBe(true);
        expect(wrapper.find("textarea").exists()).toBe(true);
    });
});

describe("只读（输出 51）", () => {
    it("值只读，没有“添加属性”、“移除”与类型菜单，源码只读", async () => {
        const {wrapper} = panel(SAMPLE, {readonly: true});
        expect(field(wrapper, "视角").attributes("readonly")).toBeDefined();
        expect(wrapper.text()).not.toContain("添加属性");
        expect(wrapper.find("button[title^='移除属性']").exists()).toBe(false);
        expect(wrapper.find("button.markdown-properties__type").exists()).toBe(false);
        expect(wrapper.find("input[aria-label^='属性名']").exists()).toBe(false);
        await wrapper.get("button[aria-pressed]").trigger("click");
        expect(wrapper.get("textarea").attributes("readonly")).toBeDefined();
    });
});

describe("键盘与结算（输出 49、50）", () => {
    it("上下方向键在顶上一行、各属性的值与“添加属性”之间走；最后一个按下方向键、任何地方按 Esc 发 leave", async () => {
        const {wrapper, leaves} = panel("---\n甲: 一\n乙: 2\n---\n");
        const toggle = wrapper.get<HTMLButtonElement>("button[aria-expanded]");
        toggle.element.focus();
        await toggle.trigger("keydown", {key: "ArrowDown"});
        expect(document.activeElement).toBe(field(wrapper, "甲").element);
        await field(wrapper, "甲").trigger("keydown", {key: "ArrowDown"});
        expect(document.activeElement).toBe(field(wrapper, "乙").element);
        // 属性名上的方向键按它那一行算。
        field(wrapper, "属性名：乙").element.focus();
        await field(wrapper, "属性名：乙").trigger("keydown", {key: "ArrowUp"});
        expect(document.activeElement).toBe(field(wrapper, "甲").element);
        const add = wrapper.get<HTMLButtonElement>("button.markdown-properties__add");
        add.element.focus();
        await add.trigger("keydown", {key: "ArrowUp"});
        expect(document.activeElement).toBe(field(wrapper, "乙").element);
        await add.trigger("keydown", {key: "ArrowDown"});
        expect(leaves).toHaveLength(1);
        await field(wrapper, "甲").trigger("keydown", {key: "Escape"});
        expect(leaves).toHaveLength(2);
        (wrapper.vm as unknown as {focusLast(): void}).focusLast();
        expect(document.activeElement).toBe(add.element);
    });

    it("还没写回的输入是待交的：flush 同步写回；宿主换了原文时作废", async () => {
        const {wrapper, commits} = panel("---\n甲: 一\n---\n");
        const vm = wrapper.vm as unknown as {flush(): void; pending: boolean};
        await typeInto(field(wrapper, "甲"), "二");
        expect(vm.pending).toBe(true);
        vm.flush();
        expect(commits).toEqual(["---\n甲: 二\n---\n"]);
        expect(vm.pending).toBe(false);
        await nextTick();
        await typeInto(field(wrapper, "甲"), "三");
        await wrapper.setProps({raw: "---\n甲: 四\n---\n"});
        expect(vm.pending).toBe(false);
        expect(field(wrapper, "甲").element.value).toBe("四");
    });
});

describe("宿主给的图标、显示名与类型（输出 60）", () => {
    const RAW = "---\n视角: 林雪\n时间:\n字数目标:\n已定稿:\n标签:\n地点: 青石镇\n---\n";
    const locale = ref<"zh-CN" | "en-US">("zh-CN");
    // 语言切换的用例断言失败时也要还原，免得把英文留给后面的用例。
    afterEach(() => {
        locale.value = "zh-CN";
    });
    const declared: Readonly<Record<string, PropertyDescription>> = {
        视角: {icon: "i-lucide-eye", label: "叙述视角"},
        时间: {kind: "date"},
        字数目标: {kind: "number"},
        已定稿: {kind: "checkbox"},
        标签: {kind: "list", label: "标签"},
    };
    const describe = (name: string): PropertyDescription | null => {
        const found = declared[name];
        if (found === undefined) return null;
        // 显示名按界面语言取：在渲染里调用，语言变了面板跟着变。
        return name === "视角" ? {...found, label: locale.value === "zh-CN" ? "叙述视角" : "Point of view"} : found;
    };

    it("声明的图标换掉类型图标，按钮仍是改类型的菜单（当前类型打勾）；没有声明的行照旧", async () => {
        const {wrapper} = panel(RAW, {describe});
        expect(row(wrapper, "视角").find("button.markdown-properties__type .i-lucide-eye").exists()).toBe(true);
        expect(row(wrapper, "地点").find("button.markdown-properties__type .i-lucide-text").exists()).toBe(true);
        await openKinds(row(wrapper, "视角"));
        expect(menuItems().map((item) => [item.textContent?.trim(), item.getAttribute("aria-checked")])).toEqual([["文字", "true"], ["数字", "false"], ["勾选", "false"], ["日期", "false"], ["列表", "false"]]);
        // 按钮的名称写出当前类型，不写图标是什么。
        expect(row(wrapper, "视角").get("button.markdown-properties__type").attributes("aria-label")).toBe("类型：文字");
    });

    it("声明的类型不让类型菜单里别的项置灰：空值的行声明为日期，五种类型都能选", async () => {
        const {wrapper} = panel(RAW, {describe});
        await openKinds(row(wrapper, "时间"));
        expect(menuItems().map((item) => [item.textContent?.trim(), item.getAttribute("aria-checked"), item.getAttribute("aria-disabled")])).toEqual([["文字", "false", null], ["数字", "false", null], ["勾选", "false", null], ["日期", "true", null], ["列表", "false", null]]);
    });

    it("显示名换掉名字一列、摘要与输入的可访问名称；提示带真名；`data-property-name` 仍是真名", async () => {
        const {wrapper} = panel(RAW, {describe, open: false});
        expect(wrapper.get("[data-property-summary]").text()).toBe("叙述视角 林雪 · 时间 · 字数目标 · 已定稿 · 标签 · 地点 青石镇");
        await wrapper.get("button[aria-expanded]").trigger("click");
        const line = row(wrapper, "视角");
        expect(line.get(".markdown-properties__name").text()).toBe("叙述视角");
        expect(line.get(".markdown-properties__name").attributes("title")).toBe("叙述视角（视角）");
        expect(line.get<HTMLInputElement>('input[aria-label="叙述视角"]').element.value).toBe("林雪");
        expect(row(wrapper, "地点").get<HTMLInputElement>(".markdown-properties__name input").element.value).toBe("地点");
    });

    it("语言切换：显示名跟着变", async () => {
        const {wrapper} = panel(RAW, {describe});
        expect(row(wrapper, "视角").get(".markdown-properties__name").text()).toBe("叙述视角");
        locale.value = "en-US";
        await nextTick();
        expect(row(wrapper, "视角").get(".markdown-properties__name").text()).toBe("Point of view");
    });

    it("点显示名才变成输入框，输入框里是真名；改名写回的是真键，改好后没有声明的新名字显示它自己", async () => {
        const {wrapper, commits, raw} = panel(RAW, {describe});
        await row(wrapper, "视角").get("button.markdown-properties__name--label").trigger("click");
        await nextTick();
        const input = row(wrapper, "视角").get<HTMLInputElement>(".markdown-properties__name input");
        expect(input.element.value).toBe("视角");
        await typeInto(input, "视点");
        await input.trigger("keydown", {key: "Enter"});
        expect(commits).toHaveLength(1);
        expect(raw()).toBe("---\n视点: 林雪\n时间:\n字数目标:\n已定稿:\n标签:\n地点: 青石镇\n---\n");
        expect(row(wrapper, "视点").get<HTMLInputElement>(".markdown-properties__name input").element.value).toBe("视点");
    });

    it("显示名进每种输入的可访问名称，也进移除与“在源码里改”的提示", async () => {
        const named: Readonly<Record<string, PropertyDescription>> = {
            时间: {kind: "date", label: "发生时间"},
            标签: {kind: "list", label: "标签集"},
            已定稿: {kind: "checkbox", label: "是否定稿"},
            字数目标: {label: "目标字数"},
            嵌套: {label: "嵌套的"},
        };
        const {wrapper} = panel("---\n时间:\n标签:\n已定稿:\n字数目标: 4000\n嵌套:\n  a: 1\n---\n", {describe: (name) => named[name] ?? null});
        expect(row(wrapper, "时间").find('[aria-label="发生时间"]').exists()).toBe(true);
        expect(row(wrapper, "标签").find('[aria-label="标签集"]').exists()).toBe(true);
        expect(row(wrapper, "已定稿").findAll(".sr-only").map((item) => item.text())).toContain("是否定稿");
        expect(row(wrapper, "字数目标").find('input[aria-label="目标字数"]').exists()).toBe(true);
        expect(row(wrapper, "字数目标").get(".markdown-properties__remove").attributes("title")).toBe("移除属性 目标字数");
        expect(row(wrapper, "嵌套").find('[title="在源码里改 嵌套的"]').exists()).toBe(true);
    });

    it("有显示名的名字按钮：名称带真名，免得读屏听不出它对应哪个键", () => {
        const {wrapper} = panel(RAW, {describe});
        expect(row(wrapper, "视角").get("button.markdown-properties__name--label").attributes("aria-label")).toBe("叙述视角（视角）");
    });

    it("改成另一个有显示名的名字：这一行回到显示名按钮，焦点留在名字上", async () => {
        const named = (name: string): PropertyDescription | null => (name === "视角" ? {label: "叙述视角"} : name === "视点" ? {label: "视点L"} : null);
        const {wrapper, raw} = panel("---\n视角: 林雪\n---\n", {describe: named});
        await row(wrapper, "视角").get("button.markdown-properties__name--label").trigger("click");
        await nextTick();
        const input = row(wrapper, "视角").get<HTMLInputElement>(".markdown-properties__name input");
        await typeInto(input, "视点");
        await input.trigger("keydown", {key: "Enter"});
        await flushPromises();
        expect(raw()).toBe("---\n视点: 林雪\n---\n");
        const button = row(wrapper, "视点").get<HTMLButtonElement>("button.markdown-properties__name--label");
        expect(button.text()).toBe("视点L");
        expect(document.activeElement).toBe(button.element);
    });

    it("点了显示名、输入框里的字没改成别的就回车：不写回，回到显示名", async () => {
        const {wrapper, commits} = panel(RAW, {describe});
        await row(wrapper, "视角").get("button.markdown-properties__name--label").trigger("click");
        await nextTick();
        const input = row(wrapper, "视角").get<HTMLInputElement>(".markdown-properties__name input");
        await typeInto(input, "视角");
        await input.trigger("keydown", {key: "Enter"});
        await flushPromises();
        expect(commits).toEqual([]);
        expect(row(wrapper, "视角").find("button.markdown-properties__name--label").exists()).toBe(true);
    });

    it("点了显示名之后宿主换了原文（撤销、外部修改）：回到显示名，不留着输入框", async () => {
        const {wrapper} = panel(RAW, {describe});
        await row(wrapper, "视角").get("button.markdown-properties__name--label").trigger("click");
        await nextTick();
        expect(row(wrapper, "视角").find(".markdown-properties__name input").exists()).toBe(true);
        await wrapper.setProps({raw: RAW.replace("林雪", "苏晴")});
        expect(row(wrapper, "视角").find(".markdown-properties__name input").exists()).toBe(false);
        expect(row(wrapper, "视角").find("button.markdown-properties__name--label").exists()).toBe(true);
    });

    it("点显示名后什么也没改就离开：回到显示名，不写回", async () => {
        const {wrapper, commits} = panel(RAW, {describe});
        await row(wrapper, "视角").get("button.markdown-properties__name--label").trigger("click");
        await nextTick();
        const input = row(wrapper, "视角").get<HTMLInputElement>(".markdown-properties__name input");
        input.element.focus();
        input.element.blur();
        await flushPromises();
        expect(commits).toEqual([]);
        expect(row(wrapper, "视角").find("button.markdown-properties__name--label").exists()).toBe(true);
    });

    it("空值的行按声明的类型输入（日期、数字、勾选、列表），打开不改文件；输入后照常写回", async () => {
        const {wrapper, commits, raw} = panel(RAW, {describe});
        expect(commits).toEqual([]);
        expect(row(wrapper, "时间").find('[data-property-kind="date"] [data-reka-date-field-segment="year"]').exists()).toBe(true);
        expect(row(wrapper, "字数目标").get('[data-property-kind="number"] input').attributes("inputmode")).toBe("decimal");
        expect(row(wrapper, "已定稿").find('[data-property-kind="checkbox"] [role="checkbox"], [data-property-kind="checkbox"] input[type="checkbox"]').exists()).toBe(true);
        expect(row(wrapper, "标签").find('[data-property-kind="list"]').exists()).toBe(true);
        const number = field(wrapper, "字数目标");
        await typeInto(number, "4000");
        await number.trigger("keydown", {key: "Enter"});
        expect(raw()).toContain("字数目标: 4000\n");
        // 勾选：空值显示成不勾选，点了才写回。
        await row(wrapper, "已定稿").get('[data-property-kind="checkbox"]').find("label, [role=\"checkbox\"], input").trigger("click");
        expect(raw()).toContain("已定稿: true\n");
    });

    it("有值的行仍按值推断，声明的类型不改它也不报错；值与声明不符时照值显示", async () => {
        const {wrapper, commits} = panel("---\n视角: 林雪\n时间: 随便写写\n---\n", {describe: (name) => (name === "时间" || name === "视角" ? {kind: "date"} : null)});
        expect(row(wrapper, "视角").find('[data-property-kind="text"]').exists()).toBe(true);
        expect(row(wrapper, "时间").find('[data-property-kind="text"]').exists()).toBe(true);
        expect(commits).toEqual([]);
    });

    it("这次挂载里在类型菜单选过的类型盖过声明；表示不了的行的图标不换；只读时显示名照样出、不能点着改名", async () => {
        const {wrapper, commits} = panel("---\n时间:\n嵌套:\n  a: 1\n---\n", {describe: (name) => (name === "时间" ? {kind: "date"} : name === "嵌套" ? {icon: "i-lucide-eye", label: "嵌套的"} : null)});
        expect(row(wrapper, "时间").find('[data-property-kind="date"]').exists()).toBe(true);
        await openKinds(row(wrapper, "时间"));
        const text = menuItems().find((item) => item.textContent?.trim() === "文字");
        text?.click();
        await flushPromises();
        expect(row(wrapper, "时间").find('[data-property-kind="text"]').exists()).toBe(true);
        expect(commits).toEqual([]);
        expect(row(wrapper, "嵌套").find(".markdown-properties__type .i-lucide-braces").exists()).toBe(true);
        expect(row(wrapper, "嵌套").get(".markdown-properties__name").text()).toBe("嵌套的");
        const readonly = panel(RAW, {describe, readonly: true});
        expect(row(readonly.wrapper, "视角").get(".markdown-properties__name").text()).toBe("叙述视角");
        expect(row(readonly.wrapper, "视角").find("button.markdown-properties__name--label").exists()).toBe(false);
    });
});
