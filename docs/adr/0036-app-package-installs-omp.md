---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-01
superseded-by: null
---

# ADR 0036：应用包把 OMP 作为依赖安装，不打进 bundle；服务端入口先于 OMP 做两件事

- 日期：2026-11-01
- 决策者：开发者（w00032 t09 决定 33、34）
- 关联工作：[w00032 t09](../../.agents/works/w00032-agent-integration/tasks/t09-models/README.md)
- 部分取代：[ADR 0033](0033-app-delivered-as-built-npm-package.md) 决策 1 里的“依赖全部打进 bundle，包没有 `dependencies`”；0033 的其余决定不变

## 背景

模型服务（`nbook.models`）把 OMP 带进了服务端进程。OMP 有两点与 0033 的“单文件 bundle、没有依赖”不合：

1. **原生插件。** `@oh-my-pi/pi-catalog`、`pi-ai` 一被求值就加载 `pi_natives` 原生插件，每个平台一个约 122 MB 的 `.node` 文件，由 npm 按平台装的可选依赖提供。打进 bundle 后加载器按 bundle 所在目录找 `native/`，找不到就启动即崩（仓库里的 `dist/server` 与应用包都是）。
2. **进程级处理。** OMP 的 `@oh-my-pi/pi-utils` 一被求值，就在主线程装上 SIGINT、SIGTERM、SIGHUP 与未处理异常的处理，跑完自己的清理就硬退出，抢在服务端宿主的有序停止之前。没有关闭的开关；已向上游报告（can1357/oh-my-pi#17674）。

## 决策

1. **OMP 不打进服务端 bundle。** `@oh-my-pi/*` 作外部模块，应用包的 `package.json` 写上 bundle 实际引用的 OMP 包（精确版本，取打包时仓库装的那个），npm 安装时只装本平台那份原生包，与 omp 自己的发法相同。外部模块的名单只有一处（`scripts/pack-app.ts` 的 `SERVER_EXTERNALS`），`build:server` 与命令行测试的构建与它一致。
2. **服务端入口先于 OMP 做两件事。** 能起服务端的入口先拍下启动环境（ADR 0032 的口径），再接管 OMP 装的进程级处理（摘掉它挂上的监听，宿主停止结算后再跑 OMP 登记的清理），然后才加载其余代码。打包的入口（`nbook.js`、`dist/server/main.js`）用 `await import` 加载本体并开代码分割：同一个文件里对外部包的静态导入会被提到最前、先于这两件事求值，放进另一个 chunk 才排在后面。
3. 接管是临时做法：上游有了关闭开关后换成开关，删掉接管的代码。

## 备选方案

- **原生插件拷进包**（按平台各打一个包、每个包多 122 到 244 MB）：要为每个平台各打一次包，否决。
- **OMP 放进 Worker 线程或模型服务子进程**：两者都要一套跨线程或跨进程的协议（版本号一致的快照、在途请求的结算与独立失败码、背压、关闭握手），子进程还隔离原生崩溃与内存。审查（t09 证据 `design-review-omp-isolation.txt`）认为子进程优于 Worker；开发者先用接管加上游修复，需要隔离原生崩溃与内存时再做子进程。

## 后果

- 应用包不再是零依赖：安装要从 npm 拉 OMP 与本平台的原生包（约 122 MB）。包仍然跨平台。
- 打包产物里 `server/` 多了代码分割出来的 chunk 文件；应用包检查核对它们都在包里。
- 接管依赖 OMP“求值时在 `process` 上注册”这个内部行为。OMP 改了注册时机，服务端宿主的停止与退出码测试（`server.test.ts`、`server-projects.test.ts` 场景 14、15）与 `nb-harness` 的 `process-guard.test.ts` 会失败，不会静默。
- 原生插件的崩溃、OMP 的内存与凭据库仍与服务端同进程。
