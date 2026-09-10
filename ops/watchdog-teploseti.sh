#!/bin/bash
# Сторож сайта МУП «Борисоглебские теплосети».
# systemd поднимает службу, если процесс упал. Этот сторож ловит другой случай:
# процесс жив, но сайт не отвечает (зависание, утечка памяти) — тогда перезапускаем.
set -uo pipefail

URL=http://127.0.0.1:3000/
LOG=/var/log/teploseti-watchdog.log
FAILS=/run/teploseti-watchdog.fails
LIMIT=2   # перезапуск только после двух неудач подряд, чтобы не дёргать из-за случайного таймаута

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL")
[ -z "$code" ] && code=000

if [ "$code" = "200" ]; then
    [ -f "$FAILS" ] && rm -f "$FAILS"
    exit 0
fi

n=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$FAILS"
echo "$(date '+%F %T') сайт ответил $code (неудача $n из $LIMIT)" >> "$LOG"

if [ "$n" -ge "$LIMIT" ]; then
    echo "$(date '+%F %T') перезапускаю teploseti" >> "$LOG"
    systemctl restart teploseti
    rm -f "$FAILS"
    sleep 5
    after=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL" || echo 000)
    echo "$(date '+%F %T') после перезапуска: $after" >> "$LOG"
fi
