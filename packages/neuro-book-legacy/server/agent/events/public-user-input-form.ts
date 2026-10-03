import {LowCodeFormDtoSchema} from "nbook/shared/dto/low-code-form.dto";
import type {AgentUserInputFormDto} from "nbook/shared/dto/agent-public-event.dto";
import {
    PUBLIC_AGENT_FORM_BYTES,
    PUBLIC_VALUE_MAX_ITEMS,
    PUBLIC_VALUE_MAX_NODES,
} from "nbook/server/agent/events/public-event-policy";

const FORM_STRING_MAX_BYTES = 2 * 1024;
const FORM_FIELD_MAX_ITEMS = 32;

export type PublicAgentUserInputFormSpec = {
    form: AgentUserInputFormDto;
    prompt?: string;
    layout?: "dialog" | "inline" | "fullscreen";
};

/**
 * 验证 Agent waiting 可公开的轻量表单。配置界面的 resource-preset 不属于 Agent 协议。
 */
export function publicAgentUserInputFormSpec(value: unknown): PublicAgentUserInputFormSpec {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("agent_user_input_form_invalid");
    }
    const spec = value as {form?: unknown; prompt?: unknown; layout?: unknown};
    assertBoundedValue(spec.form);
    const parsed = LowCodeFormDtoSchema.safeParse(spec.form);
    if (!parsed.success || parsed.data.fields.length > FORM_FIELD_MAX_ITEMS) {
        throw new Error("agent_user_input_form_invalid");
    }
    for (const field of parsed.data.fields) {
        if (field.component === "resource-preset") {
            throw new Error("agent_user_input_form_unsupported_component");
        }
        if (field.options.length > PUBLIC_VALUE_MAX_ITEMS) {
            throw new Error("agent_user_input_form_too_large");
        }
    }
    const prompt = typeof spec.prompt === "string" ? boundedString(spec.prompt) : undefined;
    const result: PublicAgentUserInputFormSpec = {
        form: parsed.data as AgentUserInputFormDto,
        ...(prompt === undefined ? {} : {prompt}),
        ...(spec.layout === "dialog" || spec.layout === "inline" || spec.layout === "fullscreen" ? {layout: spec.layout} : {}),
    };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > PUBLIC_AGENT_FORM_BYTES) {
        throw new Error("agent_user_input_form_too_large");
    }
    return result;
}

/** 在 stringify 前以节点、集合和字符串上限拒绝大对象。 */
function assertBoundedValue(value: unknown): void {
    let remainingNodes = PUBLIC_VALUE_MAX_NODES;
    const visit = (item: unknown): void => {
        remainingNodes -= 1;
        if (remainingNodes < 0) throw new Error("agent_user_input_form_too_large");
        if (typeof item === "string") {
            boundedString(item);
            return;
        }
        if (item === null || typeof item === "number" || typeof item === "boolean" || item === undefined) return;
        if (Array.isArray(item)) {
            if (item.length > PUBLIC_VALUE_MAX_ITEMS) throw new Error("agent_user_input_form_too_large");
            for (const child of item) visit(child);
            return;
        }
        if (typeof item !== "object") throw new Error("agent_user_input_form_invalid");
        const entries = Object.entries(item);
        if (entries.length > PUBLIC_VALUE_MAX_ITEMS) throw new Error("agent_user_input_form_too_large");
        for (const [key, child] of entries) {
            boundedString(key);
            visit(child);
        }
    };
    visit(value);
}

function boundedString(value: string): string {
    if (Buffer.byteLength(value, "utf8") > FORM_STRING_MAX_BYTES) {
        throw new Error("agent_user_input_form_too_large");
    }
    return value;
}
