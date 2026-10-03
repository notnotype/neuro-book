import type {LabFixtureDefinition} from "./index";
import type AgentProfileNavList from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileNavList.vue";
import type AgentProfileSettingsView from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue";
import type NovelIdeSettingsView from "../../components/novel-ide/settings/sections/NovelIdeSettingsView.vue";
import type {SettingsScopeOption, SettingsSectionOption} from "../../components/novel-ide/settings/sections/NovelIdeSettingsView.types";
import type FrontendSettingsView from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import type SettingsLoadState from "../../components/novel-ide/settings/sections/components/SettingsLoadState.vue";
import type WebSettingsView from "../../components/novel-ide/settings/sections/web/WebSettingsView.vue";
import type EmbeddingSettingsView from "../../components/novel-ide/settings/sections/embedding/EmbeddingSettingsView.vue";
import type CostSettingsView from "../../components/novel-ide/settings/sections/cost/CostSettingsView.vue";
import type ObservabilitySettingsView from "../../components/novel-ide/settings/sections/observability/ObservabilitySettingsView.vue";
import type EditorSettingsView from "../../components/novel-ide/settings/sections/editor/EditorSettingsView.vue";
import type DesktopSettingsView from "../../components/novel-ide/settings/sections/desktop/DesktopSettingsView.vue";
import type SecuritySettingsView from "../../components/novel-ide/settings/sections/security/SecuritySettingsView.vue";
import type ProviderSettingsView from "../../components/novel-ide/settings/sections/providers/ProviderSettingsView.vue";
import type RolesSettingsView from "../../components/novel-ide/settings/sections/roles/RolesSettingsView.vue";
import type NovelIdeModelEditDialog from "../../components/novel-ide/settings/sections/providers/components/NovelIdeModelEditDialog.vue";
import type ModelDiscoveryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelDiscoveryDialog.vue";
import type ModelLibraryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelLibraryDialog.vue";
import type ProjectPickerView from "../../components/novel-ide/project-picker/ProjectPickerView.vue";
import type ProjectPickerHeader from "../../components/novel-ide/project-picker/components/ProjectPickerHeader.vue";
import type ProjectPickerEmptyState from "../../components/novel-ide/project-picker/components/ProjectPickerEmptyState.vue";
import type ProjectCard from "../../components/novel-ide/project-picker/components/ProjectCard.vue";
import type ProjectCreateCoverPreview from "../../components/novel-ide/project-picker/components/ProjectCreateCoverPreview.vue";
import type ProjectCreateForm from "../../components/novel-ide/project-picker/components/ProjectCreateForm.vue";
import type ProjectCreateDialog from "../../components/novel-ide/project-picker/components/ProjectCreateDialog.vue";
import type ProjectCoverDialog from "../../components/novel-ide/project-picker/components/ProjectCoverDialog.vue";
import type {AgentProfileNavItem} from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileNavList.types";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import {createWebSettingsDraft} from "../../components/novel-ide/settings/sections/web/web-settings-draft";
import {createRolesSettingsDraft, type ModelRoleAxis, type RolesSettingsDraft} from "../../components/novel-ide/settings/sections/roles/roles-settings-draft";
import {createEmbeddingSettingsDraft} from "../../components/novel-ide/settings/sections/embedding/embedding-settings-draft";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import {DEFAULT_DESKTOP_SETTINGS} from "@notnotype/neuro-book-contracts/desktop";
import type {ProviderConfigIssue} from "@notnotype/neuro-book-contracts/provider-config";
import {MODEL_DEFAULT_MODEL_OPTIONS, MODEL_API_OPTIONS, MODEL_PROVIDER_TEMPLATES, DISCOVERY_DIAGNOSTICS, DISCOVERY_MODEL_GROUPS, MANUAL_MODEL_DRAFT, MODEL_LIBRARY_GROUPS, buildModelSettingsDraft, buildDisabledModelSettingsDraft, buildDisabledModels, buildSavedModelGroups} from "./model-settings-fixture-data";
import {DEFAULT_PI_MAX_RETRIES} from "nbook/shared/dto/pi-request-options.dto";
import {profileSceneProfile} from "./AgentProfileSections.scenes";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.types";
import type {AgentProfileDraft, AgentProfileModelDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import {cloneModelDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import {createProfileRuntimeSettingsDraft} from "../../components/novel-ide/settings/sections/agent-profile/profile-runtime-settings";
const statuses = [
    "loaded",
    "compiling",
    "compile_failed",
    "not_compiled",
    "compile_stale",
    "compiled_load_failed",
    "source_error",
] as const;

/**
 * 外壳的作用域与区段都由宿主给：全局 / 项目 / 本机 / 启动四档都能进入，
 * 每档挂的区段体见下方内容槽。
 */
export const scopeOptions: SettingsScopeOption[] = [
    {value: "boot", label: "启动", description: "启动期安全配置，只读说明"},
    {value: "global", label: "全局", description: "写入全局配置文件"},
    {value: "project", label: "项目", description: "写入当前项目配置"},
    {value: "browser", label: "本机", description: "写入本机浏览器状态"},
];

export const sectionOptions: SettingsSectionOption[] = [
    {
        value: "providers",
        label: "Provider",
        description: "管理 Provider 与模型清单",
        iconClass: "i-lucide-cpu",
        scopes: ["global"],
    },
    {
        value: "roles",
        label: "模型角色",
        description: "按用途把模型分配给各角色",
        iconClass: "i-lucide-shapes",
        scopes: ["global"],
    },
    {
        value: "agent-profile-models",
        label: "Agent Profile",
        description: "Profile 的模型、运行策略与专属设置",
        iconClass: "i-lucide-bot-message-square",
        scopes: ["global", "project"],
        layout: "fill",
    },
    {
        value: "web-tools",
        label: "Web 工具",
        description: "搜索服务、本地抓取与兜底",
        iconClass: "i-lucide-globe",
        scopes: ["global"],
    },
    {
        value: "embedding",
        label: "向量嵌入",
        description: "向量服务与项目覆盖",
        iconClass: "i-lucide-binary",
        scopes: ["global"],
    },
    {
        value: "cost",
        label: "费用显示",
        description: "展示币种与 USD/CNY 汇率",
        iconClass: "i-lucide-circle-dollar-sign",
        scopes: ["global"],
    },
    {
        value: "observability",
        label: "可观测",
        description: "Pi 请求 trace 记录开关与保留策略",
        iconClass: "i-lucide-activity",
        scopes: ["global"],
    },
    {
        value: "security",
        label: "密码保护",
        description: "查看启动期鉴权配置和安全影响",
        iconClass: "i-lucide-shield-check",
        scopes: ["boot"],
    },
    {
        value: "frontend",
        label: "前端设定",
        description: "界面语言、主题、推理强度与视图模式",
        iconClass: "i-lucide-monitor-cog",
        scopes: ["browser"],
    },
    {
        value: "editor",
        label: "编辑器",
        description: "Markdown 富文本显示偏好",
        iconClass: "i-lucide-type",
        scopes: ["browser"],
    },
    {
        value: "desktop",
        label: "桌面应用",
        description: "窗口、缩放和系统托盘行为",
        iconClass: "i-lucide-panels-top-left",
        scopes: ["browser"],
    },
];

export const novelIdeSettingsViewScenes = [
    {id: "global", label: "全局设定", input: {props: {scopes: scopeOptions, sections: sectionOptions, versionLabel: "v0.0.0", environmentLabel: "Lab", loading: false, loadError: ""}, model: {scope: "global", modelValue: "agent-profile-models"}}},
    {id: "project", label: "项目设定", input: {props: {scopes: scopeOptions, sections: sectionOptions, versionLabel: "v0.0.0", environmentLabel: "Lab", loading: false, loadError: ""}, model: {scope: "project", modelValue: "agent-profile-models"}}},
    {id: "dialog-window", label: "DialogWindow 内嵌", input: {props: {scopes: scopeOptions, sections: sectionOptions, versionLabel: "v0.0.0", environmentLabel: "Lab", loading: false, loadError: ""}, model: {scope: "global", modelValue: "agent-profile-models"}}},
    {id: "loading", label: "加载中", input: {props: {scopes: scopeOptions, sections: sectionOptions, versionLabel: "v0.0.0", environmentLabel: "Lab", loading: true, loadError: ""}, model: {scope: "global", modelValue: "agent-profile-models"}}},
    {id: "load-error", label: "加载失败", input: {props: {scopes: scopeOptions, sections: sectionOptions, versionLabel: "v0.0.0", environmentLabel: "Lab", loading: false, loadError: "读取设置失败：示例后端返回 500。"}, model: {scope: "global", modelValue: "agent-profile-models"}}},
] satisfies LabFixtureDefinition<typeof NovelIdeSettingsView>["scenes"];
type SceneKey = "global" | "project" | "dialog-window" | "statuses" | "custom-settings" | "empty";
function emptyRuntimeDraft() {
    return createProfileRuntimeSettingsDraft(undefined);
}

function modelDraft(patch: Partial<AgentProfileModelDraft>): AgentProfileModelDraft {
    return {...cloneModelDraft(undefined), ...patch};
}

function baseProfile(profileKey: string, name: string, loadStatus: (typeof statuses)[number]): AgentProfileDraft {
    return {
        profileKey,
        name,
        canResetHome: true,
        model: cloneModelDraft(undefined),
        loadStatus,
        runtime: emptyRuntimeDraft(),
        runtimeEffective: harnessRuntime(),
        runtimeSources: {
            summarizerEnabled: "harness", summarizerProfileKey: "harness", summarizerIntervalKind: "harness", summarizerIntervalValue: "harness", summarizerMaxTokens: "harness",
            compactionEnabled: "harness", compactionTriggerKind: "harness", compactionTriggerValue: "harness", compactionReserveTokens: "harness",
            compactionKeepRecentKind: "harness", compactionKeepRecentValue: "harness", compactionPrompt: "harness", compactionSummaryPrefix: "harness", fileChangeDiffMaxChars: "harness",
        },
        runtimeErrors: {},
        issue: null,
        sourcePath: `profiles/${profileKey}.profile.ts`,
        buildState: {running: false, queued: false, reason: null, updatedAt: null},
        settings: null,
    };
}

function harnessRuntime() {
    return {
        summarizer: {
            enabled: true,
            profileKey: "summarizer.default",
            trigger: "afterInvocation" as const,
            interval: {kind: "sourceInvocation" as const, value: 20},
            maxDialogueContentTokens: 4096,
        },
        compaction: {
            enabled: true,
            trigger: {kind: "autoReserve" as const},
            reserveTokens: 16384,
            keepRecent: {kind: "percent" as const, value: 0.25},
            prompt: "请压缩以下对话内容，保留关键事实。",
            summaryPrefix: "[摘要]",
        },
        fileChangeNotice: {diffMaxChars: 2048},
    };
}

function buildSettingsMeta() {
    return {
        enabledModels: [
            {key: "openai/gpt-5.1", label: "GPT-5.1", providerId: "openai", modelId: "gpt-5.1", input: ["text" as const], contextWindowTokens: 400000},
            {key: "openai/gpt-5.1-mini", label: "GPT-5.1 Mini", providerId: "openai", modelId: "gpt-5.1-mini", input: ["text" as const], contextWindowTokens: 400000},
            {key: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", providerId: "anthropic", modelId: "claude-sonnet-4.6", input: ["text" as const], contextWindowTokens: 200000},
        ],
        validationIssues: [],
        profileModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        harnessRuntimeDefaults: harnessRuntime(),
        profileRuntimeDefaults: harnessRuntime(),
        globalRuntimeDefaultsPatch: {},
        projectRuntimeDefaultsPatch: {},
        agentProfiles: [],
    };
}

function buildContext(scene: SceneKey): AgentProfileSettingsContext {
    const scope = scene === "project" || scene === "custom-settings" ? "project" as const : "global" as const;
    return {
        scope,
        inheritedDefaultProfileKey: "story-writer",
        globalModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        globalProfileModels: scope === "project" ? {"fact-reviewer": {temperature: 0.2}} : {},
        settings: buildSettingsMeta(),
        descriptions: {
            "story-writer": "负责章节初稿的连续写作。",
            "line-editor": "对成稿逐段润色语气与节奏。",
            "fact-reviewer": "校对事实、时间线与设定一致性。",
        },
    };
}

function lowCodeForm(): LowCodeFormDto {
    return {
        fields: [
            {path: "tone", component: "select" as const, required: false, label: "文风", defaultValue: "warm", options: [{value: "warm", label: "温暖"}, {value: "concise", label: "克制"}]},
            {path: "persona", component: "text" as const, required: false, label: "人称", defaultValue: "第三人称", options: []},
            {path: "notes", component: "textarea" as const, required: false, label: "写作备注", defaultValue: "", rows: 3, options: []},
            {path: "verbosity", component: "number" as const, required: false, label: "铺陈程度", defaultValue: 3, step: 1, options: []},
            {path: "autoPolish", component: "switch" as const, required: false, label: "自动润色", defaultValue: true, options: []},
            {path: "mood", component: "radio" as const, required: false, label: "情绪基调", defaultValue: "calm", options: [{value: "calm", label: "平静"}, {value: "tense", label: "紧张"}]},
            {path: "keywords", component: "checkbox" as const, required: false, label: "关注要素", defaultValue: ["foreshadow"], options: [{value: "foreshadow", label: "伏笔"}, {value: "dialogue", label: "对话"}]},
            {path: "stylePreset", component: "combobox" as const, required: false, label: "风格预设", defaultValue: "", options: [{value: "wuxia", label: "武侠"}, {value: "urban", label: "都市"}]},
            {path: "promptResource", component: "resource-preset" as const, required: false, label: "提示词资源", defaultValue: "global:main", options: [], resource: {
                contentType: "markdown" as const,
                options: [
                    {key: "global:main", label: "主提示词", origin: "global" as const, editable: false, deletable: false},
                    {key: "project:alt", label: "备选提示词", origin: "project" as const, editable: true, deletable: true},
                ],
                content: null,
                contents: [
                    {key: "global:main", content: "你是故事写手，负责推进主线。", contentType: "markdown" as const},
                    {key: "project:alt", content: "你是备选写手，语气更轻。", contentType: "markdown" as const},
                ],
                template: "新的提示词内容。",
                createKeyPrefix: "project:",
                createKeySuffix: "",
                capabilities: {create: true, update: true, rename: true, remove: true},
            }},
        ],
        defaults: {tone: "warm"},
    };
}

function profilesFor(scene: SceneKey): AgentProfileDraft[] {
    switch (scene) {
        case "global":
        case "dialog-window": {
            const list = [
                baseProfile("story-writer", "故事写手", "loaded"),
                baseProfile("line-editor", "行文编辑", "loaded"),
                baseProfile("fact-reviewer", "事实审校", "loaded"),
            ];
            list[0]!.settings = {
                form: lowCodeForm(),
                values: {tone: "warm", persona: "第三人称"},
                inheritedValue: {},
                issues: [],
                overridePaths: [],
                resourceMutations: [],
            };
            return list;
        }
        case "project":
        case "custom-settings": {
            const list = [
                baseProfile("story-writer", "故事写手", "loaded"),
                baseProfile("line-editor", "行文编辑", "loaded"),
                baseProfile("fact-reviewer", "事实审校", "loaded"),
            ];
            list[1]!.model = modelDraft({temperature: "0.4", stream: false});
            list[2]!.settings = {
                form: lowCodeForm(),
                values: {tone: "concise"},
                inheritedValue: {tone: "warm", verbosity: 3},
                issues: [],
                overridePaths: ["tone"],
                resourceMutations: [],
            };
            return list;
        }
        case "statuses": {
            const names = ["故事写手", "行文编辑", "事实审校", "资料研究员", "大纲规划", "设定档案", "世界观守卫"];
            const keys = ["story-writer", "line-editor", "fact-reviewer", "deep-researcher", "plot-planner", "series-archivist", "canon-guardian"];
            return statuses.map((status, index) => {
                const profile = baseProfile(keys[index]!, names[index]!, status);
                if (status === "compile_failed") {
                    profile.issue = {code: "COMPILE_TYPE_ERROR", message: "编译失败：提示词脚本第 12 行类型不匹配。", profileKey: keys[index]!, sourcePath: profile.sourcePath};
                }
                if (status === "compiling") {
                    profile.buildState = {running: true, queued: false, reason: null, updatedAt: null};
                }
                if (status === "compile_stale") {
                    profile.buildState = {running: false, queued: true, reason: "源文件在上次编译后发生变更。", updatedAt: null};
                }
                return profile;
            });
        }
        case "empty":
            return [];
    }
}

function pageDraftFor(scene: SceneKey): AgentProfileSettingsPageDraft {
    return {
        defaultProfileKey: "",
        modelDefaults: cloneModelDraft(undefined),
        runtimeDefaults: emptyRuntimeDraft(),
        profiles: profilesFor(scene),
    };
}

export const agentProfileSettingsViewScenes = [
    {id: "global", label: "全局设定", input: {props: {context: buildContext("global"), showNavHeading: true}, model: {modelValue: pageDraftFor("global")}}},
    {id: "project", label: "项目设定", input: {props: {context: buildContext("project"), showNavHeading: true}, model: {modelValue: pageDraftFor("project")}}},
    {id: "dialog-window", label: "DialogWindow 内嵌", input: {props: {context: buildContext("dialog-window"), showNavHeading: false}, model: {modelValue: pageDraftFor("dialog-window")}}},
    {id: "statuses", label: "状态全集", input: {props: {context: buildContext("statuses"), showNavHeading: true}, model: {modelValue: pageDraftFor("statuses")}}},
    {id: "custom-settings", label: "专属设置", input: {props: {context: buildContext("custom-settings"), showNavHeading: true}, model: {modelValue: pageDraftFor("custom-settings")}}},
    {id: "empty", label: "空列表", input: {props: {context: buildContext("empty"), showNavHeading: true}, model: {modelValue: pageDraftFor("empty")}}},
] satisfies LabFixtureDefinition<typeof AgentProfileSettingsView>["scenes"];


const editingProviderDraft = buildModelSettingsDraft();
const modelEditProps = {editingModel: editingProviderDraft.providers[0]!.models[0]!, activeProvider: {id: editingProviderDraft.providers[0]!.id, name: editingProviderDraft.providers[0]!.name}, libraryModel: null, missingFields: [], modelApiOptions: MODEL_API_OPTIONS, teleportTarget: false};
export const novelIdeModelEditDialogScenes = [
    {id: "default", label: "编辑模型", input: {props: modelEditProps, model: {modelValue: true}}},
    {id: "missing-fields", label: "缺字段", input: {props: {...modelEditProps, editingModel: {...editingProviderDraft.providers[0]!.models[1]!, api: "", contextWindowTokens: "", maxTokens: "", reasoning: "inherit" as const}, missingFields: ["api", "contextWindowTokens"]}, model: {modelValue: true}}},
    {id: "confirm-mode", label: "候选择确认", input: {props: {...modelEditProps, confirmMode: true}, model: {modelValue: true}}},
] satisfies LabFixtureDefinition<typeof NovelIdeModelEditDialog>["scenes"];

function discoveryProps(scene: string) {
    return {providerName: "OpenAI", groups: scene === "empty" ? [] : DISCOVERY_MODEL_GROUPS, discovering: scene === "discovering", expandedGroups: {}, diagnostics: scene === "partial" ? DISCOVERY_DIAGNOSTICS : null, manualDraft: MANUAL_MODEL_DRAFT, modelApiOptions: MODEL_API_OPTIONS, teleportTarget: false};
}
export const modelDiscoveryDialogScenes = [
    {id: "default", label: "发现结果", input: {props: discoveryProps("default"), model: {modelValue: true, searchQuery: ""}}},
    {id: "partial", label: "部分成功", input: {props: discoveryProps("partial"), model: {modelValue: true, searchQuery: ""}}},
    {id: "empty", label: "无结果", input: {props: discoveryProps("empty"), model: {modelValue: true, searchQuery: ""}}},
    {id: "discovering", label: "发现中", input: {props: discoveryProps("discovering"), model: {modelValue: true, searchQuery: ""}}},
] satisfies LabFixtureDefinition<typeof ModelDiscoveryDialog>["scenes"];

export const modelLibraryDialogScenes = [
    {id: "default", label: "标准资料", input: {props: {groups: MODEL_LIBRARY_GROUPS, expandedGroups: {}, teleportTarget: false}, model: {modelValue: true, searchQuery: ""}}},
    {id: "empty", label: "无结果", input: {props: {groups: [], expandedGroups: {}, teleportTarget: false}, model: {modelValue: true, searchQuery: ""}}},
    {id: "searching", label: "搜索中", input: {props: {groups: MODEL_LIBRARY_GROUPS, expandedGroups: {}, teleportTarget: false}, model: {modelValue: true, searchQuery: "gpt"}}},
] satisfies LabFixtureDefinition<typeof ModelLibraryDialog>["scenes"];
const SAMPLE_PROJECTS: ProjectMetadataDto[] = [
    {
        projectRoot: "workspace/projects/cyber-city",
        kind: "novel",
        title: "赛博霓虹：仿生纪元",
        summary: "在全自动化的人形都市中，一名记忆修复师偶然发现了一具被删除了所有情感模块的古老合成人。",
        cover: "workspace/projects/cyber-city/cover.jpg",
        manifestUpdatedAt: "2026-09-10T14:32:00Z",
    },
    {
        projectRoot: "workspace/projects/stellar-odyssey",
        kind: "novel",
        title: "群星尽头的低语",
        summary: "跃迁引擎故障后，科考船坠落在一颗处于双星系统潮汐锁定带的死寂行星上。",
        cover: undefined,
        manifestUpdatedAt: "2026-09-08T09:15:00Z",
    },
    {
        projectRoot: "workspace/projects/magic-chronicles",
        kind: "novel",
        title: "深渊炼金手册",
        summary: "一本记录禁忌炼金术的古旧手抄本，指引着学徒走向帝国最深的地底迷宫。",
        cover: "workspace/projects/magic-chronicles/cover.png",
        manifestUpdatedAt: "2026-09-05T18:40:00Z",
    },
    {
        projectRoot: "workspace/projects/ancient-blade",
        kind: "novel",
        title: "折戟沉沙录",
        summary: "剑修末世，天道崩碎，少年背负半截断剑踏上寻找上古遗迹的复仇长路。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-30T11:20:00Z",
    },
    {
        projectRoot: "workspace/projects/urban-mystery",
        kind: "novel",
        title: "第七诊疗室的异常记录",
        summary: "深夜接诊的患者们，总在诉说着关于同一间不存在的电梯的噩梦。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-25T22:10:00Z",
    },
    {
        projectRoot: "workspace/projects/echoes-of-chronos",
        kind: "novel",
        title: "时光回响：跨纪元编年史",
        summary: "时间锚点发生偏移，两个相隔三千年的文明在同一个时空奇点中开始产生干涉。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-20T16:05:00Z",
    },
    {
        projectRoot: "workspace/projects/crimson-abyss",
        kind: "novel",
        title: "血月降临夜",
        summary: "当绯红之月笼罩旧伦敦街头，皇家猎魔巡警在下水道发现了失落百年的古老炼金法阵。",
        cover: "workspace/projects/crimson-abyss/cover.jpg",
        manifestUpdatedAt: "2026-08-15T10:30:00Z",
    },
    {
        projectRoot: "workspace/projects/nine-dragons",
        kind: "novel",
        title: "九霄龙渊志",
        summary: "少年偶得一枚龙骨逆鳞，踏破九州风云，重开天门飞升之路。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-11T08:50:00Z",
    },
    {
        projectRoot: "workspace/projects/foggy-avenue",
        kind: "novel",
        title: "迷雾街区 42 号",
        summary: "暴风雨孤岛上的老牌旅馆，每当午夜钟声敲响，总有一间客房的门牌号会离奇变动。",
        cover: undefined,
        manifestUpdatedAt: "2026-08-05T23:15:00Z",
    },
    {
        projectRoot: "workspace/projects/desert-dynasty",
        kind: "novel",
        title: "沙海古国遗卷",
        summary: "探险队穿越无尽死海风暴，发掘沉睡于流沙千尺之下的机械黄金古城。",
        cover: "workspace/projects/desert-dynasty/cover.png",
        manifestUpdatedAt: "2026-07-28T14:20:00Z",
    },
    {
        projectRoot: "workspace/projects/quantum-ghost",
        kind: "novel",
        title: "量子幽灵调查录",
        summary: "在全息脑机网络普及的社会，网络幽灵开始以非因果律的形式在物理世界显形。",
        cover: undefined,
        manifestUpdatedAt: "2026-07-20T19:45:00Z",
    },
    {
        projectRoot: "workspace/projects/sword-frost",
        kind: "novel",
        title: "独钓寒江雪",
        summary: "十年闭关，一剑出鞘。雪山之巅的残局，等待最后一位入局之人。",
        cover: undefined,
        manifestUpdatedAt: "2026-07-12T11:00:00Z",
    },
    {
        projectRoot: "workspace/projects/neon-syndicate",
        kind: "novel",
        title: "地下城黑客备忘录",
        summary: "隐藏在废弃地铁线路深处的地下黑市，数据贩子在追踪一份被加密的脑神经蓝图。",
        cover: undefined,
        manifestUpdatedAt: "2026-07-01T15:30:00Z",
    },
    {
        projectRoot: "workspace/projects/greenhouse-witch",
        kind: "novel",
        title: "温室最后的草药学徒",
        summary: "在被灰烬与永冬覆盖的荒原边境，一座玻璃温室守护着世间最后的魔法植物幼苗。",
        cover: "workspace/projects/greenhouse-witch/cover.jpg",
        manifestUpdatedAt: "2026-06-25T09:10:00Z",
    },
];

const sampleProjectTags: Record<string, readonly string[]> = {
    "workspace/projects/cyber-city": ["赛博朋克", "科幻未来"],
    "workspace/projects/stellar-odyssey": ["硬科幻", "深空探索"],
    "workspace/projects/magic-chronicles": ["西幻", "炼金魔法"],
    "workspace/projects/ancient-blade": ["玄幻修真", "热血"],
    "workspace/projects/urban-mystery": ["悬疑惊悚", "都市怪谈"],
    "workspace/projects/echoes-of-chronos": ["硬科幻", "时间穿越", "史诗编年"],
    "workspace/projects/crimson-abyss": ["西幻", "维多利亚", "吸血鬼"],
    "workspace/projects/nine-dragons": ["东方仙侠", "热血", "升级"],
    "workspace/projects/foggy-avenue": ["悬疑解谜", "暴风雪山庄", "古典侦探"],
    "workspace/projects/desert-dynasty": ["奇幻探险", "失落文明", "考古"],
    "workspace/projects/quantum-ghost": ["赛博朋克", "心理惊悚", "脑机接口"],
    "workspace/projects/sword-frost": ["传统武侠", "冷峻剑客", "江湖宿命"],
    "workspace/projects/neon-syndicate": ["都市异能", "黑客智斗", "赛博犯罪"],
    "workspace/projects/greenhouse-witch": ["治愈奇幻", "魔法日常", "温馨治愈"],
};

const projectPickerProps = {
    projects: SAMPLE_PROJECTS.map((project) => {
        const {cover, ...rest} = project;
        return cover === undefined ? rest : {...rest, cover};
    }),
    projectTags: sampleProjectTags, isLoading: false, loadError: "", isCreating: false, isCreateFormOpen: false, teleportTarget: "body",
};
const pickerModel = {coverDialogOpen: false, coverDialogProject: null};
export const projectPickerViewScenes = [
    {id: "default", label: "经典网格", input: {props: projectPickerProps, model: {...pickerModel, layoutMode: "grid" as const}}},
    {id: "compact", label: "密集列表", input: {props: projectPickerProps, model: {...pickerModel, layoutMode: "compact" as const}}},
    {id: "editorial", label: "宽幅图文", input: {props: projectPickerProps, model: {...pickerModel, layoutMode: "editorial" as const}}},
    {id: "empty", label: "零项目空态", input: {props: {...projectPickerProps, projects: []}, model: {...pickerModel, layoutMode: "grid" as const}}},
    {id: "create-dialog", label: "新建对话框", input: {props: {...projectPickerProps, isCreateFormOpen: true}, model: {...pickerModel, layoutMode: "grid" as const}}},
    {id: "creating", label: "创建中", input: {props: {...projectPickerProps, isCreateFormOpen: true, isCreating: true}, model: {...pickerModel, layoutMode: "grid" as const}}},
    {id: "loading", label: "加载中", input: {props: {...projectPickerProps, isLoading: true}, model: {...pickerModel, layoutMode: "grid" as const}}},
    {id: "load-error", label: "加载失败", input: {props: {...projectPickerProps, loadError: "无法连接到本地工作区存储服务（503 Service Unavailable）"}, model: {...pickerModel, layoutMode: "grid" as const}}},
    {id: "phone", label: "手机 390×844", input: {props: projectPickerProps, model: {...pickerModel, layoutMode: "grid" as const}}},
] satisfies LabFixtureDefinition<typeof ProjectPickerView>["scenes"];
export {SAMPLE_PROJECTS, sampleProjectTags};

const frontendProps = {
    reasoningOptions: ["off", "low", "medium", "high"],
    themeOptions: [{id: "nbook" as const, name: "NeuroBook", tagline: "Liquid Glass · 中文写作版"}, {id: "macos" as const, name: "macOS", tagline: "Liquid Glass"}],
    themeId: "nbook" as const, appearance: "light" as const, colorwayId: "nbook-light", colorwayLabel: "NeuroBook · 昼",
    colorwayVars: {"--bg-main": "#e3e4e6", "--bg-panel": "#fffcf5", "--text-main": "#23252b"}, colorwayIsUser: false,
    userColorways: [{id: "custom-lab", label: "Lab 夜色", appearance: "dark" as const, swatch: "#223044", vars: {"--bg-main": "#223044", "--bg-panel": "#2b3a52"}}],
};
export const frontendSettingsViewScenes = [
    {id: "default", label: "默认（两轴选择器）", input: {props: {...frontendProps, disabled: false}, model: {locale: "zh-CN", viewMode: "rich", reasoning: "off"}}},
    {id: "disabled", label: "读取中停用", input: {props: {...frontendProps, disabled: true}, model: {locale: "zh-CN", viewMode: "rich", reasoning: "off"}}},
] satisfies LabFixtureDefinition<typeof FrontendSettingsView>["scenes"];

export const costSettingsViewScenes = [
    {id: "default", label: "美元", input: {props: {exchangeRate: 7.2413, exchangeRateStale: false, exchangeRateFetchedAt: "2026-09-10T02:00:00.000Z", refreshing: false, disabled: false}, model: {currency: "USD" as const}}},
    {id: "cny", label: "人民币", input: {props: {exchangeRate: 7.2413, exchangeRateStale: false, exchangeRateFetchedAt: "2026-09-10T02:00:00.000Z", refreshing: false, disabled: false}, model: {currency: "CNY" as const}}},
    {id: "stale", label: "缓存汇率", input: {props: {exchangeRate: 7.2318, exchangeRateStale: true, exchangeRateFetchedAt: "2026-09-08T02:00:00.000Z", refreshing: false, disabled: false}, model: {currency: "CNY" as const}}},
    {id: "missing-rate", label: "无汇率", input: {props: {exchangeRate: null, exchangeRateStale: false, exchangeRateFetchedAt: "", refreshing: false, disabled: false}, model: {currency: "CNY" as const}}},
    {id: "refreshing", label: "刷新中", input: {props: {exchangeRate: 7.2413, exchangeRateStale: false, exchangeRateFetchedAt: "2026-09-10T02:00:00.000Z", refreshing: true, disabled: false}, model: {currency: "USD" as const}}},
] satisfies LabFixtureDefinition<typeof CostSettingsView>["scenes"];

function rolesDraft(scene: string): RolesSettingsDraft {
    const draft = createRolesSettingsDraft((key) => key);
    const bind = (id: string, modelKey: string) => {
        for (const axis of ["gradient", "specialist"] as ModelRoleAxis[]) {
            const role = draft[axis].find((item) => item.id === id);
            if (role) { role.modelKey = modelKey; return; }
        }
    };
    if (["partially-configured", "saving", "save-error"].includes(scene)) {
        bind("main", "openai/gpt-5.1"); bind("summarize", "openai/o4-mini");
    }
    if (scene === "fully-configured") {
        for (const id of ["tiny", "fast", "main", "deep"]) bind(id, id === "main" || id === "deep" ? "openai/gpt-5.1" : "openai/o4-mini");
        for (const id of ["summarize", "writer", "narrative", "plan", "vision"]) bind(id, id === "summarize" || id === "vision" ? "openai/o4-mini" : "openai/gpt-5.1");
    }
    return draft;
}
export const rolesSettingsViewScenes = [
    {id: "unconfigured", label: "全部未配置", input: {props: {models: MODEL_DEFAULT_MODEL_OPTIONS, saving: false, saveError: ""}, model: {modelValue: rolesDraft("unconfigured")}}},
    {id: "partially-configured", label: "部分配置", input: {props: {models: MODEL_DEFAULT_MODEL_OPTIONS, saving: false, saveError: ""}, model: {modelValue: rolesDraft("partially-configured")}}},
    {id: "fully-configured", label: "全部绑定", input: {props: {models: MODEL_DEFAULT_MODEL_OPTIONS, saving: false, saveError: ""}, model: {modelValue: rolesDraft("fully-configured")}}},
    {id: "saving", label: "保存中", input: {props: {models: MODEL_DEFAULT_MODEL_OPTIONS, saving: true, saveError: ""}, model: {modelValue: rolesDraft("saving")}}},
    {id: "save-error", label: "保存失败", input: {props: {models: MODEL_DEFAULT_MODEL_OPTIONS, saving: false, saveError: "示例后端返回 500"}, model: {modelValue: rolesDraft("save-error")}}},
] satisfies LabFixtureDefinition<typeof RolesSettingsView>["scenes"];

const providerIssues: ProviderConfigIssue[] = [
    {code: "missing_api", message: "模型 o4-mini 缺少 API 格式", path: ["providers", 0, "models", 1, "api"], modelKey: "openai/o4-mini"},
    {code: "missing_context_window", message: "模型 o4-mini 缺少上下文窗口", path: ["providers", 0, "models", 1, "contextWindowTokens"], modelKey: "openai/o4-mini"},
];
function providerProps(scene: string) {
    const draft = scene === "no-provider" ? {defaultModelKey: null, providers: [], agentVisibleModels: []} : scene === "disabled-models" ? buildDisabledModelSettingsDraft() : buildModelSettingsDraft();
    const issues = scene === "disabled-models" ? providerIssues : [];
    return {
        draft, selectedTemplate: MODEL_PROVIDER_TEMPLATES[0]!.id, isProjectScope: scene === "project", targetLabel: "C:/novels/长夜行", saving: scene === "saving", validationIssues: issues,
        validationIssueDetails: issues.map((issue) => `${issue.code} ${issue.path.join(".")}`).join("\n"), repairingModels: false,
        savedModelGroups: buildSavedModelGroups(draft), disabledModels: scene === "disabled-models" ? buildDisabledModels(draft) : [],
        activeProviderKey: draft.providers[0]?.localKey ?? "", activeProviderCheckingModelCount: 0, checkingAllModels: false, discoveringProviderId: "",
        modelApiOptions: MODEL_API_OPTIONS, providerTemplates: MODEL_PROVIDER_TEMPLATES, maxRetriesPlaceholder: DEFAULT_PI_MAX_RETRIES,
        validationDialogOpen: false, deleteProviderDialogOpen: false, modelEditDialogOpen: false, discoveryDialogOpen: false, modelLibraryDialogOpen: false,
        editingModel: null, editingLibraryModel: null, editingModelMissingFields: [], editingTransientCandidate: false,
        discoveryGroups: [], discoverySearchQuery: "", discoveryExpandedGroups: {}, discoveryDiagnostics: null,
        discoveryManualDraft: {name: "", id: "", api: "", group: "", contextWindowTokens: "", maxTokens: ""},
        modelLibraryGroups: [], modelLibrarySearchQuery: "", modelLibraryExpandedGroups: {}, teleportTarget: false,
    };
}
export const providerSettingsViewScenes = [
    {id: "default", label: "全局默认", input: {props: providerProps("default")}},
    {id: "project", label: "项目覆盖", input: {props: providerProps("project")}},
    {id: "no-provider", label: "无 Provider", input: {props: providerProps("no-provider")}},
    {id: "disabled-models", label: "停用与问题", input: {props: providerProps("disabled-models")}},
    {id: "dialog-window", label: "DialogWindow 内嵌", input: {props: providerProps("dialog-window")}},
    {id: "saving", label: "保存中", input: {props: providerProps("saving")}},
] satisfies LabFixtureDefinition<typeof ProviderSettingsView>["scenes"];
const navStatuses: AgentProfileNavItem[] = [
    {profileKey: "story-writer", name: "故事写手", status: "loaded", overrideCount: 0, dirty: false, isDefault: false, iconClass: "i-lucide-feather"},
    {profileKey: "line-editor", name: "行文编辑", status: "compiling", overrideCount: 4, dirty: false, isDefault: false, iconClass: "i-lucide-pen-line"},
    {profileKey: "fact-reviewer", name: "事实审校", status: "compile_failed", overrideCount: 2, dirty: true, isDefault: false, iconClass: "i-lucide-search-check"},
    {profileKey: "deep-researcher", name: "资料研究员", status: "not_compiled", overrideCount: 0, dirty: false, isDefault: true, iconClass: "i-lucide-book-open"},
    {profileKey: "plot-planner", name: "大纲规划", status: "compile_stale", overrideCount: 1, dirty: false, isDefault: false, iconClass: "i-lucide-list-tree"},
    {profileKey: "series-archivist", name: "设定档案", status: "compiled_load_failed", overrideCount: 3, dirty: false, isDefault: false, iconClass: "i-lucide-archive"},
    {profileKey: "canon-guardian", name: "世界观守卫", status: "source_error", overrideCount: 0, dirty: false, isDefault: false, iconClass: "i-lucide-shield"},
];
const navDefaults: AgentProfileNavItem[] = [
    {profileKey: "story-writer", name: "故事写手", status: "loaded", overrideCount: 0, dirty: false, isDefault: true, iconClass: "i-lucide-feather"},
    {profileKey: "line-editor", name: "行文编辑", status: "loaded", overrideCount: 2, dirty: false, isDefault: false, iconClass: "i-lucide-pen-line"},
];
const navLong: AgentProfileNavItem[] = Array.from({length: 30}, (_, index) => ({
    profileKey: index === 1 ? "profile-with-an-intentionally-long-key-for-narrow-layout-checks" : ["story-writer", "line-editor", "fact-reviewer"][index % 3]!,
    name: index === 0 ? "一个用于验证窄屏截断与完整可访问名称的超长 Agent Profile 名称" : index === 2 ? "A very long English profile name for responsive layout checks" : `${["故事写手", "行文编辑", "事实审校"][index % 3]} · ${Math.floor(index / 3) + 1} 号`,
    status: navStatuses[index % navStatuses.length]!.status,
    overrideCount: index % 4 === 0 ? index + 1 : 0, dirty: index % 7 === 0, isDefault: index === 4,
    iconClass: ["i-lucide-feather", "i-lucide-pen-line", "i-lucide-search-check"][index % 3],
}));
export const agentProfileNavListScenes = [
    {id: "statuses", label: "状态全集", input: {props: {items: navStatuses, defaultsDirty: false}, model: {activeKey: "line-editor", search: ""}}},
    {id: "defaults", label: "默认设置", input: {props: {items: navDefaults, defaultsDirty: true}, model: {activeKey: "", search: ""}}},
    {id: "long-list", label: "长列表与长文本", input: {props: {items: navLong, defaultsDirty: false}, model: {activeKey: "story-writer", search: ""}}},
    {id: "empty", label: "空列表", input: {props: {items: [], defaultsDirty: false}, model: {activeKey: "", search: ""}}},
    {id: "no-match", label: "搜索无匹配", input: {props: {items: navDefaults, defaultsDirty: false}, model: {activeKey: "story-writer", search: "不存在的搜索词xyz"}}},
] satisfies LabFixtureDefinition<typeof AgentProfileNavList>["scenes"];

export const settingsLoadStateScenes = [
    {id: "loading", label: "加载中（默认文案）", input: {props: {variant: "loading", message: "", actionLabel: ""}}},
    {id: "loading-message", label: "加载中（自定义说明）", input: {props: {variant: "loading", message: "正在读取本机设定…", actionLabel: ""}}},
    {id: "error", label: "读取失败（默认重试文案）", input: {props: {variant: "error", message: "读取全局配置失败：文件被占用", actionLabel: ""}}},
    {id: "error-custom-action", label: "读取失败（自定义重试文案）", input: {props: {variant: "error", message: "读取全局配置失败：文件被占用", actionLabel: "重新加载设置"}}},
] satisfies LabFixtureDefinition<typeof SettingsLoadState>["scenes"];

function webProps(scene: string) {
    const draft = createWebSettingsDraft();
    if (scene === "configured") {
        draft.providers.tavily = {...draft.providers.tavily, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "tvly-…9c21"};
        draft.providers.brave = {...draft.providers.brave, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "BSA…4d7f"};
    }
    if (scene === "brave-first") draft.order = ["brave", "tavily"];
    if (scene === "local-fetch-off") {
        draft.localFetch = {...draft.localFetch, enabled: false};
        draft.tavilyFallback = {enabled: true, timeoutMs: "20000"};
    }
    return draft;
}
export const webSettingsViewScenes = ["default", "configured", "brave-first", "local-fetch-off", "disabled"].map((id) => ({
    id, label: ({default: "默认", configured: "两家已配置", "brave-first": "Brave 优先", "local-fetch-off": "本地抓取关闭", disabled: "整段停用"} as Record<string, string>)[id]!,
    input: {props: {disabled: id === "disabled"}, model: {modelValue: webProps(id)}},
})) satisfies LabFixtureDefinition<typeof WebSettingsView>["scenes"];

function embeddingProps(scene: string) {
    const draft = createEmbeddingSettingsDraft();
    if (scene === "global-enabled") draft.global = {...draft.global, enabled: true, model: "text-embedding-3-small", dimensions: "1536", baseURL: "https://api.openai.com/v1", timeoutMs: "30000", requestOptions: "{\n  \"encoding_format\": \"float\"\n}"};
    if (scene === "global-api-key") draft.global = {...draft.global, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "sk-…7f3a"};
    if (scene === "project-override") draft.project = {model: "text-embedding-3-large", dimensions: "3072"};
    return draft;
}
export const embeddingSettingsViewScenes = [
    {id: "global-disabled", label: "全局未启用", input: {props: {scope: "global", targetLabel: ""}, model: {modelValue: embeddingProps("global-disabled")}}},
    {id: "global-enabled", label: "全局已配置", input: {props: {scope: "global", targetLabel: ""}, model: {modelValue: embeddingProps("global-enabled")}}},
    {id: "global-api-key", label: "已配置密钥", input: {props: {scope: "global", targetLabel: ""}, model: {modelValue: embeddingProps("global-api-key")}}},
    {id: "project-inherit", label: "项目继承", input: {props: {scope: "project", targetLabel: "C:/novels/长夜行"}, model: {modelValue: embeddingProps("project-inherit")}}},
    {id: "project-override", label: "项目覆盖", input: {props: {scope: "project", targetLabel: "C:/novels/长夜行"}, model: {modelValue: embeddingProps("project-override")}}},
] satisfies LabFixtureDefinition<typeof EmbeddingSettingsView>["scenes"];

export const observabilitySettingsViewScenes = [
    {id: "default", label: "默认", input: {props: {disabled: false}, model: {enabled: true, maxRecords: 100}}},
    {id: "disabled", label: "停用", input: {props: {disabled: true}, model: {enabled: false, maxRecords: 100}}},
    {id: "boundary", label: "边界值 0", input: {props: {disabled: false}, model: {enabled: true, maxRecords: 0}}},
] satisfies LabFixtureDefinition<typeof ObservabilitySettingsView>["scenes"];

export const editorSettingsViewScenes = [
    {id: "default", label: "默认", input: {props: {disabled: false}, model: {markdown: DEFAULT_MARKDOWN_EDITOR_PREFERENCES, monaco: DEFAULT_MONACO_EDITOR_PREFERENCES}}},
    {id: "custom", label: "自定义偏好", input: {props: {disabled: false}, model: {
        markdown: {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, fontFamily: "\"LXGW WenKai\", \"KaiTi\", \"STKaiti\", serif", fontSize: 20, lineHeight: 2.1, contentWidth: 1000, paragraphIndentEnabled: true, paragraphIndentEm: 1.5},
        monaco: {...DEFAULT_MONACO_EDITOR_PREFERENCES, fontSize: 13, lineHeight: 24, tabSize: 2, minimapEnabled: true, renderWhitespace: true},
    }}},
    {id: "indent-off", label: "段首缩进关闭", input: {props: {disabled: false}, model: {markdown: {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, paragraphIndentEnabled: false, paragraphIndentEm: 2.5}, monaco: DEFAULT_MONACO_EDITOR_PREFERENCES}}},
    {id: "boundary", label: "边界值", input: {props: {disabled: false}, model: {markdown: {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, fontSize: 12, lineHeight: 1.2, contentWidth: 520, paragraphIndentEnabled: true, paragraphIndentEm: 0}, monaco: {...DEFAULT_MONACO_EDITOR_PREFERENCES, fontSize: 32, lineHeight: 56, tabSize: 8}}}},
] satisfies LabFixtureDefinition<typeof EditorSettingsView>["scenes"];

const desktopStatus = (remote: boolean) => ({
    schema: "nbook.desktop-bridge/v2" as const, envelope: "electron" as const, connection: remote ? "remote" as const : "local" as const,
    version: "0.1.42", origin: remote ? "https://novel.example.com" : "http://127.0.0.1:3000", insecureRemote: false,
    platform: "windows" as const, menuPresentation: "renderer" as const, windowControls: "overlay" as const,
});
export const desktopSettingsViewScenes = [
    {id: "default", label: "本地服务", input: {props: {status: desktopStatus(false), saveError: ""}, model: {settings: DEFAULT_DESKTOP_SETTINGS}}},
    {id: "remote-zoom-max", label: "远端与最大缩放", input: {props: {status: desktopStatus(true), saveError: ""}, model: {settings: {...DEFAULT_DESKTOP_SETTINGS, zoomFactor: 2, trayEnabled: false, closeBehavior: "quit" as const}}}},
    {id: "error", label: "更新失败", input: {props: {status: desktopStatus(false), saveError: "示例桌面桥返回失败"}, model: {settings: DEFAULT_DESKTOP_SETTINGS}}},
] satisfies LabFixtureDefinition<typeof DesktopSettingsView>["scenes"];

export const securitySettingsViewScenes = [
    {id: "enabled", label: "已开启", input: {props: {authEnabled: true}}},
    {id: "disabled", label: "已关闭", input: {props: {authEnabled: false}}},
    {id: "unknown", label: "状态读取中", input: {props: {authEnabled: null}}},
] satisfies LabFixtureDefinition<typeof SecuritySettingsView>["scenes"];

export const projectPickerHeaderScenes = [
    {id: "default", label: "桌面默认", input: {props: {isLoading: false, hasLoadError: false, isCreating: false}}},
    {id: "loading", label: "加载与创建禁用", input: {props: {isLoading: true, hasLoadError: false, isCreating: false}}},
    {id: "phone", label: "手机 390×844", input: {props: {isLoading: false, hasLoadError: false, isCreating: false}}},
] satisfies LabFixtureDefinition<typeof ProjectPickerHeader>["scenes"];
export const projectPickerEmptyStateScenes = [{id: "default", label: "零项目空态"}] satisfies LabFixtureDefinition<typeof ProjectPickerEmptyState>["scenes"];

const cardProject = {projectRoot: "workspace/projects/star-odyssey", kind: "novel" as const, title: "群星尽头的低语：流浪观测站实录", summary: "跃迁引擎熄灭的第十年，深空探测员在潮汐锁定行星上收到了来自地球的最后一封电波信。", manifestUpdatedAt: "2026-09-10T15:30:00Z"};
const cardProps = {project: cardProject, tags: ["硬科幻", "深空探索"], deleteBusy: false};
export const projectCardScenes = [
    {id: "fallback", label: "排版封面降级", input: {props: cardProps}},
    {id: "with-cover", label: "图片封面", input: {props: {...cardProps, project: {...cardProject, cover: "workspace/projects/star-odyssey/cover.jpg"}}}},
    {id: "delete-busy", label: "删除忙碌中", input: {props: {...cardProps, deleteBusy: true}}},
    {id: "delete-recovery", label: "删除错误待恢复", input: {props: {...cardProps, deleteRecovery: {attempt: 1, commitState: "unknown" as const, error: "文件被其他进程占用，删除操作已中止。请点击重试恢复。"}}}},
] satisfies LabFixtureDefinition<typeof ProjectCard>["scenes"];

export const projectCreateCoverPreviewScenes = [
    {id: "default", label: "默认通用", input: {props: {title: "未命名作品", genre: "general"}}},
    {id: "long-title", label: "长书名截断", input: {props: {title: "关于我在异界重构代码并试图拯救整个星系的这档事：终焉纪元序章", genre: "scifi"}}},
    {id: "xuanhuan", label: "玄幻修真题材", input: {props: {title: "九天剑魄凌霄录", genre: "xuanhuan"}}},
    {id: "scifi", label: "科幻未来题材", input: {props: {title: "仿生人的量子深渊", genre: "scifi"}}},
    {id: "mystery", label: "悬疑惊悚题材", input: {props: {title: "第十三号暗夜档案馆", genre: "mystery"}}},
] satisfies LabFixtureDefinition<typeof ProjectCreateCoverPreview>["scenes"];

const createProps = {isCreating: false, recoveryNotice: "", recoveryError: "", initialTitle: "", initialSummary: "", initialGenre: "general"};
export const projectCreateFormScenes = [
    {id: "default", label: "默认表单", input: {props: createProps}},
    {id: "filled", label: "已填写内容", input: {props: {...createProps, initialTitle: "黑夜之光：星际边境实录", initialSummary: "一部关于星系边缘流亡者与古老智械文明纠缠的长篇史诗。", initialGenre: "scifi"}}},
    {id: "creating", label: "创建中加载态", input: {props: {...createProps, isCreating: true}}},
    {id: "recovery-error", label: "恢复报错与重试", input: {props: {...createProps, recoveryNotice: "检测到上一次创建作品时网络中断，正在尝试恢复...", recoveryError: "工作区元数据写入失败：磁盘空间不足或权限受限（EACCES）。"}}},
    {id: "phone", label: "手机 390×844 折叠", input: {props: createProps}},
] satisfies LabFixtureDefinition<typeof ProjectCreateForm>["scenes"];

const createDialogProps = {isOpen: true, isCreating: false, recoveryNotice: "", recoveryError: "", teleportTarget: false};
export const projectCreateDialogScenes = [
    {id: "open", label: "打开弹窗", input: {props: createDialogProps}},
    {id: "creating", label: "创建中", input: {props: {...createDialogProps, isCreating: true}}},
    {id: "with-recovery", label: "恢复报错", input: {props: {...createDialogProps, recoveryNotice: "检测到上一次创建未完成，准备恢复...", recoveryError: "网络超时，无法与工作区守护进程通信。"}}},
] satisfies LabFixtureDefinition<typeof ProjectCreateDialog>["scenes"];

const coverProject = {projectRoot: "workspace/projects/cyber-city", kind: "novel" as const, title: "赛博霓虹：仿生纪元", summary: "在全自动化的人形都市中，一名记忆修复师偶然发现了一具被删除了所有情感模块的古老合成人。", manifestUpdatedAt: "2026-09-10T14:32:00Z"};
const coverDialogProps = {project: coverProject, busy: false, recoveryNotice: "", recoveryError: "", coverUrl: "", teleportTarget: false};
export const projectCoverDialogScenes = [
    {id: "default", label: "无封面状态", input: {props: coverDialogProps, model: {modelValue: true}}},
    {id: "with-cover", label: "已有封面状态", input: {props: {...coverDialogProps, project: {...coverProject, cover: "workspace/projects/cyber-city/cover.jpg"}, coverUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&q=80"}, model: {modelValue: true}}},
    {id: "busy", label: "处理中", input: {props: {...coverDialogProps, busy: true}, model: {modelValue: true}}},
] satisfies LabFixtureDefinition<typeof ProjectCoverDialog>["scenes"];
