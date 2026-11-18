/**
 * 插件描述：只有一条顶层贡献 `agent.skills`，声明插件包里装 Skill 的目录（docs/specs/agent/skills.md 输出 30）。
 *
 * - `directory` 是插件包里的相对路径，用 `/` 分段。里面每个子文件夹是一个 Skill，id 是插件 id 加 `.` 加文件夹名，这里是
 *   `example.skill-pack.word-count`。
 * - 贡献只有声明，不用激活事件：`nbook.agent` 收到声明后自己去扫目录。
 * - 构建（`nbooke build`）把这个目录搬进产物，并把每个脚本连同它用到的 npm 包打成单文件（docs/specs/runtime/plugin-api.md 的
 *   “作者工具”）；装好之后 Skill 直接可用，不用初始化。打不进单文件的（原生模块、按自己的位置读文件的包）构建就失败，并写明是
 *   哪个依赖。
 *
 * `agentSkills` 来自 SDK 的 `/agent`，它只在服务端用。作者的项目用的是打包后的类型，描述里这样写照样能做类型检查；仓库里这个
 * 例子没有浏览器代码，不进浏览器那份类型检查（`tsconfig.web.json` 排除了它，与 `src/sdk/agent.ts` 同理）。
 */

import {agentSkills} from "@notnotype/nb-plugin-sdk/agent";

import {plugin} from "./shared/contracts";

export const descriptor = plugin.descriptor([agentSkills(`${plugin.id}.skills`, {directory: "skills"})]);
