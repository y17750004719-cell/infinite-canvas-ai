#!/bin/bash
lsof -ti :3001 | xargs kill -9 2>/dev/null
echo "Port 3001 已终止"
