"""t14：拆开的子代理工具与复合工具，交给服务商的工具声明各多少 token。

两组声明表达同样的功能（派生、发话、回答提问、等待、杀死、列出），说明文字尽量相同；
复合组把同一类操作合进一个工具，用 action 参数切换。量的是 OpenAI 函数格式的 JSON（ensure_ascii=False），
每个服务商包装工具声明的方式不同，所以只看两组的相对差距。

运行：uv run --with tiktoken --with tokenizers python tool-descriptions.py
"""

import json

PROFILE = {"type": "string", "description": "Profile 的 key；可派的 Profile 与它们的初始输入见 profiles://"}
PROMPT = {"type": "string", "description": "交给子代理的任务。子代理从空白上下文开始，只看得到这段话：写清目标、相关文件与完成标准"}
NAME = {"type": "string", "description": "子会话的名字，显示给用户"}
INITIAL = {"type": "object", "description": "Profile 的初始输入，形状见 profiles://"}
MODEL = {"type": "string", "description": "模型角色（tiny、fast、main、deep 或专精角色）或具体模型；不写时用 Profile 的设置。用户没要求时不要写"}
EFFORT = {"type": "string", "enum": ["off", "low", "medium", "high", "max"], "description": "推理档；不写时用 Profile 的设置"}
QUESTIONS = {"type": "string", "enum": ["caller", "user"], "description": "子代理的提问交给谁：caller 是你（缺省），user 是用户"}
ASYNC = {"type": "boolean", "description": "为 true 时立即返回任务 id，之后用 wait 等；缺省一直等到子会话停下或有提问交给你"}
ID = {"type": "string", "description": "子会话 id（agent_spawn 的返回）"}
MESSAGE = {"type": "string", "description": "要说的话；不写就是让子会话接着跑"}
QUEUE = {"type": "boolean", "description": "子会话运行中时，为 true 排到下一轮，缺省作为插话立即送达"}
QUESTION = {"type": "string", "description": "提问 id（在 agent_spawn、agent_send 或 wait 的返回里）"}
ANSWER = {"type": "string", "description": "回答"}
JOBS = {"type": "array", "items": {"type": "string"}, "description": "要等的任务 id；不写就等你启动的全部"}
TIMEOUT = {"type": "number", "description": "最多等几秒，缺省 30"}
JOB = {"type": "string", "description": "任务 id"}


def tool(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}}


SPAWN_TEXT = "派一个子代理：新建子会话，把第一项任务交给它。缺省等它停下再返回（完成、出错、被中止），或者它有提问交给你时返回。"
SEND_TEXT = "给你派的子会话发话：子会话空闲时开新一轮，运行中时插话或排队。缺省等它停下或有提问交给你时返回。"
ANSWER_TEXT = "回答子会话交给你的提问。"
WAIT_TEXT = "等后台任务（后台命令、子代理的运行）：返回最先结束的一个；子代理有提问交给你、或用户插话时提前返回。结果会自动送达，只在没有别的事可做时用，不要轮询。"
KILL_TEXT = "杀死一个后台任务。杀死子代理的运行不删除子会话，之后还能用 agent_send 发话。"
JOBS_TEXT = "列出你启动的后台任务：id、种类、状态、开始时间、一行摘要。"

split = [
    tool("agent_spawn", SPAWN_TEXT, {"profile": PROFILE, "prompt": PROMPT, "name": NAME, "initial": INITIAL, "model": MODEL,
                                     "effort": EFFORT, "questions": QUESTIONS, "async": ASYNC}, ["profile", "prompt"]),
    tool("agent_send", SEND_TEXT, {"id": ID, "message": MESSAGE, "queue": QUEUE, "async": ASYNC}, ["id"]),
    tool("agent_answer", ANSWER_TEXT, {"id": ID, "question": QUESTION, "answer": ANSWER}, ["id", "question", "answer"]),
    tool("wait", WAIT_TEXT, {"jobs": JOBS, "timeout": TIMEOUT}, []),
    tool("kill", KILL_TEXT, {"job": JOB}, ["job"]),
    tool("jobs", JOBS_TEXT, {}, []),
]


def only(actions):
    return f"（只用于 action={'、'.join(actions)}）"


def scoped(schema, actions):
    return {**schema, "description": schema["description"] + only(actions)}


composite = [
    tool("agent",
         "子代理。action=spawn：" + SPAWN_TEXT + " action=send：" + SEND_TEXT + " action=answer：" + ANSWER_TEXT,
         {"action": {"type": "string", "enum": ["spawn", "send", "answer"], "description": "要做的操作"},
          "profile": scoped(PROFILE, ["spawn"]), "prompt": scoped(PROMPT, ["spawn"]), "name": scoped(NAME, ["spawn"]),
          "initial": scoped(INITIAL, ["spawn"]), "model": scoped(MODEL, ["spawn"]), "effort": scoped(EFFORT, ["spawn"]),
          "questions": scoped(QUESTIONS, ["spawn"]), "async": scoped(ASYNC, ["spawn", "send"]),
          "id": scoped(ID, ["send", "answer"]), "message": scoped(MESSAGE, ["send"]), "queue": scoped(QUEUE, ["send"]),
          "question": scoped(QUESTION, ["answer"]), "answer": scoped(ANSWER, ["answer"])},
         ["action"]),
    tool("job",
         "后台任务。action=wait：" + WAIT_TEXT + " action=kill：" + KILL_TEXT + " action=list：" + JOBS_TEXT,
         {"action": {"type": "string", "enum": ["wait", "kill", "list"], "description": "要做的操作"},
          "jobs": scoped(JOBS, ["wait"]), "timeout": scoped(TIMEOUT, ["wait"]), "job": scoped(JOB, ["kill"])},
         ["action"]),
]


def main():
    import tiktoken
    from tokenizers import Tokenizer

    counters = {"o200k_base（OpenAI）": lambda text: len(tiktoken.get_encoding("o200k_base").encode(text))}
    try:
        deepseek = Tokenizer.from_pretrained("deepseek-ai/DeepSeek-V3")
        counters["DeepSeek-V3"] = lambda text: len(deepseek.encode(text).ids)
    except Exception as error:  # 下载失败只少一列，不影响另一列
        print(f"DeepSeek 分词器下载失败，略过：{error}")

    groups = {"拆开（6 个工具）": split, "复合（2 个工具）": composite}
    for label, count in counters.items():
        print(f"## {label}")
        totals = {}
        for group, tools in groups.items():
            per_tool = {t["function"]["name"]: count(json.dumps(t, ensure_ascii=False)) for t in tools}
            totals[group] = sum(per_tool.values())
            print(f"{group}：合计 {totals[group]}；" + "，".join(f"{name} {n}" for name, n in per_tool.items()))
        a, b = totals.values()
        print(f"差：{a - b}（拆开比复合多 {(a - b) / b:.0%}）\n")


if __name__ == "__main__":
    main()
