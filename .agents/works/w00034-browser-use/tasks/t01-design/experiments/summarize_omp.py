"""把 run_omp.sh 记下的 omp 事件流（--mode json）整理成可比的摘要：每次 eval 的代码与输出开头、模型请求数、token、重试。

用法：python -I summarize_omp.py <events.jsonl> [--code]
"""

import json
import sys

path = sys.argv[1]
show_code = '--code' in sys.argv
calls = []
usage = {'input': 0, 'output': 0, 'cacheRead': 0}
requests = 0
retries = 0
final_text = ''
for line in open(path, encoding='utf-8'):
	try:
		event = json.loads(line)
	except json.JSONDecodeError:
		continue
	kind = event.get('type')
	if kind == 'tool_execution_start':
		calls.append({'tool': event.get('toolName'), 'code': (event.get('args') or {}).get('code', ''), 'out': ''})
	elif kind == 'tool_execution_end' and calls:
		content = (event.get('result') or {}).get('content') or []
		calls[-1]['out'] = ''.join(part.get('text', '') for part in content if isinstance(part, dict))
	elif kind == 'turn_end':
		message = event.get('message') or {}
		if message.get('stopReason') != 'error':
			requests += 1
			for key in usage:
				usage[key] += (message.get('usage') or {}).get(key, 0)
			texts = [c.get('text', '') for c in message.get('content') or [] if c.get('type') == 'text']
			if texts:
				final_text = '\n'.join(texts)
	elif kind == 'auto_retry_start':
		retries += 1

print(json.dumps({'requests': requests, 'evalCalls': len(calls), 'retries': retries, 'usage': usage}, ensure_ascii=False))
for i, call in enumerate(calls, 1):
	print(f'--- {i} {call["tool"]}')
	print(call['code'] if show_code else call['code'][:300])
	print('>>', call['out'][:400].replace('\n', ' | '))
print('=== final:', final_text[:800])
