import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type EntryText from "nbook/plugins/canon/web/components/text/EntryText.vue";
import type {EntryTextBlock, EntryTextValue} from "nbook/plugins/canon/web/components/text/entry-text";
import type EntryRichInput from "nbook/plugins/canon/web/components/text/EntryRichInput.vue";
import type EntryTextEditor from "nbook/plugins/canon/web/components/text/EntryTextEditor.vue";
import type TextConflictDialog from "nbook/plugins/canon/web/components/text/TextConflictDialog.vue";
import type PlainSourceInput from "nbook/plugins/canon/web/components/text/PlainSourceInput.vue";

/** 一块：源文与值表；每项的起点按它的标签在源文里依次出现的位置算。 */
const valued = (id: string, source: string, items: ReadonlyArray<readonly [string, Record<string, unknown>]>): EntryTextBlock => {
    let cursor = 0;
    return {id, source, values: items.map(([tag, item]) => {
        const start = source.indexOf(tag, cursor);
        cursor = start + 1;
        return {tag: tag.slice(1).split(/[\s/>]/u)[0]!, start, ...item} as unknown as EntryTextValue;
    })};
};
const value = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, entry: null, label, raw: display, display, ...extra});
const blocks: EntryTextBlock[] = [
    valued("b1", '# 近况\n\n星瑕现在有 <V of="panel.存款" /> 元，魔力 <V of="panel.魔力" />，<If test="panel.存款 > 1000">交得起学费<Else />学费还差一截</If>。', [
        ['<V of="panel.存款"', value("panel.存款", "存款", "2,400")],
        ['<V of="panel.魔力"', value("panel.魔力", "魔力", "未知", {raw: null, unknown: true})],
        ["<If", {result: true, taken: 0}],
    ]),
    valued("b2", '她的另一个身份是 <Ref id="gege" />。**没人知道。**', [['<Ref id="gege"', {id: "gege", name: "哥哥", deleted: false}]]),
    {id: "b3", error: {message: "raw HTML or an HTML comment is not supported in entry text"}, text: "<div>坏掉的一块</div>"},
];
const marks = {"panel.存款": "第 3 章改过"};

/** 主文字的组件（docs/specs/canon/author-ui.md）：场景用星瑕样本里的样子手写。 */
export const fixtures: LabFixture[] = [
    defineLabFixture<typeof EntryText>({
        component: "EntryText",
        scenes: [
            {id: "sample", label: "值、改过、未知、引用、出错的块", input: {props: {blocks, self: "xingxia", marks}}},
            // 开着的是“哪一处”：第一块里存款那个标签（块 b1、起点 12）。
            {id: "open", label: "开着存款的来历：贴着值的浮层", input: {props: {blocks, self: "xingxia", marks, open: "b1@12#xingxia|panel.存款"}}},
            {id: "editable", label: "能改：右上“编辑”", input: {props: {blocks, self: "xingxia", marks, editable: true}}},
            {id: "empty", label: "还没有主文字：一行“写点什么…”，点了进编辑", input: {props: {blocks: [], self: "xingxia", editable: true}}},
            {id: "blocked", label: "写不了：入口不可用、悬停写原因", input: {props: {blocks, self: "xingxia", editable: true, editReason: "先不算计划"}}},
        ],
        load: async () => (await import("./EntryTextFixture.vue")).default,
    }),
    defineLabFixture<typeof EntryTextEditor>({
        component: "EntryTextEditor",
        scenes: (() => {
            const base = {problem: "", dirty: false, saved: "none" as const, phase: "idle" as const, submitBlocked: "", message: ""};
            const plain = "星瑕是个不怎么出门的数字游民，靠给各种工作室做外包维生。\n\n她的银白色长发是天生的。\n\n存款 <V of=\"panel.存款\" /> 联邦币。";
            const inserts = [{label: "面板 · 存款", snippet: "<V of=\"panel.存款\" />"}, {label: "面板 · 魔力", snippet: "<V of=\"panel.魔力\" />"}, {label: "人物 · 外观", snippet: "<V of=\"character.外观\" />"}];
            const branchy = `${plain}\n\n<If test="panel.魔力 >= 1000">还能变身。<Else />不够变身。</If>`;
            const rich = {mode: "rich" as const, showBranches: false};
            const source = {mode: "source" as const, showBranches: false};
            return [
                {id: "dirty", label: "富文本、改过：已暂存", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n新加的一段。`, inserts}, model: rich}},
                {id: "no-fields", label: "条目没有字段：“插入”里没有“值”", input: {props: {...base, text: plain}, model: rich}},
                {id: "branches", label: "有条件：出“显示全部分支”", input: {props: {...base, dirty: true, saved: "saved", text: branchy, inserts}, model: rich}},
                {id: "branches-all", label: "显示全部分支开着", input: {props: {...base, dirty: true, saved: "saved", text: branchy, inserts}, model: {mode: "rich" as const, showBranches: true}}},
                {id: "source", label: "源文字", input: {props: {...base, dirty: true, saved: "saved", text: plain, inserts}, model: source}},
                {id: "source-problem", label: "源文字写得不对：停顿后下面写第几行", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n魔力 <V of="panel.魔力"`, inserts}, model: source}},
                {id: "unreadable", label: "记下的是富文本、稿读不进去：这一次落在源文字，切换旁写原因", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n魔力 <V of="panel.魔力"`, inserts}, model: rich}},
                {id: "problem", label: "提交被拒收：原因在输入框下面", input: {props: {...base, dirty: true, saved: "saved", text: "存款 <V of=\"panel.存款\" 联邦币。", problem: "写得不对：<V is not a complete tag; finish it, or write \\< to keep it as text (1:4)", inserts}, model: source}},
                {id: "source-only", label: "没有富文本（只给源文字）：没有模式切换", input: {props: {...base, text: plain, inserts, sourceOnly: true} as never, model: rich}},
                {id: "not-saved", label: "暂存写不进去", input: {props: {...base, dirty: true, saved: "failed", text: plain, inserts}, model: rich}},
                {id: "diverged", label: "另一个窗口也在改：用这里的、换成那边的", input: {props: {...base, dirty: true, saved: "diverged", text: plain, inserts}, model: rich}},
                {id: "submitting", label: "正在提交：输入框只读", input: {props: {...base, dirty: true, saved: "saved", phase: "submitting", text: plain, inserts}, model: rich}},
                {id: "confirming", label: "上一次提交结果不明：正在确认，可以再试或放弃", input: {props: {...base, dirty: true, saved: "saved", phase: "confirming", text: plain, inserts}, model: rich}},
                {id: "blocked", label: "世界只读：提交不可用，原因写在那一行", input: {props: {...base, dirty: true, saved: "saved", submitBlocked: "世界是只读的：日志里有一行认不出的格式", text: plain, inserts}, model: rich}},
                {id: "message", label: "提交没发出去：整批的说明", input: {props: {...base, dirty: true, saved: "saved", message: "别处一直在改，稍后再提交", text: plain, inserts}, model: rich}},
                {id: "frozen", label: "开始编辑时的那一章没了：只能看与放弃", input: {props: {...base, dirty: true, saved: "saved", frozen: true, message: "开始编辑时的那一章已经不在了：复制要留的文字，然后放弃", text: "改过的文字，还能选中复制。", inserts}, model: rich}},
                {id: "diverged-english", label: "英文界面：另一个窗口也在改，提交被拦", input: {props: {...base, dirty: true, saved: "diverged", submitBlocked: "The world is read-only: a line in the log has an unknown format", message: "The saved draft could not be deleted; discard again once connected", text: "Xingxia rarely leaves her flat; she lives on contract work for small studios.", inserts: [{label: "Panel · Savings", snippet: "<V of=\"panel.存款\" />"}]}, model: rich}},
            ];
        })(),
        load: async () => (await import("./EntryTextEditorFixture.vue")).default,
    }),
    (() => {
        // 富文本输入框的样本：本条目三个字段、一段带取值、计算、条件、别的条目与引用的主文字，值表照内核的形状按标签起点给。
        const source = "## 现在\n\n魔力 <V of=\"panel.魔力\" />/<V of=\"panel.魔力上限\" />（＝<V expr=\"percent(panel.魔力, panel.魔力上限)\" />），<If test=\"panel.魔力 >= 1000\">还能变身，<V of=\"panel.魔力\" /> 够用。<Else />魔力不够变身。</If>\n\n- 存款 <V of=\"panel.存款\" /> 联邦币\n- 哥哥是 <Ref id=\"e2\" />，对她的好感度 <V entry=\"e2\" of=\"panel.好感度\" />\n\n> 引用里的 **强调** 与 `代码`，还有一个插件的 <StatusBar />。";
        const at = (needle: string, from = 0) => source.indexOf(needle, from);
        const ifAt = at("<If");
        const values = [
            {tag: "V", start: at("<V of=\"panel.魔力\" />"), path: "panel.魔力", raw: 1200, display: "1,200"},
            {tag: "V", start: at("<V of=\"panel.魔力上限\" />"), path: "panel.魔力上限", raw: 3000, display: "3,000"},
            {tag: "V", start: at("<V expr"), expr: "percent(panel.魔力, panel.魔力上限)", raw: 40, display: "40%"},
            {tag: "If", start: ifAt, result: true, taken: 0},
            {tag: "V", start: at("<V of=\"panel.魔力\" />", ifAt), path: "panel.魔力", raw: 1200, display: "1,200"},
            {tag: "V", start: at("<V of=\"panel.存款\" />"), path: "panel.存款", raw: 12345, display: "12,345"},
            {tag: "Ref", start: at("<Ref"), id: "e2", name: "星瑾", deleted: false},
            {tag: "V", start: at("<V entry"), entry: "e2", path: "panel.好感度", raw: 40, display: "40"},
            {tag: "StatusBar", start: at("<StatusBar"), needsPlugin: true},
        ] as unknown as EntryTextValue[];
        const fields = [
            {path: "panel.魔力", label: "魔力", group: "数值", display: "1,200"},
            {path: "panel.魔力上限", label: "魔力上限", group: "数值", display: "3,000"},
            {path: "panel.存款", label: "存款", group: "数值", display: "12,345"},
        ];
        const base = {label: "主文字", self: "e1", fields, marks: {"panel.存款": "第 3 章改过"}};
        return defineLabFixture<typeof EntryRichInput>({
            component: "EntryRichInput",
            scenes: [
                {id: "values", label: "值都到了：取值、计算、条件只画生效的一支、引用、别的条目、插件的标签", input: {props: {...base, values: {source, values}} as never, model: {modelValue: source}}},
                {id: "pending", label: "值还没回来：本条目的字段马上有值，别的是计算中", input: {props: base as never, model: {modelValue: source}}},
                {id: "uncomputed", label: "整篇太长不算：计算类的小块是没有算", input: {props: {...base, computing: false} as never, model: {modelValue: source}}},
                {id: "branches", label: "显示全部分支", input: {props: {...base, values: {source, values}, showBranches: true} as never, model: {modelValue: source}}},
                {id: "empty", label: "空的", input: {props: {label: "主文字"}, model: {modelValue: ""}}},
                {id: "readonly", label: "只读", input: {props: {...base, values: {source, values}, readonly: true} as never, model: {modelValue: source}}},
                {id: "text-english", label: "英文", input: {props: {label: "Main text"}, model: {modelValue: "A long English line that keeps going so that it has to wrap inside a narrow container, with <V of=\"panel.mana\" /> in the middle."}}},
            ],
            load: async () => (await import("./EntryRichInputFixture.vue")).default,
        });
    })(),
    defineLabFixture<typeof TextConflictDialog>({
        component: "TextConflictDialog",
        scenes: [
            {id: "mixed", label: "几条一起：两边都改了、我删了它别处改了、被别处删了、现在不能删", input: {props: {items: [
                {id: "b1", kind: "changed", mine: "她的银白色长发是染的。", theirs: "她的银白色长发是天生的，很少打理。", choice: "mine"},
                {id: "b2", kind: "changed", mine: null, theirs: "别处改过的一块。", choice: null},
                {id: "b3", kind: "gone", mine: "我改过、别处删掉的一块。", theirs: null, choice: null},
                {id: "b4", kind: "locked", mine: null, theirs: "现在被剧情改过的一块。", reason: "现在不能删这一块了", choice: "theirs"},
            ]}, model: {open: true}}},
            {id: "rerouted", label: "这一块现在是剧情里的文字：选我的就改那条剧情；拆过并过的只说明、回去整理", input: {props: {items: [
                {id: "b1", kind: "rerouted", mine: "我改的设定。", theirs: "第 2 章里变成的样子。", reason: "这一块现在是剧情里的文字", choice: null},
                {id: "b2", kind: "manual", mine: "拆出去一半以后剩下的前半。", theirs: "第 2 章里整块换掉的样子。", reason: "这一块拆过或并过，现在是剧情里的文字：回去整理以后再提交", choice: null},
            ]}, model: {open: true}}},
            {id: "busy", label: "正在提交", input: {props: {busy: true, items: [{id: "b1", kind: "changed", mine: "我的。", theirs: "现在的。", choice: "mine"}]}, model: {open: true}}},
            {id: "changed-english", label: "英文界面", input: {props: {items: [{id: "b1", kind: "changed", mine: "Her silver hair is dyed.", theirs: "Her silver hair is natural and rarely styled.", choice: null}, {id: "b2", kind: "gone", mine: "A block I edited.", theirs: null, choice: null}]}, model: {open: true}}},
        ],
        load: async () => (await import("./TextConflictDialogFixture.vue")).default,
    }),
    defineLabFixture<typeof PlainSourceInput>({
        component: "PlainSourceInput",
        scenes: [
            {id: "text", label: "两段文字", input: {props: {label: "第 1 块的源文字"}, model: {modelValue: "第一段。\n\n第二段，<V of=\"panel.存款\" /> 这样的表达式照写。"}}},
            {id: "readonly", label: "只读", input: {props: {label: "第 1 块的源文字", readonly: true}, model: {modelValue: "提交期间不能输入。"}}},
        ],
        load: async () => (await import("./PlainSourceInputFixture.vue")).default,
    }),
];
