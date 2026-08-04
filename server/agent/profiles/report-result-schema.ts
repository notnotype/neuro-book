import {Type} from "typebox";
import type {TSchema} from "typebox";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import type {ProfileToolBinding, ReportResultToolBinding} from "nbook/profile-sdk/contracts";

/**
 * 判断 TypeBox object schema 是否没有定义任何输出字段。
 */
export function isEmptyObjectSchema(schema: TSchema | undefined): boolean {
    if (!schema || typeof schema !== "object") {
        return true;
    }
    const properties = "properties" in schema && schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {};
    return Object.keys(properties).length === 0;
}

/**
 * 判断 profile 是否声明了 report_result 专用 binding 字段。
 * dataSchemaFromInitial 是 adhoc session 的动态 data schema 来源。
 */
export function isReportResultBinding(binding: ProfileToolBinding | undefined): binding is ReportResultToolBinding {
    return Boolean(binding && typeof binding === "object" && binding.key === "report_result"
        && ("dataSchema" in binding || "dataSchemaFromInitial" in binding));
}

/**
 * 从目标 profile 的 OutputSchema 派生 report_result 的模型可见参数 schema。
 * dataSchemaOverride 非空时优先（per-session 动态 schema：adhoc profile 从 initial 解析）。
 */
export function reportResultSchemaForProfile(profile: AgentProfile, dataSchemaOverride?: TSchema): TSchema {
    const reportBinding = profile.tools.report_result;
    const requireData = dataSchemaOverride !== undefined;
    const dataSchema = dataSchemaOverride
        ?? (isReportResultBinding(reportBinding) ? reportBinding.dataSchema ?? profile.outputSchema : profile.outputSchema);
    const includeData = requireData || !isEmptyObjectSchema(dataSchema);
    const properties = {
        result: Type.String({
            description: "本次工具调用的可读结果；需要时可以写简短 walkthrough。",
        }),
        ...includeData
            ? {
                // 静态 profile 延续「可选结构化补充」；adhoc 的 session 动态 schema 是调用方合同，必须返回。
                data: requireData ? dataSchema as TSchema : Type.Optional(dataSchema as TSchema),
            }
            : {},
    };
    return Type.Object(properties);
}
