/** nb-ui 展示类（`display/`）与导航类（`navigation/`）的场景。 */

import type {Badge, Breadcrumb, CodeBlock, DiffView, EmptyState, Kbd, Progress, Skeleton, Spinner, Table, Tree} from "@notnotype/nb-ui/components";
import {h} from "vue";

import {Button as NbButton} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const CHAPTER_ROWS = [
    {title: "第一章 灯塔", words: 3182, status: "已定稿", updated: "10-02"},
    {title: "第二章 雾中城", words: 4410, status: "修改中", updated: "10-05"},
    {title: "第三章 巡夜人", words: 2876, status: "草稿", updated: "10-08"},
    {title: "第四章 一个非常长的章节标题，用来看单元格放不下时怎样截断或换行", words: 512, status: "草稿", updated: "10-10"},
];
type ChapterRow = (typeof CHAPTER_ROWS)[number];
/**
 * `Table` 是泛型组件（`generic="Row"`），场景的类型推导只认组件构造器：按章节行实例化它的 props，
 * 拼成同形状的构造器类型。props 仍取自组件本身，Table 改了签名这里一起变。
 */
type ChapterTable = new () => {$props: Parameters<typeof Table<ChapterRow>>[0]};
const CHAPTER_COLUMNS = [
    {key: "title" as const, label: "章节"},
    {key: "words" as const, label: "字数", width: "80px", align: "right" as const},
    {key: "status" as const, label: "状态", width: "80px"},
    {key: "updated" as const, label: "修改", width: "64px", align: "center" as const},
];

const TREE_ITEMS = [
    {id: "outline", title: "大纲", iconClass: "i-lucide-list-tree", children: [
        {id: "act-1", title: "第一幕：雾港", children: [{id: "scene-1", title: "灯塔熄灭"}, {id: "scene-2", title: "巡夜人"}]},
        {id: "act-2", title: "第二幕：雪线", children: [{id: "scene-3", title: "渡口", disabled: true}]},
    ]},
    {id: "characters", title: "人物", iconClass: "i-lucide-users", children: [{id: "shen-yu", title: "沈屿"}, {id: "lin-wan", title: "林晚"}]},
];

const DIFF_PROSE = {
    before: "雨越下越大，巷子里只剩下卖炭人的独轮车还在吱呀作响。\n陈砚推开药铺的后门时，天刚擦黑，他没有回头，只是把那包从城外带回来的干草放在门槛上，先听了听屋里的动静。\n巷口的灯灭了。",
    after: "雨越下越大，巷子里只剩下卖炭人的独轮车还在吱呀作响。\n陈砚推开药铺的后门时，天刚擦黑，他回头看了一眼，又很快转回去，把那包从城外带回来的干草放在门槛上，先听了听屋里的动静。\n巷口的灯灭了。",
};
const DIFF_PADDING = "柜台后面没有人，算盘却摆在正中，珠子停在一个他看不懂的数上，他盯着看了很久。".repeat(8);
const DIFF_LINES = Array.from({length: 40}, (_, index) => `第 ${index + 1} 段：夜里的雨一直没停。`);

export const displayFixtures: LabFixture[] = [
    defineSubjectFixture<typeof DiffView>({
        component: "DiffView",
        class: "w-full",
        writeBack: {"update:mode": {layer: "model", key: "mode"}},
        scenes: [
            {id: "prose", label: "一句话的改动", input: {model: {}, props: {label: "正文/第三章 雨夜.md", ...DIFF_PROSE}}},
            {id: "long", label: "没变的行收起", input: {model: {}, props: {label: "正文/第四章.md", before: DIFF_LINES.join("\n"), after: DIFF_LINES.map((line, index) => (index === 8 ? "第 9 段：雨停了。" : index === 30 ? `${line}他推开了门。` : line)).concat("新加的最后一段。").join("\n")}}},
            {id: "folded-chars", label: "一段之内折叠", input: {model: {}, props: {label: "正文/第五章.md", before: `${DIFF_PADDING}他没有回头。${DIFF_PADDING}`, after: `${DIFF_PADDING}他回头了。${DIFF_PADDING}`}}},
            {id: "split", label: "两栏（宽度不到 700 时退回行内）", input: {model: {mode: "split"}, props: {label: "正文/第三章 雨夜.md", before: DIFF_LINES.slice(0, 6).join("\n"), after: [DIFF_LINES[0]!, "新加的一段。", DIFF_LINES[1]!, "第 3 段：夜里的雨停了。", DIFF_LINES[3]!, DIFF_LINES[5]!].join("\n")}}},
            {id: "new-file", label: "新文件", input: {model: {}, props: {label: "设定/人物.md", before: "", after: "陈砚：药铺学徒。\n卖炭人：巷口的老人。"}}},
            {id: "unchanged", label: "没有改动", input: {model: {}, props: {before: "同一段文字。", after: "同一段文字。"}}},
            {id: "too-different", label: "太大的改动只标到行", input: {model: {}, props: {before: "甲乙丙丁".repeat(120), after: "子丑寅卯".repeat(120)}}},
        ],
        subject: nbUiSubject("DiffView"),
    }),
    defineSubjectFixture<typeof CodeBlock>({
        component: "CodeBlock",
        class: "w-full",
        scenes: [
            {id: "content", label: "带行号的文件内容", input: {props: {label: "正文/第三章 雨夜.md", startLine: 12, lines: [{text: "钟声敲到第十二下，"}, {text: "雨还没有停。"}, {text: "她把信折好，塞回了外套内侧的口袋。"}]}}},
            {id: "diff", label: "diff", input: {props: {label: "正文/第三章 雨夜.md", lines: [{text: "@@ -12,2 +12,2 @@", tone: "muted"}, {text: "钟声敲到第十一下，", tone: "removed"}, {text: "钟声敲到第十二下，", tone: "added"}, {text: "雨还没有停。"}]}}},
            {id: "long", label: "长行与截断", input: {props: {lines: Array.from({length: 30}, (_, index) => ({text: `${String(index + 1).padStart(2, "0")} ${"港口的雾从傍晚开始漫上来，先是码头，再是灯塔的基座。".repeat(3)}`})), truncated: true}}},
            {id: "empty", label: "空", input: {props: {lines: []}}},
        ],
        subject: nbUiSubject("CodeBlock"),
    }),
    defineSubjectFixture<typeof Badge>({
        component: "Badge",
        slotPresets: {default: () => "草稿"},
        scenes: [
            {id: "soft", label: "柔和", input: {props: {tone: "neutral", variant: "soft", size: "sm"}, slots: {default: true}}},
            {id: "accent", label: "强调、实心", input: {props: {tone: "accent", variant: "solid", size: "md"}, slots: {default: true}}},
            {id: "outline", label: "描边、带图标", input: {props: {tone: "success", variant: "outline", size: "sm", iconClass: "i-lucide-check"}, slots: {default: true}}},
            {id: "dot", label: "状态点", input: {props: {tone: "warning", variant: "soft", size: "sm", dot: true}, slots: {default: true}}},
            {id: "count", label: "计数", input: {props: {tone: "danger", variant: "solid", size: "sm", count: 128}, slots: {default: false}}},
        ],
        subject: nbUiSubject("Badge"),
    }),
    defineSubjectFixture<typeof EmptyState>({
        component: "EmptyState",
        class: "w-full",
        slotPresets: {action: () => h(NbButton, {size: "sm", iconClass: "i-lucide-plus"}, () => "新建作品")},
        scenes: [
            {id: "default", label: "图标、标题与操作", input: {props: {iconClass: "i-lucide-book-open", title: "书架上还没有作品", description: "新建一部作品，或把已有的目录加入书架。"}, slots: {action: true}}},
            {id: "plain", label: "只有说明", input: {props: {description: "没有匹配的结果"}, slots: {action: false}}},
        ],
        subject: nbUiSubject("EmptyState"),
    }),
    defineSubjectFixture<typeof Kbd>({
        component: "Kbd",
        slotPresets: {default: () => "Ctrl+Shift+P"},
        scenes: [
            {id: "md", label: "默认", input: {props: {size: "md"}, slots: {default: true}}},
            {id: "sm", label: "小号", input: {props: {size: "sm"}, slots: {default: true}}},
            {id: "lg", label: "大号", input: {props: {size: "lg"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Kbd"),
    }),
    defineSubjectFixture<typeof Progress>({
        component: "Progress",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "accent", label: "进行中", input: {props: {modelValue: 42, max: 100, tone: "accent", size: "md"}}},
            {id: "success", label: "完成", input: {props: {modelValue: 3000, max: 3000, tone: "success", size: "sm"}}},
            {id: "danger", label: "超出（危险色）", input: {props: {modelValue: 96, max: 100, tone: "danger", size: "lg"}}},
        ],
        subject: nbUiSubject("Progress"),
    }),
    defineSubjectFixture<typeof Skeleton>({
        component: "Skeleton",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "text", label: "一行文字", input: {props: {shape: "text", width: "80%"}}},
            {id: "block", label: "块", input: {props: {shape: "block", width: "100%", height: "120px"}}},
            {id: "circle", label: "圆", input: {props: {shape: "circle", width: "48px", height: "48px"}}},
        ],
        subject: nbUiSubject("Skeleton"),
    }),
    defineSubjectFixture<typeof Spinner>({
        component: "Spinner",
        scenes: [
            {id: "md", label: "默认", input: {props: {size: "md", label: "正在载入"}}},
            {id: "label", label: "显示文字", input: {props: {size: "sm", label: "正在载入章节", showLabel: true}}},
            {id: "lg", label: "大号", input: {props: {size: "lg", label: "正在载入"}}},
        ],
        subject: nbUiSubject("Spinner"),
    }),
    defineSubjectFixture<ChapterTable>({
        component: "Table",
        events: ["row-click"],
        class: "w-full",
        scenes: [
            {id: "default", label: "章节表", input: {props: {columns: CHAPTER_COLUMNS, rows: CHAPTER_ROWS, rowKey: "title", hoverable: true, density: "default"}}},
            {id: "compact", label: "紧凑", input: {props: {columns: CHAPTER_COLUMNS, rows: CHAPTER_ROWS, rowKey: "title", density: "compact"}}},
            {id: "loading", label: "加载中", input: {props: {columns: CHAPTER_COLUMNS, rows: [], loading: true}}},
            {id: "empty", label: "空表", input: {props: {columns: CHAPTER_COLUMNS, rows: [], emptyText: "这一卷还没有章节"}}},
        ],
        subject: nbUiSubject("Table"),
    }),
    defineSubjectFixture<typeof Breadcrumb>({
        component: "Breadcrumb",
        events: ["click"],
        scenes: [
            {id: "default", label: "三级", input: {props: {items: [{label: "长夜行", iconClass: "i-lucide-book"}, {label: "第二卷"}, {label: "第十七章 雪线", current: true}]}}},
            {id: "long", label: "很多级", input: {props: {items: ["manuscript", "第二卷", "上部", "雪线", "草稿", "第十七章 雪线（修订三）"].map((label, index, all) => ({label, current: index === all.length - 1}))}}},
        ],
        subject: nbUiSubject("Breadcrumb"),
    }),
    defineSubjectFixture<typeof Tree>({
        component: "Tree",
        events: ["select"],
        class: "h-full w-full",
        scenes: [
            {id: "card", label: "卡片面", input: {props: {items: TREE_ITEMS, surface: "card"}, model: {modelValue: "scene-2", expanded: ["outline", "act-1"]}}},
            {id: "plain", label: "平面、多选", input: {props: {items: TREE_ITEMS, surface: "plain", multiple: true}, model: {modelValue: ["shen-yu", "lin-wan"], expanded: ["characters"]}}},
            {id: "disabled", label: "禁用", input: {props: {items: TREE_ITEMS, surface: "card", disabled: true}, model: {modelValue: "act-1", expanded: ["outline"]}}},
        ],
        subject: nbUiSubject("Tree"),
    }),
];
