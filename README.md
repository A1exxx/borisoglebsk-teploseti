# Сайт МУП БГО ВО «Борисоглебские теплосети»

Официальный сайт муниципального унитарного предприятия: передача показаний приборов
учёта, обращения граждан, заявки на заключение договора с приложением документов,
сведения об отключениях, тарифы и раскрытие информации.

Без фреймворков и сборщиков. Работает на Node.js 18+ и запускается на VPS с 1 ГБ памяти.

---

## Быстрый запуск

```bash
cd server && npm install && node server.js
```

- Сайт: http://localhost:3000
- Панель управления: http://localhost:3000/admin (логин `admin`, пароль `teplo2026` — **сменить перед публикацией**)

---

## Структура

```
borisoglebsk-teploseti/
├── src/                     ← ИСХОДНИКИ СТРАНИЦ (правим здесь)
│   ├── data.json            ← реквизиты, телефоны, режим работы
│   ├── layout.html          ← шапка, меню, подвал (общие для всех страниц)
│   └── pages/*.html         ← содержимое страниц
├── tools/build.js           ← сборка src → public
├── public/                  ← ГОТОВЫЙ САЙТ (генерируется, руками не править)
│   ├── *.html
│   ├── css/style.css
│   ├── js/main.js
│   ├── img/
│   └── docs/                ← PDF-документы предприятия
│       └── _scans/          ← исходные постраничные сканы
└── server/
    ├── server.js            ← сервер: статика, приём заявок, API панели
    ├── admin/index.html     ← панель управления
    ├── data/                ← заявки (NDJSON) и содержимое лент (content.json)
    └── uploads/             ← файлы, приложенные абонентами
```

**Правило:** файлы в `public/*.html` перезаписываются сборкой. Менять нужно `src/`,
затем выполнять `node tools/build.js`.

---

## Как поменять телефоны и реквизиты

1. Открыть `src/data.json`.
2. Заменить значения `???` на фактические.
3. Выполнить сборку:

```bash
node tools/build.js
```

Команда выведет список полей, которые ещё не заполнены. На самом сайте они видны
как подсвеченные пометки «уточняется» — незаполненное не прячется, а остаётся на виду.

---

## Как публиковать отключения и новости

Через панель управления: http://localhost:3000/admin → вкладка «Отключения и новости».
Сборку после этого запускать не нужно — содержимое подгружается на страницы сразу.

Там же:

- **Объявление в шапке** — полоса на всех страницах, три уровня важности. Пустой текст убирает полосу.
- **Отключения** — тип работ, адреса, причина, начало и плановое окончание. Записи со статусом «Завершено» с сайта пропадают, но сохраняются в файле.
- **Новости** — дата, заголовок, текст, отметка «важное».

Данные лежат в `server/data/content.json`.

---

## Заявки от абонентов

Вкладки «Показания», «Обращения», «Заявки на договор» в панели. По каждой заявке:
номер, дата, все поля, приложенные файлы, переключатель статуса
(новая / в работе / обработана). Кнопка «Выгрузить в CSV» отдаёт файл для Excel.

Хранение — `server/data/*.ndjson`, одна заявка на строку. Приложенные файлы —
`server/uploads/ГГГГ-ММ/<идентификатор>/`.

> В `server/data/` сейчас лежат тестовые заявки, созданные при проверке форм,
> и демонстрационные записи в `content.json`. Перед вводом в эксплуатацию их
> следует удалить или заменить.

---

## Перед публикацией в интернете

### 1. Сменить пароль панели

```bash
ADMIN_USER=teploseti ADMIN_PASS='длинный-пароль' node server.js
```

Пароль по умолчанию (`teplo2026`) публиковать нельзя.

### 2. Настроить HTTPS

Панель работает по Basic-авторизации: без HTTPS пароль передаётся открытым текстом.
Формы принимают персональные данные, поэтому HTTPS обязателен.

### 3. Проверить требования 152-ФЗ

- Сервер и хранилище — на территории Российской Федерации.
- Утвердить приказом директора политику обработки персональных данных (`src/pages/politika.html` — заготовка, требует проверки юристом).
- Подать уведомление в Роскомнадзор об обработке персональных данных.

---

## Развёртывание на VPS (Ubuntu)

```bash
# 1. Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx

# 2. Файлы проекта
sudo mkdir -p /var/www/teploseti && sudo chown $USER /var/www/teploseti
# скопировать содержимое папки проекта в /var/www/teploseti
cd /var/www/teploseti/server && npm install --omit=dev
```

Служба `/etc/systemd/system/teploseti.service`:

```ini
[Unit]
Description=Сайт МУП «Борисоглебские теплосети»
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/teploseti/server
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Environment=ADMIN_USER=teploseti
Environment=ADMIN_PASS=ЗАМЕНИТЬ_НА_СВОЙ_ПАРОЛЬ
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now teploseti
```

Nginx `/etc/nginx/sites-available/teploseti`:

```nginx
server {
    listen 80;
    server_name ВАШ-ДОМЕН.ru www.ВАШ-ДОМЕН.ru;

    client_max_body_size 12M;   # приложения к заявкам

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/teploseti /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ВАШ-ДОМЕН.ru -d www.ВАШ-ДОМЕН.ru
```

`client_max_body_size 12M` обязателен: без него nginx отклонит заявку с документами
раньше, чем её увидит приложение.

---

## Резервное копирование

Копировать нужно две папки — в них всё, что накопил сайт:

```bash
tar czf backup-$(date +%F).tar.gz server/data server/uploads
```

Ежедневно через cron:

```
0 3 * * * cd /var/www/teploseti && tar czf /var/backups/teploseti-$(date +\%F).tar.gz server/data server/uploads
```

---

## Что заложено в сайте

| Возможность | Где |
|---|---|
| Передача показаний приборов учёта | `/pokazaniya.html` |
| Обращения граждан (59-ФЗ), срок 30 дней | `/obrashcheniya.html` |
| Заявка на договор с загрузкой документов | `/dogovor.html` |
| Отключения и работы, поиск по адресу | `/otklyucheniya.html` |
| Тарифы и порядок их установления | `/tarify.html` |
| Раскрытие информации по ПП РФ № 110 | `/raskrytie.html` |
| Версия для слабовидящих (3 схемы, 3 размера) | кнопка в шапке |
| Работа форм без JavaScript | все формы |

**Ограничения по файлам:** до 10 файлов на заявку, каждый до 10 МБ, форматы
PDF, JPG, PNG, HEIC, DOC, DOCX, XLS, XLSX, RTF, ODT. Исполняемые файлы отклоняются.

**Защита форм:** ограничение частоты (25 отправок с одного адреса за 10 минут),
скрытое поле-ловушка от роботов, серверная проверка всех полей.
