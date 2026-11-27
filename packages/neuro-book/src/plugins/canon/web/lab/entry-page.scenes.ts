import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type MoveDialog from "nbook/plugins/canon/web/components/entry-page/MoveDialog.vue";
import type EntryPage from "nbook/plugins/canon/web/components/entry-page/EntryPage.vue";
import type EntryPageNav from "nbook/plugins/canon/web/components/entry-page/EntryPageNav.vue";
import type ComponentChecklist from "nbook/plugins/canon/web/components/entry-page/ComponentChecklist.vue";
import type AddComponentDialog from "nbook/plugins/canon/web/components/entry-page/AddComponentDialog.vue";
import type ViewPointPicker from "nbook/plugins/canon/web/components/entry-page/ViewPointPicker.vue";
import type PageNotices from "nbook/plugins/canon/web/components/entry-page/PageNotices.vue";
import type WorldBanners from "nbook/plugins/canon/web/components/entry-page/WorldBanners.vue";

const value = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, entry: null, label, raw: display, display, ...extra});
const chapters = [{chapter: "1", index: 1, title: "雨夜的来客", start: "1:start", end: "1:end"}, {chapter: "2", index: 2, title: null, start: "2:start", end: "2:end"}];
const tabs = [
    {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true},
    {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const},
    {value: "data:panel", label: "数值", iconClass: "i-lucide-gauge", segment: "own" as const, removable: true},
    {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 4},
];
const page = {props: {status: "normal" as const, name: "星瑕", summary: "第三魔法学院一年级，靠打工交学费", sameAs: null, chapters, tabs}, model: {position: "2:end", planned: false, tab: "text"}};
/** 条目选择器的场景只给占位的查找状态：夹具自己当宿主，按真实的去抖查找换掉它（`EntryPickerFixture.vue`）。 */
const IDLE = {kind: "idle"} as const;

/** 条目页外壳的组件（docs/specs/canon/author-ui.md）：场景用星瑕样本里的样子手写。 */
export const fixtures: LabFixture[] = [
    defineLabFixture<typeof MoveDialog>({
        component: "MoveDialog",
        scenes: [
            {id: "sample", label: "挂在学院下面、第 2 章出场", input: {props: {entry: {id: "e1", name: "星瑕"}, parentResults: IDLE, sameAsResults: IDLE, chapters: [{id: "1", index: 1}, {id: "2", index: 2}]}, model: {open: true, draft: {parent: "e2", parentName: "学院", folder: "人物", kind: "人物", order: "keep" as const, appears: "2", sameAs: null, sameAsName: ""}}}},
            {id: "failed", label: "内核拒收：成环", input: {props: {entry: {id: "e1", name: "星瑕"}, parentResults: IDLE, sameAsResults: IDLE, error: "不能挂到自己的下层条目下面"}, model: {open: true, draft: {parent: null, parentName: "", folder: "人物", kind: "人物", order: "first" as const, appears: null, sameAs: null, sameAsName: ""}}}},
            {id: "sample-english", label: "英文界面", input: {props: {entry: {id: "e1", name: "Xia"}, parentResults: IDLE, sameAsResults: IDLE}, model: {open: true, draft: {parent: null, parentName: "", folder: "People", kind: "Person", order: "keep" as const, appears: null, sameAs: null, sameAsName: ""}}}},
        ],
        load: async () => (await import("./MoveDialogFixture.vue")).default,
    }),
    defineLabFixture<typeof EntryPage>({
        component: "EntryPage",
        scenes: [
            {id: "sample", label: "页头与分页", input: page},
            {id: "same-as", label: "马甲、还没出场、选过的章不在了", input: {props: {...page.props, name: "哥哥", summary: "星瑕扮成的男生", sameAs: {id: "xingxia", name: "星瑕"}, notAppeared: true, positionGone: true}, model: {...page.model, position: "1:end"}}},
            {id: "read-only", label: "世界只读", input: {props: {...page.props, readOnly: "不确定世界里写进去了什么，先不能写"}, model: page.model}},
            {id: "loading", label: "读取中", input: {props: {status: "loading" as const}, model: {position: "", planned: false, tab: ""}}},
            {id: "failed", label: "读取失败", input: {props: {status: "failed" as const}, model: {position: "", planned: false, tab: ""}}},
            {id: "missing", label: "找不到", input: {props: {status: "missing" as const}, model: {position: "", planned: false, tab: ""}}},
            {id: "deleted", label: "已删除", input: {props: {status: "deleted" as const, name: "旧设定"}, model: {position: "", planned: false, tab: ""}}},
            {id: "editable", label: "页头可编辑：改名字、简介、别名，更多里有移动与加去设定组", input: {props: {...page.props, editable: true, aliases: ["小瑕", "夜王"], removableGroup: "人物"}, model: {...page.model, tab: "data:character"}}},
            {id: "editable-blocked", label: "页头可编辑但算着计划：入口禁用", input: {props: {...page.props, editable: true, editReason: "先不算计划", aliases: ["小瑕"]}, model: {...page.model, planned: true}}},
            {id: "deleted-restorable", label: "已删除、可以恢复", input: {props: {status: "deleted" as const, name: "旧设定", editable: true}, model: {position: "", planned: false, tab: ""}}},
            {id: "editable-english", label: "页头可编辑（英文界面）", input: {props: {...page.props, editable: true, aliases: ["Xia"], removableGroup: "Person"}, model: page.model}},
            // 看法菜单（输出 9、54）：设定组分页留箭头格，选中的显出；选中的再点开菜单。不在缺省看法时分页上写看法名。
            ...(() => {
                const lookTabs = tabs.map((tab) => (tab.removable === true ? {...tab, looks: true} : tab));
                const looks = [{value: "card", label: "用户视图"}, {value: "agent", label: "AI视图"}, {value: "raw", label: "原始视图"}];
                const looksEnglish = [{value: "card", label: "User view"}, {value: "agent", label: "AI view"}, {value: "raw", label: "Raw view"}];
                return [
                    {id: "looks", label: "看法菜单：选中的设定组分页上有箭头，再点开菜单", input: {props: {...page.props, editable: true, tabs: lookTabs, looks}, model: {...page.model, tab: "data:character", look: "card"}}},
                    {id: "looks-agent", label: "看法菜单：在 AI视图，分页上写着", input: {props: {...page.props, editable: true, tabs: lookTabs, looks}, model: {...page.model, tab: "data:panel", look: "agent"}}},
                ];
            })(),
        ],
        load: async () => (await import("./EntryPageFixture.vue")).default,
    }),
    defineLabFixture<typeof EntryPageNav>({
        component: "EntryPageNav",
        scenes: (() => {
            const items = [
                {value: "data:character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true},
                {value: "data:look", label: "形象", iconClass: "i-lucide-shirt", segment: "own" as const, removable: true},
                {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const},
                {value: "data:panel", label: "数值", iconClass: "i-lucide-gauge", segment: "own" as const, removable: true},
                {value: "data:knowing", label: "知道什么", iconClass: "i-lucide-key-round", segment: "own" as const, removable: true},
                {value: "data:attitude", label: "目标与态度", iconClass: "i-lucide-target", segment: "own" as const, removable: true},
                {value: "extra:experience", label: "经历", iconClass: "i-lucide-footprints", segment: "view" as const},
                {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 12},
            ];
            return [
                {id: "sample", label: "人物：设定组、文字与看法两段，末尾“添加一组设定”", input: {props: {items, canAdd: true, panelId: "lab-panel"}, model: {modelValue: "data:character"}}},
                {id: "new", label: "空作品里刚新建：没有看法一段", input: {props: {items: items.slice(0, 3), canAdd: true, panelId: "lab-panel"}, model: {modelValue: "data:character"}}},
                {id: "blocked", label: "写不了：添加不可用", input: {props: {items, canAdd: true, addReason: "先不算计划", panelId: "lab-panel"}, model: {modelValue: "plot"}}},
                // 看法：设定组的行留箭头格、选中的显出；看法名单独一格，名字长时标题先截（168 像素一栏）。
                {id: "looks", label: "看法：选中的行写着 AI视图，标题长时先截标题", input: {props: {items: items.map((item) => (item.removable === true ? {...item, looks: true} : item)), canAdd: true, panelId: "lab-panel", menus: true, note: "AI视图"}, model: {modelValue: "data:attitude"}}},
                {id: "looks-english", label: "看法（英文界面）", input: {props: {items: [{value: "data:character", label: "Person", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true, looks: true}, {value: "data:attitude", label: "Goals and attitudes", iconClass: "i-lucide-target", segment: "own" as const, removable: true, looks: true}, {value: "text", label: "Text", iconClass: "i-lucide-file-text", segment: "own" as const}], canAdd: true, panelId: "lab-panel", menus: true, note: "Raw view"}, model: {modelValue: "data:attitude"}}},
            ];
        })(),
        load: async () => (await import("./EntryPageNavFixture.vue")).default,
    }),
    ...(() => {
        type Group = "canon" | "plot" | "other";
        const item = (value: string, label: string, iconClass: string, group: Group, extra: {kinds?: string[]; present?: boolean; restore?: boolean} = {}) => ({value, label, iconClass, group, kinds: extra.kinds ?? [], present: extra.present ?? false, restore: extra.restore ?? false});
        const PERSON = ["人物"];
        // 人物条目：人物、形象已经有了，数值去掉过；适用于人物的排在最前。
        const person = [
            item("nbook.canon.person", "人物", "i-lucide-user-round", "canon", {kinds: PERSON, present: true}),
            item("nbook.canon.look", "形象", "i-lucide-shirt", "canon", {kinds: PERSON, present: true}),
            item("nbook.canon.skills", "技能", "i-lucide-sparkles", "canon", {kinds: PERSON}),
            item("nbook.canon.panel", "数值", "i-lucide-gauge", "canon", {restore: true}),
            item("nbook.canon.inventory", "物品栏", "i-lucide-backpack", "canon"),
            item("nbook.canon.place", "地点", "i-lucide-map-pin", "canon"),
            item("nbook.plot.knowing", "知道什么", "i-lucide-key-round", "plot", {kinds: PERSON}),
            item("nbook.plot.attitude", "目标与态度", "i-lucide-target", "plot", {kinds: PERSON}),
            item("a.test.badge", "徽章", "i-lucide-award", "other"),
        ];
        const presets = [
            {id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.look"]},
            {id: "main", label: "主要角色", components: ["nbook.canon.person", "nbook.canon.look", "nbook.canon.panel", "nbook.plot.knowing", "nbook.plot.attitude"]},
        ];
        // 三十多个类型：列表封顶，在里面滚，搜索框与预设留在上面。
        const many = [
            ...person,
            ...[["关系", "i-lucide-users"], ["组织架构", "i-lucide-network"], ["势力范围", "i-lucide-flag"], ["地理", "i-lucide-mountain"], ["气候", "i-lucide-cloud-sun"], ["历史", "i-lucide-scroll"], ["货币", "i-lucide-coins"], ["魔法体系", "i-lucide-wand-sparkles"], ["咒语", "i-lucide-book-open"], ["契约", "i-lucide-file-signature"], ["职业", "i-lucide-briefcase"], ["称号", "i-lucide-crown"], ["病症", "i-lucide-heart-pulse"], ["饮食", "i-lucide-utensils"], ["服饰规范", "i-lucide-shirt"], ["节日", "i-lucide-party-popper"], ["语言", "i-lucide-languages"]].map(([label, icon], index) => item(`nbook.canon.extra${String(index)}`, label!, icon!, "canon")),
            ...[["伏笔", "i-lucide-bookmark"], ["秘密", "i-lucide-lock"], ["誓言", "i-lucide-hand"]].map(([label, icon], index) => item(`nbook.plot.extra${String(index)}`, label!, icon!, "plot")),
            ...[["好感度", "i-lucide-heart"], ["战斗力", "i-lucide-swords"], ["日程", "i-lucide-calendar"], ["相册", "i-lucide-images"]].map(([label, icon], index) => item(`a.test.extra${String(index)}`, label!, icon!, "other")),
        ];
        const english = [
            item("nbook.canon.person", "Person", "i-lucide-user-round", "canon", {kinds: ["Person"], present: true}),
            item("nbook.canon.skills", "Skills", "i-lucide-sparkles", "canon", {kinds: ["Person"]}),
            item("nbook.canon.panel", "Stats", "i-lucide-gauge", "canon", {restore: true}),
            item("nbook.canon.inventory", "Inventory", "i-lucide-backpack", "canon"),
            item("nbook.plot.knowing", "What they know", "i-lucide-key-round", "plot", {kinds: ["Person"]}),
            item("a.test.badge", "Badges", "i-lucide-award", "other"),
        ];
        const englishPresets = [{id: "main", label: "Main character", components: ["nbook.canon.person", "nbook.canon.panel", "nbook.plot.knowing"]}];
        return [
            defineLabFixture<typeof ComponentChecklist>({
                component: "ComponentChecklist",
                scenes: [
                    {id: "person", label: "人物条目：预设一排，适用的在最前，已添加的勾着，去掉过的写“恢复”", input: {props: {items: person, kind: "人物", presets}, model: {modelValue: []}}},
                    {id: "checked", label: "勾了两组", input: {props: {items: person, kind: "人物", presets}, model: {modelValue: ["nbook.canon.skills", "nbook.plot.knowing"]}}},
                    {id: "no-kind", label: "没有种类：没有“适用于”与预设", input: {props: {items: person, kind: ""}, model: {modelValue: []}}},
                    {id: "many", label: "三十多个设定组：列表封顶、在里面滚", input: {props: {items: many, kind: "人物", presets, maxHeight: "22rem"}, model: {modelValue: []}}},
                    {id: "person-english", label: "英文界面", input: {props: {items: english, kind: "Person", presets: englishPresets}, model: {modelValue: []}}},
                ],
                load: async () => (await import("./ComponentChecklistFixture.vue")).default,
            }),
            defineLabFixture<typeof AddComponentDialog>({
                component: "AddComponentDialog",
                scenes: [
                    {id: "person", label: "人物条目：预设、按组列出", input: {props: {items: person, kind: "人物", presets}, model: {open: true}}},
                    {id: "many", label: "三十多个设定组：列表在对话框里滚", input: {props: {items: many, kind: "人物", presets}, model: {open: true}}},
                    {id: "failed", label: "加的时候别处已经加上了其中一组", input: {props: {items: person, kind: "人物", presets, error: "“技能”这组设定已经加上了"}, model: {open: true}}},
                    {id: "person-english", label: "英文界面", input: {props: {items: english, kind: "Person", presets: englishPresets}, model: {open: true}}},
                ],
                load: async () => (await import("./AddComponentDialogFixture.vue")).default,
            }),
        ];
    })(),
    defineLabFixture<typeof ViewPointPicker>({
        component: "ViewPointPicker",
        scenes: (() => {
            const titles = ["雨夜的来客", "妹妹的布丁", "学院开学", "旧校舍的钟", "第一次变身", "对策委员会", "哥哥的秘密", "失物招领", "夏日祭", "回不去的那天", "星瑕的信", "雨停以后"];
            const chapterOf = (n: number, title: string | null) => ({chapter: `c${String(n)}`, index: n, title, start: `c${String(n)}:start`, end: `c${String(n)}:end`});
            const three = [chapterOf(1, "好哥哥真难当"), chapterOf(2, "用钱说话"), chapterOf(3, null)];
            const many = Array.from({length: 60}, (_, index) => chapterOf(index + 1, titles[index % titles.length]!));
            const lines = [{id: "main", name: null, depth: 0}, {id: "l1", name: "重来的那个晚上", depth: 1}, {id: "l2", name: "梦里的那一天", depth: 2}];
            const english = [chapterOf(1, "The Visitor on a Rainy Night"), chapterOf(12, "The Long Road Home Begins")];
            return [
                {id: "sample", label: "第 3 章末尾，有分支线与计划", input: {props: {chapters: three, canPlan: true, lineOptions: lines, resolvedLine: "main"}, model: {position: "c3:end", planned: false, line: ""}}},
                {id: "main-only", label: "只有主线：不提线", input: {props: {chapters: three, canPlan: true}, model: {position: "c3:end", planned: false, line: ""}}},
                {id: "pinned", label: "固定看一条分支线", input: {props: {chapters: three, lineOptions: lines, resolvedLine: "l1"}, model: {position: "c2:end", planned: false, line: "l1"}}},
                {id: "many", label: "60 章：菜单里能搜、滚到当前章", input: {props: {chapters: many, canPlan: true, lineOptions: lines, resolvedLine: "main"}, model: {position: "c37:end", planned: false, line: ""}}},
                {id: "initial", label: "在“最初”：往前一步不可用", input: {props: {chapters: three}, model: {position: "initial", planned: false, line: ""}}},
                {id: "not-appeared", label: "到这里还没出场", input: {props: {chapters: three, notAppeared: true}, model: {position: "c1:end", planned: false, line: ""}}},
                {id: "gone", label: "原来选的那一章不在了", input: {props: {chapters: three, positionGone: true}, model: {position: "c3:end", planned: false, line: ""}}},
                {id: "locked", label: "有没提交的主文字：锁着", input: {props: {chapters: three, canPlan: true, lineOptions: lines, resolvedLine: "main", locked: "先提交或放弃正在写的主文字"}, model: {position: "c3:end", planned: true, line: ""}}},
                {id: "only-plans", label: "空作品里只有计划", input: {props: {chapters: [], canPlan: true}, model: {position: "initial", planned: false, line: ""}}},
                // 英文、长线名、还没出场：标记与结论截断，390 宽不撑出横向滚动。
                {id: "long-title-english", label: "英文、长线名、还没出场", input: {props: {chapters: english, notAppeared: true, lineOptions: [{id: "main", name: null, depth: 0}, {id: "l9", name: "The Night Everything Was Undone Again", depth: 1}], resolvedLine: "l9"}, model: {position: "c12:end", planned: false, line: "l9"}}},
            ];
        })(),
        load: async () => (await import("./ViewPointPickerFixture.vue")).default,
    }),
    defineLabFixture<typeof PageNotices>({
        component: "PageNotices",
        scenes: [
            {id: "sample", label: "刚保存了一次就地改：记在第 3 章", input: {props: {notice: {revision: "r1", title: "改外观", where: "第 3 章"}}}},
            {id: "no-where", label: "改条目本身：没有位置", input: {props: {notice: {revision: "r1", title: "加上“形象”这组设定"}}}},
            {id: "with-agent", label: "Agent 也改了（之前还改过两次）", input: {props: {notice: {revision: "r1", title: "改外观", where: "第 3 章"}, agent: {revision: "r2", title: "给星瑕加别名小瑕", earlier: 2}}}},
            {id: "agent-undone", label: "Agent 那一次已还原", input: {props: {agent: {revision: "r2", title: "给星瑕加别名小瑕", earlier: 0, undone: true}}}},
            {id: "error", label: "页面自己的写入失败", input: {props: {error: "这个条目在你打开以后被别处改过，重读以后再试一次"}}},
            {id: "long", label: "很长的标题截断", input: {props: {notice: {revision: "r1", title: "记了一笔：在第三魔法学院门口被一个自称是星瑕远房表哥的人借走了三百块", where: "第 12 章"}}}},
            {id: "sample-english", label: "英文界面", input: {props: {notice: {revision: "r1", title: "Edit appearance", where: "Chapter 3"}, agent: {revision: "r2", title: "Add alias", earlier: 1}}}},
        ],
        load: async () => (await import("./PageNoticesFixture.vue")).default,
    }),
    defineLabFixture<typeof WorldBanners>({
        component: "WorldBanners",
        scenes: [
            {id: "disconnected", label: "世界已断开", input: {props: {disconnected: true}}},
            {id: "read-only", label: "世界只读", input: {props: {readOnly: "世界只读：日志的版本号重复了"}}},
        ],
        load: async () => (await import("./WorldBannersFixture.vue")).default,
    }),
];
