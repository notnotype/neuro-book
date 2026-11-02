"""t12：待办工具的声明各占多少 token（omp `todo`、Claude Code `Task*` 与 `TodoWrite`、Codex `update_plan`）。

工具说明原文不入库，运行时从本机的调研留档里取：
- omp：本机全局安装的 `@oh-my-pi/pi-coding-agent` 的 `src/prompts/tools/todo.md`，参数照 `src/tools/todo.ts` 的 schema 写成 JSON Schema；
- Claude Code：`/tmp/research-todo/claude-code/bin/x/package/claude`（2.1.316 linux-x64），说明是工具的 `prompt()`（发给模型的就是它），
  非团队模式下的取值；
- Codex：`openai/codex` main@3026a8e54e0f 的 `plan_spec.rs`（说明只有三行，直接写在这里）。

量的是 OpenAI 函数格式的 JSON（ensure_ascii=False）；各家服务商包装工具声明的方式不同，只看相对大小。

运行：uv run --with tiktoken --with tokenizers python todo-tokens.py
"""

import json
from pathlib import Path

OMP = Path.home() / ".bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/prompts/tools/todo.md"
CLAUDE = Path("/tmp/research-todo/claude-code/bin/x/package/claude")


def template(blob: bytes, key: str, values: dict[str, str]) -> str:
    """取出包含 key 的模板字符串：往前找开头的反引号，往后找第一个没有转义的反引号；代入 `${名}`，还原转义。"""
    # 二进制里同一段文字出现两次，前一处不是 UTF-8 的 JS 源码，取后一处。
    at = blob.rindex(key.encode())
    start = blob.rindex(b"`", 0, at) + 1
    end = start
    while True:
        end = blob.index(b"`", end)
        if blob[end - 1:end] != b"\\":
            break
        end += 1
    text = blob[start:end].decode("utf8")
    for name, value in values.items():
        text = text.replace("${" + name + "}", value)
    return text.replace("\\`", "`").replace("\\u2192", "→")


def tool(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}}


S = {"type": "string"}


def groups():
    blob = CLAUDE.read_bytes()
    status = {"type": "string", "enum": ["pending", "in_progress", "completed"]}
    omp = [tool("todo", OMP.read_text(), {
        "op": {"type": "string", "enum": ["init", "start", "done", "rm", "drop", "block", "unblock", "append", "view"]},
        "list": {"type": "array", "description": "phases for init", "items": {"type": "object", "properties": {"phase": S, "items": {"type": "array", "items": S, "minItems": 1}}, "required": ["phase", "items"], "additionalProperties": False}},
        "task": {"type": "string", "description": "verbatim task content"},
        "phase": S,
        "items": {"type": "array", "items": S, "description": "tasks for flat init or append"},
        "reason": {"type": "string", "description": "blocker note for block"},
    }, ["op"])]
    task = [
        tool("TaskCreate", template(blob, "Use this tool to create a structured task list for your current coding session", {"e": "", "r": ""}), {
            "subject": {"type": "string", "description": "A brief title for the task"},
            "description": {"type": "string", "description": "What needs to be done"},
            "activeForm": {"type": "string", "description": 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")'},
            "metadata": {"type": "object", "additionalProperties": {}, "description": "Arbitrary metadata to attach to the task"},
        }, ["subject", "description"]),
        tool("TaskGet", template(blob, "Use this tool to retrieve a task by its ID from the task list", {}), {"taskId": {"type": "string", "description": "The ID of the task to retrieve"}}, ["taskId"]),
        tool("TaskUpdate", template(blob, "Use this tool to update a task in the task list.", {}), {
            "taskId": {"type": "string", "description": "The ID of the task to update"},
            "subject": {"type": "string", "description": "New subject for the task"},
            "description": {"type": "string", "description": "New description for the task"},
            "activeForm": {"type": "string", "description": 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")'},
            "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "deleted"], "description": "New status for the task"},
            "addBlocks": {"type": "array", "items": S, "description": "Task IDs that this task blocks"},
            "addBlockedBy": {"type": "array", "items": S, "description": "Task IDs that block this task"},
            "owner": {"type": "string", "description": "New owner for the task"},
            "metadata": {"type": "object", "additionalProperties": {}, "description": "Metadata keys to merge into the task. Set a key to null to delete it."},
        }, ["taskId"]),
        tool("TaskList", template(blob, "Use this tool to list all tasks in the task list.", {"e": "", "r": "- **id**: Task identifier (use with TaskGet, TaskUpdate)", "n": ""}), {}, []),
    ]
    todo_write = [tool("TodoWrite", template(blob, "Use this tool to create and manage a structured task list for your current coding session", {}), {
        "todos": {"type": "array", "description": "The updated todo list", "items": {"type": "object", "properties": {
            "content": {"type": "string", "minLength": 1}, "status": status, "activeForm": {"type": "string", "minLength": 1}},
            "required": ["content", "status", "activeForm"], "additionalProperties": False}},
    }, ["todos"])]
    codex = [tool("update_plan", "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.", {
        "explanation": S,
        "plan": {"type": "array", "description": "The list of steps", "items": {"type": "object", "properties": {
            "step": {"type": "string", "description": "Task step text."}, "status": {**status, "description": "Step status."}},
            "required": ["step", "status"], "additionalProperties": False}},
    }, ["plan"])]
    return {"omp todo": omp, "Claude Code Task*（4 个）": task, "Claude Code TodoWrite": todo_write, "Codex update_plan": codex}


def main():
    import tiktoken
    from tokenizers import Tokenizer

    counters = {"o200k_base（OpenAI）": lambda text: len(tiktoken.get_encoding("o200k_base").encode(text))}
    try:
        deepseek = Tokenizer.from_pretrained("deepseek-ai/DeepSeek-V3")
        counters["DeepSeek-V3"] = lambda text: len(deepseek.encode(text).ids)
    except Exception as error:  # 下载失败时只报 OpenAI 的
        print(f"DeepSeek 分词器下载失败，略过：{error}")
    for label, count in counters.items():
        print(f"## {label}")
        for group, tools in groups().items():
            per_tool = {item["function"]["name"]: count(json.dumps(item, ensure_ascii=False)) for item in tools}
            total = sum(per_tool.values())
            detail = "，".join(f"{name} {n}" for name, n in per_tool.items()) if len(per_tool) > 1 else ""
            print(f"{group}：{total}" + (f"（{detail}）" if detail else ""))
        print()


if __name__ == "__main__":
    main()
