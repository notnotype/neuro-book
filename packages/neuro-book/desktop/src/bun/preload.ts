/**
 * 产品窗口的预加载脚本（docs/specs/runtime/desktop-shell.md 输出 10、12、13）：在页面脚本之前运行，经 Electrobun 的事件桥
 * `window.__electrobunSendToHost` 把三件事交给壳：页面标题、`window.open` 与带 `target` 的链接（新窗口请求）。别的什么都不
 * 暴露。Electrobun 2.0.6 在 Windows 上没有处理 WebView2 的新窗口请求，这里截住页面自己发起的两种；内嵌页面里的弹窗截不到
 * （Spec 的已知限制）。
 *
 * 作为字符串注入，所以不能有导入；`PRELOAD` 由壳的主进程交给 `BrowserWindow` 的 `preload` 选项。
 */

export const PRELOAD = `(() => {
  const send = (message) => {
    try { window.__electrobunSendToHost(message); } catch (error) { console.error("nbook-desktop bridge", error); }
  };
  const absolute = (url) => { try { return new URL(String(url), location.href).href; } catch { return null; } };
  window.open = function (url) {
    const href = url === undefined || url === null || url === "" ? null : absolute(url);
    if (href !== null) send({type: "open-window", url: href});
    return null;
  };
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor === null) return;
    const target = anchor.getAttribute("target");
    const external = !anchor.href.startsWith(location.origin + "/");
    if ((target !== null && target !== "" && target !== "_self") || event.ctrlKey || event.metaKey || (external && anchor.href.startsWith("http"))) {
      event.preventDefault();
      send({type: "open-window", url: anchor.href});
    }
  }, true);
  let title = null;
  const report = () => { if (document.title !== title) { title = document.title; send({type: "title", title}); } };
  new MutationObserver(report).observe(document.documentElement, {subtree: true, childList: true, characterData: true});
  addEventListener("DOMContentLoaded", report);
})();`;
