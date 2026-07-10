#!/bin/bash

# Infinite Canvas AI launcher for macOS.

cd "$(dirname "$0")" || exit 1

APP_URL="http://localhost:3001"
DEV_PID=""
PORT="3001"

cleanup() {
    if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
        echo ""
        echo "Stopping development server..."
        kill "$DEV_PID" >/dev/null 2>&1
    fi
}

kill_port_processes() {
    local pids

    pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -z "$pids" ]; then
        echo "Port $PORT is free."
        return 0
    fi

    echo "Port $PORT is already in use. Stopping existing process..."
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1

    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "Could not release port $PORT. Please close the process manually, or run:"
        echo ""
        echo "  ./kill-port.command"
        echo ""
        echo "Press Enter to close..."
        read -r
        exit 1
    fi

    echo "Port $PORT has been released."
}

trap cleanup EXIT INT TERM

echo "========================================="
echo "  Infinite Canvas AI"
echo "========================================="
echo ""
echo "Project: $PWD"
echo "URL:     $APP_URL"
echo ""

if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found. Please install Node.js first."
    echo ""
    echo "Press Enter to close..."
    read -r
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Dependencies are not installed."
    echo "Please run this command first:"
    echo ""
    echo "  npm install"
    echo ""
    echo "Press Enter to close..."
    read -r
    exit 1
fi

kill_port_processes

echo "Starting development server..."
echo "Press Ctrl+C to stop."
echo "========================================="
echo ""

npm run dev &
DEV_PID=$!

MAX_RETRIES=120
RETRY=0
OPENED=0

while [ "$RETRY" -lt "$MAX_RETRIES" ]; do
    if ! kill -0 "$DEV_PID" >/dev/null 2>&1; then
        echo ""
        echo "Development server failed to start. Check the log above."
        echo "Press Enter to close..."
        read -r
        exit 1
    fi

    if curl -sSf "$APP_URL" >/dev/null 2>&1; then
        if [ "$OPENED" -eq 0 ]; then
            echo ""
            echo "Server is ready. Opening browser..."
            open "$APP_URL"
            OPENED=1
        fi
        wait "$DEV_PID"
        exit $?
    fi

    sleep 0.5
    RETRY=$((RETRY + 1))
done

echo ""
echo "Timed out waiting for $APP_URL."
echo "The development server may still be starting. Check the log above."
echo "Press Enter to close..."
read -r
exit 1
