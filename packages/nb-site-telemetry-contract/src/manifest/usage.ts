/**
 * 使用档的各个版本（docs/specs/telemetry/protocol.md 的 `usage` 表、次数分档与 `POST /v1/event`）。第一版只有“稳定性”一类。
 *
 * 每个版本是一个常量，发布之后不改：自带插件的名单、错误码表、事件的码表加一项都是“只加取值”，写一个新版本的常量，
 * 并加进 `index.ts` 的版本表；改分档表、加字段、加类别同样（变更的三种与各自的后果见协议的“边界与兼容”）。
 *
 * 名单与码表的来源：
 * - `owner` 的取值是应用随发行构建带的插件（`packages/neuro-book/src/manifest.ts` 的 `productPlugins`），只在开发时
 *   加载的（`development-manifest.ts`，例如 Lab）不列。第 1 版照 2026-11-24 的 master 列出。
 * - 每个 `owner` 名下的错误码、立即事件每个 `kind` 名下的码：第 1 版只有 `other`。这是等主会话定的占位：应用里的错误码
 *   分散在各插件的失败类型、诊断事件名与文字目录里，没有一处能列全（w00037 t06 第 1 片的调查）。码表定下来以后按“只加取值”
 *   出新版本。
 */

import {deepFreeze, dependentField, enumField, groupField, listField} from "./fields";
import type {Bilingual, CountBucket, UsageManifest, ValueTable} from "./types";

/** 次数分档（版本 1）：0、1、2-4、5-9、10-49、50+。 */
const COUNT_BUCKETS_V1: readonly CountBucket[] = [
    {name: "0", min: 0, max: 0},
    {name: "1", min: 1, max: 1},
    {name: "2-4", min: 2, max: 4},
    {name: "5-9", min: 5, max: 9},
    {name: "10-49", min: 10, max: 49},
    {name: "50+", min: 50, max: null},
];

const COUNT_VALUES_V1: ValueTable = {
    "0": {"zh-CN": "0 次", "en-US": "0 times"},
    "1": {"zh-CN": "1 次", "en-US": "Once"},
    "2-4": {"zh-CN": "2 到 4 次", "en-US": "2 to 4 times"},
    "5-9": {"zh-CN": "5 到 9 次", "en-US": "5 to 9 times"},
    "10-49": {"zh-CN": "10 到 49 次", "en-US": "10 to 49 times"},
    "50+": {"zh-CN": "50 次及以上", "en-US": "50 times or more"},
};

/** 应用随发行构建带的插件（第 1 版），加上表外的 `other`。 */
const OWNERS_V1: ValueTable = {
    "runtime.diagnostics": {"zh-CN": "诊断与日志", "en-US": "Diagnostics and logs"},
    "nbook.http": {"zh-CN": "本机的网络服务", "en-US": "The app's local web server"},
    "nbook.state": {"zh-CN": "公开状态", "en-US": "Shared state"},
    "nbook.settings": {"zh-CN": "设置", "en-US": "Settings"},
    "nbook.commands": {"zh-CN": "命令", "en-US": "Commands"},
    "nbook.storage": {"zh-CN": "插件数据的存储", "en-US": "Storage for plugin data"},
    "nbook.network": {"zh-CN": "网络与代理", "en-US": "Network and proxy"},
    "nbook.models": {"zh-CN": "模型服务", "en-US": "Model services"},
    "nbook.tasks": {"zh-CN": "后台任务", "en-US": "Background tasks"},
    "nbook.agent": {"zh-CN": "Agent 对话", "en-US": "Agent conversations"},
    "nbook.stickers": {"zh-CN": "表情包", "en-US": "Stickers"},
    "nbook.bots": {"zh-CN": "bot", "en-US": "Bots"},
    "nbook.web-tools": {"zh-CN": "网页搜索与读取", "en-US": "Web search and fetch"},
    "nbook.plugins": {"zh-CN": "插件管理", "en-US": "Plugin management"},
    "nbook.workbench": {"zh-CN": "工作台", "en-US": "Workbench"},
    "nbook.projects": {"zh-CN": "项目与书架", "en-US": "Projects and bookshelf"},
    "nbook.files": {"zh-CN": "文件", "en-US": "Files"},
    "nbook.explorer": {"zh-CN": "资源管理器", "en-US": "File explorer"},
    "nbook.markdown": {"zh-CN": "Markdown", "en-US": "Markdown"},
    "nbook.editor": {"zh-CN": "编辑器", "en-US": "Editor"},
    "nbook.image-viewer": {"zh-CN": "图片查看器", "en-US": "Image viewer"},
    "nbook.html-preview": {"zh-CN": "HTML 预览", "en-US": "HTML preview"},
    "nbook.canon": {"zh-CN": "世界设定", "en-US": "World settings"},
    "nbook.plot": {"zh-CN": "剧情", "en-US": "Plot"},
    "nbook.theme-study": {"zh-CN": "“书房”主题", "en-US": "The \"Study\" theme"},
    "nbook.desktop": {"zh-CN": "桌面版专属功能", "en-US": "Desktop-only features"},
    other: {"zh-CN": "不是应用自带的插件（例如第三方插件）", "en-US": "Not a plugin that ships with the app (for example, a third-party plugin)"},
};

const UNLISTED_CODE: Bilingual = {"zh-CN": "这里没有列出的错误码", "en-US": "An error code not listed here"};

/**
 * 第 1 版的码表：每个 `owner` 名下只有 `other`（占位，见文件头）。`owner` 为 `other` 时 `code` 只能是 `other` 是协议的规则，
 * 不是占位，码表定下来以后也保持。
 */
const ERROR_CODES_V1: Readonly<Record<string, ValueTable>> = Object.fromEntries(Object.keys(OWNERS_V1).map((owner) => [owner, {other: UNLISTED_CODE}]));

const EVENT_KINDS_V1: ValueTable = {
    crash: {"zh-CN": "上一次运行意外退出", "en-US": "The previous run ended unexpectedly"},
    upgrade_failed: {"zh-CN": "一次升级没有装上", "en-US": "An upgrade was not installed"},
};

/** 第 1 版的事件码表：每个 `kind` 名下只有 `other`（占位，见文件头）。 */
const EVENT_CODES_V1: Readonly<Record<string, ValueTable>> = Object.fromEntries(Object.keys(EVENT_KINDS_V1).map((kind) => [kind, {other: UNLISTED_CODE}]));

const USAGE_V1: UsageManifest = deepFreeze({
    tier: "usage",
    version: 1,
    countBuckets: COUNT_BUCKETS_V1,
    usage: groupField({
        tier: "usage",
        required: false,
        description: {
            "zh-CN": "使用统计里的“稳定性”：前一天应用出错、意外退出与升级的情况，不含错误的文字、堆栈与你写的任何内容。只在你打开“使用统计”之后才发。用来找出最常出问题的地方、尽早发现新版本的问题。",
            "en-US": "The \"Stability\" part of usage statistics: how often the app ran into errors, ended unexpectedly and upgraded the day before, without error messages, stack traces or anything you wrote. Sent only after you turn on \"Usage statistics\". Used to find where problems happen most and to spot problems in new versions early.",
        },
        fields: {
            errors: listField({
                tier: "usage",
                required: true,
                description: {
                    "zh-CN": "前一天出现过的错误，每种一项：哪个自带插件报的、错误码、出现的次数（分档）。至多 50 种。",
                    "en-US": "The errors that happened the day before, one entry for each kind: which built-in plugin reported it, its error code and how many times it happened (as a range). At most 50 kinds.",
                },
                maxItems: 50,
                uniqueBy: ["owner", "code"],
                fields: {
                    owner: enumField({
                        tier: "usage",
                        required: true,
                        description: {"zh-CN": "报出这个错误的应用自带插件。", "en-US": "The built-in plugin that reported the error."},
                        values: OWNERS_V1,
                    }),
                    code: dependentField({
                        tier: "usage",
                        required: true,
                        description: {
                            "zh-CN": "错误码：插件给一种失败定的固定的码，不含错误的文字。这里没有列出的码记成 other。",
                            "en-US": "The error code: a fixed code the plugin uses for one kind of failure, without the error message. Codes not listed here are sent as other.",
                        },
                        dependsOn: "owner",
                        valuesBy: ERROR_CODES_V1,
                    }),
                    count: enumField({
                        tier: "usage",
                        required: true,
                        description: {"zh-CN": "这一天出现的次数（分档）。", "en-US": "How many times it happened that day (as a range)."},
                        values: COUNT_VALUES_V1,
                    }),
                },
            }),
            crashes: enumField({
                tier: "usage",
                required: true,
                description: {"zh-CN": "前一天应用意外退出的次数（分档）。", "en-US": "How many times the app ended unexpectedly the day before (as a range)."},
                values: COUNT_VALUES_V1,
            }),
            upgrade: enumField({
                tier: "usage",
                required: true,
                description: {"zh-CN": "前一天有没有升级、升级成功了没有。", "en-US": "Whether the app was upgraded the day before, and whether the upgrade succeeded."},
                values: {
                    none: {"zh-CN": "没有升级", "en-US": "No upgrade"},
                    succeeded: {"zh-CN": "升级成功", "en-US": "The upgrade succeeded"},
                    failed: {"zh-CN": "升级失败", "en-US": "The upgrade failed"},
                },
            }),
        },
    }),
    event: {
        kind: enumField({
            tier: "usage",
            required: true,
            description: {
                "zh-CN": "发生了什么。应用在下一次启动时立即发一条，用来在发版之后尽早发现问题；每天的次数仍以每日上报为准。",
                "en-US": "What happened. The app sends one right away on its next start, so problems can be spotted soon after a release; the daily counts still come from the daily report.",
            },
            values: EVENT_KINDS_V1,
        }),
        code: dependentField({
            tier: "usage",
            required: false,
            description: {
                "zh-CN": "这件事的错误码，可以不发。这里没有列出的码记成 other。",
                "en-US": "The error code for what happened; it may be left out. Codes not listed here are sent as other.",
            },
            dependsOn: "kind",
            valuesBy: EVENT_CODES_V1,
        }),
    },
});

/** 按版本从旧到新排列；`index.ts` 由它建版本表。 */
export const USAGE_VERSIONS: readonly UsageManifest[] = [USAGE_V1];
