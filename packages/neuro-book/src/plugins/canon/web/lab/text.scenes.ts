import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type EntryText from "nbook/plugins/canon/web/components/text/EntryText.vue";
import type {EntryTextBlock, EntryTextValue} from "nbook/plugins/canon/web/components/text/entry-text";
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
            {id: "open", label: "展开着存款", input: {props: {blocks, self: "xingxia", marks, open: "xingxia|panel.存款"}}},
            {id: "editable", label: "能改：右上“编辑”", input: {props: {blocks, self: "xingxia", marks, editable: true}}},
            {id: "empty", label: "还没有主文字：开始写", input: {props: {blocks: [], self: "xingxia", editable: true}}},
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
            return [
                {id: "no-fields", label: "条目没有字段：不出“插入”", input: {props: {...base, text: plain}, model: {preview: false}}},
                {id: "dirty", label: "改过：已暂存", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n新加的一段。`, inserts}, model: {preview: false}}},
                {id: "not-saved", label: "暂存写不进去", input: {props: {...base, dirty: true, saved: "failed", text: plain, inserts}, model: {preview: false}}},
                {id: "diverged", label: "另一个窗口也在改：用这里的、换成那边的", input: {props: {...base, dirty: true, saved: "diverged", text: plain, inserts}, model: {preview: false}}},
                {id: "submitting", label: "正在提交：输入框只读", input: {props: {...base, dirty: true, saved: "saved", phase: "submitting", text: plain, inserts}, model: {preview: false}}},
                {id: "confirming", label: "上一次提交结果不明：正在确认，可以再试或放弃", input: {props: {...base, dirty: true, saved: "saved", phase: "confirming", text: plain, inserts}, model: {preview: false}}},
                {id: "blocked", label: "世界只读：提交不可用，原因写在那一行", input: {props: {...base, dirty: true, saved: "saved", submitBlocked: "世界是只读的：日志里有一行认不出的格式", text: plain, inserts}, model: {preview: false}}},
                {id: "message", label: "提交没发出去：整批的说明", input: {props: {...base, dirty: true, saved: "saved", message: "别处一直在改，稍后再提交", text: plain, inserts}, model: {preview: false}}},
                {id: "frozen", label: "开始编辑时的那一章没了：只能看与放弃", input: {props: {...base, dirty: true, saved: "saved", frozen: true, message: "开始编辑时的那一章已经不在了：复制要留的文字，然后放弃", text: "改过的文字，还能选中复制。", inserts}, model: {preview: false}}},
                {id: "preview", label: "预览开着：够宽时左右各半，窄处预览排在下面", input: {props: {...base, dirty: true, saved: "saved", text: `## 近况\n\n${plain}`, inserts}, model: {preview: true}}},
                {id: "preview-problem", label: "预览开着、写得不对：原因在输入框下面，栏顶上写行与原因，栏里是上一次的样子", input: {props: {...base, dirty: true, saved: "saved", text: `${plain}\n\n魔力 <V of="panel.魔力"`, problem: "写得不对：<V is not a complete tag; finish it, or write \\< to keep it as text (7:4)", previewNote: "第 7 行第 4 列写得不对：<V is not a complete tag; finish it, or write \\< to keep it as text", inserts}, model: {preview: true}}},
                {id: "preview-long", label: "预览开着、四十段：预览栏自己滚", input: {props: {...base, text: Array.from({length: 40}, (_, index) => `第 ${String(index + 1)} 段的文字，写得长一点好看出两栏各自折行以后的高度差多少。`).join("\n\n"), inserts}, model: {preview: true}}},
                {id: "diverged-english", label: "英文界面：另一个窗口也在改，提交被拦", input: {props: {...base, dirty: true, saved: "diverged", submitBlocked: "The world is read-only: a line in the log has an unknown format", message: "The saved draft could not be deleted; discard again once connected", text: "Xingxia rarely leaves her flat; she lives on contract work for small studios.", inserts: [{label: "Panel · Savings", snippet: "<V of=\"panel.存款\" />"}]}, model: {preview: false}}},
            ];
        })(),
        load: async () => (await import("./EntryTextEditorFixture.vue")).default,
    }),
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
