/**
 * “消息”视图的外框与列表（AgentMessages.md、AgentMessagesList.md）。头像是内联的图（产品里是 `nbook.bots` 的头像地址）。
 */

import type {AgentMessages, AgentMessagesList, AgentMessagesSegment} from "@notnotype/nb-agent-ui/vue";
import type {MessagesContactSection} from "@notnotype/nb-agent-ui";

import type {LabFixtureDefinition} from "../define";

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
    {id: "s4", title: "开篇三章重写", icon: "i-lucide-feather"},
    {id: "s5", title: "设定集整理", icon: "i-lucide-feather"},
    {id: "s6", title: "大纲第二稿", icon: "i-lucide-feather"},
];
/** bot 多到收着时放不下：并成“+N”。 */
const MANY: MessagesContactSection[] = [{...SECTIONS[0]!, contacts: [...SECTIONS[0]!.contacts, ...["天枢", "天璇", "天玑", "天权", "玉衡"].map((name, index) => ({key: `nbook.bots/extra-${index}`, name, unread: null, activity: "idle" as const, last: null}))]}];

type FrameScene = LabFixtureDefinition<typeof AgentMessages>["scenes"][number];
// 场景名以 docked 开头的挂替身侧轨（AgentMessagesFixture.vue），`placement` 由夹具换成侧轨的两个元素；带 -200、-420 的按那个轨宽展开。
const frame = {placement: {kind: "none" as const}, sections: SECTIONS, selected: {kind: "contact" as const, key: "nbook.bots/lyra"}, recentSessions: RECENT, now, locale: "zh-CN" as const};
const model = {tab: "bot" as const, botQuery: ""};
const shut = {...frame, expanded: false};
const open = {...frame, expanded: true};

export const agentMessagesScenes: FrameScene[] = [
    {id: "docked", label: "停靠在右轨，收着：bot、短线、新对话与最近会话、底段；当前 bot 竖条、未读数字、等你处理的圆点", input: {props: shut, model}},
    {id: "docked-session", label: "停靠收着，当前是一个会话：方块描边", input: {props: {...shut, selected: {kind: "session", id: "s2"}}, model}},
    {id: "docked-weak", label: "停靠收着，右栏隐藏或拖到零：当前退成弱描边", input: {props: {...shut, weak: true}, model}},
    {id: "docked-short", label: "停靠收着、高度不够：bot 并成“+N”，最近会话从末尾截，当前会话仍在", input: {props: {...shut, sections: MANY, selected: {kind: "session", id: "s6"}}, model}},
    {id: "docked-expanded", label: "停靠展开 300：完整列表的 bot 页", input: {props: open, model}},
    {id: "docked-expanded-sessions", label: "停靠展开：会话页，“会话历史”按下", input: {props: open, model: {...model, tab: "sessions"}}},
    {id: "docked-expanded-200", label: "停靠展开到最窄 200", input: {props: open, model}},
    {id: "docked-expanded-420", label: "停靠展开到最宽 420", input: {props: open, model}},
    {id: "docked-expanded-390-english", label: "英文 390 宽、展开：长名字与长摘要截断", input: {props: {...open, sections: SECTIONS_EN, locale: "en-US"}, model}},
    {id: "docked-390-english", label: "英文 390 宽、收着：悬停提示与名称是英文", input: {props: {...shut, sections: SECTIONS_EN, locale: "en-US"}, model}},
    // 浮动窗（ui/workbench-layout.md 输出 51）：视图段画在视图自己的右边缘。
    {id: "edge", label: "画在右边缘（浮动窗），收着", input: {props: {...shut, placement: {kind: "edge", width: 48}}, model}},
    {id: "edge-expanded", label: "画在右边缘（浮动窗），展开 300", input: {props: {...open, placement: {kind: "edge", width: 300}}, model}},
];

type SegmentScene = LabFixtureDefinition<typeof AgentMessagesSegment>["scenes"][number];
const segment = {sections: SECTIONS, selected: {kind: "contact" as const, key: "nbook.bots/lyra"}, recentSessions: RECENT, now, locale: "zh-CN" as const};
// 不给 `targets`：画在自己的位置上（AgentMessagesSegmentFixture.vue 按收着 48、展开 300 给宽）。
export const agentMessagesSegmentScenes: SegmentScene[] = [
    {id: "collapsed", label: "收着：bot、短线、新对话与最近会话、底段", input: {props: {...segment, expanded: false}, model}},
    {id: "collapsed-short", label: "收着、高度不够：“+N”，最近会话从末尾截", input: {props: {...segment, expanded: false, sections: MANY}, model}},
    {id: "collapsed-waiting-only", label: "收着、没有未读只有等你处理：“全部 bot”上是 warning 圆点", input: {props: {...segment, expanded: false, sections: [{...SECTIONS[0]!, contacts: SECTIONS[0]!.contacts.map((contact) => ({...contact, unread: 0}))}]}, model}},
    {id: "expanded", label: "展开 300：完整列表", input: {props: {...segment, expanded: true}, model}},
    {id: "expanded-200-english", label: "英文、展开到最窄 200", input: {props: {...segment, expanded: true, sections: SECTIONS_EN, locale: "en-US"}, model}},
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
