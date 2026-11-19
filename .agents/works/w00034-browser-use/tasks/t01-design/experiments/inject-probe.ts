/**
 * 探针：在真实外部网站上比较几种“看懂页面”的做法，回答 w00033 的前提“把页面内核心包注入外部网页”行不行。
 *
 * 每个网站量：
 * - CSP：响应头里有没有 script-src 限制；用 <script> 标签注入（页面里的普通做法）会不会被拦。
 * - 经 CDP 在页面主世界、隔离世界里执行同一个快照函数：成不成、找到多少可交互元素、其中多少在 shadow DOM 里、
 *   同源与跨域 iframe 各几个、输出多长、用时。
 * - CDP 的无障碍树（Accessibility.getFullAXTree）：节点数、可交互角色数、压成一行一个的长度、用时。
 * - Playwright 的 ariaSnapshot（omp、Playwright MCP 用的同一套注入脚本）：长度、用时。
 *
 * 用法（仓库根）：bun <本文件> <输出目录> [网址...]
 * 只读：只打开页面、读 DOM，不点击、不提交。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const outDir = process.argv[2];
const sites = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

// 注入的快照函数：自带全部逻辑，不依赖页面里的任何东西（页面可能改写了 Array、JSON 等全局）。
const snapshotSource = `(() => {
  const started = performance.now();
  const INTERACTIVE_ROLES = new Set(['button','link','tab','menuitem','checkbox','radio','option','combobox','switch','textbox','searchbox','slider']);
  const lines = [];
  let inShadow = 0, sameOriginFrames = 0, crossOriginFrames = 0, n = 0;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const interactive = (el) => {
    const tag = el.tagName.toLowerCase();
    if (['a','button','input','select','textarea','summary'].includes(tag)) return !(tag === 'a' && !el.hasAttribute('href'));
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.isContentEditable && (el.parentElement === null || !el.parentElement.isContentEditable)) return true;
    return el.hasAttribute('onclick') || getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
  };
  const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const walk = (root, shadow) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot, true);
      if (el.tagName === 'IFRAME') {
        try { if (el.contentDocument) { sameOriginFrames++; walk(el.contentDocument, shadow); continue; } } catch {}
        crossOriginFrames++;
        continue;
      }
      if (!interactive(el) || !visible(el)) continue;
      n++;
      if (shadow) inShadow++;
      lines.push('[' + n + '] ' + el.tagName.toLowerCase() + (el.getAttribute('role') ? ' role=' + el.getAttribute('role') : '') + ' "' + label(el) + '"');
    }
  };
  walk(document, false);
  const text = lines.join('\\n');
  return { count: n, inShadow, sameOriginFrames, crossOriginFrames, chars: text.length, ms: Math.round(performance.now() - started), sample: lines.slice(0, 12) };
})()`;

const INTERACTIVE_AX = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'option', 'combobox', 'switch', 'textbox', 'searchbox', 'slider', 'MenuListOption', 'ListBoxOption']);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true });
const results: Record<string, unknown>[] = [];
try {
	for (const url of sites) {
		const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: 'zh-CN' });
		const page = await context.newPage();
		const row: Record<string, unknown> = { url };
		const consoleCsp: string[] = [];
		page.on('console', (m) => {
			if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200));
		});
		// 只是打开、不操作时页面自己发的非 GET 请求（统计、埋点）：看“在网络层拦写请求、让用户确认”会有多少噪声。
		const writes: Record<string, number> = {};
		page.on('request', (r) => {
			if (r.method() === 'GET' || r.method() === 'OPTIONS') return;
			const key = `${r.method()} ${new URL(r.url()).host} ${r.resourceType()}`;
			writes[key] = (writes[key] ?? 0) + 1;
		});
		row.passiveWrites = writes;
		try {
			const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
			const csp = (await response?.allHeaders())?.['content-security-policy'] ?? '';
			row.cspScriptSrc = (csp.match(/script-src[^;]*/) ?? [''])[0].slice(0, 160);
			// 实验里等页面把首屏的脚本跑完；这里不是测试，等固定时长只影响数字的可比性，不影响结论。
			await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
			await page.waitForTimeout(3000);
			row.title = await page.title();
			row.frames = page.frames().length;

			// 页面里的普通注入：<script> 标签。严格的 CSP 会拦。
			await page.addScriptTag({ content: 'window.__nbProbe = 1' }).catch((e: Error) => {
				row.scriptTagError = e.message.slice(0, 120);
			});
			row.scriptTagRan = await page.evaluate('window.__nbProbe === 1');
			row.cspConsole = consoleCsp.slice(0, 2);

			// 经 CDP 在主世界执行（page.evaluate 走 Runtime.evaluate，不受页面 CSP 约束）。
			row.mainWorld = await page.evaluate(snapshotSource).catch((e: Error) => ({ error: e.message.slice(0, 160) }));

			// 隔离世界：页面脚本看不到、改不了我们的代码，与扩展的内容脚本同一种隔离。
			const cdp = await context.newCDPSession(page);
			const { frameTree } = await cdp.send('Page.getFrameTree');
			const world = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'nb-probe' });
			const isolated = await cdp.send('Runtime.evaluate', { expression: snapshotSource, contextId: world.executionContextId, returnByValue: true });
			row.isolatedWorld = isolated.exceptionDetails ? { error: isolated.exceptionDetails.text } : isolated.result.value;

			// CDP 无障碍树
			let t = performance.now();
			const { nodes } = await cdp.send('Accessibility.getFullAXTree');
			const axMs = Math.round(performance.now() - t);
			const axLines = nodes
				.filter((node) => !node.ignored && node.role?.value && INTERACTIVE_AX.has(String(node.role.value)))
				.map((node) => `${node.role?.value} "${String(node.name?.value ?? '').slice(0, 60)}"`);
			row.axTree = { nodes: nodes.length, interactive: axLines.length, chars: axLines.join('\n').length, ms: axMs, sample: axLines.slice(0, 8) };

			// Playwright 的 ariaSnapshot
			t = performance.now();
			const aria = await page.locator('body').ariaSnapshot({ timeout: 20_000 }).catch((e: Error) => `ERROR ${e.message.slice(0, 120)}`);
			row.ariaSnapshot = { chars: aria.length, ms: Math.round(performance.now() - t), head: aria.slice(0, 400) };
			writeFileSync(join(outDir, `aria-${results.length}.txt`), aria);
			await page.screenshot({ path: join(outDir, `shot-${results.length}.png`) });
		} catch (e) {
			row.error = (e as Error).message.slice(0, 200);
		}
		results.push(row);
		await context.close();
	}
} finally {
	await browser.close();
}
writeFileSync(join(outDir, 'probe.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((r) => ({ url: r.url, error: r.error, csp: r.cspScriptSrc, scriptTagRan: r.scriptTagRan, main: (r.mainWorld as { count?: number })?.count, isolated: (r.isolatedWorld as { count?: number })?.count, ax: (r.axTree as { interactive?: number })?.interactive })), null, 1));
