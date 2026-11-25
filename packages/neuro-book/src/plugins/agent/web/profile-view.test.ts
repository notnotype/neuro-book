/** Profile 设置页的视图（docs/specs/agent/profile-settings.md 输出 4–9）。 */

import {describe, expect, test} from "bun:test";

import type {ModelRow, ModelsSnapshot} from "nbook/plugins/models/shared/contracts";
import {modelsCatalogs} from "nbook/plugins/models/web/text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {ProfileEntry, ToolCatalogEntry} from "../shared/contracts";
import type {ToolBinding} from "../shared/profile-tools";
import type {SkillEntry} from "../shared/skills";
import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {FOLLOW_APPROVAL, FOLLOW_MODEL, modelChoiceOf, withApprovalChoice, withModelChoice} from "./profile-edits";
import {profileViews} from "./profile-view";
import type {ProfileModels} from "./profile-view";

const engine = createHostTextEngine({locale: "zh-CN", strict: true});
engine.register("nbook.agent", {"zh-CN": zhCN, "en-US": enUS}, "zh-CN");
engine.register("nbook.models", modelsCatalogs.catalogs, modelsCatalogs.source);
const text = engine.port;

const entry = (over: Partial<ProfileEntry> = {}): ProfileEntry => ({key: "x", name: "X", description: "", source: "nbook.agent", status: "ok", tools: {required: [], optional: []}, ...over});
const model = (id: string, over: Record<string, unknown> = {}) => ({id, name: id.toUpperCase(), group: "g", enabled: true, contextWindow: 100_000, maxOutput: null, vision: false, reasoning: false, efforts: [], compaction: null, price: null, headers: {}, status: "ok", origin: "source", overridden: [], source: null, ...over});
/** 每份快照配套的选用数据：快照本身不带模型行，行与按引用取到的结果另给。 */
const SELECTION = new WeakMap<object, ProfileModels>();
const snapshot = (over: {roles?: unknown[]; models?: unknown[]; key?: unknown} = {}): ModelsSnapshot => {
    const key = over.key ?? {kind: "stored"};
    const models = (over.models ?? [model("a")]) as Array<ReturnType<typeof model>>;
    const shot = {
        providers: [{id: "p", template: "deepseek", region: null, name: "P", icon: null, baseUrl: null, templateBaseUrl: null, api: null, templateApi: null, key, modelCount: models.length, enabledCount: models.length, excludedCount: 0, modelsRevision: "r", followSource: true, source: {kind: "packaged"}}],
        roles: over.roles ?? [{id: "main", axis: "gradient", builtin: false, name: "主力", description: "", model: "p/a", status: "ok"}],
    } as unknown as ModelsSnapshot;
    const ready = (key as {kind: string}).kind !== "none";
    const rows = models.map((item) => ({...item, provider: "p", usable: item.enabled && item.status === "ok" && ready}));
    SELECTION.set(shot, {rows: rows.filter((row) => row.usable) as unknown as ProfileModels["rows"], lookup: new Map(rows.map((row) => [`p/${row.id}`, row as unknown as ModelRow]))});
    return shot;
};
const selectionOf = (shot: ModelsSnapshot | null): ProfileModels => (shot === null ? {rows: [], lookup: new Map()} : SELECTION.get(shot) ?? {rows: [], lookup: new Map()});
const view = (input: {entry?: ProfileEntry; setting?: object; snapshot?: ModelsSnapshot | null; failed?: boolean; catalog?: readonly ToolCatalogEntry[]; binding?: ToolBinding}) => {
    const shot = input.snapshot === undefined ? snapshot() : input.snapshot;
    return profileViews({
        profiles: [input.entry ?? entry()],
        catalog: input.catalog ?? [],
        bindings: input.binding === undefined ? {} : {x: input.binding},
        settings: input.setting === undefined ? {} : {x: input.setting},
        snapshot: shot,
        models: selectionOf(shot),
        modelsFailed: input.failed ?? false,
        pluginName: (plugin) => `插件 ${plugin}`,
        text,
    })[0]!;
};

describe("模型一行的取值与写回", () => {
    test("读：文件里两个都有时按 model", () => {
        expect(modelChoiceOf(undefined)).toBe(FOLLOW_MODEL);
        expect(modelChoiceOf({role: "fast"})).toBe("role:fast");
        expect(modelChoiceOf({model: "p/a", role: "fast"})).toBe("p/a");
    });

    test("写：选模型清掉角色，选角色清掉模型，跟随默认两个都删；别的字段与别的 Profile 不动", () => {
        const other = {model: "p/b"};
        const current = {x: {role: "fast", approvalMode: "auto" as const}, y: other};
        expect(withModelChoice(current, "x", "p/a")).toEqual({x: {model: "p/a", approvalMode: "auto"}, y: other});
        expect(withModelChoice({x: {model: "p/a"}, y: other}, "x", "role:fast")).toEqual({x: {role: "fast"}, y: other});
        expect(withModelChoice(current, "x", FOLLOW_MODEL)).toEqual({x: {approvalMode: "auto"}, y: other});
    });

    test("写：都空了不留这个 key", () => {
        expect(withModelChoice({x: {model: "p/a"}}, "x", FOLLOW_MODEL)).toEqual({});
        expect(withApprovalChoice({x: {approvalMode: "yolo"}}, "x", FOLLOW_APPROVAL)).toEqual({});
    });

    test("审批模式：跟随默认不写哨兵", () => {
        expect(withApprovalChoice({}, "x", "auto")).toEqual({x: {approvalMode: "auto"}});
        expect(JSON.stringify(withApprovalChoice({x: {model: "p/a", approvalMode: "auto"}}, "x", FOLLOW_APPROVAL))).toBe(JSON.stringify({x: {model: "p/a"}}));
    });
});

describe("模型一行的显示", () => {
    test("选项按跟随默认、角色、可用的模型排；说明写跟随默认时用哪个角色", () => {
        const field = view({entry: entry({role: "main"})}).model;
        expect(field.options.map((option) => option.value)).toEqual(["", "role:main", "p/a"]);
        expect(field.options[1]?.iconClass).toBeDefined();
        expect(field.hint).toContain("主力");
        expect(field.warning).toBe(false);
    });

    test("停用、没凭据、目录漂移的模型不进选项", () => {
        const models = [model("a"), model("off", {enabled: false}), model("gone", {status: "missing"})];
        expect(view({snapshot: snapshot({models})}).model.options.map((option) => option.value)).toEqual(["", "role:main", "p/a"]);
        expect(view({snapshot: snapshot({key: {kind: "none"}})}).model.options.map((option) => option.value)).toEqual(["", "role:main"]);
    });

    test("绑的模型用不了：补一个停用的项，说明换成问题", () => {
        const field = view({setting: {model: "p/off"}, snapshot: snapshot({models: [model("a"), model("off", {enabled: false})]})}).model;
        expect(field.value).toBe("p/off");
        expect(field.options.at(-1)).toMatchObject({value: "p/off", disabled: true});
        expect(field.warning).toBe(true);
    });

    test("绑的角色没了、未绑定、绑的模型坏了都提示", () => {
        expect(view({setting: {role: "ghost"}}).model).toMatchObject({value: "role:ghost", warning: true});
        expect(view({setting: {role: "ghost"}}).model.options.at(-1)).toMatchObject({value: "role:ghost", disabled: true});
        expect(view({snapshot: snapshot({roles: [{id: "main", axis: "gradient", builtin: false, name: "主力", description: "", model: null, status: "unbound"}]})}).model).toMatchObject({warning: true, hint: expect.stringContaining("主力")});
        expect(view({snapshot: snapshot({roles: [{id: "main", axis: "gradient", builtin: false, name: "主力", description: "", model: "p/x", status: "no-credentials"}]})}).model.warning).toBe(true);
    });

    test("模型服务不在：停用并写明；还在取时只停用", () => {
        expect(view({snapshot: null, failed: true}).model).toMatchObject({disabled: true, warning: true, hint: expect.stringContaining("模型服务")});
        expect(view({snapshot: null}).model).toMatchObject({disabled: true, warning: false, hint: ""});
    });
});

describe("模型能力提示", () => {
    const seeing = entry({modelNeeds: {vision: true}, role: "main"});

    test("跟随默认、角色、模型三条路径都解析到模型再比", () => {
        const models = [model("a"), model("v", {vision: true})];
        const roles = [
            {id: "main", axis: "gradient", builtin: false, name: "主力", description: "", model: "p/a", status: "ok"},
            {id: "see", axis: "gradient", builtin: false, name: "看图", description: "", model: "p/v", status: "ok"},
        ];
        const shot = snapshot({models, roles});
        expect(view({entry: seeing, snapshot: shot}).model).toMatchObject({warning: true, hint: expect.stringContaining("看图")});
        expect(view({entry: seeing, snapshot: shot, setting: {role: "see"}}).model.warning).toBe(false);
        expect(view({entry: seeing, snapshot: shot, setting: {model: "p/a"}}).model.warning).toBe(true);
        expect(view({entry: seeing, snapshot: shot, setting: {model: "p/v"}}).model.warning).toBe(false);
    });

    test("模型用不了时只说用不了，不说缺什么", () => {
        const shot = snapshot({models: [model("off", {enabled: false})]});
        const hint = view({entry: seeing, snapshot: shot, setting: {model: "p/off"}}).model.hint;
        expect(hint).not.toContain("看图");
    });

    test("窗口未知不算小于", () => {
        const needs = entry({modelNeeds: {minContext: 2000}});
        expect(view({entry: needs, snapshot: snapshot({models: [model("a", {contextWindow: null})]})}).model.warning).toBe(false);
        expect(view({entry: needs, snapshot: snapshot({models: [model("a", {contextWindow: 1000})]})}).model).toMatchObject({warning: true, hint: expect.stringContaining("2000")});
    });
});

describe("问题与状态", () => {
    test("缺必需工具是警告，写明缺哪些", () => {
        const profile = view({entry: entry({status: "unavailable", problem: {code: "tools-missing", tools: ["a", "b"]}})});
        expect(profile.notice).toMatchObject({tone: "warning", text: expect.stringContaining("a、b")});
        expect(profile.statusText).toMatchObject({tone: "warning"});
    });

    test("缺引用的扩展是警告，写明缺哪些", () => {
        const profile = view({entry: entry({status: "unavailable", problem: {code: "extensions-missing", extensions: ["acme.notes", "acme.tags"]}})});
        expect(profile.notice).toMatchObject({tone: "warning", text: expect.stringContaining("acme.notes、acme.tags")});
        expect(profile.statusText).toMatchObject({tone: "warning"});
    });

    test("打包失败是错误，有行号时写行号；有错误的说明还在用上一版，没成功过的说明用不了", () => {
        const stale = view({entry: entry({status: "error", problem: {code: "build-failed", file: "x.profile.tsx", line: 12, message: "坏了"}})});
        expect(stale.notice).toMatchObject({tone: "danger", text: expect.stringContaining("12")});
        expect(stale.notice?.lines.join("\n")).toContain("x.profile.tsx");
        expect(stale.notice?.lines.join("\n")).toContain("上一次成功");
        expect(view({entry: entry({status: "unavailable", problem: {code: "load-failed", file: "x.profile.tsx", message: "坏了"}})}).notice?.lines.join("\n")).toContain("还没成功过");
    });

    test("每种原因都有文字（中英文目录都有键，strict 引擎缺键会抛）", () => {
        for (const problem of [
            {code: "key-taken"},
            {code: "extensions-missing", extensions: ["acme.notes"]},
            {code: "module-not-shared", module: "m"},
            {code: "module-not-shared"},
            {code: "invalid-export"},
            {code: "invalid-export", expectedId: "user.x"},
            {code: "build-failed", file: "f", message: "m"},
        ] as const) {
            expect(view({entry: entry({status: "unavailable", problem})}).notice?.text).not.toBe("");
        }
    });

    test("来源：内置、我写的、插件名；后台的没有审批一行", () => {
        expect(view({}).source).toBe("内置");
        expect(view({entry: entry({source: "user"})})).toMatchObject({source: "我写的", user: true});
        expect(view({entry: entry({source: "plot"})}).source).toBe("插件 plot");
        expect(view({entry: entry({hidden: true})}).approval).toBeNull();
    });

    test("审批模式的说明：选 auto、yolo 时换成后果", () => {
        expect(view({}).approval?.value).toBe(FOLLOW_APPROVAL);
        expect(view({setting: {approvalMode: "auto"}}).approval?.hint).toContain("漏判");
        expect(view({setting: {approvalMode: "yolo"}}).approval?.hint).toContain("拒绝规则");
    });
});

describe("工具一节", () => {
    const tool = (id: string, providerName: string, plugin = "nbook.agent", over: Partial<ToolCatalogEntry> = {}): ToolCatalogEntry => ({id, description: `${id} 的说明\n第二行`, providerName, effect: "read", plugin, ...over});
    const CATALOG = [
        tool("nbook.agent.read", "read"),
        tool("nbook.agent.edit", "edit", "nbook.agent", {effect: "write"}),
        tool("nbook.agent.edit-replace", "edit", "nbook.agent", {effect: "write"}),
        tool("nbook.agent.ask", "ask", "nbook.agent", {defaultForAll: true}),
        tool("nbook.agent.shell", "shell", "nbook.agent", {effect: "exec"}),
        tool("zeta.tool", "zeta_tool", "zeta"),
        tool("alpha.tool", "alpha_tool", "alpha"),
    ];
    const tools = (over: {required?: string[]; optional?: string[]; binding?: ToolBinding; defaultTools?: false; hidden?: true} = {}) => view({
        catalog: CATALOG,
        entry: entry({tools: {required: over.required ?? [], optional: over.optional ?? []}, ...(over.defaultTools === false ? {defaultTools: false as const} : {}), ...(over.hidden === true ? {hidden: true as const} : {})}),
        ...(over.binding === undefined ? {} : {binding: over.binding}),
    }).tools;
    const ids = (field: ReturnType<typeof tools>) => field?.groups.flatMap((group) => group.tools.map((row) => row.id));

    test("只列开着的，按提供者分组，内置在前、别的按名字排", () => {
        const field = tools({required: ["nbook.agent.read"], binding: {added: ["zeta.tool", "alpha.tool"], removed: []}});
        expect(field?.groups.map((group) => group.provider)).toEqual(["内置", "插件 alpha", "插件 zeta"]);
        expect(ids(field)).toEqual(["nbook.agent.read", "nbook.agent.ask", "alpha.tool", "zeta.tool"]);
        expect(field?.count).toBe(4);
        expect(field?.groups[0]?.tools[0]).toMatchObject({required: true, effect: "读"});
    });

    test("装到所有的算开着；defaultTools: false 的没有它", () => {
        expect(ids(tools())).toEqual(["nbook.agent.ask"]);
        expect(ids(tools({defaultTools: false}))).toEqual([]);
    });

    test("同名的只列先出现的，候选里也不重复算已开的", () => {
        const field = tools({optional: ["nbook.agent.edit"], binding: {added: ["nbook.agent.edit-replace"], removed: []}});
        expect(ids(field)).toEqual(["nbook.agent.edit", "nbook.agent.ask"]);
        expect(field?.candidates.flatMap((group) => group.tools.map((row) => row.id))).toContain("nbook.agent.edit-replace");
    });

    test("绑定或要求里有、现在不存在的列在最后一组：必需的标必需", () => {
        const field = tools({required: ["gone.required"], optional: ["gone.optional"], binding: {added: ["gone.added"], removed: []}});
        const gone = field?.groups.at(-1);
        expect(gone?.provider).toBe("已卸载");
        expect(gone?.tools.map((row) => [row.id, row.required, row.gone])).toEqual([["gone.required", true, true], ["gone.optional", false, true], ["gone.added", false, true]]);
        expect(field?.count).toBe(1);
    });

    test("有绑定时标 modified", () => {
        expect(tools()?.modified).toBe(false);
        expect(tools({binding: {added: [], removed: ["nbook.agent.ask"]}})?.modified).toBe(true);
        // 手写的空绑定没有任何效果，不算改过。
        expect(tools({binding: {added: [], removed: []}})?.modified).toBe(false);
    });

    test("候选：同名工具能换就写 replaces，必需的换不了就 blocked", () => {
        const candidate = (field: ReturnType<typeof tools>, id: string) => field?.candidates.flatMap((group) => group.tools).find((row) => row.id === id);
        expect(candidate(tools({optional: ["nbook.agent.edit"]}), "nbook.agent.edit-replace")).toMatchObject({replaces: "nbook.agent.edit", blocked: false});
        expect(candidate(tools({required: ["nbook.agent.edit"]}), "nbook.agent.edit-replace")).toMatchObject({blocked: true});
        expect(candidate(tools(), "nbook.agent.shell")).toMatchObject({blocked: false});
        expect(candidate(tools(), "nbook.agent.shell")?.replaces).toBeUndefined();
    });

    test("说明：内置的用界面文字，别的插件的取第一行，全文在 detail", () => {
        const field = tools({required: ["nbook.agent.read"], binding: {added: ["alpha.tool"], removed: []}});
        const rows = field?.groups.flatMap((group) => group.tools);
        expect(rows?.find((row) => row.id === "nbook.agent.read")?.summary).toBe("读取文件与目录，能看图片。");
        expect(rows?.find((row) => row.id === "alpha.tool")).toMatchObject({summary: "alpha.tool 的说明", detail: "alpha.tool 的说明\n第二行"});
    });

    test("从未成功的没有这一节；什么都没有的后台 Profile 也没有", () => {
        const {tools: _tools, ...rest} = entry();
        expect(view({entry: rest as ProfileEntry, catalog: CATALOG}).tools).toBeNull();
        expect(tools({hidden: true, defaultTools: false})).toBeNull();
        expect(tools({hidden: true})).not.toBeNull();
    });
});

describe("可派的子代理一节", () => {
    const SPAWN = {id: "nbook.agent.spawn", description: "派子代理", providerName: "agent_spawn", effect: "read" as const, plugin: "nbook.agent"};
    const agentsOf = (over: {spawn?: boolean; setting?: object} = {}) => profileViews({
        profiles: [
            entry({key: "main", name: "主创", tools: {required: [], optional: over.spawn === false ? [] : ["nbook.agent.spawn"]}, agents: {allowed: ["helper", "gone"], recommended: ["helper", "gone"]}}),
            entry({key: "helper", name: "临时帮手", description: "做一件事"}),
            entry({key: "user.x", name: "我的", source: "user"}),
            entry({key: "broken", name: "坏的", status: "unavailable"}),
        ],
        catalog: [SPAWN],
        bindings: {},
        settings: over.setting === undefined ? {} : {main: over.setting},
        snapshot: snapshot(),
        models: {rows: [], lookup: new Map()},
        modelsFailed: false,
        pluginName: (plugin) => `插件 ${plugin}`,
        text,
    })[0]!.agents;

    test("profile-settings.md 输出 25：有 agent_spawn 才有；推荐、我加的、已删除的各标出来（已删除的不再标推荐）；候选是不在白名单里、可用的", () => {
        expect(agentsOf({spawn: false})).toBeNull();
        const agents = agentsOf({setting: {agents: {added: ["user.x"], removed: []}}})!;
        const rows = agents.groups.flatMap((group) => group.tools.map((row) => [row.id, row.effect, row.gone]));
        expect(rows).toEqual(expect.arrayContaining([["helper", "推荐", false], ["user.x", "我加的", false], ["gone", "", true]]));
        expect(agents.count).toBe(3);
        expect(agents.modified).toBe(true);
        expect(agents.candidates.flatMap((group) => group.tools.map((row) => row.id)).sort()).toEqual(["main"]);
    });
});

describe("Skill 一节（skills.md 的白名单）", () => {
    const skill = (source: "user" | "builtin", name: string, extra: Partial<Pick<SkillEntry, "status" | "problem" | "description">> = {}): SkillEntry => ({id: `${source}.${name}`, name, description: `${name} 的说明`, source, location: `skills://${source}.${name}/SKILL.md`, status: "ready", ...extra});
    const pluginSkill = (plugin: string, title: string | null, name: string, extra: Partial<Pick<SkillEntry, "status" | "problem" | "description">> = {}): SkillEntry => ({id: `${plugin}.${name}`, name, description: `${name} 的说明`, source: "plugin", plugin: {id: plugin, title}, location: `skills://${plugin}.${name}/SKILL.md`, status: "ready", ...extra});
    const SKILLS: readonly SkillEntry[] = [
        skill("builtin", "chapter-summary"),
        skill("user", "style-guide"),
        skill("user", "epub-export", {status: "needs-init"}),
        skill("user", "tts-preview"),
        skill("user", "outline", {status: "invalid"}),
        pluginSkill("acme.docs", "文档工具", "pdf"),
    ];
    const skillsOf = (input: {entry?: ProfileEntry; setting?: object; skills?: readonly SkillEntry[] | null}) => profileViews({
        profiles: [input.entry ?? entry()],
        catalog: [],
        bindings: {},
        settings: input.setting === undefined ? {} : {x: input.setting},
        snapshot: snapshot(),
        models: {rows: [], lookup: new Map()},
        modelsFailed: false,
        pluginName: (plugin) => plugin,
        text,
        skills: input.skills === undefined ? SKILLS : input.skills,
    })[0]!.skills;
    const groups = (field: ReturnType<typeof skillsOf>) => field?.groups.map((group) => [group.provider, group.tools.map((row) => `${row.id}${row.effect === "" ? "" : `:${row.effect}`}${row.restorable === true ? ":加回" : ""}`)]);

    test("声明全部：目录里的都列出，我的在前、插件的按插件名、内置在后；未初始化的标出；去掉的收在最后一组“已去掉”，能加回", () => {
        const field = skillsOf({entry: entry({skills: {allowed: "all"}}), setting: {skills: {added: [], removed: ["user.tts-preview"]}}});
        expect(groups(field)).toEqual([
            ["我的 Skill", ["user.style-guide", "user.epub-export:未初始化", "user.outline:无效"]],
            ["文档工具", ["acme.docs.pdf"]],
            ["内置", ["builtin.chapter-summary"]],
            ["已去掉", ["user.tts-preview:加回"]],
        ]);
        expect(field).toMatchObject({count: 4, modified: true});
        expect(field?.candidates.flatMap((group) => group.tools.map((row) => row.id))).toEqual(["user.tts-preview"]);
    });

    test("没声明就是空的；用户加的标“我加的”；白名单里、目录中没有的列在“已删除或不可用”；无效的不进候选", () => {
        expect(groups(skillsOf({}))).toEqual([]);
        const field = skillsOf({entry: entry({skills: {allowed: ["user.style-guide", "user.gone"]}}), setting: {skills: {added: ["builtin.chapter-summary"], removed: []}}});
        expect(groups(field)).toEqual([
            ["我的 Skill", ["user.style-guide"]],
            ["内置", ["builtin.chapter-summary:我加的"]],
            ["已删除或不可用", ["user.gone"]],
        ]);
        expect(field?.groups.at(-1)?.tools[0]).toMatchObject({gone: true, summary: expect.stringContaining("没有找到")});
        expect(field?.candidates.map((group) => [group.provider, group.tools.map((row) => row.id)])).toEqual([["我的 Skill", ["user.epub-export", "user.tts-preview"]], ["文档工具", ["acme.docs.pdf"]]]);
    });

    test("插件的 Skill 每个插件一组：没有显示名写插件 id，显示名撞了带上 id；无效的悬停写原因、不进候选；去掉的进“已去掉”；插件停用后白名单里留下的进“已删除或不可用”", () => {
        const skills: readonly SkillEntry[] = [
            pluginSkill("acme.docs", "文档工具", "pdf"),
            pluginSkill("acme.docs", "文档工具", "raw", {status: "invalid", problem: {code: "plugin-skill-unbuilt"}}),
            pluginSkill("zeta.tools", null, "lint"),
            pluginSkill("beta.docs", "文档工具", "ocr"),
            skill("user", "notes"),
        ];
        const field = skillsOf({entry: entry({skills: {allowed: "all"}}), setting: {skills: {added: ["acme.old.gone"], removed: ["zeta.tools.lint"]}}, skills});
        expect(field?.groups.map((group) => [group.id, group.provider, group.tools.map((row) => row.id)])).toEqual([
            ["user", "我的 Skill", ["user.notes"]],
            ["plugin:acme.docs", "文档工具 · acme.docs", ["acme.docs.pdf", "acme.docs.raw"]],
            ["plugin:beta.docs", "文档工具 · beta.docs", ["beta.docs.ocr"]],
            ["gone", "已删除或不可用", ["acme.old.gone"]],
            ["removed", "已去掉", ["zeta.tools.lint"]],
        ]);
        const raw = field?.groups[1]?.tools[1];
        expect(raw).toMatchObject({effect: "无效", danger: true, summary: "raw 的说明"});
        expect(raw?.detail).toContain("没有经 nbooke build 打包");
        expect(field?.groups[3]?.tools[0]?.summary).toContain("插件的重新启用插件后恢复");
        // 没有显示名的插件组写插件 id；无效的不进候选。
        const later = skillsOf({entry: entry({skills: {allowed: []}}), skills});
        expect(later?.candidates.map((group) => [group.id, group.provider, group.tools.map((row) => row.id)])).toEqual([
            ["user", "我的 Skill", ["user.notes"]],
            // 插件组按名字的本地化比较：拉丁字母在汉字前面；同名的按插件 id。
            ["plugin:zeta.tools", "zeta.tools", ["zeta.tools.lint"]],
            ["plugin:acme.docs", "文档工具 · acme.docs", ["acme.docs.pdf"]],
            ["plugin:beta.docs", "文档工具 · beta.docs", ["beta.docs.ocr"]],
        ]);
    });

    test("Skill 目录还没取到、Profile 从未成功过、后台的 Profile 没有这一节", () => {
        expect(skillsOf({skills: null})).toBeNull();
        expect(skillsOf({entry: entry({tools: undefined})})).toBeNull();
        expect(skillsOf({entry: entry({hidden: true, skills: {allowed: "all"}})})).toBeNull();
    });
});
