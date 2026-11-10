#!/bin/bash
# 安装每小时自动备份（macOS launchd）
#
# 用法: bash scripts/install-backup-cron.sh
# 卸载: bash scripts/install-backup-cron.sh --uninstall
#
# 安装后会每 30 分钟自动导出一次 Supabase 数据到 ~/Backups/trello-app/
# 即使云端被误覆盖，也能从最近一次快照恢复。

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.trelloapp.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Backups/trello-app-logs"

if [ "$1" = "--uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ 已卸载自动备份"
  exit 0
fi

# 检查 node 路径
NODE_BIN="$(which node)"
if [ -z "$NODE_BIN" ]; then
  echo "✗ 找不到 node，请先安装 Node.js"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROJECT_DIR/scripts/backup-snapshot.mjs</string>
    <string>--keep</string>
    <string>100</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/backup.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/backup-error.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✓ 已安装自动备份（每 30 分钟一次）"
echo "  备份位置: $HOME/Backups/trello-app/"
echo "  日志:     $LOG_DIR/backup.log"
echo ""
echo "  立即测试一次:  launchctl start $LABEL"
echo "  查看日志:      tail -f $LOG_DIR/backup.log"
echo "  卸载:          bash scripts/install-backup-cron.sh --uninstall"
