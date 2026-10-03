# 2026-07-06 浏览器验收：主题系统 v2.1 + 自定义主题

## 范围

- 验证 B9/B10 后的设置页主题管理 UI。
- 使用本地 `bun run dev -- --port 3210 --host 127.0.0.1` 启动 Nuxt dev server。
- 用户已授权浏览器验证；本轮使用 Edge headless + CDP 连接 `http://127.0.0.1:3210/`。

## 实际结果

- 通过：设置页“浏览器状态 / 前端设定”中显示 8 个内置主题：
  `Sepia Paper`、`Light Editorial`、`Default Dark`、`Catppuccin`、`Dracula`、`Monokai`、`One Dark Pro`、`Tokyo Night`。
- 通过：新建自定义主题，修改核心色 `--accent-main` 为 `#246bfe` 后，IDE 宿主变量实时变更。
- 通过：点击“按核心色重新生成”后保存，自定义主题出现在列表中并成为当前主题。
- 通过：刷新页面后，自定义主题与 `--accent-main: #246bfe` 保持。
- 通过：编辑该自定义主题，改名并把 `--accent-main` 改为 `#e05a47` 后保存，列表与宿主变量同步更新。
- 通过：导出主题 JSON，文件包含 `schemaVersion: 1`、编辑后的主题名，以及 `vars["accent-main"] = "#e05a47"`。
- 通过：删除当前自定义主题后，当前主题回退到 `Sepia Paper`。
- 通过：导入刚才导出的 JSON 后，生成新的自定义主题并成为当前主题，`--accent-main: #e05a47` 生效。
- 通过：再次刷新页面后，导入的自定义主题仍保持。

## 验证命令

```powershell
bun .agent\workspace\verify-theme-browser.mjs
```

结果：

```json
{
  "ok": true,
  "checkpoints": [
    "8 built-in presets visible",
    "create/save applies custom theme",
    "custom theme persists after reload",
    "edit/save updates custom theme",
    "exported JSON contains edited custom theme",
    "delete active custom theme falls back to Sepia Paper",
    "imported JSON creates active custom theme",
    "imported custom theme persists after reload"
  ],
  "cleanup": "restored original global config"
}
```

截图留档：

- `.agent/workspace/theme-browser-final.png`

导出样例留档：

- `.agent/workspace/theme-browser-downloads/2026-07-06T07-55-47-835Z/1783324552985.json`

## 与计划的出入

- 首次浏览器访问遇到 Vite dev server `Outdated Optimize Dep` 504；dev server 随后完成依赖重新优化，重跑后页面正常。
- 设置弹窗默认位于全局“模型设置”，该面板加载期间会阻止切换到“浏览器状态”；验收脚本改为等待/重试切换，没有改产品代码。
- Edge headless 的 CDP `DOM.setFileInputFiles` 未能把文件挂到主题导入 input；脚本降级为对同一个 `accept="application/json,.json"` 的 input 注入 `File` 并触发 `change` 事件。导入走的仍是页面 `importThemeFile` 处理逻辑。
- 验收脚本在通过后恢复了原始 Global Config，因此不会留下浏览器验收创建的测试自定义主题。

## 结论

B9/B10 后的浏览器主路径验收通过。未发现需要修改业务代码的主题 UI 缺陷。
