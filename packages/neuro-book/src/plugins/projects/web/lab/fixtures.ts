import {createSubjectFixture, defineLabFixture, defineSubjectFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type BookshelfPage from "nbook/plugins/projects/web/components/BookshelfPage.vue";
import {SHELF_ITEMS, SHELF_COVER_SRC, SHELF_NOW, SHELF_ITEM_REVISING} from "./shelf-fixture-data";
import {withProjectsText} from "./projects-text";
import type {ShelfItem} from "nbook/plugins/projects/shared/shelf";
import type ShelfDesk from "nbook/plugins/projects/web/components/ShelfDesk.vue";
import type ShelfCards from "nbook/plugins/projects/web/components/ShelfCards.vue";
import type BookCard from "nbook/plugins/projects/web/components/BookCard.vue";
import type WelcomePage from "nbook/plugins/projects/web/components/WelcomePage.vue";
import type BookCover from "nbook/plugins/projects/web/components/BookCover.vue";
import type ShelfList from "nbook/plugins/projects/web/components/ShelfList.vue";
import type ProjectInfoDialog from "nbook/plugins/projects/web/components/ProjectInfoDialog.vue";
import type FileBrowser from "nbook/plugins/projects/web/components/FileBrowser.vue";
import type PathPickerDialog from "nbook/plugins/projects/web/components/PathPickerDialog.vue";
import type WorksSettingsPage from "nbook/plugins/projects/web/components/WorksSettingsPage.vue";

/** 书架页（docs/specs/workbench/bookshelf.md）的场景是给开发者看的静态稿，也是页面接上真实数据之后的回归场景。 */
function projectsFixtures(): LabFixture[] {
    const [first, second, third, , long] = SHELF_ITEMS as [typeof SHELF_ITEMS[number], ...typeof SHELF_ITEMS];
    const page = {status: "ready" as const, items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"};
    // 封面图由夹具给：Lab 没有服务端的封面路由，第一部作品用一张内联的 SVG，其余排版封面。
    const covers = async () => ({coverSrc: (item: ShelfItem) => (item.id === first.id ? SHELF_COVER_SRC : null)});
    return [
        defineLabFixture<typeof BookshelfPage>({
            component: "BookshelfPage",
            scenes: [
                {id: "cards", label: "卡片视图，选中一部", input: {props: page, model: {view: "cards", sort: "recent", activeId: first.id}}},
                {id: "list", label: "列表视图", input: {props: page, model: {view: "list", sort: "words", activeId: null}}},
                {id: "one", label: "只有一部", input: {props: {...page, items: [second]}, model: {view: "cards", sort: "recent", activeId: second.id}}},
                {id: "no-record", label: "有作品但没有写作记录", input: {props: {...page, items: [SHELF_ITEMS[3]!]}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "empty", label: "空书架", input: {props: {...page, items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "loading", label: "加载中", input: {props: {...page, status: "loading", items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "error", label: "取数失败", input: {props: {...page, status: "error", error: "书架没取到：服务端暂时不可用", items: []}, model: {view: "cards", sort: "recent", activeId: null}}},
                {id: "english", label: "英文界面", input: {props: {...page}, model: {view: "cards", sort: "recent", activeId: third.id}}},
                {id: "settings-open", label: "设置窗口开着：齿轮按下", input: {props: {...page, settingsOpen: true}, model: {view: "cards", sort: "recent", activeId: first.id}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof BookshelfPage>((await import("nbook/plugins/projects/web/components/BookshelfPage.vue")).default, {events: ["continue", "open", "open-new-window", "edit", "remove", "create", "add-existing", "retry", "open-settings"], class: "h-full w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof ShelfDesk>({
            component: "ShelfDesk",
            scenes: [
                {id: "writing", label: "今天写了字", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "no-today", label: "今天没写", input: {props: {items: [second, third], now: SHELF_NOW}}},
                {id: "revising", label: "今天净删", input: {props: {items: [SHELF_ITEM_REVISING], now: SHELF_NOW}}},
                {id: "no-record", label: "没有写作记录", input: {props: {items: [SHELF_ITEMS[3]!], now: SHELF_NOW}}},
                {id: "empty", label: "空书架的问候", input: {props: {items: [], now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfDesk>((await import("nbook/plugins/projects/web/components/ShelfDesk.vue")).default, {events: ["continue"], class: "w-full"})),
        }),
        defineLabFixture<typeof ShelfCards>({
            component: "ShelfCards",
            scenes: [
                {id: "grid", label: "几部作品", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: first.id}}},
                {id: "many", label: "很多部", input: {props: {items: [...SHELF_ITEMS, ...SHELF_ITEMS].map((item, index) => ({...item, id: `${item.id}-${String(index)}`})), now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: null}}},
                {id: "empty", label: "空书架的两张卡", input: {props: {items: [], now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"}, model: {activeId: null}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfCards>((await import("nbook/plugins/projects/web/components/ShelfCards.vue")).default, {events: ["open", "open-new-window", "edit", "remove", "create", "add-existing"], class: "w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof BookCard>({
            component: "BookCard",
            scenes: [
                {id: "cover", label: "有封面、正在打开", input: {props: {item: first, now: SHELF_NOW, coverSrc: SHELF_COVER_SRC, active: true}}},
                {id: "typeset", label: "排版封面", input: {props: {item: second, now: SHELF_NOW, coverSrc: null, active: false}}},
                {id: "none", label: "尚未统计、没有简介", input: {props: {item: SHELF_ITEMS[3]!, now: SHELF_NOW, coverSrc: null, active: false}}},
                {id: "long", label: "长书名", input: {props: {item: long, now: SHELF_NOW, coverSrc: null, active: false}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof BookCard>((await import("nbook/plugins/projects/web/components/BookCard.vue")).default, {events: ["pick", "open", "open-new-window", "edit", "remove"], class: "w-full max-w-[360px]"})),
        }),
        defineLabFixture<typeof WelcomePage>({
            component: "WelcomePage",
            scenes: (() => {
                const quick = [
                    {address: "project://大纲.md", name: "大纲.md", kind: "file" as const},
                    {address: "project://设定", name: "设定", kind: "folder" as const},
                ];
                const recent = ["project://正文/第一卷/第一章 灯塔.md", "project://设定/人物.md", "project://大纲.md"];
                const page = {title: first.title ?? first.name, description: first.description, stats: first.stats, now: SHELF_NOW, quick, recent, shortcut: "Ctrl+Shift+P"};
                return [
                    {id: "book", label: "写过一阵的作品", input: {props: page}},
                    {id: "new", label: "新作品：没有简介、尚未统计、没有最近打开", input: {props: {...page, title: "新的一本", description: null, stats: SHELF_ITEMS[3]!.stats, quick: [], recent: []}}},
                    {id: "problem", label: "新建章节失败", input: {props: {...page, problem: "新建章节失败：permission-denied"}}},
                    {id: "unbound", label: "没有打开作品", input: {props: {...page, title: null}}},
                    {id: "english", label: "英文界面", input: {props: {...page}}},
                ];
            })(),
            load: async () => withProjectsText(createSubjectFixture<typeof WelcomePage>((await import("nbook/plugins/projects/web/components/WelcomePage.vue")).default, {events: ["new-chapter", "open", "reveal", "shelf"], class: "w-full"})),
        }),
        defineSubjectFixture<typeof BookCover>({
            component: "BookCover",
            class: "",
            scenes: [
                {id: "image", label: "有图", input: {props: {id: "a", title: "长夜行", color: null, src: SHELF_COVER_SRC, width: 150}}},
                {id: "typeset", label: "排版封面（生成的色档）", input: {props: {id: "8f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", title: "长夜行", color: null, width: 150, caption: "长篇"}}},
                {id: "light", label: "作者给的浅色", input: {props: {id: "b", title: "短篇集：在所有的夜里", color: "#d9c9a3", width: 150}}},
                {id: "small", label: "列表里的小封面", input: {props: {id: "c", title: "北方以北", color: "#7a4b3a", width: 30}}},
                {id: "english", label: "英文长名", input: {props: {id: "d", title: "The Long Dark and the Lighthouse Keeper", color: null, width: 84}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/BookCover.vue"),
        }),
        defineLabFixture<typeof ShelfList>({
            component: "ShelfList",
            scenes: [
                {id: "books", label: "几部作品", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
                {id: "english", label: "英文界面", input: {props: {items: SHELF_ITEMS, now: SHELF_NOW}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ShelfList>((await import("nbook/plugins/projects/web/components/ShelfList.vue")).default, {events: ["open", "open-new-window", "edit", "remove", "create"], class: "w-full", runtimeProps: await covers()})),
        }),
        defineLabFixture<typeof ProjectInfoDialog>({
            component: "ProjectInfoDialog",
            scenes: [
                {id: "create", label: "新建作品", input: {props: {open: true, mode: "create"}, model: {location: "/home/writer/Documents/NeuroBook"}}},
                {id: "create-filled", label: "新建作品（填了书名、自定义色）", input: {props: {open: true, mode: "create", initial: {title: "雪线以北", description: "一个守灯人等一封永远不会来的信。", color: "#d4a017", coverSrc: null}}, model: {location: "/home/writer/Documents/NeuroBook"}}},
                {id: "edit", label: "编辑信息（有封面）", input: {props: {open: true, mode: "edit", initial: {id: first.id, title: first.title ?? first.name, description: first.description ?? "", color: "#2f63a8", coverSrc: SHELF_COVER_SRC}}, model: {location: ""}}},
                {id: "rejected", label: "服务端拒绝了位置", input: {props: {open: true, mode: "create", initial: {title: "长夜行", description: "", color: "#2f63a8", coverSrc: null}, fieldErrors: {location: "作品目录不可用：目录不可读写（/mnt/usb/books）"}}, model: {location: "/mnt/usb/books"}}},
                {id: "busy", label: "提交中", input: {props: {open: true, mode: "edit", initial: {title: "北方以北", description: "", color: null, coverSrc: null}, busy: true}, model: {location: ""}}},
                {id: "english", label: "英文界面", input: {props: {open: true, mode: "create"}, model: {location: "/Users/writer/Documents/NeuroBook"}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof ProjectInfoDialog>((await import("nbook/plugins/projects/web/components/ProjectInfoDialog.vue")).default, {events: ["submit", "cancel", "browse-location"], class: ""})),
        }),
        defineSubjectFixture<typeof FileBrowser>({
            component: "FileBrowser",
            events: ["navigate", "up", "activate"],
            class: "w-full max-w-[560px]",
            scenes: [
                {id: "default", label: "作品目录", input: {props: {
                    segments: [{label: "/", path: "/"}, {label: "home", path: "/home"}, {label: "writer", path: "/home/writer"}, {label: "Documents", path: "/home/writer/Documents"}, {label: "NeuroBook", path: "/home/writer/Documents/NeuroBook"}],
                    entries: [
                        {id: "/home/writer/Documents/NeuroBook/changyexing", name: "changyexing", kind: "directory", badge: "已在书架上", disabled: true, swatch: "#2f5fa0"},
                        {id: "/home/writer/Documents/NeuroBook/beifang", name: "beifang", kind: "directory", badge: "作品 · 北方以北", badgeTone: "accent", swatch: "#8f3f2e"},
                        {id: "/home/writer/Documents/NeuroBook/drafts", name: "drafts", kind: "directory"},
                        {id: "/home/writer/Documents/NeuroBook/old-notes", name: "old-notes", kind: "directory"},
                        {id: "/home/writer/Documents/NeuroBook/notes.md", name: "notes.md", kind: "file"},
                    ],
                    label: "作品目录",
                }, model: {selectedId: "/home/writer/Documents/NeuroBook/beifang"}}},
                {id: "empty", label: "空目录", input: {props: {segments: [{label: "/", path: "/"}, {label: "tmp", path: "/tmp"}], entries: [], emptyText: "这里没有子目录"}, model: {selectedId: null}}},
                {id: "loading", label: "加载中", input: {props: {segments: [{label: "/", path: "/"}], entries: [], loading: true}, model: {selectedId: null}}},
                {id: "error", label: "读不出", input: {props: {segments: [{label: "/", path: "/"}, {label: "root", path: "/root"}], entries: [], error: "目录不可读：/root"}, model: {selectedId: null}}},
            ],
            subject: () => import("nbook/plugins/projects/web/components/FileBrowser.vue"),
        }),
        defineLabFixture<typeof PathPickerDialog>({
            component: "PathPickerDialog",
            scenes: [
                {id: "project", label: "打开已有作品", input: {props: {open: true, mode: "project"}}},
                {id: "directory", label: "选择作品目录", input: {props: {open: true, mode: "directory", initialPath: "/home/writer/Documents"}}},
                {id: "rejected", label: "登记失败", input: {props: {open: true, mode: "project", error: "没有加入书架：目录里的项目身份文件无法读取"}}},
                {id: "english", label: "英文界面", input: {props: {open: true, mode: "project"}}},
            ],
            load: async () => withProjectsText(createSubjectFixture<typeof PathPickerDialog>((await import("nbook/plugins/projects/web/components/PathPickerDialog.vue")).default, {events: ["pick", "cancel"], class: "", runtimeProps: {source: (await import("./path-picker-source")).labPathPickerSource}})),
        }),
        defineLabFixture<typeof WorksSettingsPage>({
            component: "WorksSettingsPage",
            scenes: [
                {id: "unset", label: "还没设（显示缺省目录）", input: {props: {layer: "user"}}},
                {id: "default-unknown", label: "还没设、取不到缺省目录", input: {props: {layer: "user"}}},
                {id: "set", label: "设了（已修改）", input: {props: {layer: "user"}}},
                {id: "long", label: "很长的路径", input: {props: {layer: "user"}}},
                {id: "write-failed", label: "写不进去", input: {props: {layer: "user"}}},
                {id: "invalid", label: "设置文件有错误（停用）", input: {props: {layer: "user"}}},
                {id: "english", label: "英文界面", input: {props: {layer: "user"}}},
            ],
            load: async () => withProjectsText((await import("./WorksSettingsPageFixture.vue")).default),
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...projectsFixtures(),
];
