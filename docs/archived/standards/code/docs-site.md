# VitePress 文档站规范

适用：`vitepress/.vitepress/**` 及 `vitepress/**` 中的主题组件、客户端脚本和样式；普通 Markdown 正文遵循文档治理，不加载源码规范。

- VitePress 是整个 monorepo 的用户文档投影，不承担内部产品规范；页面行为和术语链接回当前 spec 或稳定用户合同。
- Tracked 正文单一真相源是 `vitepress/locales/{zh-Hans,en-US}/`；VitePress 运行时只读取 gitignored 的 `.vitepress/staged/`。staging 将 `zh-Hans` 投影到站点根、`en-US` 投影到 `/en/`，不得用 rewrite 或 locale fallback 改变公开 URL。
- 两个 locale 的 Markdown 相对路径集合必须完全对等；翻译缺失直接失败。导航与 sidebar 分别位于 `.vitepress/locales/{zh-Hans,en-US}.ts`，配置只组合共享主题、搜索、watcher 和 locale。
- 中文 `/`、英文 `/en/` 是 canonical URL；不公开 `/zh-Hans/` 或 `/en-US/`。未来新增语言必须同时登记 source locale、staging 目标、导航和集合治理。
- 主题组件遵循前端可访问性、稳定布局和主题变量规则；只修改 TypeScript/Vue/CSS 时追加 [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md) 与 [`frontend.md`](frontend.md)。
- public 资产只位于根 `vitepress/public/`，正文使用稳定站点绝对路径；`.vitepress/{cache,dist,staged}` 都是命令生成物，不得跟踪或手改。
- 修改导航、主题、构建配置或客户端交互后运行 `bun run docs:check`、`bun run docs:build`，用户可见交互追加真实页面验证。

完成标准：中英文导航可达，站内链接和资源构建成功，用户可见组件在目标视口可操作，内部规范没有复制到发布站点独立演进。