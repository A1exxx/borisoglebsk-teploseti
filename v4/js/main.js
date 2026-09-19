/* МУП БГО ВО «Борисоглебские теплосети» — клиентские скрипты.
   Принцип: без JS сайт остаётся работоспособным. Формы отправляются
   обычным POST, JS лишь добавляет проверку на месте и отправку без
   перезагрузки. Внешних библиотек нет. */
(function () {
  'use strict';

  /* ---------- 1. Версия для слабовидящих ---------- */

  var VISION_KEY = 'bgts-vision';
  var root = document.documentElement;
  // Демо-копия на GitHub Pages открывается не из корня домена, а из
  // /borisoglebsk-teploseti/ — сборка передаёт этот путь в data-base.
  var BASE = root.getAttribute('data-base') || '';

  function applyVision(state) {
    if (!state || !state.on) {
      root.removeAttribute('data-vision');
      root.removeAttribute('data-scheme');
      root.removeAttribute('data-size');
      return;
    }
    root.setAttribute('data-vision', 'on');
    root.setAttribute('data-scheme', state.scheme || 'bw');
    root.setAttribute('data-size', state.size || 'm');
  }

  function loadVision() {
    try {
      return JSON.parse(localStorage.getItem(VISION_KEY)) || { on: false };
    } catch (e) {
      return { on: false };
    }
  }

  function saveVision(state) {
    try { localStorage.setItem(VISION_KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
  }

  var vision = loadVision();
  applyVision(vision);

  function syncVisionButtons() {
    document.querySelectorAll('[data-vision-scheme]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(vision.on && vision.scheme === btn.dataset.visionScheme));
    });
    document.querySelectorAll('[data-vision-size]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(vision.on && (vision.size || 'm') === btn.dataset.visionSize));
    });
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-vision-toggle]');
    if (toggle) {
      e.preventDefault();
      vision.on = !vision.on;
      if (vision.on && !vision.scheme) { vision.scheme = 'bw'; vision.size = 'l'; }
      applyVision(vision); saveVision(vision); syncVisionButtons();
      var panel = document.getElementById('vision-panel');
      if (panel) panel.setAttribute('data-open', String(vision.on));
      toggle.setAttribute('aria-expanded', String(vision.on));
      return;
    }
    var scheme = e.target.closest('[data-vision-scheme]');
    if (scheme) {
      vision.on = true; vision.scheme = scheme.dataset.visionScheme;
      applyVision(vision); saveVision(vision); syncVisionButtons();
      return;
    }
    var size = e.target.closest('[data-vision-size]');
    if (size) {
      vision.on = true; vision.size = size.dataset.visionSize;
      applyVision(vision); saveVision(vision); syncVisionButtons();
      return;
    }
    var off = e.target.closest('[data-vision-off]');
    if (off) {
      e.preventDefault();
      vision = { on: false };
      applyVision(vision); saveVision(vision); syncVisionButtons();
      var p = document.getElementById('vision-panel');
      if (p) p.setAttribute('data-open', 'false');
      var t = document.querySelector('[data-vision-toggle]');
      if (t) t.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    syncVisionButtons();
    var panel = document.getElementById('vision-panel');
    if (panel && vision.on) panel.setAttribute('data-open', 'true');
    var t = document.querySelector('[data-vision-toggle]');
    if (t && vision.on) t.setAttribute('aria-expanded', 'true');
  });

  /* ---------- 2. Мобильное меню ---------- */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-nav-toggle]');
    if (!btn) return;
    var nav = document.getElementById('mainnav');
    if (!nav) return;
    var open = nav.getAttribute('data-open') !== 'true';
    nav.setAttribute('data-open', String(open));
    btn.setAttribute('aria-expanded', String(open));
  });

  /* ---------- 3. Формы ---------- */

  var MESSAGES = {
    required: 'Заполните это поле',
    phone: 'Введите номер в формате +7 (999) 123-45-67',
    email: 'Проверьте адрес: в нём должны быть знак @ и точка',
    reading: 'Показание вводится цифрами, например 1245,300',
    inn: 'ИНН состоит из 10 цифр (организация) или 12 (индивидуальный предприниматель)',
    short: 'Слишком короткий текст — опишите подробнее'
  };

  function fieldError(input, text) {
    var wrap = input.closest('.field') || input.parentElement;
    var box = wrap ? wrap.querySelector('.err') : null;
    if (text) {
      input.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = text; box.setAttribute('data-show', 'true'); }
    } else {
      input.removeAttribute('aria-invalid');
      if (box) { box.textContent = ''; box.setAttribute('data-show', 'false'); }
    }
  }

  function validateField(input) {
    var value = (input.value || '').trim();
    var type = input.dataset.validate || '';

    if (input.required && !value && input.type !== 'checkbox') {
      fieldError(input, input.dataset.msgRequired || MESSAGES.required);
      return false;
    }
    if (input.type === 'checkbox' && input.required && !input.checked) {
      fieldError(input, input.dataset.msgRequired || MESSAGES.required);
      return false;
    }
    if (value) {
      if (type === 'phone' && !/^\+?[\d\s().-]{10,20}$/.test(value)) { fieldError(input, MESSAGES.phone); return false; }
      if (type === 'email' && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(value)) { fieldError(input, MESSAGES.email); return false; }
      if (type === 'reading' && !/^\d{1,9}([.,]\d{1,4})?$/.test(value)) { fieldError(input, MESSAGES.reading); return false; }
      if (type === 'inn' && !/^(\d{10}|\d{12})$/.test(value)) { fieldError(input, MESSAGES.inn); return false; }
      if (input.minLength > 0 && value.length < input.minLength) { fieldError(input, MESSAGES.short); return false; }
    }
    fieldError(input, null);
    return true;
  }

  // Проверяем на blur, а не на каждый символ: подсказка во время набора мешает.
  document.addEventListener('blur', function (e) {
    var el = e.target;
    if (el.matches && el.matches('.control[required], .control[data-validate]')) validateField(el);
  }, true);

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches && el.matches('input[type="checkbox"][required]')) validateField(el);
  });

  function setNote(form, kind, title, text) {
    // Плашка обычно стоит перед формой, а не внутри неё, поэтому ищем шире.
    var note = form.querySelector('.formnote')
      || (form.parentElement && form.parentElement.querySelector('.formnote'))
      || document.querySelector('.formnote');
    if (!note) return;
    note.className = 'formnote formnote--' + kind;
    note.setAttribute('data-show', 'true');
    note.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    note.innerHTML = '';
    var body = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = title;
    var p = document.createElement('p');
    p.textContent = text;
    body.appendChild(strong); body.appendChild(p);
    note.appendChild(body);
    note.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.querySelectorAll('form[data-ajax]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (root.getAttribute('data-demo') === '1') {
        e.preventDefault();
        setNote(form, 'err', 'Это демо-версия сайта',
          'Формы здесь не отправляются. Показания и обращения принимает официальный сайт borisoglebskteplo.ru.');
        return;
      }
      var fields = form.querySelectorAll('.control[required], .control[data-validate], input[type="checkbox"][required]');
      var firstBad = null;
      fields.forEach(function (f) { if (!validateField(f) && !firstBad) firstBad = f; });

      if (firstBad) {
        e.preventDefault();
        setNote(form, 'err', 'Форма не отправлена', 'Проверьте поля, отмеченные красным. Первое из них — ниже.');
        firstBad.focus();
        return;
      }

      if (!window.fetch || !window.FormData) return; // старый браузер — обычная отправка

      e.preventDefault();
      var btn = form.querySelector('[type="submit"]');
      var label = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Отправляем…';
      }

      // Форму без вложений отправляем как urlencoded. FormData всегда даёт
      // multipart, который разбирает только загрузчик файлов, — форма
      // показаний из-за этого приходила на сервер пустой.
      var hasFiles = Array.prototype.some.call(
        form.querySelectorAll('input[type="file"]'),
        function (input) { return input.files && input.files.length > 0; }
      );
      var payload = new FormData(form);
      var headers = { 'X-Requested-With': 'fetch', 'Accept': 'application/json' };
      if (!hasFiles) {
        payload = new URLSearchParams(payload);
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }

      fetch(form.action, { method: 'POST', body: payload, headers: headers })
        .then(function (r) { return r.json().catch(function () { return { ok: false, message: 'Сервер вернул неожиданный ответ' }; }); })
        .then(function (data) {
          if (data.ok) {
            var target = form.dataset.successTarget && document.querySelector(form.dataset.successTarget);
            if (target) {
              target.hidden = false;
              var num = target.querySelector('[data-ticket]');
              if (num) num.textContent = data.ticket || '';
              form.hidden = true;
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              target.setAttribute('tabindex', '-1');
              target.focus({ preventScroll: true });
            } else {
              setNote(form, 'ok', 'Отправлено. Номер заявки ' + (data.ticket || ''), data.message || '');
              form.reset();
            }
          } else {
            if (data.errors) {
              var first = null;
              Object.keys(data.errors).forEach(function (name) {
                var input = form.querySelector('[name="' + name + '"]');
                if (input) { fieldError(input, data.errors[name]); if (!first) first = input; }
              });
              if (first) first.focus();
            }
            setNote(form, 'err', 'Заявка не отправлена', data.message || 'Проверьте заполнение формы.');
          }
        })
        .catch(function () {
          setNote(form, 'err', 'Нет связи с сервером',
            'Проверьте подключение к интернету и попробуйте ещё раз. Показания также принимает абонентский отдел по телефону — он указан в разделе «Контакты».');
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.innerHTML = label; }
        });
    });
  });

  /* ---------- 4. Загрузка файлов ---------- */

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  }

  document.querySelectorAll('.dropzone').forEach(function (zone) {
    var input = zone.querySelector('input[type="file"]');
    var list = zone.querySelector('.filelist');
    if (!input || !list) return;

    function render() {
      list.innerHTML = '';
      var total = 0;
      Array.prototype.forEach.call(input.files, function (file) {
        total += file.size;
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.textContent = file.name;
        var size = document.createElement('span');
        size.className = 'num';
        size.textContent = humanSize(file.size);
        li.appendChild(name); li.appendChild(size);
        list.appendChild(li);
      });
      if (input.files.length) {
        var li = document.createElement('li');
        li.innerHTML = '<strong>Всего файлов: ' + input.files.length + '</strong><span class="num">' + humanSize(total) + '</span>';
        list.appendChild(li);
      }
      var err = zone.parentElement && zone.parentElement.querySelector('.err');
      if (err && input.files.length) { err.textContent = ''; err.setAttribute('data-show', 'false'); }
    }

    input.addEventListener('change', render);

    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.setAttribute('data-over', 'true'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.setAttribute('data-over', 'false'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; render(); }
    });
  });

  /* ---------- 5. Переключение «физлицо / юрлицо» ---------- */

  document.querySelectorAll('[data-switch-group]').forEach(function (group) {
    var name = group.dataset.switchGroup;
    function sync() {
      var checked = group.querySelector('input[name="' + name + '"]:checked');
      var value = checked ? checked.value : null;
      document.querySelectorAll('[data-switch-case]').forEach(function (block) {
        var match = block.dataset.switchCase.split(' ').indexOf(value) !== -1;
        block.hidden = !match;
        block.querySelectorAll('input, select, textarea').forEach(function (f) {
          if (f.dataset.reqWhen) f.required = match && f.dataset.reqWhen === 'on';
          f.disabled = !match;
        });
      });
    }
    group.addEventListener('change', sync);
    sync();
  });

  /* ---------- 6. Живой контент: отключения, новости, объявление ---------- */

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  var TYPE_LABEL = { emergency: 'Аварийная', planned: 'Плановая', hydraulic: 'Гидравлические испытания', season: 'Отопительный сезон' };
  var TYPE_BADGE = { emergency: 'badge--danger', planned: 'badge--warn', hydraulic: 'badge--info', season: 'badge--info' };

  function renderOutages(list, items) {
    var tbody = list.querySelector('tbody');
    if (!tbody) return;
    var limit = Number(list.dataset.limit) || items.length;
    var active = items.filter(function (o) { return o.status !== 'done'; }).slice(0, limit);

    var empty = document.querySelector(list.dataset.emptyTarget || '#outages-empty');
    if (!active.length) {
      if (empty) empty.hidden = false;
      list.hidden = true;
      return;
    }
    // Плашка «Действующих ограничений нет» видна в разметке по умолчанию.
    // Без этой строки она оставалась под таблицей с текущими работами.
    if (empty) empty.hidden = true;
    tbody.innerHTML = '';
    active.forEach(function (o) {
      var tr = document.createElement('tr');

      var tdType = document.createElement('td');
      tdType.setAttribute('data-th', 'Тип работ');
      var badge = document.createElement('span');
      badge.className = 'badge badge--dot ' + (TYPE_BADGE[o.type] || 'badge--info');
      badge.textContent = TYPE_LABEL[o.type] || 'Работы';
      tdType.appendChild(badge);

      var tdAddr = document.createElement('td');
      tdAddr.setAttribute('data-th', 'Адреса');
      tdAddr.textContent = o.addresses || '';

      var tdReason = document.createElement('td');
      tdReason.setAttribute('data-th', 'Причина');
      tdReason.textContent = o.reason || '';

      var tdStart = document.createElement('td');
      tdStart.setAttribute('data-th', 'Начало');
      tdStart.className = 'num';
      tdStart.textContent = fmtDateTime(o.start);

      var tdEnd = document.createElement('td');
      tdEnd.setAttribute('data-th', 'Плановое окончание');
      tdEnd.className = 'num';
      tdEnd.textContent = fmtDateTime(o.end);

      tr.append(tdType, tdAddr, tdReason, tdStart, tdEnd);
      tbody.appendChild(tr);
    });
    list.hidden = false;
  }

  function renderNews(container, items) {
    var limit = Number(container.dataset.limit) || items.length;
    var sorted = items.slice().sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.date || '').localeCompare(a.date || '');
    }).slice(0, limit);

    if (!sorted.length) {
      container.innerHTML = '<li class="empty"><p>Новостей пока нет.</p></li>';
      return;
    }
    container.innerHTML = '';
    sorted.forEach(function (n) {
      var li = document.createElement('li');
      var art = document.createElement('article');
      art.className = 'newsitem';

      var meta = document.createElement('div');
      meta.className = 'newsitem__meta';
      var date = document.createElement('time');
      date.className = 'newsitem__date';
      date.dateTime = n.date || '';
      date.textContent = fmtDate(n.date);
      meta.appendChild(date);
      if (n.pinned) {
        var pin = document.createElement('span');
        pin.className = 'badge badge--info';
        pin.textContent = 'Важно';
        meta.appendChild(pin);
      }

      var title = document.createElement('h3');
      title.className = 'newsitem__title';
      title.textContent = n.title || '';

      var text = document.createElement('p');
      text.className = 'newsitem__text';
      text.textContent = n.text || '';

      art.append(meta, title, text);
      li.appendChild(art);
      container.appendChild(li);
    });
  }

  function renderAnnouncement(a) {
    var bar = document.getElementById('announcement');
    if (!bar || !a || !a.text) return;
    bar.className = 'alertbar alertbar--' + (a.level || 'info');
    var textEl = bar.querySelector('[data-announce-text]');
    if (textEl) textEl.textContent = a.text;
    var link = bar.querySelector('[data-announce-link]');
    if (link) {
      if (a.link) { link.href = a.link; link.hidden = false; } else { link.hidden = true; }
    }
    bar.hidden = false;
  }

  /* Поиск по адресу на странице отключений */
  var allOutages = [];

  function applyOutageFilter() {
    var input = document.querySelector('[data-outage-filter]');
    var query = input ? input.value.trim().toLowerCase() : '';
    var matched = query
      ? allOutages.filter(function (o) {
          return ((o.addresses || '') + ' ' + (o.reason || '')).toLowerCase().indexOf(query) !== -1;
        })
      : allOutages;

    var nomatch = document.getElementById('outages-nomatch');
    var empty = document.getElementById('outages-empty');
    var showNoMatch = Boolean(query) && matched.length === 0 && allOutages.length > 0;

    if (nomatch) nomatch.hidden = !showNoMatch;
    if (empty) empty.hidden = showNoMatch || allOutages.length > 0;

    document.querySelectorAll('[data-outages]').forEach(function (el) {
      if (showNoMatch) { el.hidden = true; return; }
      renderOutages(el, matched);
      if (empty && matched.length) empty.hidden = true;
    });
  }

  document.addEventListener('input', function (e) {
    if (e.target.matches && e.target.matches('[data-outage-filter]')) applyOutageFilter();
  });

  var needsContent = document.querySelector('[data-outages], [data-news], #announcement');
  if (needsContent && window.fetch) {
    fetch(BASE + '/api/content', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderAnnouncement(data.announcement);
        allOutages = data.outages || [];
        document.querySelectorAll('[data-outages]').forEach(function (el) { renderOutages(el, allOutages); });
        document.querySelectorAll('[data-news]').forEach(function (el) { renderNews(el, data.news || []); });
        document.dispatchEvent(new CustomEvent('site:outages', { detail: { items: allOutages } }));
      })
      .catch(function () {
        document.dispatchEvent(new CustomEvent('site:outages', { detail: { error: true } }));
        document.querySelectorAll('[data-outages]').forEach(function (el) {
          var empty = document.querySelector(el.dataset.emptyTarget || '#outages-empty');
          if (empty) { empty.hidden = false; empty.querySelector('p').textContent = 'Не удалось загрузить сведения о работах. Телефон аварийно-диспетчерской службы указан в разделе «Контакты».'; }
          el.hidden = true;
        });
      });
  }

  /* ---------- 7. Копирование реквизитов ---------- */

  // Бухгалтеру нужны реквизиты целиком, а не по одной строке из таблицы.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy-rekvizity]');
    if (!btn) return;

    var table = document.querySelector('#rekvizity ~ .tablewrap table')
      || btn.closest('div').previousElementSibling.querySelector('table');
    if (!table) return;

    var lines = [];
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      var name = tr.cells[0] && tr.cells[0].textContent.trim();
      var value = tr.cells[1] && tr.cells[1].textContent.trim();
      if (name && value) lines.push(name + ': ' + value);
    });
    var text = lines.join(String.fromCharCode(10));

    var status = document.querySelector('[data-copy-status]');
    function done(msg) {
      if (status) {
        status.textContent = msg;
        setTimeout(function () { status.textContent = ''; }, 4000);
      }
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(function () { done('Реквизиты скопированы'); })
        .catch(function () { done('Не удалось скопировать — выделите таблицу вручную'); });
    } else {
      // http без TLS: clipboard API недоступен, остаётся старый способ
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        done(document.execCommand('copy') ? 'Реквизиты скопированы' : 'Не удалось скопировать — выделите таблицу вручную');
      } catch (err) {
        done('Не удалось скопировать — выделите таблицу вручную');
      }
      document.body.removeChild(ta);
    }
  });

  /* ---------- 8. Ошибка из адресной строки (отправка без JS) ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    var error = params.get('error');
    if (!error) return;
    var form = document.querySelector('form[data-ajax]');
    if (form) setNote(form, 'err', 'Заявка не отправлена', error);
  });

  /* ---------- 9. Текущий раздел в меню ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    var here = window.location.pathname.replace(/\/index\.html$/, '/');
    document.querySelectorAll('.nav__link').forEach(function (link) {
      var href = link.getAttribute('href');
      if (href === here || (href !== BASE + '/' && here.indexOf(href) === 0)) {
        link.setAttribute('aria-current', 'page');
      }
    });
  });

  /* ---------- 9a. Переключатель вариантов в демо ---------- */

  document.querySelectorAll('[data-variant-base]').forEach(function (link) {
    var page = window.location.pathname.slice(BASE.length) || '/';
    link.href = window.location.origin + link.getAttribute('data-variant-base') + page;
  });

  /* ---------- 9b. Панель «На сегодня» (вариант 2 первого экрана) ---------- */

  // Только настоящие сведения: время по Москве, окно приёма показаний из
  // настроек сайта и число объявленных работ из того же источника, что и
  // таблица отключений. Ничего не выдумываем и не называем «онлайн-данными».
  var statusPanel = document.querySelector('[data-status]');
  if (statusPanel) {
    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var moscowNow = function () {
      var parts = {};
      try {
        new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric', day: 'numeric',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
      } catch (err) {
        var local = new Date();
        parts = { year: local.getFullYear(), month: local.getMonth() + 1, day: local.getDate(), hour: local.getHours(), minute: local.getMinutes() };
      }
      return {
        y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
        time: ('0' + Number(parts.hour)).slice(-2) + ':' + ('0' + Number(parts.minute)).slice(-2),
      };
    };
    var setRow = function (row, text, tone) {
      if (!row) return;
      var value = row.querySelector('[data-value]');
      var dot = row.querySelector('.status__dot');
      if (value) value.textContent = text;
      if (dot) dot.setAttribute('data-tone', tone);
    };
    var plural = function (n, one, few, many) {
      var n10 = n % 10, n100 = n % 100;
      if (n10 === 1 && n100 !== 11) return one;
      if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
      return many;
    };
    var clock = statusPanel.querySelector('[data-status-clock]');
    var from = Number(statusPanel.getAttribute('data-from'));
    var to = Number(statusPanel.getAttribute('data-to'));
    // Полоска месяца: окно приёма показаний и отметка «сегодня» (варианты 3–4)
    var strip = statusPanel.querySelector('[data-status-month]');

    var tick = function () {
      var now = moscowNow();
      if (clock) clock.textContent = now.d + ' ' + MONTHS[now.m - 1] + ', ' + now.time + ' МСК';
      if (strip && from && to && now.y) {
        strip.style.setProperty('--days', String(new Date(now.y, now.m, 0).getDate()));
        strip.style.setProperty('--from', String(from));
        strip.style.setProperty('--to', String(to));
        strip.style.setProperty('--today', String(now.d));
        strip.hidden = false;
      }
      if (from && to) {
        var row = statusPanel.querySelector('[data-status-readings]');
        if (now.d >= from && now.d <= to) {
          setRow(row, 'идёт до ' + to + ' ' + MONTHS[now.m - 1], 'ok');
        } else {
          var month = now.d < from ? now.m - 1 : now.m % 12;
          setRow(row, 'с ' + from + ' по ' + to + ' ' + MONTHS[month], 'idle');
        }
      }
    };
    tick();
    setInterval(tick, 20000);

    document.addEventListener('site:outages', function (e) {
      var row = statusPanel.querySelector('[data-status-outages]');
      if (e.detail.error) { setRow(row, 'нет связи с сервером', 'idle'); return; }
      var active = (e.detail.items || []).filter(function (o) { return o.status !== 'done'; }).length;
      if (!active) setRow(row, 'штатный режим', 'ok');
      else setRow(row, 'объявлено: ' + active + ' ' + plural(active, 'работа', 'работы', 'работ'), 'warn');
    });
  }

  /* ---------- 9c. Подсветка карточки за курсором (вариант 2) ---------- */

  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches && document.querySelector('.svc')) {
    var spotEvent = null;
    var spotFrame = 0;
    document.addEventListener('pointermove', function (e) {
      spotEvent = e;
      if (spotFrame) return;
      spotFrame = requestAnimationFrame(function () {
        spotFrame = 0;
        var card = spotEvent.target && spotEvent.target.closest ? spotEvent.target.closest('.svc') : null;
        if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (spotEvent.clientX - r.left) + 'px');
        card.style.setProperty('--my', (spotEvent.clientY - r.top) + 'px');
      });
    }, { passive: true });
  }

  /* ---------- 10. Движение ---------- */

  // Появление блоков при прокрутке, пауза сцены главного экрана, когда её не
  // видно, и один сигнал блока аварийной службы. Только если человек не просил
  // уменьшить движение и не включил версию для слабовидящих.
  (function () {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;

    var scene = document.querySelector('[data-scene]') || document.querySelector('.hero__scene');
    var stopBtn = document.querySelector('[data-scene-toggle]');
    if (scene && stopBtn) {
      var STOP_KEY = 'bgts-scene-stopped';
      var setStopped = function (stopped) {
        if (stopped) scene.setAttribute('data-stopped', ''); else scene.removeAttribute('data-stopped');
        stopBtn.setAttribute('aria-pressed', String(stopped));
        stopBtn.title = stopped ? 'Запустить анимацию' : 'Остановить анимацию';
      };
      var wasStopped = false;
      try { wasStopped = localStorage.getItem(STOP_KEY) === '1'; } catch (e) { /* приватный режим */ }
      setStopped(wasStopped);
      stopBtn.hidden = false;
      stopBtn.addEventListener('click', function () {
        var next = stopBtn.getAttribute('aria-pressed') !== 'true';
        setStopped(next);
        try { localStorage.setItem(STOP_KEY, next ? '1' : '0'); } catch (e) { /* приватный режим */ }
      });
    }
    if (scene) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) entry.target.removeAttribute('data-paused');
          else entry.target.setAttribute('data-paused', '');
        });
      }).observe(scene);
    }

    if (root.getAttribute('data-vision') === 'on') return;

    var SELECTOR = '.sec-head, .svc, .card, .panel, .aside-block, .emergency, .steps > li, .acc, .doclist > li, .tablewrap, .contact-card';
    var fold = window.innerHeight * 0.92;
    var perParent = [];

    function indexIn(parent) {
      for (var k = 0; k < perParent.length; k++) {
        if (perParent[k].parent === parent) return perParent[k].count++;
      }
      perParent.push({ parent: parent, count: 1 });
      return 0;
    }

    function reveal(el) {
      observer.unobserve(el);
      el.classList.add('is-in');
      var i = Number(el.style.getPropertyValue('--i')) || 0;
      if (el.classList.contains('emergency')) {
        setTimeout(function () { el.classList.add('is-attn'); }, 450);
        el.addEventListener('animationend', function done(ev) {
          if (ev.animationName !== 'attn-ring') return;
          el.classList.remove('is-attn');
          el.removeEventListener('animationend', done);
        });
      }
      // Снимаем служебные классы, чтобы вернуть обычные переходы наведения
      setTimeout(function () {
        el.classList.remove('reveal', 'is-in');
        el.style.removeProperty('--i');
      }, 1150 + i * 70);
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) reveal(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    // Страховка: если наблюдатель по какой-то причине не сообщил о блоке,
    // раз в 2 секунды проверяем, не остался ли скрытым блок прямо на экране.
    var pending = [];
    function sweep() {
      var h = window.innerHeight;
      pending = pending.filter(function (el) {
        if (!el.classList.contains('reveal') || el.classList.contains('is-in')) return false;
        var r = el.getBoundingClientRect();
        if (r.top < h && r.bottom > 0) { reveal(el); return false; }
        return true;
      });
      if (pending.length) setTimeout(sweep, 2000);
    }

    document.querySelectorAll(SELECTOR).forEach(function (el) {
      if (el.closest('[hidden]')) return;
      if (el.parentElement && el.parentElement.closest(SELECTOR)) return; // вложенные появляются вместе с родителем
      if (el.getBoundingClientRect().top <= fold) return; // первый экран не прячем
      el.style.setProperty('--i', String(Math.min(indexIn(el.parentElement), 5)));
      el.classList.add('reveal');
      observer.observe(el);
      pending.push(el);
    });
    if (pending.length) setTimeout(sweep, 2000);
  })();
})();
