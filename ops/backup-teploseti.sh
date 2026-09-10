#!/bin/bash
# Ежедневная копия заявок и приложенных файлов сайта МУП «Борисоглебские теплосети».
# Хранится 14 дней. Внутри — персональные данные, поэтому каталог закрыт от чужих глаз.
set -euo pipefail

SRC=/var/www/teploseti/server
DST=/var/backups/teploseti
KEEP=14

mkdir -p "$DST"
chmod 700 "$DST"

STAMP=$(date +%F)
ARCHIVE="$DST/teploseti-$STAMP.tar.gz"

tar -czf "$ARCHIVE" \
    -C "$SRC" \
    --exclude='node_modules' \
    data uploads 2>/dev/null || true

chmod 600 "$ARCHIVE"

# Чистим старее KEEP дней
find "$DST" -name 'teploseti-*.tar.gz' -mtime +$KEEP -delete

echo "$(date '+%F %T') backup ok: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
