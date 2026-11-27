import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type EntryTree from "nbook/plugins/canon/web/components/entries/EntryTree.vue";
import type EntryPicker from "nbook/plugins/canon/web/components/entries/EntryPicker.vue";
import type NewEntryDialog from "nbook/plugins/canon/web/components/entries/NewEntryDialog.vue";

/** 设定视图的组件（docs/specs/canon/author-ui.md）：场景用星瑕样本里的样子手写。 */
function entriesFixtures() {
    /** 条目选择器的场景只给占位的查找状态：夹具自己当宿主，按真实的去抖查找换掉它（`EntryPickerFixture.vue`）。 */
    const IDLE = {kind: "idle"} as const;
    return [
        defineLabFixture<typeof EntryPicker>({
            component: "EntryPicker",
            scenes: [
                {id: "empty", label: "没选：点开列出条目，打“小瑕”按别名找到星瑕", input: {props: {results: IDLE}, model: {modelValue: null}}},
                {id: "picked", label: "选了一个（当前值不在这一批结果里时显示给的名字）", input: {props: {results: IDLE, selectedName: "星瑕"}, model: {modelValue: "e1"}}},
                {id: "exclude", label: "已在列表里的灰掉", input: {props: {results: IDLE, exclude: ["e1", "e2"], excludeReason: "已在列表里"}, model: {modelValue: null}}},
                {id: "create", label: "可以就地新建知识点：打一个没有的名字", input: {props: {results: IDLE, createKind: "知识点"}, model: {modelValue: null}}},
                {id: "failed", label: "查找失败", input: {props: {results: IDLE}, model: {modelValue: null}}},
                {id: "picked-english", label: "英文界面", input: {props: {results: IDLE, selectedName: "星瑕", createKind: "知识点"}, model: {modelValue: "e1"}}},
            ],
            load: async () => (await import("./EntryPickerFixture.vue")).default,
        }),
        defineLabFixture<typeof NewEntryDialog>({
            component: "NewEntryDialog",
            scenes: (() => {
                const draft = {name: "", kind: "", kindChosen: "", folder: "", folderTouched: false, parent: null as string | null, types: [] as string[], typesTouched: false, sameAs: null as string | null, appears: null as string | null};
                // 种类的候选：登记的人物、组织、地点、物品在前，用过的“魔法”接在后面；点“人物”勾上人物与形象。
                const options = {kinds: ["人物", "组织", "地点", "物品", "魔法"], kindDefaults: {人物: ["nbook.canon.person", "nbook.canon.look"], 组织: [], 地点: [], 物品: []}, entries: [{id: "xingxia", name: "星瑕"}, {id: "academy", name: "第三魔法学院"}], items: [
                    {value: "nbook.canon.person", label: "人物", iconClass: "i-lucide-user-round", group: "canon" as const, kinds: ["人物"], present: false, restore: false},
                    {value: "nbook.canon.look", label: "形象", iconClass: "i-lucide-shirt", group: "canon" as const, kinds: ["人物"], present: false, restore: false},
                    {value: "nbook.canon.panel", label: "数值", iconClass: "i-lucide-gauge", group: "canon" as const, kinds: [], present: false, restore: false},
                    {value: "nbook.plot.knowing", label: "知道什么", iconClass: "i-lucide-key-round", group: "plot" as const, kinds: ["人物"], present: false, restore: false},
                    {value: "nbook.plot.attitude", label: "目标与态度", iconClass: "i-lucide-target", group: "plot" as const, kinds: ["人物"], present: false, restore: false},
                ], kindPresets: {人物: [{id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.look"]}, {id: "main", label: "主要角色", components: ["nbook.canon.person", "nbook.canon.look", "nbook.canon.panel", "nbook.plot.knowing", "nbook.plot.attitude"]}]}, chapters: [{id: "1", index: 1}, {id: "2", index: 2}]};
                return [
                    {id: "empty", label: "空的：名字为空时不能新建", input: {props: options, model: {open: true, draft}}},
                    {id: "filled", label: "在星瑕下面建一个物品，启用面板", input: {props: options, model: {open: true, draft: {...draft, name: "魔杖", kind: "物品", kindChosen: "物品", folder: "物品", parent: "xingxia", types: ["nbook.canon.panel"]}}}},
                    {id: "person", label: "新建人物：勾上人物与形象，有人物的预设", input: {props: options, model: {open: true, draft: {...draft, name: "星瑾", kind: "人物", kindChosen: "人物", folder: "人物", types: ["nbook.canon.person", "nbook.canon.look"]}}}},
                    {id: "failed", label: "没建成", input: {props: {...options, error: "这次改动没有成功"}, model: {open: true, draft: {...draft, name: "魔杖", kind: "物品", kindChosen: "物品", folder: "物品"}}}},
                    {id: "empty-english", label: "英文界面", input: {props: options, model: {open: true, draft}}},
                ];
            })(),
            load: async () => (await import("./NewEntryDialogFixture.vue")).default,
        }),
    ];
}

export const fixtures: LabFixture[] = [
    defineLabFixture<typeof EntryTree>({
        component: "EntryTree",
        scenes: (() => {
            const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({id, name, folder: "", hasChildren: false, appeared: true, deleted: false, ...extra});
            const layer = (items: ReturnType<typeof item>[], remaining = 0, loading = false) => ({items, remaining, loading});
            const root = layer([
                item("xingxia", "星瑕", {folder: "人物", hasChildren: true}),
                item("baling", "白灵", {folder: "人物"}),
                item("hui", "彗", {folder: "人物", appeared: false}),
                item("federation", "联邦"),
                item("academy", "第三魔法学院", {folder: "地点"}),
                item("old", "被删掉的旧设定", {folder: "地点", deleted: true, hasChildren: true}),
            ], 12);
            const xingxia = layer([item("gege", "哥哥", {appeared: false}), item("girl", "魔法少女星")], 0);
            const sample = {props: {layers: {"": root, xingxia}, selected: "gege"}, model: {expanded: ["folder:人物", "folder:地点", "xingxia"]}};
            return [
                {id: "sample", label: "分组、未出场、已删除、还有 12 项", input: sample},
                {id: "loading-layer", label: "展开了还没读到的一层", input: {props: {layers: {"": root}}, model: {expanded: ["folder:人物", "xingxia"]}}},
                {id: "loading", label: "根这一层还没读到", input: {props: {layers: {} as Record<string, ReturnType<typeof layer>>}, model: {expanded: []}}},
                {id: "empty", label: "还没有条目", input: {props: {layers: {"": layer([])}}, model: {expanded: []}}},
                {id: "empty-creatable", label: "空着、可以新建：新建人物与新建条目", input: {props: {layers: {"": layer([])}, creatable: true}, model: {expanded: []}}},
                {id: "empty-blocked", label: "空着、世界只读：按钮禁用", input: {props: {layers: {"": layer([])}, creatable: true, blockedReason: "世界只读：日志损坏"}, model: {expanded: []}}},
                {id: "empty-creatable-english", label: "空状态（英文界面）", input: {props: {layers: {"": layer([])}, creatable: true}, model: {expanded: []}}},
                {id: "disconnected", label: "世界已断开", input: {props: {...sample.props, disconnected: true}, model: sample.model}},
                {id: "sample-english", label: "英文界面", input: sample},
            ];
        })(),
        load: async () => (await import("./EntryTreeFixture.vue")).default,
    }),
    ...entriesFixtures(),
];
