#!/bin/bash
# ZO.DESIGN 项目备份脚本
PROJECT_DIR="/Volumes/ZO/ZO.DESIGN"
BACKUP_DIR="/Volumes/ZO/backup/ZO.DESIGN-backup"
# 确保备份目录存在
mkdir -p "$BACKUP_DIR"
echo "========================================"
echo "   ZO.DESIGN 项目自动备份程序"
echo "========================================"
echo "开始时间: $(date)"
echo "源路径: $PROJECT_DIR"
echo "目标路径: $BACKUP_DIR"
echo "----------------------------------------"
# 使用 rsync 进行增量备份
# -a: 归档模式
# -v: 详细输出
# --progress: 显示进度
# --delete: 删除备份目录中源目录已删除的文件，保持完全一致
# --exclude: 排除不需要备份的大型文件夹
rsync -av --progress --delete \
  --exclude "node_modules" \
  --exclude ".next" \
  --exclude ".git" \
  --exclude "*.log" \
  "$PROJECT_DIR/" "$BACKUP_DIR/"
echo "----------------------------------------"
echo "备份成功完成！"
echo "结束时间: $(date)"
echo "========================================"
# 保持窗口开启以便查看结果
read -p "按回车键关闭窗口..."