/**
 * nb-agent-ui 自带的目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 防止迁移改错文字：`LEGACY` 是迁移前（提交 5343894f2 的 `src/messages.ts`）两张表的原样，占位符还是旧的 `{name}` 写法，
 * 英文带数量的是 `{one, other}`（`by` 指按哪个参数选）。目录里每个键（复数形归到不带后缀的键）都要在表里、表里每个键
 * 都要在目录里，值换成 `{{name}}` 后逐字相同。以后有意改文字时，同一次改动里同步改这张表。
 *
 * 仓库的目录检查（`scripts/ci/message-catalogs.ts`）只查 JSON 目录，这份 `.ts` 目录的键与占位符一致性由这里核对。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog, textRef} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE, NB_AGENT_UI_SOURCE_LOCALE} from "./locales";
import {agentRef} from "./text";

type LegacyEnglish = string | {readonly by?: string; readonly one: string; readonly other: string};

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": LegacyEnglish}>> = {
    "header.untitled": {"zh-CN": "未命名会话", "en-US": "Untitled conversation"},
    "header.noSession": {"zh-CN": "未选择会话", "en-US": "No conversation selected"},
    "header.more": {"zh-CN": "更多操作", "en-US": "More actions"},
    "header.rawView": {"zh-CN": "原始视图", "en-US": "Raw view"},
    "header.turnsView": {"zh-CN": "分轮视图", "en-US": "Turn view"},
    "stream.empty": {"zh-CN": "还没有消息", "en-US": "No messages yet"},
    "stream.loading": {"zh-CN": "正在加载会话", "en-US": "Loading the conversation"},
    "stream.phraseSeparator": {"zh-CN": "，", "en-US": ", "},
    "stream.jumpToLatest": {"zh-CN": "回到最新", "en-US": "Jump to latest"},
    "history.more": {"zh-CN": "更早的内容", "en-US": "Earlier content"},
    "history.loading": {"zh-CN": "正在加载更早的内容", "en-US": "Loading earlier content"},
    "history.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "sessions.title": {"zh-CN": "会话", "en-US": "Conversations"},
    "sessions.create": {"zh-CN": "新建会话", "en-US": "New conversation"},
    "sessions.loading": {"zh-CN": "正在加载会话", "en-US": "Loading conversations"},
    "sessions.empty": {"zh-CN": "还没有会话", "en-US": "No conversations yet"},
    "sessions.error": {"zh-CN": "会话列表没取到", "en-US": "Couldn't load conversations"},
    "sessions.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "sessions.running": {"zh-CN": "运行中", "en-US": "Running"},
    "sessions.interrupted": {"zh-CN": "已中断", "en-US": "Interrupted"},
    "sessions.failed": {"zh-CN": "出错", "en-US": "Failed"},
    "role.user": {"zh-CN": "You", "en-US": "You"},
    "role.assistant": {"zh-CN": "Assistant", "en-US": "Assistant"},
    "turn.running": {"zh-CN": "运行中", "en-US": "Running"},
    "turn.waiting": {"zh-CN": "等待回答", "en-US": "Waiting for your answer"},
    "turn.error": {"zh-CN": "出错", "en-US": "Failed"},
    "turn.stopped": {"zh-CN": "已停止", "en-US": "Stopped"},
    "metrics.tokens": {"zh-CN": "{value} tokens", "en-US": "{value} tokens"},
    "process.fallback": {"zh-CN": "过程", "en-US": "Process"},
    "process.thinking": {"zh-CN": "思考", "en-US": "Thinking"},
    "process.actions": {"zh-CN": "{count} 次操作", "en-US": {"one":"{count} action","other":"{count} actions"}},
    "process.requests": {"zh-CN": "{count} 次请求", "en-US": {"one":"{count} request","other":"{count} requests"}},
    "process.others": {"zh-CN": "另有 {count} 次操作", "en-US": {"one":"{count} other action","other":"{count} other actions"}},
    "process.failed": {"zh-CN": "{count} 次失败", "en-US": "{count} failed"},
    "process.files.read": {"zh-CN": "读了 {count} 个文件", "en-US": {"one":"Read {count} file","other":"Read {count} files"}},
    "process.files.changed": {"zh-CN": "改了 {count} 个文件", "en-US": {"one":"Changed {count} file","other":"Changed {count} files"}},
    "process.files.readChanged": {"zh-CN": "读了 {read} 个文件，改了 {changed} 个", "en-US": {"by":"read","one":"Read {read} file, changed {changed}","other":"Read {read} files, changed {changed}"}},
    "usage.detail": {"zh-CN": "输入 {input} · 输出 {output} · 缓存读取 {cacheRead} · 缓存写入 {cacheWrite}", "en-US": "Input {input} · Output {output} · Cache read {cacheRead} · Cache write {cacheWrite}"},
    "task.created": {"zh-CN": "新建任务清单", "en-US": "New task list"},
    "task.updated": {"zh-CN": "更新任务清单", "en-US": "Task list updated"},
    "task.progress": {"zh-CN": "已完成 {done} / {total}", "en-US": "{done} of {total} done"},
    "task.showAll": {"zh-CN": "查看完整清单", "en-US": "Show full list"},
    "task.hideAll": {"zh-CN": "收起完整清单", "en-US": "Hide full list"},
    "task.status.pending": {"zh-CN": "待办", "en-US": "To do"},
    "task.status.in_progress": {"zh-CN": "进行中", "en-US": "In progress"},
    "task.status.completed": {"zh-CN": "已完成", "en-US": "Done"},
    "fileChanges.title": {"zh-CN": "改动了 {count} 个文件", "en-US": {"one":"Changed {count} file","other":"Changed {count} files"}},
    "fileChanges.showRest": {"zh-CN": "展开其余 {count} 个", "en-US": "Show {count} more"},
    "fileChanges.collapse": {"zh-CN": "收起", "en-US": "Show less"},
    "messageAction.copy": {"zh-CN": "复制", "en-US": "Copy"},
    "messageAction.edit": {"zh-CN": "编辑", "en-US": "Edit"},
    "messageAction.retry": {"zh-CN": "重新生成", "en-US": "Regenerate"},
    "messageAction.branchFrom": {"zh-CN": "从此处新开分支", "en-US": "Branch from here"},
    "messageAction.previousBranch": {"zh-CN": "上一个分支", "en-US": "Previous branch"},
    "messageAction.nextBranch": {"zh-CN": "下一个分支", "en-US": "Next branch"},
    "step.thinking": {"zh-CN": "思考", "en-US": "Thinking"},
    "step.steer": {"zh-CN": "补充说明", "en-US": "Follow-up note"},
    "tool.generic": {"zh-CN": "工具", "en-US": "Tool"},
    "tool.read": {"zh-CN": "读取", "en-US": "Read"},
    "tool.webSearch": {"zh-CN": "搜索", "en-US": "Search"},
    "tool.webFetch": {"zh-CN": "抓取网页", "en-US": "Fetch page"},
    "tool.list": {"zh-CN": "列出", "en-US": "List"},
    "tool.write": {"zh-CN": "写入", "en-US": "Write"},
    "tool.edit": {"zh-CN": "编辑", "en-US": "Edit"},
    "tool.applyPatch": {"zh-CN": "应用补丁", "en-US": "Apply patch"},
    "tool.requestUserInput": {"zh-CN": "提问", "en-US": "Ask"},
    "tool.switchMode": {"zh-CN": "切换模式", "en-US": "Switch mode"},
    "tool.task": {"zh-CN": "任务清单", "en-US": "Task list"},
    "tool.runWorkflow": {"zh-CN": "运行 Workflow", "en-US": "Run workflow"},
    "tool.bash": {"zh-CN": "运行命令", "en-US": "Run command"},
    "tool.sql": {"zh-CN": "执行 SQL", "en-US": "Run SQL"},
    "tool.agentCollaboration": {"zh-CN": "协作 Agent", "en-US": "Agent collaboration"},
    "toolGroup.generic": {"zh-CN": "调用了 {count} 次", "en-US": {"one":"{count} call","other":"{count} calls"}},
    "toolGroup.read": {"zh-CN": "读了 {count} 个文件", "en-US": {"one":"Read {count} file","other":"Read {count} files"}},
    "toolGroup.search": {"zh-CN": "搜索了 {count} 次", "en-US": {"one":"{count} search","other":"{count} searches"}},
    "toolGroup.fetch": {"zh-CN": "看了 {count} 个网页", "en-US": {"one":"Fetched {count} page","other":"Fetched {count} pages"}},
    "toolGroup.lookup": {"zh-CN": "查了 {count} 次", "en-US": {"one":"{count} lookup","other":"{count} lookups"}},
    "toolDetail.args": {"zh-CN": "参数 · {name}", "en-US": "Arguments · {name}"},
    "toolDetail.result": {"zh-CN": "结果", "en-US": "Result"},
    "toolDetail.details": {"zh-CN": "结构化结果", "en-US": "Structured result"},
    "toolDetail.command": {"zh-CN": "命令", "en-US": "Command"},
    "toolDetail.output": {"zh-CN": "输出", "en-US": "Output"},
    "toolDetail.pending": {"zh-CN": "还没有结果", "en-US": "No result yet"},
    "toolDetail.empty": {"zh-CN": "无内容", "en-US": "Empty"},
    "toolDetail.truncated": {"zh-CN": "只公开了部分内容", "en-US": "Only part of the content is available"},
    "user.sending": {"zh-CN": "发送中", "en-US": "Sending"},
    "user.previewOnly": {"zh-CN": "仅显示预览", "en-US": "Preview only"},
    "user.deliveryUnknown": {"zh-CN": "可能已发送，重新发送可能产生重复", "en-US": "May have been sent; sending again may create a duplicate"},
    "user.resend": {"zh-CN": "重新发送", "en-US": "Send again"},
    "user.dismiss": {"zh-CN": "移除", "en-US": "Remove"},
    "user.attachmentUnavailable": {"zh-CN": "不可用", "en-US": "Unavailable"},
    "raw.showJson": {"zh-CN": "查看 JSON", "en-US": "Show JSON"},
    "raw.hideJson": {"zh-CN": "收起 JSON", "en-US": "Hide JSON"},
    "composer.label": {"zh-CN": "消息输入框", "en-US": "Message input"},
    "composer.placeholder": {"zh-CN": "输入消息，回车发送", "en-US": "Type a message, Enter to send"},
    "composer.placeholderRunning": {"zh-CN": "回车补充说明，Ctrl+回车排队", "en-US": "Enter to add a note, Ctrl+Enter to queue"},
    "composer.placeholderRunningSteer": {"zh-CN": "回车补充说明", "en-US": "Enter to add a note"},
    "composer.placeholderRunningQueue": {"zh-CN": "回车排队，运行结束后发送", "en-US": "Enter to queue until the run ends"},
    "composer.placeholderRunningNone": {"zh-CN": "运行结束后才能发送消息", "en-US": "You can send messages once the run ends"},
    "composer.send": {"zh-CN": "发送", "en-US": "Send"},
    "composer.sendRunning": {"zh-CN": "补充说明", "en-US": "Add note"},
    "composer.sendQueued": {"zh-CN": "排队", "en-US": "Queue"},
    "composer.sendAfterRun": {"zh-CN": "运行结束后发送", "en-US": "Send after the run ends"},
    "composer.blockedUploading": {"zh-CN": "附件还在上传，上传完再发送", "en-US": "Attachments are still uploading"},
    "composer.blockedFailed": {"zh-CN": "有附件上传失败，重试或移除后再发送", "en-US": "An attachment failed to upload; retry or remove it first"},
    "composer.stop": {"zh-CN": "停止", "en-US": "Stop"},
    "composer.attach": {"zh-CN": "添加附件", "en-US": "Add attachment"},
    "composer.expand": {"zh-CN": "展开输入框", "en-US": "Expand input"},
    "composer.collapse": {"zh-CN": "收起输入框", "en-US": "Collapse input"},
    "composer.mode": {"zh-CN": "模式：{mode}（Shift+Tab 切换）", "en-US": "Mode: {mode} (Shift+Tab to switch)"},
    "composer.model.none": {"zh-CN": "未选择模型", "en-US": "No model selected"},
    "composer.model.noImages": {"zh-CN": "不支持图片", "en-US": "No image support"},
    "composer.model.thinking": {"zh-CN": "思考", "en-US": "Thinking"},
    "catalog.title": {"zh-CN": "添加模型", "en-US": "Add models"},
    "catalog.search": {"zh-CN": "搜模型：服务商/模型名，例如 deepseek、sonnet", "en-US": "Search provider/model, e.g. deepseek, sonnet"},
    "catalog.all": {"zh-CN": "全部", "en-US": "All"},
    "catalog.custom": {"zh-CN": "自定义", "en-US": "Custom"},
    "catalog.addProvider": {"zh-CN": "添加自定义服务商…", "en-US": "Add custom provider…"},
    "catalog.provider": {"zh-CN": "服务商", "en-US": "Provider"},
    "catalog.col.model": {"zh-CN": "模型", "en-US": "Model"},
    "catalog.col.api": {"zh-CN": "接口", "en-US": "API"},
    "catalog.col.context": {"zh-CN": "上下文", "en-US": "Context"},
    "catalog.col.reasoning": {"zh-CN": "推理", "en-US": "Reasoning"},
    "catalog.col.images": {"zh-CN": "图片", "en-US": "Images"},
    "catalog.col.price": {"zh-CN": "单价（每百万，入 / 出）", "en-US": "Price (per 1M, in / out)"},
    "catalog.priceUnknown": {"zh-CN": "未知", "en-US": "Unknown"},
    "catalog.added": {"zh-CN": "已添加", "en-US": "Added"},
    "catalog.more": {"zh-CN": "还有 {count} 个，继续输入缩小范围", "en-US": "{count} more — keep typing to narrow down"},
    "catalog.empty": {"zh-CN": "没有匹配的模型", "en-US": "No matching models"},
    "catalog.selected": {"zh-CN": "选中 {count} 个", "en-US": "{count} selected"},
    "catalog.confirm": {"zh-CN": "加入候选（{count}）", "en-US": "Add ({count})"},
    "catalog.cancel": {"zh-CN": "取消", "en-US": "Cancel"},
    "catalog.models": {"zh-CN": "{count} 个模型", "en-US": "{count} models"},
    "catalog.key.set": {"zh-CN": "{envs} 已设置", "en-US": "{envs} is set"},
    "catalog.key.missing": {"zh-CN": "{envs} 没有值，设好后可用", "en-US": "{envs} is not set; set it to use these models"},
    "catalog.key.none": {"zh-CN": "不用密钥", "en-US": "No key needed"},
    "catalog.locked.login": {"zh-CN": "要登录才能用；这里只认环境变量，用不了", "en-US": "Needs a login; only environment variables are used here"},
    "catalog.locked.loginEnv": {"zh-CN": "要登录才能用；也可以设 {envs}", "en-US": "Needs a login; or set {envs}"},
    "catalog.locked.unsupported": {"zh-CN": "用云厂商凭据链或目录里没有认证说明，这里用不了", "en-US": "Uses a cloud credential chain or has no auth info; not usable here"},
    "catalog.locked.count": {"zh-CN": "目录里有 {count} 个模型", "en-US": "{count} models in the catalog"},
    "catalog.envJoin": {"zh-CN": " 或 ", "en-US": " or "},
    "composer.model.manage": {"zh-CN": "管理模型…", "en-US": "Manage models…"},
    "composer.context": {"zh-CN": "上下文 {used} / {limit}（{percent}）", "en-US": "Context {used} / {limit} ({percent})"},
    "composer.thinking.off": {"zh-CN": "关闭", "en-US": "Off"},
    "composer.thinking.minimal": {"zh-CN": "极低", "en-US": "Minimal"},
    "composer.thinking.low": {"zh-CN": "低", "en-US": "Low"},
    "composer.thinking.medium": {"zh-CN": "中", "en-US": "Medium"},
    "composer.thinking.high": {"zh-CN": "高", "en-US": "High"},
    "composer.thinking.xhigh": {"zh-CN": "极高", "en-US": "Extra high"},
    "composer.thinking.max": {"zh-CN": "最大", "en-US": "Max"},
    "composer.reject.imageModel": {"zh-CN": "当前模型不支持图片，已忽略 {count} 张", "en-US": "The current model does not support images; ignored {count}"},
    "composer.reject.imageSession": {"zh-CN": "当前会话不能添加图片，已忽略 {count} 张", "en-US": "This session cannot take images; ignored {count}"},
    "composer.reject.file": {"zh-CN": "当前会话不能添加文件，已忽略 {count} 个", "en-US": "This session cannot take files; ignored {count}"},
    "composer.reject.dismiss": {"zh-CN": "关闭提示", "en-US": "Dismiss"},
    "composer.queued.label": {"zh-CN": "排队中的消息", "en-US": "Queued messages"},
    "composer.queued.steer": {"zh-CN": "补充说明", "en-US": "Note"},
    "composer.queued.followup": {"zh-CN": "排队", "en-US": "Queued"},
    "composer.queued.more": {"zh-CN": "还有 {count} 条", "en-US": "{count} more"},
    "composer.commandMenu.title": {"zh-CN": "命令", "en-US": "Commands"},
    "composer.commandMenu.empty": {"zh-CN": "没有匹配的命令", "en-US": "No matching command"},
    "composer.commandMenu.notAtStart": {"zh-CN": "命令只能写在正文开头", "en-US": "Commands go at the start of the message"},
    "command.new": {"zh-CN": "新建会话", "en-US": "Start a new session"},
    "command.plan": {"zh-CN": "切到规划模式", "en-US": "Switch to plan mode"},
    "command.mode": {"zh-CN": "切换 Agent 模式", "en-US": "Switch Agent mode"},
    "command.modeArgs": {"zh-CN": "模式名，省略时切到下一种", "en-US": "mode name; omit to cycle"},
    "command.model": {"zh-CN": "切换模型", "en-US": "Switch model"},
    "command.modelArgs": {"zh-CN": "模型", "en-US": "model"},
    "command.compact": {"zh-CN": "压缩当前会话的上下文", "en-US": "Compact this session's context"},
    "command.compactArgs": {"zh-CN": "补充要求，可省略", "en-US": "extra instructions, optional"},
    "command.rename": {"zh-CN": "重命名会话，之后自动摘要不再改标题", "en-US": "Rename the session; auto summary stops changing the title"},
    "command.renameArgs": {"zh-CN": "新标题", "en-US": "new title"},
    "command.summarize": {"zh-CN": "把标题交还给自动摘要，并立即重新生成", "en-US": "Hand the title back to auto summary and regenerate now"},
    "command.fork": {"zh-CN": "以同一个 Profile 另开一条会话", "en-US": "Start another session with the same Profile"},
    "command.clear": {"zh-CN": "清空当前会话视图，回到空历史", "en-US": "Clear the session view and return to empty history"},
    "imagePreview.close": {"zh-CN": "关闭", "en-US": "Close"},
    "imagePreview.downloadOriginal": {"zh-CN": "下载原图", "en-US": "Download Original"},
    "imagePreview.loadFailed": {"zh-CN": "原图加载失败", "en-US": "Original image failed to load"},
    "imagePreview.retry": {"zh-CN": "重试", "en-US": "Retry"},
    "imagePreview.image": {"zh-CN": "图片 #{number}", "en-US": "Image #{number}"},
    "imagePreview.loading": {"zh-CN": "正在加载原图", "en-US": "Loading the original image"},
    "harness.error.network": {"zh-CN": "网络连接出错，请稍后重试。", "en-US": "Network error. Try again later."},
    "harness.error.rateLimit": {"zh-CN": "模型服务请求太频繁，请稍后重试。", "en-US": "Too many requests to the model service. Try again later."},
    "harness.error.auth": {"zh-CN": "模型服务的密钥缺失或无效，请检查设置。", "en-US": "The model service key is missing or invalid. Check the settings."},
    "harness.error.quota": {"zh-CN": "模型服务的额度已用完。", "en-US": "The model service quota is used up."},
    "harness.error.contextOverflow": {"zh-CN": "对话太长，超出了模型能读的长度。", "en-US": "The conversation is longer than the model can read."},
    "harness.error.provider": {"zh-CN": "模型服务出错，请稍后重试。", "en-US": "The model service failed. Try again later."},
    "harness.error.local": {"zh-CN": "这次运行出错了。", "en-US": "This run failed."},
    "harness.compaction": {"zh-CN": "上下文已压缩", "en-US": "Context compacted"},
    "render.failed": {"zh-CN": "此内容无法显示", "en-US": "This content can't be shown"},
    "kernel.error.costLimit": {"zh-CN": "这个会话的费用到了上限，运行停了。调高上限后可以接着跑。", "en-US": "This session reached its cost limit, so the run stopped. Raise the limit to continue."},
    "kernel.error.toolCallLoop": {"zh-CN": "模型反复发起同样的工具调用，运行停了。", "en-US": "The model kept making the same tool call, so the run stopped."},
    "kernel.error.emptyReply": {"zh-CN": "模型连续几次什么都没有回，运行停了。", "en-US": "The model returned nothing several times in a row, so the run stopped."},
    "kernel.error.thinkingLoop": {"zh-CN": "模型的思考一直在重复，运行停了。", "en-US": "The model's thinking kept repeating, so the run stopped."},
    "kernel.error.firstEventTimeout": {"zh-CN": "模型服务一直没有开始回复，请稍后重试。", "en-US": "The model service never started replying. Please try again later."},
    "kernel.tool.deniedByUser": {"zh-CN": "你拒绝了", "en-US": "You denied this"},
    "kernel.tool.deniedByRule": {"zh-CN": "规则拒绝了", "en-US": "Denied by a rule"},
    "kernel.tool.readOnly": {"zh-CN": "只读模式不能改", "en-US": "Not allowed in read-only mode"},
    "kernel.tool.notStarted": {"zh-CN": "还没开始就停了", "en-US": "Stopped before it started"},
    "kernel.tool.unknown": {"zh-CN": "不确定有没有执行完，请核对", "en-US": "Not sure whether this finished. Please check."},
    "kernel.continued": {"zh-CN": "已让模型接着做", "en-US": "Asked the model to continue"},
    "kernel.resultRequested": {"zh-CN": "已提醒模型交回结果", "en-US": "Reminded the model to hand back the result"},
};

const PLURAL = /_(?:zero|one|two|few|many|other)$/u;
const newPlaceholders = (text: string) => text.replace(/\{(\w+)\}/gu, "{{$1}}");

/** 展开后的目录按不带复数后缀的键分组：键 → {后缀或空串 → 文字}。 */
function grouped(locale: string): Map<string, Map<string, string>> {
    const result = new Map<string, Map<string, string>>();
    for (const [key, value] of Object.entries(flattenCatalog(NB_AGENT_UI_CATALOGS[locale]!))) {
        const suffix = PLURAL.exec(key)?.[0] ?? "";
        const base = key.slice(0, key.length - suffix.length);
        let forms = result.get(base);
        if (forms === undefined) result.set(base, (forms = new Map()));
        forms.set(suffix, value);
    }
    return result;
}

describe("nb-agent-ui 的目录", () => {
    it("中文：每个键的文字与迁移前逐字相同（占位符换成 {{name}}），带数量的写成 _other，键与旧表一一对应", () => {
        const zh = grouped("zh-CN");
        expect([...zh.keys()].sort()).toEqual(Object.keys(LEGACY).sort());
        for (const [key, legacy] of Object.entries(LEGACY)) {
            const expected = typeof legacy["en-US"] === "string" ? new Map([["", newPlaceholders(legacy["zh-CN"])]]) : new Map([["_other", newPlaceholders(legacy["zh-CN"])]]);
            expect({key, forms: zh.get(key)}).toEqual({key, forms: expected});
        }
    });

    it("英文：每个键的文字与迁移前逐字相同，旧表分单复数的写成 _one 与 _other，其余不分", () => {
        const en = grouped("en-US");
        expect([...en.keys()].sort()).toEqual(Object.keys(LEGACY).sort());
        for (const [key, {"en-US": legacy}] of Object.entries(LEGACY)) {
            const expected = typeof legacy === "string" ? new Map([["", newPlaceholders(legacy)]]) : new Map([["_one", newPlaceholders(legacy.one)], ["_other", newPlaceholders(legacy.other)]]);
            expect({key, forms: en.get(key)}).toEqual({key, forms: expected});
        }
    });

    it("命名空间是包名，源语言是中文；引用构造带上命名空间", () => {
        expect(NB_AGENT_UI_NAMESPACE).toBe("nb-agent-ui");
        expect(NB_AGENT_UI_SOURCE_LOCALE).toBe("zh-CN");
        expect(agentRef("process.actions", {count: 2})).toEqual(textRef("process.actions", {count: 2}, "nb-agent-ui"));
    });

    describe("经最小实现翻译", () => {
        const translator = createMinimalTranslator({catalogs: {[NB_AGENT_UI_NAMESPACE]: NB_AGENT_UI_CATALOGS}, strict: true});
        const shape = (key: "process.files.read" | "toolGroup.search", count: number, locale: string) => translator.translate(agentRef(key, {count}), locale).replace(String(count), "N");

        it("英文带数量的文字按单复数换写法；中文不随数量变，也不会取到英文的复数形", () => {
            for (const key of ["process.files.read", "toolGroup.search"] as const) {
                expect(shape(key, 1, "en-US")).not.toBe(shape(key, 2, "en-US"));
                expect(shape(key, 1, "zh-CN")).toBe(shape(key, 2, "zh-CN"));
            }
            expect(translator.translate(agentRef("process.actions", {count: 2}), "zh-CN")).toBe("2 次操作");
            expect(translator.translate(agentRef("process.actions", {count: 2}), "en-US")).toBe("2 actions");
        });

        it("两种语言都代入全部参数，不留占位", () => {
            for (const locale of ["zh-CN", "en-US"]) {
                const text = translator.translate(agentRef("process.files.readChanged", {read: 37, changed: 41, count: 37}), locale);
                expect(text).toContain("37");
                expect(text).toContain("41");
                expect(text).not.toContain("{");
            }
        });
    });
});
