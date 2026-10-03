export const NOVEL_IDE_TABS = ["files", "characters", "plot"] as const;

export type NovelIdeTab = typeof NOVEL_IDE_TABS[number];

/**
 * 判断给定值是否为合法的左侧工具面板 tab。
 */
export function isNovelIdeTab(value: string | null | undefined): value is NovelIdeTab {
    return typeof value === "string" && (NOVEL_IDE_TABS as readonly string[]).includes(value);
}

export type ChapterStatus = "未开始" | "草稿中" | "待修改" | "已完成";

/**
 * 章节条目。
 */
export type Chapter = {
    id: string;
    number: string;
    title: string;
    status: ChapterStatus;
    wordCount: number;
    updatedAt: string;
    summary: string;
    characters: string[];
    todos: string[];
};

/**
 * 分卷条目。
 */
export type Volume = {
    id: string;
    title: string;
    chapters: Chapter[];
};

export const mockVolumes: Volume[] = [
    {
        id: "v1",
        title: "第一篇 迷雾初现",
        chapters: [
            {
                id: "c1",
                number: "第01章",
                title: "雨夜来客",
                status: "草稿中",
                wordCount: 2350,
                updatedAt: "今天 10:00",
                summary: "神秘客人在雨夜造访，留下了一个带血的包裹。",
                characters: ["林川", "神秘客"],
                todos: ["完善雨夜的环境描写"],
            },
            {
                id: "c2",
                number: "第02章",
                title: "沉默阁楼",
                status: "已完成",
                wordCount: 3100,
                updatedAt: "昨天 16:20",
                summary: "林川在阁楼发现了祖父的日记，揭开家族秘密的一角。",
                characters: ["林川"],
                todos: [],
            },
            {
                id: "c3",
                number: "第03章",
                title: "追逐",
                status: "待修改",
                wordCount: 2180,
                updatedAt: "今天 14:32",
                summary: "林川夜逃，被追兵逼入旧城区。",
                characters: ["林川", "白夜"],
                todos: ["加强环境描写", "增强结尾反转"],
            },
            {
                id: "c4",
                number: "第04章",
                title: "余烬",
                status: "未开始",
                wordCount: 0,
                updatedAt: "-",
                summary: "",
                characters: [],
                todos: [],
            },
        ],
    },
    {
        id: "v2",
        title: "第二篇 黑塔来信",
        chapters: [
            {
                id: "c5",
                number: "第05章",
                title: "信使",
                status: "已完成",
                wordCount: 3200,
                updatedAt: "3天前",
                summary: "收到黑塔的信件，决定前往。",
                characters: ["林川"],
                todos: [],
            },
            {
                id: "c6",
                number: "第06章",
                title: "解读",
                status: "已完成",
                wordCount: 2800,
                updatedAt: "3天前",
                summary: "解读信件中的密文。",
                characters: ["林川", "老学者"],
                todos: [],
            },
            {
                id: "c7",
                number: "第07章",
                title: "启程",
                status: "已完成",
                wordCount: 3500,
                updatedAt: "2天前",
                summary: "踏上前往黑塔的旅途。",
                characters: ["林川", "白夜"],
                todos: [],
            },
        ],
    },
    {
        id: "v3",
        title: "第三篇 长夜将至",
        chapters: [
            {
                id: "c8",
                number: "第08章",
                title: "边境",
                status: "未开始",
                wordCount: 0,
                updatedAt: "-",
                summary: "",
                characters: [],
                todos: [],
            },
            {
                id: "c9",
                number: "第09章",
                title: "守夜人",
                status: "未开始",
                wordCount: 0,
                updatedAt: "-",
                summary: "",
                characters: [],
                todos: [],
            },
        ],
    },
];

export type AgentMessageType = "user" | "ai" | "tool";

/**
 * Agent 抽屉消息。
 */
export type AgentMessage = {
    id: string;
    type: AgentMessageType;
    content?: string;
    toolName?: string;
    toolStatus?: "running" | "success" | "error";
    toolArgs?: string;
    toolResult?: string;
    timestamp?: string;
    model?: string;
    tokens?: number;
};

export const mockAgentMessages: AgentMessage[] = [
    {
        id: "1",
        type: "user",
        content: "帮我设计一个反派。",
        timestamp: "10:24 AM",
        tokens: 12,
    },
    {
        id: "2",
        type: "ai",
        content: "好的，这个角色可以来自黑塔组织。为了让他更具压迫感，我先生成一个初步的设定。",
        timestamp: "10:24 AM",
        model: "gemini-3.1-pro",
        tokens: 45,
    },
    {
        id: "3",
        type: "tool",
        toolName: "CharacterGenerator",
        toolStatus: "success",
        toolArgs: "{\"affiliation\": \"黑塔组织\", \"role\": \"反派\", \"traits\": [\"压迫感\", \"神秘\"]}",
        toolResult: "{\"name\": \"渊\", \"title\": \"黑塔第七席\", \"weapon\": \"无形之刃\", \"background\": \"曾是主角父亲的挚友...\"}",
        timestamp: "10:25 AM",
    },
    {
        id: "4",
        type: "ai",
        content: "生成角色如下：\n\n**姓名**：渊\n**称号**：黑塔第七席\n**武器**：无形之刃\n**背景**：曾是主角父亲的挚友，后因某种理念分歧叛逃至黑塔。\n\n你觉得这个设定如何？需要调整他的武器或背景吗？",
        timestamp: "10:25 AM",
        model: "gemini-3.1-pro",
        tokens: 128,
    },
];
