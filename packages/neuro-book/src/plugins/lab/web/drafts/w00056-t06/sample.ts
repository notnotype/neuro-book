/**
 * 首页原型的样本（w00056 t06）：示例小说《灰塔制图师》的几份文件、工作台的视图清单与星璃的一段对话。
 * 文字是首页给第一次来的写作者看的，按成稿写，不放占位话。
 */
import type {AgentConversationContext, MessageView} from "@notnotype/nb-agent-ui";

import type {ViewCatalog} from "nbook/plugins/workbench/web/views/registry";

import {conversationContext} from "../../fixtures/nb-agent-ui/data";

export const BOOK_TITLE = "灰塔制图师";

/** 作品里的章节与设定：资源管理器与编辑器读写的是同一份内存文件。 */
export const CHAPTER_ONE = [
    "# 第一章 霜港的钟",
    "",
    "霜港的钟敲到第七下时，艾莉丝把那把没有齿的银钥匙藏进了袖口。",
    "",
    "钟声是从灰塔传下来的。三百年来，灰塔只在国王驾崩时敲钟，可今夜城里没有人披黑纱，码头上的灯一盏一盏还亮着。",
    "",
    "她站在制图坊的窗前，把还没干的海图卷起来。羊皮纸上，霜港的海岸线只画了一半，另一半是她明天要去量的。",
    "",
    "师傅说过，地图上空着的地方，比画满的地方更危险。那时她以为他在说海。",
    "",
    "楼下有人敲门，三下，停一停，再一下。这是师傅的敲法，可师傅失踪已经四十天了。",
    "",
].join("\n");

const CHAPTER_TWO = [
    "# 第二章 银钥匙",
    "",
    "守门人是在第四个雨夜之后出现的。他看不见，却准确地在她的门前停了下来。",
    "",
    "“这把钥匙开不了任何一扇门，”他说，“它开的是灰塔的第八层。”",
    "",
    "艾莉丝没有告诉他，灰塔只有七层。她量过，用的是师傅留下的那把铜尺。",
    "",
].join("\n");

const CHAPTER_THREE = [
    "# 第三章 灰塔",
    "",
    "塔门没有锁。门后的楼梯向上盘了七圈，第八圈的台阶是画上去的。",
    "",
].join("\n");

const CHAPTER_FOUR = [
    "# 第四章 雨夜",
    "",
    "雨连着下了四夜。守门人每晚都来，在门外站一会儿，不敲门，也不说话。",
    "",
].join("\n");

/** 第五章停住的那半句：第一幕打字前，演示指针挪到它的末尾旁边。 */
export const KNOCK_LEAD = "她正要吹灯，";

/**
 * 第五章停在半句上：第 4 轮原型的第一幕从这里接着写（`KNOCK_TYPED`），照星璃在对话里给的建议，只写到“三下”。
 * 第一章最后一段是同一声敲门，两章并排时正好对上。
 */
const CHAPTER_FIVE = [
    "# 第五章 第四下",
    "",
    "雨下到后半夜才停。艾莉丝把灰塔的剖面图摊在桌上，第八层的位置还是一片空白。",
    "",
    "铜尺压着图的一角。她量过很多遍，七层，一层不多。",
    "",
    KNOCK_LEAD,
].join("\n");

/** 第一幕第一拍在第五章末尾打出来的半句。 */
export const KNOCK_TYPED = "门外有人敲门，三下。她屏住气，等那第四下。";

const ALICE = [
    "# 艾莉丝",
    "",
    "- 霜港制图坊的学徒，十九岁",
    "- 左手执笔，右手拿尺",
    "- 第一章：收到一把没有齿的银钥匙",
    "- 第二章：从守门人那里听说灰塔有第八层",
    "",
].join("\n");

const KEEPER = [
    "# 守门人",
    "",
    "- 灰塔下的盲人，没人知道他守了多少年",
    "- 认得每个人的脚步声",
    "",
].join("\n");

const FROST_HARBOR = [
    "# 霜港",
    "",
    "北海岸的港城。灰塔立在城北的礁石上，钟只在国王驾崩时敲。",
    "",
].join("\n");

/** 第二幕“链到设定”那一拍链过去的一页（第 13 轮加；第一幕的作品树里没有它，见 `actTwoFiles`）。七层与第二幕粘贴的剖面图对得上。 */
const GRAY_TOWER = [
    "# 灰塔",
    "",
    "- 立在霜港城北的礁石上，三百年前制图坊建的测绘塔",
    "- 七层：门厅、灯油库、钟绳间、量具室、藏图室、观潮台、灯室",
    "- 塔顶的钟只在国王驾崩时敲（第一章）",
    "- 第八层只在银钥匙的说法里有（第二章），楼梯的第八圈是画上去的（第三章）",
    "",
].join("\n");

/**
 * 第二幕的第五章：第一幕那半句已经写完，又往下写了一段；正文上方带属性（视角、状态、出场），“章节属性”那一拍改它们。
 * 后两段里有“霜港”（注音）与“灰塔”（链到设定），“守门人”出场（属性里添上他）。
 */
const ACT_TWO_CHAPTER_FIVE = [
    "---",
    "视角: 艾莉丝",
    "状态: 初稿",
    "出场:",
    "  - 艾莉丝",
    "---",
    "# 第五章 第四下",
    "",
    "雨下到后半夜才停。艾莉丝把灰塔的剖面图摊在桌上，第八层的位置还是一片空白。",
    "",
    "铜尺压着图的一角。她量过很多遍，七层，一层不多。",
    "",
    `${KNOCK_LEAD}门外有人敲门，三下。她屏住气，等那第四下。`,
    "",
    "第四下一直没有响。门缝底下塞进来一张纸条，是守门人的字：霜港的钟，今夜停了。",
    "",
].join("\n");

/** 第五章与灰塔那一页在作品里的路径。 */
export const CHAPTER_FIVE_PATH = "正文/第五章 第四下.md";
export const GRAY_TOWER_PATH = "设定/灰塔.md";

/** 第二幕起头时作品里的文件：在首屏的那一份上换掉第五章、加上灰塔那一页。 */
export function actTwoFiles(files: ReadonlyArray<readonly [string, string]>): ReadonlyArray<readonly [string, string]> {
    const replaced = files.map(([path, text]): readonly [string, string] => (path === CHAPTER_FIVE_PATH ? [path, ACT_TWO_CHAPTER_FIVE] : [path, text]));
    return replaced.some(([path]) => path === GRAY_TOWER_PATH) ? replaced : [...replaced, [GRAY_TOWER_PATH, GRAY_TOWER]];
}

export const PROJECT_FILES: ReadonlyArray<readonly [string, string]> = [
    ["正文/第一章 霜港的钟.md", CHAPTER_ONE],
    ["正文/第二章 银钥匙.md", CHAPTER_TWO],
    ["正文/第三章 灰塔.md", CHAPTER_THREE],
    ["正文/第四章 雨夜.md", CHAPTER_FOUR],
    [CHAPTER_FIVE_PATH, CHAPTER_FIVE],
    ["设定/艾莉丝.md", ALICE],
    ["设定/守门人.md", KEEPER],
    ["设定/霜港.md", FROST_HARBOR],
];

/**
 * 首屏打开的几份。第 3 轮：第一章在前，第二章与艾莉丝的设定在后面（第一幕拿它们分栏、开浮窗）。
 * 第 4 轮：第五章在前，第一章与艾莉丝在后面（第一幕把第一章摊到右边对照、把艾莉丝拖成浮窗）。
 */
export const OPEN_FILES = {
    chapterOne: "project://正文/第一章 霜港的钟.md",
    chapterTwo: "project://正文/第二章 银钥匙.md",
    chapterFive: "project://正文/第五章 第四下.md",
    alice: "project://设定/艾莉丝.md",
} as const;

export type OpenFile = keyof typeof OPEN_FILES;

/**
 * 工作台的视图：资源管理器与设定在侧栏，星璃在右栏，任务在底部面板（同产品，任务不让区域显示，底部面板缺省收着）。
 * 每个视图是自己的隐式容器（`view:<id>`），活动栏一个容器一个入口。
 */
export const VIEWS = [
    {id: "explorer", label: "作品", icon: "i-lucide-files", location: "sidebar", order: 0},
    {id: "canon", label: "设定", icon: "i-lucide-book", location: "sidebar", order: 10},
    {id: "plot", label: "剧情", icon: "i-lucide-git-branch", location: "sidebar", order: 20},
    {id: "lyra", label: "星璃", icon: "i-lucide-sparkles", location: "auxiliarybar", order: 0},
    {id: "tasks", label: "任务", icon: "i-lucide-list-checks", location: "panel", order: 10},
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

/** 先后同产品：作品在前，设定、剧情跟着（各插件声明的 `order`）。 */
export const CATALOG: ViewCatalog = new Map(VIEWS.map(({id, label, icon, location, order}) => [id, {title: label, icon, location, order, layout: "fill" as const, ...(id === "tasks" ? {revealRegion: false} : {})}]));

/** 首屏桌子上侧栏与右栏的宽：产品的缺省按 1440 宽的整窗定（侧栏 340），首页的桌子只有一千来宽，照搬会把正文挤窄。 */
export const DESK_REGION_WIDTHS = {sidebar: 216, auxiliarybar: 296} as const;

/** 设定一节里的示例条目（世界引擎的条目页在第三幕讲，这里只列名字）。 */
export const CANON_GROUPS: ReadonlyArray<{readonly kind: string; readonly icon: string; readonly names: readonly string[]}> = [
    {kind: "人物", icon: "i-lucide-user-round", names: ["艾莉丝", "守门人", "师傅"]},
    {kind: "地点", icon: "i-lucide-map-pin", names: ["霜港", "灰塔", "制图坊"]},
    {kind: "物品", icon: "i-lucide-key-round", names: ["没有齿的银钥匙", "铜尺"]},
];

const T0 = Date.UTC(2026, 10, 26, 21, 0, 0);

/** 第 3 轮的对话：问第一章的敲门声能不能在第五章再用。 */
export const TOUR_MESSAGES: readonly MessageView[] = [
    {
        kind: "user", id: "hp-u1", timestamp: T0, intent: "normal", contentOmitted: false,
        blocks: [{kind: "text", text: "第一章最后那段敲门声，我想在第五章再用一次，会不会太刻意？"}],
    },
    // 先读第一章（过程），再回答（最终回复）：和真实会话一样分成两条，最终回复在整轮收起后仍露出来。
    {
        kind: "assistant", id: "hp-a1", timestamp: T0 + 4_000, status: "done", thinking: "", model: "deepseek-chat", contentOmitted: false, text: "",
        toolCalls: [{id: "hp-t1", name: "read", status: "success", args: {path: "project://正文/第一章 霜港的钟.md"}, result: {text: CHAPTER_ONE, truncated: false}}],
    },
    {
        kind: "assistant", id: "hp-a2", timestamp: T0 + 9_000, status: "done", thinking: "", model: "deepseek-chat", contentOmitted: false, toolCalls: [],
        text: "不会，前提是让读者自己认出来。第一章写的是师傅的敲法：三下，停一停，再一下。\n\n第五章可以只写到“三下”，停在那里，让艾莉丝等第四下。等不到，读者就知道门外不是他。",
    },
];

/**
 * 第 4 轮刚落地时的对话：聊的是第八层的线索，不提敲门（@designer 第 4 轮：落地就看到“第一章的敲法”是在剧透第一幕）。
 * 第一幕第一拍里作者打完那半句，再接着问敲门（`KNOCK_ASK`），星璃读了第一章再答（`KNOCK_READ`、`KNOCK_REPLY`）。
 */
export const KNOCK_MESSAGES: readonly MessageView[] = [
    {
        kind: "user", id: "hp-k-u0", timestamp: T0, intent: "normal", contentOmitted: false,
        blocks: [{kind: "text", text: "第八层的秘密，我想留到第十章再揭开。中间埋几处线索合适？"}],
    },
    {
        kind: "assistant", id: "hp-k-a0", timestamp: T0 + 6_000, status: "done", thinking: "", model: "deepseek-chat", contentOmitted: false, toolCalls: [],
        text: "两三处就够。第三章“画上去的台阶”算一处；第五章可以让她量塔的时候，多出一截对不上的影子。",
    },
];

export const KNOCK_ASK: MessageView = {
    kind: "user", id: "hp-k-u1", timestamp: T0 + 50_000, intent: "normal", contentOmitted: false,
    blocks: [{kind: "text", text: "第一章的敲门声，我在第五章又用了一次，会不会太刻意？"}],
};

export const KNOCK_READ: MessageView = {
    kind: "assistant", id: "hp-k-a1", timestamp: T0 + 53_000, status: "done", thinking: "", model: "deepseek-chat", contentOmitted: false, text: "",
    toolCalls: [{id: "hp-k-t1", name: "read", status: "success", args: {path: "project://正文/第一章 霜港的钟.md"}, result: {text: CHAPTER_ONE, truncated: false}}],
};

/** 星璃最后那条回复：边打边出（`status` 先是 `streaming`）。 */
export const KNOCK_REPLY_ID = "hp-k-a2";
export const KNOCK_REPLY = "不会，前提是让读者自己认出来。第一章师傅的敲法是：三下，停一停，再一下。\n\n这里只写到三下，读者会和她一起等第四下。把第一章摊开对照看看？";

export function knockReply(text: string, streaming: boolean): MessageView {
    return {kind: "assistant", id: KNOCK_REPLY_ID, timestamp: T0 + 56_000, status: streaming ? "streaming" : "done", thinking: "", model: "deepseek-chat", contentOmitted: false, toolCalls: [], text};
}

/** 星璃的对话：bot 档（顶栏是名字与头像，没有新建与会话列表），审批缺省每次询问。 */
export function lyraContext(avatar: string, messages: readonly MessageView[] = TOUR_MESSAGES): AgentConversationContext {
    const base = conversationContext();
    return {
        ...base,
        session: {...base.session!, id: "hp-lyra", title: "星璃", avatar, summary: "", profileName: "星璃"},
        interaction: {...base.interaction, canMutateHistory: false, canArchive: false, canRestore: false, canOpenTree: false, placement: "dock", canCreate: false, commands: ["compact", "plan", "mode"]},
        messages: [...messages],
        branches: {},
        history: {hasMore: false, loading: false, error: null},
        composer: {
            ...base.composer,
            modes: [
                {key: "normal", label: "普通", icon: "i-lucide-feather"},
                {key: "discuss", label: "讨论", icon: "i-lucide-messages-square"},
                {key: "plan", label: "计划", icon: "i-lucide-clipboard-list"},
            ],
            mode: "discuss",
            recall: [],
            // 和消息头上的模型对上（Lab 的缺省数据是另一个模型）。
            models: [{key: "deepseek-chat", label: "DeepSeek Chat", supportsImages: false}],
            modelKey: "deepseek-chat",
            approval: {
                options: [
                    {key: "ask", label: "每次询问", description: "除读取外，每次调用都需要批准（默认）", icon: "i-lucide-shield-question"},
                    {key: "allow-writes", label: "放行写入", description: "修改文件无需批准，运行命令仍需批准", icon: "i-lucide-pencil-line"},
                    {key: "yolo", label: "全部放行", description: "所有调用都无需批准，仅拒绝规则可拦截", icon: "i-lucide-triangle-alert", danger: true},
                ],
                value: "ask",
            },
        },
        now: T0 + 90_000,
    };
}
