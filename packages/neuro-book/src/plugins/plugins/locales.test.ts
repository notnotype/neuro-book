/**
 * `nbook.plugins` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 第一条防止迁移改错文字：`LEGACY` 是迁移前（提交 8dfda688b）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同；数量键的各复数形都与
 * 旧文字相同，英文的单数形另列在 `ENGLISH_ONE`（三个数量键的英文复数形同时从 `(s)` 改成了正确的复数）。以后有意改文字时，
 * 同一次改动里同步改这张表。`builtin.*`（内置插件的名称与说明）不在这张表里，它们的逐字对照在 `shared/builtin-names.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {installFailureDetails, manageFailureDetails} from "nbook/plugin-platform/shared/types";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "settingsPages.installed.title": {"zh-CN": "插件", "en-US": "Plugins"},
    "settingsPages.installed.description": {"zh-CN": "安装与管理第三方插件", "en-US": "Install and manage third-party plugins"},
    "page.restartNote": {"zh-CN": "安装、卸载、升级、启用与禁用在下一次启动后生效。", "en-US": "Installing, uninstalling, upgrading, enabling and disabling take effect the next time NeuroBook starts."},
    "page.pendingNote": {"zh-CN": "有待生效的变化，重启 NeuroBook 后生效。", "en-US": "Some changes are pending. Restart NeuroBook to apply them."},
    "page.safeMode": {"zh-CN": "安全模式：第三方插件没有加载，可以在这里禁用或卸载它们。", "en-US": "Safe mode: third-party plugins are not loaded. You can disable or uninstall them here."},
    "page.problemsSnapshot": {"zh-CN": "服务端的状态是打开这一页时的；本窗口的随时更新。", "en-US": "Server status is as of opening this page; this window's status updates live."},
    "page.loading": {"zh-CN": "正在读取插件…", "en-US": "Loading plugins…"},
    "page.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "install.pathLabel": {"zh-CN": "服务端上的插件文件夹", "en-US": "Plugin folder on the server"},
    "install.pathPlaceholder": {"zh-CN": "/home/me/plugins/hello", "en-US": "/home/me/plugins/hello"},
    "install.start": {"zh-CN": "安装…", "en-US": "Install…"},
    "groups.thirdParty": {"zh-CN": "第三方插件", "en-US": "Third-party plugins"},
    "groups.builtin": {"zh-CN": "内置插件", "en-US": "Built-in plugins"},
    "groups.noThirdParty": {"zh-CN": "还没有安装第三方插件。", "en-US": "No third-party plugins installed."},
    "row.builtin": {"zh-CN": "内置", "en-US": "Built-in"},
    "row.toggle": {"zh-CN": "启用 {id}", "en-US": "Enable {id}"},
    "row.uninstall": {"zh-CN": "卸载", "en-US": "Uninstall"},
    "row.uninstallNamed": {"zh-CN": "卸载 {id}", "en-US": "Uninstall {id}"},
    "row.entryProblems": {"zh-CN": "{count} 个入口没有运行", "en-US": "{count} entry points not running"},
    "row.rejectedProblems": {"zh-CN": "{count} 项贡献被拒", "en-US": "{count} contributions rejected"},
    "row.catalogProblems": {"zh-CN": "{count} 种语言的文字没有取到", "en-US": "Text missing for {count} languages"},
    "row.pending.install": {"zh-CN": "重启后安装", "en-US": "Installs on restart"},
    "row.pending.uninstall": {"zh-CN": "重启后卸载", "en-US": "Uninstalls on restart"},
    "row.pending.enable": {"zh-CN": "重启后启用", "en-US": "Enabled on restart"},
    "row.pending.disable": {"zh-CN": "重启后禁用", "en-US": "Disabled on restart"},
    "row.pending.upgrade": {"zh-CN": "重启后升级到 {version}", "en-US": "Upgrade to {version} on restart"},
    "row.pending.downgrade": {"zh-CN": "重启后降级到 {version}", "en-US": "Downgrade to {version} on restart"},
    "row.notLoaded.manifest-invalid": {"zh-CN": "清单无效", "en-US": "Invalid manifest"},
    "row.notLoaded.entry-missing": {"zh-CN": "入口文件缺失", "en-US": "Entry file missing"},
    "row.notLoaded.unreadable": {"zh-CN": "安装目录读不了", "en-US": "Install directory unreadable"},
    "row.notLoaded.incompatible-engine": {"zh-CN": "不兼容", "en-US": "Incompatible"},
    "row.notLoaded.safe-mode": {"zh-CN": "安全模式未加载", "en-US": "Not loaded in safe mode"},
    "problems.entryFailed": {"zh-CN": "入口 {entry}（{location}）激活失败：{reason}", "en-US": "Entry {entry} ({location}) failed to activate: {reason}"},
    "problems.entryBlocked": {"zh-CN": "入口 {entry}（{location}）受阻：{reason}", "en-US": "Entry {entry} ({location}) is blocked: {reason}"},
    "problems.contributionRejected": {"zh-CN": "{capability} 的 {id} 被拒：{reason}", "en-US": "{id} for {capability} was rejected: {reason}"},
    "problems.catalogUnavailable": {"zh-CN": "{locale} 的文字没有取到：{reason}", "en-US": "Text for {locale} could not be loaded: {reason}"},
    "problems.withDetail": {"zh-CN": "{reason}（{detail}）", "en-US": "{reason} ({detail})"},
    "problems.blockedReasons.missing-service": {"zh-CN": "需要的服务 {key} 没有提供", "en-US": "the service {key} it needs is not provided"},
    "problems.blockedReasons.location-mismatch": {"zh-CN": "需要的服务 {key} 不在这个位置提供", "en-US": "the service {key} it needs is not provided at this location"},
    "problems.blockedReasons.provider-blocked": {"zh-CN": "提供 {key} 的插件受阻", "en-US": "the plugin providing {key} is blocked"},
    "problems.blockedReasons.provider-failed": {"zh-CN": "提供 {key} 的插件激活失败", "en-US": "the plugin providing {key} failed to activate"},
    "problems.blockedReasons.dependency-cycle": {"zh-CN": "依赖成环（{key}）", "en-US": "its dependencies form a cycle ({key})"},
    "problems.blockedReasons.version-mismatch": {"zh-CN": "{key} 的版本不在要求的范围里", "en-US": "the version of {key} is outside the required range"},
    "problems.catalogReasons.not-found": {"zh-CN": "服务端没有这份目录", "en-US": "the server does not have this catalog"},
    "problems.catalogReasons.invalid": {"zh-CN": "目录内容不合规则", "en-US": "the catalog content is invalid"},
    "problems.catalogReasons.fetch-failed": {"zh-CN": "读取失败", "en-US": "loading failed"},
    "problems.rejectedReasons.invalid-declaration": {"zh-CN": "声明不合规则", "en-US": "the declaration is invalid"},
    "problems.rejectedReasons.implementation-required": {"zh-CN": "这个贡献点要实现，要写在入口里", "en-US": "this contribution point needs an implementation; declare it in an entry"},
    "problems.rejectedReasons.implementation-not-accepted": {"zh-CN": "这个贡献点只收声明，不收实现", "en-US": "this contribution point takes declarations only"},
    "problems.rejectedReasons.duplicate-contribution": {"zh-CN": "别的插件用了同一个 id", "en-US": "another plugin uses the same id"},
    "preview.install.title": {"zh-CN": "安装插件", "en-US": "Install plugin"},
    "preview.install.confirm": {"zh-CN": "安装", "en-US": "Install"},
    "preview.upgrade.title": {"zh-CN": "升级插件", "en-US": "Upgrade plugin"},
    "preview.upgrade.confirm": {"zh-CN": "升级", "en-US": "Upgrade"},
    "preview.downgrade.title": {"zh-CN": "降级插件", "en-US": "Downgrade plugin"},
    "preview.downgrade.confirm": {"zh-CN": "降级", "en-US": "Downgrade"},
    "preview.downgradeWarning": {"zh-CN": "降级后插件可能读到新版本已迁移过的数据。", "en-US": "After a downgrade the plugin may read data already migrated by the newer version."},
    "preview.blockedTitle": {"zh-CN": "重启后这些插件的部分功能将不可用：", "en-US": "After the restart, parts of these plugins will be unavailable:"},
    "preview.blockedReasons.version-mismatch": {"zh-CN": "{plugin}（{entries}）：要求版本 {range}", "en-US": "{plugin} ({entries}): requires version {range}"},
    "preview.blockedReasons.missing-service": {"zh-CN": "{plugin}（{entries}）：需要的服务 {service} 不再提供", "en-US": "{plugin} ({entries}): the service {service} it needs will no longer be provided"},
    "preview.blockedReasons.dependency-cycle": {"zh-CN": "{plugin}（{entries}）：依赖成环", "en-US": "{plugin} ({entries}): its dependencies form a cycle"},
    "preview.blockedReasons.provider-blocked": {"zh-CN": "{plugin}（{entries}）：依赖的插件不可用", "en-US": "{plugin} ({entries}): a plugin it depends on will be unavailable"},
    "preview.unchecked": {"zh-CN": "这些已安装插件的清单读不了，没有核对：{plugins}", "en-US": "These installed plugins could not be checked: {plugins}"},
    "preview.trust": {"zh-CN": "插件完全受信任：安装后它可以访问全部作品、服务器与本机资源。只安装你信任的来源。", "en-US": "Plugins are fully trusted: once installed, a plugin can access all books, the server and local resources. Only install plugins you trust."},
    "uninstall.title": {"zh-CN": "卸载插件", "en-US": "Uninstall plugin"},
    "uninstall.body": {"zh-CN": "卸载 {id}？重启后删除插件的安装目录，配置与私有数据保留。确认后到重启之前不能撤回。", "en-US": "Uninstall {id}? Its install folder is removed after restart; its settings and private data are kept. This cannot be undone before the restart."},
    "dialog.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "errors.manifest-invalid": {"zh-CN": "插件的清单无效", "en-US": "The plugin manifest is invalid"},
    "errors.catalog-invalid": {"zh-CN": "插件的消息目录无效", "en-US": "The plugin's message catalogs are invalid"},
    "errors.incompatible-engine": {"zh-CN": "插件与当前版本的 NeuroBook 不兼容", "en-US": "The plugin is not compatible with this version of NeuroBook"},
    "errors.already-installed": {"zh-CN": "这个版本已经安装，或已在等待重启后切换", "en-US": "This version is already installed or waiting for the restart"},
    "errors.uninstall-pending": {"zh-CN": "插件正在卸载，重启后再操作", "en-US": "The plugin is being uninstalled; restart first"},
    "errors.path-rejected": {"zh-CN": "这个路径不能用", "en-US": "This path cannot be used"},
    "errors.entry-missing": {"zh-CN": "插件缺少入口文件", "en-US": "The plugin is missing entry files"},
    "errors.copy-failed": {"zh-CN": "复制插件文件失败", "en-US": "Copying the plugin files failed"},
    "errors.not-installed": {"zh-CN": "这个插件已经不在了", "en-US": "This plugin is no longer installed"},
    "errors.builtin-fixed": {"zh-CN": "内置插件不能这样操作", "en-US": "Built-in plugins cannot be changed"},
    "errors.registry-failed": {"zh-CN": "读写插件登记表失败", "en-US": "Reading or writing the plugin registry failed"},
    "remoteErrors.unavailable": {"zh-CN": "连不上服务端", "en-US": "The server is unreachable"},
    "remoteErrors.timeout": {"zh-CN": "服务端没有及时答复", "en-US": "The server did not answer in time"},
    "remoteErrors.unknown-outcome": {"zh-CN": "不知道操作有没有完成，已重新读取列表", "en-US": "It is unknown whether the operation completed; the list was reloaded"},
    "failures.unknown": {"zh-CN": "操作没有完成", "en-US": "The operation did not complete"},
};

/**
 * 数量键英文的单数形（`_one`）：旧英文不分单复数（`{count} items`），迁移时两形抄成一样；w00028 t03 审查第 9 条改成正确的
 * 单数，这里逐字列出。单复数写法本来就相同的键英文只写不带后缀的键，不在这里。
 */
const ENGLISH_ONE: Readonly<Record<string, string>> = {
    "row.entryProblems_one": "{count} entry point not running",
    "row.rejectedProblems_one": "{count} contribution rejected",
    "row.catalogProblems_one": "Text missing for {count} language",
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 复数形 `<键>_<类别>` 归到 `<键>`。 */
const baseKey = (key: string): string => key.replace(/_(?:zero|one|two|few|many|other)$/u, "");

describe("nbook.plugins 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = Object.fromEntries(Object.entries(flattenCatalog(catalog)).filter(([key]) => !key.startsWith("builtin.")));
            expect({locale, keys: [...new Set(Object.keys(flat).map(baseKey))].sort()}).toEqual({locale, keys: Object.keys(LEGACY).sort()});
            for (const [key, value] of Object.entries(flat)) {
                const written = (locale === "en-US" ? ENGLISH_ONE[key] : undefined) ?? LEGACY[baseKey(key)]![locale as keyof typeof CATALOGS];
                const legacy = written.replace(/\{(\w+)\}/gu, "{{$1}}");
                expect({locale, key, value}).toEqual({locale, key, value: legacy});
            }
        }
    });

    it("数量键：中文有 _other，英文有 _one 与 _other", () => {
        const flatZh = Object.keys(flattenCatalog(zhCN));
        const flatEn = Object.keys(flattenCatalog(enUS));
        for (const key of ["row.entryProblems", "row.rejectedProblems", "row.catalogProblems"]) {
            expect(flatZh.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_other`]);
            expect(flatEn.filter((candidate) => baseKey(candidate) === key)).toEqual([`${key}_one`, `${key}_other`]);
        }
    });

    it("errors 下恰好是 nbook.plugins/registry 的全部业务失败码", () => {
        const codes = [...new Set([...Object.keys(installFailureDetails), ...Object.keys(manageFailureDetails)])].sort();
        expect(Object.keys(zhCN.errors).sort()).toEqual(codes);
    });
});
