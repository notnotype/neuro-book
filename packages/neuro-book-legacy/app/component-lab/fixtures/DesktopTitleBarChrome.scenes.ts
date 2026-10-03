import type DesktopTitleBarChrome from "../../components/common/DesktopTitleBarChrome.vue";
import type {LabFixtureDefinition} from "./index";

const projects = [
    {projectRoot: "novels/destiny-poem", title: "命定之诗"},
    {projectRoot: "novels/rain-and-tea", title: "雨与茶"},
];
const base = {
    title: "命定之诗 — NeuroBook",
    projects,
    currentProjectRoot: "novels/destiny-poem",
    agentPanelAvailable: true,
    agentPanelOpen: false,
    rendererMenus: true,
    customWindowControls: true,
    connection: "local" as const,
};

export const desktopTitleBarChromeScenes = [
    {id: "desktop", label: "桌面（完整）", input: {props: {...base, title: "第十三章 退潮 — NeuroBook"}, model: {openMenu: null}}},
    {id: "bookshelf", label: "书架态（未打开 Project）", input: {props: {...base, title: "NeuroBook", currentProjectRoot: null}, model: {openMenu: null}}},
    {id: "native-menu", label: "菜单与窗口按钮归系统", input: {props: {...base, title: "NeuroBook（远端）", projects: projects.slice(0, 1), agentPanelOpen: true, rendererMenus: false, customWindowControls: false, connection: "remote" as const}, model: {openMenu: null}}},
    {id: "compact", label: "窄栏（紧凑菜单）", input: {props: {...base, projects: projects.slice(0, 1), presentation: "compact" as const}, model: {openMenu: null}}},
    {id: "no-agent", label: "没有 Agent 面板能力", input: {props: {...base, title: "NeuroBook", projects: [], currentProjectRoot: null, agentPanelAvailable: false, connection: null}, model: {openMenu: null}}},
    {id: "menu-open", label: "File 菜单展开", input: {props: {...base, projects: projects.slice(0, 1)}, model: {openMenu: "File"}}},
    {id: "browser", label: "浏览器（无桌面能力）", input: {props: {...base, projects: projects.slice(0, 1), customWindowControls: false, connection: null}, model: {openMenu: "View"}}},
    {id: "edit-focus", label: "编辑动作（焦点不在可编辑处）", input: {props: {...base, projects: projects.slice(0, 1)}, model: {openMenu: "Edit"}}},
] satisfies LabFixtureDefinition<typeof DesktopTitleBarChrome>["scenes"];
