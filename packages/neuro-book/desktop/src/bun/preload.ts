/**
 * 产品窗口的预加载脚本（docs/specs/runtime/desktop-shell.md 输出 10、12、13）：在页面脚本之前运行，经 Electrobun 的事件桥
 * `window.__electrobunSendToHost` 把三件事交给壳：页面标题、`window.open` 与带 `target` 的链接（新窗口请求）。别的什么都不
 * 暴露。Electrobun 2.0.6 在 Windows 上没有处理 WebView2 的新窗口请求，这里截住页面自己发起的两种；内嵌页面里的弹窗截不到
 * （Spec 的已知限制）。Ctrl、Meta 点击链接不在这里管：SDK 自己的预加载先在 window 的捕获阶段截下，发 `new-window-open`，
 * 壳的主进程接它；不带 `target` 的外部链接是整页导航，由导航规则拦下、经 `will-navigate` 交系统浏览器。
 *
 * 运行时机是文档刚创建（WebView2 的 `AddScriptToExecuteOnDocumentCreated`），那时还没有 `document.documentElement`，
 * 所以标题的观察器挂在 `document` 本身上，挂好就先报一次当前标题。
 *
 * 作为字符串注入，所以不能有导入；`PRELOAD` 由壳的主进程交给 `BrowserWindow` 的 `preload` 选项。
 */

export const PRELOAD = `(() => {
  const send = (message) => {
    try { window.__electrobunSendToHost(message); } catch (error) { console.error("nbook-desktop bridge", error); }
  };
  const absolute = (url) => { try { return new URL(String(url), location.href).href; } catch { return null; } };
  // 交给壳之后没有真正的窗口对象可交回；返回 null 会让页面当作“被浏览器拦截”（boot.ts 的 openExternal 据此提示），
  // 所以交回一个什么都不做的替身。地址无效、没交给壳时才返回 null。
  window.open = function (url) {
    const href = url === undefined || url === null || url === "" ? null : absolute(url);
    if (href === null) return null;
    send({type: "open-window", url: href});
    return {closed: false, opener: null, close() {}, focus() {}, blur() {}};
  };
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor === null) return;
    const target = anchor.getAttribute("target");
    if (target !== null && target !== "" && target !== "_self") {
      event.preventDefault();
      send({type: "open-window", url: anchor.href});
    }
  }, true);
  let title = null;
  const report = () => { if (document.title !== title) { title = document.title; send({type: "title", title}); } };
  new MutationObserver(report).observe(document, {subtree: true, childList: true, characterData: true});
  report();
})();`;
