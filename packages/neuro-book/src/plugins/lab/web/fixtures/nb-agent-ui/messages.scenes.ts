/**
 * “消息”视图的外框与列表（AgentMessages.md、AgentMessagesList.md）。头像是内联的图（产品里是 `nbook.bots` 的头像地址）。
 */

import type {AgentMessages, AgentMessagesList} from "@notnotype/nb-agent-ui/vue";
import type {MessagesContactSection} from "@notnotype/nb-agent-ui";

import type {LabFixtureDefinition} from "../index";

const now = Date.parse("2026-11-20T10:00:00+00:00");
const avatar = (fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><circle cx='10' cy='10' r='10' fill='${fill}'/><circle cx='7' cy='9' r='1.5' fill='#3a2a4a'/><circle cx='13' cy='9' r='1.5' fill='#3a2a4a'/></svg>`)}`;

const SECTIONS: MessagesContactSection[] = [{
    key: "nbook.bots",
    state: {kind: "ready"},
    contacts: [
        {key: "nbook.bots/lyra", name: "星璃", avatar: avatar("#c9a7e8"), unread: 2, activity: "idle", last: {text: "这周新书榜前二十里，系统流从七本降到三本，“慢热日常”类多了四本。", at: now - 5 * 60_000}},
        {key: "nbook.bots/vega", name: "织女", avatar: avatar("#a7d0e8"), unread: null, activity: "waiting", last: {text: "我想改第五章的开头，可以吗？", at: now - 40 * 60_000}},
        {key: "nbook.bots/nova", name: "新星", unread: 0, activity: "running", last: {text: "[表情]", at: now - 26 * 3_600_000}},
    ],
}];
const SECTIONS_EN: MessagesContactSection[] = [{
    key: "nbook.bots",
    state: {kind: "ready"},
    contacts: [
        {key: "nbook.bots/lyra", name: "Lyra the very long-named companion", avatar: avatar("#c9a7e8"), unread: 12, activity: "idle", last: {text: "Three system-flow novels left the top twenty this week while slow-burn slice of life gained four.", at: now - 5 * 60_000}},
        {key: "nbook.bots/vega", name: "Vega", unread: null, activity: "waiting", last: null},
    ],
}];
const RECENT = [
    {id: "s1", title: "第三章节奏调整", icon: "i-lucide-feather"},
    {id: "s2", title: "人物卡补全", icon: "i-lucide-feather"},
    {id: "s3", title: "伏笔清单核对", icon: "i-lucide-search"},
];

type FrameScene = LabFixtureDefinition<typeof AgentMessages>["scenes"][number];
const frame = {sections: SECTIONS, selected: {kind: "contact" as const, key: "nbook.bots/lyra"}, recentSessions: RECENT, now, locale: "zh-CN" as const};

export const agentMessagesScenes: FrameScene[] = [
    {id: "narrow", label: "窄版（右栏默认宽度）：头像列加聊天区，未读点与等你处理的黄点", input: {props: {...frame, layout: "narrow"}, model: {drawerOpen: false, listCollapsed: false, tab: "bot"}}},
    {id: "narrow-drawer", label: "窄版拉出抽屉：bot 一页", input: {props: {...frame, layout: "narrow"}, model: {drawerOpen: true, listCollapsed: false, tab: "bot"}}},
    {id: "narrow-sessions", label: "窄版抽屉的会话一页", input: {props: {...frame, layout: "narrow", selected: {kind: "session", id: "s1"}}, model: {drawerOpen: true, listCollapsed: false, tab: "sessions"}}},
    {id: "wide", label: "宽版：列表栏常驻，拖右边的线改宽度、拖窄了收成头像列", input: {props: {...frame, layout: "wide"}, model: {drawerOpen: false, listCollapsed: false, listWidth: 260, tab: "bot"}}},
    {id: "wide-collapsed", label: "宽版收起列表栏：左边换成头像列，往外拖线展开", input: {props: {...frame, layout: "wide"}, model: {drawerOpen: false, listCollapsed: true, listWidth: 260, tab: "bot"}}},
    {id: "wide-resized", label: "宽版：列表栏拖宽到 340", input: {props: {...frame, layout: "wide"}, model: {drawerOpen: false, listCollapsed: false, listWidth: 340, tab: "bot"}}},
    {id: "wide-narrowest-english", label: "宽版英文、列表栏拖到最窄 200、未读三位数：切换行不压到收起按钮", input: {props: {...frame, sections: [{...SECTIONS_EN[0]!, contacts: SECTIONS_EN[0]!.contacts.map((contact, index) => (index === 0 ? {...contact, unread: 128} : contact))}], layout: "wide", locale: "en-US"}, model: {drawerOpen: false, listCollapsed: false, listWidth: 200, tab: "bot"}}},
    {id: "phone-drawer", label: "390 宽：抽屉", input: {props: {...frame, layout: "narrow"}, model: {drawerOpen: true, listCollapsed: false, tab: "bot"}}},
    {id: "narrow-english", label: "英文界面：长名字与长摘要截断，未读两位数", input: {props: {...frame, sections: SECTIONS_EN, layout: "narrow", locale: "en-US"}, model: {drawerOpen: true, listCollapsed: false, tab: "bot"}}},
    // 浮动窗里自绘头（workbench/views.md 输出 19 的“自绘头”）：宿主给 `windowDrag`，切换行、头像列顶上那一行是窗口的拖动区，抽屉从头下面拉出。头高是宿主经 CSS 变量给的，这里不给，按 `windowDrag` 时的缺省 40（与真实宿主一样，两栏第一行等高）。
    {id: "own-head-wide", label: "自绘窗口头，宽版：切换行顶到上边、是拖动区", input: {props: {...frame, layout: "wide", windowDrag: true}, model: {drawerOpen: false, listCollapsed: false, listWidth: 260, tab: "bot"}}},
    {id: "own-head-collapsed", label: "自绘窗口头，宽版收起：头像列顶上那一行与头同高", input: {props: {...frame, layout: "wide", windowDrag: true}, model: {drawerOpen: false, listCollapsed: true, listWidth: 260, tab: "bot"}}},
    {id: "own-head-narrow-english", label: "自绘窗口头，窄版英文 390 宽：抽屉从头那一行下面拉出", input: {props: {...frame, sections: SECTIONS_EN, layout: "narrow", locale: "en-US", windowDrag: true}, model: {drawerOpen: true, listCollapsed: false, tab: "bot"}}},
];

type ListScene = LabFixtureDefinition<typeof AgentMessagesList>["scenes"][number];
const list = {sections: SECTIONS, selectedContact: "nbook.bots/lyra", now, locale: "zh-CN" as const};
export const agentMessagesListScenes: ListScene[] = [
    {id: "bots", label: "bot 一页：最后一句话、正在回复、等你处理、未读", input: {props: list, model: {tab: "bot"}}},
    {id: "loading", label: "联系人加载中", input: {props: {...list, sections: [{key: "nbook.bots", state: {kind: "loading"}, contacts: []}]}, model: {tab: "bot"}}},
    {id: "failed", label: "联系人读不到：原因与重试", input: {props: {...list, sections: [{key: "nbook.bots", state: {kind: "failed", message: "读不到 bot 列表（disconnected）。"}, contacts: []}]}, model: {tab: "bot"}}},
    {id: "empty", label: "还没有 bot", input: {props: {...list, sections: [{key: "nbook.bots", state: {kind: "ready"}, contacts: []}]}, model: {tab: "bot"}}},
    {id: "english", label: "英文界面", input: {props: {...list, sections: SECTIONS_EN, locale: "en-US"}, model: {tab: "bot"}}},
];
