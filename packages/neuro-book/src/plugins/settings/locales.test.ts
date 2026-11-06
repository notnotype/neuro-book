/**
 * `nbook.settings` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 第一条防止迁移改错文字：`LEGACY` 是迁移前（提交 e1abcc55a）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同；数量键的各复数形都与
 * 旧文字相同，英文的单数形另列在 `ENGLISH_ONE`。以后有意改文字时，同一次改动里同步改这张表。
 *
 * 第二条核对共享前端组件的键表：`ui/settings/text.ts` 手写了它们用到的键，这里确认每个键都在源语言目录里、且不多不少。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {SETTINGS_UI_KEYS} from "nbook/ui/settings/text";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {settingsCatalogs} from "./web/text";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "settingsSections.nbook.appearance.title": {"zh-CN": "外观", "en-US": "Appearance"},
    "settingsSections.nbook.appearance.description": {"zh-CN": "界面的主题、明暗与语言", "en-US": "Theme, appearance and language of the interface"},
    "settingsSections.nbook.appearance.groups.ui.title": {"zh-CN": "界面", "en-US": "Interface"},
    "settingsSections.nbook.appearance.groups.language.title": {"zh-CN": "语言", "en-US": "Language"},
    "settings.locale.title": {"zh-CN": "界面语言", "en-US": "Display Language"},
    "switch.current": {"zh-CN": "当前", "en-US": "current"},
    "switch.placeholder": {"zh-CN": "选中后立即生效", "en-US": "Takes effect immediately"},
    "switch.failed": {"zh-CN": "配置写入失败（{code}）：{detail}", "en-US": "Settings write failed ({code}): {detail}"},
    "commands.switch-locale.title": {"zh-CN": "切换界面语言", "en-US": "Change Display Language"},
    "commands.category": {"zh-CN": "设置", "en-US": "Settings"},
    "commands.open.title": {"zh-CN": "打开设置", "en-US": "Open Settings"},
    "commands.toggle.title": {"zh-CN": "打开或关闭设置", "en-US": "Toggle Settings"},
    "state.windowOpen.reason": {"zh-CN": "设置窗口没有打开", "en-US": "The settings window is not open"},
    "activityItems.nbook.settings.title": {"zh-CN": "设置", "en-US": "Settings"},
    "model.otherTitle": {"zh-CN": "插件设置", "en-US": "Plugin Settings"},
    "model.otherDescription": {"zh-CN": "未提供独立分区的插件设置", "en-US": "Settings from plugins that have no section of their own"},
    "model.userOnlySection": {"zh-CN": "这个分区的设置仅可在用户设置中修改", "en-US": "Settings in this section can only be changed in your settings"},
    "model.projectOnlySection": {"zh-CN": "这个分区的设置仅可在本作品中设置", "en-US": "Settings in this section can only be set for a book"},
    "model.emptySection": {"zh-CN": "这个分区还没有设置项", "en-US": "This section has no settings yet"},
    "model.unknownSection": {"zh-CN": "设置里没有分区 {section}", "en-US": "There is no settings section {section}"},
    "model.noProject": {"zh-CN": "这个窗口没有打开作品，没有本作品的设置", "en-US": "No book is open in this window, so there are no book settings"},
    "model.notSavedTitle": {"zh-CN": "设置没有保存", "en-US": "Setting not saved"},
    "model.unknownTitle": {"zh-CN": "设置可能没有保存", "en-US": "Setting may not be saved"},
    "model.notSaved": {"zh-CN": "{title}：{reason}", "en-US": "{title}: {reason}"},
    "model.searchTitle": {"zh-CN": "搜索结果", "en-US": "Search Results"},
    "model.fileTitle": {"zh-CN": "设置文件", "en-US": "Settings File"},
    "model.fileDescription": {"zh-CN": "直接编辑这一层的设置文件（JSON，可以写注释）", "en-US": "Edit this layer's settings file directly (JSON with comments)"},
    "model.fileKeyword": {"zh-CN": "settings.json", "en-US": "settings.json"},
    "window.title": {"zh-CN": "设置", "en-US": "Settings"},
    "window.close": {"zh-CN": "关闭", "en-US": "Close"},
    "window.nav": {"zh-CN": "设置分区", "en-US": "Settings sections"},
    "window.tabs": {"zh-CN": "设置的范围", "en-US": "Settings scope"},
    "window.user": {"zh-CN": "用户", "en-US": "User"},
    "window.project": {"zh-CN": "本作品", "en-US": "This Book"},
    "window.invalid": {"zh-CN": "设置文件格式有误", "en-US": "Settings file has errors"},
    "window.openAction": {"zh-CN": "打开", "en-US": "Open"},
    "window.invalidAt": {"zh-CN": "第 {line} 行第 {column} 列：{reason}", "en-US": "Line {line}, column {column}: {reason}"},
    "window.cannotSave": {"zh-CN": "修复前，这一层的设置无法保存", "en-US": "Settings on this layer can't be saved until it is fixed"},
    "window.fixAt": {"zh-CN": "第 {line} 行第 {column} 列：{reason}，改好后保存", "en-US": "Line {line}, column {column}: {reason}. Save once it's fixed"},
    "window.fixHere": {"zh-CN": "{reason}，改好后保存", "en-US": "{reason}. Save once it's fixed"},
    "window.unavailable": {"zh-CN": "暂时无法连接，无法保存", "en-US": "Temporarily unreachable; can't save"},
    "window.empty": {"zh-CN": "没有可以显示的设置", "en-US": "There are no settings to show"},
    "window.search": {"zh-CN": "搜索设置", "en-US": "Search settings"},
    "window.clearSearch": {"zh-CN": "清空搜索", "en-US": "Clear search"},
    "window.noResults": {"zh-CN": "没有找到设置", "en-US": "No settings found"},
    "window.pages": {"zh-CN": "页面", "en-US": "Pages"},
    "window.openPage": {"zh-CN": "打开", "en-US": "Open"},
    "window.openHit": {"zh-CN": "打开：{title}", "en-US": "Open: {title}"},
    "window.back": {"zh-CN": "返回 {title}", "en-US": "Back to {title}"},
    "window.results": {"zh-CN": "{settings} 个设置、{pages} 个页面", "en-US": "{settings} settings, {pages} pages"},
    "window.groups.app": {"zh-CN": "通用", "en-US": "General"},
    "window.groups.ai": {"zh-CN": "写作助手", "en-US": "Writing assistant"},
    "window.groups.plugins": {"zh-CN": "扩展", "en-US": "Extensions"},
    "window.leave.title": {"zh-CN": "放弃未保存的更改？", "en-US": "Discard unsaved changes?"},
    "window.leave.description": {"zh-CN": "“{title}”有未保存的更改。离开此页面后，这些更改将会丢失。", "en-US": "“{title}” has unsaved changes. They will be lost if you leave this page."},
    "window.leave.discard": {"zh-CN": "放弃", "en-US": "Discard"},
    "window.leave.keepEditing": {"zh-CN": "继续编辑", "en-US": "Keep Editing"},
    "file.label": {"zh-CN": "设置文件（{layer}）", "en-US": "Settings file ({layer})"},
    "file.user": {"zh-CN": "用户", "en-US": "User"},
    "file.project": {"zh-CN": "本作品", "en-US": "This Book"},
    "file.tabKey": {"zh-CN": "插入缩进", "en-US": "inserts an indent"},
    "file.escThen": {"zh-CN": "后", "en-US": "then"},
    "file.escTabKey": {"zh-CN": "移出编辑区", "en-US": "leaves the editor"},
    "file.saveKey": {"zh-CN": "保存", "en-US": "saves"},
    "file.loading": {"zh-CN": "正在读取设置文件", "en-US": "Reading the settings file"},
    "file.readFailed": {"zh-CN": "无法读取设置文件：{detail}", "en-US": "Could not read the settings file: {detail}"},
    "file.reread": {"zh-CN": "重新读取", "en-US": "Reload"},
    "file.saveAnyway": {"zh-CN": "仍然保存", "en-US": "Save Anyway"},
    "file.changedElsewhere": {"zh-CN": "文件已在别处被修改。“重新读取”会放弃这里的更改，“仍然保存”会覆盖别处的修改。", "en-US": "The file was changed elsewhere. Reload discards your changes here; Save Anyway overwrites the other changes."},
    "file.conflict": {"zh-CN": "未保存：文件已在别处被修改。“重新读取”会放弃这里的更改，“仍然保存”会覆盖别处的修改。", "en-US": "Not saved: the file was changed elsewhere. Reload discards your changes here; Save Anyway overwrites the other changes."},
    "file.invalidText": {"zh-CN": "未保存：第 {line} 行第 {column} 列：{detail}", "en-US": "Not saved: line {line}, column {column}: {detail}"},
    "file.failed": {"zh-CN": "未保存：{detail}", "en-US": "Not saved: {detail}"},
    "list.excludedUser": {"zh-CN": "{titles}仅可在用户设置中修改", "en-US": "{titles}: can only be changed in user settings"},
    "list.excludedProject": {"zh-CN": "{titles}仅可在本作品中设置", "en-US": "{titles}: can only be set for a book"},
    "list.notSaved": {"zh-CN": "未保存：{reason}", "en-US": "Not saved: {reason}"},
    "list.separator": {"zh-CN": "、", "en-US": ", "},
    // 下面四条是选项提供者不可用的原因，晚于上面的迁移：抄自提交 452ae72bf 的 `web/choices.ts`。
    "choices.missing": {"zh-CN": "无法加载选项：没有选项提供者 {id}", "en-US": "Can't load options: there is no option provider {id}"},
    "choices.unavailable": {"zh-CN": "无法加载选项：{reason}", "en-US": "Can't load options: {reason}"},
    "choices.stopped": {"zh-CN": "无法加载选项：插件 {plugin} 已停止", "en-US": "Can't load options: plugin {plugin} has stopped"},
    "choices.notActivatable": {"zh-CN": "无法加载选项：插件没有声明打开设置时提供选项：{reason}", "en-US": "Can't load options: the plugin does not provide options when settings open: {reason}"},
    "pageFrame.declared": {"zh-CN": "正在等待这个分区所属的插件启动", "en-US": "Waiting for this section's plugin to start"},
    "pageFrame.blocked": {"zh-CN": "这个分区所属的插件无法启动：{reason}", "en-US": "This section's plugin cannot start: {reason}"},
    "pageFrame.failed": {"zh-CN": "这个分区所属的插件启动失败：{reason}", "en-US": "This section's plugin failed to start: {reason}"},
    "pageFrame.stopped": {"zh-CN": "这个分区所属的插件已停止（{reason}）", "en-US": "This section's plugin stopped ({reason})"},
    "pageFrame.notActivatable": {"zh-CN": "插件没有声明打开分区时激活：{reason}", "en-US": "The plugin does not activate when this section opens: {reason}"},
    "pageFrame.loading": {"zh-CN": "正在加载这个分区", "en-US": "Loading this section"},
    "pageFrame.loadFailed": {"zh-CN": "这个分区加载失败：{reason}", "en-US": "This section failed to load: {reason}"},
    "pageFrame.renderFailed": {"zh-CN": "这个分区出错：{reason}", "en-US": "This section crashed: {reason}"},
    "pageFrame.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "pageFrame.reload": {"zh-CN": "重新加载", "en-US": "Reload"},
    "row.reset": {"zh-CN": "恢复默认", "en-US": "Reset to Default"},
    "row.inherited": {"zh-CN": "来自用户设置", "en-US": "From your settings"},
    "row.remove": {"zh-CN": "移除本作品的设置", "en-US": "Remove Book Setting"},
    "row.modified": {"zh-CN": "已修改", "en-US": "Modified"},
    "row.readOnly": {"zh-CN": "只读", "en-US": "Read-only"},
    "row.overridden": {"zh-CN": "《{title}》已单独设为{value}，此处的更改在该作品中不生效", "en-US": "“{title}” uses {value}; changes here don't apply to that book"},
    "row.overriddenUntitled": {"zh-CN": "本作品已单独设为{value}，此处的更改在该作品中不生效", "en-US": "This book uses {value}; changes here don't apply to it"},
    "row.userOnly": {"zh-CN": "仅可在用户设置中修改", "en-US": "Can only be changed in user settings"},
    "row.projectOnly": {"zh-CN": "仅可在本作品中设置", "en-US": "Can only be set for a book"},
    "pageList.back": {"zh-CN": "返回", "en-US": "Back"},
    "pageList.modified": {"zh-CN": "有改动", "en-US": "Modified"},
    "saveBar.save": {"zh-CN": "保存", "en-US": "Save"},
    "saveBar.discard": {"zh-CN": "放弃更改", "en-US": "Discard Changes"},
    "saveBar.unsaved": {"zh-CN": "有未保存的更改", "en-US": "Unsaved changes"},
    "value.on": {"zh-CN": "开", "en-US": "On"},
    "value.off": {"zh-CN": "关", "en-US": "Off"},
    "value.empty": {"zh-CN": "（空）", "en-US": "(empty)"},
    "value.items": {"zh-CN": "{count} 项", "en-US": "{count} items"},
    "applies.next-run": {"zh-CN": "下次运行生效", "en-US": "Applies on next run"},
    "applies.next-session": {"zh-CN": "下次会话生效", "en-US": "Applies to the next session"},
    "applies.restart": {"zh-CN": "重启后生效", "en-US": "Applies after restart"},
    "writeFailure.layerInvalid": {"zh-CN": "设置文件有错误，修好之后才能保存", "en-US": "the settings file has errors; fix it first"},
    "writeFailure.writeFailed": {"zh-CN": "写不进设置文件（{detail}）", "en-US": "could not write the settings file ({detail})"},
    "writeFailure.unavailable": {"zh-CN": "暂时连不上，没有保存", "en-US": "temporarily unreachable; nothing was saved"},
    "writeFailure.invalidValue": {"zh-CN": "这个值不能用（{detail}）", "en-US": "this value cannot be used ({detail})"},
    "writeFailure.unknownOutcome": {"zh-CN": "可能没有保存，以设置文件为准", "en-US": "it may not have been saved; the settings file is authoritative"},
    "writeFailure.conflict": {"zh-CN": "设置文件在别处改过了", "en-US": "the settings file was changed elsewhere"},
    "writeFailure.other": {"zh-CN": "{code}：{detail}", "en-US": "{code}: {detail}"},
};

/**
 * 数量键英文的单数形（`_one`）：旧英文不分单复数（`{count} items`），迁移时两形抄成一样；w00028 t03 审查第 9 条改成正确的
 * 单数，这里逐字列出。单复数写法本来就相同的键英文只写不带后缀的键，不在这里。
 */
const ENGLISH_ONE: Readonly<Record<string, string>> = {
    "value.items_one": "{count} item",
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 复数形 `<键>_<类别>` 归到 `<键>`。 */
const baseKey = (key: string): string => key.replace(/_(?:zero|one|two|few|many|other)$/u, "");

describe("nbook.settings 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
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
        expect(flatZh.filter((candidate) => baseKey(candidate) === "value.items")).toEqual(["value.items_other"]);
        expect(flatEn.filter((candidate) => baseKey(candidate) === "value.items")).toEqual(["value.items_one", "value.items_other"]);
    });

    it("源语言是中文，两种语言都登记给宿主", () => {
        expect(settingsCatalogs.source).toBe("zh-CN");
        expect(Object.keys(settingsCatalogs.catalogs).sort()).toEqual(["en-US", "zh-CN"]);
    });

    it("共享前端组件的键表：每个键都在源语言目录里，且 row、pageList、saveBar、value、applies、writeFailure 下的键都在表里", () => {
        const present = new Set(Object.keys(flattenCatalog(zhCN)).map(baseKey));
        for (const key of SETTINGS_UI_KEYS) expect({key, present: present.has(key)}).toEqual({key, present: true});
        const owned = [...present].filter((key) => /^(?:row|pageList|saveBar|value|applies|writeFailure)\./u.test(key)).sort();
        expect(owned).toEqual([...SETTINGS_UI_KEYS].sort());
    });
});
