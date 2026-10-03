import {describe, expect, it} from "vitest";
import {
    clampMutationIndex,
    deleteMutationAt,
    duplicateMutationAt,
    filterPreviewProjects,
    formatJsonInputValue,
    formatWorldEngineConflictMessage,
    formatSubjectList,
    defaultMutationForPreviewAttr,
    defaultMutationForPreviewSubject,
    defaultValueForPreviewAttr,
    insertMutationAfter,
    isJsonObjectValue,
    keepSelectedPreviewProject,
    moveMutationAt,
    opOptionsForPreviewAttr,
    parseCsvList,
    parseLooseJsonValue,
    parseMutationJson,
    parseMutationListJson,
    previewAttrNeedsJsonObject,
    previewAttrValueType,
    replaceMutationAt,
    resolvePreviewAttrPath,
    selectPreviewProjectRoot,
    suggestAdjacentPreviewTime,
    suggestNextPreviewTime,
    suggestSliceTime,
    type WorldMutationDraft,
    type WorldPreviewSchemaType,
} from "nbook/app/utils/world-engine-preview";

describe("world-engine-preview utils", () => {
    it("解析逗号分隔列表时会裁剪空白并丢弃空项", () => {
        expect(parseCsvList(" erina, phoenix ,,hp ")).toEqual(["erina", "phoenix", "hp"]);
        expect(formatSubjectList([" erina ", "", "phoenix"])).toBe("erina, phoenix");
    });

    it("按 Project 标题、路径和摘要过滤 preview project 列表", () => {
        const projects = [
            {title: "龙眠纪事", projectRoot: "dragon-sleep", summary: "主线项目"},
            {title: "世界引擎浏览器试用", projectRoot: "world-engine-browser", summary: "World Engine preview project"},
            {title: "灰塔短篇", projectRoot: "gray-tower", summary: "短篇"},
        ];

        expect(filterPreviewProjects(projects, "world-engine")).toEqual([projects[1]]);
        expect(filterPreviewProjects(projects, "龙眠")).toEqual([projects[0]]);
        expect(filterPreviewProjects(projects, "PREVIEW")).toEqual([projects[1]]);
        expect(filterPreviewProjects(projects, "   ")).toBe(projects);
    });

    it("搜索过滤后仍保留当前选中的 Project", () => {
        const selected = {title: "当前项目", projectRoot: "current", summary: ""};
        const filtered = [{title: "其他项目", projectRoot: "other", summary: ""}];

        expect(keepSelectedPreviewProject(filtered, selected)).toEqual([selected, ...filtered]);
        expect(keepSelectedPreviewProject([selected], selected)).toEqual([selected]);
        expect(keepSelectedPreviewProject(filtered, null)).toBe(filtered);
    });

    it("选择仍存在的 Preview Project root，候选失效时回退到列表第一项", () => {
        const projects = [
            {title: "当前项目", projectRoot: "current", summary: ""},
            {title: "新建项目", projectRoot: "new", summary: ""},
        ];

        expect(selectPreviewProjectRoot(projects, "missing", " new ")).toBe("new");
        expect(selectPreviewProjectRoot(projects, "missing", "", null)).toBe("current");
        expect(selectPreviewProjectRoot([], "missing")).toBe("");
    });

    it("把同 instant 冲突提示改写为 UI 可执行动作", () => {
        const rawMessage = "该时间已有切面。请读取 existingSliceId 并合并 patches；只有整条切面作废时才删除重写。 existingSliceId=slice-1, time=复兴纪元1年 1月1日 00:00:01, title=示例";
        const message = formatWorldEngineConflictMessage(rawMessage);

        expect(message).toContain("点击“载入编辑”");
        expect(message).toContain("existingSliceId=slice-1");
        const initConflict = formatWorldEngineConflictMessage("目标时间已有非 init 切面，不能把 subject 初始化自动追加进去。请读取 existingSliceId 并显式合并初始化 patches，或选择其他初始化时间。 existingSliceId=slice-2, time=复兴纪元1年 1月1日 00:00:00, title=开场");
        expect(initConflict).toContain("不能自动追加 subject 初始化");
        expect(initConflict).toContain("载入这个时间的 slice");
        expect(initConflict).toContain("existingSliceId=slice-2");
        expect(initConflict).not.toContain("editSlice");
        expect(initConflict).not.toContain("请读取 existingSliceId");
        expect(formatWorldEngineConflictMessage("普通错误")).toBe("普通错误");
    });

    it("解析合法 mutation JSON", () => {
        expect(parseMutationJson(JSON.stringify([
            {subjectId: "erina", path: "/hp", op: "increment", value: -10, summary: "受伤失去体力"},
            {subjectId: "erina", path: "/events", op: "append", value: "受伤"},
            {subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"},
            {subjectId: "erina", path: "/equipment/head", op: "remove"},
        ]))).toEqual({
            ok: true,
            value: [
                {subjectId: "erina", path: "/hp", op: "increment", value: -10, summary: "受伤失去体力"},
                {subjectId: "erina", path: "/events", op: "append", value: "受伤"},
                {subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"},
                {subjectId: "erina", path: "/equipment/head", op: "remove"},
            ],
        });
    });

    it("拒绝空数组和非法 op", () => {
        expect(parseMutationJson("[]")).toEqual({ok: false, message: "patches 必须是非空数组"});
        expect(parseMutationListJson("[]")).toEqual({ok: true, value: []});
        expect(parseMutationListJson("{}")).toEqual({ok: false, message: "patches 必须是数组"});
        expect(parseMutationJson(JSON.stringify([{subjectId: "erina", path: "/hp", op: "push"}]))).toEqual({ok: false, message: "patch.op 不合法"});
        expect(parseMutationJson(JSON.stringify([{subjectId: "erina", path: "/hp", op: "replace"}]))).toEqual({ok: false, message: "patch.value 不能为空"});
        expect(parseMutationJson(JSON.stringify([{subjectId: "erina", path: "hp", op: "replace", value: 80}]))).toEqual({ok: false, message: "patch.path 必须是 JSON Pointer（以 / 开头，且不能包含空段）"});
    });

    it("支持 mutation 列表插入、替换、删除、移动和索引夹取", () => {
        const mutations: WorldMutationDraft[] = [
            {subjectId: "world", path: "/events", op: "append", value: "开始"},
            {subjectId: "erina", path: "/hp", op: "increment", value: -5},
            {subjectId: "erina", path: "/events", op: "append", value: "受伤"},
        ];
        const replacement: WorldMutationDraft = {subjectId: "erina", path: "/hp", op: "replace", value: 80};

        expect(replaceMutationAt(mutations, 1, replacement)).toEqual({
            ok: true,
            value: {
                mutations: [mutations[0]!, replacement, mutations[2]!],
                index: 1,
                changed: true,
            },
        });
        expect(insertMutationAfter(mutations, 1, replacement)).toEqual({
            ok: true,
            value: {
                mutations: [mutations[0]!, mutations[1]!, replacement, mutations[2]!],
                index: 2,
                changed: true,
            },
        });
        expect(duplicateMutationAt(mutations, 1)).toEqual({
            ok: true,
            value: {
                mutations: [mutations[0]!, mutations[1]!, mutations[1]!, mutations[2]!],
                index: 2,
                changed: true,
            },
        });
        expect(deleteMutationAt(mutations, 2)).toEqual({
            ok: true,
            value: {
                mutations: [mutations[0]!, mutations[1]!],
                index: 1,
                changed: true,
            },
        });
        expect(moveMutationAt(mutations, 1, "up")).toEqual({
            ok: true,
            value: {
                mutations: [mutations[1]!, mutations[0]!, mutations[2]!],
                index: 0,
                changed: true,
            },
        });
        expect(moveMutationAt(mutations, 0, "up")).toEqual({
            ok: true,
            value: {
                mutations,
                index: 0,
                changed: false,
                message: "所选 mutation 已经在最上方。",
            },
        });
        expect(clampMutationIndex(3, 5)).toBe(2);
        expect(clampMutationIndex(0, 5)).toBe(0);
        expect(replaceMutationAt(mutations, 9, replacement)).toEqual({ok: false, message: "请选择要替换的 mutation。"});
        expect(insertMutationAfter(mutations, 9, replacement)).toEqual({ok: false, message: "请选择插入位置。"});
        expect(duplicateMutationAt(mutations, 9)).toEqual({ok: false, message: "请选择要复制的 mutation。"});
    });

    it("复制 mutation 时会复制 JSON value，避免对象值共享引用", () => {
        const sourceValue = {nested: ["a"]};
        const mutations: WorldMutationDraft[] = [
            {subjectId: "world", path: "/metadata", op: "replace", value: sourceValue},
        ];
        const result = duplicateMutationAt(mutations, 0);

        expect(result).toEqual(expect.objectContaining({ok: true}));
        if (result.ok) {
            expect(result.value.mutations[1]?.value).toEqual(sourceValue);
            expect(result.value.mutations[1]?.value).not.toBe(sourceValue);
        }
    });

    it("从日历示例推导普通 slice 时间，避开 init instant", () => {
        expect(suggestSliceTime(["复兴纪元1年 1月1日 00:00:00"])).toBe("复兴纪元1年 1月1日 00:00:01");
        expect(suggestSliceTime(["某个时代"])).toBe("某个时代");
        expect(suggestSliceTime(["复兴纪元1年 1月1日 00:00:59", "复兴纪元1年 1月1日 00:01:00"])).toBe("复兴纪元1年 1月1日 00:01:00");
    });

    it("为普通 slice 寻找未占用的后续时间", () => {
        expect(suggestNextPreviewTime(["复兴纪元1年 1月1日 00:00:00"], ["复兴纪元1年 1月1日 00:00:00"])).toBe("复兴纪元1年 1月1日 00:00:01");
        expect(suggestNextPreviewTime(["复兴纪元1年 1月1日 00:00:00"], [
            "复兴纪元1年 1月1日 00:00:00",
            "复兴纪元1年 1月1日 00:00:01",
        ])).toBe("复兴纪元1年 1月1日 00:00:02");
        expect(suggestNextPreviewTime(["复兴纪元1年 1月1日 00:00:58"], [
            "复兴纪元1年 1月1日 00:00:58",
            "复兴纪元1年 1月1日 00:00:59",
        ])).toBe("复兴纪元1年 1月1日 00:01:00");
        expect(suggestNextPreviewTime(["复兴纪元488年 1月15日 14:59:59"], [
            "复兴纪元488年 1月15日 14:59:59",
        ])).toBe("复兴纪元488年 1月15日 15:00:00");
        expect(suggestNextPreviewTime(["复兴纪元488年 1月15日 23:59:59"], [
            "复兴纪元488年 1月15日 23:59:59",
        ])).toBe("复兴纪元488年 1月16日 00:00:00");
        expect(suggestNextPreviewTime(["复兴纪元488年 1月30日 23:59:59"], [
            "复兴纪元488年 1月30日 23:59:59",
        ])).toBe("复兴纪元488年 2月1日 00:00:00");
        expect(suggestNextPreviewTime(["复兴纪元488年 12月30日 23:59:59"], [
            "复兴纪元488年 12月30日 23:59:59",
        ])).toBe("复兴纪元489年 1月1日 00:00:00");
        expect(suggestNextPreviewTime([
            "复兴纪元1年 1月1日 00:00:00",
            "复兴纪元488年 1月15日 14:00:00",
        ], [
            "复兴纪元488年 1月15日 14:00:00",
            "复兴纪元488年 1月15日 14:00:01",
            "复兴纪元488年 1月15日 14:00:02",
        ])).toBe("复兴纪元488年 1月15日 14:00:03");
        expect(suggestNextPreviewTime(["复兴纪元1年 1月1日 00:00:00"], [
            "复兴纪元1年 1月1日 00:00:10",
            "复兴纪元1年 1月1日 00:00:02",
        ])).toBe("复兴纪元1年 1月1日 00:00:11");
        expect(suggestNextPreviewTime(["复兴纪元1年 1月1日 00:00:00"], [
            "复兴纪元1年 1月1日 00:00:10",
            "复兴纪元1年 1月1日 00:00:11",
            "复兴纪元1年 1月1日 00:00:02",
        ])).toBe("复兴纪元1年 1月1日 00:00:12");
        expect(suggestNextPreviewTime(["复兴纪元488年 1月15日 00:00:00"], [
            "复兴纪元488年 1月15日 23:59:59",
            "复兴纪元488年 1月15日 00:00:01",
        ])).toBe("复兴纪元488年 1月16日 00:00:00");
        expect(suggestNextPreviewTime(["某个时代", "另一个时代"], ["某个时代"])).toBe("另一个时代");
    });

    it("按目标 slice 前后建议相邻新 slice 时间", () => {
        expect(suggestAdjacentPreviewTime(["复兴纪元1年 1月1日 00:00:00"], [
            "复兴纪元1年 1月1日 00:00:09",
            "复兴纪元1年 1月1日 00:00:10",
        ], "复兴纪元1年 1月1日 00:00:10", "before")).toBe("复兴纪元1年 1月1日 00:00:08");
        expect(suggestAdjacentPreviewTime(["复兴纪元1年 1月1日 00:00:00"], [
            "复兴纪元1年 1月1日 00:00:10",
            "复兴纪元1年 1月1日 00:00:11",
        ], "复兴纪元1年 1月1日 00:00:10", "after")).toBe("复兴纪元1年 1月1日 00:00:12");
        expect(suggestAdjacentPreviewTime(["复兴纪元1年 1月1日 00:00:00"], [], "复兴纪元1年 1月1日 00:00:00", "before")).toBe("复兴纪元0年 12月30日 23:59:59");
        expect(suggestAdjacentPreviewTime(["某个时代", "另一个时代"], ["某个时代"], "不可解析时间", "before")).toBe("另一个时代");
    });

    it("宽松解析 value 输入，普通文本自动作为字符串", () => {
        expect(parseLooseJsonValue("80")).toEqual({ok: true, value: 80});
        expect(parseLooseJsonValue("subject://capital")).toEqual({ok: true, value: "subject://capital"});
        expect(parseLooseJsonValue("{bad")).toEqual(expect.objectContaining({ok: false}));
        expect(formatJsonInputValue("80")).toBe("\"80\"");
        expect(formatJsonInputValue("true")).toBe("\"true\"");
        expect(formatJsonInputValue("plain")).toBe("plain");
        expect(parseLooseJsonValue(formatJsonInputValue("80"))).toEqual({ok: true, value: "80"});
        expect(formatJsonInputValue(80)).toBe("80");
    });

    it("按 schema attr 推导 Mutation Builder 的 op 和默认值", () => {
        expect(opOptionsForPreviewAttr({name: "events", kind: "list", type: "text"})).toEqual(["append", "replace", "remove"]);
        expect(opOptionsForPreviewAttr({name: "inventory", kind: "collection", type: "ref(item)"})).toEqual(["append", "replace", "remove"]);
        expect(opOptionsForPreviewAttr({name: "profile", kind: "object"})).toEqual(["replace", "remove"]);
        expect(opOptionsForPreviewAttr({name: "hp", kind: "scalar", type: "int"})).toEqual(["replace", "increment", "remove"]);
        expect(opOptionsForPreviewAttr({name: "mind", kind: "scalar", type: "text"})).toEqual(["replace", "remove"]);
        expect(opOptionsForPreviewAttr({name: "alive", kind: "scalar", type: "bool"})).toEqual(["replace", "remove"]);
        expect(opOptionsForPreviewAttr({name: "location", kind: "scalar", type: "ref(location)"})).toEqual(["replace", "remove"]);
        expect(defaultMutationForPreviewAttr("erina", {name: "events", kind: "list", type: "text"})).toEqual({subjectId: "erina", path: "/events", op: "append", value: "记录"});
        expect(defaultMutationForPreviewAttr("erina", {name: "events", kind: "list", itemType: "ref(location)"}, [
            {id: "capital", type: "location", name: "王都"},
        ])).toEqual({subjectId: "erina", path: "/events", op: "append", value: "subject://capital"});
        expect(defaultMutationForPreviewAttr("erina", {name: "scores", kind: "list", itemType: "int"})).toEqual({subjectId: "erina", path: "/scores", op: "append", value: 0});
        expect(defaultMutationForPreviewAttr("erina", {name: "notes", kind: "list", itemType: "object"})).toEqual({subjectId: "erina", path: "/notes", op: "append", value: {}});
        expect(defaultMutationForPreviewAttr("erina", {name: "inventory", kind: "collection", type: "ref(item)"})).toEqual({subjectId: "erina", path: "/inventory", op: "append", value: "subject://"});
        expect(defaultMutationForPreviewAttr("erina", {name: "tokens", kind: "collection", itemType: "object"})).toEqual({subjectId: "erina", path: "/tokens", op: "append", value: {}});
        expect(defaultMutationForPreviewAttr("erina", {name: "inventory", kind: "collection", itemType: "ref(item)"}, [
            {id: "old-sword", type: "item", name: "旧剑"},
        ])).toEqual({subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"});
        expect(defaultValueForPreviewAttr({name: "inventory", kind: "collection", itemType: "ref(item)"}, [
            {id: "old-sword", type: "item", name: "旧剑"},
        ])).toBe("subject://old-sword");
        expect(defaultMutationForPreviewAttr("erina", {name: "inventory", kind: "collection", type: "ref(item)"}, [
            {id: "capital", type: "location", name: "王都"},
            {id: "old-sword", type: "item", name: "旧剑"},
        ])).toEqual({subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"});
        expect(defaultMutationForPreviewAttr("erina", {name: "location", kind: "scalar", type: "ref(location)"}, [
            {id: "capital", type: "location", name: "王都"},
        ])).toEqual({subjectId: "erina", path: "/location", op: "replace", value: "subject://capital"});
        expect(previewAttrValueType({name: "inventory", kind: "collection", itemType: "ref(item)"})).toBe("ref(item)");
        expect(previewAttrValueType({name: "events", kind: "list", itemType: "text"})).toBe("text");
        expect(defaultMutationForPreviewAttr("erina", {name: "hp", kind: "scalar", type: "int"})).toEqual({subjectId: "erina", path: "/hp", op: "replace", value: 0});
        expect(defaultMutationForPreviewAttr("erina", {name: "alive", kind: "scalar", type: "bool"})).toEqual({subjectId: "erina", path: "/alive", op: "replace", value: false});
        expect(defaultMutationForPreviewAttr("quest-1", {name: "status", kind: "scalar", type: "enum", enum: ["active", "done"]})).toEqual({subjectId: "quest-1", path: "/status", op: "replace", value: "active"});
        expect(defaultMutationForPreviewAttr("quest-1", {name: "status", kind: "scalar", type: "enum", enum: ["active", "done"], default: "done"})).toEqual({subjectId: "quest-1", path: "/status", op: "replace", value: "done"});
        expect(defaultMutationForPreviewAttr("erina", {name: "hp", kind: "scalar", type: "int", default: 100})).toEqual({subjectId: "erina", path: "/hp", op: "replace", value: 100});
    });

    it("按 subject 类型和 schema 推导初始草稿 mutation", () => {
        const schemaTypes: WorldPreviewSchemaType[] = [
            {type: "character", attrs: [
                {name: "hp", kind: "scalar", type: "int", default: 100},
                {name: "events", kind: "list", itemType: "text"},
            ]},
            {type: "marker", attrs: [
                {name: "label", kind: "scalar", type: "text", default: "标记"},
                {name: "score", kind: "scalar", type: "int"},
            ]},
        ];
        const subjects = [
            {id: "erina", type: "character", name: "艾莉娜"},
            {id: "marker-1", type: "marker", name: "标记"},
        ];

        expect(defaultMutationForPreviewSubject(schemaTypes, subjects, "erina")).toEqual({subjectId: "erina", path: "/events", op: "append", value: "记录"});
        expect(defaultMutationForPreviewSubject(schemaTypes, subjects, "marker-1")).toEqual({subjectId: "marker-1", path: "/label", op: "replace", value: "标记"});
        expect(defaultMutationForPreviewSubject([
            {type: "world", attrs: [{name: "events", kind: "list", itemType: "text"}]},
            {type: "character", attrs: [{name: "hp", kind: "scalar", type: "int", default: 100}]},
        ], [
            {id: "player", type: "character", name: "玩家"},
            {id: "world", type: "world", name: "世界"},
        ], "player")).toEqual({subjectId: "world", path: "/events", op: "append", value: "记录"});
        expect(defaultMutationForPreviewSubject([], [], "world")).toEqual({subjectId: "world", path: "/events", op: "append", value: "世界事件"});
    });

    it("识别 Builder value 是否必须是 JSON object", () => {
        expect(previewAttrNeedsJsonObject({name: "profile", kind: "object"}, "replace")).toBe(true);
        expect(previewAttrNeedsJsonObject({name: "notes", kind: "list", itemType: "object"}, "append")).toBe(true);
        expect(previewAttrNeedsJsonObject({name: "tokens", kind: "collection", itemType: "object"}, "append")).toBe(true);
        expect(previewAttrNeedsJsonObject({name: "profile", kind: "object"}, "remove")).toBe(false);
        expect(previewAttrNeedsJsonObject({name: "events", kind: "list", itemType: "text"}, "append")).toBe(false);
        expect(isJsonObjectValue({text: "ok"})).toBe(true);
        expect(isJsonObjectValue(["not-object"])).toBe(false);
        expect(isJsonObjectValue("not-object")).toBe(false);
    });

    it("按手写嵌套 attr path 继承开放 object 的 itemType 投影", () => {
        const attrs = [
            {name: "memory", kind: "object", type: "text", itemType: "text"},
            {name: "deepMemory", kind: "object", type: "object", itemType: "object"},
            {
                name: "equipment",
                kind: "object",
                fields: {
                    weapon: {name: "weapon", kind: "scalar", type: "ref(item)"},
                },
            },
            {name: "equipment.weapon", kind: "scalar", type: "ref(item)"},
        ] satisfies WorldPreviewSchemaType["attrs"];

        expect(resolvePreviewAttrPath(attrs, "/equipment/weapon")).toEqual({name: "equipment.weapon", kind: "scalar", type: "ref(item)"});
        expect(resolvePreviewAttrPath(attrs, "/equipment/ring")).toBeNull();
        expect(resolvePreviewAttrPath(attrs, "/memory/师门")).toEqual({
            name: "memory.师门",
            kind: "scalar",
            type: "text",
            enum: undefined,
            desc: undefined,
        });
        expect(resolvePreviewAttrPath(attrs, "/deepMemory/first")).toEqual({
            name: "deepMemory.first",
            kind: "object",
            type: undefined,
            enum: undefined,
            desc: undefined,
        });
        expect(opOptionsForPreviewAttr(resolvePreviewAttrPath(attrs, "/memory/师门"))).toEqual(["replace", "remove"]);
        expect(opOptionsForPreviewAttr(resolvePreviewAttrPath(attrs, "/deepMemory/first"))).toEqual(["replace", "remove"]);
        expect(resolvePreviewAttrPath(attrs, "/memory/")).toBeNull();
    });
});
