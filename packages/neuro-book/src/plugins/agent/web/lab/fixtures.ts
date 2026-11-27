import {createSubjectFixture, defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type StatusLinePage from "nbook/plugins/agent/web/components/StatusLinePage.vue";
import {withAgentPageText} from "./agent-page-text";
import type PermissionRulesPage from "nbook/plugins/agent/web/components/PermissionRulesPage.vue";
import type ProfileSettingsPage from "nbook/plugins/agent/web/components/ProfileSettingsPage.vue";
import {SAMPLE_PROFILES, SAMPLE_WRITER_TOOLS, SAMPLE_TOOL_CANDIDATES} from "./profile-samples";
import type SubagentCard from "nbook/plugins/agent/web/components/SubagentCard.vue";
import {sampleProps, CARD_SAMPLES, ENTRY_PROFILES, COMMAND_SAMPLES} from "./subagent-samples";
import type SubagentsEntry from "nbook/plugins/agent/web/components/SubagentsEntry.vue";
import type ContactCover from "nbook/plugins/agent/web/components/ContactCover.vue";
import type DeskCompanion from "nbook/plugins/agent/web/components/DeskCompanion.vue";
import type BackgroundCommandCard from "nbook/plugins/agent/web/components/BackgroundCommandCard.vue";
import type ProfileRail from "nbook/plugins/agent/web/components/ProfileRail.vue";
import type ProfileDetail from "nbook/plugins/agent/web/components/ProfileDetail.vue";
import type ProfileToolsSection from "nbook/plugins/agent/web/components/ProfileToolsSection.vue";
import type AddToolsDialog from "nbook/plugins/agent/web/components/AddToolsDialog.vue";
import type NewProfileDialog from "nbook/plugins/agent/web/components/NewProfileDialog.vue";
import type SkillsSettingsPage from "nbook/plugins/agent/web/components/SkillsSettingsPage.vue";
import type {SkillEntry} from "nbook/plugins/agent/shared/skills";
import type SkillInitDialog from "nbook/plugins/agent/web/components/SkillInitDialog.vue";

/**
 * 场景登记。这不是第二份组件清单——组件清单由 component-index 扫文档得到，
 * 这里只补文档里没有的东西：一个组件可以摆出哪几个场景。两者按组件名对上。
 */

/** Skill 页的场景数据：长短不一的名字放在一起，看徽标与按钮是否落在同一列。 */
const SKILL_PAGE_ENTRIES: readonly SkillEntry[] = [
    {id: "user.style-guide", name: "style-guide", description: "按本书的文风规则改写一段：人称、时态、对白格式与禁用词。", source: "user", location: "skills://user.style-guide/SKILL.md", status: "ready", license: "MIT"},
    {id: "user.epub-export", name: "epub-export", description: "把选中的章节导成 EPUB，带目录、封面与脚注。", source: "user", location: "skills://user.epub-export/SKILL.md", status: "needs-init"},
    {id: "user.lore-check", name: "lore-check", description: "对照人物卡与设定集，找出正文里前后矛盾的地方。", source: "user", location: "skills://user.lore-check/SKILL.md", status: "needs-init", problem: {code: "install-failed", detail: "error: GET https://registry.npmjs.org/epub-gen-memory - ETIMEDOUT"}},
    {id: "user.tts-preview", name: "tts-preview", description: "用本机的语音合成朗读选中的一段，听对白的节奏。", source: "user", location: "skills://user.tts-preview/SKILL.md", status: "initializing"},
    {id: "user.outline", name: "outline", description: "", source: "user", location: "skills://user.outline/SKILL.md", status: "invalid", problem: {code: "name-mismatch", name: "outline-helper"}},
    {id: "user.voice-check-with-a-much-longer-name", name: "voice-check-with-a-much-longer-name", description: "逐段检查叙述视角有没有串，标出越界的句子。", source: "user", location: "skills://user.voice-check-with-a-much-longer-name/SKILL.md", status: "ready", external: {python: true, uvMissing: true, compatibility: "需要 Python 3.11 以上与 uv；朗读用的 espeak-ng 要自己装"}, metadata: {author: "林默", version: "0.3"}},
    {id: "acme.docs.pdf-extract", name: "pdf-extract", description: "从扫描的 PDF 里抽出正文与页码，按章分段。", source: "plugin", plugin: {id: "acme.docs", title: "文档工具"}, location: "skills://acme.docs.pdf-extract/SKILL.md", status: "ready"},
    {id: "acme.docs.raw-notes", name: "raw-notes", description: "把采访录音的转写整理成按人物分的笔记。", source: "plugin", plugin: {id: "acme.docs", title: "文档工具"}, location: "skills://acme.docs.raw-notes/SKILL.md", status: "invalid", problem: {code: "plugin-skill-unbuilt"}},
    // 没有显示名的插件，组头写插件 id；id 很长时组头要折行，不撑出页面。
    {id: "someverylongpublishername.averyveryverylongpluginnamewithoutbreaks.lint", name: "lint", description: "按本书的禁用词表检查选中的章节。", source: "plugin", plugin: {id: "someverylongpublishername.averyveryverylongpluginnamewithoutbreaks", title: null}, location: "skills://someverylongpublishername.averyveryverylongpluginnamewithoutbreaks.lint/SKILL.md", status: "ready"},
    {id: "builtin.chapter-summary", name: "chapter-summary", description: "给一章写三五句提要，写进章节的元数据。", source: "builtin", location: "skills://builtin.chapter-summary/SKILL.md", status: "ready"},
];


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof StatusLinePage>({
        component: "StatusLinePage",
        scenes: [
            {id: "default", label: "缺省：左边上下文，右边用量与费用，模型默认关", input: {props: {setting: {}}}},
            {id: "customized", label: "改过：用量排到费用后面，开了模型与插件的字数", input: {props: {setting: {order: ["cost", "usage"], visible: {model: true, "x.words": true}}, pluginItems: [{id: "x.words", side: "left", title: "本会话改的字数", description: "来自插件“字数统计”", defaultVisible: false, source: "x"}]}}},
            {id: "readonly", label: "配置写不了：勾选与按钮都停用", input: {props: {setting: {}, writable: false}}},
            {id: "crossed", label: "换过边：用量在左边第一位，上下文在右边最后", input: {props: {setting: {order: ["usage", "cost", "model", "context"], side: {usage: "left", context: "right"}}}}},
            {id: "write-fails", label: "写入失败：拖动放下后回到原样", input: {props: {setting: {}}}},
        ],
        load: async () => withAgentPageText((await import("./StatusLineFixture.vue")).default),
    }),
    defineLabFixture<typeof PermissionRulesPage>({
        component: "PermissionRulesPage",
        scenes: [
            {id: "rules", label: "我的规则：命令、路径、关键词、放行、自定义条件", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}]}}},
            {id: "empty", label: "还没有规则", input: {props: {rules: []}}},
            {id: "project", label: "绑定作品：这本书的规则只读，放行标不生效", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], projectTitle: "雨夜", projectRules: [{tool: "write", when: {type: "path", glob: "project://设定/**", access: "write"}, action: "ask" as const, reason: "设定要作者点头"}, {tool: "shell", action: "allow" as const}]}}},
            {id: "project-invalid", label: "作品的规则文件坏了", input: {props: {rules: [], projectTitle: "雨夜", projectRules: "invalid"}}},
            {id: "add", label: "添加规则：对话框", input: {props: {rules: [], initialEdit: "new"}}},
            {id: "edit", label: "编辑规则：命令", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], initialEdit: 0}}},
            {id: "edit-json", label: "编辑规则：自定义条件是 JSON", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], initialEdit: 4}}},
            {id: "readonly", label: "配置写不了", input: {props: {rules: [{tool: "shell", when: {type: "command", pattern: "git push *"}, action: "deny" as const, reason: "不要推送，先让用户看"}, {tool: "write", when: {type: "path", glob: "project://正文/**", access: "write"}, action: "ask" as const}, {tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: ["血腥", "暴力"]}, action: "deny" as const}, {tool: "shell", when: {type: "command", pattern: "git diff *"}, action: "allow" as const}, {tool: "ssh", when: {all: [{type: "subject", kind: "host", glob: "prod*"}, {type: "command", pattern: "rm *"}]}, action: "deny" as const}], writable: false}}},
        ],
        load: async () => withAgentPageText((await import("./PermissionRulesFixture.vue")).default),
    }),
    defineLabFixture<typeof ProfileSettingsPage>({
        component: "ProfileSettingsPage",
        scenes: [
            {id: "builtin", label: "内置 Profile", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "nbook.agent.main"}}},
            {id: "user", label: "用户级：打开、删除，模型不满足要求", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "user.lore-check"}}},
            {id: "broken", label: "用户级：打包失败", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "user.draft-review"}}},
            {id: "unavailable", label: "插件 Profile：缺必需工具", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "plot.qa"}}},
            {id: "background", label: "后台 Profile：只有模型", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "nbook.agent.session-title"}}},
            {id: "narrow", label: "480px 宽：左栏收成下拉", input: {props: {state: "ready", profiles: SAMPLE_PROFILES}}},
            {id: "readonly", label: "这一层不能写", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, writable: false, initial: "user.lore-check"}}},
            {id: "loading", label: "读取中", input: {props: {state: "loading", profiles: []}}},
            {id: "failed", label: "读失败", input: {props: {state: {failed: "unavailable"}, profiles: []}}},
            {id: "narrow-broken", label: "480px 宽，有问题块", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "user.draft-review"}}},
            {id: "english", label: "英文界面：有必需工具", input: {props: {state: "ready", profiles: SAMPLE_PROFILES, initial: "nbook.agent.main"}}},
        ],
        load: async () => withAgentPageText((await import("./ProfileSettingsFixture.vue")).default),
    }),
    defineLabFixture<typeof SubagentCard>({
        component: "SubagentCard",
        scenes: ([["running", "运行中：最近一步、次数与用时"], ["question", "在问父 Agent"], ["waiting", "等你批准"], ["done", "完成：点开看结果全文"], ["failed", "出错"], ["dispatch-failed", "没派出去"], ["background", "后台、名字很长"], ["unknown", "进程崩溃后：状态未知"], ["running-narrow", "390px 宽"], ["background-narrow", "390px 宽、名字很长"]] as const).map(([id, label]) => ({id, label, input: {props: sampleProps(CARD_SAMPLES[id.replace(/-narrow$/u, "")]!)}})),
        load: async () => withAgentPageText((await import("./SubagentCardFixture.vue")).default),
    }),
    defineLabFixture<typeof SubagentsEntry>({
        component: "SubagentsEntry",
        scenes: [
            {id: "list", label: "浮层开着：等你批准、在跑（带孙代理）、完成、出错", input: {props: {profiles: ENTRY_PROFILES}, model: {open: true}}},
            {id: "dot", label: "关着：有没看过的出错，入口亮红点", input: {props: {profiles: ENTRY_PROFILES}, model: {open: false}}},
            {id: "empty", label: "没有后代：入口不画", input: {props: {profiles: ENTRY_PROFILES}, model: {open: false}}},
        ],
        load: async () => withAgentPageText((await import("./SubagentsEntryFixture.vue")).default),
    }),
    defineLabFixture<typeof ContactCover>({
        component: "ContactCover",
        scenes: [
            {id: "no-model", label: "没有模型：去添加", input: {props: {cover: {kind: "pending", pending: {key: "nbook.bots/lyra", name: "星璃", step: "no-model"}}}}},
            {id: "opening", label: "正在打开", input: {props: {cover: {kind: "pending", pending: {key: "nbook.bots/lyra", name: "星璃", step: "opening"}}}}},
            {id: "failed", label: "打不开：原因与重试", input: {props: {cover: {kind: "pending", pending: {key: "nbook.bots/lyra", name: "星璃", step: "failed", code: "session-busy"}}}}},
            {id: "pick-bot", label: "还没选 bot", input: {props: {cover: {kind: "pick-bot"}}}},
            {id: "missing", label: "找不到 bot", input: {props: {cover: {kind: "missing"}}}},
        ],
        load: async () => withAgentPageText((await import("./ContactCoverFixture.vue")).default),
    }),
    defineLabFixture<typeof DeskCompanion>({
        component: "DeskCompanion",
        // 联系人、宿主与面板里的对话是运行时对象，不进场景输入：夹具按场景 id 自己造（见 DeskCompanionFixture.vue），这里只占位。
        scenes: [
            {id: "unread", label: "有未读：右上角计数，气泡写最后一句", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
            {id: "waiting", label: "等你处理：黄色感叹号，猫换提问的表情", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
            {id: "none", label: "没有联系人：不能点的猫", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
            {id: "failed", label: "读不到：悬停提示原因", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
            {id: "unread-english", label: "英文界面：长句截断", input: {props: {providers: [], activity: [], hasModel: true, conversation: {}}}},
        ],
        load: async () => withAgentPageText((await import("./DeskCompanionFixture.vue")).default),
    }),
    defineLabFixture<typeof BackgroundCommandCard>({
        component: "BackgroundCommandCard",
        scenes: ([["command-running", "运行中：最后一行、停止"], ["command-done", "完成：退出码与行数"], ["command-failed", "失败"], ["command-restarted", "任务已移出：从 status.json 读"], ["command-running-narrow", "390px 宽"]] as const).map(([id, label]) => ({id, label, input: {props: sampleProps(COMMAND_SAMPLES[id.replace(/^command-/u, "").replace(/-narrow$/u, "")]!)}})),
        load: async () => withAgentPageText((await import("./SubagentCardFixture.vue")).default),
    }),
    defineLabFixture<typeof ProfileRail>({
        component: "ProfileRail",
        scenes: [
            {id: "rail", label: "可选的、有问题的、后台的", input: {props: {items: SAMPLE_PROFILES, current: "nbook.agent.main"}}},
            {id: "readonly", label: "不能写：“新建”停用", input: {props: {items: SAMPLE_PROFILES, current: "plot.qa", disabled: true}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof ProfileRail>((await import("nbook/plugins/agent/web/components/ProfileRail.vue")).default)),
    }),
    defineLabFixture<typeof ProfileDetail>({
        component: "ProfileDetail",
        scenes: [
            {id: "builtin", label: "内置 Profile", input: {props: {profile: SAMPLE_PROFILES[0]!}}},
            {id: "user", label: "用户级：打开、删除，模型不满足要求", input: {props: {profile: SAMPLE_PROFILES[1]!}}},
            {id: "broken", label: "打包失败", input: {props: {profile: SAMPLE_PROFILES[2]!}}},
            {id: "unavailable", label: "缺必需工具", input: {props: {profile: SAMPLE_PROFILES[3]!}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof ProfileDetail>((await import("nbook/plugins/agent/web/components/ProfileDetail.vue")).default)),
    }),
    defineLabFixture<typeof ProfileToolsSection>({
        component: "ProfileToolsSection",
        scenes: [
            {id: "tools", label: "按提供者分组，有已卸载的，能恢复默认", input: {props: {tools: SAMPLE_WRITER_TOOLS}}},
            {id: "readonly", label: "不能写", input: {props: {tools: SAMPLE_WRITER_TOOLS, disabled: true}}},
            {id: "adding", label: "添加工具对话框", input: {props: {tools: SAMPLE_WRITER_TOOLS, initialAdd: true}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof ProfileToolsSection>((await import("nbook/plugins/agent/web/components/ProfileToolsSection.vue")).default)),
    }),
    defineLabFixture<typeof AddToolsDialog>({
        component: "AddToolsDialog",
        scenes: [
            {id: "candidates", label: "按提供者分组，同名的写明会换掉", input: {props: {candidates: SAMPLE_TOOL_CANDIDATES}, model: {open: true}}},
            {id: "empty", label: "没有可以添加的", input: {props: {candidates: []}, model: {open: true}}},
            {id: "failed", label: "写入失败留在对话框", input: {props: {candidates: SAMPLE_TOOL_CANDIDATES, status: "设置文件无法写入"}, model: {open: true}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof AddToolsDialog>((await import("nbook/plugins/agent/web/components/AddToolsDialog.vue")).default)),
    }),
    defineLabFixture<typeof NewProfileDialog>({
        component: "NewProfileDialog",
        scenes: [
            {id: "new", label: "新建：只问名字", input: {props: {}, model: {open: true}}},
            {id: "exists", label: "已有同名", input: {props: {status: "已经有同名的 Profile 了。"}, model: {open: true}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof NewProfileDialog>((await import("nbook/plugins/agent/web/components/NewProfileDialog.vue")).default)),
    }),
    defineLabFixture<typeof SkillsSettingsPage>({
        component: "SkillsSettingsPage",
        scenes: [
            {id: "full", label: "我的、插件与内置：可用、未初始化、上次没装好、正在初始化、无效、插件没打包", input: {props: {entries: SKILL_PAGE_ENTRIES}}},
            {id: "empty", label: "还没有 Skill", input: {props: {entries: []}}},
            {id: "loading", label: "读取中", input: {props: {entries: null}}},
            {id: "full-english", label: "英文界面", input: {props: {entries: SKILL_PAGE_ENTRIES}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof SkillsSettingsPage>((await import("nbook/plugins/agent/web/components/SkillsSettingsPage.vue")).default, {class: "w-full max-w-[720px] p-6"})),
    }),
    defineLabFixture<typeof SkillInitDialog>({
        component: "SkillInitDialog",
        scenes: [
            {id: "confirm", label: "确认：有锁，列直接依赖", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
            {id: "no-lock", label: "确认：没有 bun.lock（说明行写会生成锁文件）", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: false, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
            {id: "installing", label: "正在安装（能关掉，在后台继续）", input: {props: {name: "epub-export", phase: "installing", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
            {id: "confirm-english", label: "英文界面：确认", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
            {id: "no-lock-english", label: "英文界面：没有 bun.lock", input: {props: {name: "epub-export", phase: "confirm", plan: {lock: false, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
            {id: "installing-english", label: "英文界面：正在安装", input: {props: {name: "epub-export", phase: "installing", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: null}, model: {open: true}}},
            {id: "failed", label: "失败：中间换成安装输出", input: {props: {name: "epub-export", phase: "failed", plan: {lock: true, packages: 23, dependencies: ["epub-gen-memory", "jszip", "turndown", "yaml"]}, failure: {code: "install-failed", output: "bun install v1.4.4\nResolving dependencies\nResolved, downloaded and extracted [12]\nerror: GET https://registry.npmjs.org/epub-gen-memory - ETIMEDOUT\nerror: epub-gen-memory@^1.1.2 failed to resolve"}}, model: {open: true}}},
        ],
        load: async () => withAgentPageText(createSubjectFixture<typeof SkillInitDialog>((await import("nbook/plugins/agent/web/components/SkillInitDialog.vue")).default)),
    }),
];
