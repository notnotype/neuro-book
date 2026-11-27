import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type ImageInput from "nbook/plugins/canon/web/components/editing/ImageInput.vue";
import type FieldInput from "nbook/plugins/canon/web/components/editing/FieldInput.vue";
import type ElementDialog from "nbook/plugins/canon/web/components/editing/ElementDialog.vue";
import type ConfirmBar from "nbook/plugins/canon/web/components/editing/ConfirmBar.vue";
import type SuggestInput from "nbook/plugins/canon/web/components/editing/SuggestInput.vue";
import type RecordForm from "nbook/plugins/canon/web/components/editing/RecordForm.vue";

/** 改值的组件（docs/specs/canon/author-ui.md）：场景用星瑕样本里的样子手写。 */
function editingFixtures() {
    /** 条目选择器的场景只给占位的查找状态：夹具自己当宿主，按真实的去抖查找换掉它（`EntryPickerFixture.vue`）。 */
    const IDLE = {kind: "idle"} as const;
    return [
        defineLabFixture<typeof ImageInput>({
            component: "ImageInput",
            scenes: [
                {id: "empty", label: "未知", input: {props: {}, model: {modelValue: null}}},
                {id: "bad-path", label: "路径不合规则", input: {props: {}, model: {modelValue: {图片: "../外面/星瑕.png", 说明: ""}}}},
                {id: "bad-path-english", label: "英文界面", input: {props: {}, model: {modelValue: {图片: "/abs/star.png", 说明: "silver hair"}}}},
                {id: "picking", label: "作品里的图片：选了一张", input: {props: {}, model: {modelValue: {图片: "插图/星瑕-立绘.png", 说明: "银白长发"}}}},
                {id: "picking-uploading", label: "正在上传", input: {props: {}, model: {modelValue: null}}},
                {id: "picking-no-images", label: "图片文件夹还是空的", input: {props: {}, model: {modelValue: null}}},
                {id: "picking-english", label: "英文界面：作品里的图片", input: {props: {}, model: {modelValue: null}}},
            ],
            load: async () => (await import("./ImageInputFixture.vue")).default,
        }),
        defineLabFixture<typeof FieldInput>({
            component: "FieldInput",
            scenes: [
                {id: "number", label: "数，带单位", input: {props: {kind: "number" as const, label: "存款", unit: "元"}, model: {value: "1200"}}},
                {id: "enum", label: "选项", input: {props: {kind: "enum" as const, label: "态度", options: ["友好", "敌对", "中立"]}, model: {value: "敌对"}}},
                {id: "boolean", label: "是否", input: {props: {kind: "boolean" as const, label: "在场"}, model: {value: true}}},
                {id: "ref", label: "引用（条目选择器）", input: {props: {kind: "ref" as const, label: "对头", refName: "雾崎"}, model: {value: "e2"}}},
                {id: "image", label: "图片", input: {props: {kind: "image" as const, label: "画像"}, model: {value: {图片: "图片/星瑕.png", 说明: "入学那天"}}}},
                {id: "text", label: "文字", input: {props: {kind: "text" as const, label: "外观", rows: 3}, model: {value: "黑发，左眼下有一颗痣"}}},
            ],
            load: async () => (await import("./FieldInputFixture.vue")).default,
        }),
        defineLabFixture<typeof ElementDialog>({
            component: "ElementDialog",
            scenes: [
                {id: "add", label: "加一项：名字与数量", input: {props: {title: "给“物品”加一项", keyed: false, editing: false, keyResults: IDLE, fields: [{id: "数量", label: "数量", kind: "number" as const, unit: "把"}, {id: "来历", label: "来历", kind: "text" as const}], values: {数量: "", 来历: ""}, refResults: IDLE, intents: ["creative" as const, "story" as const]}, model: {open: true, label: "", keyValue: null, intent: "creative" as const}}},
                {id: "keyed", label: "以条目为键：选指向的知识点", input: {props: {title: "给“知情”加一项", keyed: true, editing: false, keyResults: IDLE, fields: [{id: "程度", label: "程度", kind: "enum" as const, options: ["知道", "怀疑", "不知道"]}], values: {程度: "怀疑"}, refResults: IDLE, intents: ["creative" as const]}, model: {open: true, label: "", keyValue: null, intent: "creative" as const}}},
                {id: "edit-semantic", label: "改一项：语义档只读，键不能换", input: {props: {title: "改“知情”的一项", keyed: true, editing: true, keyName: "学院的秘密", keyResults: IDLE, fields: [{id: "程度", label: "程度", kind: "enum" as const, options: ["知道", "怀疑", "不知道"]}, {id: "想法", label: "想法", kind: "text" as const, semantic: true}], values: {程度: "知道", 想法: "觉得校长在隐瞒什么"}, refResults: IDLE, intents: ["creative" as const, "story" as const]}, model: {open: true, label: "", keyValue: "k1", intent: "story" as const}}},
                {id: "failed", label: "内核拒收", input: {props: {title: "给“物品”加一项", keyed: false, editing: false, keyResults: IDLE, fields: [{id: "数量", label: "数量", kind: "number" as const}], values: {数量: "abc"}, refResults: IDLE, intents: ["creative" as const], error: "“数量”填得不对"}, model: {open: true, label: "盾", keyValue: null, intent: "creative" as const}}},
                {id: "add-english", label: "英文界面", input: {props: {title: "Add an item to “Items”", keyed: false, editing: false, keyResults: IDLE, fields: [{id: "count", label: "Count", kind: "number" as const}], values: {count: "2"}, refResults: IDLE, intents: ["creative" as const, "story" as const]}, model: {open: true, label: "Shield", keyValue: null, intent: "creative" as const}}},
            ],
            load: async () => (await import("./ElementDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof ConfirmBar>({
            component: "ConfirmBar",
            scenes: [
                {id: "number", label: "改一个数：预览写回哪里与带来的变化", input: {props: {label: "存款", kind: "number" as const, unit: "元", intents: ["creative" as const, "story" as const], preview: {route: "改第 2 章“领了打工的工资”那一笔", impact: ["少了 1 条待处理", "魔力跟着变成 3,000"]}}, model: {value: "2,800", intent: "creative" as const}}},
                {id: "unknown", label: "不确定有没有写进去", input: {props: {label: "存款", kind: "number" as const, intents: ["creative" as const], preview: {route: "改初值", impact: []}, error: "不确定这次改动有没有写进去", recheck: true}, model: {value: "800", intent: "creative" as const}}},
                {id: "inline-note", label: "就地改：选剧情里变了，多一行“发生了什么”", input: {props: {variant: "inline" as const, rows: 1, label: "年龄", kind: "text" as const, intents: ["creative" as const, "story" as const], intentLabels: {creative: "从最初起", story: "从第 3 章起"}, noteFallback: "年龄变成 十八", preview: {route: "在第 3 章末尾记一条变更", impact: []}}, model: {value: "十八", intent: "story" as const, note: ""}}},
                {id: "inline-passage", label: "就地改：成段的文字（Ctrl+回车保存），变化多于一条时收成“还有 N 项”", input: {props: {variant: "inline" as const, rows: 3, label: "性格", kind: "text" as const, intents: ["creative" as const, "story" as const], intentLabels: {creative: "从最初起", story: "从第 3 章起"}, noteFallback: "性格变了", preview: {route: "改最初的值", impact: ["少了 1 条待处理", "第 3 章那一笔跟着改", "第 5 章的核对要重新看"]}}, model: {value: "迟钝，情商不高，做事认真。嘴硬心软，其实很在意妹妹。", intent: "creative" as const, note: ""}}},
                {id: "inline-unknown", label: "就地改：不确定有没有写进去，“再查一次”在按钮那一行", input: {props: {label: "性别", kind: "suggest" as const, options: ["男", "女", "不明"], intents: ["creative" as const], error: "不确定这次改动有没有写进去", recheck: true, variant: "inline" as const}, model: {value: "女", intent: "creative" as const}}},
                {id: "inline-english", label: "就地改（英文界面）", input: {props: {label: "Savings", kind: "number" as const, unit: "", intents: ["creative" as const, "story" as const], preview: {route: "Changes the step “Got paid for the part-time job” in Chapter 2", impact: ["1 fewer pending", "Mana becomes 3,000", "Level becomes 4"]}, error: "This value just changed", variant: "inline" as const}, model: {value: "2,800", intent: "creative" as const}}},
            ],
            load: async () => (await import("./ConfirmBarFixture.vue")).default,
        }),
        defineLabFixture<typeof SuggestInput>({
            component: "SuggestInput",
            scenes: [
                {id: "empty", label: "空着：获得焦点时列出建议值", input: {props: {label: "性别", suggestions: ["男", "女", "不明"]}, model: {modelValue: ""}}},
                {id: "inline", label: "嵌在编辑卡里：列着全部，当前值打勾", input: {props: {label: "性别", suggestions: ["男", "女", "不明", "无"], inline: true}, model: {modelValue: "女"}}},
                {id: "inline-many", label: "嵌在编辑卡里、建议值多：列表在里面滚，方向键走到看不见的一项时滚到露出它", input: {props: {label: "身份", suggestions: ["学生", "教师", "医生", "护士", "警察", "律师", "厨师", "司机", "作家", "画家", "商人", "军人"], inline: true}, model: {modelValue: ""}}},
            ],
            load: async () => (await import("./SuggestInputFixture.vue")).default,
        }),
        defineLabFixture<typeof RecordForm>({
            component: "RecordForm",
            scenes: [
                {id: "exact", label: "精确档：一句话与变化量", input: {props: {}, model: {text: "领了工资", delta: "+3000"}}},
                {id: "semantic", label: "语义档：只有一句话", input: {props: {semantic: true}, model: {text: "白灵替她挡了一次", delta: ""}}},
                {id: "blocked", label: "初值上不能记", input: {props: {blockedReason: "先选一章"}, model: {text: "", delta: ""}}},
                {id: "failed", label: "上一次没记进去", input: {props: {error: "这个值刚刚变了"}, model: {text: "领了工资", delta: "+3000"}}},
                {id: "exact-english", label: "英文界面", input: {props: {}, model: {text: "", delta: ""}}},
            ],
            load: async () => (await import("./RecordFormFixture.vue")).default,
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...editingFixtures(),
];
