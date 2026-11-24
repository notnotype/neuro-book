/**
 * 匿名档的各个版本（docs/specs/telemetry/protocol.md 的字段表与“匿名档版本 1 的取值表”）。
 *
 * 每个版本是一个常量，发布之后不改：加取值、改说明、加字段都写一个新版本的常量，并加进 `index.ts` 的版本表
 * （变更的三种与各自的后果见协议的“边界与兼容”）。版本之间可以共用没变的字段对象。
 */

import {Type} from "typebox";

import {deepFreeze, enumField, valueField} from "./fields";
import type {AnonymousManifest, ValueField} from "./types";

/**
 * semver.org 给出的语义化版本写法（不带前缀 `v`）。长度上限另由 `maxLength` 管。
 */
const SEMVER = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";

const appVersion: ValueField = valueField({
    tier: "anonymous",
    required: true,
    description: {
        "zh-CN": "应用的版本号，例如 0.17.0。用来看每个版本有多少人在用、新版本推开得多快。",
        "en-US": "The app's version number, such as 0.17.0. Used to see how many people use each version and how quickly new versions are picked up.",
    },
    schema: Type.String({maxLength: 32, pattern: SEMVER}),
});

const form: ValueField = enumField({
    tier: "anonymous",
    required: true,
    description: {"zh-CN": "应用以哪种形式运行。用来决定桌面版与命令行版各该投入多少。", "en-US": "How the app is run. Used to decide how much effort to put into the desktop and command-line versions."},
    values: {
        desktop: {"zh-CN": "桌面版", "en-US": "The desktop app"},
        cli: {"zh-CN": "命令行版", "en-US": "The command-line version"},
    },
});

const ANONYMOUS_V1: AnonymousManifest = deepFreeze({
    tier: "anonymous",
    version: 1,
    daily: {
        appVersion,
        channel: enumField({
            tier: "anonymous",
            required: true,
            description: {"zh-CN": "应用的发行渠道。用来分开看早期验证版、预览版与稳定版。", "en-US": "The release channel of the app. Used to look at canary, preview and stable builds separately."},
            values: {
                canary: {"zh-CN": "早期验证版：功能能用，未必经过完整的人工验收", "en-US": "Canary: features work but may not have been fully tested by hand"},
                preview: {"zh-CN": "预览版（测试版）：新功能的预览", "en-US": "Preview (beta): an early look at new features"},
                stable: {"zh-CN": "稳定版", "en-US": "Stable release"},
            },
        }),
        form,
        osVersion: enumField({
            tier: "anonymous",
            required: true,
            description: {
                "zh-CN": "操作系统与它的大版本，不含更细的版本号。用来决定该优先支持哪些系统。",
                "en-US": "The operating system and its major version, without any finer version number. Used to decide which systems to support first.",
            },
            values: {
                "windows-10": {"zh-CN": "Windows 10", "en-US": "Windows 10"},
                "windows-11": {"zh-CN": "Windows 11", "en-US": "Windows 11"},
                windows: {"zh-CN": "其他版本的 Windows", "en-US": "Another version of Windows"},
                "macos-13": {"zh-CN": "macOS 13", "en-US": "macOS 13"},
                "macos-14": {"zh-CN": "macOS 14", "en-US": "macOS 14"},
                "macos-15": {"zh-CN": "macOS 15", "en-US": "macOS 15"},
                "macos-26": {"zh-CN": "macOS 26", "en-US": "macOS 26"},
                "macos-27": {"zh-CN": "macOS 27", "en-US": "macOS 27"},
                macos: {"zh-CN": "其他版本的 macOS", "en-US": "Another version of macOS"},
                linux: {"zh-CN": "Linux（不收内核版本）", "en-US": "Linux (the kernel version is not collected)"},
                other: {"zh-CN": "其他操作系统", "en-US": "Another operating system"},
            },
        }),
        arch: enumField({
            tier: "anonymous",
            required: true,
            description: {"zh-CN": "电脑的处理器架构。用来决定要提供哪些安装包。", "en-US": "The processor architecture of the computer. Used to decide which installers to provide."},
            values: {
                x64: {"zh-CN": "x64（64 位的 Intel 或 AMD 处理器）", "en-US": "x64 (64-bit Intel or AMD processors)"},
                arm64: {"zh-CN": "ARM64（例如 Apple 芯片）", "en-US": "ARM64 (for example, Apple silicon)"},
                other: {"zh-CN": "其他架构", "en-US": "Another architecture"},
            },
        }),
        locale: enumField({
            tier: "anonymous",
            required: true,
            description: {"zh-CN": "应用的界面语言。用来决定该优先维护哪些语言的界面。", "en-US": "The language of the app's interface. Used to decide which interface languages to look after first."},
            values: {
                "zh-CN": {"zh-CN": "简体中文", "en-US": "Simplified Chinese"},
                "en-US": {"zh-CN": "英语（美国）", "en-US": "English (US)"},
                other: {"zh-CN": "其他语言", "en-US": "Another language"},
            },
        }),
        region: enumField({
            tier: "anonymous",
            required: true,
            description: {
                "zh-CN": "大致所在的地区：应用把本机的时区换算成下面八个大区之一，不发时区本身。用来了解用户大致分布在哪里。",
                "en-US": "Your rough region: the app converts your computer's time zone into one of the eight regions below and does not send the time zone itself. Used to see roughly where users are.",
            },
            values: {
                "east-asia": {"zh-CN": "东亚", "en-US": "East Asia"},
                "southeast-asia": {"zh-CN": "东南亚", "en-US": "Southeast Asia"},
                "south-asia": {"zh-CN": "南亚", "en-US": "South Asia"},
                europe: {"zh-CN": "欧洲", "en-US": "Europe"},
                "north-america": {"zh-CN": "北美", "en-US": "North America"},
                "latin-america": {"zh-CN": "拉丁美洲", "en-US": "Latin America"},
                "middle-east-africa": {"zh-CN": "中东与非洲", "en-US": "Middle East and Africa"},
                oceania: {"zh-CN": "大洋洲", "en-US": "Oceania"},
                other: {"zh-CN": "从时区换算不出大区", "en-US": "The region could not be worked out from the time zone"},
            },
        }),
        daysSinceLast: valueField({
            tier: "anonymous",
            required: true,
            description: {
                "zh-CN": "距离上一次成功发出每日上报过了几天，1 到 28 天时发确切的天数。用来在不带任何安装标识的情况下估算每天、每周有多少人在用。",
                "en-US": "How many days have passed since the last daily report was sent successfully, as an exact number from 1 to 28. Used to estimate how many people use the app each day and week without any installation identifier.",
            },
            schema: Type.Union([Type.Literal("first"), Type.Integer({minimum: 1, maximum: 28}), Type.Literal("more")]),
            values: {
                first: {"zh-CN": "这是第一份每日上报", "en-US": "This is the first daily report"},
                more: {"zh-CN": "超过 28 天", "en-US": "More than 28 days"},
            },
        }),
        installWeek: valueField({
            tier: "anonymous",
            required: true,
            description: {
                "zh-CN": "应用是在哪一周安装的（ISO 周，例如 2026-W48），安装满 12 周后不再发具体的周。用来看新用户之后还在不在用。服务端只收它的日期所在周往前 13 周到往后 1 周之间的周，之外的整份不收。",
                "en-US": "The week the app was installed (an ISO week, such as 2026-W48); after 12 weeks the exact week is no longer sent. Used to see whether new users keep using the app. The server only accepts weeks from 13 weeks before to 1 week after its current week and rejects the whole report otherwise.",
            },
            // 这里只管写法；“服务端日所在周往前 13 周到往后 1 周”要服务端的日期，是服务端的规则（协议字段表），不进 schema。
            schema: Type.Union([Type.String({pattern: "^\\d{4}-W(0[1-9]|[1-4]\\d|5[0-3])$"}), Type.Literal("older")]),
            values: {
                older: {"zh-CN": "安装已满 12 周", "en-US": "Installed 12 or more weeks ago"},
            },
        }),
        usageEnabled: valueField({
            tier: "anonymous",
            required: true,
            description: {
                "zh-CN": "“使用统计”的开关是否开着。用来知道使用统计里的数代表多大比例的用户。",
                "en-US": "Whether the \"Usage statistics\" switch is on. Used to know what share of users the usage statistics represent.",
            },
            schema: Type.Boolean(),
        }),
        noticeSeen: enumField({
            tier: "anonymous",
            required: true,
            description: {"zh-CN": "收集说明是在哪里显示给你的。用来了解说明有没有被看到。", "en-US": "Where the notice about data collection was shown to you. Used to understand whether the notice gets seen."},
            values: {
                wizard: {"zh-CN": "首次启动的向导", "en-US": "The first-run setup wizard"},
                workbench: {"zh-CN": "工作台里的提示", "en-US": "A notice in the workbench"},
                settings: {"zh-CN": "设置页", "en-US": "The settings page"},
            },
        }),
    },
    heartbeat: {appVersion, form},
    event: {appVersion, form},
});

/** 按版本从旧到新排列；`index.ts` 由它建版本表。 */
export const ANONYMOUS_VERSIONS: readonly AnonymousManifest[] = [ANONYMOUS_V1];
