---
schema: nbook.task/v2
taskId: t53-picker-i18n-keys
role: tasker
---

# 补齐 Project Picker 缺失文案并覆盖两个布局场景

**状态：待修复。** 由 t52 在修 Lab smoke 时查出的**产品缺陷**（非本批引入）。

## 证据

- 调用点：`packages/neuro-book/app/components/novel-ide/project-picker/ProjectPickerClassicCompactView.vue:160/167`、`ProjectPickerClassicEditorialView.vue:178/185` 使用 `t('ide.picker.changeCover')` 与 `t('ide.picker.deleteProject')`。
- 现状：`app/i18n/locales/zh-CN.ts` 与 `en-US.ts` **都没有这两个 key**（只有 `setCover` / `deleteBook`），运行时产生 intlify 缺失 key warning（t52 实测 56 条）。
- 影响：紧凑列表与宽幅图文两个书架视图的"更换封面/删除作品"入口文案缺失（用户可见）；同时使 Lab smoke 无法把这两个场景纳入（smoke 把 console warning 计入失败）。

## 要求

1. 二选一，并说明选择依据：把调用点改为既有 key（`setCover`/`deleteBook`），或补齐缺失 key（`changeCover`/`deleteProject`）到 zh-CN 与 en-US **两个** locale。
   若语义与既有 key 不同（例如"更换封面"与"设置封面"在产品上是两个动作），应补新 key 而不是复用；反之应复用。
2. 补齐后把 t52 的 Lab smoke 覆盖扩展到 `compact`（密集列表）与 `editorial`（宽幅图文）两个场景，并移除 t52 脚本里"因缺 key 不纳入"的注释。
3. 不放松 smoke 对 console warning 的判定标准。
4. 不改 picker 的既有交互语义与样式。

## 验证与交付

- 聚焦：picker 相关组件测试 + Lab smoke `--suite project-picker` exit 0（**直接复用运行中的 3001**，不要另起 dev server：同目录第二个 server 会重建 `.nuxt` 并摧毁 3001）。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、覆盖到的场景、两个 locale 的 key 清单核对、未验证项。
- 不提交、不 push；不碰 3001 的启停。
- 最终回复具体结果，不返回空文本或句点。

## 协作

`app/i18n/locales/*.ts` 可能同时被 t50 返工代理（`BrowserTitlebar`）使用：动手前先 `hub send` 与它约定顺序，不要并发编辑同一文件。