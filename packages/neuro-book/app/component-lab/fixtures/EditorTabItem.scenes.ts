import type EditorTabItem from "../../components/editor-workbench/EditorTabItem.vue";
import type {LabFixtureDefinition} from "./index";

const tab = {path: "src/story/chapter-01.md", title: "chapter-01.md", pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text"};
const props = {tab, active: false, pinned: false};

export const editorTabItemScenes = [
    {id: "default", label: "常规标签", input: {props}},
    {id: "active", label: "激活状态", input: {props: {...props, active: true}}},
    {id: "pinned", label: "固定标签", input: {props: {...props, tab: {...tab, pinned: true}, pinned: true}}},
    {id: "preview", label: "预览斜体", input: {props: {...props, tab: {...tab, preview: true}}}},
    {id: "dirty", label: "未保存脏标记", input: {props: {...props, tab: {...tab, dirty: true}}}},
    {id: "git-modified", label: "Git 已修改 (M)", input: {props: {...props, tab: {...tab, dirty: true, statusText: "M"}}}},
    {id: "git-untracked", label: "Git 新建 (U)", input: {props: {...props, tab: {...tab, statusText: "U"}}}},
    {id: "with-description", label: "路径消歧义", input: {props: {...props, tab: {...tab, description: "...\\story"}}}},
] satisfies LabFixtureDefinition<typeof EditorTabItem>["scenes"];
