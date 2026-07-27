import {describe, expect, it} from "vitest";
import {normalizeGlobalConfig, resolveEffectiveConfig} from "nbook/server/config/normalizer";
import type {StoredProjectConfig} from "nbook/server/config/types";

describe("config normalizer theme", () => {
    it("允许内置 8 主题并保留自定义主题选择", () => {
        const global = normalizeGlobalConfig({
            ui: {
                theme: "custom-night",
                customThemes: [{
                    id: "custom-night",
                    name: "Night",
                    appearance: "dark",
                    vars: {
                        "bg-main": "#111111",
                        "accent-main": "#88ccff",
                        unknown: "#ffffff",
                    },
                } as never, {
                    id: "custom-night",
                    name: "Duplicate",
                    appearance: "light",
                    vars: {"bg-main": "#ffffff"},
                }],
            },
        });
        const effective = resolveEffectiveConfig(global, null);

        expect(effective.ui.theme).toBe("custom-night");
        expect(effective.ui.customThemes).toEqual([{
            id: "custom-night",
            name: "Night",
            appearance: "dark",
            vars: {
                "bg-main": "#111111",
                "accent-main": "#88ccff",
            },
        }]);
    });

    it("未知主题回退 sepia，但 tokyo-night 等内置主题保持有效", () => {
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "tokyo-night"},
        }), null).ui.theme).toBe("tokyo-night");

        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "missing-theme"},
        }), null).ui.theme).toBe("sepia");
    });
});

describe("config normalizer profile runtime", () => {
    const globalWithDisabled = normalizeGlobalConfig({
        agent: {
            profiles: {
                "leader.default": {
                    model: {},
                    runtime: {summarizer: {enabled: false}},
                },
            },
        },
    });

    it("仅 global 配置时 effective 保留 summarizer 开关", () => {
        const effective = resolveEffectiveConfig(globalWithDisabled, null);
        expect(effective.agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});
    });

    it("project 空/非法 summarizer 不遮蔽 global 的禁用（enabled 字段级合并）", () => {
        const emptyProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {}},
                    },
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, emptyProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});

        const invalidProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {enabled: "yes"}},
                    },
                },
            },
        } as never as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, invalidProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});
    });

    it("project 合法 summarizer 覆盖 global；双方未配置时不携带 key", () => {
        const enabledProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {enabled: true}},
                    },
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, enabledProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: true});

        const plainGlobal = normalizeGlobalConfig({
            agent: {
                profiles: {
                    "leader.default": {model: {}},
                },
            },
        });
        const plainProject = {
            agent: {
                profiles: {
                    "leader.default": {model: {}},
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(plainGlobal, plainProject).agent.profiles["leader.default"]?.runtime).toEqual({});
    });

    it("默认使用 512，Project 可继承或覆盖 Global", () => {
        const global = normalizeGlobalConfig({
            agent: {profileRuntimeDefaults: {fileChangeNotice: {diffMaxChars: 1024}}},
        });
        expect(resolveEffectiveConfig(global, null).agent.profileRuntimeDefaults?.fileChangeNotice?.diffMaxChars).toBe(1024);

        const inherited = resolveEffectiveConfig(global, {agent: {profiles: {writer: {model: {}}}}} as StoredProjectConfig);
        expect(inherited.agent.profiles.writer?.runtime?.fileChangeNotice?.diffMaxChars).toBe(1024);

        const overridden = resolveEffectiveConfig(global, {agent: {profiles: {writer: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 0}}}}}} as StoredProjectConfig);
        expect(overridden.agent.profiles.writer?.runtime?.fileChangeNotice?.diffMaxChars).toBe(0);

        const defaults = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(defaults.agent.profileRuntimeDefaults).toEqual({});
    });

    it("接受 0 与 8192，非法或越界值不参与遮蔽", () => {
        const global = normalizeGlobalConfig({
            agent: {profiles: {
                min: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 0}}},
                max: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 8192}}},
                invalid: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 9000}}},
            }},
        });
        const effective = resolveEffectiveConfig(global, {
            agent: {profiles: {max: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: -1}}}}},
        } as StoredProjectConfig);

        expect(effective.agent.profiles.min?.runtime?.fileChangeNotice?.diffMaxChars).toBe(0);
        expect(effective.agent.profiles.max?.runtime?.fileChangeNotice?.diffMaxChars).toBe(8192);
        expect(effective.agent.profiles.invalid?.runtime?.fileChangeNotice).toBeUndefined();
    });
});

describe("config normalizer workspace history", () => {
    it("默认值：enabled 开、90 天窗口、auto-accept 14 天", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(effective.history).toEqual({
            enabled: true,
            retentionFullDays: 90,
            keepDailyLastAfterWindow: true,
            autoAcceptEnabled: true,
            autoAcceptDays: 14,
        });
    });

    it("非法值回退默认：负数/小数天数与非布尔开关不参与遮蔽", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            history: {
                enabled: "yes" as unknown as boolean,
                retentionFullDays: -3,
                autoAcceptDays: 2.5,
                keepDailyLastAfterWindow: "no" as unknown as boolean,
            },
        }), null);
        expect(effective.history).toEqual({
            enabled: true,
            retentionFullDays: 90,
            keepDailyLastAfterWindow: true,
            autoAcceptEnabled: true,
            autoAcceptDays: 14,
        });
    });

    it("project 覆盖 retention/auto-accept 子集；enabled 被结构性剥离不可遮蔽", () => {
        const global = normalizeGlobalConfig({
            history: {enabled: false, retentionFullDays: 30},
        });
        const project = {
            history: {
                retentionFullDays: 7,
                autoAcceptEnabled: false,
                // project 文件手写 enabled 也不会生效（patch 归一化不输出该字段）
                enabled: true,
            },
        } as StoredProjectConfig;
        const effective = resolveEffectiveConfig(global, project);
        expect(effective.history.enabled).toBe(false);
        expect(effective.history.retentionFullDays).toBe(7);
        expect(effective.history.autoAcceptEnabled).toBe(false);
        expect(effective.history.autoAcceptDays).toBe(14);
    });
});

describe("config normalizer Provider Config identity", () => {
    it("runtime Record 化会跳过重复 Provider 组而不是以后项覆盖前项", () => {
        const provider = {
            id: "duplicate",
            name: "First",
            enabled: true,
            modelApi: "openai-completions",
            options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
            models: [{id: "model", name: "Model", enabled: true}],
        };
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            models: {default: "duplicate/model", providers: [provider, {...provider, name: "Second"}]},
        }), null);

        expect(effective.models.providers).toEqual({});
    });

    it("runtime Record 化会跳过 Provider 内重复模型组并保留其他唯一模型", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            models: {
                default: "provider/unique",
                providers: [{
                    id: "provider",
                    name: "Provider",
                    enabled: true,
                    modelApi: "openai-completions",
                    options: {apiKey: "", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "duplicate", name: "First", enabled: true},
                        {id: "duplicate", name: "Second", enabled: false},
                        {id: "unique", name: "Unique", enabled: false},
                    ],
                }],
            },
        }), null);

        expect(Object.keys(effective.models.providers.provider?.models ?? {})).toEqual(["unique"]);
    });
});

describe("config normalizer comfyui", () => {
    it("缺省时给出完整默认值（默认关闭、本机 8188）", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(effective.comfyui.enabled).toBe(false);
        expect(effective.comfyui.baseURL).toBe("http://127.0.0.1:8188");
        expect(effective.comfyui.timeoutMs).toBe(30000);
        expect(effective.comfyui.promptModelKey).toBeNull();
        expect(effective.comfyui.positivePrefix.length).toBeGreaterThan(0);
        expect(effective.comfyui.defaults).toEqual({checkpoint: "", width: 832, height: 1216, steps: 32, cfg: 4.5});
        expect(effective.comfyui.activeWorkflowId).toBeNull();
    });

    it("partial 覆盖生效，非法值回落默认", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            comfyui: {
                enabled: true,
                baseURL: "http://192.168.1.5:8188/",
                timeoutMs: -1 as never,
                defaults: {width: 1024, cfg: -5 as never},
            },
        }), null);
        expect(effective.comfyui.enabled).toBe(true);
        expect(effective.comfyui.baseURL).toBe("http://192.168.1.5:8188/");
        expect(effective.comfyui.timeoutMs).toBe(30000);
        expect(effective.comfyui.defaults.width).toBe(1024);
        expect(effective.comfyui.defaults.height).toBe(1216);
        expect(effective.comfyui.defaults.cfg).toBe(4.5);
    });

    it("comfyui 是 Global-only：Project Config 不参与合并", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({comfyui: {enabled: true}}), {
            comfyui: {enabled: false},
        } as never);
        expect(effective.comfyui.enabled).toBe(true);
    });
});
