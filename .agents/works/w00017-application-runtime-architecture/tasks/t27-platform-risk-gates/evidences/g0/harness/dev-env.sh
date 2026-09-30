# G0 开发模式实验环境（source 使用）。端口 3311；不触碰开发者 3001 服务。
SCR=/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad
WT=$SCR/g0-wt
export NEURO_BOOK_REPOSITORY_ROOT=$WT
export NEURO_BOOK_APPLICATION_ROOT=$WT/packages/neuro-book
export NEURO_BOOK_STATE_ROOT=$SCR/g0-state/dev
export NEURO_BOOK_CACHE_ROOT=$SCR/g0-state/dev-cache
export NEURO_BOOK_LOG_DIR=$SCR/g0-state/dev/logs
export PORT=3311 NUXT_PORT=3311 NITRO_PORT=3311
export HOST=127.0.0.1 NITRO_HOST=127.0.0.1
export NEURO_BOOK_SHUTDOWN_TOKEN=g0-dev-token-0123456789abcdef0123456789
export G0_EVENT_LOG=$SCR/g0-state/dev/g0-events.jsonl
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
