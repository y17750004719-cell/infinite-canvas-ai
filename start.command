#!/bin/bash

# Infinite Canvas AI 启动脚本

cd "$(dirname "$0")"

echo "========================================="
echo "  启动 Infinite Canvas AI"
echo "========================================="
echo ""
echo "浏览器地址: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止服务"
echo "========================================="
echo ""

# 检查端口
if lsof -i :3000 > /dev/null 2>&1; then
    echo "端口 3000 已被占用"
    exit 1
fi

# 启动开发服务器（后台）
npm run dev &
DEV_PID=$!

cleanup() {
    if kill -0 "$DEV_PID" > /dev/null 2>&1; then
        kill "$DEV_PID" > /dev/null 2>&1
    fi
}

trap cleanup EXIT INT TERM

echo "正在启动开发服务器..."

# 等待服务就绪后再打开浏览器（最多等待 60 秒）
MAX_RETRIES=120
RETRY=0

while [ "$RETRY" -lt "$MAX_RETRIES" ]; do
    if ! kill -0 "$DEV_PID" > /dev/null 2>&1; then
        echo "开发服务器启动失败，请检查日志输出。"
        exit 1
    fi

    if curl -sSf "http://localhost:3000" > /dev/null 2>&1; then
        echo "服务器已就绪，正在打开浏览器..."
        open "http://localhost:3000"
        wait "$DEV_PID"
        exit $?
    fi

    sleep 0.5
    RETRY=$((RETRY + 1))
done

echo "等待服务器超时（60 秒），未打开浏览器。"
exit 1
