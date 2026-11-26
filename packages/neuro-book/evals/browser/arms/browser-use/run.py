"""browser-use 一边的执行脚本：在评测的沙箱里跑一道题（实施计划“browser-use 一边”）。

用法：python -I run.py /tmp/job/job.json

- 浏览器是调度器起的 Chrome：Browser(cdp_url=..., keep_alive=True)，收尾时只停 browser-use 自己的 REPL，不碰浏览器。
- 模型经评测的网关（OpenAI 兼容地址、假密钥）；推理档在 ChatOpenAI 上给（这条路径上 Agent(reasoning=...) 不起作用）。
- 标准输出只写带 schema 的 JSON 行：ready（连上浏览器、开始计时）、step（一段代码执行完，来自 browser-use 每一步打的
  INFO 日志 “step N: ...”）、done。browser-use 自己的日志走标准错误。
- 结束时把结果写成 /tmp/out/executor.json（format nbook.browser-eval.executor/v1；先写临时文件再改名，调度器读到的总是完整的）。
  最终回答取 result.text：没完成（timeout、max_steps）时它是 browser-use 自己的回退（partial 或最后一段模型文字），
  final_result() 这时是 None。不读任何密钥文件。
"""

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

SCHEMA = 'nbook.browser-eval.event/v1'
WORKSPACE = Path('/tmp/work')
OUT = Path('/tmp/out/executor.json')


def emit(event: str, **fields) -> None:
	sys.stdout.write(json.dumps({'schema': SCHEMA, 'event': event, **fields}, ensure_ascii=False) + '\n')
	sys.stdout.flush()


class StepEvents(logging.Handler):
	"""browser-use 在每段代码执行完之后打一条 'step N: <代码的第一行>'（agent/loop.py），转成一个 step 事件。"""

	def emit(self, record: logging.LogRecord) -> None:
		message = record.getMessage()
		if message.startswith('step ') and ':' in message:
			emit('step', line=message.split(':', 1)[1].strip()[:200], at=time.monotonic())


def split_error(text: str) -> tuple[str, str | None]:
	"""browser-use 把一段代码的报错另起一行接在输出后面（'Error: 报错'；没有输出时整段就是这一行，见 agent/loop.py），拆开。"""
	if text.startswith('Error: '):
		return '', text[len('Error: ') :]
	head, sep, tail = text.rpartition('\nError: ')
	return (head, tail) if sep else (text, None)


def text_of(content) -> str:
	"""工具返回的内容：字符串原样；列表里的文字拼起来，图片记成占位。"""
	if isinstance(content, str):
		return content
	if isinstance(content, list):
		return '\n'.join(item if isinstance(item, str) else f'[{type(item).__name__}]' for item in content)
	return json.dumps(content, ensure_ascii=False, default=str)


def steps_of(messages) -> tuple[list[dict], list[str]]:
	"""按出现的先后取出每一段 python 代码与它的输出，另取模型的思考文字。"""
	from pydantic_ai.messages import ModelRequest, ModelResponse, ThinkingPart, ToolCallPart, ToolReturnPart

	steps: list[dict] = []
	by_call: dict[str, dict] = {}
	thinking: list[str] = []
	for message in messages:
		if isinstance(message, ModelResponse):
			for part in message.parts:
				if isinstance(part, ThinkingPart) and part.content:
					thinking.append(part.content)
				elif isinstance(part, ToolCallPart) and part.tool_name == 'python':
					step = {'code': str(part.args_as_dict().get('code', '')), 'output': '', 'error': None}
					steps.append(step)
					by_call[part.tool_call_id] = step
		elif isinstance(message, ModelRequest):
			for part in message.parts:
				if isinstance(part, ToolReturnPart) and part.tool_call_id in by_call:
					step = by_call[part.tool_call_id]
					step['output'], step['error'] = split_error(text_of(part.content))
	return steps, thinking


def deliverables() -> list[str]:
	"""工作目录里 Agent 自己写的文件（browser-use 的 .browser-use/ 与 downloads/ 不算）。"""
	if not WORKSPACE.exists():
		return []
	files = []
	for path in sorted(WORKSPACE.rglob('*')):
		relative = path.relative_to(WORKSPACE)
		if path.is_file() and relative.parts[0] not in ('.browser-use', 'downloads'):
			files.append(str(relative))
	return files


async def main(job_path: str) -> None:
	job = json.loads(Path(job_path).read_text(encoding='utf-8'))
	logging.basicConfig(stream=sys.stderr, level=logging.WARNING, format='%(name)s %(levelname)s %(message)s')
	bu_logger = logging.getLogger('browser_use')
	bu_logger.setLevel(logging.INFO)
	bu_logger.addHandler(StepEvents())

	from importlib.metadata import version

	from browser_use import Agent, Browser, ChatOpenAI

	browser = Browser(cdp_url=job['cdpUrl'], keep_alive=True)
	llm = ChatOpenAI(job['model'], api_key=job['gatewayKey'], base_url=job['gatewayUrl'], reasoning_effort=job['reasoning'])
	agent = Agent(job['task'], llm=llm, browser=browser, judge=False, workspace=str(WORKSPACE))
	result = None
	failure = None
	try:
		await browser.start()
		emit('ready', at=time.monotonic())
		result = await agent.run(max_steps=job['maxSteps'], timeout=job['timeLimitSec'])
	except Exception as error:  # 交给调度器按结局表归类；完整的栈留在标准错误
		failure = f'{type(error).__name__}: {error}'
		logging.getLogger('nbook.eval').exception('run failed')
	output = {
		'format': 'nbook.browser-eval.executor/v1',
		'status': result.status if result is not None else 'error',
		'success': result.success if result is not None else None,
		'finalAnswer': (result.text or None) if result is not None else None,
		'error': (result.error if result is not None else None) or failure,
		'partial': json.dumps(result.partial, ensure_ascii=False, default=str)[:20000] if result is not None and result.partial is not None else None,
		'usage': dict(result.usage) if result is not None else None,
		'steps': [],
		'thinking': [],
		'deliverables': deliverables(),
		'versions': {'browser-use': version('browser-use'), 'python': sys.version.split()[0]},
	}
	if result is not None:
		output['steps'], output['thinking'] = steps_of(result.messages)
	temp = OUT.with_name(OUT.name + '.tmp')
	temp.write_text(json.dumps(output, ensure_ascii=False, indent=1), encoding='utf-8')
	os.replace(temp, OUT)
	emit('done', status=output['status'])
	await agent.close()


if __name__ == '__main__':
	os.environ.setdefault('ANONYMIZED_TELEMETRY', 'false')
	# 日志由本脚本配置（标准错误，加上转步骤事件的处理器）；browser-use 自己再配一份会让每行打两遍。
	os.environ.setdefault('BROWSER_USE_SETUP_LOGGING', 'false')
	asyncio.run(main(sys.argv[1]))
