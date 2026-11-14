# NeuroBook 桌面壳（Electrobun）

Windows 桌面版的主进程与壳自己的页面。行为合同是 [`runtime/desktop-shell`](../../../docs/specs/runtime/desktop-shell.md)；流程与规则都在核心 [`src/desktop/`](../src/desktop/)（不依赖 Electrobun，`bun test src/desktop` 在 Linux 上用真实进程测），这里只把核心要的端口接到 Electrobun 2.0.6 上。

| 文件 | 作用 |
|---|---|
| `src/bun/index.ts` | 主进程：窗口、对话框、导航、桥、退出的拦截，WebView2 检查 |
| `src/bun/preload.ts` | 产品窗口的预加载脚本：页面标题与新窗口请求经事件桥交给壳 |
| `src/views/shell/index.html` | 启动页与壳的对话框（同一页，按壳交来的状态显示） |
| `electrobun.config.ts`、`hutch.config.ts` | Electrobun 与 Hutch 的配置，版本固定 |
| `scripts/build.ts` | 在仓库里把主进程打成 `bundle/main.js`，按发布清单组装载荷到 `payload/` |

`bundle/` 是我们预打包的主进程，`build/` 与 `artifacts/` 是 Electrobun 自己的输出目录；分开放，免得 Electrobun 构建时清掉或覆盖预打包的文件。

## 构建

1. 仓库里（Linux 或 Windows 都行），在 `packages/neuro-book` 下：先 `bun run release:smoke`（仓库根）得到发布清单，再 `bun desktop/scripts/build.ts ../../dist/release/release-manifest.json`。只打主进程时不给清单。
2. Windows 上进 `desktop/`：清掉 `HTTPS_PROXY`、`HTTP_PROXY`（Hutch 0.29.0 设了它们下载必失败），`hutch install`，`hutch electrobun build --env=stable`。产物在 `artifacts/`：`Setup.zip`（无界面安装包）与更新文件。
3. 便携包：把构建出的应用目录打成 zip，根目录放空文件 `NeuroBook.portable`（发布流程负责，安装包里没有它）。

`src/bun/` 只在 Hutch 构建的应用里运行，类型检查不覆盖它（Electrobun 的类型由 Hutch 提供）；它的行为靠 Windows 上的实测把关，记录在 w00046 t08 的证据里。
