import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import type {TSchema} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createReportResultTool} from "nbook/server/agent/tools/control-tools";

describe("reportResultSchemaForProfile", () => {
    it("空 OutputSchema 时只要求 result", () => {
        const profile = defineAgentProfile({
            manifest: {key: "agent.empty", name: "Empty"},
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result"]),
            prepare() {
                return {};
            },
        });

        const schema = reportResultSchemaForProfile(profile) as TSchema & {properties: Record<string, unknown>};

        expect(schema).toEqual(expect.objectContaining({required: ["result"]}));
        expect(schema.properties).not.toHaveProperty("data");
    });

    it("静态 OutputSchema 延续可选 data 合同", () => {
        const outputSchema = Type.Object({summary: Type.String()});
        const profile = defineAgentProfile({
            manifest: {key: "agent.data", name: "Data"},
            initialSchema: Type.Object({}),
            outputSchema,
            tools: profileToolsFromKeys(["report_result"]),
            prepare() {
                return {};
            },
        });

        expect(reportResultSchemaForProfile(profile)).toEqual(expect.objectContaining({
            required: ["result"],
            properties: expect.objectContaining({data: outputSchema}),
        }));
    });

    it("session 动态 OutputSchema 要求 data，并在执行期严格校验", async () => {
        const outputSchema = Type.Object({summary: Type.String()}, {additionalProperties: false});
        const profile = defineAgentProfile({
            manifest: {key: "adhoc", name: "Adhoc"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys(["report_result"]),
            prepare() {
                return {};
            },
        });
        const parameters = reportResultSchemaForProfile(profile, outputSchema);
        const tool = createReportResultTool(parameters, {dataSchema: outputSchema, dataRequired: true});

        expect(parameters).toEqual(expect.objectContaining({
            required: ["result", "data"],
            properties: expect.objectContaining({data: outputSchema}),
        }));
        expect(reportResultSchemaForProfile(profile, Type.Object({}, {additionalProperties: false}))).toEqual(expect.objectContaining({
            required: ["result", "data"],
        }));
        await expect(tool.execute!("call-missing", {result: "done"})).rejects.toThrow("report_result.data 必填");
        await expect(tool.execute!("call-invalid", {result: "done", data: {summary: 1}})).rejects.toThrow("report_result.data 校验失败");
        await expect(tool.execute!("call-valid", {result: "done", data: {summary: "ok"}})).resolves.toMatchObject({
            terminate: true,
            details: {result: "done", data: {summary: "ok"}},
        });
    });
});
