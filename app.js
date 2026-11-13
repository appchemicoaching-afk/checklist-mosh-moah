const URL_SCRIPT = 'https://script.google.com/macros/s/AKfycbyDNrpOLQyYc0oJSdiv2Nj2Z9X7uz8Bqz5wAu_WZGF-x2CSi_B7uaY_Bbd5P8lUmwjV/exec';
const $ = id => document.getElementById(id);
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = f => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : f; };
const hoyISO = () => { const h = new Date(); return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0') + '-' + String(h.getDate()).padStart(2, '0'); };
const ahora = () => new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
function leer(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

let equipos = leer('equipos', []);
let responsables = leer('responsables', []);
let sesion = leer('sesion', null);
let areas = [];
let resp = {};
let modoHist = 'tel';

const medir = () => document.documentElement.style.setProperty('--alto', document.querySelector('.top').offsetHeight + 'px');
addEventListener('resize', medir); addEventListener('load', medir); medir();
const VERSION = '5';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  // Cuando llega una versión nueva, recarga sola, salvo que haya una inspección a medias
  let recargando = false;
  const habiaVersion = !!navigator.serviceWorker.controller;   // en la primera instalación no recarga
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !habiaVersion || !sesion) return;
    if (Object.keys(resp).length) { toast('Hay una versión nueva. Se aplicará al guardar la inspección'); pendienteRecarga = true; return; }
    recargando = true; location.reload();
  });
}
let pendienteRecarga = false;
// Pantalla de inicio: #tablero o #inspeccion en la dirección, o la última que se usó
const VISTAS = { tablero: 'tab', inspeccion: 'nueva', historial: 'hist' };
function vistaInicial() { return VISTAS[location.hash.slice(1)] || leer('vista', 'nueva'); }
window.addEventListener('hashchange', () => { if (sesion && VISTAS[location.hash.slice(1)]) ver(VISTAS[location.hash.slice(1)]); });

// ---------- Base local (IndexedDB) ----------
function db() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('checklist', 2);
    r.onupgradeneeded = () => {
      const d = r.result, t = r.transaction;
      if (!d.objectStoreNames.contains('inspecciones')) d.createObjectStore('inspecciones', { keyPath: 'id' });
      if (d.objectStoreNames.contains('pendientes')) {
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
const creada = i => i.creada || Number(String(i.id).split('-')[1]) || 0;
const todas = () => tx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => creada(y) - creada(x)));
const guardarInsp = i => tx('readwrite', s => s.put(i));
const borrarInsp = id => tx('readwrite', s => s.delete(id));
const unaInsp = id => tx('readonly', s => s.get(id));

async function post(datos) {
  const r = await fetch(URL_SCRIPT, { method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(datos) });
  return r.json();
}
const cred = () => ({ usuario: sesion.usuario, pin: sesion.pin });

// ---------- Interfaz general ----------
let tToast;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('ver'); clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('ver'), 2800); }

async function pintarEstado() {
  const l = await todas();
  const n = l.filter(i => !i.enviada || i.firmasPend).length;
  $('estado').classList.toggle('off', !navigator.onLine || n > 0);
  $('estadoTx').textContent = !navigator.onLine ? 'Sin señal' + (n ? ', ' + n + ' por enviar' : '') : (n ? n + ' por enviar' : 'En línea');
}

function ver(v) {
  ['login', 'nueva', 'hist', 'tab'].forEach(x => { $({ login: 'vLogin', nueva: 'vNueva', hist: 'vHist', tab: 'vTab' }[x]).hidden = x !== v; });
  $('nav').hidden = v === 'login';
  $('btnYo').hidden = v === 'login';
  $('barraGuardar').hidden = v !== 'nueva';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('act', b.dataset.v === v));
  if (v !== 'login') guardarLS('vista', v);
  if (v === 'hist') modoHistorial(modoHist);
  if (v === 'tab') cargarTablero();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => ver(b.dataset.v));
$('btnYo').onclick = () => {
  if (confirm('¿Cerrar la sesión de ' + sesion.nombre + '? Las inspecciones guardadas se conservan.')) {
    localStorage.removeItem('sesion'); location.reload();
  }
};

// ---------- Login ----------
$('btnLogin').onclick = async () => {
  const usuario = $('usuario').value.trim(), pin = $('pin').value.trim();
  if (!usuario || !pin) return toast('Escribe tu usuario y PIN');
  if (navigator.onLine) {
    $('btnLogin').textContent = 'Entrando…';
    try {
      const r = await post({ accion: 'login', usuario, pin });
      if (!r.ok) { $('btnLogin').textContent = 'Entrar'; return toast(r.error); }
      sesion = { usuario, pin, nombre: r.nombre };
      guardarLS('sesion', sesion);
      await cargarCatalogo();
    } catch (e) { $('btnLogin').textContent = 'Entrar'; return toast('No se pudo conectar con el servidor'); }
  } else {
    const s = leer('sesion', null);
    if (!s || s.usuario !== usuario || s.pin !== pin) return toast('Sin señal: la primera vez entra con internet');
    sesion = s;
  }
  iniciar();
};

async function cargarCatalogo() {
  const r = await (await fetch(URL_SCRIPT)).json();
  if (!r.ok) return;
  equipos = r.equipos; guardarLS('equipos', equipos);
  const loc = leer('respNuevos', []), srv = r.responsables || [];
  responsables = srv.concat(loc.filter(l => !srv.some(x => x.area === l.area && x.nombre.toLowerCase() === l.nombre.toLowerCase())));
  guardarLS('responsables', responsables);
  llenarDatalist();
}
function llenarDatalist() {
  $('dlResp').innerHTML = [...new Set(responsables.map(r => r.nombre))].map(n => `<option value="${esc(n)}">`).join('');
}

function iniciar() {
  $('btnYo').textContent = (sesion.nombre || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  llenarDatalist();
  nuevaInspeccion();
  ver(vistaInicial());
  sincronizar();
}

// ---------- Responsables ----------
function opcionesResp(area, actual) {
  return '<option value="">Selecciona…</option>' +
    responsables.filter(r => r.area === area).map(r =>
      `<option value="${esc(r.nombre)}"${r.nombre === actual ? ' selected' : ''}>${esc(r.nombre)}${r.puesto ? ', ' + esc(r.puesto) : ''}</option>`).join('') +
    '<option value="__nuevo">Agregar responsable…</option>';
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
    llenarDatalist();
    sincronizar();
  }
  document.querySelectorAll(`select[data-ai="${sel.dataset.ai}"]`).forEach(s => {
    const v = s === sel ? nombre : s.value; s.innerHTML = opcionesResp(area, v); s.value = v;
  });
  toast('Responsable agregado a ' + area);
}

// ---------- Formulario ----------
const CHEV = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
function nuevaInspeccion() {
  resp = {};
  $('inspector').textContent = sesion.nombre;
  $('fecha').value = hoyISO();
  $('linea').value = ''; $('obs').value = '';
  areas = [...new Set(equipos.map(e => e.area))];
  $('lista').innerHTML = areas.map((area, ai) => {
    const l = equipos.filter(e => e.area === area);
    return `<section class="panel area${ai === 0 ? ' abierta' : ''}" id="a${ai}">
      <button class="area-h" onclick="this.parentNode.classList.toggle('abierta')" aria-controls="b${ai}">
        <span class="n">${esc(area)}</span><span class="etq f" id="fa${ai}" hidden></span><span class="c" id="ca${ai}">0 de ${l.length}</span>${CHEV}</button>
      <div class="area-b" id="b${ai}">
        <div class="herr"><button class="link" onclick="areaSinFuga(${ai})">Marcar pendientes como sin fuga</button></div>
        ${l.map(e => fila(e, ai)).join('')}
      </div></section>`;
  }).join('');
  actualizarProgreso();
}

function fila(e, ai) {
  const id = e.id;
  return `<div class="eq" id="c${id}" data-estado="">
    <div class="eq-t"><span class="no">${id}</span><span class="nm">${esc(e.equipo)}</span></div>
    <div class="tog" role="group" aria-label="Estado de ${esc(e.equipo)}">
      <button class="t-ok" onclick="marcar(${id},'Sin fuga')">Sin fuga</button><button class="t-f" onclick="marcar(${id},'Con fuga')">Fuga</button>
    </div>
    <div class="eq-d">
      <label class="switch">Hay derrame <input type="checkbox" id="der${id}"></label>
      <label class="campo" for="ubi${id}">¿Dónde se observa la fuga?</label><input type="text" id="ubi${id}">
      <label class="campo" for="rie${id}">Riesgo potencial</label><input type="text" id="rie${id}">
      <label class="campo" for="acc${id}">Acción requerida</label><textarea id="acc${id}"></textarea>
      <div class="fila">
        <div><label class="campo" for="res${id}">Responsable</label>
          <select id="res${id}" data-ai="${ai}" onchange="cambioResp(this)">${opcionesResp(e.area)}</select></div>
        <div><label class="campo" for="fc${id}">Fecha compromiso</label><input type="date" id="fc${id}"></div>
      </div>
      <label class="foto"><input type="file" accept="image/*" capture="environment" onchange="foto(${id},this)"><span id="tf${id}">Tomar foto de la fuga</span></label>
      <img class="prev" id="img${id}" hidden alt="Foto de la fuga">
    </div></div>`;
}

function marcar(id, valor) {
  resp[id] = Object.assign(resp[id] || {}, { estado: valor });
  $('c' + id).dataset.estado = valor;
  actualizarProgreso();
}
function areaSinFuga(ai) {
  equipos.filter(e => e.area === areas[ai] && !(resp[e.id] && resp[e.id].estado)).forEach(e => marcar(e.id, 'Sin fuga'));
}
function actualizarProgreso() {
  const est = e => resp[e.id] && resp[e.id].estado;
  const rev = equipos.filter(est).length, fug = equipos.filter(e => est(e) === 'Con fuga').length;
  $('txtRev').textContent = rev; $('txtTot').textContent = equipos.length;
  $('barra').style.width = (equipos.length ? rev / equipos.length * 100 : 0) + '%';
  $('txtFugas').textContent = fug ? fug + (fug > 1 ? ' fugas' : ' fuga') : 'Sin fugas';
  $('txtFugas').className = 'etq' + (fug ? ' f' : '');
  areas.forEach((area, ai) => {
    const l = equipos.filter(e => e.area === area), r = l.filter(est).length, f = l.filter(e => est(e) === 'Con fuga').length;
    $('ca' + ai).textContent = r + ' de ' + l.length;
    $('a' + ai).classList.toggle('lista', r === l.length);
    $('fa' + ai).hidden = !f; $('fa' + ai).textContent = f + (f > 1 ? ' fugas' : ' fuga');
  });
}

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
    $('tf' + id).textContent = 'Cambiar foto';
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
}

$('btnGuardar').onclick = async () => {
  const fecha = $('fecha').value;
  if (!fecha) return toast('Pon la fecha de la inspección');
  const rev = equipos.filter(e => resp[e.id] && resp[e.id].estado).length;
  if (!rev) return toast('Marca al menos un equipo');
  if (rev < equipos.length && !confirm('Faltan ' + (equipos.length - rev) + ' equipos por revisar. ¿Guardar así?')) return;
  const firma = await pedirFirma('Firma del inspector', sesion.nombre, false);
  if (!firma) return;
  const items = equipos.map(e => {
    const r = resp[e.id] || {}, f = r.estado === 'Con fuga';
    const v = p => f ? $(p + e.id).value.trim() : '';
    return { id: e.id, area: e.area, equipo: e.equipo, estado: r.estado || '',
      derrame: f && $('der' + e.id).checked, riesgo: v('rie'), ubicacion: v('ubi'), accion: v('acc'),
      responsable: f ? $('res' + e.id).value.replace('__nuevo', '') : '', fechaCompromiso: v('fc'),
      foto: f ? (r.foto || '') : '' };
  });
  const insp = { id: 'INS-' + Date.now() + '-' + sesion.usuario, creada: Date.now(), fecha,
    dia: DIAS[new Date(fecha + 'T12:00').getDay()], linea: $('linea').value.trim(),
    inspector: sesion.nombre, observaciones: $('obs').value.trim(), items, enviada: false,
    firmas: { inspector: firma } };
  await guardarInsp(insp);
  toast('Inspección firmada y guardada');
  nuevaInspeccion();
  if (pendienteRecarga) { location.hash = 'historial'; location.reload(); return; }
  ver('hist');
  sincronizar();
};

// ---------- Firma ----------
function pedirFirma(titulo, nombre, editable) {
  return new Promise(resolver => {
    const capa = $('capa'), cv = $('lienzo');
    $('hojaT').textContent = titulo;
    $('hojaNom').value = nombre || '';
    $('hojaNom').readOnly = !editable;
    capa.hidden = false;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr); c.lineWidth = 2.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#14213d';
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    let trazando = false, vacio = true, ult = null;
    const pt = ev => { const b = cv.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
    cv.onpointerdown = ev => { trazando = true; ult = pt(ev); cv.setPointerCapture(ev.pointerId); c.beginPath(); c.arc(ult.x, ult.y, 1.1, 0, 7); c.fillStyle = '#14213d'; c.fill(); vacio = false; };
    cv.onpointermove = ev => { if (!trazando) return; const p = pt(ev); c.beginPath(); c.moveTo(ult.x, ult.y); c.lineTo(p.x, p.y); c.stroke(); ult = p; };
    cv.onpointerup = cv.onpointercancel = () => { trazando = false; };
    const fin = r => { capa.hidden = true; cv.onpointerdown = cv.onpointermove = cv.onpointerup = null; resolver(r); };
    $('hojaBorrar').onclick = () => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); vacio = true; };
    $('hojaCancel').onclick = () => fin(null);
    $('hojaOk').onclick = () => {
      const n = $('hojaNom').value.trim();
      if (!n) return toast('Escribe el nombre de quien firma');
      if (vacio) return toast('Falta la firma');
      fin({ nombre: n, img: cv.toDataURL('image/png'), fecha: ahora() });
    };
  });
}

async function firmarRol(id, rol) {
  const i = await unaInsp(id); if (!i) return;
  const f = await pedirFirma(tituloRol(rol), '', true);
  if (!f) return;
  i.firmas = i.firmas || {};
  i.firmas[rol] = f;
  if (i.enviada) i.firmasPend = true;
  await guardarInsp(i);
  toast('Firma guardada');
  pintarHistorial();
  sincronizar();
}

// ---------- Historial ----------
function itemsDe(i) {
  if (i.items) return i.items;
  return (i.detalles || []).map(d => {
    const e = equipos.find(x => x.id == d.idEquipo) || {};
    return Object.assign({ id: d.idEquipo, area: e.area || '', equipo: e.equipo || '' }, d);
  });
}
async function pintarHistorial() {
  const l = await todas();
  if (!l.length) { $('historial').innerHTML = '<div class="vacio">Todavía no hay inspecciones. Las que guardes aparecerán aquí.</div>'; return; }
  $('historial').innerHTML = l.map(i => {
    const it = itemsDe(i), rev = it.filter(x => x.estado).length;
    const fug = it.filter(x => x.estado === 'Con fuga').length, der = it.filter(x => x.derrame).length;
    const fi = i.firmas || {};
    const caja = (rol, txt) => `<div class="${fi[rol] ? 'si' : ''}"><b>${txt}</b>${fi[rol] ? esc(fi[rol].nombre) : 'Pendiente'}</div>`;
    const estado = !i.enviada ? '<span class="etq al">Por enviar</span>' : i.firmasPend ? '<span class="etq al">Firmas por enviar</span>' : '<span class="etq ok">Enviada</span>';
    return `<div class="panel hi">
      <div class="cab"><div><div class="f">${fmt(i.fecha)}, ${esc(i.dia)}</div>
        <div class="s">Línea ${esc(i.linea || 'sin especificar')}. Inspector: ${esc(i.inspector || '')}</div></div>${estado}</div>
      <div class="chips"><span class="etq">${rev} de ${it.length} revisados</span>
        <span class="etq ${fug ? 'f' : 'ok'}">${fug ? fug + (fug > 1 ? ' fugas' : ' fuga') : 'Sin fugas'}</span>${der ? `<span class="etq f">${der} con derrame</span>` : ''}</div>
      <div class="firmas">${caja('inspector', 'Inspector')}${caja('responsable', 'Resp. de área')}${caja('jefe', 'Jefe de producción')}</div>
      <div class="btns">
        ${!fi.responsable ? `<button class="btn sec peq" onclick="firmarRol('${esc(i.id)}','responsable')">Firma responsable</button>` : ''}
        ${!fi.jefe ? `<button class="btn sec peq" onclick="firmarRol('${esc(i.id)}','jefe')">Firma jefe</button>` : ''}
        <button class="btn peq" onclick="descargarPDF('${esc(i.id)}')">Descargar PDF</button>
      </div></div>`;
  }).join('');
}


// ---------- Historial compartido (todas las inspecciones) ----------
const tituloRol = rol => rol === 'responsable' ? 'Firma del responsable de área' : 'Firma del jefe de producción';
function modoHistorial(m) {
  modoHist = m;
  $('hTel').classList.toggle('act', m === 'tel'); $('hTodas').classList.toggle('act', m === 'todas');
  $('historial').hidden = m !== 'tel'; $('historialSrv').hidden = m !== 'todas'; $('btnSync').hidden = m !== 'tel';
  $('hNota').textContent = m === 'tel' ? 'Inspecciones guardadas en este teléfono. Funcionan sin señal.'
    : 'Inspecciones de todos los inspectores. Para descargar o firmar necesitas señal.';
  if (m === 'todas') pintarServidor(); else pintarHistorial();
}
$('hTel').onclick = () => modoHistorial('tel');
$('hTodas').onclick = () => modoHistorial('todas');

async function pintarServidor() {
  const cache = leer('histSrv', null), caja = $('historialSrv');
  if (cache) renderServidor(cache.lista, cache.cuando); else caja.innerHTML = '<div class="vacio">Cargando inspecciones…</div>';
  if (!navigator.onLine) {
    if (!cache) caja.innerHTML = '<div class="vacio">Conéctate a internet para ver las inspecciones de todos.</div>';
    return;
  }
  try {
    const r = await post(Object.assign({ accion: 'historial' }, cred()));
    if (!r.ok) throw new Error(r.error);
    guardarLS('histSrv', { lista: r.lista, cuando: ahora() });
    renderServidor(r.lista, ahora());
  } catch (e) { if (!cache) caja.innerHTML = '<div class="vacio">No se pudieron cargar las inspecciones. Revisa tu señal e intenta de nuevo.</div>'; }
}

function renderServidor(l, cuando) {
  if (!l.length) { $('historialSrv').innerHTML = '<div class="vacio">Todavía no hay inspecciones registradas en la hoja.</div>'; return; }
  const caja = (ok, txt, nom) => `<div class="${ok ? 'si' : ''}"><b>${txt}</b>${ok ? esc(nom) : 'Pendiente'}</div>`;
  $('historialSrv').innerHTML = `<p class="nota" style="margin:0 0 8px 2px">Actualizado: ${cuando}</p>` + l.map(i => `<div class="panel hi">
      <div class="cab"><div><div class="f">${fmt(i.fecha)}, ${esc(i.dia)}</div>
        <div class="s">Línea ${esc(i.linea || 'sin especificar')}. Inspector: ${esc(i.inspector)}</div></div></div>
      <div class="chips"><span class="etq">${i.revisados} revisados</span>
        <span class="etq ${i.fugas ? 'f' : 'ok'}">${i.fugas ? i.fugas + (i.fugas > 1 ? ' fugas' : ' fuga') : 'Sin fugas'}</span>${i.derrames ? `<span class="etq f">${i.derrames} con derrame</span>` : ''}</div>
      <div class="firmas">${caja(i.firmaInspector, 'Inspector', i.inspector)}${caja(!!i.responsable, 'Resp. de área', i.responsable)}${caja(!!i.jefe, 'Jefe de producción', i.jefe)}</div>
      <div class="btns">
        ${!i.responsable ? `<button class="btn sec peq" onclick="firmarServidor('${esc(i.id)}','responsable')">Firma responsable</button>` : ''}
        ${!i.jefe ? `<button class="btn sec peq" onclick="firmarServidor('${esc(i.id)}','jefe')">Firma jefe</button>` : ''}
        <button class="btn peq" onclick="pdfServidor('${esc(i.id)}')">Descargar PDF</button>
      </div></div>`).join('');
}

async function pdfServidor(id) {
  if (!navigator.onLine) return toast('Necesitas señal para descargar esta inspección');
  toast('Preparando el PDF…');
  try {
    const r = await post(Object.assign({ accion: 'detalle', id }, cred()));
    if (!r.ok) return toast(r.error || 'No se encontró la inspección');
    imprimir(r.inspeccion);
  } catch (e) { toast('No se pudo conectar con el servidor'); }
}

async function firmarServidor(id, rol) {
  if (!navigator.onLine) return toast('Necesitas señal para firmar esta inspección');
  const f = await pedirFirma(tituloRol(rol), '', true);
  if (!f) return;
  try {
    const r = await post(Object.assign({ accion: 'firmas', id, firmas: { [rol]: f } }, cred()));
    if (!r.ok) return toast(r.error || 'No se pudo guardar la firma');
    const loc = await unaInsp(id);
    if (loc) { loc.firmas = loc.firmas || {}; if (!loc.firmas[rol]) { loc.firmas[rol] = f; await guardarInsp(loc); } }
    toast('Firma guardada');
    pintarServidor();
  } catch (e) { toast('No se pudo conectar con el servidor'); }
}

// ---------- PDF ----------
async function descargarPDF(id) {
  const i = await unaInsp(id); if (!i) return;
  imprimir(i);
}
function imprimir(i) {
  $('reporte').innerHTML = htmlReporte(i);
  const titulo = document.title;
  document.title = 'BP-PROD-FR-034 ' + i.fecha + (i.linea ? ' Linea ' + i.linea : '');
  window.onafterprint = () => { document.title = titulo; };
  toast('En la impresora elige "Guardar como PDF"');
  setTimeout(() => window.print(), 400);
}

function htmlReporte(i) {
  const it = itemsDe(i), fi = i.firmas || {};
  const rev = it.filter(e => e.estado).length, fug = it.filter(e => e.estado === 'Con fuga');
  const der = it.filter(e => e.derrame).length;
  const folio = 'F-' + String(creada(i)).slice(-7);
  const X = b => b ? '&#10003;' : '';
  const ars = [...new Set(it.map(e => e.area))];

  const resumenAreas = ars.map(a => {
    const l = it.filter(e => e.area === a);
    return `<tr><td>${esc(a)}</td><td class="c">${l.length}</td><td class="c">${l.filter(e => e.estado).length}</td>
      <td class="c">${l.filter(e => e.estado === 'Sin fuga').length}</td><td class="c">${l.filter(e => e.estado === 'Con fuga').length}</td>
      <td class="c">${l.filter(e => e.derrame).length}</td></tr>`;
  }).join('');

  const hallazgos = fug.length ? fug.map(e => `<div class="hz"><div class="tx">
      <div class="t">${e.id}. ${esc(e.equipo)}${e.derrame ? '<span class="der">CON DERRAME</span>' : ''}</div>
      <table><tr><td class="k">Área</td><td>${esc(e.area)}</td></tr>
        <tr><td class="k">Ubicación de la fuga</td><td>${esc(e.ubicacion) || '—'}</td></tr>
        <tr><td class="k">Riesgo potencial</td><td>${esc(e.riesgo) || '—'}</td></tr>
        <tr><td class="k">Acción requerida</td><td>${esc(e.accion) || '—'}</td></tr>
        <tr><td class="k">Responsable</td><td>${esc(e.responsable) || '—'}</td></tr>
        <tr><td class="k">Fecha compromiso</td><td>${fmt(e.fechaCompromiso) || '—'}</td></tr></table></div>
      ${e.foto ? `<img src="${e.foto}" alt="">` : ''}</div>`).join('')
    : '<div class="obs">No se detectaron fugas en esta inspección.</div>';

  let checklist = '';
  ars.forEach(a => {
    checklist += `<tr class="ar"><td colspan="6">${esc(a)}</td></tr>`;
    it.filter(e => e.area === a).forEach(e => {
      checklist += `<tr${e.estado === 'Con fuga' ? ' class="fu"' : ''}><td class="c">${e.id}</td><td>${esc(e.equipo)}</td>
        <td class="c">${X(e.estado === 'Sin fuga')}</td><td class="c">${X(e.estado === 'Con fuga')}</td><td class="c">${X(e.derrame)}</td>
        <td>${e.estado ? '' : 'No revisado'}</td></tr>`;
    });
  });

  const firma = (rol, cargo) => {
    const f = fi[rol];
    return `<div>${f ? `<img src="${f.img}" alt="">` : ''}<div class="ln"><b>${f ? esc(f.nombre) : '&nbsp;'}</b>${cargo}${f ? '<br>' + esc(f.fecha) : ''}</div></div>`;
  };

  return `<table class="enc"><tr>
      <td rowspan="3" class="mk"><b>Uumbal</b><span>Planta extractora de aceite</span></td>
      <td rowspan="3" class="ti"><b>Checklist MOSH y MOAH</b><span>Inspección de fugas de aceite mineral en equipos de proceso</span></td>
      <td class="k">Código</td><td class="v">BP-PROD-FR-034</td></tr>
      <tr><td class="k">Versión</td><td class="v">0</td></tr>
      <tr><td class="k">Folio</td><td class="v">${folio}</td></tr></table>

    <div class="sec">Datos generales</div>
    <table class="gen"><tr><td class="k">Fecha</td><td>${fmt(i.fecha)}</td><td class="k">Día</td><td>${esc(i.dia)}</td><td class="k">Línea</td><td>${esc(i.linea) || '—'}</td></tr>
      <tr><td class="k">Inspector</td><td colspan="3">${esc(i.inspector || '')}</td><td class="k">Registro</td><td>${new Date(creada(i)).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td></tr></table>

    <div class="sec">Resumen</div>
    <div class="kp"><div><b>${rev} / ${it.length}</b>Equipos revisados</div><div><b>${rev - fug.length}</b>Sin fuga</div>
      <div class="f"><b>${fug.length}</b>Con fuga</div><div class="f"><b>${der}</b>Con derrame</div>
      <div><b>${rev ? Math.round((rev - fug.length) / rev * 100) : 0}%</b>Equipos sin fuga</div></div>

    <div class="sec">Resultado por área</div>
    <table class="dt"><tr><th>Área</th><th class="c">Equipos</th><th class="c">Revisados</th><th class="c">Sin fuga</th><th class="c">Con fuga</th><th class="c">Con derrame</th></tr>${resumenAreas}</table>

    <div class="sec">Hallazgos y acciones (${fug.length})</div>
    ${hallazgos}

    <div class="sec">Observaciones generales</div>
    <div class="obs">${esc(i.observaciones) || 'Sin observaciones.'}</div>

    <div class="sec">Firmas</div>
    <div class="fi">${firma('inspector', 'Inspector')}${firma('responsable', 'Responsable de área')}${firma('jefe', 'Jefe de producción')}</div>

    <div class="salto"></div>
    <div class="sec">Anexo: checklist completo</div>
    <table class="dt"><tr><th class="c" style="width:7%">No.</th><th>Equipo / elemento</th><th class="c" style="width:11%">Sin fuga</th>
      <th class="c" style="width:11%">Con fuga</th><th class="c" style="width:12%">Con derrame</th><th style="width:16%">Nota</th></tr>${checklist}</table>

    <div class="pie"><span>BP-PROD-FR-034, versión 0. Folio ${folio}</span><span>Generado el ${ahora()} con la app Checklist MOSH y MOAH</span></div>`;
}

// ---------- Tablero ----------
const tableroValido = d => d && d.ok && d.kpi && Array.isArray(d.porArea) && Array.isArray(d.semanas);
async function cargarTablero() {
  let cache = leer('tablero', null);
  if (cache && !tableroValido(cache.datos)) { localStorage.removeItem('tablero'); cache = null; }   // descarta datos guardados dañados
  if (cache) { try { pintarTablero(cache.datos, cache.cuando); } catch (e) { cache = null; } }
  if (!cache) $('tablero').innerHTML = '<div class="vacio">Cargando indicadores…</div>';
  if (!navigator.onLine) {
    if (!cache) $('tablero').innerHTML = '<div class="vacio">Conéctate a internet para ver el tablero la primera vez.</div>';
    return;
  }
  try {
    const d = await (await fetch(URL_SCRIPT + '?vista=tablero', { cache: 'no-store' })).json();
    if (!tableroValido(d)) {
      $('tablero').innerHTML = '<div class="vacio">El script publicado todavía no tiene el tablero. En Apps Script publica la versión más reciente con Gestionar implementaciones, Nueva versión.</div>';
      return;
    }
    guardarLS('tablero', { datos: d, cuando: ahora() });
    pintarTablero(d, ahora());
  } catch (e) { if (!cache) $('tablero').innerHTML = '<div class="vacio">No se pudo cargar el tablero. Toca Actualizar para reintentar.</div>'; }
}
$('btnTab').onclick = cargarTablero;

function pintarTablero(d, cuando) {
  $('tabAct').textContent = 'Actualizado: ' + cuando + ', versión ' + VERSION;
  const k = d.kpi, u = d.ultima;
  const kpi = (v, l, cls) => `<div class="kpi ${cls || ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const maxA = Math.max(1, ...d.porArea.map(a => a.n)), maxS = Math.max(1, ...d.semanas.map(s => s.n));
  $('tablero').innerHTML = `
    <div class="kpis">
      ${kpi(k.abiertas, 'Fugas abiertas', k.abiertas ? 'mal' : 'bien')}
      ${kpi(k.vencidas, 'Acciones vencidas', k.vencidas ? 'mal' : 'bien')}
      ${kpi(k.fugas30, 'Fugas detectadas, 30 días')}
      ${kpi(k.derrames30, 'Con derrame, 30 días', k.derrames30 ? 'mal' : '')}
      ${kpi(k.insp30, 'Inspecciones, 30 días')}
      ${kpi(k.cerradas30, 'Acciones cerradas, 30 días', 'bien')}
    </div>
    ${u ? `<div class="panel pad"><h3>Última inspección</h3>
      <div class="hb"><span>${fmt(u.fecha)}, línea ${esc(u.linea || '—')}</span><div class="bar v"><i style="width:${u.pctSinFuga || 0}%"></i></div><span class="n">${u.pctSinFuga == null ? '—' : u.pctSinFuga + '%'}</span></div>
      <p class="nota">${u.revisados} equipos revisados, ${u.fugas} con fuga. Inspector: ${esc(u.inspector)}. La barra muestra el porcentaje sin fuga.</p></div>` : ''}
    <div class="panel pad"><h3>Fugas por área, últimos 30 días</h3>
      ${d.porArea.map(a => `<div class="hb"><span>${esc(a.area)}</span><div class="bar"><i style="width:${a.n / maxA * 100}%"></i></div><span class="n">${a.n}</span></div>`).join('')}</div>
    <div class="panel pad"><h3>Fugas detectadas por semana</h3>
      <div class="sem">${d.semanas.map(s => `<div><b>${s.n || ''}</b><i style="height:${s.n / maxS * 85}%"></i>${s.etiqueta}</div>`).join('')}</div>
      <p class="nota" style="margin-top:6px">Cada barra es una semana, de lunes a domingo.</p></div>
    <div class="panel pad"><h3>Equipos con más fugas, 90 días</h3>
      ${d.reincidentes.length ? `<table class="tabla"><tr><th>Equipo</th><th>Área</th><th style="text-align:right">Fugas</th></tr>
        ${d.reincidentes.map(r => `<tr><td>${esc(r.equipo)}</td><td>${esc(r.area)}</td><td class="n">${r.n}</td></tr>`).join('')}</table>`
        : '<p class="nota">Sin fugas registradas en los últimos 90 días.</p>'}</div>
    <div class="panel pad"><h3>Acciones abiertas por responsable</h3>
      ${d.porResp.length ? `<table class="tabla"><tr><th>Responsable</th><th style="text-align:right">Abiertas</th><th style="text-align:right">Vencidas</th></tr>
        ${d.porResp.map(r => `<tr><td>${esc(r.nombre)}</td><td class="n">${r.abiertas}</td><td class="n" style="color:${r.vencidas ? 'var(--fuga)' : 'inherit'}">${r.vencidas}</td></tr>`).join('')}</table>`
        : '<p class="nota">No hay acciones abiertas.</p>'}</div>
    <div class="panel pad"><h3>Acciones abiertas (${d.acciones.length})</h3>
      ${d.acciones.length ? d.acciones.map(a => `<div class="acc">
        <div class="q">${esc(a.equipo)}${a.derrame ? ' <span class="etq f">Derrame</span>' : ''}</div>
        <div class="w">${esc(a.area)}. Detectada el ${fmt(a.detectada)}. ${esc(a.accion) || 'Sin acción descrita.'}</div>
        <div class="chips"><span class="etq">${esc(a.resp) || 'Sin responsable'}</span>
          ${a.fc ? `<span class="etq ${a.diasVencida ? 'f' : 'al'}">${a.diasVencida ? 'Vencida hace ' + a.diasVencida + ' días' : 'Compromiso ' + fmt(a.fc)}</span>` : '<span class="etq al">Sin fecha compromiso</span>'}
          ${a.foto ? `<a class="etq" href="${esc(a.foto)}" target="_blank" rel="noopener">Ver foto</a>` : ''}</div>
        <button class="btn sec peq" onclick="cerrarAccion('${esc(a.id)}')">Cerrar acción</button></div>`).join('')
        : '<p class="nota">No hay acciones abiertas.</p>'}</div>`;
}

async function cerrarAccion(id) {
  if (!navigator.onLine) return toast('Necesitas señal para cerrar una acción');
  const com = prompt('¿Qué se hizo para corregir la fuga?');
  if (com === null) return;
  try {
    const r = await post(Object.assign({ accion: 'cerrar', idDetalle: id, comentario: com }, cred()));
    if (!r.ok) return toast('No se encontró la acción');
    toast('Acción cerrada');
    cargarTablero();
  } catch (e) { toast('No se pudo conectar con el servidor'); }
}

// ---------- Sincronización ----------
let sincronizando = false;
async function sincronizar() {
  if (!navigator.onLine || sincronizando || !sesion) return pintarEstado();
  sincronizando = true;
  try {
    const cola = leer('respNuevos', []);
    if (cola.length) {
      const r = await post(Object.assign({ accion: 'responsable', lista: cola }, cred()));
      if (r.ok) guardarLS('respNuevos', []);
    }
    for (const i of await todas()) {
      if (!i.enviada) {
        const detalles = itemsDe(i).filter(e => e.estado).map(e => ({
          idEquipo: e.id, estado: e.estado, derrame: e.derrame, riesgo: e.riesgo, ubicacion: e.ubicacion,
          accion: e.accion, responsable: e.responsable, fechaCompromiso: e.fechaCompromiso, foto: e.foto }));
        const r = await post(Object.assign({ accion: 'guardar', inspeccion: { id: i.id, fecha: i.fecha, dia: i.dia,
          linea: i.linea, observaciones: i.observaciones, detalles, firmas: i.firmas } }, cred()));
        if (r.ok) { i.enviada = true; i.firmasPend = false; await guardarInsp(i); }
      } else if (i.firmasPend) {
        const r = await post(Object.assign({ accion: 'firmas', id: i.id, firmas: i.firmas }, cred()));
        if (r.ok) { i.firmasPend = false; await guardarInsp(i); }
      }
    }
    const env = (await todas()).filter(x => x.enviada && !x.firmasPend);
    for (const v of env.slice(40)) await borrarInsp(v.id);
    await cargarCatalogo();
  } catch (e) { /* sin conexión: se reintenta después */ }
  sincronizando = false;
  pintarEstado();
  if (!$('vHist').hidden) pintarHistorial();
}
$('btnSync').onclick = async () => { await sincronizar(); toast(navigator.onLine ? 'Sincronizado' : 'Sin señal. Se enviará cuando vuelva la conexión'); };
window.addEventListener('online', sincronizar);
window.addEventListener('offline', pintarEstado);
setInterval(sincronizar, 60000);

// ---------- Arranque ----------
if (sesion && equipos.length) iniciar(); else ver('login');
pintarEstado();
