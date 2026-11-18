/** Profile 设置页的样本：内置、用户级、缺必需工具、打包失败、后台各一个。 */

import type {ProfileApprovalField, ProfileModelField, ProfileToolCandidate, ProfileToolRow, ProfileToolsField, ProfileView} from "nbook/plugins/agent/web/profile-view";

const OPTIONS = [
    {value: "", label: "跟随默认", description: "主力"},
    {value: "role:main", label: "主力", description: "Claude Sonnet", iconClass: "i-lucide-layers"},
    {value: "role:fast", label: "快速", description: "DeepSeek Flash", iconClass: "i-lucide-layers"},
    {value: "role:tiny", label: "微型", description: "未绑定", iconClass: "i-lucide-layers"},
    {value: "anthropic/claude-sonnet", label: "Claude Sonnet", description: "Anthropic"},
    {value: "deepseek/deepseek-flash", label: "DeepSeek Flash", description: "DeepSeek"},
];
const model = (over: Partial<ProfileModelField> = {}): ProfileModelField => ({value: "", options: OPTIONS, disabled: false, hint: "跟随默认时用“主力”角色", warning: false, ...over});
const approval = (over: Partial<ProfileApprovalField> = {}): ProfileApprovalField => ({
    value: "default",
    options: [
        {value: "default", label: "跟随默认（每次询问）"},
        {value: "ask", label: "每次询问"},
        {value: "allow-writes", label: "放行写入"},
        {value: "auto", label: "自动判断"},
        {value: "yolo", label: "全部放行"},
    ],
    hint: "只影响新会话的初值，会话里还能切",
    ...over,
});

const row = (id: string, name: string, effect: "读" | "写" | "执行", summary: string, required = false): ProfileToolRow => ({id, name, effect, danger: effect === "执行", summary, detail: summary, required, gone: false});
const candidate = (base: ProfileToolRow, over: Partial<ProfileToolCandidate> = {}): ProfileToolCandidate => ({...base, providerName: base.name, blocked: false, ...over});
const CANDIDATES = [
    {id: "nbook.agent", provider: "内置", tools: [
        candidate(row("nbook.agent.edit", "edit", "写", "按行锚改文件，一次可以改几处。"), {replaces: "nbook.agent.edit-replace"}),
        candidate(row("nbook.agent.ask", "ask", "读", "向用户提问，只有固定选项。"), {replaces: "nbook.agent.ask-form"}),
    ]},
    {id: "nbook.plot", provider: "剧情图谱", tools: [candidate(row("plot.timeline", "plot_timeline", "读", "按时间线列出一段剧情里发生的事。"))]},
    {id: "nbook.canon", provider: "世界设定", tools: [candidate(row("canon.lookup", "canon_lookup", "读", "查世界设定条目与它的修订。"))]},
];
const WRITER_TOOLS: ProfileToolsField = {
    groups: [
        {id: "nbook.agent", provider: "内置", tools: [
            row("nbook.agent.read", "read", "读", "读取文件与目录，能看图片。", true),
            row("nbook.agent.write", "write", "写", "把内容整份写进文件：不存在就新建，存在就覆盖。", true),
            row("nbook.agent.grep", "grep", "读", "按正则在文件内容里搜索。", true),
            row("nbook.agent.edit-replace", "edit", "写", "把文件里的一段文字替换成新的。"),
            row("nbook.agent.ask-form", "ask", "读", "向用户提问，可以带选项或表单。"),
            row("nbook.agent.shell", "shell", "执行", "运行一条命令。"),
        ]},
        {id: "nbook.plot", provider: "剧情图谱", tools: [row("plot.search", "plot_search", "读", "在剧情图谱里查人物、事件与关系。")]},
        {id: "gone", provider: "已卸载", tools: [{...row("example.web.fetch", "example.web.fetch", "读", "没有找到这个工具，装上提供它的插件后恢复。"), effect: "", gone: true}]},
    ],
    count: 7,
    modified: true,
    candidates: CANDIDATES,
};
const LORE_TOOLS: ProfileToolsField = {
    groups: [
        {id: "nbook.agent", provider: "内置", tools: [row("nbook.agent.read", "read", "读", "读取文件与目录，能看图片。", true), row("nbook.agent.grep", "grep", "读", "按正则在文件内容里搜索。", true)]},
        {id: "nbook.plot", provider: "剧情图谱", tools: [row("plot.search", "plot_search", "读", "在剧情图谱里查人物、事件与关系。")]},
    ],
    count: 3,
    modified: false,
    candidates: [],
};
const MISSING_TOOLS: ProfileToolsField = {
    groups: [
        {id: "nbook.agent", provider: "内置", tools: [row("nbook.agent.read", "read", "读", "读取文件与目录，能看图片。")]},
        {id: "gone", provider: "已卸载", tools: [{...row("plot.search", "plot.search", "读", "没有找到这个工具，装上提供它的插件后恢复。", true), effect: "", gone: true}]},
    ],
    count: 1,
    modified: false,
    candidates: CANDIDATES,
};
/** “可派的子代理”一行：`effect` 一列写“推荐”“我加的”。 */
const agentRow = (id: string, name: string, effect: string, summary: string, gone = false): ProfileToolRow => ({id, name, effect, danger: false, summary, detail: summary, required: false, gone});
/** 主创的“可派的子代理”（w00032 t14）：声明推荐的临时帮手、用户加的设定核对、一个已删除的。 */
const WRITER_AGENTS: ProfileToolsField = {
    groups: [
        {id: "nbook.agent", provider: "内置", tools: [agentRow("nbook.agent.adhoc", "临时帮手", "推荐", "按派它的 Agent 写的角色做一件事：读、查、写都行，做完把结果交回。")]},
        {id: "user", provider: "我的 Profile", tools: [agentRow("user.lore-check", "设定核对", "我加的", "只读全书，找设定与前文的矛盾，列出来但不改。")]},
        {id: "gone", provider: "已删除或不可用", tools: [agentRow("user.old-review", "user.old-review", "我加的", "已删除或不可用", true)]},
    ],
    count: 3,
    modified: true,
    candidates: [{id: "plot", provider: "剧情图谱", tools: [{...agentRow("plot.qa", "剧情问答", "", "回答关于这本书剧情的问题，答案带出处。"), providerName: "plot.qa", blocked: false}]}],
};
/** 主创的“Skill”一节（w00032 t15）：声明“全部”，列出目录里的全部 Skill，一个未初始化；用户去掉的收在“已去掉”，能加回。 */
const WRITER_SKILLS: ProfileToolsField = {
    groups: [
        {id: "user", provider: "我的 Skill", tools: [
            agentRow("user.style-guide", "style-guide", "", "按本书的文风规则改写一段：人称、时态、对白格式与禁用词"),
            agentRow("user.epub-export", "epub-export", "未初始化", "把选中的章节导成 EPUB，带目录、封面与脚注"),
            agentRow("user.lore-check", "lore-check", "", "对照人物卡与设定集，找出正文里前后矛盾的地方"),
        ]},
        {id: "builtin", provider: "内置", tools: [agentRow("builtin.chapter-summary", "chapter-summary", "", "给一章写三五句提要")]},
        {id: "removed", provider: "已去掉", tools: [{...agentRow("user.tts-preview", "tts-preview", "", "用本机的语音合成朗读选中的一段"), restorable: true}]},
    ],
    count: 4,
    modified: true,
    candidates: [{id: "user", provider: "我的 Skill", tools: [{...agentRow("user.tts-preview", "tts-preview", "", "用本机的语音合成朗读选中的一段"), providerName: "user.tts-preview", blocked: false}]}],
};
/** 表情包的缩略图：一块带字的色块（SVG）。 */
const stickerThumb = (label: string, color: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" fill="${color}"/><text x="24" y="31" font-size="18" text-anchor="middle" fill="white">${label}</text></svg>`)}`;
/** 写作助手的“表情包”一节：我加了星璃的，插件带来一个，一个被去掉。 */
const WRITER_STICKERS: ProfileToolsField = {
    groups: [
        {id: "user", provider: "我的表情包", tools: [{...agentRow("user.lyra", "星璃", "我加的", "12 个表情 · 星璃的日常表情"), thumbnail: stickerThumb("璃", "#ea76cb")}]},
        {id: "plugin:acme.cute", provider: "可爱表情", tools: [{...agentRow("acme.cute.cats", "猫猫", "", "40 个表情 · 各种猫"), thumbnail: stickerThumb("喵", "#df8e1d")}]},
        {id: "removed", provider: "已去掉", tools: [{...agentRow("user.old", "旧表情", "", "3 个表情"), restorable: true}]},
    ],
    count: 2,
    modified: true,
    candidates: [{id: "user", provider: "我的表情包", tools: [{...agentRow("user.old", "旧表情", "", "3 个表情"), providerName: "user.old", blocked: false}]}],
};
/** 用户写的 Profile 的“Skill”一节：声明了几个，用户加了一个，一个已不在目录里。 */
const LORE_SKILLS: ProfileToolsField = {
    groups: [
        {id: "user", provider: "我的 Skill", tools: [agentRow("user.style-guide", "style-guide", "我加的", "按本书的文风规则改写一段"), agentRow("user.voice-check", "voice-check", "", "逐段检查叙述视角有没有串")]},
        {id: "gone", provider: "已删除或不可用", tools: [agentRow("user.old-outline", "user.old-outline", "", "没有找到这个 Skill，放回 Skill 文件夹后恢复", true)]},
    ],
    count: 2,
    modified: true,
    candidates: [],
};
export const SAMPLE_WRITER_TOOLS = WRITER_TOOLS;
export const SAMPLE_TOOL_CANDIDATES = CANDIDATES;

export const SAMPLE_PROFILES: readonly ProfileView[] = [
    {key: "nbook.agent.main", name: "写作助手", description: "和作者一起写长篇小说：构思、设定、大纲、正文、修改、检查前后一致。", icon: "i-lucide-feather", source: "内置", statusText: null, hidden: false, user: false, notice: null, model: model(), approval: approval(), tools: WRITER_TOOLS, agents: WRITER_AGENTS, skills: WRITER_SKILLS, stickers: WRITER_STICKERS},
    {
        key: "user.lore-check",
        name: "设定核对",
        description: "只读全书，找设定与前文的矛盾，列出来但不改。",
        icon: "i-lucide-user-round-pen",
        source: "我写的",
        statusText: null,
        hidden: false,
        user: true,
        notice: null,
        model: model({value: "deepseek/deepseek-flash", hint: "这个模型不支持看图", warning: true}),
        approval: approval({value: "auto", hint: "模型先判断，判不了再问你；模型可能漏判"}),
        tools: LORE_TOOLS,
        agents: null,
        skills: LORE_SKILLS,
        stickers: null,
    },
    {
        key: "user.draft-review",
        name: "draft-review",
        description: "",
        icon: "i-lucide-user-round-pen",
        source: "我写的",
        statusText: {kind: "error", text: "有错误", tone: "error"},
        hidden: false,
        user: true,
        notice: {text: "打包失败：第 12 行 找不到模块 “lodash”", lines: ["draft-review.profile.tsx 第 12 行：找不到模块 “lodash”", "这个 Profile 还没成功过，用不了。"], tone: "danger"},
        model: model(),
        approval: approval(),
        tools: null,
        agents: null,
        skills: null,
        stickers: null,
    },
    {
        key: "plot.qa",
        name: "剧情问答",
        description: "按剧情图谱回答关于这本书的问题。",
        icon: "i-lucide-network",
        source: "剧情图谱",
        statusText: {kind: "unavailable", text: "不可用", tone: "warning"},
        hidden: false,
        user: false,
        notice: {text: "不可用：缺少必需工具 plot.search", lines: ["缺少必需工具 plot.search。装上提供它的插件后恢复。"], tone: "warning"},
        model: model(),
        approval: approval(),
        tools: MISSING_TOOLS,
        agents: null,
        skills: null,
        stickers: null,
    },
    {key: "nbook.agent.session-title", name: "会话标题", description: "给一段对话起标题，并写一句说明。", icon: "i-lucide-heading", source: "内置", statusText: null, hidden: true, user: false, notice: null, model: model({hint: "跟随默认时用“微型”角色"}), approval: null, tools: null, agents: null, skills: null, stickers: null},
];
