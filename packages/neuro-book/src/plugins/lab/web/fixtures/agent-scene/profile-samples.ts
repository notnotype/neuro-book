/** Profile 设置页的样本：内置、用户级、缺必需工具、打包失败、后台各一个。 */

import type {ProfileApprovalField, ProfileModelField, ProfileView} from "nbook/plugins/agent/web/profile-view";

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

export const SAMPLE_PROFILES: readonly ProfileView[] = [
    {key: "nbook.agent.main", name: "写作助手", description: "和作者一起写长篇小说：构思、设定、大纲、正文、修改、检查前后一致。", icon: "i-lucide-feather", source: "内置", statusText: null, hidden: false, user: false, notice: null, model: model(), approval: approval()},
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
    },
    {
        key: "user.draft-review",
        name: "draft-review",
        description: "",
        icon: "i-lucide-user-round-pen",
        source: "我写的",
        statusText: {text: "有错误", tone: "error"},
        hidden: false,
        user: true,
        notice: {text: "打包失败：第 12 行 找不到模块 “lodash”", lines: ["draft-review.profile.tsx 第 12 行：找不到模块 “lodash”", "这个 Profile 还没成功过，用不了。"], tone: "danger"},
        model: model(),
        approval: approval(),
    },
    {
        key: "plot.qa",
        name: "剧情问答",
        description: "按剧情图谱回答关于这本书的问题。",
        icon: "i-lucide-network",
        source: "剧情图谱",
        statusText: {text: "不可用", tone: "warning"},
        hidden: false,
        user: false,
        notice: {text: "不可用：缺少必需工具 plot.search", lines: ["缺少必需工具 plot.search。装上提供它的插件后恢复。"], tone: "warning"},
        model: model(),
        approval: approval(),
    },
    {key: "nbook.agent.session-title", name: "会话标题", description: "给一段对话起标题，并写一句说明。", icon: "i-lucide-heading", source: "内置", statusText: null, hidden: true, user: false, notice: null, model: model({hint: "跟随默认时用“微型”角色"}), approval: null},
];
