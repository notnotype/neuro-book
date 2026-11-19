"""用 browser-use 1.0.6 跑一个实验任务：本地无头 Chrome、自己的模型，不用它的云浏览器与网关。

用法：python -I run_browser_use.py <模型> <任务文件> <输出目录>
  模型：terra（gpt-6.1-terra，经 JIJI_LUNA_* 的中转）、luna（gpt-6-luna，同上）、gemini-argon、gemini-hydrogen（经 GEMINI_* 的中转）
密钥只从环境变量读；调用方负责关掉遥测与更新检查（ANONYMIZED_TELEMETRY=false、BROWSER_USE_NO_UPDATE_CHECK=1、BROWSER_USE_AUTO_LOGIN=false）。
输出：summary.json（状态、步数、用时、token）与 messages.json（完整对话，含模型写的每段代码），工作区里有它自己存的单元输出与截图。
"""

import json
import os
import sys
import time
from pathlib import Path

from browser_use import Agent, Browser, ChatOpenAI


def make_llm(name: str):
	if name in ('terra', 'luna'):
		model = {'terra': 'gpt-6.1-terra', 'luna': 'gpt-6-luna'}[name]
		return ChatOpenAI(model, api_key=os.environ['JIJI_LUNA_API_KEY'], base_url=os.environ['JIJI_LUNA_BASE_URL'], reasoning_effort='medium')
	if name.startswith('gemini-'):
		from pydantic_ai.models.google import GoogleModel
		from pydantic_ai.providers.google import GoogleProvider

		model = {'gemini-argon': 'gemini-4-argon', 'gemini-hydrogen': 'gemini-4-hydrogen'}[name]
		return GoogleModel(model, provider=GoogleProvider(api_key=os.environ['GEMINI_API_KEY'], base_url=os.environ['GEMINI_API_BASE']))
	raise SystemExit(f'unknown model {name}')


def main() -> None:
	model_name, task_file, out_dir = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
	out_dir.mkdir(parents=True, exist_ok=True)
	task = task_file.read_text(encoding='utf-8').strip()
	browser = Browser('chromium', headless=True, executable_path='/usr/bin/google-chrome-stable')
	agent = Agent(task, llm=make_llm(model_name), browser=browser, judge=False, workspace=str(out_dir / 'workspace'))
	started = time.time()
	result = agent.run_sync(max_steps=40, timeout=1200)
	elapsed = time.time() - started
	summary = {
		'model': model_name,
		'task': task_file.name,
		'status': result.status,
		'success': result.success,
		'steps': result.number_of_steps(),
		'seconds': round(elapsed, 1),
		'usage': result.usage,
		'error': result.error,
		'final': result.final_result(),
	}
	(out_dir / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
	try:
		from pydantic_ai.messages import ModelMessagesTypeAdapter

		(out_dir / 'messages.json').write_bytes(ModelMessagesTypeAdapter.dump_json(result.messages, indent=2))
	except Exception as e:  # 对话导出失败不影响摘要，只记一句
		(out_dir / 'messages-error.txt').write_text(repr(e), encoding='utf-8')
	agent.close_sync()
	print(json.dumps(summary, ensure_ascii=False, default=str))


main()
