/**
 * 会话列表的 Lab 场景（Spec“会话列表”与验收 26、27）。时间按本地时区构造：同一份场景在哪个时区的机器上都写成
 * “今天的时刻、昨天、月日”，截图与巡检不随机器变。
 */
import type {AgentSessionListItem} from "@notnotype/nb-agent-ui";
import type {AgentSessionList, AgentSessionPanel} from "@notnotype/nb-agent-ui/vue";
import type {LabFixtureDefinition} from "../index";

const at = (month: number, day: number, hour = 12, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute).getTime();
const now = at(10, 20, 13, 30);

const items: AgentSessionListItem[] = [
    {id: "c-overview", title: "这本书讲了什么？", description: "3 轮 · 图当目录", updatedAt: at(10, 20, 13, 7), status: "idle"},
    {id: "c-running", title: "南嘉鱼知道心月狐就是苏天晴吗？其他魔法少女呢？", description: "2 轮 · 图当目录", updatedAt: at(10, 20, 13, 6), status: "running"},
    {id: "c-early", title: "第 20 章时风信子怀疑过心月狐吗？", description: "1 轮 · 全读", updatedAt: at(10, 19, 21, 40), status: "idle", note: {text: "读到 38.12，早于你现在的位置", icon: "i-lucide-history"}},
    {id: "c-hello", title: "你好", description: "1 轮 · 图当目录", updatedAt: at(10, 19, 8, 0), status: "interrupted"},
    {id: "c-failed", title: "列出所有魔法少女的变身口号", description: "1 轮 · 图当目录", updatedAt: at(10, 18), status: "error"},
    {id: "c-old", title: "", updatedAt: at(12, 30, 12, 0, 2025), status: "idle"},
];

type Scene = LabFixtureDefinition<typeof AgentSessionList>["scenes"][number];

const base = {items, selectedId: "c-overview", now, locale: "zh-CN" as const};

const PANEL_ITEMS: AgentSessionListItem[] = [
    {id: "1", title: "第三章节奏调整", description: "调整第三章节奏，合并回忆段落，并修正第五章错别字。", updatedAt: at(10, 20, 13, 7), status: "idle", icon: "i-lucide-feather", iconTitle: "写作助手"},
    {id: "2", title: "女主角人物小传", description: "整理苏晴的背景与口头禅，写进设定。", updatedAt: at(10, 20, 12, 40), status: "running", icon: "i-lucide-feather", iconTitle: "写作助手"},
    {id: "3", title: "第 12 章伏笔检查", description: "核对钟声的伏笔有没有前后矛盾。", updatedAt: at(10, 20, 10, 12), status: "waiting", icon: "i-lucide-feather", iconTitle: "写作助手"},
    {id: "4", title: "把第一章扩写到五千字", updatedAt: at(10, 19, 21, 40), status: "interrupted", icon: "i-lucide-feather", iconTitle: "写作助手"},
    {id: "5", title: "这本书讲了什么？", description: "3 轮问答。", updatedAt: at(10, 19, 8, 2), status: "idle", icon: "i-lucide-book-open-text", iconTitle: "剧情问答"},
    {id: "6", title: "润色第 4 章对话", description: "没有设置图标的 Profile 用缺省图标。", updatedAt: at(10, 12), status: "idle"},
    {id: "7", title: "旧的会话", description: "归档了。", updatedAt: at(9, 2), status: "idle", archived: true, icon: "i-lucide-feather"},
];
const PROFILES = [{id: "writer", label: "写作助手", icon: "i-lucide-feather", active: false}, {id: "qa", label: "剧情问答", icon: "i-lucide-book-open-text", active: false}];

type PanelScene = LabFixtureDefinition<typeof AgentSessionPanel>["scenes"][number];
const panelBase = {items: PANEL_ITEMS, selectedId: "1", now, locale: "zh-CN" as const, profiles: PROFILES};
const panelModel = {scope: {value: "project" as const}};

export const agentSessionPanelScenes: PanelScene[] = [
    {id: "list", label: "分组、图标、状态、已归档", input: {props: panelBase, model: panelModel}},
    {id: "filtered", label: "选了过滤条件：标签可去掉", input: {props: {...panelBase, profiles: [{...PROFILES[0]!, active: true}, PROFILES[1]!]}, model: {...panelModel, showArchived: true}}},
    {id: "no-project", label: "没有打开作品：没有范围按钮", input: {props: panelBase, model: {scope: null}}},
    {id: "empty", label: "没有会话", input: {props: {...panelBase, items: []}, model: panelModel}},
    {id: "error", label: "取不到", input: {props: {...panelBase, items: [], error: "会话列表取不到，请稍后重试。"}, model: panelModel}},
];

export const agentSessionListScenes: Scene[] = [
    {id: "list", label: "各种状态的行：选中、运行中、提醒、已中断、出错、未命名", input: {props: base}},
    {id: "renamed", label: "宿主改称“对话”（labels）", input: {props: {...base, labels: {title: "对话", create: "新对话", empty: "还没有对话", untitled: "未命名对话"}}}},
    {id: "no-header", label: "放进下拉：没有标题行", input: {props: {...base, header: false}}},
    {id: "loading", label: "加载中", input: {props: {...base, items: [], state: "loading"}}},
    {id: "empty", label: "还没有会话", input: {props: {...base, items: []}}},
    {id: "error", label: "没取到，可重试", input: {props: {...base, items: [], state: "error"}}},
    {id: "english", label: "英文界面", input: {props: {...base, locale: "en-US"}}},
];
