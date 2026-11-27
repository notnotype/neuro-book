import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type CharacterCard from "nbook/plugins/canon/web/components/groups/CharacterCard.vue";
import type LookCard from "nbook/plugins/canon/web/components/groups/LookCard.vue";
import type CanonImage from "nbook/plugins/canon/web/components/groups/CanonImage.vue";
import type OriginList from "nbook/plugins/canon/web/components/groups/OriginList.vue";
import type FieldTable from "nbook/plugins/canon/web/components/groups/FieldTable.vue";
import type PanelView from "nbook/plugins/canon/web/components/groups/PanelView.vue";
import type PlotList from "nbook/plugins/canon/web/components/groups/PlotList.vue";
import type ComponentAgentView from "nbook/plugins/canon/web/components/groups/ComponentAgentView.vue";
import type ComponentRawView from "nbook/plugins/canon/web/components/groups/ComponentRawView.vue";

/** 设定组的界面与看法（docs/specs/canon/author-ui.md）：场景用星瑕样本里的样子手写。 */
function groupsFixtures() {
    const origins = [
        {key: "p3", where: "第 3 章", what: "被扒手偷了", basis: {text: "估计：大概三百", estimate: true}, delta: "−300", result: "2,400 元", change: "c3"},
        {key: "k2", where: "第 2 章", what: "核对：正文写 2,800，对不上", result: "", check: "mismatch" as const},
        {key: "p2", where: "第 2 章", what: "领了打工的工资", basis: {text: "原文：“店长塞给她三千”", estimate: false}, delta: "+3,000", result: "2,700 元", change: "c2"},
        {key: "p1", where: "第 1 章", what: "交了学费", basis: {text: "作者给的", estimate: false}, delta: "−800", result: "−300 元", change: "c1"},
        {key: "init", where: "", what: "初值", result: "500 元"},
    ];
    const row = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, label, display, unknown: false, incomplete: false, mark: null as string | null, ...extra});
    const fields = [
        row("character.外观", "外观", "黑发，左眼下有颗痣", {mark: "前史改过"}),
        row("character.状态", "状态", "未知", {unknown: true}),
        row("character.态度", "现在的态度", "对学院长提防，对白灵信任", {mark: "第 2 章改过", notes: [{where: "第 1 章", text: "起点：谁也不信"}, {where: "第 2 章", text: "白灵替她挡了一次"}], notReduced: true}),
        row("panel.物品", "随身物品", "", {items: ["魔杖", "旧课本", "半块面包"], elementIds: ["i1", "i2", "i3"]}),
    ];
    const value = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, entry: null, label, raw: display, display, ...extra});
    const cards = [
        row("panel.存款", "存款", "2,400 元", {mark: "第 3 章改过"}),
        row("panel.魔力", "魔力", "3,110", {incomplete: true}),
        row("panel.物品", "随身物品", "", {items: ["魔杖", "旧课本"]}),
    ];
    const plot = [
        {id: "c4", where: "第 4 章", text: "她会离开学院", flags: ["plan" as const], patches: []},
        {id: "c3", where: "第 3 章", text: "被扒手偷了", flags: [] as ("plan" | "held" | "undone")[], patches: ["存款 −300"]},
        {id: "c2", where: "第 2 章", text: "领了打工的工资", flags: ["held" as const], patches: ["存款 +3,000"]},
        {id: "c1", where: "第 1 章", text: "交了学费", flags: ["undone" as const], patches: ["存款 −800", "状态 → 入学"]},
    ];
    return [
        defineLabFixture<typeof CharacterCard>({
            component: "CharacterCard",
            scenes: (() => {
                const facts = [
                    {id: "性别", label: "性别", text: "女"},
                    {id: "年龄", label: "年龄", text: "17 岁"},
                    {id: "身份", label: "身份", text: "隐退的魔法少女"},
                    {id: "所属", label: "所属", text: "对策委员会魔法少女部", link: true},
                    {id: "现在在哪", label: "现在在哪", text: "星家老宅", link: true, mark: "第 2 章改过"},
                    {id: "生死", label: "生死", text: "活着"},
                    {id: "种族", label: "种族", text: "人类", own: true},
                    {id: "喜好", label: "喜好", text: "甜食，尤其是妹妹做的布丁", own: true},
                ];
                const blank = facts.slice(0, 6).map(({mark: _mark, ...fact}) => ({...fact, text: null}));
                const condition = {id: "现在的状态", label: "现在的状态", text: "以哥哥的样子和妹妹同住，魔力还没恢复到能变身的程度", hint: "受伤、被通缉、刚搬家……此刻的处境", mark: "第 2 章改过"};
                const passages = [
                    {id: "性格", label: "性格", text: "迟钝，情商不高，做事认真。想对妹妹好，常常用错方法，过后才知道搞砸了。", hint: "遇事怎么反应，最在意什么"},
                    {id: "说话方式", label: "说话方式", text: null, hint: "口头禅、语气、对不同的人怎么称呼"},
                    {id: "背景", label: "背景", text: "六岁那年的城市大灾难里失去了父母。之后觉醒了时间系的天赋，被对策委员会带进魔法少女部，几年里成了蓝星最强；灾难平息后，官方给她安了罪名，她顺势隐退。", hint: "从哪里来，经历过什么"},
                ];
                const filled = {facts, condition, passages, portrait: {status: "image" as const, path: "插图/星瑕-立绘.png", alt: "星瑕的立绘"}, canAdd: true, presets: [{id: "生日", label: "生日"}, {id: "弱点", label: "弱点"}, {id: "动机", label: "动机"}, {id: "初次登场", label: "初次登场"}], removed: [{id: "身高", label: "身高"}]};
                const empty = {...filled, facts: blank, condition: {...condition, text: null}, passages: passages.map((passage) => ({...passage, text: null})), portrait: {status: "no-image" as const}, removed: []};
                return [
                    {id: "filled", label: "填好的人物", input: {props: filled, model: {addOpen: false}}},
                    {id: "empty", label: "刚新建的人物", input: {props: empty, model: {addOpen: false}}},
                    {id: "no-look", label: "没登记形象这一组：立绘那一格不画", input: {props: {...filled, portrait: {status: "unavailable" as const}}, model: {addOpen: false}}},
                    {id: "later-look", label: "所选位置上形象还没启用", input: {props: {...filled, portrait: {status: "later" as const, from: "第 3 章"}}, model: {addOpen: false}}},
                    {id: "add-field", label: "添加一项资料", input: {props: filled, model: {addOpen: true}}},
                    {id: "add-refused", label: "自己写的名字被拒", input: {props: {...filled, addError: "这一组里已经有叫“喜好”的一项"}, model: {addOpen: true}}},
                    {id: "condition-open", label: "现在的状态展开着", input: {props: {...filled, conditionOpen: true}, model: {addOpen: false}}},
                    {id: "blocked", label: "写不了：值按钮与“恢复形象”不可用", input: {props: {...filled, editReason: "先不算计划", portrait: {status: "removed" as const}}, model: {addOpen: false}}},
                    {id: "filled-english", label: "英文界面", input: {props: filled, model: {addOpen: false}}},
                ];
            })(),
            load: async () => (await import("./CharacterCardFixture.vue")).default,
        }),
        defineLabFixture<typeof LookCard>({
            component: "LookCard",
            scenes: (() => {
                const filled = {
                    portrait: {path: "插图/星瑕-立绘.png", alt: "淡金长发的少女侧身回头"},
                    appearance: {id: "外貌", label: "外貌", text: "淡金色长发及腰，浅灰蓝的眼睛，个子娇小。左手腕内侧有一道回溯留下的细痕。", hint: "发色、眼睛、体型，一眼认得出来的地方"},
                    wearing: {id: "现在穿的", label: "现在穿的", text: "哥哥的便装", mark: "第 2 章改过"},
                    outfits: [
                        {id: "i1", name: "哥哥的便装", look: "深灰连帽衫、牛仔裤，认知滤镜下看上去是个高个子男生", image: "插图/星瑕-便服.png", wearing: true},
                        {id: "i2", name: "学院制服", look: "第三魔法学院的冬季制服，藏青外套配格子裙", image: "插图/星瑕-学院制服.png", wearing: false},
                        {id: "i3", name: "睡衣", look: "妹妹挑的兔子睡衣，袖子长了一截", image: null, wearing: false},
                    ],
                };
                const empty = {portrait: null, appearance: {...filled.appearance, text: null}, wearing: {id: "现在穿的", label: "现在穿的", text: null}, outfits: []};
                return [
                    {id: "filled", label: "填好的形象", input: {props: filled}},
                    {id: "empty", label: "刚加上、还空着", input: {props: empty}},
                    {id: "blocked", label: "写不了", input: {props: {...filled, editReason: "先不算计划"}}},
                    {id: "filled-english", label: "英文界面", input: {props: filled}},
                ];
            })(),
            load: async () => (await import("./LookCardFixture.vue")).default,
        }),
        defineLabFixture<typeof CanonImage>({
            component: "CanonImage",
            scenes: [
                {id: "found", label: "读到了", input: {props: {path: "插图/星瑕-立绘.png", alt: "星瑕的立绘"}}},
                {id: "missing", label: "图片找不到", input: {props: {path: "插图/没有这张.png"}}},
                {id: "missing-english", label: "英文界面", input: {props: {path: "插图/没有这张.png"}}},
            ],
            load: async () => (await import("./CanonImageFixture.vue")).default,
        }),
        defineLabFixture<typeof OriginList>({
            component: "OriginList",
            scenes: [
                {id: "sample", label: "估计、核对对不上、初值", input: {props: {rows: origins, caption: "存款是怎么来的"}}},
                {id: "loading", label: "读取中", input: {props: {rows: [], loading: true}}},
                {id: "failed", label: "读取失败", input: {props: {rows: [], failed: true}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows: origins, remaining: 3}}},
            ],
            load: async () => (await import("./OriginListFixture.vue")).default,
        }),
        defineLabFixture<typeof FieldTable>({
            component: "FieldTable",
            scenes: [
                {id: "sample", label: "人物：改过、未知、语义档的各句、列表", input: {props: {rows: fields}}},
                {id: "open", label: "展开着一个字段", input: {props: {rows: fields, open: "character.外观"}}},
                {id: "editing", label: "能改：可改的行有“改”，列表的各项有改、去掉与添加", input: {props: {rows: fields, editing: true}}},
                {id: "empty", label: "没有字段", input: {props: {rows: []}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows: fields}}},
            ],
            load: async () => (await import("./FieldTableFixture.vue")).default,
        }),
        defineLabFixture<typeof PanelView>({
            component: "PanelView",
            scenes: [
                {id: "sample", label: "选中存款，旁边是流水", input: {props: {cards, selected: "panel.存款", ledger: origins, ledgerRemaining: 12}}},
                {id: "empty", label: "面板还没有内容", input: {props: {cards: []}}},
                // 能改：可改的卡右边有“改”，随身物品不能改、那一格空着；英文的 Edit 比“改”宽，看那一格是否放得下、各卡是否仍等宽。
                {id: "editing", label: "能改：可改的卡右边有“改”", input: {props: {cards: cards.map((card, index) => ({...card, editable: index !== 2})), selected: "panel.存款", ledger: origins, editing: true}}},
                {id: "editing-english", label: "能改（英文界面）", input: {props: {cards: cards.map((card, index) => ({...card, editable: index !== 2})), selected: "panel.存款", ledger: origins, editing: true}}},
            ],
            load: async () => (await import("./PanelViewFixture.vue")).default,
        }),
        defineLabFixture<typeof PlotList>({
            component: "PlotList",
            scenes: [
                {id: "sample", label: "计划、待定、已撤销与改动", input: {props: {rows: plot, remaining: 8}}},
                {id: "loading", label: "读取中", input: {props: {rows: [], loading: true}}},
                {id: "empty", label: "还没有情节", input: {props: {rows: []}}},
                {id: "sample-english", label: "英文界面", input: {props: {rows: plot}}},
            ],
            load: async () => (await import("./PlotListFixture.vue")).default,
        }),
        defineLabFixture<typeof ComponentAgentView>({
            component: "ComponentAgentView",
            scenes: [
                {id: "panel", label: "数值：给模型的那一节", input: {props: {position: "第 2 章末尾", text: "【数值】（设定组 panel，可以加字段）\n- 存款 = 900｜数｜单位 元\n- 魔力上限 = 3000｜数\n- 魔力 = 未知｜数（语义档：改起点或记一句）\n- 物品｜列表｜2 项\n  - [wand] 魔杖｜数量=1\n  - [cape] 斗篷｜数量=1"}}},
                {id: "long-line", label: "很长的一行折行", input: {props: {position: "最初", text: "【人物】（设定组 character）\n- 性格 = 黑发，左眼下有颗痣，平时话少，遇到和妹妹有关的事会突然变得很固执，打工的地方没人知道她是魔法少女，也没人知道她其实是男生变的｜文字"}}},
                {id: "loading", label: "设定组类型还在读", input: {props: {position: "第 2 章末尾", text: "", loading: true}}},
                {id: "failed", label: "设定组类型读失败", input: {props: {position: "第 2 章末尾", text: "", failed: "世界已断开"}}},
            ],
            load: async () => (await import("./ComponentAgentViewFixture.vue")).default,
        }),
        defineLabFixture<typeof ComponentRawView>({
            component: "ComponentRawView",
            scenes: (() => {
                const initial = {type: "nbook.canon.panel", version: 1, enabled: true, fields: {存款: 1000}, declared: [{id: "存款", label: "存款", kind: "number", unit: "元"}]};
                const step = (id: string, chapter: string, text: string, value: number) => ({id, kind: "written", text, at: {kind: "chapter", chapter, key: 10}, status: "active", patches: [{op: "add", at: {entry: "xingxia", path: "panel.存款"}, value}]});
                const changes = [step("c1", "1", "领了工资", 200), step("c2", "2", "买了书", -300)];
                return [
                    {id: "panel", label: "数值：初值与两条变更", input: {props: {initial, changes, total: 2, remaining: 0, initialLoading: false, changesLoading: false, failed: null}}},
                    {id: "more", label: "变更多于一页：再显示", input: {props: {initial, changes, total: 45, remaining: 43, initialLoading: false, changesLoading: false, failed: null}}},
                    {id: "added-by-change", label: "初值里没有、也没有变更", input: {props: {changes: [], total: 0, remaining: 0, initialLoading: false, changesLoading: false, failed: null}}},
                    {id: "loading", label: "读取中", input: {props: {changes: [], total: 0, remaining: 0, initialLoading: true, changesLoading: true, failed: null}}},
                    {id: "failed", label: "读失败", input: {props: {initial, changes, total: 2, remaining: 0, initialLoading: false, changesLoading: false, failed: "世界已断开"}}},
                ];
            })(),
            load: async () => (await import("./ComponentRawViewFixture.vue")).default,
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...groupsFixtures(),
];
