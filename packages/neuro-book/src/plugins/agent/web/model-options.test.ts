/**
 * 模型选择器的选项（model-options.ts）：服务商图标按实例取（同一模板的两份各用自己的），上传的图标走读取路由，模型列表与角色名
 * 来自选用数据。
 */

import {describe, expect, test} from "bun:test";

import {SAMPLE_CATALOG, SAMPLE_PROVIDERS, SAMPLE_ROWS} from "nbook/plugins/models/web/lab/sample";
import type {ModelsSnapshot, SelectionRow} from "nbook/plugins/models/shared/contracts";

import {modelGroups, modelOptions, providerIconRef, roleOptions} from "./model-options";

const base = SAMPLE_PROVIDERS[0]!;
const ICON = `${"a".repeat(64)}.png`;
const snapshot: ModelsSnapshot = {
    providers: [
        {...base, id: "ds-1", name: "DeepSeek", icon: null},
        {...base, id: "ds-2", name: "备用", icon: {kind: "file", name: ICON}},
        {...base, id: "ds-3", name: "第三份", icon: {kind: "builtin", key: "openai"}},
        {...base, id: "ds-4", name: "首字母", icon: {kind: "initial"}},
    ],
    roles: [{id: "main", axis: "gradient", builtin: true, name: "", description: "", model: "ds-2/deepseek-flash", effort: null, icon: null, status: "ok"}],
    catalog: SAMPLE_CATALOG,
};

describe("模型选择器的选项", () => {
    test("同一模板的几份各用自己的图标：跟随模板的取模板键，上传的走读取路由，内置的取选的键，首字母画首字", () => {
        expect(snapshot.providers.map(providerIconRef)).toEqual([
            {kind: "key", set: "provider", key: base.template, fallback: "DeepSeek"},
            {kind: "url", src: `/api/nbook.models/icons/${ICON}`, fallback: "备用"},
            {kind: "key", set: "provider", key: "openai", fallback: "第三份"},
            {kind: "initial", text: "首"},
        ]);
        expect(modelGroups(snapshot).map((group) => group.icon?.kind)).toEqual(["key", "url", "key", "initial"]);
    });

    test("模型列表来自选用数据的行，组名是服务商的名称；角色名取按引用取到的行，还没取到时先显示引用", () => {
        const rows: SelectionRow[] = SAMPLE_ROWS.deepseek!.map((row) => ({...row, provider: "ds-2"}));
        expect(modelOptions(snapshot, rows).map((option) => [option.key, option.group])).toEqual(rows.map((row) => [`ds-2/${row.id}`, "备用"]));
        expect(roleOptions(snapshot, new Map())[0]).toMatchObject({modelLabel: "ds-2/deepseek-flash", modelIcon: {kind: "url"}});
        expect(roleOptions(snapshot, new Map([["ds-2/deepseek-flash", {name: "DeepSeek Flash"}]]))[0]!.modelLabel).toBe("DeepSeek Flash");
    });
});
