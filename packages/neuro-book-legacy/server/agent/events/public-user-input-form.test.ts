import {describe, expect, it} from "vitest";
import {publicAgentUserInputFormSpec} from "nbook/server/agent/events/public-user-input-form";

describe("publicAgentUserInputFormSpec", () => {
    it("保留轻量审批表单", () => {
        const projected = publicAgentUserInputFormSpec({
            form: {
                defaults: {approved: true},
                fields: [{path: "approved", component: "radio", label: "批准？", required: true, options: [{value: true, label: "是"}, {value: false, label: "否"}]}],
            },
            prompt: "请审批",
            layout: "dialog",
        });

        expect(projected.form.fields[0]?.component).toBe("radio");
        expect(Buffer.byteLength(JSON.stringify(projected), "utf8")).toBeLessThan(32 * 1024);
    });

    it("拒绝 resource-preset 和大 Markdown", () => {
        expect(() => publicAgentUserInputFormSpec({
            form: {
                defaults: {},
                fields: [{
                    path: "preset",
                    component: "resource-preset",
                    label: "Preset",
                    required: false,
                    options: [],
                    resource: {contentType: "markdown", options: [], content: {key: "x", content: "x".repeat(10 * 1024 * 1024), contentType: "markdown"}, contents: [], capabilities: {create: false, update: false, rename: false, remove: false}},
                }],
            },
        })).toThrow(/agent_user_input_form_/);
    });

    it("拒绝超量字段、options 和深层 defaults", () => {
        expect(() => publicAgentUserInputFormSpec({form: {defaults: {}, fields: Array.from({length: 33}, (_, index) => ({path: `f${String(index)}`, component: "text", label: "F", required: false, options: []}))}})).toThrow("agent_user_input_form_too_large");
        expect(() => publicAgentUserInputFormSpec({form: {defaults: {}, fields: [{path: "f", component: "select", label: "F", required: false, options: Array.from({length: 33}, (_, index) => ({value: index, label: String(index)}))}]}})).toThrow("agent_user_input_form_too_large");
        expect(() => publicAgentUserInputFormSpec({form: {defaults: {items: Array.from({length: 33}, () => true)}, fields: []}})).toThrow("agent_user_input_form_too_large");
    });
});
