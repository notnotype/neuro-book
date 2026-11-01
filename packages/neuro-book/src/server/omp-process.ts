/**
 * 服务端进程接管 OMP 装的进程级处理（`@notnotype/nb-harness/process-guard`，上游 can1357/oh-my-pi#17674 修好前的临时做法）：
 * OMP 一被求值就挂上 SIGINT、SIGTERM、SIGHUP 与未处理异常的处理并硬退出，抢在服务端宿主的有序停止（排空、项目子进程先收口、
 * 退出码由宿主定，docs/specs/runtime/server-host.md）之前。这里在任何导入 OMP 的模块之前接管，把那些监听摘掉；OMP 登记的清理
 * 由 `runServerProcess` 在停止结算之后调 `ompProcess.cleanup()` 跑。
 *
 * 每个能起服务端的入口都把本模块放在第二条导入，紧跟 `startup-env`（启动环境要先拍下；本模块会求值 OMP，OMP 求值时把家目录
 * 等处的 `.env` 并进 `process.env`）。上游有了关闭开关后换成开关，删掉本模块。
 */

import {takeOverOmpProcessHandlers} from "@notnotype/nb-harness/process-guard";

export const ompProcess = await takeOverOmpProcessHandlers();
