// Cookie 同意遮罩：没点“同意并继续”之前盖住整页，挡住下面的点击（真站常见的第一道坎）。
(() => {
    if (document.cookie.split("; ").includes("consent=1")) return;
    const layer = document.createElement("div");
    layer.id = "consent";
    layer.innerHTML = '<div class="box"><div><strong>我们使用 Cookie</strong><div>为了保存你的登录状态与编辑草稿，本站使用必要的 Cookie。</div></div><div><button type="button" class="secondary" id="consent-more">了解更多</button> <button type="button" id="consent-accept">同意并继续</button></div></div>';
    document.body.append(layer);
    layer.querySelector("#consent-accept").addEventListener("click", () => {
        document.cookie = "consent=1; path=/";
        layer.remove();
    });
    layer.querySelector("#consent-more").addEventListener("click", () => {
        layer.querySelector(".box > div").textContent = "必要 Cookie 用于登录与草稿，不用于广告。";
    });
})();
