/**
 * 三种上报里不属于哪一档的字段：发送方所用的清单版本与上报编号（docs/specs/telemetry/protocol.md 字段表里档为“—”的两行）。
 * 它们不随清单版本变化，所以不在版本表里。
 */

import {Type} from "typebox";

import {deepFreeze, groupField, valueField} from "./fields";
import type {Bilingual, ReportEnvelope, ValueField} from "./types";

/** 清单版本号：不小于 1 的整数。服务端认不认识这个版本是它的规则，不在 schema 里。 */
const VERSION_NUMBER = Type.Integer({minimum: 1});

const anonymousVersion: ValueField = valueField({
    tier: null,
    required: true,
    description: {"zh-CN": "应用所用的匿名档清单的版本号。", "en-US": "The version of the anonymous list that the app uses."},
    schema: VERSION_NUMBER,
});

const usageVersionDescription: Bilingual = {"zh-CN": "应用所用的使用档清单的版本号。", "en-US": "The version of the usage list that the app uses."};

const manifestDescription: Bilingual = {
    "zh-CN": "应用所用的收集清单的版本，服务端据此知道按哪一版的字段表读这份上报。",
    "en-US": "The versions of this collection list that the app uses, so the server knows which version of the field list to read the report by.",
};

const reportId: ValueField = valueField({
    tier: null,
    required: true,
    description: {
        "zh-CN": "为这一份上报随机生成的编号，只用来在重发时认出同一份、不重复计数。每份上报的编号都不同，不能用来把两份上报认成同一台电脑。",
        "en-US": "A random number generated for this one report, used only to recognize the same report when it is resent so it is not counted twice. Every report gets a different one, so it cannot link two reports to the same computer.",
    },
    // 协议：22 到 64 个字符，只含大小写字母、数字、`_`、`-`。
    schema: Type.String({pattern: "^[A-Za-z0-9_-]{22,64}$"}),
});

export const REPORT_ENVELOPE: ReportEnvelope = deepFreeze({
    daily: {
        manifest: groupField({
            tier: null,
            required: true,
            description: manifestDescription,
            fields: {
                anonymous: anonymousVersion,
                usage: valueField({
                    tier: null,
                    required: false,
                    description: {"zh-CN": `${usageVersionDescription["zh-CN"]}只在带使用统计时出现。`, "en-US": `${usageVersionDescription["en-US"]} Present only when the report includes usage statistics.`},
                    schema: VERSION_NUMBER,
                }),
            },
        }),
        reportId,
    },
    heartbeat: {
        manifest: groupField({tier: null, required: true, description: manifestDescription, fields: {anonymous: anonymousVersion}}),
    },
    event: {
        // 立即事件属于使用档，`manifest.usage` 必填（协议 `POST /v1/event`）。
        manifest: groupField({
            tier: null,
            required: true,
            description: manifestDescription,
            fields: {anonymous: anonymousVersion, usage: valueField({tier: null, required: true, description: usageVersionDescription, schema: VERSION_NUMBER})},
        }),
        reportId,
    },
});
