/* МУП БГО ВО «Борисоглебские теплосети» — клиентские скрипты.
   Принцип: без JS сайт остаётся работоспособным. Формы отправляются
   обычным POST, JS лишь добавляет проверку на месте и отправку без
   перезагрузки. Внешних библиотек нет. */
(function () {
  'use strict';

  /* ---------- 1. Версия для слабовидящих ---------- */

  var VISION_KEY = 'bgts-vision';
  var root = document.documentElement;

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
            'Проверьте подключение к интернету и попробуйте ещё раз. Показания также принимаются по телефону 8 (47354) 6-05-52.');
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

    if (!active.length) {
      var empty = document.querySelector(list.dataset.emptyTarget || '#outages-empty');
      if (empty) empty.hidden = false;
      list.hidden = true;
      return;
    }
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
    fetch('/api/content', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderAnnouncement(data.announcement);
        allOutages = data.outages || [];
        document.querySelectorAll('[data-outages]').forEach(function (el) { renderOutages(el, allOutages); });
        document.querySelectorAll('[data-news]').forEach(function (el) { renderNews(el, data.news || []); });
      })
      .catch(function () {
        document.querySelectorAll('[data-outages]').forEach(function (el) {
          var empty = document.querySelector(el.dataset.emptyTarget || '#outages-empty');
          if (empty) { empty.hidden = false; empty.querySelector('p').textContent = 'Не удалось загрузить сведения о работах. Уточните по телефону диспетчерской 8 (47354) 6-05-52.'; }
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
      if (href === here || (href !== '/' && here.indexOf(href) === 0)) {
        link.setAttribute('aria-current', 'page');
      }
    });
  });
})();
