/**
 * Composer 编辑组件（docs/specs/ui/prompt-editor.md）一组组件的 Lab 场景：PromptEditor、PromptTextView 与它们共用的附件条、
 * 候选菜单、粘贴块外框。由旧应用的场景移植（分支 `archive/legacy-ui-tuning`，`865c9f593`），引用改用以 `/` 开头的作品根
 * 地址（开发者 2026-10-16 的决定 6）；保留一条旧应用的领域地址，看它按“其它”显示。
 */

import type {PromptAttachmentStrip, PromptEditor, PromptPasteFrame, PromptTextView} from "@notnotype/nb-markdown/prompt";

import type {LabInputOf} from "../../lab-subject";

type Scene<C> = {id: string; label: string; input: LabInputOf<C>};

/** 夹具里的假附件目标；`PROMPT_LAB_THUMBNAILS` 认得前两个。 */
export const PROMPT_LAB_TARGETS = {
    sketch: "session://attachments/草图.png",
    map: "session://attachments/地图.png",
    notes: "session://attachments/采访记录.pdf",
} as const;

const svg = (body: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>${body}</svg>`)}`;
const SKETCH_URL = svg("<rect width='120' height='120' fill='#e9e1d3'/><circle cx='38' cy='44' r='16' fill='#b8674a'/><circle cx='84' cy='70' r='20' fill='#4f6f8f'/>");

export const PROMPT_LAB_THUMBNAILS: Readonly<Record<string, string>> = {
    [PROMPT_LAB_TARGETS.sketch]: SKETCH_URL,
    [PROMPT_LAB_TARGETS.map]: svg("<rect width='120' height='120' fill='#d9e4dc'/><path d='M10 90 L45 40 L70 75 L110 25' stroke='#3f6b52' stroke-width='6' fill='none'/>"),
};

export const PROMPT_LAB_RECALL = [
    "把第三章的节奏再压一压，删掉重复的环境描写。",
    "这是一段会折成好几行的长消息：请通读第三章，把林默在钟表铺里等人的那一段改得更紧张一些，减少他对店内陈设的长篇观察，增加门外脚步声与座钟报时交错出现的细节，最后让学徒推门进来的时刻正好落在第十二下钟声上，并且保持第一人称视角不变。",
    "检查 [第二章 旧钟](/正文/第二章.md) 里时间线是否和设定冲突。\n重点看钟表铺开门的时间。",
    "/compact",
    "$writer 按大纲续写第四章开头，保持第一人称。",
];

const BASE = {
    locale: "zh-CN",
    placeholder: "输入消息，@ 引用，$ 技能，/ 命令",
    ariaLabel: "消息",
    triggers: ["@", "$", "/"],
    commands: ["plan", "compact", "clear", "rename"],
    acceptImages: true,
    acceptFiles: true,
    recall: PROMPT_LAB_RECALL,
    // 撑满画布：画布被拖成固定高度时编辑器跟着变高。“长文”与“展开、无外框”不撑满，看 minHeight、maxHeight 的夹取。
    fill: true,
} as const;

const draft = (text: string): {text: string; version: number} => ({text, version: 1});

export const PASTE_SAMPLE = [
    "function tick(clock) {",
    "    clock.seconds += 1;",
    "    if (clock.seconds === 60) {",
    "        clock.seconds = 0;",
    "        clock.minutes += 1;",
    "    }",
    "    return clock;",
    "}",
].join("\n");

const TOKENS_TEXT = [
    "/plan 先读 [第一章 雨夜](/正文/第一章.md) 和 [钟表铺](/设定/地点/钟表铺.md)，再用 $writer 改写 [[正文/第三章.md#L12-L40]]。",
    `参考图 ![image #1](${PROMPT_LAB_TARGETS.sketch}) 和 ![image #2](${PROMPT_LAB_TARGETS.map})，资料见 [file #1 · 采访记录.pdf](${PROMPT_LAB_TARGETS.notes})，外部链接 [写作手册](https://example.com/guide)。`,
    "旧应用写出的领域地址照常是引用小块：[第二章 旧钟](chapter://c2)；没有编号的图片：![旧截图.png](session://attachments/旧截图.png)",
].join("\n");

const LONG_TEXT = Array.from({length: 18}, (_, index) => `第 ${String(index + 1)} 段：雨还在下，钟表铺的门半开着，柜台后面的人一直没有抬头。`).join("\n");

export const promptEditorScenes: Array<Scene<typeof PromptEditor>> = [
    {id: "empty", label: "空", input: {props: {...BASE, draft: draft("")}}},
    {id: "tokens", label: "各种小块", input: {props: {...BASE, draft: draft(TOKENS_TEXT)}}},
    {id: "long", label: "长文：随内容长高到上限后滚动", input: {props: {...BASE, fill: false, draft: draft(LONG_TEXT)}}},
    {id: "readonly", label: "只读", input: {props: {...BASE, readonly: true, draft: draft(`${TOKENS_TEXT}\n<paste id="2">\n${PASTE_SAMPLE}\n</paste>`)}}},
    {id: "paste-inline", label: "粘贴块（原位）", input: {props: {...BASE, draft: draft(`下面这段计时代码有问题：\n<paste id="1">\n${PASTE_SAMPLE}\n</paste>\n帮我看看分钟进位。`)}}},
    {id: "paste-start", label: "粘贴块（放到开头）", input: {props: {...BASE, pastePolicy: {blockPlacement: "start"}, draft: draft(`<paste id="1">\n${PASTE_SAMPLE}\n</paste>\n看 [paste #1] 里分钟进位的写法。`)}}},
    {id: "paste-end", label: "以粘贴块结尾", input: {props: {...BASE, draft: draft(`这段为什么会跳秒？\n<paste id="1">\n${PASTE_SAMPLE}\n</paste>`)}}},
    {id: "no-files", label: "不收附件", input: {props: {...BASE, acceptImages: false, acceptFiles: false, draft: draft("")}}},
    {id: "expanded-bare", label: "展开、无外框", input: {props: {...BASE, fill: false, bare: true, enterSubmits: false, minHeight: 220, maxHeight: 420, draft: draft(LONG_TEXT)}}},
    {id: "menu-below", label: "菜单在下方", input: {props: {...BASE, menuPlacement: "below", draft: draft("")}}},
    {id: "english", label: "英文界面", input: {props: {...BASE, locale: "en-US", placeholder: "Message, @ to reference, $ for skills, / for commands", draft: draft(`看这段：\n<paste id="1">\n${PASTE_SAMPLE}\n</paste>`)}}},
];

export const promptAttachmentStripScenes: Array<Scene<typeof PromptAttachmentStrip>> = [
    {
        id: "states",
        label: "三种状态",
        input: {props: {highlighted: "image:1", cards: [
            {id: "a", hoverKey: "image:1", kind: "image", number: 1, name: "草图.png", state: "ready", thumbnail: SKETCH_URL},
            {id: "b", hoverKey: "image:2", kind: "image", number: 2, name: "地图.png", state: "uploading", thumbnail: null},
            {id: "c", hoverKey: "image:3", kind: "image", number: 3, name: "坏图.png", state: "failed", error: "文件超过 16 MB"},
            {id: "d", hoverKey: "file:1", kind: "file", number: 1, name: "采访记录.pdf", state: "ready", size: 284_000},
            {id: "e", hoverKey: "file:2", kind: "file", number: 2, name: "paste-2.txt", state: "uploading", size: 48_200, excerpt: {preview: "function tick(clock) {\n    clock.seconds += 1;", lines: 214}},
        ]}},
    },
    {
        id: "readonly",
        label: "只读",
        input: {props: {readonly: true, cards: [
            {id: "a", hoverKey: "image:1", kind: "image", number: 1, name: "草图.png", state: "ready", thumbnail: SKETCH_URL},
            {id: "d", hoverKey: "file:1", kind: "file", number: 1, name: "采访记录.pdf", state: "ready", size: 284_000},
        ]}},
    },
    {
        id: "overflow",
        label: "放不下时横向滚动",
        input: {props: {cards: Array.from({length: 12}, (_, index) => ({id: String(index), hoverKey: `image:${String(index + 1)}`, kind: "image" as const, number: index + 1, name: `图 ${String(index + 1)}.png`, state: "ready" as const, thumbnail: SKETCH_URL}))}},
    },
];

export const promptPasteFrameScenes: Array<Scene<typeof PromptPasteFrame>> = [
    {id: "collapsed", label: "收起", input: {props: {number: 2, content: PASTE_SAMPLE}, model: {expanded: false}}},
    {id: "expanded", label: "展开", input: {props: {number: 2, content: PASTE_SAMPLE}, model: {expanded: true}}},
    {id: "short", label: "不超过 3 行不折叠", input: {props: {number: 3, content: "第一行\n第二行"}, model: {expanded: false}}},
    {id: "highlighted", label: "与位置标记联动", input: {props: {number: 2, content: PASTE_SAMPLE, highlighted: true}, model: {expanded: false}}},
    {id: "invalid", label: "内容无效", input: {props: {number: 2, content: PASTE_SAMPLE, invalid: true}, model: {expanded: true}}},
];

const PASTE_TEXT = [
    "[paste #2] 是钟表铺的走时逻辑，第三章的报时要和它对得上。",
    "<paste id=\"2\">",
    PASTE_SAMPLE,
    "</paste>",
    "另外这段短的不折叠：",
    "<paste id=\"3\">",
    "滴答\n滴答",
    "</paste>",
].join("\n");

export const promptTextViewScenes: Array<Scene<typeof PromptTextView>> = [
    {id: "tokens", label: "各种小块与附件", input: {props: {locale: "zh-CN", text: TOKENS_TEXT}}},
    {id: "command", label: "开头是命令", input: {props: {locale: "zh-CN", text: TOKENS_TEXT, commands: ["plan"]}}},
    {id: "paste", label: "粘贴块与位置标记", input: {props: {locale: "zh-CN", text: PASTE_TEXT}}},
    {id: "plain", label: "只有文字与空行", input: {props: {locale: "zh-CN", text: "第一段。\n\n空了一行之后的第二段，带一个很长的英文单词 Supercalifragilisticexpialidocious-and-even-longer-without-any-space。"}}},
];
