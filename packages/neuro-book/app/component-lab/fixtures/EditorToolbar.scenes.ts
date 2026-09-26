import type {MenubarMenuData} from "@notnotype/nb-ui/components";
import type EditorToolbar from "../../components/editor-workbench/EditorToolbar.vue";
import type {LabFixtureDefinition} from "./index";

export const SCENE_MENUS: Record<"default" | "checked" | "submenu" | "empty", MenubarMenuData[]> = {
    default: [
        {
            id: "file",
            label: "文件",
            items: [
                {label: "保存", value: "file.save", shortcut: "Ctrl+S"},
                {label: "全部保存", value: "file.save-all", shortcut: "Ctrl+Shift+S", disabled: true},
                {label: "", value: "file.sep-1", separator: true},
                {label: "重新加载打开方式", value: "file.reload"},
                {label: "关闭全部标签", value: "file.close-all", shortcut: "Ctrl+Shift+W"},
                {label: "", value: "file.sep-2", separator: true},
                {label: "删除当前章节", value: "file.delete-chapter", iconClass: "i-lucide-trash-2", tone: "danger"},
            ],
        },
        {
            id: "edit",
            label: "编辑",
            items: [
                {label: "撤销", value: "edit.undo", shortcut: "Ctrl+Z", disabled: true},
                {label: "重做", value: "edit.redo", shortcut: "Ctrl+Y", disabled: true},
                {label: "", value: "edit.sep-1", separator: true},
                {label: "剪切", value: "edit.cut", shortcut: "Ctrl+X"},
                {label: "复制", value: "edit.copy", shortcut: "Ctrl+C"},
                {label: "粘贴", value: "edit.paste", shortcut: "Ctrl+V"},
                {label: "全选", value: "edit.select-all", shortcut: "Ctrl+A"},
            ],
        },
        {
            id: "view",
            label: "视图",
            items: [
                {label: "放大", value: "view.zoom-in", shortcut: "Ctrl+="},
                {label: "缩小", value: "view.zoom-out", shortcut: "Ctrl+-"},
                {label: "重置缩放", value: "view.zoom-reset", shortcut: "Ctrl+0"},
            ],
        },
        {
            id: "help",
            label: "帮助",
            items: [
                {label: "快捷键指南", value: "help.shortcuts", shortcut: "Ctrl+/"},
                {label: "关于 NeuroBook", value: "help.about", iconClass: "i-lucide-info"},
            ],
        },
    ],
    checked: [
        {
            id: "view",
            label: "视图",
            items: [
                {label: "侧边栏", value: "view.sidebar", type: "checkbox"},
                {label: "大纲", value: "view.outline", type: "checkbox"},
                {label: "行号", value: "view.line-numbers", type: "checkbox"},
                {label: "", value: "view.sep-1", separator: true},
                {label: "阅读主题：浅色", value: "view.theme-light", type: "radio"},
                {label: "阅读主题：棕褐", value: "view.theme-sepia", type: "radio"},
                {label: "阅读主题：深色", value: "view.theme-dark", type: "radio"},
                {label: "", value: "view.sep-2", separator: true},
                {label: "小地图", value: "view.minimap", type: "checkbox", disabled: true},
            ],
        },
        {
            id: "review",
            label: "审阅",
            disabled: true,
            items: [
                {label: "拼写检查", value: "review.spelling"},
                {label: "字数统计", value: "review.word-count"},
            ],
        },
    ],
    submenu: [
        {
            id: "file",
            label: "文件",
            items: [
                {label: "新建章节", value: "file.new-chapter", shortcut: "Ctrl+N"},
                {
                    label: "导出作品",
                    value: "file.export",
                    iconClass: "i-lucide-download",
                    children: [
                        {label: "EPUB 电子书", value: "export.epub", type: "checkbox"},
                        {label: "PDF 文档", value: "export.pdf", type: "checkbox"},
                        {label: "Markdown 纯文本", value: "export.md", type: "checkbox", disabled: true},
                        {label: "", value: "export.sep-1", separator: true},
                        {label: "删除导出缓存", value: "export.clear-cache", tone: "danger"},
                    ],
                },
                {label: "", value: "file.sep-1", separator: true},
                {label: "关闭全部标签", value: "file.close-all", shortcut: "Ctrl+Shift+W"},
            ],
        },
        {
            id: "view",
            label: "视图",
            items: [
                {
                    label: "排版",
                    value: "view.typography",
                    iconClass: "i-lucide-type",
                    children: [
                        {label: "自动换行", value: "layout.wrap", type: "checkbox"},
                        {label: "显示行号", value: "layout.line-numbers", type: "checkbox"},
                        {label: "", value: "layout.sep-1", separator: true},
                        {label: "等宽字体", value: "layout.font-mono", type: "radio"},
                        {label: "衬线字体", value: "layout.font-serif", type: "radio"},
                    ],
                },
            ],
        },
    ],
    empty: [],
};

function checkedMenus(menus: MenubarMenuData[], checked: Record<string, boolean>): MenubarMenuData[] {
    const itemsWithChecked = (items: MenubarMenuData["items"]): MenubarMenuData["items"] => items.map((item) => ({
        ...item,
        ...(item.type === "checkbox" || item.type === "radio" ? {checked: checked[item.value] === true} : {}),
        ...(item.children ? {children: itemsWithChecked(item.children)} : {}),
    }));
    return menus.map((menu) => ({...menu, items: itemsWithChecked(menu.items)}));
}

export const editorToolbarScenes = [
    {id: "default", label: "快捷键、分隔符、停用与危险项", input: {props: {menus: SCENE_MENUS.default}}},
    {id: "checked", label: "可勾选项与停用菜单", input: {props: {menus: checkedMenus(SCENE_MENUS.checked, {
        "view.sidebar": true, "view.outline": false, "view.line-numbers": true,
        "view.theme-light": false, "view.theme-sepia": true, "view.theme-dark": false, "view.minimap": true,
    })}}},
    {id: "submenu", label: "子菜单递归勾选", input: {props: {menus: checkedMenus(SCENE_MENUS.submenu, {
        "export.epub": true, "export.pdf": false, "export.md": false, "layout.wrap": true,
        "layout.line-numbers": true, "layout.font-mono": false, "layout.font-serif": true,
    })}}},
    {id: "empty", label: "空菜单数组", input: {props: {menus: SCENE_MENUS.empty}}},
] satisfies LabFixtureDefinition<typeof EditorToolbar>["scenes"];
