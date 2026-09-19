/* Панель управления сайтом МУП «Борисоглебские теплосети».
   Отдельным файлом, а не внутри страницы: защита сайта (CSP script-src
   'self') блокирует встроенные скрипты, и панель переставала работать. */
(function () {
  'use strict';

  var STATUS = { new: 'Новая', work: 'В работе', done: 'Обработана' };
  var TYPES = { emergency: 'Аварийная', planned: 'Плановая', hydraulic: 'Гидравлические испытания', season: 'Отопительный сезон' };

  var LABELS = {
    account: 'Лицевой счёт', fio: 'ФИО', address: 'Адрес', meterNumber: 'Номер прибора',
    valueHeat: 'Тепловая энергия, Гкал', valueWater: 'Горячая вода, м³', phone: 'Телефон',
    email: 'Почта', comment: 'Примечание', topic: 'Тема', message: 'Текст обращения',
    replyBy: 'Способ ответа', postAddress: 'Почтовый адрес', applicantType: 'Тип заявителя',
    purpose: 'Что требуется', orgName: 'Организация', inn: 'ИНН', objectAddress: 'Адрес объекта'
  };
  var ORDER = ['account','fio','orgName','inn','applicantType','purpose','address','objectAddress',
               'meterNumber','valueHeat','valueWater','topic','message','replyBy','postAddress',
               'phone','email','comment'];

  function esc(s) { return String(s == null ? '' : s); }

  function fmt(iso) {
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* --- Вкладки --- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
      document.querySelectorAll('[data-panel-body]').forEach(function (p) {
        p.hidden = p.id !== 'panel-' + tab.dataset.panel;
      });
    });
  });

  /* --- Заявки --- */
  function renderRecords(kind, items) {
    var box = document.querySelector('[data-list="' + kind + '"]');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="empty"><p>Записей пока нет.</p></div>';
      return;
    }
    items.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'rec';

      var top = document.createElement('div');
      top.className = 'rec__top';

      var ticket = document.createElement('span');
      ticket.className = 'rec__ticket';
      ticket.textContent = r.ticket;

      var badge = document.createElement('span');
      badge.className = 'badge ' + (r.status === 'done' ? 'badge--ok' : r.status === 'work' ? 'badge--warn' : 'badge--info');
      badge.textContent = STATUS[r.status] || r.status;

      var sel = document.createElement('select');
      sel.className = 'control';
      sel.style.cssText = 'width:auto;min-height:38px;padding:4px 30px 4px 10px;font-size:.9rem';
      Object.keys(STATUS).forEach(function (k) {
        var o = document.createElement('option');
        o.value = k; o.textContent = STATUS[k]; o.selected = (r.status || 'new') === k;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        fetch('/api/admin/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: kind, ticket: r.ticket, status: sel.value })
        }).then(function () {
          badge.className = 'badge ' + (sel.value === 'done' ? 'badge--ok' : sel.value === 'work' ? 'badge--warn' : 'badge--info');
          badge.textContent = STATUS[sel.value];
        });
      });

      var date = document.createElement('span');
      date.className = 'rec__date';
      date.textContent = fmt(r.createdAt);

      top.append(ticket, badge, sel, date);
      card.appendChild(top);

      var dl = document.createElement('dl');
      ORDER.forEach(function (key) {
        if (!r[key]) return;
        var dt = document.createElement('dt'); dt.textContent = LABELS[key] || key;
        var dd = document.createElement('dd'); dd.textContent = esc(r[key]);
        dl.append(dt, dd);
      });
      card.appendChild(dl);

      if (r.files && r.files.length) {
        var files = document.createElement('div');
        files.className = 'rec__files';
        r.files.forEach(function (f) {
          var a = document.createElement('a');
          a.href = '/api/admin/file/' + f.stored.split('/').map(encodeURIComponent).join('/');
          a.target = '_blank'; a.rel = 'noopener';
          a.textContent = f.name + ' · ' + Math.round(f.size / 1024) + ' КБ';
          files.appendChild(a);
        });
        card.appendChild(files);
      }

      box.appendChild(card);
    });
  }

  ['readings', 'appeals', 'contracts'].forEach(function (kind) {
    fetch('/api/admin/records/' + kind)
      .then(function (r) { return r.json(); })
      .then(function (d) { renderRecords(kind, d.items || []); })
      .catch(function () {
        document.querySelector('[data-list="' + kind + '"]').innerHTML = '<p class="text-soft">Не удалось загрузить.</p>';
      });
  });

  /* --- Редактор контента --- */
  var content = { announcement: null, outages: [], news: [] };

  function outageRow(o) {
    var row = document.createElement('div');
    row.className = 'editor-row';
    row.innerHTML =
      '<div class="field" style="margin:0"><label>Тип</label>' +
        '<select class="control" data-f="type">' +
          Object.keys(TYPES).map(function (k) {
            return '<option value="' + k + '"' + (o.type === k ? ' selected' : '') + '>' + TYPES[k] + '</option>';
          }).join('') +
        '</select>' +
        '<label style="margin-top:10px">Состояние</label>' +
        '<select class="control" data-f="status">' +
          '<option value="active"' + (o.status !== 'done' ? ' selected' : '') + '>Действует</option>' +
          '<option value="done"' + (o.status === 'done' ? ' selected' : '') + '>Завершено</option>' +
        '</select>' +
      '</div>' +
      '<div class="field" style="margin:0"><label>Адреса</label>' +
        '<textarea class="control" data-f="addresses" rows="3" style="min-height:90px" placeholder="ул. Свободы, д. 12, 14, 16; ул. Матросовская, д. 117"></textarea>' +
        '<label style="margin-top:10px">Причина</label>' +
        '<input class="control" data-f="reason" placeholder="Замена участка трубопровода">' +
      '</div>' +
      '<div class="field" style="margin:0"><label>Начало</label>' +
        '<input class="control" type="datetime-local" data-f="start">' +
        '<label style="margin-top:10px">Плановое окончание</label>' +
        '<input class="control" type="datetime-local" data-f="end">' +
        '<div class="rowbar"><button class="btn btn--ghost btn--sm btn--danger" type="button" data-del>Удалить</button></div>' +
      '</div>';
    row.querySelector('[data-f="addresses"]').value = o.addresses || '';
    row.querySelector('[data-f="reason"]').value = o.reason || '';
    row.querySelector('[data-f="start"]').value = (o.start || '').slice(0, 16);
    row.querySelector('[data-f="end"]').value = (o.end || '').slice(0, 16);
    row.querySelector('[data-del]').addEventListener('click', function () { row.remove(); });
    // Срок окончания прошёл — на сайте такая работа уже показывается завершённой
    var end = o.end ? Date.parse(o.end.length === 10 ? o.end + 'T23:59:59+03:00' : o.end.slice(0, 16) + '+03:00') : NaN;
    if (o.status !== 'done' && end < Date.now()) {
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.style.color = '#8a5a00';
      hint.textContent = 'Срок окончания прошёл — на сайте работа уже показывается завершённой. Если работы продолжаются, продлите дату.';
      row.querySelector('.rowbar').before(hint);
    }
    return row;
  }

  function newsRow(n) {
    var row = document.createElement('div');
    row.className = 'editor-row';
    row.innerHTML =
      '<div class="field" style="margin:0"><label>Дата</label>' +
        '<input class="control" type="date" data-f="date">' +
        '<label class="check" style="margin-top:14px;margin-bottom:0">' +
          '<input type="checkbox" data-f="pinned"> <span>Закрепить как важное</span></label>' +
      '</div>' +
      '<div class="field" style="margin:0"><label>Заголовок</label>' +
        '<input class="control" data-f="title" maxlength="200">' +
      '</div>' +
      '<div class="field" style="margin:0"><label>Текст</label>' +
        '<textarea class="control" data-f="text" rows="4" style="min-height:110px"></textarea>' +
        '<div class="rowbar"><button class="btn btn--ghost btn--sm btn--danger" type="button" data-del>Удалить</button></div>' +
      '</div>';
    row.querySelector('[data-f="date"]').value = n.date || new Date().toISOString().slice(0, 10);
    row.querySelector('[data-f="title"]').value = n.title || '';
    row.querySelector('[data-f="text"]').value = n.text || '';
    row.querySelector('[data-f="pinned"]').checked = Boolean(n.pinned);
    row.querySelector('[data-del]').addEventListener('click', function () { row.remove(); });
    return row;
  }

  fetch('/api/admin/content').then(function (r) { return r.json(); }).then(function (d) {
    content = d;
    if (d.announcement) {
      document.getElementById('ann-text').value = d.announcement.text || '';
      document.getElementById('ann-level').value = d.announcement.level || 'info';
      document.getElementById('ann-link').value = d.announcement.link || '';
      document.getElementById('ann-until').value = d.announcement.until || '';
    }
    var oe = document.getElementById('outages-editor');
    (d.outages || []).forEach(function (o) { oe.appendChild(outageRow(o)); });
    var ne = document.getElementById('news-editor');
    (d.news || []).forEach(function (n) { ne.appendChild(newsRow(n)); });
  });

  document.getElementById('add-outage').addEventListener('click', function () {
    document.getElementById('outages-editor').prepend(outageRow({ type: 'planned', status: 'active' }));
  });
  document.getElementById('add-news').addEventListener('click', function () {
    document.getElementById('news-editor').prepend(newsRow({}));
  });

  document.getElementById('save-content').addEventListener('click', function () {
    var btn = this;
    var payload = {
      announcement: {
        text: document.getElementById('ann-text').value.trim(),
        level: document.getElementById('ann-level').value,
        link: document.getElementById('ann-link').value.trim(),
        until: document.getElementById('ann-until').value
      },
      outages: [].map.call(document.querySelectorAll('#outages-editor .editor-row'), function (row, i) {
        var g = function (f) { var el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
        return { id: 'o' + Date.now() + i, type: g('type'), status: g('status'),
                 addresses: g('addresses'), reason: g('reason'), start: g('start'), end: g('end') };
      }),
      news: [].map.call(document.querySelectorAll('#news-editor .editor-row'), function (row, i) {
        var g = function (f) { var el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
        return { id: 'n' + Date.now() + i, date: g('date'), title: g('title'), text: g('text'),
                 pinned: row.querySelector('[data-f="pinned"]').checked };
      })
    };

    btn.disabled = true;
    fetch('/api/admin/content', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function () {
      var note = document.getElementById('saved-note');
      note.setAttribute('data-show', 'true');
      setTimeout(function () { note.setAttribute('data-show', 'false'); }, 2500);
    }).finally(function () { btn.disabled = false; });
  });
})();
