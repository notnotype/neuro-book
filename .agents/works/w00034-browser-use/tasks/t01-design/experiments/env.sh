# 从仓库根的 .env 取实验要用的几个键（.env 是 CRLF，要去掉回车），并关掉 browser-use 的遥测、更新检查与自动登录。用法：. env.sh <仓库根>
_get() { grep -E "^$1=" "$2/.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'; }
for k in JIJI_LUNA_BASE_URL JIJI_LUNA_API_KEY GEMINI_API_KEY GEMINI_API_BASE; do export "$k=$(_get $k "$1")"; done
export ANONYMIZED_TELEMETRY=false BROWSER_USE_NO_UPDATE_CHECK=1 BROWSER_USE_AUTO_LOGIN=false
