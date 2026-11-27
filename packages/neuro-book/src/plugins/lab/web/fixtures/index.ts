
import type FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {InlineChip} from "@notnotype/nb-markdown/chip";
import type {MarkdownDisplay, MarkdownImage} from "@notnotype/nb-markdown/display";
import type {PromptAttachmentStrip, PromptEditor, PromptPasteFrame, PromptTextView} from "@notnotype/nb-markdown/prompt";
import type {MarkdownProperties} from "@notnotype/nb-markdown/editor";
import type {PropertyDescription} from "nbook/plugins/markdown/web/properties-catalog";
import type ProviderLogo from "nbook/ui/provider-icons/ProviderLogo.vue";
import type NeuroBookLockup from "nbook/ui/brand/NeuroBookLockup.vue";
import type NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";
import type NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";
import type JsonViewer from "nbook/ui/JsonViewer.vue";
import type HighlightedText from "nbook/ui/settings/HighlightedText.vue";
import type SettingsNotice from "nbook/ui/settings/SettingsNotice.vue";
import type SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";
import type SettingsSaveBar from "nbook/ui/settings/SettingsSaveBar.vue";
import type SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";
import type SettingsActionRow from "nbook/ui/settings/SettingsActionRow.vue";
import type SettingsRow from "nbook/ui/settings/SettingsRow.vue";
import type SkillChip from "nbook/ui/SkillChip.vue";
import type TitleActions from "nbook/ui/menus/TitleActions.vue";
import {localeSetting} from "nbook/plugins/settings/shared/contracts";
import {appearanceSetting} from "nbook/plugins/workbench/shared/contracts";

import type CollapsibleSidePanel from "../components/CollapsibleSidePanel.vue";
import type EventLogPanel from "../components/EventLogPanel.vue";
import type FixtureExample from "../components/FixtureExample.vue";
import type HighlightBox from "../components/HighlightBox.vue";
import type MarkdownView from "../components/MarkdownView.vue";
import type SurfaceTierDemo from "../components/SurfaceTierDemo.vue";
import type ViewportCanvas from "../components/ViewportCanvas.vue";
import {collectLabFixtures, defineLabFixture, type LabFixture} from "./define";
import {draftFixtures} from "../drafts";
import {withSettingsText} from "./settings-scene/settings-text";
import {withNbookMarkdownHost} from "./markdown-host";
import {withMarkdownSceneText} from "./markdown-text";
import {nbAgentUiFixtures} from "./nb-agent-ui";
import {nbFormFixtures} from "./nb-form";
import {nbLayoutFixtures} from "./nb-layout";
import {LAB_STICKER_TEXT} from "nbook/plugins/stickers/web/lab/lab-stickers";
import {nbUiFixtures} from "./nb-ui";
import {PROMPT_LAB_THUMBNAILS, promptAttachmentStripScenes, promptEditorScenes, promptPasteFrameScenes, promptTextViewScenes} from "./prompt-scene/scenes";
import {rowDemoSettings, sceneThemeSetting, snippetsSettings} from "nbook/plugins/settings/web/lab/scene-settings";
import {createSubjectFixture, defineSubjectFixture} from "./subject-fixture";

/** `declared` 开头的几个场景里的属性声明（输出 59、60）：键只在那些场景里出现，别的属性面板场景不受影响。 */
const PROPERTY_DECLARATIONS: Readonly<Record<string, PropertyDescription>> = {
    叙事视角: {icon: "i-lucide-eye", label: "视角"},
    截稿日: {icon: "i-lucide-calendar-clock", kind: "date"},
    预计字数: {kind: "number"},
    定稿: {kind: "checkbox"},
    关键词: {icon: "i-lucide-tags", kind: "list"},
    人物别名: {icon: "i-lucide-users", label: "出场人物与他们的别名（含绰号、尊称与外号，写在这里是为了让设定插件能按名字找到人）"},
    人物关系: {icon: "i-lucide-eye", label: "人物之间的关系"},
    pov: {icon: "i-lucide-eye", label: "Point of view"},
    due: {kind: "date", label: "Due date"},
};

/** 属性面板的样例：一章的五个属性，每种类型一个，开头一行注释。 */
const PROPERTIES_SAMPLE = "---\n# 第十二章\n视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山]\n字数目标: 4000\n已定稿: false\n---\n";

/** MarkdownDisplay 场景用的回复：每种内置方言各一段，加引用小块、外部链接与图片。 */
const DISPLAY_REPLY = [
    "我读了[<comment body=\"她第一次出场\">林</comment>雪](/设定/林雪.md)的设定和[第三章](/正文/第三章.md)，有三处可以改：",
    "",
    "1. 开头<ruby text=\"jì tán\">祭坛</ruby>的描写偏长，==可以压到两句==。",
    "2. 对话里的 <kbd>Ctrl</kbd> 是笔误，H<sub>2</sub>O 与 x<sup>2</sup> 也要统一写法。",
    "",
    "> [!WARNING]- 伏笔会提前暴露",
    "> 第二段直接说出了她的来历，读者在第五章前不该知道。",
    "",
    "<align value=\"center\">",
    "—— 改写示例 ——",
    "</align>",
    "",
    "<bilingual text=\"老人缓缓走向祭坛。\">",
    "The old man walked slowly toward the altar.",
    "</bilingual>",
    "",
    "<html>",
    "<div style=\"padding:8px;border:1px solid #ccc\"><b>人物卡</b>：林雪，二十岁</div>",
    "</html>",
    "",
    "![示意图](/资料/地图.png)",
    "",
    "参考：[写作手册](https://example.com/guide)。",
].join("\n");
/**
 * 各插件的场景：`plugins/<插件>/web/lab/fixtures.ts` 各自导出 `fixtures`（docs/specs/ui/component-lab.md 的“输入边界”）。
 * 路径从本目录起算，比组件索引（`../component-index.ts`）多一层。登记只是数据，组件与夹具在选中场景时才由 `load` 加载。
 */
const pluginFixtures: LabFixture[] = collectLabFixtures(import.meta.glob("../../../*/web/lab/fixtures.ts", {eager: true}));

/** 全部场景登记：草稿区、各插件，以及 `src/ui/`、各包与 Lab 自己的组件（本目录）。 */
export const labFixtures: LabFixture[] = [
    // 草稿区：每个 Task 一个目录，各自登记（见 ../drafts/index.ts）。
    ...draftFixtures,
    ...pluginFixtures,
    defineLabFixture<typeof CollapsibleSidePanel>({
        component: "CollapsibleSidePanel", slots: ["default", "actions"],
        scenes: [
            {id: "default", label: "展开", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "collapsed", label: "收起", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: true}, slots: {default: true, actions: true}}},
            {id: "right", label: "靠右", input: {props: {title: "检视", collapsedWidth: 40, side: "right", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "content", label: "内容层", input: {props: {title: "检视", collapsedWidth: 40, side: "left", layer: "content"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "long", label: "长内容", input: {props: {title: "很长的一列条目", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
        ],
        load: async () => (await import("./CollapsibleSidePanelFixture.vue")).default,
    }),
    defineLabFixture<typeof ViewportCanvas>({
        component: "ViewportCanvas", slots: ["default"],
        scenes: [
            {id: "phone", label: "手机 390×844", input: {props: {minSize: 200, showSize: true}, model: {width: 390, height: 844}, slots: {default: true}}},
            {id: "tablet", label: "平板 768×1024", input: {props: {minSize: 200, showSize: true}, model: {width: 768, height: 1024}, slots: {default: true}}},
            {id: "free", label: "不限尺寸", input: {props: {minSize: 200, showSize: true}, model: {width: 0, height: 0}, slots: {default: true}}},
        ],
        load: async () => (await import("./ViewportCanvasFixture.vue")).default,
    }),
    defineLabFixture<typeof MarkdownView>({
        component: "MarkdownView", scenes: [
            {id: "prose", label: "常规正文", input: {props: {source: "## 小标题\n\n一段普通正文，里面有 **粗体**、*斜体* 和 `行内代码`。\n\n- 列表第一项\n- 列表第二项\n\n> 引用块\n\n[外部链接](https://example.com)"}}},
            {id: "table", label: "表格与代码", input: {props: {source: "| 列 A | 列 B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst answer: number = 42;\n```"}}},
            {id: "html", label: "内嵌 HTML（会被净化）", input: {props: {source: "下面这行的脚本会被净化掉，什么都不会发生：\n\n<script>alert(1)<\/script>\n\n<b>这个粗体标签是允许的</b>"}}},
            {id: "empty", label: "空文本", input: {props: {source: ""}}},
        ], load: async () => (await import("./MarkdownViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EventLogPanel>({
        component: "EventLogPanel", scenes: [
            {id: "mixed", label: "有负载与无负载混排", input: {props: {emptyText: "还没有事件", entries: [{id: "click-1", name: "click", payload: {count: 1}}, {id: "update-1", name: "update:modelValue"}]}}},
            {id: "empty", label: "空列表", input: {props: {emptyText: "还没有事件", entries: []}}},
        ], load: async () => (await import("./EventLogPanelFixture.vue")).default,
    }),
    defineLabFixture<typeof HighlightBox>({
        component: "HighlightBox", scenes: [
            {id: "subject", label: "零件档（实线）", input: {props: {label: "EventLogPanel  320 × 180", tone: "subject", rect: {top: 80, left: 80, width: 260, height: 120}}}},
            {id: "probe", label: "探针档（虚线）", input: {props: {label: "div.flex.items-center  296 × 28", tone: "probe", rect: {top: 80, left: 80, width: 296, height: 28}}}},
            {id: "no-label", label: "只画框不带标签", input: {props: {label: "", tone: "subject", rect: {top: 80, left: 80, width: 200, height: 200}}}},
            {id: "none", label: "没有要框的东西", input: {props: {label: "看不见我", tone: "subject", rect: null}}},
        ], load: async () => (await import("./HighlightBoxFixture.vue")).default,
    }),
    defineLabFixture<typeof FixtureExample>({
        component: "FixtureExample",
        slots: ["extra"],
        scenes: [
            {
                id: "default",
                label: "默认受控卡片（居中与标准材质示范）",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "active",
                label: "激活态与高亮外框",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "busy",
                label: "忙碌呼吸状态",
                input: {
                    props: {
                        title: "正在生成第三卷剧情推演",
                        description: "后台正在计算角色动机转移概率矩阵与未回收伏笔拓扑图...",
                        status: "busy",
                        count: 99,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "warning",
                label: "警告冲突状态",
                input: {
                    props: {
                        title: "检测到人物性格设定冲突",
                        description: "角色「沈屿」在第二章的对话用词与素材库口吻约定存在 2 处偏差。",
                        status: "warning",
                        count: 2,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: false},
                },
            },
            {
                id: "disabled",
                label: "禁用态",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: true,
                    },
                    slots: {extra: false},
                },
            },
        ],
        load: async () => (await import("./FixtureExampleFixture.vue")).default,
    }),
    defineLabFixture<typeof JsonViewer>({
        component: "JsonViewer", scenes: [
            {id: "object", label: "对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {id: "chapter-01", title: "第一章", wordCount: 3182, tags: ["草稿", "待审"], meta: {createdAt: "2026-08-01T10:00:00Z", author: null, pinned: false}}}}},
            {id: "array", label: "数组", input: {props: {readOnly: false, maxHeight: 320}, model: {value: [{tool: "read_file", ok: true, ms: 12}, {tool: "write_file", ok: false, ms: 340}, {tool: "list_dir", ok: true, ms: 3}]}}},
            {id: "text", label: "未写完的字符串", input: {props: {readOnly: false, maxHeight: 320}, model: {value: '{\n  "unfinished": tru'}}},
            {id: "empty", label: "空对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {}}}},
        ], load: async () => (await import("./JsonViewerFixture.vue")).default,
    }),
    defineLabFixture<typeof SurfaceTierDemo>({
        component: "SurfaceTierDemo", noInput: "该组件没有可编辑输入",
        scenes: [{id: "default", label: "5 档对照"}],
        load: async () => (await import("./SurfaceTierDemoFixture.vue")).default,
    }),
    defineSubjectFixture<typeof TitleActions>({
        component: "TitleActions",
        events: ["run"],
        scenes: (() => {
            const entry = (key: string, command: string, icon: string | null, title: string, extra: {disabledReason?: string; pressed?: boolean} = {}) => ({
                key, command, icon, title,
                disabledReason: extra.disabledReason ?? null,
                ...(extra.pressed === undefined ? {} : {pressed: extra.pressed}),
            });
            const buttons = (manifests: boolean, canCreate: boolean) => [
                entry("own:0", "nbook.files.new-file", "i-lucide-file-plus", "新建文件", canCreate ? {} : {disabledReason: "没有可以新建的位置"}),
                entry("own:1", "nbook.files.new-folder", "i-lucide-folder-plus", "新建文件夹", canCreate ? {} : {disabledReason: "没有可以新建的位置"}),
                entry("own:2", "nbook.view.refresh-files", "i-lucide-refresh-cw", "刷新"),
                entry("own:3", "nbook.files.collapse-all", "i-lucide-copy-minus", "全部收起"),
                entry("own:4", "nbook.files.toggle-manifests", "i-lucide-file-code", "显示清单文件", {pressed: manifests}),
            ];
            const base = {identity: "nbook.files|view:nbook.files|single|published|1", moreLabel: "更多操作"};
            const menu = [
                [entry("own:5", "nbook.files.toggle-hidden", null, "显示隐藏文件", {pressed: true}), entry("own:6", "nbook.files.reveal-in-system", "i-lucide-folder-open", "在系统中显示")],
                [entry("acme.export.selection", "acme.export.selection", "i-lucide-download", "导出选中的章节", {disabledReason: "没有选中的章节"})],
            ];
            return [
                {id: "default", label: "资源管理器的五个动作", input: {props: {...base, model: {buttons: buttons(false, true), menu: []}}}},
                {id: "pressed", label: "开关按下", input: {props: {...base, model: {buttons: buttons(true, true), menu: []}}}},
                {id: "disabled", label: "不可用：禁用并给出原因", input: {props: {...base, model: {buttons: buttons(false, false), menu: []}}}},
                {id: "more", label: "“⋯”：自己的菜单动作与别的插件贡献的（分节、勾选、禁用带原因）", input: {props: {...base, model: {buttons: buttons(false, true), menu}}}},
            ];
        })(),
        subject: () => import("nbook/ui/menus/TitleActions.vue"),
    }),
    defineLabFixture<typeof InlineChip>({
        component: "InlineChip",
        scenes: [
            {id: "reference", label: "引用作品里的文件", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md"}}},
            {id: "reference-image", label: "引用一张图片", input: {props: {kind: "reference", label: "地图", target: "/资料/地图.png"}}},
            {id: "attachment", label: "引用会话附件", input: {props: {kind: "reference", label: "截图", target: "session://attachments/截图.png"}}},
            {id: "external", label: "外部链接", input: {props: {kind: "reference", label: "官网", target: "https://example.com"}}},
            {id: "other", label: "旧应用的领域地址", input: {props: {kind: "reference", label: "第一章", target: "chapter://c1"}}},
            {id: "long", label: "过长的名称截断", input: {props: {kind: "reference", label: "一个非常非常非常非常非常非常长的设定文件名字", target: "/设定/很长.md"}}},
            {id: "skill", label: "技能", input: {props: {kind: "skill", label: "reviewer"}}},
            {id: "selection", label: "选区", input: {props: {kind: "selection", label: "第一章.md#L3-L8"}}},
            {id: "command", label: "命令", input: {props: {kind: "command", label: "plan"}}},
            {id: "image", label: "图片 #1", input: {props: {kind: "image", number: 1}}},
            {id: "uploading", label: "文件上传中", input: {props: {kind: "file", label: "笔记.txt", number: 2, state: "uploading"}}},
            {id: "failed", label: "上传失败", input: {props: {kind: "image", number: 3, state: "failed", error: "文件太大"}}},
            {id: "paste", label: "粘贴位置", input: {props: {kind: "paste", number: 4}}},
            {id: "highlighted", label: "联动高亮", input: {props: {kind: "image", number: 1, highlighted: true}}},
            {id: "selected", label: "在选区里", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md", selected: true}}},
            {id: "interactive", label: "可聚焦（静态显示里）", input: {props: {kind: "reference", label: "林雪", target: "/设定/林雪.md", interactive: true}}},
            {id: "english", label: "英文界面", input: {props: {kind: "file", label: "notes.txt", number: 2, state: "uploading"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./InlineChipFixture.vue")).default),
    }),
    defineLabFixture<typeof MarkdownDisplay>({
        component: "MarkdownDisplay",
        scenes: [
            {id: "reply", label: "一条完整的回复（各方言）", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "streaming", label: "流式追加", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "conversation", label: "100 条消息的长对话", input: {props: {text: DISPLAY_REPLY, locale: "zh-CN"}}},
            {id: "plain", label: "只有普通 Markdown", input: {props: {text: "## 小结\n\n- 第一章节奏**偏快**\n- 第二章的*伏笔*可以提前，~~旧的开头~~删掉\n\n#### 细节\n\n---\n\n```ts\nconst answer = 42;\n```\n\n| 章 | 字数 |\n|---|---|\n| 一 | 3200 |", locale: "zh-CN"}}},
            {id: "empty", label: "空文本", input: {props: {text: "", locale: "zh-CN"}}},
            {id: "stickers", label: "表情：夹在文字里、一段只有表情的大图、认不出的原文", input: {props: {text: LAB_STICKER_TEXT, locale: "zh-CN"}}},
            {id: "stickers-late", label: "表情：目录晚到，先显示原文占位", input: {props: {text: LAB_STICKER_TEXT, locale: "zh-CN"}}},
            {id: "stickers-display", label: "表情包按贴纸显示：夹在文字里的也是大图，点图发出 sticker", input: {props: {text: LAB_STICKER_TEXT, locale: "zh-CN"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./MarkdownDisplayFixture.vue")).default),
    }),
    defineLabFixture<typeof PromptEditor>({
        component: "PromptEditor",
        scenes: promptEditorScenes,
        load: async () => withMarkdownSceneText((await import("./prompt-scene/PromptEditorFixture.vue")).default),
    }),
    // 这三个零件经场景端口取文字（`markdown-text.ts`），所以不用 defineSubjectFixture，自己包一层（同 ExplorerTree）。
    defineLabFixture<typeof PromptTextView>({
        component: "PromptTextView",
        scenes: promptTextViewScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptTextView>(withNbookMarkdownHost((await import("@notnotype/nb-markdown/prompt")).PromptTextView).default, {
            events: ["token-activate"],
            class: "w-full p-4 text-[13px] leading-[1.6] text-[var(--text-main)]",
            runtimeProps: {resolveThumbnail: (target: string) => PROMPT_LAB_THUMBNAILS[target] ?? null},
        })),
    }),
    defineLabFixture<typeof PromptAttachmentStrip>({
        component: "PromptAttachmentStrip",
        scenes: promptAttachmentStripScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptAttachmentStrip>((await import("@notnotype/nb-markdown/prompt")).PromptAttachmentStrip, {
            events: ["activate", "remove", "retry", "hover"],
            writeBack: {hover: {layer: "props", key: "highlighted"}},
            class: "w-full",
        })),
    }),
    defineLabFixture<typeof PromptPasteFrame>({
        component: "PromptPasteFrame",
        scenes: promptPasteFrameScenes,
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof PromptPasteFrame>((await import("@notnotype/nb-markdown/prompt")).PromptPasteFrame, {
            events: ["hover"],
            class: "w-full",
        })),
    }),
    // 属性面板：写回直接改场景的 `raw` 与 `open`，点一下就能看到改过的原文（数据 tab）。
    defineLabFixture<typeof MarkdownProperties>({
        component: "MarkdownProperties",
        scenes: [
            {id: "open", label: "展开：五种类型各一个", input: {props: {raw: PROPERTIES_SAMPLE}, model: {open: true}}},
            {id: "closed", label: "收起：一行摘要", input: {props: {raw: PROPERTIES_SAMPLE}, model: {open: false}}},
            {id: "complex", label: "表示不了的属性", input: {props: {raw: `${PROPERTIES_SAMPLE.slice(0, -4)}人物关系:\n  林雪: 姐妹\n  沈舟: 旧识\n---\n`}, model: {open: true}}},
            {id: "error", label: "YAML 写错", input: {props: {raw: "---\n视角: 林雪\n时间: 2025-12-21\n地点: [青石镇, 北山\n字数目标: 4000\n---\n"}, model: {open: false}}},
            {id: "empty", label: "没有属性", input: {props: {raw: "---\n---\n"}, model: {open: true}}},
            {id: "long", label: "很长的名字与值", input: {props: {raw: "---\n这一章里出场的所有人物与他们的别名: [林雪, 雪儿, 沈舟, 舟哥, 掌柜, 渡口的船夫, 北山的猎户]\n一句很长的提要: 雪是后半夜落下来的，林雪推开客栈的窗，镇子已经白了一层，石板路上只剩一行脚印\n---\n"}, model: {open: true}}},
            {id: "readonly", label: "只读", input: {props: {raw: PROPERTIES_SAMPLE, readonly: true}, model: {open: true}}},
            {id: "english", label: "英文界面", input: {props: {raw: "---\npov: Lin Xue\ndate: 2025-12-21\nplaces: [Qingshi, North Hill]\nword goal: 4000\nfinal: false\n---\n"}, model: {open: false}}},
            // 宿主按属性名给图标、显示名与类型（输出 60）：`describe` 是运行期的函数，下面的 `runtimeProps` 给；只有这个场景里的键（`叙事视角` 等）有声明，别的场景不受影响。
            {id: "declared", label: "插件的声明：图标、显示名、空值按声明的类型输入", input: {props: {raw: "---\n叙事视角: 林雪\n截稿日:\n预计字数:\n定稿:\n关键词:\n地点: 青石镇\n---\n"}, model: {open: true}}},
            {id: "declared-long", label: "插件的声明：很长的显示名；表示不了的行有显示名、图标不换", input: {props: {raw: "---\n人物别名: [林雪, 雪儿]\n人物关系:\n  林雪: 姐妹\n  沈舟: 旧识\n---\n"}, model: {open: true}}},
            {id: "declared-readonly", label: "插件的声明：只读（显示名照出，不能点着改名）", input: {props: {raw: "---\n叙事视角: 林雪\n截稿日: 2025-12-21\n预计字数: 4000\n定稿: true\n关键词: [雪, 客栈]\n---\n", readonly: true}, model: {open: true}}},
            {id: "declared-english", label: "插件的声明：英文的显示名", input: {props: {raw: "---\npov: Lin Xue\ndue:\nword goal: 4000\n---\n"}, model: {open: true}}},
        ],
        load: async () => withMarkdownSceneText(createSubjectFixture<typeof MarkdownProperties>((await import("@notnotype/nb-markdown/editor")).MarkdownProperties, {
            events: ["commit", "update:open", "leave"],
            writeBack: {commit: {layer: "props", key: "raw"}},
            class: "w-full max-w-[720px]",
            runtimeProps: {describe: (name: string) => PROPERTY_DECLARATIONS[name] ?? null},
        })),
    }),
    defineLabFixture<typeof MarkdownImage>({
        component: "MarkdownImage",
        scenes: [
            {id: "shown", label: "显示", input: {props: {src: "images/封面.png", alt: "封面", title: "第一卷封面"}}},
            {id: "loading", label: "读取中", input: {props: {src: "lab://loading", alt: "封面"}}},
            {id: "outside", label: "不在作品里", input: {props: {src: "lab://outside", alt: "外面的图"}}},
            {id: "broken", label: "读不出", input: {props: {src: "lab://broken", alt: "坏图"}}},
            {id: "no-alt", label: "没有说明", input: {props: {src: "lab://outside"}}},
        ],
        load: async () => withMarkdownSceneText((await import("./MarkdownImageFixture.vue")).default),
    }),
    defineLabFixture<typeof FileIcon>({
        component: "FileIcon",
        scenes: [
            {id: "markdown", label: "Markdown 文件", input: {props: {icon: "markdown"}}},
            {id: "content-open", label: "展开的内容文件夹", input: {props: {icon: "folder-content-open"}}},
            {id: "image", label: "图片", input: {props: {icon: "image"}}},
        ],
        load: async () => (await import("./FileIconFixture.vue")).default,
    }),
    defineSubjectFixture<typeof SkillChip>({
        component: "SkillChip",
        scenes: [
            {id: "skill", label: "技能名", input: {props: {name: "novel-outline"}}},
            {id: "long-name", label: "长技能名", input: {props: {name: "novel-character-motivation-and-continuity-review"}}},
        ],
        subject: () => import("nbook/ui/SkillChip.vue"),
        class: "max-w-full",
    }),
    defineSubjectFixture<typeof NeuroBookLockup>({
        component: "NeuroBookLockup",
        noInput: "字标没有 prop：大小由使用方的 class 给，颜色跟随文字色。",
        scenes: [
            {id: "title", label: "标题栏大小（26px）"},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookLockup.vue"),
        class: "h-[26px] text-[var(--text-main)]",
    }),
    defineSubjectFixture<typeof NeuroBookMark>({
        component: "NeuroBookMark",
        scenes: [
            {id: "titlebar", label: "窄标题栏大小（18px）", input: {props: {decorative: false}}},
            {id: "decorative", label: "纯装饰（对读屏隐藏）", input: {props: {decorative: true}}},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookMark.vue"),
        class: "h-[18px] text-[var(--text-main)]",
    }),
    defineSubjectFixture<typeof NeuroBookMood>({
        component: "NeuroBookMood",
        scenes: [
            {id: "focus", label: "专注（看书）", input: {props: {state: "focus"}}},
            {id: "write", label: "写作中", input: {props: {state: "write"}}},
            {id: "idle", label: "空闲（跟着鼠标看）", input: {props: {state: "idle"}}},
            {id: "think", label: "思考", input: {props: {state: "think"}}},
            {id: "ask", label: "等你选择", input: {props: {state: "ask"}}},
            {id: "done", label: "完成", input: {props: {state: "done"}}},
            {id: "error", label: "出错", input: {props: {state: "error"}}},
            {id: "sleep", label: "睡着", input: {props: {state: "sleep"}}},
            {id: "dark", label: "深色底（透明）", input: {props: {state: "idea", variant: "dark"}}},
        ],
        subject: () => import("nbook/ui/brand/NeuroBookMood.vue"),
        class: "w-28",
    }),
    defineLabFixture<typeof ProviderLogo>({
        component: "ProviderLogo",
        scenes: [
            {id: "image", label: "多色图（DeepSeek）", input: {props: {id: "deepseek", name: "DeepSeek", size: 28}}},
            {id: "search", label: "搜索服务（Tavily）", input: {props: {id: "tavily", name: "Tavily", size: 28}}},
            {id: "initial", label: "图标表里没有：首字母块", input: {props: {id: "nowhere", name: "博查", size: 28}}},
        ],
        load: async () => createSubjectFixture<typeof ProviderLogo>((await import("nbook/ui/provider-icons/ProviderLogo.vue")).default, {class: "p-4"}),
    }),
    ...settingsFixtures(),
    ...nbUiFixtures,
    ...nbFormFixtures,
    ...nbLayoutFixtures,
    ...nbAgentUiFixtures,
];


/** 设置页用的共用组件（`src/ui/settings/`）：SettingsRow 由设置场景的局部宿主驱动（`plugins/settings/web/lab/settings-host.ts`）。 */
function settingsFixtures(): LabFixture[] {
    const row = (setting: typeof appearanceSetting | typeof sceneThemeSetting | typeof localeSetting | typeof snippetsSettings.items | typeof rowDemoSettings.workers | typeof rowDemoSettings.library | typeof rowDemoSettings.mode, layer: "user" | "project", wide = false) => ({setting, layer, projectTitle: "雾港", wide});
    /** 状态原因：出错、警告、淡色各一条，看图标取最重的色调、提示逐条列出。 */
    const reasons = [
        {tone: "error" as const, text: "未保存：取值范围为 1–8"},
        {tone: "warning" as const, text: "这个值偏大，抽取会很慢"},
        {tone: "muted" as const, text: "无法加载选项：插件“模型服务”已停止"},
    ];
    return [
        defineLabFixture<typeof SettingsRow>({
            component: "SettingsRow",
            scenes: [
                {id: "modified", label: "用户层已修改", input: {props: row(appearanceSetting, "user")}},
                {id: "overridden", label: "被本作品覆盖", input: {props: row(appearanceSetting, "user")}},
                {id: "inherit", label: "本作品标签：沿用（来自用户设置）", input: {props: row(sceneThemeSetting, "project")}},
                {id: "project-set", label: "本作品标签：单独设置了", input: {props: row(appearanceSetting, "project")}},
                {id: "invalid", label: "层文件有错误（停用）", input: {props: row(appearanceSetting, "user")}},
                {id: "unreachable", label: "层连不上（停用）", input: {props: row(appearanceSetting, "user")}},
                {id: "wide", label: "宽排法：控件另起一行", input: {props: row(snippetsSettings.items, "user", true)}},
                {id: "not-allowed", label: "不允许这一层", input: {props: row(localeSetting, "project")}},
                {id: "multi-reason", label: "多个状态原因（一个图标，色调取最重的）", input: {props: {...row(rowDemoSettings.workers, "user"), reasons}}},
                {id: "read-only", label: "只读：只写值，最右一格是锁", input: {props: row(rowDemoSettings.library, "user")}},
                {id: "project-wide-inherit", label: "本作品标签：宽排法沿用", input: {props: row(snippetsSettings.items, "project", true)}},
                {id: "narrow", label: "560px 宽：控件换到标题下面", input: {props: row(rowDemoSettings.mode, "user")}},
            ],
            load: async () => (await import("./SettingsRowFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsActionRow>({
            component: "SettingsActionRow",
            slots: ["default"],
            scenes: [
                {id: "idle", label: "空闲：没有状态（测试代理那一行）", input: {props: {title: "测试代理"}, slots: {default: true}}},
                {id: "success", label: "成功", input: {props: {title: "测试代理", status: "连接成功：出口 IP 203.0.113.7，286 ms", tone: "success"}, slots: {default: true}}},
                {id: "danger", label: "带说明、失败（长文字折行）", input: {props: {title: "现在更新", description: "2026/11/20 09:30 更新过，共 1,104 个模型", status: "上次更新失败：代理设置无效（the system proxy uses an automatic configuration script, which is not supported）", tone: "danger"}, slots: {default: true}}},
                {id: "muted", label: "淡色状态", input: {props: {title: "测试代理", status: "正在测试…", tone: "muted"}, slots: {default: true}}},
            ],
            load: async () => withSettingsText(createSubjectFixture<typeof SettingsActionRow>((await import("nbook/ui/settings/SettingsActionRow.vue")).default, {class: "w-full"})),
        }),
        defineLabFixture<typeof SettingsNotice>({
            component: "SettingsNotice",
            slots: ["default"],
            scenes: [
                {id: "warning", label: "警告", input: {props: {tone: "warning"}, slots: {default: true}}},
                {id: "danger", label: "错误", input: {props: {tone: "danger"}, slots: {default: true}}},
                {id: "button", label: "整块是按钮", input: {props: {as: "button"}, slots: {default: true}}},
            ],
            load: async () => createSubjectFixture<typeof SettingsNotice>((await import("nbook/ui/settings/SettingsNotice.vue")).default),
        }),
        defineLabFixture<typeof SettingsPageActions>({
            component: "SettingsPageActions",
            noInput: "操作由插槽给出，层能不能写由窗口通道给出，没有可登记的 JSON 输入",
            scenes: [
                {id: "in-place", label: "没有窗口通道：一个操作原位渲染"},
                {id: "multiple", label: "没有窗口通道：多个操作（按钮与图标按钮）"},
                {id: "in-title", label: "有窗口通道：操作画在标题区右侧"},
                {id: "disabled", label: "有窗口通道、这一层不能写：操作整体停用，可切换恢复"},
            ],
            load: async () => (await import("./SettingsPageActionsFixture.vue")).default,
        }),
        defineLabFixture<typeof SettingsSaveBar>({
            component: "SettingsSaveBar",
            scenes: [
                {id: "clean", label: "没有改动：两个按钮停用，不写字", input: {props: {dirty: false, busy: false}}},
                {id: "dirty", label: "有改动：缺省文字，按钮可用", input: {props: {dirty: true, busy: false}}},
                {id: "busy", label: "保存中：按钮停用", input: {props: {dirty: true, busy: true}}},
                {id: "message", label: "自定义文字", input: {props: {dirty: true, busy: false, message: "还没保存：“接口地址”还没有填写"}}},
                {id: "english", label: "英文界面", input: {props: {dirty: true, busy: false}}},
            ],
            load: async () => withSettingsText(createSubjectFixture<typeof SettingsSaveBar>((await import("nbook/ui/settings/SettingsSaveBar.vue")).default, {class: "w-full"})),
        }),
        defineSubjectFixture<typeof HighlightedText>({
            component: "HighlightedText",
            scenes: [
                {id: "single", label: "一个词：标题里的命中", input: {props: {text: "终端字号", words: ["字号"]}}},
                {id: "multi", label: "多个词、每个词的所有命中都标", input: {props: {text: "代码里的字号与行距；字号越大越清楚", words: ["字号", "行距"]}}},
                {id: "case", label: "不分大小写，标出的是原文的写法", input: {props: {text: "Font Size 与 FONT 与 font", words: ["font"]}}},
                {id: "escaped", label: "尖括号、&、正则元字符按文字显示与查找", input: {props: {text: "<b>粗体</b> & (a+b)* .*", words: ["<b>", "&", "(a+b)*", ".*"]}}},
                {id: "none", label: "没有命中：原样显示", input: {props: {text: "界面的主题与语言", words: ["字号"]}}},
            ],
            subject: () => import("nbook/ui/settings/HighlightedText.vue"),
        }),
        defineLabFixture<typeof SettingsPageList>({
            component: "SettingsPageList",
            scenes: (() => {
                const providers = [
                    {id: "deepseek", title: "DeepSeek", description: "https://api.deepseek.com", icon: "i-lucide-server", status: "已连接", tone: "success" as const, modified: true},
                    {id: "ollama", title: "本地 Ollama", description: "http://127.0.0.1:11434/v1", icon: "i-lucide-server", status: "未连接"},
                    {id: "openai", title: "OpenAI", description: "https://api.openai.com/v1", icon: "i-lucide-server", status: "密钥已过期", tone: "warning" as const},
                    {id: "custom", title: "自建服务", description: "http://llm.internal/v1", icon: "i-lucide-server", status: "连接失败", tone: "error" as const},
                ];
                const long = [
                    {id: "a", title: "一个名字很长很长的自建兼容服务（内网环境下的备用线路）", description: "https://llm.internal.example.com/v1/chat/completions/with/a/very/long/path", icon: "i-lucide-server", status: "已连接", tone: "success" as const, modified: true},
                    {id: "b", title: "备用"},
                ];
                return [
                    {id: "list", label: "列表：图标、说明、状态色调（成功、淡色、警告、出错）与改动圆点", input: {props: {items: providers, label: "服务商"}, model: {modelValue: null}}},
                    {id: "long", label: "长标题与长说明截断，状态文字不缩", input: {props: {items: long, label: "服务商"}, model: {modelValue: null}}},
                    {id: "open", label: "打开一项（没有窗口通道）：详情上方自己画“‹ 返回”，返回后焦点回到这一行", input: {props: {items: providers, label: "服务商"}, model: {modelValue: "deepseek"}}},
                    {id: "open-in-title", label: "打开一项（有窗口通道）：标题区换成“‹ 模型服务”与这一项的标题", input: {props: {items: providers, label: "服务商"}, model: {modelValue: "deepseek"}}},
                ];
            })(),
            load: async () => (await import("./SettingsPageListFixture.vue")).default,
        }),
    ];
}

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
