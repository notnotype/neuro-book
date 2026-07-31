import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {
    AIMessage,
    AgentCatalog,
    AppendingSet,
    FileChangeNotice,
    HistorySet,
    If,
    Import,
    LinkedAgentsReminder,
    LinkedAgentsSummary,
    Message,
    MentionedSkillsReminder,
    ModeAvailabilityReminder,
    ModeReminder,
    ModeSlot,
    ModelContext,
    ProfilePrompt,
    Reminder,
    RuntimeLocationReminder,
    SqlSchemaSummary,
    System,
    SkillCatalog,
    TaskReminder,
    ToolCall,
    ToolResult,
    validateProfileTurnPlan,
    Watch,
    WorkspaceFocusReminder,
} from "nbook/server/agent/profiles/profile-dsl";
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {validateProfileRuntimeSettingsPatch} from "nbook/server/agent/profiles/profile-runtime-settings";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";
import type {AgentProfileDefinition, ProfilePrepareContext, SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {createTestRuntimeSession} from "nbook/server/agent/profiles/test/runtime-session";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {defineLowCodeForm} from "nbook/server/low-code-form";

type LegacyTestSidecar<TInput = JsonValue> = Omit<SidecarProfilePass<TInput, JsonValue>, "toolKeys"> & {
    toolKeys?: readonly string[];
    allowedToolKeys?: readonly string[];
};

type LegacyTestProfile<
    TInitialSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = Omit<AgentProfileDefinition<TInitialSchema, TSchema, TOutputSchema, undefined, TSummarizerKey, TTools>, "tools" | "toolKeys" | "sidecars"> & {
    tools?: ProfileTools;
    allowedToolKeys?: readonly string[];
    mainRunAllowedToolKeys?: readonly string[];
    toolKeys?: readonly string[];
    sidecars?: readonly LegacyTestSidecar<Static<TInitialSchema>>[];
};

function defineAgentProfile<
    TInitialSchema extends TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
>(profile: LegacyTestProfile<TInitialSchema, TOutputSchema, TSummarizerKey, TTools>): ReturnType<typeof defineRuntimeAgentProfile> {
    const {
        allowedToolKeys,
        mainRunAllowedToolKeys,
        sidecars,
        toolKeys,
        ...rest
    } = profile;
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(allowedToolKeys ?? []),
        toolKeys: toolKeys ?? mainRunAllowedToolKeys,
        // 测试 helper 只做旧字段到新字段的机械迁移，最终运行时校验仍由 defineRuntimeAgentProfile 负责。
        sidecars: sidecars?.map((sidecar) => {
            const {
                allowedToolKeys: sidecarAllowedToolKeys,
                ...sidecarRest
            } = sidecar;
            return {
                ...sidecarRest,
                toolKeys: sidecarRest.toolKeys ?? sidecarAllowedToolKeys,
            };
        }) as AgentProfileDefinition<TInitialSchema, TSchema, TOutputSchema, undefined, TSummarizerKey, TTools>["sidecars"],
    });
}

describe("profile TSX DSL", () => {
    it("直接调用 prepare 时只按 defaults < 调用方 settings 合并 Profile 自定义设置", async () => {
        const SettingsSchema = Type.Object({
            customPrompt: Type.String(),
            untouched: Type.String(),
        }, {additionalProperties: false});
        const settingsForm = defineLowCodeForm({
            schema: SettingsSchema,
            defaults: {
                customPrompt: "默认提示",
                untouched: "保留默认值",
            },
            fields: [],
        });
        let contextSettings: Record<string, unknown> | undefined;
        const contextProfile = defineRuntimeAgentProfile({
            manifest: {key: "test.settings-context", name: "Settings Context"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            settingsForm,
            context(ctx) {
                contextSettings = ctx.settings;
                return ProfilePrompt({children: System({children: "ok"})});
            },
        });

        await contextProfile.prepare!({
            ...context(),
            settings: {customPrompt: "用户提示"} as never,
        });

        expect(contextSettings).toMatchObject({
            customPrompt: "用户提示",
            untouched: "保留默认值",
        });

        let prepareSettings: Record<string, unknown> | undefined;
        const prepareProfile = defineRuntimeAgentProfile({
            manifest: {key: "test.settings-prepare", name: "Settings Prepare"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            settingsForm,
            prepare(ctx) {
                prepareSettings = ctx.settings;
                return {};
            },
        });

        await prepareProfile.prepare!({
            ...context(),
            settings: {customPrompt: "用户提示", fileChangeDiffMaxChars: 0} as never,
        });

        expect(prepareSettings).toMatchObject({
            customPrompt: "用户提示",
            untouched: "保留默认值",
        });
        expect(prepareSettings).not.toHaveProperty("fileChangeDiffMaxChars");
    });

    it("Profile 可以声明 summarizer 出厂默认值", () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.summarizer-typing",
                name: "Summarizer Typing",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                summarizer: {
                    enabled: true,
                    profileKey: "summarizer",
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                    maxDialogueContentTokens: 80_000,
                },
            },
            context() {
                return ProfilePrompt({children: Message({children: "ok"})});
            },
        });

        expect(profile.runtimeDefaults?.summarizer).toMatchObject({
            enabled: true,
            trigger: "afterInvocation",
            interval: {
                kind: "sourceInvocation",
                value: 1,
            },
        });
    });

    it("编译 ProfilePrompt 分区为 ProfileTurnPlan", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.dsl",
                name: "DSL",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        System({children: "system"}),
                        HistorySet({children: Message({children: "history"})}),
                        ModelContext({children: Message({children: "model"})}),
                        AppendingSet({children: Message({children: "append"})}),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect(plan.systemPrompt).toBe("system");
        expect((plan.historyInitMessages ?? []).map(messageText)).toEqual(["history"]);
        expect((plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : message.role)).toEqual(["model"]);
        expect((plan.appendingMessages ?? []).map(messageText)).toEqual(["append"]);
    });

    it("FileChangeNotice 由 Profile 在 AppendingSet 中声明位置", async () => {
        const profile = defineRuntimeAgentProfile({
            manifest: {key: "test.file-change", name: "File Change"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return ProfilePrompt({
                    children: AppendingSet({
                        children: [
                            Message({children: "BEFORE"}),
                            FileChangeNotice({mode: "full"}),
                            Message({children: "AFTER"}),
                        ],
                    }),
                });
            },
        });

        const baseContext = context();
        const plan = await profile.prepare!({
            ...baseContext,
            settings: {...baseContext.settings, fileChangeDiffMaxChars: 640},
        });

        expect((plan.appendingMessages ?? []).map(messageText)).toEqual(["BEFORE", "AFTER"]);
        expect(plan.turnContexts).toEqual([{
            kind: "file-change-notice",
            mode: "full",
            appendingIndex: 1,
        }]);
    });

    it("使用 profile runtimeDefaults compaction 配置", () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.compaction",
                name: "Compaction",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            runtimeDefaults: {
                compaction: {
                    trigger: {kind: "percent", value: 0.75},
                    keepRecent: {kind: "tokens", value: 12_000},
                },
            },
            context() {
                return ProfilePrompt({
                    children: [],
                });
            },
        });

        expect(profile.runtimeDefaults?.compaction).toEqual({
            trigger: {kind: "percent", value: 0.75},
            keepRecent: {kind: "tokens", value: 12_000},
        });
    });

    it("校验 Compaction 参数合同", async () => {
        expect(() => validateProfileRuntimeSettingsPatch("test.dsl", {
            compaction: {trigger: {kind: "percent", value: 1.2}},
        })).toThrow("compaction.trigger.value");

        expect(() => validateProfileRuntimeSettingsPatch("test.dsl", {
            compaction: {keepRecent: {kind: "tokens", value: 0}},
        })).toThrow("compaction.keepRecent.value");
        expect(() => validateProfileRuntimeSettingsPatch("test.dsl", {
            summarizer: {interval: {kind: "unknown", value: 1}},
        } as never)).toThrow("summarizer.interval.kind");
        expect(() => validateProfileRuntimeSettingsPatch("test.dsl", {
            compaction: {trigger: {kind: "autoReserve", value: 1}},
        } as never)).toThrow("compaction.trigger");
        expect(() => validateProfileRuntimeSettingsPatch("test.dsl", {
            compaction: {keepRecent: {kind: "tokens"}},
        } as never)).toThrow("compaction.keepRecent.value");
    });

    it("拒绝旧 PreparedTurn 字段和 Message system role", async () => {
        expect(() => validateProfileTurnPlan("test.dsl", {
            systemPrompt: "ok",
            toolKeys: [],
        } as never)).toThrow("toolKeys");

        const profile = defineAgentProfile({
            manifest: {
                key: "test.system-message",
                name: "System Message",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: Message({role: "system", children: "bad"})}),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("Message role");
    });

    it("校验 Reminder 和 Watch 落点", async () => {
        const modelReminderProfile = defineAgentProfile({
            manifest: {
                key: "test.model-reminder",
                name: "Model Reminder",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        ModelContext({children: Reminder({id: "model", children: Message({children: "visible"})})}),
                    ],
                });
            },
        });
        const modelReminderPlan = await modelReminderProfile.prepare!(context());
        expect((modelReminderPlan.modelContextAppendingMessages ?? []).map(messageText)).toEqual(["visible"]);
        expect(modelReminderPlan.modelContextMessages).toBeUndefined();

        const badReminderProfile = defineAgentProfile({
            manifest: {
                key: "test.bad-reminder",
                name: "Bad Reminder",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Reminder({id: "bad", children: Message({children: "bad"})})}),
                    ],
                });
            },
        });
        await expect(badReminderProfile.prepare!(context())).rejects.toThrow("Reminder");

        const watchProfile = defineAgentProfile({
            manifest: {
                key: "test.bad-watch",
                name: "Bad Watch",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Watch({path: "session.profileKey", children: Message({children: "bad"})})}),
                    ],
                });
            },
        });
        await expect(watchProfile.prepare!(context())).rejects.toThrow("Watch");
    });

    it("校验 Reminder 参数合同", async () => {
        const bothWatchInputs = defineAgentProfile({
            manifest: {
                key: "test.bad-reminder-watch",
                name: "Bad Reminder Watch",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: Reminder({
                                id: "bad",
                                watchPath: "client.foo",
                                watchValue: "foo",
                                children: Message({children: "bad"}),
                            }),
                        }),
                    ],
                });
            },
        });
        await expect(bothWatchInputs.prepare!(context())).rejects.toThrow("只能提供一个");

        const badRepeat = defineAgentProfile({
            manifest: {
                key: "test.bad-reminder-repeat",
                name: "Bad Reminder Repeat",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: Reminder({
                                id: "bad",
                                repeatEveryTurns: 0,
                                children: Message({children: "bad"}),
                            }),
                        }),
                    ],
                });
            },
        });
        await expect(badRepeat.prepare!(context())).rejects.toThrow("repeatEveryTurns");
    });

    it("ToolResult 必须匹配前序 ToolCall", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.tool-result",
                name: "Tool Result",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: [
                                AIMessage({children: ToolCall({id: "call-1", name: "read"})}),
                                ToolResult({toolCallId: "call-missing", toolName: "read", children: "result"}),
                            ],
                        }),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("ToolResult");
    });

    it("AIMessage 会递归收集 If/Fragment 内的 ToolCall", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.nested-tool-call",
                name: "Nested ToolCall",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: [
                                AIMessage({
                                    children: [
                                        "reading",
                                        If({condition: true, children: ToolCall({id: "call-1", name: "read"})}),
                                    ],
                                }),
                                ToolResult({toolCallId: "call-1", toolName: "read", children: "result"}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());
        const assistant = plan.historyInitMessages?.[0];

        expect(assistant?.role).toBe("assistant");
        expect(assistant?.role === "assistant" ? assistant.stopReason : null).toBe("toolUse");
        expect(assistant?.role === "assistant" ? assistant.content.map((block) => block.type) : []).toEqual(["text", "toolCall"]);
        expect(plan.historyInitMessages?.[1]?.role).toBe("toolResult");
    });

    it("拒绝 AIMessage ToolCall 后通过嵌套节点追加文本", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.tool-call-after-text",
                name: "ToolCall After Text",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: AIMessage({
                                children: [
                                    ToolCall({id: "call-1", name: "read"}),
                                    If({condition: true, children: "late text"}),
                                ],
                            }),
                        }),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("ToolCall 后不能再追加");
    });

    it("If false 不渲染子树也不写 state", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.if",
                name: "If",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: [
                                false && Reminder({id: "hidden", repeatEveryTurns: 1, children: Message({children: "hidden"})}),
                                Message({children: "visible"}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect((plan.appendingMessages ?? []).map(messageText)).toEqual(["visible"]);
        expect(plan.stateWrites).toBeUndefined();
    });

    it("SqlSchemaSummary 可作为 string fragment 注入 ModelContext", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.sql-summary",
                name: "SQL Summary",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        ModelContext({
                            children: Message({
                                children: SqlSchemaSummary({text: "SQL_SCHEMA"}),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect((plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : "")).toEqual(["SQL_SCHEMA"]);
    });

    it("Import 可导入共享 Markdown，并支持 heading 与 maxBytes", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.import",
                name: "Import",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: Import({
                                    path: "reference/README.md",
                                    heading: "Modules",
                                    maxBytes: 120,
                                    label: "Reference Modules",
                                }),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("[Import truncated: reference/README.md maxBytes=120]");
        expect(text).toContain("```reference/README.md");
        expect(text).toContain("```");
        expect(text).toContain("## Modules");
        expect(text).not.toContain("# NeuroBook Reference Bookshelf");
    });

    it("Import 可导入系统 skill 文档", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.import-system-skill",
                name: "Import System Skill",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({
                                path: "assets/workspace/.nbook/agent/skills/stop-slop/SKILL.md",
                                required: true,
                            }),
                        }),
                    }),
                });
            },
        });

        const plan = await profile.prepare!(context());
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("```assets/workspace/.nbook/agent/skills/stop-slop/SKILL.md");
        expect(text).toContain("# Stop Slop");
        expect(text).toContain("Eliminate predictable AI writing patterns from prose.");
    });

    it("Import 缺失文件默认渲染空消息，required=true 时抛错，并继续拒绝越界路径", async () => {
        const optionalProfile = defineAgentProfile({
            manifest: {
                key: "test.import-optional",
                name: "Import Optional",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "docs/no-such-import-file.md", required: false}),
                        }),
                    }),
                });
            },
        });

        const optionalPlan = await optionalProfile.prepare!(context());
        expect(optionalPlan.historyInitMessages ?? []).toEqual([]);

        const requiredProfile = defineAgentProfile({
            manifest: {
                key: "test.import-required",
                name: "Import Required",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "docs/no-such-import-file.md", required: true}),
                        }),
                    }),
                });
            },
        });
        await expect(requiredProfile.prepare!(context())).rejects.toThrow("no-such-import-file");

        const traversalProfile = defineAgentProfile({
            manifest: {
                key: "test.import-traversal",
                name: "Import Traversal",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "../AGENTS.md"}),
                        }),
                    }),
                });
            },
        });
        await expect(traversalProfile.prepare!(context())).rejects.toThrow("..");

        const disallowedProfile = defineAgentProfile({
            manifest: {
                key: "test.import-disallowed",
                name: "Import Disallowed",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "package.json"}),
                        }),
                    }),
                });
            },
        });
        await expect(disallowedProfile.prepare!(context())).rejects.toThrow("assets/workspace/.nbook/agent/skills");
    });

    it("SkillCatalog 只渲染 skills，不渲染 agent profiles", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.skill-catalog",
                name: "Skill Catalog",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: SkillCatalog({}),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!({
            ...context(),
            catalog: {
                profiles: [{
                    key: "writer",
                    name: "Writer",
                    description: "agent profile",
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                    hasSettingsForm: false,
                    canResetHome: false,
                    creationMode: "public",
                }],
                issues: [],
            },
            skills: [{
                key: "draft",
                name: "Draft Skill",
                description: "Write a draft.",
                whenToUse: "用户需要起草正文时",
                source: "system",
                rootPath: "assets/workspace/.nbook/agent/skills/draft",
                skillPath: "assets/workspace/.nbook/agent/skills/draft/SKILL.md",
            }],
        });
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("## Available Skills");
        expect(text).toContain("key: draft");
        expect(text).toContain("Draft Skill");
        expect(text).toContain(`location: ${resolve("assets", "workspace", ".nbook", "agent", "skills", "draft", "SKILL.md")}`);
        expect(text).toContain("read the SKILL.md file at the catalog location");
        expect(text).toContain("when_to_use");
        expect(text).not.toContain("## Available Agents");
        expect(text).not.toContain("writer");
    });

    it("SkillCatalog mode=userAssets 切换 roots 与长期资产纪律行", async () => {
        const renderCatalog = async (mode?: "workspace" | "userAssets") => {
            const profile = defineAgentProfile({
                manifest: {
                    key: "test.skill-catalog-mode",
                    name: "Skill Catalog Mode",
                },
                initialSchema: Type.Object({}),
                allowedToolKeys: [],
                context() {
                    return ProfilePrompt({
                        children: [
                            HistorySet({
                                children: Message({
                                    children: SkillCatalog(mode ? {mode} : {}),
                                }),
                            }),
                        ],
                    });
                },
            });
            const plan = await profile.prepare!({
                ...context(),
                skills: [{
                    key: "draft",
                    name: "Draft Skill",
                    description: "Write a draft.",
                    source: "system",
                    rootPath: "assets/workspace/.nbook/agent/skills/draft",
                    skillPath: "assets/workspace/.nbook/agent/skills/draft/SKILL.md",
                }],
            });
            return (plan.historyInitMessages ?? []).map(messageText).join("\n");
        };
        const workspaceText = await renderCatalog();
        const userAssetsText = await renderCatalog("userAssets");

        expect(workspaceText).toContain("- Skill roots: workspace/.nbook/agent/skills/ overrides assets/workspace/.nbook/agent/skills/.");
        expect(workspaceText).toContain("Stable world facts belong in Lorebook, plot progress belongs in Plot System");
        expect(userAssetsText).toContain("- Skill roots: agent/skills/ overrides assets/workspace/.nbook/agent/skills/.");
        expect(userAssetsText).not.toContain("Stable world facts belong in Lorebook");
        expect(userAssetsText).toContain("Do not hard-code temporary conversation preferences into long-term profiles or skill files");
        // 两种 mode 共享同一份主体原则。
        expect(userAssetsText).toContain("You may proactively choose a skill");
        expect(userAssetsText).toContain("If a skill conflicts with the user's goal, prioritize the user's goal");
        expect(userAssetsText).toContain("After using a skill, the final response should report key output");
    });

    it("profile skills.include 白名单在 prepare 层过滤可见 skill", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.skill-include",
                name: "Skill Include",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            skills: {include: ["profile-system-guide"]},
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: SkillCatalog({}),
                            }),
                        }),
                    ],
                });
            },
        });
        const plan = await profile.prepare!({
            ...context(),
            skills: [{
                key: "profile-system-guide",
                name: "Profile System Guide",
                description: "Profile 系统指南。",
                source: "system",
                rootPath: "assets/workspace/.nbook/agent/skills/profile-system-guide",
                skillPath: "assets/workspace/.nbook/agent/skills/profile-system-guide/SKILL.md",
            }, {
                key: "novel-workflow-09-chapter-writing",
                name: "Chapter Writing",
                description: "章节写作流程。",
                source: "system",
                rootPath: "assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing",
                skillPath: "assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md",
            }],
        });
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("key: profile-system-guide");
        expect(text).not.toContain("novel-workflow-09-chapter-writing");

        expect(() => defineAgentProfile({
            manifest: {key: "test.skill-include-dup", name: "Dup"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            skills: {include: ["a", "a"]},
            context() {
                return ProfilePrompt({children: []});
            },
        })).toThrow("skills.include 重复");
        expect(() => defineAgentProfile({
            manifest: {key: "test.skill-include-empty", name: "Empty"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            skills: {include: [" "]},
            context() {
                return ProfilePrompt({children: []});
            },
        })).toThrow("skills.include 不能包含空 key");
    });

    it("AgentCatalog 只渲染 agent profile 索引", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.agent-catalog",
                name: "Agent Catalog",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: AgentCatalog({}),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!({
            ...context(),
            catalog: {
                profiles: [{
                    key: "writer",
                    name: "Writer",
                    description: "写作 agent",
                    initialSchema: Type.Object({
                        prompt: Type.String({description: "写作任务说明。"}),
                        outputPath: Type.Optional(Type.String({description: "可选输出路径。"})),
                    }),
                    outputSchema: Type.Object({
                        summary: Type.String({description: "写作摘要。"}),
                    }),
                    toolKeys: ["read", "write"],
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                    hasSettingsForm: false,
                    canResetHome: false,
                    creationMode: "public",
                }, {
                    key: "summarizer",
                    name: "Summarizer",
                    description: "后台摘要",
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                    hasSettingsForm: false,
                    canResetHome: false,
                    creationMode: "system_only",
                }],
                issues: [],
            },
            skills: [],
        });
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("## Available Agents");
        expect(text).toContain("writer");
        expect(text).not.toContain("summarizer");
        expect(text).toContain("get_agent_profile");
        expect(text).not.toContain("allowedTools: read, write");
        expect(text).not.toContain("写作任务说明");
        expect(text).not.toContain("inputSchema");
        expect(text).not.toContain("\"type\"");
    });

    it("runtime reminder 节点能在 AppendingSet 注入可见 system-reminder", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.runtime-reminders",
                name: "Runtime Reminders",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        ModelContext({
                            children: Message({
                                children: SqlSchemaSummary({text: "SQL_SCHEMA"}),
                            }),
                        }),
                        AppendingSet({
                            children: [
                                RuntimeLocationReminder(),
                                WorkspaceFocusReminder(),
                                ModeAvailabilityReminder(),
                                LinkedAgentsReminder(),
                                TaskReminder({repeatEveryTurns: 8}),
                                ModeReminder(),
                                Message({children: MentionedSkillsReminder()}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!({
            ...context(),
            invocation: {
                caller: {kind: "user"},
                clientState: {
                    studio: {
                        workspace: "workspace/novel-7",
                        selectedFilePath: "manuscript/001-opening/index.md",
                    },
                },
            },
            session: {
                ...context().session,
                projectPath: "workspace/novel-7",
                messages: [createUserMessage({text: "use $draft please"})],
                customState: {
                    "agent.tasks": {
                        title: "Test plan",
                        steps: [{id: "one", text: "Do one", status: "pending"}],
                    },
                    "agent.mode": {
                        mode: "plan",
                        phase: "enter",
                        fromMode: "normal",
                        workDirectory: "workspace/.agent/123",
                    },
                },
                linkedAgents: [{sessionId: 7, profileKey: "writer", detached: false}],
                agentMode: "plan",
            },
        });
        const modelText = (plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : "").join("\n");
        const appendingText = (plan.appendingMessages ?? []).map(messageText).join("\n");

        expect(modelText).toBe("SQL_SCHEMA");
        expect(modelText).not.toContain("<dynamic-context>");
        expect(appendingText).toContain("Runtime Location:");
        expect(appendingText).toContain("- Tool cwd / Current Project Workspace: workspace/novel-7/");
        expect(appendingText).toContain("- Repository Source Root:");
        expect(appendingText).toContain("- Repository Reference Root:");
        expect(appendingText).toContain("current File Scope");
        expect(appendingText).toContain("Current Workspace Focus:");
        expect(appendingText).toContain("Current Project Workspace: workspace/novel-7");
        expect(appendingText).toContain("use lorebook/..., manuscript/..., or reference/... directly");
        expect(appendingText).toContain("Current selected file: manuscript/001-opening/index.md");
        expect(appendingText).not.toContain("You are in normal mode. switch_mode is available");
        expect(appendingText).toContain("Current linked agents:");
        expect(appendingText).toContain("Current task list: Test plan");
        expect(appendingText).toContain("## Mode Constraints");
        expect(appendingText).toContain("## Plan Work Directory");
        expect(appendingText).toContain("## Workflow");
        expect(appendingText).toContain("The user explicitly mentioned skill(s): $draft");
        expect(appendingText).toContain("read the matching SKILL.md location");
        expect(appendingText).not.toContain("{sessionId}");
    });

    it("LinkedAgentsReminder 空渲染只更新观察基线，不记录注入轮次", async () => {
        const profile = defineAgentProfile({
            manifest: {key: "test.empty-linked-agents", name: "Empty Linked Agents"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({children: AppendingSet({children: LinkedAgentsReminder()})});
            },
        });

        const plan = await profile.prepare!(context());

        expect(plan.appendingMessages ?? []).toEqual([]);
        expect(plan.stateWrites).toEqual([{
            type: "custom",
            key: "profileState.test.empty-linked-agents",
            value: {
                reminders: {
                    "linked-agents": {
                        hasValue: true,
                        value: [],
                        fingerprint: "[]",
                    },
                },
            },
        }]);
    });

    it("LinkedAgentsReminder 在清空后重新关联同一 Agent 时再次提醒", async () => {
        const profile = defineAgentProfile({
            manifest: {key: "test.linked-agent-sequence", name: "Linked Agent Sequence"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({children: AppendingSet({children: LinkedAgentsReminder()})});
            },
        });
        const base = context();
        const linkedAgent = {sessionId: 42, profileKey: "writer", detached: false};

        const empty = await profile.prepare!({...base, session: {...base.session, profileKey: "test.linked-agent-sequence", linkedAgents: []}});
        const emptyState = empty.stateWrites?.find((write) => write.type === "custom")?.value;
        const linked = await profile.prepare!({...base, session: {...base.session, profileKey: "test.linked-agent-sequence", linkedAgents: [linkedAgent], customState: {"profileState.test.linked-agent-sequence": emptyState!}}});
        const linkedState = linked.stateWrites?.find((write) => write.type === "custom")?.value;
        const cleared = await profile.prepare!({...base, session: {...base.session, profileKey: "test.linked-agent-sequence", linkedAgents: [], customState: {"profileState.test.linked-agent-sequence": linkedState!}}});
        const clearedState = cleared.stateWrites?.find((write) => write.type === "custom")?.value;
        const relinked = await profile.prepare!({...base, session: {...base.session, profileKey: "test.linked-agent-sequence", linkedAgents: [linkedAgent], customState: {"profileState.test.linked-agent-sequence": clearedState!}}});

        expect((linked.appendingMessages ?? []).map(messageText).join("\n")).toContain("Current linked agents:");
        expect(cleared.appendingMessages ?? []).toEqual([]);
        expect((relinked.appendingMessages ?? []).map(messageText).join("\n")).toContain("Current linked agents:");
        expect(JSON.stringify(clearedState)).toContain('"injectedAtTurn"');
    });

    it("LinkedAgentsSummary 为空时由通用 Message 空过滤删除", async () => {
        const profile = defineAgentProfile({
            manifest: {key: "test.empty-linked-summary", name: "Empty Linked Summary"},
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({children: AppendingSet({children: Message({children: LinkedAgentsSummary()})})});
            },
        });

        const plan = await profile.prepare!(context());

        expect(plan.appendingMessages ?? []).toEqual([]);
    });

    it("ModeAvailabilityReminder 只在 normal 模式注入可用性提醒", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.mode-availability",
                name: "Mode Availability",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: AppendingSet({
                        children: ModeAvailabilityReminder(),
                    }),
                });
            },
        });

        const normal = await profile.prepare!(context());
        expect((normal.appendingMessages ?? []).map(messageText).join("\n")).toContain("You are in normal mode. switch_mode is available");

        const base = context();
        const plan = await profile.prepare!({
            ...base,
            session: {
                ...base.session,
                agentMode: "plan",
            },
        });
        expect(plan.appendingMessages ?? []).toEqual([]);
    });

    it("WorkspaceFocusReminder 在 Project Workspace 或选中文件变化时注入焦点提醒", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.workspace-focus-reminder",
                name: "Workspace Focus Reminder",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: AppendingSet({
                        children: WorkspaceFocusReminder(),
                    }),
                });
            },
        });
        const base = context();
        const previousState = {
            "profileState.test.workspace-focus-reminder": {
                reminders: {
                    "workspace-focus": {
                        hasValue: true,
                        value: {
                            currentProjectWorkspace: "workspace/a",
                            selectedFilePath: "manuscript/001/index.md",
                        },
                        fingerprint: "{\"currentProjectWorkspace\":\"workspace/a\",\"selectedFilePath\":\"manuscript/001/index.md\"}",
                        injectedAtTurn: 1,
                    },
                },
            },
        };
        const unchanged = await profile.prepare!({
            ...base,
            invocation: {
                caller: {kind: "user"},
                clientState: {studio: {workspace: "workspace/a", selectedFilePath: "manuscript/001/index.md"}},
            },
            session: {
                ...base.session,
                profileKey: "test.workspace-focus-reminder",
                customState: previousState,
            },
        });
        const projectChanged = await profile.prepare!({
            ...base,
            invocation: {
                caller: {kind: "user"},
                clientState: {studio: {workspace: "workspace/b", selectedFilePath: null}},
            },
            session: {
                ...base.session,
                profileKey: "test.workspace-focus-reminder",
                customState: previousState,
            },
        });
        const fileChanged = await profile.prepare!({
            ...base,
            invocation: {
                caller: {kind: "user"},
                clientState: {studio: {workspace: "workspace/a", selectedFilePath: "manuscript/002/index.md"}},
            },
            session: {
                ...base.session,
                profileKey: "test.workspace-focus-reminder",
                customState: previousState,
            },
        });

        expect(unchanged.appendingMessages ?? []).toEqual([]);
        const text = (projectChanged.appendingMessages ?? []).map(messageText).join("\n");
        expect(text).toContain("User switched Current Project Workspace to workspace/b");
        expect(text).toContain("next invocation uses this Project Workspace as the File Scope");
        expect(text).toContain("Use lorebook/..., manuscript/..., and reference/... directly");
        expect(text).toContain("Use workspace/b when a tool explicitly asks for projectPath");

        const fileText = (fileChanged.appendingMessages ?? []).map(messageText).join("\n");
        expect(fileText).toContain("Current selected file changed to manuscript/002/index.md");
        expect(fileText).toContain("Use this cwd-relative path directly in file tools.");
    });

    it("ModeReminder 支持 exit 和 reentry lifecycle 文案", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.mode-reminder",
                name: "Mode Reminder",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: ModeReminder()}),
                    ],
                });
            },
        });

        const exitFromPlan = await profile.prepare!(modeContext("normal", "exit", "plan"));
        const exitFromDiscuss = await profile.prepare!(modeContext("normal", "exit", "discuss"));
        const reentryPlan = await profile.prepare!(modeContext("plan", "reentry", "normal"));

        const exitPlanText = (exitFromPlan.appendingMessages ?? []).map(messageText).join("\n");
        expect(exitPlanText).toContain("## Left Plan Mode");
        expect(exitPlanText).toContain("Implement the approved plan");
        expect(exitPlanText).not.toContain("Plan mode is still active");

        const exitDiscussText = (exitFromDiscuss.appendingMessages ?? []).map(messageText).join("\n");
        expect(exitDiscussText).toContain("## Left Discuss Mode");
        expect(exitDiscussText).not.toContain("Implement the approved plan");

        expect((reentryPlan.appendingMessages ?? []).map(messageText).join("\n")).toContain("## Re-entering Plan Mode");
    });

    it("ModeReminder 状态变化出全文，周期重放出 steady 轻文案", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.mode-reminder-steady",
                name: "Mode Reminder Steady",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: ModeReminder()}),
                    ],
                });
            },
        });

        const idle = await profile.prepare!(context());

        // normal 模式无 reminder：不注入消息，但会写观察基线且不记录注入轮次
        expect(idle.appendingMessages ?? []).toEqual([]);
        expect(idle.stateWrites?.find((write) => write.type === "custom")?.value).toEqual({
            reminders: {
                "agent-mode": {
                    hasValue: true,
                    value: {mode: "normal", state: null},
                    fingerprint: "{\"mode\":\"normal\",\"state\":null}",
                },
            },
        });

        const base = context();
        const modeState = {
            "agent.mode": {
                mode: "plan",
                phase: "enter",
                fromMode: "normal",
                workDirectory: "workspace/alpha/.agent/plan",
            },
        };
        const entered = await profile.prepare!({
            ...base,
            session: {
                ...base.session,
                profileKey: "test.mode-reminder-steady",
                projectPath: "workspace/alpha",
                agentMode: "plan",
                customState: modeState,
            },
        });
        const enteredText = (entered.appendingMessages ?? []).map(messageText).join("\n");

        expect(enteredText).toContain("Plan mode is active");
        expect(enteredText).toContain("## Mode Constraints");
        expect(enteredText).toContain("## Plan Work Directory");
        expect(enteredText).toContain(".agent/plan");
        expect(enteredText).toContain("planFilePath like .agent/plan/<slug>.md");
        expect(enteredText).toContain("approval UI displays that Project Workspace file");

        // 把第一次 prepare 写下的 reminder 指纹回填 customState，模拟 6 轮后的周期重放
        const reminderWrite = (entered.stateWrites ?? []).flatMap((write) => {
            return write.type === "custom" && write.key === "profileState.test.mode-reminder-steady" ? [write] : [];
        })[0];
        expect(reminderWrite).toBeDefined();
        const steady = await profile.prepare!({
            ...base,
            runtime: {now: "2026-05-23T00:00:00.000Z", promptUserTurnCount: 7},
            session: {
                ...base.session,
                profileKey: "test.mode-reminder-steady",
                projectPath: "workspace/alpha",
                agentMode: "plan",
                customState: {
                    ...modeState,
                    "profileState.test.mode-reminder-steady": reminderWrite!.value,
                },
            },
        });
        const steadyText = (steady.appendingMessages ?? []).map(messageText).join("\n");

        expect(steadyText).toContain("Plan mode is still active");
        expect(steadyText).not.toContain("## Mode Constraints");
        expect(steadyText).not.toContain("## Workflow");
    });

    it("ModeReminder 支持 ModeSlot 插槽覆盖默认文案", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.mode-slots",
                name: "Mode Slots",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: ModeReminder({
                                children: [
                                    ModeSlot({kind: "plan_enter", children: "CUSTOM_PLAN_ENTER"}),
                                    ModeSlot({kind: "plan_steady", children: "CUSTOM_PLAN_STEADY"}),
                                    ModeSlot({kind: "discuss_enter", children: "CUSTOM_DISCUSS_ENTER"}),
                                    ModeSlot({kind: "exit_from_plan", children: "CUSTOM_EXIT_FROM_PLAN"}),
                                ],
                            }),
                        }),
                    ],
                });
            },
        });

        const planEnter = await profile.prepare!(modeContext("plan", "enter", "normal"));
        const planSteady = await profile.prepare!(modeContext("plan", "steady", "normal"));
        const discussEnter = await profile.prepare!(modeContext("discuss", "enter", "normal"));
        const exitFromPlan = await profile.prepare!(modeContext("normal", "exit", "plan"));
        // 未覆盖的插槽档位回落默认文案
        const exitPlain = await profile.prepare!(modeContext("normal", "exit", "discuss"));

        const planEnterText = (planEnter.appendingMessages ?? []).map(messageText).join("\n");
        expect(planEnterText).toContain("CUSTOM_PLAN_ENTER");
        expect(planEnterText).toContain("Thread work directory:");
        expect(planEnterText).not.toContain("## Plan Work Directory");
        expect((planSteady.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_PLAN_STEADY");
        expect((discussEnter.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_DISCUSS_ENTER");
        expect((exitFromPlan.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_EXIT_FROM_PLAN");
        expect((exitPlain.appendingMessages ?? []).map(messageText).join("\n")).toContain("## Left Discuss Mode");
    });

    it("ModeSlot 不能脱离 ModeReminder 使用", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.bad-mode-slot",
                name: "Bad Mode Slot",
            },
            initialSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: ModeSlot({kind: "plan_enter", children: "bad"})}),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("ModeSlot");
    });

    it("拒绝 prepare 写入非 object 的 profile runtime state", () => {
        expect(() => validateProfileTurnPlan("test.dsl", {
            stateWrites: [{
                type: "custom",
                key: "profileState.test.dsl",
                value: "bad",
            }],
        })).toThrow("profile runtime state 必须是 object");

        expect(() => validateProfileTurnPlan("test.dsl", {
            stateWrites: [{
                type: "custom",
                key: "profileState.test.dsl",
                value: {
                    reminders: "bad",
                },
            }],
        })).toThrow("reminders 必须是 object map");
    });
});

function context(): ProfilePrepareContext<object> {
    const session: ProfilePrepareContext<object>["session"] = createTestRuntimeSession({
        messages: [createUserMessage({text: "prompt"})],
        profileKey: "test.dsl",
    });
    return {
        session,
        initial: {},
        vars: createTestVariableAccessor(),
        catalog: {
            profiles: [],
            issues: [],
        },
        skills: [],
        runtime: {
            now: "2026-05-23T00:00:00.000Z",
            promptUserTurnCount: 1,
        },
        settings: {},
    };
}

/** 构造带 agent.mode 状态的 prepare 上下文；mode/phase/fromMode 对应新模式状态。 */
function modeContext(mode: "normal" | "discuss" | "plan", phase: string, fromMode: "normal" | "discuss" | "plan"): ProfilePrepareContext<object> {
    return {
        ...context(),
        session: {
            ...context().session,
            agentMode: mode,
            customState: {
                "agent.mode": {
                    mode,
                    phase,
                    fromMode,
                    workDirectory: "workspace/.agent/custom",
                },
            },
        },
    };
}
