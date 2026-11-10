#!/bin/bash
# 安装自动备份（macOS launchd）
#
# 用法:
#   bash scripts/install-backup-cron.sh              # 默认每 5 分钟
#   bash scripts/install-backup-cron.sh --every 10   # 指定间隔（分钟）
#   bash scripts/install-backup-cron.sh --keep 500   # 保留份数
#   bash scripts/install-backup-cron.sh --uninstall  # 卸载
#
# 实测开销（6 看板 / 82 卡片）：
#   单份快照 784KB，单次耗时约 4 秒
#   每 5 分钟 + 保留 500 份 ≈ 380MB（约 1.7 天的每5分钟粒度）

set -e

INTERVAL_MIN=5
KEEP=500

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1; shift ;;
    --every) INTERVAL_MIN="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) shift ;;
  esac
done

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.trelloapp.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Backups/trello-app-logs"

if [ "$UNINSTALL" = "1" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ 已卸载自动备份"
  exit 0
fi

NODE_BIN="$(which node)"
if [ -z "$NODE_BIN" ]; then
  echo "✗ 找不到 node，请先安装 Node.js"
  exit 1
fi

INTERVAL_SEC=$((INTERVAL_MIN * 60))

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
    <string>$KEEP</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>
  <key>StartInterval</key>
  <integer>$INTERVAL_SEC</integer>
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

echo "✓ 已安装自动备份"
echo "  间隔:     每 $INTERVAL_MIN 分钟一次"
echo "  保留:     最近 $KEEP 份"
echo "  备份位置: $HOME/Backups/trello-app/"
echo "  日志:     $LOG_DIR/backup.log"
echo ""
echo "  立即测试:  launchctl start $LABEL"
echo "  查看日志:  tail -f $LOG_DIR/backup.log"
echo "  修改间隔:  bash scripts/install-backup-cron.sh --every 10"
echo "  卸载:      bash scripts/install-backup-cron.sh --uninstall"

