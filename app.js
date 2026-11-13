const URL_SCRIPT = 'https://script.google.com/macros/s/AKfycbwQrsnWlOg92brLbzX8dU0rLAg3M5SurIMdbKDzthn3TZOXTWGp63Tfk27f3R25DYOR/exec';
const $ = id => document.getElementById(id);
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = f => { if (!f) return ''; const p = f.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
function leer(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function guardarLS(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

let equipos = leer('equipos', []);
let responsables = leer('responsables', []);
let sesion = leer('sesion', null);
let areas = [];
let resp = {};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// ---------- Base local (IndexedDB) ----------
function db() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('checklist', 2);
    r.onupgradeneeded = () => {
      const d = r.result, t = r.transaction;
      if (!d.objectStoreNames.contains('inspecciones')) d.createObjectStore('inspecciones', { keyPath: 'id' });
      if (d.objectStoreNames.contains('pendientes')) {   // pasa lo pendiente de la versión 1
        const viejo = t.objectStore('pendientes'), nuevo = t.objectStore('inspecciones');
        viejo.openCursor().onsuccess = e => {
          const c = e.target.result;
          if (c) { nuevo.put(Object.assign({}, c.value, { enviada: false })); c.continue(); }
        };
      }
    };
    r.onsuccess = () => ok(r.result); r.onerror = mal;
  });
}
function tx(modo, fn) {
  return db().then(d => new Promise((ok, mal) => {
    const t = d.transaction('inspecciones', modo), q = fn(t.objectStore('inspecciones'));
    let res; if (q) q.onsuccess = () => { res = q.result; };
    t.oncomplete = () => ok(res); t.onerror = mal;
  }));
}
const fechaCreada = i => i.creada || Number(String(i.id).split('-')[1]) || 0;
const todas = () => tx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => fechaCreada(y) - fechaCreada(x)));
const guardarInsp = i => tx('readwrite', s => s.put(i));
const borrarInsp = id => tx('readwrite', s => s.delete(id));

async function post(datos) {
  const r = await fetch(URL_SCRIPT, { method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(datos) });
  return r.json();
}

// ---------- Utilidades de pantalla ----------
let tToast;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('ver'); clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('ver'), 2600); }

async function pintarEstado() {
  const n = (await todas()).filter(i => !i.enviada).length;
  const p = $('pill');
  p.textContent = (navigator.onLine ? 'En línea' : 'Sin señal') + (n ? ' · ' + n + ' por enviar' : '');
  p.classList.toggle('off', !navigator.onLine || n > 0);
}

function ver(v) {
  $('vLogin').hidden = v !== 'login';
  $('vNueva').hidden = v !== 'nueva';
  $('vHist').hidden = v !== 'hist';
  $('nav').hidden = v === 'login';
  $('barraGuardar').hidden = v !== 'nueva';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('act', b.dataset.v === v));
  if (v === 'hist') pintarHistorial();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => {
  if (b.dataset.v === 'salir') {
    if (confirm('¿Cerrar sesión?')) { localStorage.removeItem('sesion'); location.reload(); }
  } else ver(b.dataset.v);
});

// ---------- Login ----------
$('btnLogin').onclick = async () => {
  const usuario = $('usuario').value.trim(), pin = $('pin').value.trim();
  if (!usuario || !pin) return toast('Escribe usuario y PIN');
  if (navigator.onLine) {
    try {
      $('btnLogin').textContent = 'Entrando…';
      const r = await post({ accion: 'login', usuario, pin });
      if (!r.ok) { $('btnLogin').textContent = 'Entrar'; return toast(r.error); }
      sesion = { usuario, pin, nombre: r.nombre };
      guardarLS('sesion', sesion);
      await cargarCatalogo();
    } catch (e) { $('btnLogin').textContent = 'Entrar'; return toast('No se pudo conectar'); }
  } else {
    const s = leer('sesion', null);
    if (!s || s.usuario !== usuario || s.pin !== pin) return toast('Sin señal: entra la primera vez con internet');
    sesion = s;
  }
  iniciar();
};

async function cargarCatalogo() {
  const r = await (await fetch(URL_SCRIPT)).json();
  if (!r.ok) return;
  equipos = r.equipos; guardarLS('equipos', equipos);
  const locales = leer('respNuevos', []);   // conserva los agregados que aún no se envían
  responsables = (r.responsables || []).concat(locales.filter(l =>
    !(r.responsables || []).some(x => x.area === l.area && x.nombre.toLowerCase() === l.nombre.toLowerCase())));
  guardarLS('responsables', responsables);
}

function iniciar() {
  nuevaInspeccion();
  ver('nueva');
  sincronizar();
}

// ---------- Responsables ----------
function opcionesResp(area, actual) {
  const lista = responsables.filter(r => r.area === area);
  return '<option value="">Selecciona responsable…</option>' +
    lista.map(r => `<option value="${esc(r.nombre)}"${r.nombre === actual ? ' selected' : ''}>${esc(r.nombre)}${r.puesto ? ' · ' + esc(r.puesto) : ''}</option>`).join('') +
    '<option value="__nuevo">+ Agregar responsable…</option>';
}
function cambioResp(sel) {
  if (sel.value !== '__nuevo') return;
  const area = areas[+sel.dataset.ai];
  const nombre = (prompt('Nombre del nuevo responsable de ' + area + ':') || '').trim();
  if (!nombre) { sel.value = ''; return; }
  if (!responsables.some(r => r.area === area && r.nombre.toLowerCase() === nombre.toLowerCase())) {
    responsables.push({ area, nombre, puesto: '' });
    guardarLS('responsables', responsables);
    const cola = leer('respNuevos', []); cola.push({ area, nombre }); guardarLS('respNuevos', cola);
    sincronizar();
  }
  document.querySelectorAll(`select[data-ai="${sel.dataset.ai}"]`).forEach(s => {
    const v = s === sel ? nombre : s.value;
    s.innerHTML = opcionesResp(area, v); s.value = v;
  });
  toast('Responsable agregado a ' + area);
}

// ---------- Formulario ----------
function nuevaInspeccion() {
  resp = {};
  $('bienvenida').textContent = 'Inspector: ' + sesion.nombre;
  const h = new Date(); $('fecha').value = h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0');
  $('linea').value = ''; $('obs').value = '';
  areas = [...new Set(equipos.map(e => e.area))];
  $('lista').innerHTML = areas.map((area, ai) => {
    const lista = equipos.filter(e => e.area === area);
    return `<details class="area" id="a${ai}"${ai === 0 ? ' open' : ''}>
      <summary><span class="n">${esc(area)}</span><span class="chip g cuenta" id="ca${ai}">0/${lista.length}</span><span class="chip r" id="fa${ai}" hidden></span></summary>
      <div class="area-body">
        <button class="mini" onclick="areaSinFuga(${ai})">Marcar pendientes como sin fuga</button>
        ${lista.map(e => tarjeta(e, ai)).join('')}
      </div></details>`;
  }).join('');
  actualizarProgreso();
}

function tarjeta(e, ai) {
  const id = e.id;
  return `<div class="eq" id="c${id}" data-estado="">
    <div class="eq-top"><span class="num">${id}</span><span class="nom">${esc(e.equipo)}</span></div>
    <div class="seg">
      <button class="b-ok" onclick="marcar(${id},'Sin fuga')">✓ Sin fuga</button>
      <button class="b-fuga" onclick="marcar(${id},'Con fuga')">⚠ Con fuga</button>
    </div>
    <div class="extra">
      <label class="switch">Con derrame <input type="checkbox" id="der${id}"></label>
      <label class="campo" for="ubi${id}">¿Dónde se observa la fuga?</label>
      <input type="text" id="ubi${id}">
      <label class="campo" for="rie${id}">Riesgo potencial</label>
      <input type="text" id="rie${id}">
      <label class="campo" for="acc${id}">Acción requerida</label>
      <textarea id="acc${id}"></textarea>
      <div class="fila">
        <div><label class="campo" for="res${id}">Responsable</label>
          <select id="res${id}" data-ai="${ai}" onchange="cambioResp(this)">${opcionesResp(e.area)}</select></div>
        <div><label class="campo" for="fc${id}">Fecha compromiso</label><input type="date" id="fc${id}"></div>
      </div>
      <label class="foto"><input type="file" accept="image/*" capture="environment" onchange="foto(${id},this)"><span id="tf${id}">📷 Tomar foto de la fuga</span></label>
      <img class="prev" id="img${id}" hidden alt="">
    </div></div>`;
}

function marcar(id, valor) {
  resp[id] = Object.assign(resp[id] || {}, { estado: valor });
  $('c' + id).dataset.estado = valor;
  actualizarProgreso();
}

function areaSinFuga(ai) {
  equipos.filter(e => e.area === areas[ai] && !(resp[e.id] && resp[e.id].estado))
    .forEach(e => marcar(e.id, 'Sin fuga'));
}

function actualizarProgreso() {
  const total = equipos.length;
  const rev = equipos.filter(e => resp[e.id] && resp[e.id].estado).length;
  const fugas = equipos.filter(e => resp[e.id] && resp[e.id].estado === 'Con fuga').length;
  $('txtRev').textContent = rev; $('txtTot').textContent = total;
  $('barra').style.width = (total ? rev / total * 100 : 0) + '%';
  $('txtFugas').textContent = fugas + ' con fuga';
  $('txtFugas').className = 'chip ' + (fugas ? 'r' : 'g');
  areas.forEach((area, ai) => {
    const l = equipos.filter(e => e.area === area);
    const r = l.filter(e => resp[e.id] && resp[e.id].estado).length;
    const f = l.filter(e => resp[e.id] && resp[e.id].estado === 'Con fuga').length;
    $('ca' + ai).textContent = r + '/' + l.length;
    $('a' + ai).classList.toggle('completa', r === l.length);
    $('fa' + ai).hidden = !f; $('fa' + ai).textContent = f + ' fuga' + (f > 1 ? 's' : '');
  });
}

// Reduce la foto a 1024 px para que pese poco
function foto(id, input) {
  const f = input.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    resp[id] = Object.assign(resp[id] || {}, { foto: c.toDataURL('image/jpeg', 0.6) });
    $('img' + id).src = resp[id].foto; $('img' + id).hidden = false;
    $('tf' + id).textContent = '📷 Cambiar foto';
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
}

$('btnGuardar').onclick = async () => {
  const fecha = $('fecha').value;
  if (!fecha) return toast('Pon la fecha de la inspección');
  const rev = equipos.filter(e => resp[e.id] && resp[e.id].estado).length;
  if (!rev) return toast('Marca al menos un equipo');
  const faltan = equipos.length - rev;
  if (faltan && !confirm('Faltan ' + faltan + ' equipos por revisar. ¿Guardar así?')) return;
  const items = equipos.map(e => {
    const r = resp[e.id] || {}, f = r.estado === 'Con fuga';
    const v = id => f ? $(id + e.id).value.trim() : '';
    return { id: e.id, area: e.area, equipo: e.equipo, estado: r.estado || '',
      derrame: f && $('der' + e.id).checked, riesgo: v('rie'), ubicacion: v('ubi'), accion: v('acc'),
      responsable: f ? $('res' + e.id).value.replace('__nuevo', '') : '', fechaCompromiso: v('fc'),
      foto: f ? (r.foto || '') : '' };
  });
  const insp = { id: 'INS-' + Date.now() + '-' + sesion.usuario, creada: Date.now(), fecha,
    dia: DIAS[new Date(fecha + 'T12:00').getDay()], linea: $('linea').value.trim(),
    inspector: sesion.nombre, observaciones: $('obs').value.trim(), items, enviada: false };
  await guardarInsp(insp);
  toast('Inspección guardada en el teléfono');
  nuevaInspeccion();
  ver('hist');
  sincronizar();
};

// ---------- Historial ----------
function itemsDe(i) {
  if (i.items) return i.items;
  // inspecciones de la versión 1
  return (i.detalles || []).map(d => {
    const e = equipos.find(x => x.id == d.idEquipo) || {};
    return Object.assign({ id: d.idEquipo, area: e.area || '', equipo: e.equipo || '' }, d);
  });
}

async function pintarHistorial() {
  const l = await todas();
  if (!l.length) { $('historial').innerHTML = '<div class="vacio">Aún no hay inspecciones guardadas.</div>'; return; }
  $('historial').innerHTML = l.map(i => {
    const it = itemsDe(i), rev = it.filter(x => x.estado).length;
    const fug = it.filter(x => x.estado === 'Con fuga').length, der = it.filter(x => x.derrame).length;
    return `<div class="card hist-item">
      <div class="cab"><div><div class="f">${fmt(i.fecha)} · ${esc(i.dia)}</div>
        <div class="s">Línea ${esc(i.linea || '—')} · ${esc(i.inspector || sesion.nombre)}</div></div>
        <span class="chip ${i.enviada ? 'v' : 'a'}">${i.enviada ? 'Enviada' : 'Por enviar'}</span></div>
      <div class="chips"><span class="chip g">${rev} revisados</span>
        <span class="chip ${fug ? 'r' : 'g'}">${fug} con fuga</span>${der ? `<span class="chip r">${der} con derrame</span>` : ''}</div>
      <button class="btn sec" onclick="descargarPDF('${esc(i.id)}')">Descargar PDF</button></div>`;
  }).join('');
}

// ---------- PDF (formato BP-PROD-FR-034) ----------
async function descargarPDF(id) {
  const i = (await todas()).find(x => x.id === id);
  if (!i) return;
  $('reporte').innerHTML = htmlReporte(i);
  const titulo = document.title;
  document.title = 'Checklist MOSH-MOAH ' + i.fecha + (i.linea ? ' Linea ' + i.linea : '');
  window.onafterprint = () => { document.title = titulo; };
  toast('Elige "Guardar como PDF" en la impresora');
  setTimeout(() => window.print(), 400);
}

function htmlReporte(i) {
  const it = itemsDe(i);
  const x = b => b ? 'X' : '';
  let filas = '', k = 0;
  while (k < it.length) {
    let n = 1; while (k + n < it.length && it[k + n].area === it[k].area) n++;
    for (let j = 0; j < n; j++) {
      const e = it[k + j], f = e.estado === 'Con fuga';
      filas += `<tr${f ? ' class="fuga"' : ''}><td class="c">${e.id}</td>` +
        (j === 0 ? `<td rowspan="${n}" class="c area">${esc(e.area)}</td>` : '') +
        `<td>${esc(e.equipo)}</td><td class="c">${x(f)}</td><td class="c">${x(e.estado === 'Sin fuga')}</td>
        <td class="c">${x(e.derrame)}</td><td>${esc(e.riesgo)}</td><td>${esc(e.ubicacion)}</td><td>${esc(e.accion)}</td>
        <td>${esc(e.responsable)}</td><td class="c">${fmt(e.fechaCompromiso)}</td></tr>`;
    }
    k += n;
  }
  const rev = it.filter(e => e.estado).length, fug = it.filter(e => e.estado === 'Con fuga').length;
  const der = it.filter(e => e.derrame).length;
  const fotos = it.filter(e => e.foto);
  return `<table class="enc"><tr><td rowspan="2" class="logo">Uumbal</td><td rowspan="2" class="tit">Checklist MOSH y MOAH</td>
      <td class="k">CÓDIGO</td><td class="v">BP-PROD-FR-034</td></tr><tr><td class="k">VERSIÓN</td><td class="v">0</td></tr></table>
    <div class="meta"><span><b>Fecha:</b> ${fmt(i.fecha)}</span><span><b>Día:</b> ${esc(i.dia)}</span>
      <span><b>Línea:</b> ${esc(i.linea)}</span><span><b>Inspector:</b> ${esc(i.inspector || '')}</span></div>
    <table><thead><tr><th>No.</th><th>Área</th><th>Equipo/Elemento</th><th>Con fuga</th><th>Sin fuga</th><th>Con derrame</th>
      <th>Riesgo potencial</th><th>¿Dónde se observa la fuga?</th><th>Acción requerida</th><th>Responsable</th><th>Fecha compromiso</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <h3>Resumen</h3>
    <div class="res"><span>Equipos revisados: <b>${rev} de ${it.length}</b></span><span>Con fuga: <b>${fug}</b></span><span>Con derrame: <b>${der}</b></span></div>
    ${i.observaciones ? `<h3>Observaciones</h3><div>${esc(i.observaciones)}</div>` : ''}
    ${fotos.length ? `<h3>Evidencia fotográfica</h3><div class="fotos">${fotos.map(e =>
      `<figure><img src="${e.foto}"><figcaption>${e.id}. ${esc(e.area)} · ${esc(e.equipo)}</figcaption></figure>`).join('')}</div>` : ''}
    <div class="firmas"><div>Inspector<br>${esc(i.inspector || '')}</div><div>Responsable de área</div><div>Jefe de producción</div></div>`;
}

// ---------- Sincronización ----------
let sincronizando = false;
async function sincronizar() {
  if (!navigator.onLine || sincronizando || !sesion) return pintarEstado();
  sincronizando = true;
  try {
    const cola = leer('respNuevos', []);
    if (cola.length) {
      const r = await post({ accion: 'responsable', usuario: sesion.usuario, pin: sesion.pin, lista: cola });
      if (r.ok) guardarLS('respNuevos', []);
    }
    for (const i of (await todas()).filter(x => !x.enviada)) {
      const detalles = itemsDe(i).filter(e => e.estado).map(e => ({
        idEquipo: e.id, estado: e.estado, derrame: e.derrame, riesgo: e.riesgo, ubicacion: e.ubicacion,
        accion: e.accion, responsable: e.responsable, fechaCompromiso: e.fechaCompromiso, foto: e.foto }));
      const r = await post({ accion: 'guardar', usuario: sesion.usuario, pin: sesion.pin,
        inspeccion: { id: i.id, fecha: i.fecha, dia: i.dia, linea: i.linea, observaciones: i.observaciones, detalles } });
      if (r.ok) { i.enviada = true; i.enviadaEn = Date.now(); await guardarInsp(i); }
    }
    // Conserva en el teléfono solo las últimas 40 inspecciones enviadas
    const env = (await todas()).filter(x => x.enviada);
    for (const v of env.slice(40)) await borrarInsp(v.id);
    await cargarCatalogo();
  } catch (e) { /* sin conexión: se reintenta después */ }
  sincronizando = false;
  pintarEstado();
  if (!$('vHist').hidden) pintarHistorial();
}
$('btnSync').onclick = async () => { await sincronizar(); toast(navigator.onLine ? 'Sincronizado' : 'Sin señal, se enviará después'); };
window.addEventListener('online', sincronizar);
window.addEventListener('offline', pintarEstado);
setInterval(sincronizar, 60000);

// ---------- Arranque ----------
if (sesion && equipos.length) iniciar(); else ver('login');
pintarEstado();
