# Эксплуатация сервера

Копии того, что реально работает на боевом сервере (200.169.176.28). Файлы здесь —
источник правды: если правите на сервере, обновите и тут, иначе через полгода никто
не вспомнит, откуда что взялось.

| Файл | Куда ставится на сервере | Что делает |
|---|---|---|
| `backup-teploseti.sh` | `/usr/local/bin/`, расписание `/etc/cron.d/teploseti-backup` | Ежедневно в 03:15 архивирует заявки и загруженные файлы, хранит 14 дней |
| `watchdog-teploseti.sh` | `/usr/local/bin/`, расписание `/etc/cron.d/teploseti-watchdog` | Каждые 2 минуты проверяет сайт, после двух неудач подряд перезапускает службу |
| `nginx-teploseti.conf` | `/etc/nginx/sites-available/teploseti` | Оба сайта на сервере: МУП (HTTPS, заголовки безопасности) и тестовый контур Теплобиллинга |

Установка после переезда на новый сервер:

```bash
install -m 755 ops/backup-teploseti.sh   /usr/local/bin/
install -m 755 ops/watchdog-teploseti.sh /usr/local/bin/
echo '15 3 * * * root /usr/local/bin/backup-teploseti.sh >> /var/log/teploseti-backup.log 2>&1' > /etc/cron.d/teploseti-backup
echo '*/2 * * * * root /usr/local/bin/watchdog-teploseti.sh' > /etc/cron.d/teploseti-watchdog
chmod 644 /etc/cron.d/teploseti-backup /etc/cron.d/teploseti-watchdog
```

Конфиг nginx копировать дословно не стоит: пути к сертификатам в нём привязаны к домену,
после переезда их проще получить заново через `certbot --nginx`.
