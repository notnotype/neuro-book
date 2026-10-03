import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {adhocAgentProfile} from "nbook/server/agent/profiles/adhoc-profile";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";

describe("adhoc profile outputSchema", () => {
    it("合法 JSON Schema 会成为 report_result data 合同", () => {
        const outputSchema = Type.Object({answer: Type.String()}, {additionalProperties: false});
        expect(reportResultSchemaForProfile(adhocAgentProfile, outputSchema)).toMatchObject({
            properties: {data: outputSchema},
            required: expect.arrayContaining(["data"]),
        });
    });

    it.each([
        null,
        [],
        {type: 42},
        {type: "not-a-json-schema-type"},
    ])("显式非法 outputSchema fail closed：%j", (outputSchema) => {
        const binding = adhocAgentProfile.tools.report_result;
        expect(() => binding.dataSchemaFromInitial?.({systemPrompt: "test", outputSchema} as never))
            .toThrow(/outputSchema/);
    });
});
