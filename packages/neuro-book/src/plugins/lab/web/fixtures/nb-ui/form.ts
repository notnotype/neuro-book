/**
 * nb-ui 表单类（`form/`）的场景。
 *
 * 日期与时间组件的值是 `@internationalized/date` 的对象，不是 JSON，进不了场景输入：这些场景从空值开始、
 * 当作非受控组件用，选出的值经 `update:modelValue` 记进事件页签。
 */

import type {
    Autocomplete,
    Calendar,
    CheckboxGroup,
    ColorPicker,
    Combobox,
    DateField,
    DatePicker,
    DateRangeField,
    DateRangePicker,
    FormCheckbox,
    FormField,
    FormInput,
    FormNumberInput,
    FormSelect,
    FormTextarea,
    Listbox,
    MonthPicker,
    MonthRangePicker,
    PinInput,
    RadioGroup,
    RangeCalendar,
    Slider,
    TagInput,
    TimeField,
    TimePicker,
    TimePickerDefault,
    TimeRangeField,
    YearPicker,
    YearRangePicker,
} from "@notnotype/nb-ui/components";
import {h} from "vue";

import {FormInput as NbFormInput} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const GENRES = [
    {value: "mystery", label: "悬疑", description: "推理、犯罪与解谜"},
    {value: "fantasy", label: "奇幻", description: "架空世界与魔法体系"},
    {value: "romance", label: "言情"},
    {value: "scifi", label: "科幻", disabled: true},
];
const SELECT_OPTIONS = [
    {value: "zh-CN", label: "简体中文", iconClass: "i-lucide-languages"},
    {value: "en-US", label: "English"},
    {value: "ja-JP", label: "日本語", description: "尚未完整翻译", disabled: true},
];
const CHARACTER_OPTIONS = ["沈屿", "林晚", "老港主", "灯塔看守", "无名船夫"].map((name) => ({value: name, label: name}));

/** 日期类组件的共同场景：空值、英文、只读、禁用。值不是 JSON，`model` 层留空，组件非受控。 */
function dateScenes(extra: {size?: "sm" | "md" | "lg"} = {}) {
    return [
        {id: "default", label: "空值（中文）", input: {props: {locale: "zh-CN", ...extra}, model: {}}},
        {id: "en", label: "英文", input: {props: {locale: "en-US", ...extra}, model: {}}},
        {id: "readonly", label: "只读", input: {props: {locale: "zh-CN", readonly: true, ...extra}, model: {}}},
        {id: "disabled", label: "禁用", input: {props: {locale: "zh-CN", disabled: true, ...extra}, model: {}}},
    ];
}

export const formFixtures: LabFixture[] = [
    defineSubjectFixture<typeof FormInput>({
        component: "FormInput",
        events: ["clear", "focus"],
        class: "w-full max-w-[360px]",
        slotPresets: {prefix: () => h("span", {class: "i-lucide-book-open shrink-0 text-[var(--text-muted)]", "aria-hidden": "true"})},
        scenes: [
            {id: "default", label: "默认", input: {props: {placeholder: "书名", size: "default"}, model: {modelValue: ""}}},
            {id: "search", label: "搜索、可清空", input: {props: {type: "search", placeholder: "搜组件名", iconClass: "i-lucide-search", clearable: true, size: "sm"}, model: {modelValue: "Tree"}}},
            {id: "password", label: "密码", input: {props: {type: "password", placeholder: "API Key"}, model: {modelValue: "sk-test"}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true}, model: {modelValue: "/home/writer/works/长夜行"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true, placeholder: "不可用"}, model: {modelValue: ""}}},
            {id: "prefix", label: "前缀插槽", input: {props: {placeholder: "书名"}, model: {modelValue: "长夜行"}, slots: {prefix: true}}},
        ],
        subject: nbUiSubject("FormInput"),
    }),
    defineSubjectFixture<typeof FormNumberInput>({
        component: "FormNumberInput",
        events: ["submit"],
        class: "w-full max-w-[200px]",
        scenes: [
            {id: "default", label: "字数目标", input: {props: {min: "0", max: "20000", step: "500", title: "每日字数目标"}, model: {modelValue: "3000"}}},
            {id: "small", label: "小号", input: {props: {size: "sm", min: "1", max: "10"}, model: {modelValue: "3"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: "12"}}},
        ],
        subject: nbUiSubject("FormNumberInput"),
    }),
    defineSubjectFixture<typeof FormTextarea>({
        component: "FormTextarea",
        class: "w-full max-w-[420px]",
        scenes: [
            {id: "default", label: "简介", input: {props: {placeholder: "一句话简介", rows: 4, maxlength: 200}, model: {modelValue: "港口城市终年大雾。巡夜人沈屿在灯塔熄灭的那一夜，捡到一封写给自己的信。"}}},
            {id: "empty", label: "空", input: {props: {placeholder: "一句话简介", rows: 3}, model: {modelValue: ""}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true, rows: 2}, model: {modelValue: "只读的长文本。"}}},
        ],
        subject: nbUiSubject("FormTextarea"),
    }),
    defineSubjectFixture<typeof FormSelect>({
        component: "FormSelect",
        events: ["focus"],
        class: "w-full max-w-[280px]",
        scenes: [
            {id: "default", label: "界面语言", input: {props: {options: SELECT_OPTIONS, placeholder: "选择语言"}, model: {modelValue: "zh-CN"}}},
            {id: "placeholder", label: "未选择", input: {props: {options: SELECT_OPTIONS, placeholder: "选择语言", size: "sm"}, model: {modelValue: ""}}},
            {id: "up", label: "向上展开", input: {props: {options: SELECT_OPTIONS, dropdownDirection: "up"}, model: {modelValue: "en-US"}}},
            {id: "disabled", label: "禁用", input: {props: {options: SELECT_OPTIONS, disabled: true}, model: {modelValue: "zh-CN"}}},
        ],
        subject: nbUiSubject("FormSelect"),
    }),
    defineSubjectFixture<typeof FormCheckbox>({
        component: "FormCheckbox",
        events: ["focus"],
        scenes: [
            {id: "checked", label: "已勾选", input: {props: {label: "显示清单文件", description: "内容文件夹里的 _manifest.json"}, model: {modelValue: true}}},
            {id: "unchecked", label: "未勾选", input: {props: {label: "显示隐藏文件"}, model: {modelValue: false}}},
            {id: "indeterminate", label: "部分", input: {props: {label: "全选本卷章节", indeterminate: true}, model: {modelValue: "indeterminate"}}},
            {id: "disabled", label: "禁用", input: {props: {label: "同步到云端", disabled: true}, model: {modelValue: false}}},
            {id: "no-label", label: "没有标签：显示勾选值", input: {props: {}, model: {modelValue: true}}},
        ],
        subject: nbUiSubject("FormCheckbox"),
    }),
    defineSubjectFixture<typeof FormField>({
        component: "FormField",
        class: "w-full max-w-[360px]",
        slotPresets: {default: () => h(NbFormInput, {modelValue: "长夜行", placeholder: "书名"})},
        scenes: [
            {id: "default", label: "标签与说明", input: {props: {label: "书名", description: "显示在书架与标题栏", required: true}, slots: {default: true}}},
            {id: "error", label: "错误", input: {props: {label: "作品目录", description: "作品文件放在这里", error: "目录不存在或没有写入权限"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("FormField"),
    }),
    defineSubjectFixture<typeof Autocomplete>({
        component: "Autocomplete",
        events: ["select"],
        class: "w-full max-w-[320px]",
        scenes: [
            {id: "default", label: "人物名", input: {props: {options: CHARACTER_OPTIONS, placeholder: "输入人物名"}, model: {modelValue: ""}}},
            {id: "typed", label: "已输入", input: {props: {options: CHARACTER_OPTIONS, placeholder: "输入人物名", size: "sm"}, model: {modelValue: "沈"}}},
            {id: "disabled", label: "禁用", input: {props: {options: CHARACTER_OPTIONS, disabled: true}, model: {modelValue: "林晚"}}},
        ],
        subject: nbUiSubject("Autocomplete"),
    }),
    defineSubjectFixture<typeof Combobox>({
        component: "Combobox",
        class: "w-full max-w-[320px]",
        scenes: [
            {id: "default", label: "可检索的选项", input: {props: {options: SELECT_OPTIONS, placeholder: "选择语言"}, model: {modelValue: "zh-CN"}}},
            {id: "strings", label: "纯字符串选项", input: {props: {options: ["第一卷", "第二卷", "第三卷"], placeholder: "选择卷", size: "sm"}, model: {modelValue: null}}},
            {id: "disabled", label: "禁用", input: {props: {options: SELECT_OPTIONS, disabled: true}, model: {modelValue: "en-US"}}},
        ],
        subject: nbUiSubject("Combobox"),
    }),
    defineSubjectFixture<typeof CheckboxGroup>({
        component: "CheckboxGroup",
        scenes: [
            {id: "vertical", label: "纵向", input: {props: {options: GENRES, orientation: "vertical"}, model: {modelValue: ["mystery"]}}},
            {id: "horizontal", label: "横向", input: {props: {options: GENRES, orientation: "horizontal"}, model: {modelValue: ["mystery", "romance"]}}},
            {id: "disabled", label: "禁用", input: {props: {options: GENRES, disabled: true}, model: {modelValue: ["fantasy"]}}},
        ],
        subject: nbUiSubject("CheckboxGroup"),
    }),
    defineSubjectFixture<typeof RadioGroup>({
        component: "RadioGroup",
        scenes: [
            {id: "vertical", label: "纵向、带说明", input: {props: {options: GENRES, orientation: "vertical", size: "md"}, model: {modelValue: "fantasy"}}},
            {id: "horizontal", label: "横向小号", input: {props: {options: GENRES, orientation: "horizontal", size: "sm"}, model: {modelValue: "mystery"}}},
            {id: "disabled", label: "禁用", input: {props: {options: GENRES, disabled: true}, model: {modelValue: "romance"}}},
        ],
        subject: nbUiSubject("RadioGroup"),
    }),
    defineSubjectFixture<typeof ColorPicker>({
        component: "ColorPicker",
        scenes: [
            {id: "default", label: "色板与输入", input: {props: {swatches: ["#8a3b2f", "#2f5d8a", "#3b7a57", "#b8860b", "#6b4f8a"], showInput: true, size: "md"}, model: {modelValue: "#2f5d8a"}}},
            {id: "small", label: "小号、无输入", input: {props: {showInput: false, size: "sm"}, model: {modelValue: "#8a3b2f"}}},
            {id: "readonly", label: "只读", input: {props: {readonly: true}, model: {modelValue: "#3b7a57"}}},
        ],
        subject: nbUiSubject("ColorPicker"),
    }),
    defineSubjectFixture<typeof Listbox>({
        component: "Listbox",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "default", label: "单选", input: {props: {options: GENRES, variant: "compact", size: "md"}, model: {modelValue: "mystery"}}},
            {id: "card", label: "卡片、多选与操作条", input: {props: {options: GENRES.map((genre, index) => (index === 0 ? {...genre, badge: "常用", badgeTone: "accent" as const} : genre)), variant: "card", multiple: true, showActionBar: true}, model: {modelValue: ["mystery", "romance"]}}},
            {id: "groups", label: "分组与筛选", input: {props: {groups: [{id: "main", label: "主要人物", options: CHARACTER_OPTIONS.slice(0, 2)}, {id: "minor", label: "次要人物", options: CHARACTER_OPTIONS.slice(2)}], showFilter: true, filterPlaceholder: "筛选人物"}, model: {modelValue: "沈屿"}}},
            {id: "disabled", label: "禁用", input: {props: {options: GENRES, variant: "compact", size: "md", disabled: true}, model: {modelValue: "mystery"}}},
        ],
        subject: nbUiSubject("Listbox"),
    }),
    defineSubjectFixture<typeof PinInput>({
        component: "PinInput",
        events: ["complete"],
        scenes: [
            {id: "default", label: "六位数字", input: {props: {length: 6, type: "number"}, model: {modelValue: []}}},
            {id: "masked", label: "遮蔽", input: {props: {length: 4, type: "number", mask: true}, model: {modelValue: ["1", "2"]}}},
            {id: "disabled", label: "禁用", input: {props: {length: 4, disabled: true}, model: {modelValue: ["9", "9", "9", "9"]}}},
        ],
        subject: nbUiSubject("PinInput"),
    }),
    defineSubjectFixture<typeof Slider>({
        component: "Slider",
        events: ["valueCommit"],
        class: "w-full max-w-[320px]",
        scenes: [
            {id: "single", label: "单值", input: {props: {min: 0, max: 100, step: 1, ariaLabel: "缩放", size: "md"}, model: {modelValue: 60}}},
            {id: "range", label: "区间", input: {props: {min: 0, max: 50, step: 1, ariaLabel: "章节范围"}, model: {modelValue: [8, 24]}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true, size: "sm"}, model: {modelValue: 30}}},
        ],
        subject: nbUiSubject("Slider"),
    }),
    defineSubjectFixture<typeof TagInput>({
        component: "TagInput",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "default", label: "标签", input: {props: {placeholder: "回车添加标签"}, model: {modelValue: ["伏笔", "第三卷"]}}},
            {id: "accent", label: "强调色、小号", input: {props: {tone: "accent", size: "sm", placeholder: "回车添加标签"}, model: {modelValue: ["主线"]}}},
            {id: "empty", label: "空", input: {props: {placeholder: "回车添加标签"}, model: {modelValue: []}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: ["不可改"]}}},
        ],
        subject: nbUiSubject("TagInput"),
    }),
    defineSubjectFixture<typeof TimePicker>({
        component: "TimePicker",
        scenes: [
            {id: "default", label: "时间", input: {props: {placeholder: "提醒时间", step: 15}, model: {modelValue: "21:30"}}},
            {id: "range", label: "限定范围", input: {props: {min: "08:00", max: "18:00", step: 30}, model: {modelValue: "09:00"}}},
            {id: "invalid", label: "不合法", input: {props: {invalid: true}, model: {modelValue: "25:00"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: "07:00"}}},
        ],
        subject: nbUiSubject("TimePicker"),
    }),
    defineSubjectFixture<typeof TimePickerDefault>({
        component: "TimePickerDefault",
        scenes: [
            {id: "default", label: "时间", input: {props: {placeholder: "提醒时间", step: 15}, model: {modelValue: "21:30"}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {modelValue: "08:00"}}},
        ],
        subject: nbUiSubject("TimePickerDefault"),
    }),
    defineSubjectFixture<typeof Calendar>({component: "Calendar", events: ["update:modelValue"], scenes: dateScenes(), subject: nbUiSubject("Calendar")}),
    defineSubjectFixture<typeof RangeCalendar>({component: "RangeCalendar", events: ["update:modelValue"], scenes: dateScenes(), subject: nbUiSubject("RangeCalendar")}),
    defineSubjectFixture<typeof DateField>({component: "DateField", events: ["update:modelValue"], scenes: dateScenes({size: "md"}), subject: nbUiSubject("DateField")}),
    defineSubjectFixture<typeof DatePicker>({component: "DatePicker", events: ["update:modelValue"], scenes: dateScenes({size: "md"}), subject: nbUiSubject("DatePicker")}),
    defineSubjectFixture<typeof DateRangeField>({component: "DateRangeField", events: ["update:modelValue"], scenes: dateScenes({size: "md"}), subject: nbUiSubject("DateRangeField")}),
    defineSubjectFixture<typeof DateRangePicker>({component: "DateRangePicker", events: ["update:modelValue"], scenes: dateScenes({size: "md"}), subject: nbUiSubject("DateRangePicker")}),
    defineSubjectFixture<typeof MonthPicker>({component: "MonthPicker", events: ["update:modelValue"], scenes: dateScenes(), subject: nbUiSubject("MonthPicker")}),
    defineSubjectFixture<typeof MonthRangePicker>({component: "MonthRangePicker", events: ["update:modelValue"], scenes: dateScenes(), subject: nbUiSubject("MonthRangePicker")}),
    defineSubjectFixture<typeof YearPicker>({component: "YearPicker", events: ["update:modelValue"], scenes: dateScenes(), subject: nbUiSubject("YearPicker")}),
    defineSubjectFixture<typeof YearRangePicker>({component: "YearRangePicker", events: ["update:modelValue"], scenes: dateScenes(), subject: nbUiSubject("YearRangePicker")}),
    defineSubjectFixture<typeof TimeField>({component: "TimeField", events: ["update:modelValue"], scenes: dateScenes({size: "md"}), subject: nbUiSubject("TimeField")}),
    defineSubjectFixture<typeof TimeRangeField>({component: "TimeRangeField", events: ["update:modelValue"], scenes: dateScenes({size: "md"}), subject: nbUiSubject("TimeRangeField")}),
];
