# Python Skill 工具规范

适用：`.agents/skills/**/*.py`。修改 Skill 时同时读取该 Skill 的 `SKILL.md`。

- Python 工具留在所属 Skill 内，沿用该 Skill 的依赖、入口和验证方式；仓库根不新增平行 Python runtime、虚拟环境或依赖管理。
- 使用 4 空格、`pathlib`、标准库结构化解析和 `if __name__ == "__main__":`；公共函数与跨文件数据加类型标注。
- 文件操作显式使用 UTF-8，并保持目标格式的换行和原子写入合同。CLI 使用 `argparse` 或所属 Skill 的既有入口。
- 失败写 stderr 并返回非零退出码；子进程传参数数组且不使用 `shell=True`。临时文件使用系统临时根并负责清理。

完成标准：Skill 的既有快速验证通过，CLI 失败码和 stderr 可观察，工具没有引入仓库级 Python 运行时或越出 Skill 的依赖。