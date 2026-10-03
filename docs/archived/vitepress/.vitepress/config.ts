import {isAbsolute, relative, resolve} from "node:path";
import type {ViteDevServer} from "vite";
import type {Plugin} from "vite";
import {defineConfig} from "vitepress";

import {stageDocsLocales} from "../../scripts/ci/stage-docs-locales";
import {enNav, enSidebar} from "./locales/en-US";
import {zhNav, zhSidebar} from "./locales/zh-Hans";

const pagesBase = process.env.PAGES_BASE_PATH ?? "/neuro-book/";
const canonicalRoots = [
  resolve(import.meta.dirname, "../locales/zh-Hans"),
  resolve(import.meta.dirname, "../locales/en-US"),
  resolve(import.meta.dirname, "../public"),
  resolve(import.meta.dirname, "../../packages/llmlint/docs/promo"),
];

function docsDevPlugin(): Plugin {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stagingQueue = Promise.resolve();

  const scheduleStaging = (server: ViteDevServer): void => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      stagingQueue = stagingQueue
        .then(async () => {
          await stageDocsLocales();
          server.moduleGraph.invalidateAll();
          server.ws.send({type: "full-reload"});
        })
        .catch((error: unknown) => {
          server.config.logger.error(`Docs locale staging failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 75);
  };

  return {
    name: "docs-locales-and-official-static",
    configureServer(server) {
      server.watcher.add(canonicalRoots);
      server.watcher.on("all", (_event, changedPath) => {
        const absolutePath = resolve(changedPath);
        const isCanonicalPath = canonicalRoots.some((root) => {
          const pathFromRoot = relative(root, absolutePath);
          return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
        });
        if (isCanonicalPath) scheduleStaging(server);
      });
      server.httpServer?.once("close", () => clearTimeout(debounceTimer));

      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        for (const route of [`${pagesBase}official`, `${pagesBase}official/en`]) {
          if (pathname === route || pathname === `${route}/`) {
            response.statusCode = 302;
            response.setHeader("Location", `${route}/index.html`);
            response.end();
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: pagesBase,
  srcDir: ".vitepress/staged",
  title: "NeuroBook",
  markdown: {
    config(md) {
      const defaultFence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim().toLowerCase() === "mermaid") {
          return `<Mermaid code="${encodeURIComponent(token.content)}" />`;
        }
        return defaultFence
          ? defaultFence(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };
    },
  },
  vite: {
    server: {watch: {ignored: ["**/.vitepress/staged/**"]}},
    plugins: [docsDevPlugin()],
  },
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-Hans",
      description: "NeuroBook：让你写完长篇的创意写作 IDE。世界状态由引擎推算而不是靠模型记忆，伏笔像技术债一样记账追踪，成稿用规则做 lint。作品是本地 Markdown 文件与 SQLite，随时带走。",
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        outline: {label: "本页目录"},
        docFooter: {prev: "上一页", next: "下一页"},
        returnToTopLabel: "回到顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "外观",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        langMenuLabel: "切换语言",
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      description: "NeuroBook is a creative writing IDE built to help you actually finish a long-form novel. World state is computed by an engine instead of remembered by a model, setups are tracked like technical debt, and finished prose is linted against rules. Your work stays as local Markdown files and SQLite.",
      themeConfig: {nav: enNav, sidebar: enSidebar},
    },
  },
  themeConfig: {
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: {buttonText: "搜索文档", buttonAriaLabel: "搜索文档"},
              modal: {
                displayDetails: "展开详情",
                resetButtonTitle: "清除查询条件",
                backButtonTitle: "返回",
                noResultsText: "无法找到相关结果",
                footer: {selectText: "选择", navigateText: "切换", closeText: "关闭"},
              },
            },
          },
        },
      },
    },
    socialLinks: [{icon: "github", link: "https://github.com/notnotype/neuro-book"}],
  },
});
