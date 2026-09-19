# Сайт МУП БГО ВО «Борисоглебские теплосети»

Официальный сайт муниципального унитарного предприятия: передача показаний приборов
учёта, обращения граждан, заявки на заключение договора с приложением документов,
сведения об отключениях, тарифы и раскрытие информации.

Без фреймворков и сборщиков. Работает на Node.js 18+ и запускается на VPS с 1 ГБ памяти.

---

## Как запустить

### На компьютере с Windows — двойным кликом

Открыть папку проекта и запустить **`ЗАПУСТИТЬ САЙТ.cmd`**.

Файл сам проверит Node.js, при первом запуске установит зависимости, поднимет
сервер и откроет браузер. Чтобы остановить сайт — закрыть чёрное окно.

Если Node.js не установлен, файл об этом скажет: нужна версия 18 или новее
с https://nodejs.org (обычный установщик, «Далее — Далее — Готово»).

### Из командной строки

```bash
cd server && npm install && node server.js
```

### Адреса

- Сайт: http://localhost:3000
- Панель управления: http://localhost:3000/admin
  логин `admin`, пароль — сервер сам сгенерирует временный и покажет его
  в консоли при запуске. **Для боевого сервера задайте свой в `.env`** (см. `.env.example`).

Пока сайт запущен так, он виден только на этом компьютере. Чтобы его открыли
посторонние, нужен хостинг и домен — порядок действий и цены в `СТОИМОСТЬ.md`,
техническая часть — в разделе «Развёртывание на VPS» ниже.

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

Проще — прописать `ADMIN_USER` и `ADMIN_PASS` в `.env` (скопировав `.env.example`),
тогда пароль не нужно передавать в команде запуска и он переживёт перезапуск.

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

# 2. Файлы проекта — клонируем прямо из GitHub
sudo mkdir -p /var/www/teploseti && sudo chown $USER /var/www/teploseti
git clone https://github.com/A1exxx/borisoglebsk-teploseti.git /var/www/teploseti
cd /var/www/teploseti/server && npm install --omit=dev
cp .env.example .env && nano .env   # вписать свой ADMIN_PASS
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

## Как обновить сайт после правок

Код правится и хранится в GitHub, как обычно. На сервере после `git push`
нужно подтянуть изменения и перезапустить службу:

```bash
ssh пользователь@ваш-сервер "cd /var/www/teploseti && git pull && cd server && npm install --omit=dev && sudo systemctl restart teploseti"
```

Одна команда с компьютера разработчика — сайт обновился. `.env` при этом не
трогается: он не в git, `git pull` его не перезапишет.

---

## Что настроено на боевом сервере

Сайт работает на `https://borisoglebskteplo.ru` (VPS Timeweb, Москва, IP 200.169.176.28, Ubuntu 24.04).
На этом же сервере живёт тестовый контур Теплобиллинга — **порты 80 и 443 держит только nginx**,
Теплобиллинг работает за ним (`Caddyfile.proxy`, Caddy на `127.0.0.1:8081`). Если вернуть
Теплобиллингу привязку к 443, HTTPS сайта отвалится.

| Что | Где | Проверить |
|---|---|---|
| Сайт | systemd-служба `teploseti`, Node на `127.0.0.1:3000` | `systemctl status teploseti` |
| Веб-сервер, TLS | nginx, конфиг `/etc/nginx/sites-available/teploseti` | `nginx -t` |
| Сертификат | Let's Encrypt, продлевается сам | `certbot certificates` |
| Резервные копии | ежедневно в 03:15, хранятся 14 дней в `/var/backups/teploseti` | `ls -la /var/backups/teploseti` |
| Сторож | каждые 2 минуты, перезапуск после 2 неудач подряд | `tail /var/log/teploseti-watchdog.log` |
| Защита от перебора | fail2ban, jail `sshd` | `fail2ban-client status sshd` |
| Файрвол | ufw: открыты 22, 80, 443 | `ufw status` |

### Резервное копирование

Скрипт `/usr/local/bin/backup-teploseti.sh`, расписание — `/etc/cron.d/teploseti-backup`.
Архивирует `server/data` (заявки) и `server/uploads` (приложенные файлы). Внутри персональные
данные, поэтому каталог и архивы закрыты правами `700`/`600`.

Восстановление:

```bash
systemctl stop teploseti
tar xzf /var/backups/teploseti/teploseti-ГГГГ-ММ-ДД.tar.gz -C /var/www/teploseti/server
chown -R www-data:www-data /var/www/teploseti
systemctl start teploseti
```

Копии лежат на том же диске: они спасают от ошибки в приложении и случайного удаления,
но не от отказа диска. Внешнее хранилище — отдельная задача.

### Доступ на сервер

Только по SSH-ключу: вход по паролю отключён (`/etc/ssh/sshd_config.d/00-hardening.conf`).
Файл назван с `00`, чтобы читаться раньше `50-cloud-init.conf` — в OpenSSH выигрывает
первое значение, иначе настройка не применится.

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

## Как проверить вёрстку после правок

Правка стилей легко ломает страницу на телефоне так, что на большом мониторе
этого не видно. Поэтому после любой правки `public/css/style.css` прогоняйте
проверку: она открывает каждую страницу в скрытом окне заданной ширины и ищет
элементы, которые вылезли за экран или обрезаны.

Откройте сайт в браузере, нажмите F12 → «Консоль» и вставьте:

```js
const pages = ['/','/predpriyatie.html','/tarify.html','/raskrytie.html','/oplata.html',
  '/pokazaniya.html','/otklyucheniya.html','/dogovor.html','/obrashcheniya.html','/zakupki.html',
  '/protivodeystvie-korrupcii.html','/kontakty.html','/politika.html','/karta-sayta.html',
  '/404.html','/spasibo.html'];
const audit = async (width) => {
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;left:-99999px;top:0;border:0;height:1200px;width:' + width + 'px';
  document.body.appendChild(fr);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bad = [];
  for (const p of pages) {
    fr.src = p;
    for (let i = 0; i < 50; i++) { await sleep(70); const d = fr.contentDocument;
      if (d && d.readyState !== 'loading' && d.location.pathname === p && d.body.children.length > 2) break; }
    await sleep(200);
    const d = fr.contentDocument, w = fr.contentWindow, vw = d.documentElement.clientWidth;
    d.querySelectorAll('details').forEach(x => x.open = true);
    d.querySelectorAll('body *').forEach(e => {
      if (e.closest('svg') || e.closest('.visually-hidden') || e.classList.contains('skip-link')) return;
      if (e.closest('thead') && e.closest('table.table--stack')) return;
      const cs = w.getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return;
      const r = e.getBoundingClientRect();
      if (r.right > vw + 1) bad.push([width, p, 'вылез вправо на ' + Math.round(r.right - vw) + ' px', e]);
      if (e.scrollWidth - e.clientWidth > 2 && cs.overflowX === 'hidden') bad.push([width, p, 'обрезано по ширине', e]);
    });
    if (d.documentElement.scrollWidth > vw + 1) bad.push([width, p, 'страница едет вбок', null]);
  }
  fr.remove();
  return bad;
};
for (const w of [320, 375, 768, 980, 1280]) console.table(await audit(w));
```

Пустые таблицы — всё в порядке. Единственное ожидаемое срабатывание —
`section.hero` на главной: там намеренно подрезан фоновый рисунок.

Проверяйте на пяти ширинах: 320 и 375 — телефоны, 768 — планшет,
980 — граница, после которой появляется боковая колонка, 1280 — монитор.

## Анимация и демо-версия

**Что движется и где это настраивается.**

| Что | Где |
|---|---|
| Сцена на главном экране: котельная, дома, теплотрасса | генератор `tools/hero-scene.js`, вставка в `src/pages/index.html` между метками `HERO-SCENE` |
| Стили движения, кнопка остановки сцены | `public/css/style.css`, разделы 30–31 |
| Появление блоков при прокрутке, пауза сцены за экраном | `public/js/main.js`, раздел 10 |

Движение выключается само в версии для слабовидящих и у тех, кто включил
«уменьшить движение» в настройках телефона или компьютера. У сцены есть кнопка
«Остановить анимацию» (WCAG 2.2.2): выбор запоминается в браузере.

Чтобы поменять сцену (дома, окна, трубы), правьте `tools/hero-scene.js` и
вставьте результат между метками `HERO-SCENE` в `src/pages/index.html`, затем
`node tools/build.js`. Случайность в генераторе детерминированная: повторный
запуск даёт ту же разметку.

**Демо-версия для показа без выкладки на рабочий сайт.**

```
node tools/build-demo.js
```

Собирает копию в `.demo/borisoglebsk-teploseti/`: сверху полоса «Демо-версия»,
формы не отправляются, поисковикам индексировать запрещено, отключения и
новости берутся из снимка `demo/content.json`. Рабочий `public/` не меняется.

Публикация на GitHub Pages идёт из ветки `gh-pages` (адрес
`https://a1exxx.github.io/borisoglebsk-teploseti/`):

```
git worktree add ../teploseti-gh-pages gh-pages
node tools/build-demo.js ../teploseti-gh-pages
cd ../teploseti-gh-pages && git add -A && git commit -m "Обновить демо" && git push
```

**Вариант 2 — «пульт диспетчера»** (ветка `demo/oformlenie-v2`).

| Что | Где |
|---|---|
| Шейдер: свечение трасс, тепловые импульсы, тепловой сканер, «тёплый» курсор | `public/js/hero-thermal.js` (WebGL без библиотек) |
| Контурный город и схема трасс; геометрия для шейдера в `data-network` и `data-buildings` | `node tools/hero-scene.js --thermal` |
| Панель «На сегодня»: время по Москве, приём показаний, объявленные работы | `src/pages/index.html`, `public/js/main.js` раздел 9b |
| Полоса прогресса прокрутки, подсветка карточек, моноширинные цифры | `public/css/style.css` раздел 32, `main.js` раздел 9c |

Шейдер не запускается без WebGL, при «уменьшить движение», экономии трафика,
на слабых устройствах (≤2 ядер и ≤2 ГБ памяти) и в версии для слабовидящих —
тогда показывается статичная сцена. На телефоне 30 кадров в секунду и
пониженное разрешение холста, за пределами экрана отрисовка на паузе.

Демо второго варианта собирается в подпапку `/v2/`:

```
node tools/build-demo.js ../teploseti-gh-pages --variant 2
```

**Вариант 4 — «Цифровой двойник»** (ветка `demo/oformlenie-v4`, демо в `/v4/`).

| Что | Где |
|---|---|
| Объёмная модель Борисоглебска: дома, улицы, реки, железная дорога; тепловая волна от дымовых труб по улицам; облёт камеры; кольцо и координаты под курсором | `public/js/hero-twin.js` (WebGL без библиотек) |
| Данные города — готовые файлы, сайт в OpenStreetMap не ходит | `public/data/city.bin` (компьютер, 85 КБ сжатым), `city-lite.bin` (телефон, 47 КБ) |
| Как пересобрать данные | запрос `tools/city-query.overpassql`, затем `node tools/city-data.js osm.json` |
| Тёмный первый экран, строка приборов, подписи рек, нумерация разделов | `src/pages/index.html`, `public/css/style.css` раздел 33 |
| Шрифты Geist и Geist Mono (OFL 1.1) — лежат на сайте | `public/fonts` |

Данные © участники OpenStreetMap (ODbL): ссылка на условия стоит на первом
экране. Высота домов, где в карте нет этажности, прикинута по площади и
форме; в сцене дома чуть выше настоящих, иначе с высоты объёма не видно.
Волна тепла — иллюстрация, а не схема тепловых сетей: на экране так и
написано. Предохранители те же, что у варианта 3; на телефоне загружается
облегчённый файл (радиус 1,3 км) и 30 кадров в секунду.

```
node tools/build-demo.js ../teploseti-gh-pages --variant 4
```
