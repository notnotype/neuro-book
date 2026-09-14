import {describe, expect, it} from "vitest";
import {normalizeGlobalConfig, resolveEffectiveConfig} from "nbook/server/config/normalizer";
import type {StoredProjectConfig} from "nbook/server/config/types";

describe("config normalizer theme", () => {
    it("接受 nbook / macos 两套主题包与两种明暗", () => {
        const global = normalizeGlobalConfig({
            ui: {themeId: "macos", appearance: "dark"},
        });
        const effective = resolveEffectiveConfig(global, null);

        expect(effective.ui).toMatchObject({themeId: "macos", appearance: "dark"});
    });

    it("老体系 id 与未知取值一律忽略并重置默认，不做映射", () => {
        for (const legacy of ["sepia", "light", "dark", "catppuccin", "dracula", "monokai", "one-dark-pro", "tokyo-night", "custom-night", "missing-theme"]) {
            const effective = resolveEffectiveConfig(normalizeGlobalConfig({
                // 老字段名 + 老取值：schema 里已经没有这两个键，读到就当没有
                ui: {theme: legacy, customThemes: [{id: "custom-night"}]} as never,
            }), null);

            expect(effective.ui).toMatchObject({themeId: "nbook", appearance: "light"});
        }
    });

    it("明暗轴上的非法取值回落默认", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {themeId: "nbook", appearance: "sepia"} as never,
        }), null);

        expect(effective.ui).toMatchObject({themeId: "nbook", appearance: "light"});
    });

    it("用户配色：坏条目丢掉、同 id 首见优先、契约外的键保留（客户端才过滤）", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {
                colorwayId: "custom-night",
                userColorways: [
                    {id: "custom-night", label: "夜航", appearance: "dark", vars: {"--bg-main": "#010203", "--bg-unknown": "#ffffff"}},
                    {id: "custom-night", label: "重复", appearance: "light", vars: {"--bg-main": "#ffffff"}},
                    {id: "not-custom", label: "老体系 id", appearance: "dark", vars: {"--bg-main": "#010203"}},
                    {id: "custom-nolabel", label: "   ", appearance: "dark", vars: {"--bg-main": "#010203"}},
                    {id: "custom-badappearance", label: "坏明暗", appearance: "sepia", vars: {"--bg-main": "#010203"}},
                    {id: "custom-badvars", label: "坏变量", appearance: "dark", vars: {"--bg-main": "red;url(x)", "bg-main": "#010203"}},
                ],
            },
        } as never), null);

        expect(effective.ui.colorwayId).toBe("custom-night");
        expect(effective.ui.userColorways.map((colorway) => colorway.id)).toEqual(["custom-night", "custom-badvars"]);
        // 形状合法的键都留着：33 个变量的白名单要求浏览器，服务端只守住形状（见 shared/theme/user-colorway.ts）
        expect(effective.ui.userColorways[0]?.vars).toEqual({"--bg-main": "#010203", "--bg-unknown": "#ffffff"});
        // 取值不合结构底线的键被丢掉，条目本身留着
        expect(effective.ui.userColorways[1]?.vars).toEqual({});
    });

    it("配色 id 只认形状：写坏的值读作空串（回落主题默认），老体系 id 不做映射", () => {
        for (const colorwayId of ["有 空格", "custom-", ";", "x".repeat(80), 42]) {
            const effective = resolveEffectiveConfig(normalizeGlobalConfig({ui: {colorwayId}} as never), null);
            expect(effective.ui.colorwayId).toBe("");
        }

        // 主题自带配色的 id 是合法形状，存在性由客户端回答（服务端装不进主题包）
        expect(resolveEffectiveConfig(normalizeGlobalConfig({ui: {colorwayId: "macos-dark"}} as never), null).ui.colorwayId).toBe("macos-dark");
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
