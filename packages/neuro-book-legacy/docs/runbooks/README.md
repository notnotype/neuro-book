# 操作手册

`packages/neuro-book/docs/runbooks/` 保存基于已批准规范执行的当前开发、诊断和运维步骤。Runbook 可以引用命令、前置条件、可观察成功标准和失败恢复，但不重新定义产品行为。

- [`desktop/electron-debugging.md`](desktop/electron-debugging.md)：Windows Electron/Portable 的 CDP、Playwright、原生边界与包身份诊断。

操作失效时更新或归档；需要改变长期行为时先更新 [`../../../docs/specs/README.md`](../../../../docs/specs/README.md) 登记的当前规范，存在跨模块取舍时先进入 [`../../../docs/proposals/`](../../../../docs/proposals/)。
