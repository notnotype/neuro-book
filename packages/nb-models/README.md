# @notnotype/nb-models

建在 nb-runtime 与 nb-harness 上的模型服务：服务商与模型、模型角色的配置形状，内置角色，设置页用的远程合同。合同 id、服务键、设置项的分区与文字由应用给。

- `./config`：配置形状（`ProviderConfigSchema`、`ModelConfigSchema`、`RolesSchema` 等）、内置角色 `BUILTIN_ROLES`（梯度四档 `tiny`、`fast`、`main`、`deep` 与专精 `compaction`）与服务按 id 取的 `MODEL_ROLE_IDS`、模型引用与服务商 id 的纯规则、压缩触发点。设置页与服务端共用。
- `./contract`：设置页看到的快照与结果形状、远程合同的定义 `modelsSettingsSpec`。应用这样定义合同：

  ```ts
  export const modelsSettingsContract = defineRemoteService({id: "<插件 id>/settings", ...modelsSettingsSpec});
  ```

  推出的类型就是 `ModelsSettingsContract`。进程内服务的接口 `ModelsService` 也在这里，服务键由应用定义。

不发 npm（`private`），只在本仓库的工作区里用。边界与验证见 [`AGENTS.md`](AGENTS.md)。
