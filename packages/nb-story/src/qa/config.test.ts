/**
 * 问答配置（docs/specs/story/qa.md 的“配置”与 F1）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {ABSENT_CONFIG, configProblems, currentConfigDigest, defaultConfigPath, defaultIngestFallback, ingestModel, loadQaConfig, parseQaConfig, qaLimits, readQaConfigFile, readQaConfigShape, saveQaConfig, upgradeQaConfig, validateQaConfig} from "./config";
import {applyInitAnswers, CONFIG_FIELDS, ConfigEditError, envNameProblem, setConfigField, unsetConfigField} from "./config-edit";
import {QaError} from "./errors";
import {configCatalog, FALLBACK_MAX_TOKENS, resolveQaModel} from "./harness-model";

let root = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "qa-config");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 第 1 版的模型（t16 之前的写法）。 */
const model = {baseUrl: "http://127.0.0.1:1/v1", id: "m", apiKeyEnv: "SOME_ENV"};
/** 与 `{model}` 等价的第 2 版。 */
const custom = {api: "openai-completions" as const, baseUrl: model.baseUrl, apiKeyEnv: model.apiKeyEnv, models: [{id: "m"}]};
const v2 = {providers: {custom}, models: ["custom/m"], model: {use: "custom/m"}};
const catalog = configCatalog();

function thrown(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    return null;
}

async function codeFor(content: string | null): Promise<string> {
    const path = join(root, `${Math.random()}.json`);
    if (content !== null) await writeFile(path, content);
    try {
        await loadQaConfig(path);
    } catch (error) {
        if (error instanceof QaError) return error.code;
        throw error;
    }
    return "ok";
}

describe("问答配置", () => {
    test("默认位置跟 XDG_CONFIG_HOME 走", () => {
        expect(defaultConfigPath({XDG_CONFIG_HOME: "/x"})).toBe("/x/nbstory/config.json");
    });

    test("写全必填字段即可用；上限有缺省值", async () => {
        const path = join(root, "ok.json");
        await writeFile(path, JSON.stringify({model}));
        expect(qaLimits(await loadQaConfig(path))).toEqual({maxChapters: 20, fullReadMaxChars: 300000});
    });

    test("文件不在、不是 JSON、缺字段、类型不对、maxChapters 越界：qa_unconfigured（F1）", async () => {
        expect(await codeFor(null)).toBe("qa_unconfigured");
        expect(await codeFor("{")).toBe("qa_unconfigured");
        expect(await codeFor(JSON.stringify({model: {baseUrl: "x", id: "m"}}))).toBe("qa_unconfigured");
        expect(await codeFor(JSON.stringify({model: {...model, maxTokens: "多"}}))).toBe("qa_unconfigured");
        for (const maxChapters of [0, 21, 2.5]) expect(await codeFor(JSON.stringify({model, qa: {maxChapters}}))).toBe("qa_unconfigured");
        expect(await codeFor(JSON.stringify({model, qa: {maxChapters: 20, fullReadMaxChars: 1}}))).toBe("ok");
    });

    test("第 1 版读出来是等价的第 2 版：自定义服务商 custom，接口、推理档、上下文、最大输出与单价跟过去", () => {
        const price = {input: 1, output: 4, currency: "USD"};
        expect(parseQaConfig({model: {...model, api: "responses", thinking: "xhigh", contextWindow: 200000, maxTokens: 32000, price}, qa: {maxChapters: 5}}, "")).toEqual({
            providers: {custom: {api: "openai-responses", baseUrl: model.baseUrl, apiKeyEnv: model.apiKeyEnv, models: [{id: "m", contextWindow: 200000, maxTokens: 32000, reasoning: true, price}]}},
            models: ["custom/m"],
            model: {use: "custom/m", thinking: "xhigh"},
            qa: {maxChapters: 5},
        });
        expect(parseQaConfig({model}, "")).toEqual(v2);
        // 第 2 版与认不出的形状原样交给 schema。
        expect(upgradeQaConfig(v2)).toBe(v2);
        expect(upgradeQaConfig({model: {id: "m"}})).toEqual({model: {id: "m"}});
    });

    test("字段之间的约束：候选非空不重复、默认在候选里、引用的服务商与模型存在、自定义服务商不与目录重名", () => {
        expect(configProblems(parseQaConfig(v2, ""), catalog)).toEqual([]);
        const withCatalog = {...v2, models: ["custom/m", "deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash", thinking: "high" as const}};
        expect(configProblems(parseQaConfig(withCatalog, ""), catalog)).toEqual([]);
        const cases: [unknown, string][] = [
            [{...v2, models: [], model: {use: "custom/m"}}, "至少要有一个"],
            [{...v2, models: ["custom/m", "custom/m"]}, "写了两次"],
            [{...v2, model: {use: "custom/other"}}, "不在候选模型里"],
            [{...v2, models: ["custom/m", "custom/other"]}, "自定义服务商 custom 里没有模型 other"],
            [{...v2, models: ["custom/m", "nowhere/x"]}, "没有服务商 nowhere"],
            [{...v2, models: ["custom/m", "deepseek/not-a-model"]}, "OMP 目录的 deepseek 里没有模型 not-a-model"],
            [{providers: {deepseek: custom}, models: ["deepseek/m"], model: {use: "deepseek/m"}}, "与 OMP 目录里的服务商重名"],
            [{providers: {custom: {...custom, models: [{id: "m"}, {id: "m"}]}}, models: ["custom/m"], model: {use: "custom/m"}}, "模型 m 写了两次"],
        ];
        for (const [value, problem] of cases) {
            expect(configProblems(parseQaConfig(value, ""), catalog).join("；")).toContain(problem);
            expect((thrown(() => validateQaConfig(value, " 测试 ", catalog)) as QaError).code).toBe("qa_unconfigured");
        }
        // 不给目录时只查自定义服务商这一侧。
        expect(configProblems(parseQaConfig({...v2, models: ["custom/m", "nowhere/x"]}, ""), null)).toEqual([]);
        // 服务商 id 的写法查在语义里，引用的写法由 schema 拦。
        expect(configProblems(parseQaConfig({providers: {"a.b": custom}, models: ["a.b/m"], model: {use: "a.b/m"}}, ""), null).join("")).toContain("只能有小写字母");
        expect(() => parseQaConfig({...v2, models: ["no-slash"]}, "")).toThrow(QaError);
    });

    test("目录模型：上下文与推理档来自目录；选的档往下夹，不支持推理的模型不发", () => {
        const config = parseQaConfig({...v2, models: ["custom/m", "deepseek/deepseek-flash", "openai/gpt-4"], model: {use: "deepseek/deepseek-flash", thinking: "medium"}}, "");
        const flash = resolveQaModel(config);
        expect([flash.ref, flash.contextWindow, flash.efforts, flash.thinking]).toEqual(["deepseek/deepseek-flash", 1_000_000, ["low", "high", "max"], "low"]);
        // 换了模型而没选档：不发；选了档照样夹。
        expect(resolveQaModel(config, {model: "custom/m"}).thinking).toBeUndefined();
        expect(resolveQaModel(config, {model: "openai/gpt-4", thinking: "high"}).thinking).toBeUndefined();
        expect((thrown(() => resolveQaModel(config, {model: "openai/gpt-5.6-sol"})) as QaError).code).toBe("qa_unconfigured");
    });

    test("自定义模型没写的参数按模型名从目录补，写了的照用；认不得的模型名不补", () => {
        const config = parseQaConfig({providers: {jiji: {...custom, api: "openai-responses", models: [{id: "gpt-5.6-sol"}, {id: "gpt-5.6-sol-short", contextWindow: 1000}, {id: "m"}]}}, models: ["jiji/gpt-5.6-sol", "jiji/m"], model: {use: "jiji/gpt-5.6-sol", thinking: "xhigh"}}, "");
        const known = resolveQaModel(config);
        expect([known.contextWindow, known.thinking, known.resolved.model.api, known.resolved.model.provider]).toEqual([1_050_000, "xhigh", "openai-responses", "jiji"]);
        expect(known.efforts).toContain("max");
        // 单价不补：未知就是未知。
        expect(known.resolved.priceKnown).toBe(false);
        const unknown = resolveQaModel(config, {model: "jiji/m", thinking: "high"});
        expect([unknown.contextWindow, unknown.efforts, unknown.thinking]).toEqual([null, [], undefined]);
        expect(unknown.resolved.model.maxTokens).toBe(FALLBACK_MAX_TOKENS);
    });

    test("抽取没写模型：问答默认模型是 OpenAI Chat 接口的自定义服务商时回落，否则报原因", () => {
        expect(ingestModel(parseQaConfig({model}, ""))).toMatchObject({baseUrl: model.baseUrl, id: "m", apiKeyEnv: "SOME_ENV", source: "model"});
        const responses = parseQaConfig({model: {...model, api: "responses"}}, "");
        expect(defaultIngestFallback(responses)).toContain("openai-responses");
        expect((thrown(() => ingestModel(responses)) as QaError).code).toBe("qa_unconfigured");
        const fromCatalog = parseQaConfig({...v2, models: ["custom/m", "deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash"}}, "");
        expect(defaultIngestFallback(fromCatalog)).toContain("OMP 目录");
        // 单独写了抽取模型就不看问答模型。
        expect(ingestModel({...fromCatalog, ingest: {model}})).toMatchObject({id: "m", source: "ingest.model"});
    });
});

describe("写配置（config 命令）", () => {
    const base = parseQaConfig(v2, "");

    test("写出的文件能原样读回；目录不存在时建出来，目录里不留临时文件", async () => {
        const dir = join(root, "nested", "dir");
        const path = join(dir, "config.json");
        await saveQaConfig(path, {model, qa: {maxChapters: 5}});
        // 第 1 版写进去，读回的是第 2 版；文件里写的也是第 2 版。
        expect(await loadQaConfig(path)).toEqual({...v2, qa: {maxChapters: 5}});
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({...v2, qa: {maxChapters: 5}});
        // 只剩配置本身与常驻的锁文件，没有临时文件。
        expect((await readdir(dir)).sort()).toEqual([".config.json.lock", "config.json"]);
    });

    test("校验不过：qa_unconfigured，已有的文件一个字不动，也不留临时文件", async () => {
        const dir = join(root, "keep");
        const path = join(dir, "config.json");
        await saveQaConfig(path, {model});
        const before = await readFile(path, "utf8");
        const failure = await saveQaConfig(path, {...v2, model: {use: "custom/other"}}).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(QaError);
        expect((failure as QaError).code).toBe("qa_unconfigured");
        expect(await readFile(path, "utf8")).toBe(before);
        // 只剩配置本身与常驻的锁文件，没有临时文件。
        expect((await readdir(dir)).sort()).toEqual([".config.json.lock", "config.json"]);
    });

    test("写不进去（父路径是个文件）：qa_config_write_failed", async () => {
        const file = join(root, "plain-file");
        await writeFile(file, "x");
        const failure = await saveQaConfig(join(file, "config.json"), {model}).catch((error: unknown) => error);
        expect((failure as QaError).code).toBe("qa_config_write_failed");
    });

    test("每个可改字段都能 set，改完整份仍过校验；原配置对象不变", () => {
        const values: Record<string, string> = {
            "model.thinking": "max",
            models: '["custom/m","deepseek/deepseek-flash"]',
            "model.use": "deepseek/deepseek-flash",
            "qa.answer": "structured",
            // 整组先写入，之后才能逐项改。
            "ingest.model": '{"baseUrl":"http://y/v1","id":"x","apiKeyEnv":"X_ENV"}',
            "ingest.model.baseUrl": "http://z/v1",
            "ingest.model.id": "ingest",
            "ingest.model.apiKeyEnv": "INGEST_ENV",
            "ingest.model.contextWindow": "64000",
            "ingest.model.maxTokens": "16000",
            "ingest.model.price": '{"input":2,"output":8,"currency":"CNY"}',
            // 挑相关说法的开关不用先整组写入；挑选的模型和抽取的一样要先整组写入。
            "ingest.recall.enabled": "true",
            "ingest.recall.model": '{"baseUrl":"http://r/v1","id":"r","apiKeyEnv":"R_ENV"}',
            "ingest.recall.model.baseUrl": "http://s/v1",
            "ingest.recall.model.id": "recall",
            "ingest.recall.model.apiKeyEnv": "RECALL_ENV",
            "ingest.recall.model.contextWindow": "32000",
            "ingest.recall.model.maxTokens": "4000",
            "ingest.recall.model.price": '{"input":0.5,"output":1,"currency":"USD"}',
            "qa.maxChapters": "10",
            "qa.fullReadMaxChars": "100000",
        };
        expect(Object.keys(values).sort()).toEqual(Object.keys(CONFIG_FIELDS).sort());
        let config = base;
        for (const [name, text] of Object.entries(values)) config = setConfigField(config, name, text, "", catalog);
        // 自定义服务商按 id 动态取：整组写入后逐项改。
        const provider: Record<string, string> = {
            "providers.jiji": '{"api":"openai-completions","baseUrl":"http://j/v1","apiKeyEnv":"J_ENV","models":[]}',
            "providers.jiji.name": "jiji",
            "providers.jiji.api": "openai-responses",
            "providers.jiji.baseUrl": "http://k/v1",
            "providers.jiji.apiKeyEnv": "K_ENV",
            "providers.jiji.models": '[{"id":"gpt-5.6-sol","contextWindow":200000}]',
        };
        for (const [name, text] of Object.entries(provider)) config = setConfigField(config, name, text, "", catalog);
        expect(config).toEqual({
            providers: {custom, jiji: {name: "jiji", api: "openai-responses", baseUrl: "http://k/v1", apiKeyEnv: "K_ENV", models: [{id: "gpt-5.6-sol", contextWindow: 200000}]}},
            models: ["custom/m", "deepseek/deepseek-flash"],
            model: {use: "deepseek/deepseek-flash", thinking: "max"},
            ingest: {
                model: {baseUrl: "http://z/v1", id: "ingest", apiKeyEnv: "INGEST_ENV", contextWindow: 64000, maxTokens: 16000, price: {input: 2, output: 8, currency: "CNY"}},
                recall: {enabled: true, model: {baseUrl: "http://s/v1", id: "recall", apiKeyEnv: "RECALL_ENV", contextWindow: 32000, maxTokens: 4000, price: {input: 0.5, output: 1, currency: "USD"}}},
            },
            qa: {maxChapters: 10, fullReadMaxChars: 100000, answer: "structured"},
        });
        expect(base).toEqual(v2);
    });

    test("字段不认识、值写不对、字段之间的约束不成立：ConfigEditError；值合法但越界：qa_unconfigured", () => {
        for (const [name, text] of [
            ["model.nope", "1"],
            ["qa.maxChapters", "多"],
            ["model.thinking", "ultra"],
            ["models", "{"],
            ["providers.A_B.baseUrl", "x"],
            ["providers.jiji.nope", "x"],
            // 默认模型不在候选里、候选指向没有的模型、服务商 id 与目录重名。
            ["model.use", "custom/other"],
            ["models", '["custom/m","deepseek/not-a-model"]'],
            ["providers.deepseek", '{"api":"openai-completions","baseUrl":"http://j/v1","apiKeyEnv":"J_ENV","models":[]}'],
            // 还没整组写入的服务商不能逐项改。
            ["providers.jiji.baseUrl", "http://j/v1"],
        ] as const) {
            expect(thrown(() => setConfigField(base, name, text, "", catalog))).toBeInstanceOf(ConfigEditError);
        }
        for (const [name, text] of [["qa.maxChapters", "21"], ["models", "[1]"]] as const) {
            expect((thrown(() => setConfigField(base, name, text, "", catalog)) as QaError).code).toBe("qa_unconfigured");
        }
    });

    test("第 1 版的字段路径：用法错误，指向第 2 版里对应的路径", () => {
        const failure = thrown(() => setConfigField(base, "model.baseUrl", "http://x/v1", "", catalog)) as ConfigEditError;
        expect(failure).toBeInstanceOf(ConfigEditError);
        expect(failure.message).toContain("providers.custom.baseUrl");
        for (const name of ["model.id", "model.apiKeyEnv", "model.api", "model.contextWindow", "model.maxTokens", "model.price"]) {
            expect((thrown(() => unsetConfigField(base, name, "", catalog)) as Error).message).toContain("第 1 版");
        }
    });

    test("unset 去掉可选字段，qa 里没有字段了整段去掉；必填字段不能去掉", () => {
        const full = setConfigField(setConfigField(base, "model.thinking", "high", "", catalog), "qa.maxChapters", "5", "", catalog);
        expect(unsetConfigField(full, "model.thinking", "", catalog)).toEqual({...v2, qa: {maxChapters: 5}});
        expect(unsetConfigField(full, "qa.maxChapters", "", catalog)).toEqual({...v2, model: {use: "custom/m", thinking: "high"}});
        expect(unsetConfigField(base, "qa.maxChapters", "", catalog)).toEqual(v2);
        for (const name of ["model.use", "models", "providers.custom.baseUrl"]) expect(() => unsetConfigField(base, name, "", catalog)).toThrow(ConfigEditError);
        // 去掉仍被候选引用的服务商：约束不成立。
        expect(() => unsetConfigField(base, "providers.custom", "", catalog)).toThrow(ConfigEditError);
    });

    test("init 的回答：选的模型加进候选并设为默认，没问到的保留；空配置从头建", () => {
        const fromScratch = applyInitAnswers(null, {kind: "catalog", ref: "deepseek/deepseek-flash"}, "high", "", catalog);
        expect(fromScratch).toEqual({models: ["deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash", thinking: "high"}});
        const added = applyInitAnswers({...base, qa: {maxChapters: 3}}, {kind: "custom", baseUrl: "http://n/v1", id: "n", apiKeyEnv: "N_ENV"}, null, "", catalog);
        expect(added).toEqual({providers: {custom: {...custom, baseUrl: "http://n/v1", apiKeyEnv: "N_ENV", models: [{id: "m"}, {id: "n"}]}}, models: ["custom/m", "custom/n"], model: {use: "custom/n"}, qa: {maxChapters: 3}});
        // 新的自定义模型写了推理档：按推理模型发。
        expect(applyInitAnswers(null, {kind: "custom", baseUrl: "http://n/v1", id: "n", apiKeyEnv: "N_ENV"}, "high", "", catalog).providers?.custom?.models).toEqual([{id: "n", reasoning: true}]);
        expect(thrown(() => applyInitAnswers(null, {kind: "catalog", ref: "deepseek/not-a-model"}, undefined, "", catalog))).toBeInstanceOf(ConfigEditError);
    });

    test("只校验形状地读：字段之间的约束不成立的配置也读得出来，供 set 修好它", async () => {
        const path = join(root, `broken-${Math.random()}.json`);
        await writeFile(path, JSON.stringify({...v2, model: {use: "custom/other"}}));
        expect(await codeFor(await readFile(path, "utf8"))).toBe("qa_unconfigured");
        const {config} = await readQaConfigShape(path);
        expect(setConfigField(config, "model.use", "custom/m", "", catalog)).toEqual(v2);
    });
});

describe("整份写入（网页设置页与命令行共用，t13）", () => {
    const pasted = "sk-review-fake-pasted-value-0042";

    test("摘要按原字节：两份不同的坏 UTF-8 摘要不同；读不出来的路径（是目录）不当作没有文件，写入报写不了", async () => {
        const dir = join(root, `bytes-${Math.random()}`);
        await mkdir(dir, {recursive: true});
        const a = join(dir, "a.json");
        const b = join(dir, "b.json");
        await writeFile(a, Buffer.from([0x7b, 0xff, 0x7d]));
        await writeFile(b, Buffer.from([0x7b, 0xfe, 0x7d]));
        expect(await currentConfigDigest(a)).not.toBe(await currentConfigDigest(b));

        const folder = join(dir, "folder.json");
        await mkdir(folder);
        const unreadable = await currentConfigDigest(folder).then(() => "read", (error: unknown) => (error as QaError).code);
        expect(unreadable).toBe("qa_unconfigured");
        const written = await saveQaConfig(folder, {model}, {expect: ABSENT_CONFIG}).then(() => "saved", (error: unknown) => (error as QaError).code);
        expect(written).toBe("qa_config_write_failed");
    });

    test("像密钥的变量名也拒绝：常见前缀、没有下划线的长串；正常的变量名照收", () => {
        for (const value of ["sk_abcdefghijklmnopqrstuvwxyz123456", "GSK_abc123", "ghp_abc", "AbCdEfGhIjKlMnOpQrStUvWxYz012345"]) {
            expect(() => parseQaConfig({...v2, providers: {custom: {...custom, apiKeyEnv: value}}}, " 测试 ")).toThrow(QaError);
            expect(envNameProblem(value)).toBeString();
        }
        for (const value of ["OPENAI_API_KEY", "deepseekKey", "SKY_KEY", "_PRIVATE_KEY_FOR_THE_STORY_ENGINE_2026"]) {
            expect(parseQaConfig({...v2, providers: {custom: {...custom, apiKeyEnv: value}}}, " 测试 ").providers?.custom?.apiKeyEnv).toBe(value);
            expect(envNameProblem(value)).toBeUndefined();
        }
    });

    test("各处密钥环境变量名都只收变量名，误贴密钥被拒且报错里没有原文；不认识的字段不收", () => {
        const configs = [
            {model: {...model, apiKeyEnv: pasted}},
            {...v2, providers: {custom: {...custom, apiKeyEnv: pasted}}},
            {model, ingest: {model: {...model, apiKeyEnv: pasted}}},
            {model, ingest: {recall: {enabled: true, model: {...model, apiKeyEnv: pasted}}}},
        ];
        for (const config of configs) {
            const error = (() => {
                try {
                    parseQaConfig(config, " 测试 ");
                } catch (thrown) {
                    return thrown as QaError;
                }
                return null;
            })();
            expect(error?.code).toBe("qa_unconfigured");
            expect(error?.message).not.toContain(pasted);
        }
        expect(() => parseQaConfig({model: {...model, apiKey: pasted}}, " 测试 ")).toThrow(QaError);
        expect(() => parseQaConfig({...v2, providers: {custom: {...custom, apiKey: pasted}}}, " 测试 ")).toThrow(QaError);
        expect(() => parseQaConfig({model, extra: 1}, " 测试 ")).toThrow(QaError);
    });

    test("带 expect 的写入：同时两个只有一个成功，另一个 config_conflict；成功返回的摘要就是磁盘上的", async () => {
        const path = join(root, `cas-${Math.random()}`, "config.json");
        const first = await saveQaConfig(path, {model});
        for (let round = 0; round < 5; round += 1) {
            const current = (await saveQaConfig(path, {model, qa: {maxChapters: 1 + round}})).digest;
            const results = await Promise.allSettled([saveQaConfig(path, {model, qa: {maxChapters: 10}}, {expect: current}), saveQaConfig(path, {model, qa: {maxChapters: 11}}, {expect: current})]);
            const done = results.filter(result => result.status === "fulfilled");
            const conflicts = results.filter(result => result.status === "rejected" && (result.reason as QaError).code === "config_conflict");
            expect([done.length, conflicts.length]).toEqual([1, 1]);
            const written = (done[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof saveQaConfig>>>).value;
            expect(await loadQaConfig(path)).toEqual(written.config);
            expect((await readQaConfigFile(path)).digest).toBe(written.digest);
        }
        expect(first.digest).not.toBe(ABSENT_CONFIG);
    });

    test("不带 expect 的并发写入互不踩：每个都成功，磁盘上是其中一份，摘要对得上；不留临时文件", async () => {
        const dir = join(root, `parallel-${Math.random()}`);
        const path = join(dir, "config.json");
        const results = await Promise.all(Array.from({length: 10}, (_, index) => saveQaConfig(path, {model, qa: {maxChapters: index + 1}})));
        const {config, digest} = await readQaConfigFile(path);
        expect(results.some(result => result.digest === digest && JSON.stringify(result.config) === JSON.stringify(config))).toBe(true);
        expect((await readdir(dir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });

    test("读取之后被别处改过（命令行先写了）：再按读到的摘要写报 config_conflict，文件不动", async () => {
        const path = join(root, `stale-${Math.random()}`, "config.json");
        await saveQaConfig(path, {model});
        const seen = await readQaConfigFile(path);
        await saveQaConfig(path, {...v2, qa: {maxChapters: 3}}, {expect: seen.digest});
        const before = await readFile(path, "utf8");
        const stale = await saveQaConfig(path, {...v2, qa: {maxChapters: 4}}, {expect: seen.digest}).catch((error: unknown) => error as QaError);
        expect((stale as QaError).code).toBe("config_conflict");
        expect(await readFile(path, "utf8")).toBe(before);
        // 文件还不存在时，按“不存在”的摘要写成功；之后别人建了文件，同样的期望就冲突。
        const fresh = join(root, `fresh-${Math.random()}`, "config.json");
        expect((await currentConfigDigest(fresh))).toBe(ABSENT_CONFIG);
        await saveQaConfig(fresh, {model}, {expect: ABSENT_CONFIG});
        expect(((await saveQaConfig(fresh, {model}, {expect: ABSENT_CONFIG}).catch((error: unknown) => error)) as QaError).code).toBe("config_conflict");
    });
});
