import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {toolset} from "nbook/server/agent/profiles/profile-tools";
import {defineLowCodeForm, defineResourcePreset, profileHomeResource, type LowCodeFieldDefinition} from "nbook/server/low-code-form";
import {
    readConfigAgentProfileSettings,
    loadEffectiveConfigForAgentRuntime,
    readConfigBootstrap,
    readConfigEditorSnapshot,
    resolveConfigTarget,
    resetProjectProfileHome,
    saveGlobalConfig,
    saveProjectConfig,
} from "nbook/server/config/config-service";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import type {GlobalConfigUpdateDto} from "nbook/shared/dto/config.dto";
import {disposeAgentHarness} from "nbook/server/agent/http";

const createdRoots: string[] = [];
const catalog = createCatalog(["leader.default", "leader.assets", "custom.agent", "writer"]);
const CONFIG_TEST_PROJECT_PATH = "workspace/config-test-project";
let isolatedAssets: IsolatedWorkspaceAssets | null = null;

describe("config service", {timeout: 30_000}, () => {
    beforeEach(async () => {
        isolatedAssets = await createIsolatedWorkspaceAssets({useAsCwd: true});
        await createProjectFixture();
        await openProjectForTest(CONFIG_TEST_PROJECT_PATH);
    });

    afterEach(async () => {
        await closeProjectForTest(CONFIG_TEST_PROJECT_PATH).catch(() => undefined);
        await disposeAgentHarness();
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
        await isolatedAssets?.dispose();
        isolatedAssets = null;
    });

    it("无配置文件时返回默认 Global + Project 快照且不创建文件", async () => {
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "USD"});
        await expect(fs.access(path.join("workspace", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("分离 State Root 时 Project Config 路径不回退到 cwd", async () => {
        const previousStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
        const stateRoot = path.join(isolatedAssets!.root, "separate-state");
        const projectRoot = path.join(stateRoot, "workspace", "separate-project");
        await fs.mkdir(projectRoot, {recursive: true});
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        try {
            const target = await resolveConfigTarget({
                workspaceKind: "novel",
                projectPath: "workspace/separate-project",
            });
            expect(target.projectConfigPath).toBe(path.join(projectRoot, ".nbook", "config.json"));
            expect(target.projectConfigPath).not.toBe(path.resolve(process.cwd(), "workspace", "separate-project", ".nbook", "config.json"));
        } finally {
            if (previousStateRoot === undefined) {
                delete process.env.NEURO_BOOK_STATE_ROOT;
            } else {
                process.env.NEURO_BOOK_STATE_ROOT = previousStateRoot;
            }
        }
    });

    it("Global Config 写入在文件 mutation 前拒绝不可运行模型", async () => {
        await expect(saveGlobalConfig({
            models: {
                default: "custom/broken",
                providers: [{
                    id: "custom",
                    name: "Custom",
                    enabled: true,
                    modelApi: null,
                    options: {
                        apiKey: {configured: false, maskedValue: null},
                        baseURL: "https://example.com/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "broken",
                        name: "Broken",
                        group: null,
                        enabled: true,
                        api: null,
                        reasoning: null,
                        input: null,
                        maxTokens: null,
                        contextWindowTokens: null,
                        cost: null,
                        compat: null,
                        headers: null,
                        thinkingLevelMap: null,
                    }],
                }],
            },
        } as never, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "missing_api"})])},
        });
        await expect(fs.access(path.join("workspace", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Global Config 写入拒绝缺少 Provider 默认 API", async () => {
        const models = validModelsInput();
        models.providers[0]!.modelApi = null;

        await expect(saveGlobalConfig({models}, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "missing_provider_model_api"})])},
        });
        await expect(fs.access(path.join("workspace", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("不包含 models 的 Global 保存不会被当前坏模型阻断", async () => {
        await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
        await fs.writeFile(path.join("workspace", ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "broken/model",
                providers: [{
                    id: "broken",
                    name: "Broken",
                    enabled: true,
                    modelApi: null,
                    options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [{id: "model", name: "Model", enabled: true}],
                }],
            },
        }, null, 4), "utf8");

        const snapshot = await saveGlobalConfig({ui: {theme: "sepia", customThemes: [], costCurrency: "USD"}}, {workspaceKind: "user-assets"});
        expect(snapshot.global.ui?.theme).toBe("sepia");
        expect(snapshot.modelSettings.validationIssues.some((issue) => issue.code === "missing_api")).toBe(true);
    });

    it("Global Config 写入拒绝重复 Provider ID", async () => {
        const models = validModelsInput();
        models.providers.push({...models.providers[0]!, models: [...models.providers[0]!.models]});
        await expect(saveGlobalConfig({models}, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "duplicate_provider_id"})])},
        });
    });

    it("disabled Provider 下的重复模型 ID 仍拒绝保存", async () => {
        const models = validModelsInput();
        models.providers[0]!.enabled = false;
        models.providers[0]!.models.push({...models.providers[0]!.models[0]!, enabled: false});

        await expect(saveGlobalConfig({models}, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "duplicate_model_id"})])},
        });
    });

    it("disabled Provider 的不完整模型仍拒绝保存", async () => {
        const models = validModelsInput();
        models.providers[0]!.enabled = false;
        models.providers[0]!.models[0]!.enabled = false;
        models.providers[0]!.models[0]!.api = null;

        await expect(saveGlobalConfig({models}, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "missing_api"})])},
        });
    });

    it("读取重复 Provider 配置保留全部原始条目、来源索引和 secret 状态", async () => {
        const models = validModelsInput();
        const first = models.providers[0]!;
        await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
        await fs.writeFile(path.join("workspace", ".nbook", "config.json"), JSON.stringify({
            models: {
                default: first.id + "/" + first.models[0]!.id,
                providers: [
                    {...first, options: {...first.options, apiKey: "first-secret"}},
                    {...first, name: "Second", options: {...first.options, apiKey: "second-secret"}},
                ],
            },
        }), "utf-8");

        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"});

        expect(snapshot.modelSettings.providers).toHaveLength(2);
        expect(snapshot.modelSettings.providers.map((provider) => provider.sourceIndex)).toEqual([0, 1]);
        expect(snapshot.modelSettings.providers.map((provider) => provider.options.apiKey.configured)).toEqual([true, true]);
        expect(snapshot.modelSettings.validationIssues.filter((issue) => issue.code === "duplicate_provider_id")).toHaveLength(2);
        expect(snapshot.modelSettings.enabledModels).toEqual([]);
    });

    it("已保存 Provider 不允许通过来源索引改名或继承旧 API key", async () => {
        const models = validModelsInput();
        const first = models.providers[0]!;
        await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
        await fs.writeFile(path.join("workspace", ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "first/model",
                providers: [
                    {...first, options: {...first.options, apiKey: "first-secret"}},
                    {...first, options: {...first.options, apiKey: "second-secret"}},
                ],
            },
        }), "utf-8");
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"});
        const providers = snapshot.modelSettings.providers.map((provider, index) => ({
            ...provider,
            id: index === 0 ? "first" : "second",
        }));

        const configPath = path.join("workspace", ".nbook", "config.json");
        const before = await fs.readFile(configPath, "utf-8");
        await expect(saveGlobalConfig({models: {default: "first/model", providers}}, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("Provider ID 不可修改"),
        });
        await expect(fs.readFile(configPath, "utf-8")).resolves.toBe(before);
    });

    it("已保存 Provider 的端点身份变化必须显式复制", async () => {
        await saveGlobalConfig({models: validModelsInput()}, {workspaceKind: "user-assets"});
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"});
        const provider = snapshot.modelSettings.providers[0]!;
        const configPath = path.join("workspace", ".nbook", "config.json");
        const before = await fs.readFile(configPath, "utf8");

        await expect(saveGlobalConfig({
            models: {
                default: snapshot.modelSettings.defaultModelKey,
                providers: [{...provider, options: {...provider.options, baseURL: "https://other.example/v1"}}],
            },
        }, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("连接身份不可修改"),
        });
        await expect(fs.readFile(configPath, "utf8")).resolves.toBe(before);
    });

    it("已保存 Provider 可修改默认接口并保留原 Secret", async () => {
        const initial = validModelsInput();
        initial.providers[0]!.options.apiKey = {configured: false, maskedValue: null, value: "sk-keep-model-api"};
        await saveGlobalConfig({models: initial}, {workspaceKind: "user-assets"});
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"});
        const provider = snapshot.modelSettings.providers[0]!;

        await saveGlobalConfig({
            models: {
                default: snapshot.modelSettings.defaultModelKey,
                providers: [{...provider, modelApi: "openai-responses"}],
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf8")) as {
            models?: {providers?: Array<{modelApi?: string; options?: {apiKey?: string}}>};
        };

        expect(raw.models?.providers?.[0]?.modelApi).toBe("openai-responses");
        expect(raw.models?.providers?.[0]?.options?.apiKey).toBe("sk-keep-model-api");
    });

    it("旧客户端省略 sourceIndex 时不会按 Provider ID 猜测 Secret", async () => {
        await saveGlobalConfig({models: validModelsInput()}, {workspaceKind: "user-assets"});
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"});
        const provider = snapshot.modelSettings.providers[0]!;
        const {sourceIndex: _sourceIndex, ...withoutSource} = provider;

        await expect(saveGlobalConfig({
            models: {default: snapshot.modelSettings.defaultModelKey, providers: [withoutSource]},
        }, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("必须携带来源索引"),
        });
    });

    it("删除 Provider 前扫描 managed Project 的显式模型引用", async () => {
        const models = validModelsInput();
        await saveGlobalConfig({models}, {workspaceKind: "user-assets"});
        const modelKey = `${models.providers[0]!.id}/${models.providers[0]!.models[0]!.id}`;
        await fs.mkdir(path.join("workspace", "config-test-project", ".nbook"), {recursive: true});
        await fs.writeFile(path.join("workspace", "config-test-project", ".nbook", "config.json"), JSON.stringify({
            models: {default: modelKey},
        }), "utf8");

        await expect(saveGlobalConfig({
            models: {default: null, providers: []},
        }, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({modelKey})])},
        });
    });

    it("Agent-only Global 保存拒绝不可运行 modelKey 且不写文件", async () => {
        await saveGlobalConfig({models: validModelsInput()}, {workspaceKind: "user-assets"});
        const configPath = path.join("workspace", ".nbook", "config.json");
        const before = await fs.readFile(configPath, "utf-8");

        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: null, userAssets: null},
                profileModelDefaults: {modelKey: "missing/model"},
                profileRuntimeDefaults: {},
                profiles: {},
            },
        }, {workspaceKind: "user-assets"})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "invalid_model_reference"})])},
        });
        expect(await fs.readFile(configPath, "utf-8")).toBe(before);
    });

    it("Global Config 写入拒绝无效 Profile 模型引用", async () => {
        await expect(saveGlobalConfig({
            models: validModelsInput(),
            agent: {
                defaultProfileKey: {novel: null, userAssets: null},
                profileModelDefaults: {modelKey: "missing/model"},
                profileRuntimeDefaults: {},
                profiles: {},
            },
        }, {workspaceKind: "user-assets"}, catalog)).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({
                code: "invalid_model_reference",
                path: ["agent", "profileModelDefaults", "modelKey"],
            })])},
        });
    });

    it("Provider enabled 缺省为 true，保存 false 时会持久化", async () => {
        await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
        await fs.writeFile(path.join("workspace", ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "legacy-provider/legacy-model",
                providers: [{
                    id: "legacy-provider",
                    name: "Legacy Provider",
                    modelApi: "openai-completions",
                    options: {
                        apiKey: "",
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "legacy-model",
                        name: "Legacy Model",
                        enabled: true,
                    }],
                }],
            },
        }, null, 4), "utf8");
        const legacySnapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"}, catalog);
        expect(legacySnapshot.modelSettings.providers[0]?.enabled).toBe(true);

        const saved = await saveGlobalConfig({
            models: {
                default: null,
                providers: [{
                    id: "legacy-provider",
                    sourceIndex: 0,
                    name: "Legacy Provider",
                    enabled: false,
                    modelApi: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: ""},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "legacy-model",
                        name: "Legacy Model",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        contextWindowTokens: 128000,
                        maxTokens: 8192,
                        cost: null,
                        compat: null,
                        headers: null,
                        thinkingLevelMap: null,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"}, catalog);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf8")) as {models?: {providers?: Array<{enabled?: boolean}>}};

        expect(saved.modelSettings.providers[0]?.enabled).toBe(false);
        expect(saved.modelSettings.enabledModels).toEqual([]);
        expect(raw.models?.providers?.[0]?.enabled).toBe(false);
    });

    it("Global UI 费用显示币种可以保存并被 bootstrap 读回", async () => {
        const snapshot = await saveGlobalConfig({
            ui: {
                theme: "custom-editor",
                customThemes: [{
                    id: "custom-editor",
                    name: "Editor Custom",
                    appearance: "dark",
                    vars: {
                        "bg-main": "#101014",
                        "accent-main": "#88ccff",
                    },
                }],
                costCurrency: "CNY",
            },
        }, {workspaceKind: "user-assets"});
        const bootstrap = await readConfigBootstrap({workspaceKind: "user-assets"}, catalog);

        expect(snapshot.global.ui?.theme).toBe("custom-editor");
        expect(snapshot.global.ui?.customThemes).toHaveLength(1);
        expect(snapshot.global.ui?.costCurrency).toBe("CNY");
        expect(snapshot.effective.ui).toMatchObject({theme: "custom-editor", costCurrency: "CNY"});
        expect(bootstrap.ui.theme).toBe("custom-editor");
        expect(bootstrap.ui.customThemes).toHaveLength(1);
        expect(bootstrap.ui.costCurrency).toBe("CNY");
    });

    it("非法 UI 费用显示币种会回退为 USD", async () => {
        const snapshot = await saveGlobalConfig({
            ui: {
                theme: "sepia",
                costCurrency: "EUR",
            },
        } as never, {workspaceKind: "user-assets"});

        expect(snapshot.global.ui?.costCurrency).toBe("USD");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "USD"});
    });

    it("Project Config 在 project.yaml 损坏时仍可读写", async () => {
        await fs.writeFile(path.join("workspace", "config-test-project", "project.yaml"), "kind: novel\ntitle: Config\nsummary: ''\na'a\n", "utf-8");

        const snapshot = await saveProjectConfig({
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"));
    });

    it("Project 未 open 时拒绝保存 Project Config", async () => {
        await closeProjectForTest(CONFIG_TEST_PROJECT_PATH);

        await expect(saveProjectConfig({
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH}, catalog)).rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("Project 未 open 时拒绝重置 Project Profile Home", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true, homeReset: true});
        await closeProjectForTest(CONFIG_TEST_PROJECT_PATH);

        await expect(resetProjectProfileHome({
            profileKey: "writer",
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH}, resourceCatalog)).rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("Project 未 open 时拒绝读取 project scope Profile settings", async () => {
        await closeProjectForTest(CONFIG_TEST_PROJECT_PATH);

        await expect(readConfigAgentProfileSettings({
            workspaceKind: "novel",
            projectPath: CONFIG_TEST_PROJECT_PATH,
        }, catalog, {
            agentProfileSettingsScope: "project",
        })).rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("Project 未 open 时 global scope Profile settings 仍只初始化 Global Profile Home", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await closeProjectForTest(CONFIG_TEST_PROJECT_PATH);

        const settings = await readConfigAgentProfileSettings({
            workspaceKind: "novel",
            projectPath: CONFIG_TEST_PROJECT_PATH,
        }, resourceCatalog, {
            agentProfileSettingsScope: "global",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings).not.toBeNull();
        await fs.access(path.join("workspace", ".nbook", "agents", "writer", "home.json"));
        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "home.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Global secret 写回缺失 value 时保留旧 API key", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-test-123456"},
                        baseURL: "https://api.deepseek.com/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8192,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    sourceIndex: 0,
                    name: "DeepSeek",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {
                        apiKey: {configured: true, maskedValue: "sk-t...3456"},
                        baseURL: "https://api.deepseek.com/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8192,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            models?: {providers?: Array<{options: {apiKey: string}}>}
        };

        expect(raw.models?.providers?.[0]?.options.apiKey).toBe("sk-test-123456");
        expect(snapshot.modelSettings.providers[0]?.options.apiKey).toEqual({
            configured: true,
            maskedValue: "sk-t...3456",
        });
    });

    it("Global web secret 写回缺失 value 时保留旧 API key 并脱敏展示", async () => {
        await saveGlobalConfig({
            web: {
                search: {
                    order: ["tavily", "brave"],
                    providers: {
                        tavily: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "tvly-secret-123456"},
                        },
                        brave: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "brave-secret-123456"},
                            country: "US",
                            searchLang: "en",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            web: {
                search: {
                    order: ["brave", "tavily"],
                    providers: {
                        tavily: {
                            enabled: true,
                            apiKey: {configured: true, maskedValue: "tvly...3456"},
                        },
                        brave: {
                            enabled: true,
                            apiKey: {configured: true, maskedValue: "brav...3456"},
                            country: "JP",
                            searchLang: "ja",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            web?: {search?: {providers?: {tavily?: {apiKey?: string}; brave?: {apiKey?: string}}}}
        };

        expect(raw.web?.search?.providers?.tavily?.apiKey).toBe("tvly-secret-123456");
        expect(raw.web?.search?.providers?.brave?.apiKey).toBe("brave-secret-123456");
        expect(snapshot.global.web?.search?.providers?.tavily?.apiKey).toEqual({
            configured: true,
            maskedValue: "tvly...3456",
        });
        expect(snapshot.effective.web.search.order).toEqual(["brave", "tavily"]);
        expect(snapshot.effective.web.search.providers.brave.country).toBe("JP");
    });

    it("Global web 部分写回会保留模型配置段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-keep-model"},
                        baseURL: "https://api.deepseek.com/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8192,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            web: {
                search: {
                    order: ["brave", "tavily"],
                    providers: {
                        brave: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "brave-web-key"},
                            country: "US",
                            searchLang: "en",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});

        expect(snapshot.modelSettings.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(snapshot.modelSettings.providers[0]?.options.apiKey.configured).toBe(true);
        expect(snapshot.effective.web.search.providers.brave.enabled).toBe(true);
        expect(snapshot.effective.web.search.providers.brave.apiKey).toBe("brave-web-key");
    });

    it("Global 部分写回会保留未提交的配置段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-keep-me"},
                        baseURL: "https://api.deepseek.com/v1",
                        proxy: "",
                        timeoutMs: 180000,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8192,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const configPath = path.join("workspace", ".nbook", "config.json");
        const withOldAuth = JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
        withOldAuth.auth = {enabled: false};
        await fs.writeFile(configPath, `${JSON.stringify(withOldAuth, null, 4)}\n`, "utf-8");

        const snapshot = await saveGlobalConfig({
            ui: {theme: "sepia", customThemes: [], costCurrency: "USD"},
        }, {workspaceKind: "user-assets"});

        expect(snapshot.modelSettings.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(snapshot.modelSettings.providers).toHaveLength(1);
        const raw = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
            auth?: unknown;
            models?: {providers?: Array<{options: {apiKey: string}}>}
        };
        expect(raw.auth).toBeUndefined();
        expect(raw.models?.providers?.[0]?.options.apiKey).toBe("sk-keep-me");
    });

    it("Global 模型写回会保留 Pi Model 字段", async () => {
        const snapshot = await saveGlobalConfig({
            models: {
                default: "custom/mimo-vl",
                providers: [{
                    id: "custom",
                    name: "Custom",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-custom"},
                        baseURL: "https://model.example/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "mimo-vl",
                        name: "Mimo Vision",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: true,
                        input: ["text", "image"],
                        maxTokens: 1234,
                        cost: {
                            input: 1,
                            output: 2,
                            cacheRead: 3,
                            cacheWrite: 4,
                        },
                        compat: {
                            thinkingFormat: "deepseek",
                            supportsStrictMode: false,
                        },
                        headers: {"X-Test": "value"},
                        thinkingLevelMap: {high: "high"},
                        contextWindowTokens: 98765,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const visionModel = snapshot.modelSettings.providers[0]?.models.find((model) => model.id === "mimo-vl");

        expect(visionModel).toMatchObject({
            api: "openai-completions",
            reasoning: true,
            input: ["text", "image"],
            maxTokens: 1234,
            cost: {
                input: 1,
                output: 2,
                cacheRead: 3,
                cacheWrite: 4,
            },
            compat: {
                thinkingFormat: "deepseek",
                supportsStrictMode: false,
            },
            headers: {"X-Test": "value"},
            thinkingLevelMap: {high: "high"},
            contextWindowTokens: 98765,
        });
    });

    it("Project Config 可以覆盖默认模型、embedding 模型与默认 profile，但拒绝全局字段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "https://api.deepseek.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, api: "openai-completions", reasoning: false, input: ["text"], maxTokens: 8192, contextWindowTokens: 128000},
                        {id: "b", name: "B", group: null, enabled: true, api: "openai-completions", reasoning: false, input: ["text"], maxTokens: 8192, contextWindowTokens: 128000},
                    ],
                }],
            },
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {encoding_format: "float"},
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            models: {default: "deepseek/b"},
            embedding: {model: "project-embed", dimensions: 768},
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/b");
        expect(snapshot.effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 768,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
            timeoutMs: 30000,
            requestOptions: {encoding_format: "float"},
        });
        expect(snapshot.embeddingSettings.global.apiKey).toEqual({
            configured: true,
            maskedValue: "sk-e...ding",
        });
        expect(snapshot.embeddingSettings.project).toEqual({
            model: "project-embed",
            dimensions: 768,
        });
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("custom.agent");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await expect(saveProjectConfig({
            models: {
                default: "deepseek/b",
                providers: [],
            } as never,
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"})).rejects.toMatchObject({statusCode: 400});
        await expect(saveProjectConfig({
            embedding: {
                model: "bad",
                baseURL: "https://project-should-not-own-service.example/v1",
            } as never,
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"})).rejects.toMatchObject({statusCode: 400});
    });

    it("Project section patch 保留未提交的 models、agent、editor 与 history", async () => {
        await saveGlobalConfig({models: validModelsInput()}, {workspaceKind: "user-assets"});
        await saveProjectConfig({
            models: {default: "local/model"},
            agent: {
                defaultProfileKey: "leader.default",
                profileModelDefaults: {modelKey: "local/model"},
                profiles: {writer: {model: {modelKey: "local/model"}}},
            },
            editor: {markdown: {fontSize: 18}},
            history: {retentionFullDays: 30},
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH});

        await saveProjectConfig({
            embedding: {model: "project-embed", dimensions: 768},
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", "config-test-project", ".nbook", "config.json"), "utf-8")) as {
            models: {default: string};
            agent: {profileModelDefaults: {modelKey: string}; profiles: {writer: {model: {modelKey: string}}}};
            editor: {markdown: {fontSize: number}};
            history: {retentionFullDays: number};
            embedding: {model: string; dimensions: number};
        };

        expect(raw.models).toEqual({default: "local/model"});
        expect(raw.agent.profileModelDefaults.modelKey).toBe("local/model");
        expect(raw.agent.profiles.writer.model.modelKey).toBe("local/model");
        expect(raw.editor.markdown.fontSize).toBe(18);
        expect(raw.history.retentionFullDays).toBe(30);
        expect(raw.embedding).toEqual({model: "project-embed", dimensions: 768});
    });

    it("Project 默认模型与 Profile modelKey 必须引用 runnable 模型", async () => {
        await saveGlobalConfig({models: validModelsInput()}, {workspaceKind: "user-assets"});

        await expect(saveProjectConfig({
            models: {default: "missing/model"},
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "invalid_model_reference"})])},
        });
        await expect(saveProjectConfig({
            agent: {profiles: {writer: {model: {modelKey: "missing/model"}}}},
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH})).rejects.toMatchObject({
            statusCode: 400,
            data: {issues: expect.arrayContaining([expect.objectContaining({code: "invalid_model_reference"})])},
        });
    });

    it("Global 模型保存不扫描、不修改当前 Project 的历史失效引用", async () => {
        const projectConfigPath = path.join("workspace", "config-test-project", ".nbook", "config.json");
        await fs.mkdir(path.dirname(projectConfigPath), {recursive: true});
        await fs.writeFile(projectConfigPath, JSON.stringify({
            models: {default: "missing/model"},
            agent: {profileModelDefaults: {modelKey: "missing/model"}},
        }, null, 4), "utf-8");
        const before = await fs.readFile(projectConfigPath, "utf-8");

        await saveGlobalConfig({models: validModelsInput()}, {
            workspaceKind: "novel",
            projectPath: CONFIG_TEST_PROJECT_PATH,
        });

        expect(await fs.readFile(projectConfigPath, "utf-8")).toBe(before);
    });

    it("Project Config 的 null 覆盖会回落到 Global Config", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "https://api.deepseek.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, api: "openai-completions", reasoning: false, input: ["text"], maxTokens: 8192, contextWindowTokens: 128000},
                    ],
                }],
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            models: {default: null},
            agent: {defaultProfileKey: null},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/a");
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("leader.default");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
    });

    it("Global embedding 启用后空模型和空维度会写入默认值", async () => {
        const snapshot = await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: null,
                dimensions: null,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.global.embedding).toMatchObject({
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: 1536,
            timeoutMs: 30000,
        });
        expect(snapshot.effective.embedding).toMatchObject({
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: 1536,
            timeoutMs: 30000,
        });
    });

    it("Agent runtime 配置读取会合并 Project embedding 覆盖", async () => {
        await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});
        await saveProjectConfig({
            embedding: {
                model: "project-embed",
                dimensions: 768,
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const effective = await loadEffectiveConfigForAgentRuntime({
            projectPath: "workspace/config-test-project",
        });

        expect(effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 768,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
        });
    });

    it("Agent runtime 配置读取支持外部 Project Workspace 绝对 projectPath", async () => {
        const externalProjectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nbook-external-project-")), "external-project");
        createdRoots.push(path.dirname(externalProjectRoot));
        await fs.mkdir(path.join(externalProjectRoot, ".nbook"), {recursive: true});
        await fs.writeFile(path.join(externalProjectRoot, "project.yaml"), [
            "kind: novel",
            "title: External Project",
            "summary: ''",
            "",
        ].join("\n"), "utf-8");
        await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});
        await fs.writeFile(path.join(externalProjectRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                model: "external-embed",
                dimensions: 384,
            },
        }, null, 4), "utf-8");

        const effective = await loadEffectiveConfigForAgentRuntime({
            projectPath: externalProjectRoot,
        });

        expect(effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "external-embed",
            dimensions: 384,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
        });
    });

    it("Agent Profile 模型默认参数支持 Project 覆盖并被 profile 继承", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profileModelDefaults: {
                    reasoningEffort: "high",
                    realtimeOutput: false,
                },
                profiles: {
                    "leader.default": {
                        model: {
                            temperature: 0.4,
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        await saveProjectConfig({
            agent: {
                profileModelDefaults: {
                    temperature: 0.5,
                    reasoningEffort: "low",
                },
                profiles: {
                    "leader.default": {
                        model: {
                            reasoningEffort: "medium",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const leader = settings.agentProfiles.find((profile) => profile.profileKey === "leader.default");
        const assets = settings.agentProfiles.find((profile) => profile.profileKey === "leader.assets");

        expect(settings.profileModelDefaults).toMatchObject({
            reasoningEffort: "low",
            realtimeOutput: false,
            temperature: 0.5,
        });
        expect(leader?.model).toMatchObject({
            temperature: 0.4,
            reasoningEffort: "medium",
            realtimeOutput: false,
        });
        expect(assets?.model).toMatchObject({
            temperature: 0.5,
            reasoningEffort: "low",
            realtimeOutput: false,
        });
    });

    it("Project 只覆盖 Agent Profile 默认参数时也会更新已有 Global profile 的 effective model", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profileModelDefaults: {
                    reasoningEffort: "off",
                    realtimeOutput: true,
                },
                profiles: {
                    "leader.default": {
                        model: {
                            temperature: 0.3,
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        await saveProjectConfig({
            agent: {
                profileModelDefaults: {
                    reasoningEffort: "xhigh",
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const leader = settings.agentProfiles.find((profile) => profile.profileKey === "leader.default");

        expect(leader?.model).toMatchObject({
            temperature: 0.3,
            reasoningEffort: "xhigh",
            realtimeOutput: true,
        });
    });

    it("editor snapshot 不读取 Agent Profile catalog", async () => {
        const optionsProvider = vi.fn(() => [
            {value: "default-style", label: "默认文风"},
            {value: "cinematic", label: "电影感"},
        ]);
        const lightCatalog = createCatalog(["writer"], {writingStyleOptions: optionsProvider});
        const snapshotSpy = vi.spyOn(lightCatalog, "snapshot");
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"}, lightCatalog);

        expect(snapshotSpy).not.toHaveBeenCalled();
        expect("agentProfileSettings" in snapshot).toBe(false);
        expect(optionsProvider).not.toHaveBeenCalled();
    });

    it("Agent Profile settings 专用接口读取每个 loaded Profile 的 runtime defaults", async () => {
        const profileCatalog = createCatalog(["leader.default", "leader.assets", "custom.agent", "writer"]);
        const getSpy = vi.spyOn(profileCatalog, "get");

        try {
            const settings = await readConfigAgentProfileSettings({workspaceKind: "user-assets"}, profileCatalog);
            const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

            expect(writer?.settings?.form.fields.map((field) => field.path)).toEqual(["writingStylePreset", "narrativePerson"]);
            expect(writer?.loadStatus).toBe("loaded");
            expect(writer?.hasSettingsForm).toBe(true);
            expect(getSpy).toHaveBeenCalledTimes(4);
            expect(getSpy.mock.calls.map(([profileKey]) => profileKey).sort()).toEqual([
                "custom.agent",
                "leader.assets",
                "leader.default",
                "writer",
            ]);
        } finally {
            getSpy.mockRestore();
        }
    });

    it("所有 Profile 都返回 runtime 默认、各层 patch 与最终有效值", async () => {
        await saveGlobalConfig({
            agent: {
                profiles: {
                    "custom.agent": {
                        model: {},
                        runtime: {
                            summarizer: {enabled: true},
                            fileChangeNotice: {diffMaxChars: 1024},
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH}, catalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: CONFIG_TEST_PROJECT_PATH}, catalog, {
            agentProfileSettingsScope: "global",
        });
        const custom = settings.agentProfiles.find((profile) => profile.profileKey === "custom.agent");
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(custom?.runtime.globalProfilePatch).toEqual({
            summarizer: {enabled: true},
            fileChangeNotice: {diffMaxChars: 1024},
        });
        expect(custom?.runtime.effective.summarizer.enabled).toBe(true);
        expect(custom?.runtime.effective.fileChangeNotice.diffMaxChars).toBe(1024);
        expect(writer?.runtime.effective.fileChangeNotice.diffMaxChars).toBe(512);
    });

    it("Agent Profile settings 支持 Global 保存并返回 form 与 effective value", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cinematic",
                            narrativePerson: "first",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, catalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "user-assets"}, catalog);
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.form.fields.map((field) => field.path)).toEqual(["writingStylePreset", "narrativePerson"]);
        expect(writer?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(writer?.settings?.inheritedValue).toMatchObject({
            writingStylePreset: "default-style",
            narrativePerson: "third",
        });
        expect(writer?.settings?.globalPatch).toEqual({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
    });

    it("Agent Profile settings 支持 Project patch 覆盖与继承", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cinematic",
                            narrativePerson: "first",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            narrativePerson: "second",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);
        const overrideSettings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const overridden = overrideSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(overridden?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "second",
        });
        expect(overridden?.settings?.inheritedValue).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(overridden?.settings?.projectPatch).toEqual({
            narrativePerson: "second",
        });

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {},
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);
        const inheritedSettings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {
            agentProfileSettingsScope: "project",
        });
        const inherited = inheritedSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(inherited?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(inherited?.settings?.projectPatch).toEqual({});
    });

    it("Agent Profile settings 保存 Project patch 时按继承后的 effective value 校验", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cross-invalid",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            narrativePerson: "second",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});
    });

    it("Agent Profile settings 保存时拒绝非法 option 与自定义校验错误", async () => {
        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "missing",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});

        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "forbidden",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});
    });

    it("Project 保存应用 resource mutations 且不把 mutations 写入 config", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/new.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "新文风",
                            slug: "new",
                            content: "新的文风正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", "config-test-project", ".nbook", "config.json"), "utf-8")) as {
            agent?: {profiles?: {writer?: {resourceMutations?: unknown; settings?: {writingStylePreset?: string}}}}
        };

        expect(raw.agent?.profiles?.writer?.settings?.writingStylePreset).toBe("styles/new.md");
        expect(raw.agent?.profiles?.writer?.resourceMutations).toBeUndefined();
        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "new.md"), "utf-8")).resolves.toContain("新的文风正文");
    });

    it("Project 保存 settings 校验失败时不会先写入 resource mutations", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        const resourcePath = path.join("workspace", "config-test-project", "agents", "writer", "styles", "invalid-save.md");

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/invalid-save.md",
                            narrativePerson: "bad",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "不应落盘",
                            slug: "invalid-save",
                            content: "这段内容不应该写入 profile home",
                        }],
                    },
                },
            },
        } as never, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});
        await expect(fs.access(resourcePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Project 保存按 resource mutations 最终 key 校验 selected key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/first.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "先创建",
                            slug: "first",
                            content: "不应该落盘",
                        }, {
                            type: "rename",
                            fieldPath: "writingStylePreset",
                            key: "styles/first.md",
                            label: "最终资源",
                            slug: "second",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});

        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "styles", "first.md"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "styles", "second.md"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Project 保存按 resource mutations 最终 key 校验没有 validateKey 的 resolver", async () => {
        const resourceCatalog = createCatalog(["writer"], {customWritingStyleResourceWithoutValidateKey: true});

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/new.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "新文风",
                            slug: "new",
                            content: "新的正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "project",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.projectPatch).toEqual({writingStylePreset: "styles/new.md"});
    });

    it("Project 保存拒绝 rename 后继续保存旧 selected key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await fs.mkdir(path.join("workspace", "config-test-project", "agents", "writer", "styles"), {recursive: true});
        await fs.writeFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "旧正文", "utf-8");

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/old.md",
                        },
                        resourceMutations: [{
                            type: "rename",
                            fieldPath: "writingStylePreset",
                            key: "styles/old.md",
                            label: "新资源",
                            slug: "new",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});

        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "utf-8")).resolves.toBe("旧正文");
    });

    it("Project 保存拒绝删除当前最终 selected key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await fs.mkdir(path.join("workspace", "config-test-project", "agents", "writer", "styles"), {recursive: true});
        await fs.writeFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "旧正文", "utf-8");

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/old.md",
                        },
                        resourceMutations: [{
                            type: "remove",
                            fieldPath: "writingStylePreset",
                            key: "styles/old.md",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({statusCode: 400});

        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "old.md"), "utf-8")).resolves.toBe("旧正文");
    });

    it("Project 显式保存 global-only resource key 时要求先复制到项目", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await saveGlobalConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "全局正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, resourceCatalog);

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog)).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining("请先复制到项目"),
        });
    });

    it("Project 复制 global resource 到项目后允许保存同 key", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});
        await saveGlobalConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "全局正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, resourceCatalog);

        await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "项目固化正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "project",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.projectPatch).toEqual({writingStylePreset: "styles/global-only.md"});
        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "global-only.md"), "utf-8")).resolves.toContain("项目固化正文");
    });

    it("Project 可以重置 profile home 并刷新完整 settings snapshot", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true, homeReset: true});
        const customPath = path.join("workspace", "config-test-project", "agents", "writer", "styles", "custom.md");
        await fs.mkdir(path.dirname(customPath), {recursive: true});
        await fs.writeFile(customPath, "用户自定义", "utf-8");

        await resetProjectProfileHome({
            profileKey: "writer",
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "project",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        await expect(fs.access(customPath)).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.readFile(path.join("workspace", "config-test-project", "agents", "writer", "styles", "reset.md"), "utf-8")).resolves.toBe("reset");
        expect(writer?.canResetHome).toBe(true);
        expect(writer?.settings?.form.fields[0]?.resource?.options).toEqual([expect.objectContaining({key: "styles/reset.md"})]);
    });

    it("Global 保存完整 Agent Profile settings 时初始化 Global profile home 且不初始化 Project profile home", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/global-only.md",
                            narrativePerson: "first",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "全局文风",
                            slug: "global-only",
                            content: "全局正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog);
        const settings = await readConfigAgentProfileSettings({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, resourceCatalog, {
            agentProfileSettingsScope: "global",
        });
        const writer = settings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.form.fields[0]?.resource?.options).toEqual([expect.objectContaining({
            key: "styles/global-only.md",
            origin: "global",
        })]);
        await fs.access(path.join("workspace", ".nbook", "agents", "writer", "home.json"));
        await expect(fs.access(path.join("workspace", "config-test-project", "agents", "writer", "home.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Global 保存应用 resource mutations 且不把 mutations 写入 config", async () => {
        const resourceCatalog = createCatalog(["writer"], {writingStyleResource: true});

        await saveGlobalConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "styles/new.md",
                        },
                        resourceMutations: [{
                            type: "create",
                            fieldPath: "writingStylePreset",
                            label: "新文风",
                            slug: "new",
                            content: "全局新文风正文",
                        }],
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, resourceCatalog);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            agent?: {profiles?: {writer?: {resourceMutations?: unknown; settings?: {writingStylePreset?: string}}}}
        };

        expect(raw.agent?.profiles?.writer?.settings?.writingStylePreset).toBe("styles/new.md");
        expect(raw.agent?.profiles?.writer?.resourceMutations).toBeUndefined();
        await expect(fs.readFile(path.join("workspace", ".nbook", "agents", "writer", "styles", "new.md"), "utf-8")).resolves.toContain("全局新文风正文");
    });
});

function validModelsInput(): NonNullable<GlobalConfigUpdateDto["models"]> {
    return {
        default: "local/model",
        providers: [{
            id: "local",
            name: "Local",
            enabled: true,
                    modelApi: "openai-completions",
            options: {
                apiKey: {configured: false, maskedValue: null},
                baseURL: "https://example.com/v1",
                proxy: "",
                timeoutMs: null,
                requestOptions: {},
            },
            models: [{
                id: "model",
                name: "Model",
                group: null,
                enabled: true,
                api: "openai-completions",
                reasoning: false,
                input: ["text"],
                maxTokens: 4096,
                contextWindowTokens: 8192,
                cost: null,
                compat: null,
                headers: null,
                thinkingLevelMap: null,
            }],
        }],
    };
}

async function createProjectFixture(): Promise<void> {
    await fs.mkdir(path.join("workspace", "config-test-project"), {recursive: true});
    await fs.writeFile(path.join("workspace", "config-test-project", "project.yaml"), [
        "kind: novel",
        "title: Config Test Project",
        "summary: ''",
        "",
    ].join("\n"), "utf-8");
}

function createCatalog(
    profileKeys: string[],
    options: {writingStyleOptions?: LowCodeFieldDefinition["options"]; writingStyleResource?: boolean; customWritingStyleResourceWithoutValidateKey?: boolean; homeReset?: boolean} = {},
): AgentProfileCatalog {
    const profileCatalog = new AgentProfileCatalog("__missing_system__", "__missing_user__");
    const writerSettingsForm = defineLowCodeForm({
        schema: Type.Object({
            writingStylePreset: Type.String(),
            narrativePerson: Type.Union([
                Type.Literal("first"),
                Type.Literal("second"),
                Type.Literal("third"),
            ]),
        }, {additionalProperties: false}),
        defaults: {
            writingStylePreset: "default-style",
            narrativePerson: "third",
        },
        fields: [
            {
                path: "writingStylePreset",
                component: options.writingStyleResource || options.customWritingStyleResourceWithoutValidateKey ? "resource-preset" : "combobox",
                label: "文风预设",
                ...(options.writingStyleResource || options.customWritingStyleResourceWithoutValidateKey ? {
                    resource: options.customWritingStyleResourceWithoutValidateKey
                        ? defineResourcePreset({
                            contentType: "markdown",
                            template: "模板",
                            createKeyPrefix: "styles/",
                            createKeySuffix: ".md",
                            list: () => [{key: "styles/existing.md", label: "已有文风"}],
                            read: (_ctx, key) => ({key, contentType: "markdown", content: "正文"}),
                            create: (_ctx, mutation) => ({key: `styles/${mutation.slug}.md`, contentType: "markdown", content: mutation.content ?? ""}),
                            createKey: (_ctx, mutation) => `styles/${mutation.slug}.md`,
                        })
                        : profileHomeResource({directory: "styles", template: "模板"}),
                } : {
                    options: options.writingStyleOptions ?? [
                    {value: "default-style", label: "默认文风"},
                    {value: "cinematic", label: "电影感"},
                    {value: "cross-invalid", label: "交叉校验"},
                    {value: "forbidden", label: "禁用文风"},
                    ],
                }),
            },
            {
                path: "narrativePerson",
                component: "radio",
                label: "默认人称",
                options: [
                    {value: "third", label: "第三人称"},
                    {value: "first", label: "第一人称"},
                    {value: "second", label: "第二人称"},
                ],
            },
        ],
        validate(value) {
            const issues: Array<{path: string; severity: "error"; message: string}> = [];
            if (value.writingStylePreset === "forbidden") {
                issues.push({path: "writingStylePreset", severity: "error" as const, message: "禁用文风不可保存。"});
            }
            if (value.writingStylePreset === "cross-invalid" && value.narrativePerson === "second") {
                issues.push({path: "narrativePerson", severity: "error" as const, message: "交叉校验文风不能使用第二人称。"});
            }
            return issues;
        },
    });
    for (const profileKey of profileKeys) {
        const baseProfile = {
            manifest: {
                key: profileKey,
                name: profileKey,
            },
            initialSchema: Type.Object({}, {additionalProperties: false}),
            outputSchema: Type.Unknown(),
            tools: toolset(),
            prepare: () => ({}),
            ...(profileKey === "writer" && options.homeReset ? {
                home: defineProfileHome({
                    async reset(ctx) {
                        await ctx.home.clear();
                        await ctx.home.writeText("styles/reset.md", "reset");
                    },
                }),
            } : {}),
        } satisfies Parameters<typeof defineAgentProfile>[0];
        profileCatalog.register(profileKey === "writer"
            ? defineAgentProfile({
                ...baseProfile,
                settingsForm: writerSettingsForm,
            })
            : defineAgentProfile(baseProfile), true);
    }
    return profileCatalog;
}
