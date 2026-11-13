const URL_SCRIPT = 'https://script.google.com/macros/s/AKfycbwkS0oj-FlwV05LcE_kyNP7xeepCHtIamG_7wCAbeqloopgqGJmBGgHraZvXGNmmut2/exec';
const $ = id => document.getElementById(id);
const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
let equipos = JSON.parse(localStorage.getItem('equipos') || '[]');
let sesion = JSON.parse(localStorage.getItem('sesion') || 'null');
let respuestas = {};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// ---------- Base local (IndexedDB) ----------
function db() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('checklist', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pendientes', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result); r.onerror = mal;
  });
}
async function guardarLocal(insp) {
  const d = await db();
  return new Promise(ok => { const t = d.transaction('pendientes', 'readwrite');
    t.objectStore('pendientes').put(insp); t.oncomplete = ok; });
}
async function pendientes() {
  const d = await db();
  return new Promise(ok => { const r = d.transaction('pendientes').objectStore('pendientes').getAll();
    r.onsuccess = () => ok(r.result); });
}
async function borrarLocal(id) {
  const d = await db();
  return new Promise(ok => { const t = d.transaction('pendientes', 'readwrite');
    t.objectStore('pendientes').delete(id); t.oncomplete = ok; });
}

async function post(datos) {
  const r = await fetch(URL_SCRIPT, { method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(datos) });
  return r.json();
}

async function estado() {
  const n = (await pendientes()).length;
  $('estado').textContent = (navigator.onLine ? 'En línea' : 'Sin señal') + ' · ' + n + ' inspección(es) por enviar';
}

// ---------- Login ----------
$('btnLogin').onclick = async () => {
  const usuario = $('usuario').value.trim(), pin = $('pin').value.trim();
  if (navigator.onLine) {
    try {
      const r = await post({ accion: 'login', usuario, pin });
      if (!r.ok) return alert(r.error);
      sesion = { usuario, pin, nombre: r.nombre };
      localStorage.setItem('sesion', JSON.stringify(sesion));
      await cargarEquipos();
    } catch (e) { return alert('No se pudo conectar'); }
  } else {
    const s = JSON.parse(localStorage.getItem('sesion') || 'null');
    if (!s || s.usuario !== usuario || s.pin !== pin)
      return alert('Sin señal: entra la primera vez con internet');
    sesion = s;
  }
  mostrarFormulario();
};
$('btnSalir').onclick = () => { localStorage.removeItem('sesion'); location.reload(); };

async function cargarEquipos() {
  const r = await (await fetch(URL_SCRIPT)).json();
  if (r.ok) { equipos = r.equipos; localStorage.setItem('equipos', JSON.stringify(equipos)); }
}

// ---------- Formulario ----------
function mostrarFormulario() {
  $('login').classList.add('oculto'); $('form').classList.remove('oculto');
  $('bienvenida').textContent = 'Inspector: ' + sesion.nombre;
  $('fecha').valueAsDate = new Date();
  respuestas = {};
  let html = '', area = '';
  equipos.forEach(e => {
    if (e.area !== area) { area = e.area; html += `<div class="area">${area}</div>`; }
    html += `<div class="card" id="c${e.id}"><b>${e.id}. ${e.equipo}</b>
      <div class="op"><button class="ok" onclick="marcar(${e.id},'Sin fuga',this)">Sin fuga</button>
      <button onclick="marcar(${e.id},'Con fuga',this)">Con fuga</button></div>
      <div class="extra">
        <label><input type="checkbox" id="der${e.id}" style="width:auto"> Con derrame</label>
        <input id="rie${e.id}" placeholder="Riesgo potencial">
        <input id="ubi${e.id}" placeholder="¿Dónde se observa la fuga?">
        <input id="acc${e.id}" placeholder="Acción requerida">
        <input id="res${e.id}" placeholder="Responsable">
        <input id="fc${e.id}" type="date">
        <input type="file" accept="image/*" capture="environment" onchange="foto(${e.id},this)">
        <img class="prev" id="img${e.id}">
      </div></div>`;
  });
  $('lista').innerHTML = html;
  estado();
}

function marcar(id, valor, btn) {
  respuestas[id] = respuestas[id] || {};
  respuestas[id].estado = valor;
  btn.parentNode.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
  $('c' + id).classList.toggle('fuga', valor === 'Con fuga');
}

// Reduce la foto a 1024 px para que pese poco
function foto(id, input) {
  const f = input.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = img.width * k; c.height = img.height * k;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    respuestas[id] = respuestas[id] || {};
    respuestas[id].foto = c.toDataURL('image/jpeg', 0.6);
    $('img' + id).src = respuestas[id].foto;
  };
  img.src = URL.createObjectURL(f);
}

$('btnGuardar').onclick = async () => {
  const faltan = equipos.filter(e => !respuestas[e.id] || !respuestas[e.id].estado);
  if (faltan.length && !confirm('Faltan ' + faltan.length + ' equipos por revisar. ¿Guardar así?')) return;
  const fecha = $('fecha').value;
  const insp = {
    id: 'INS-' + Date.now() + '-' + sesion.usuario,
    fecha, dia: DIAS[new Date(fecha + 'T12:00').getDay()], linea: $('linea').value,
    observaciones: $('obs').value,
    detalles: equipos.filter(e => respuestas[e.id] && respuestas[e.id].estado).map(e => ({
      idEquipo: e.id, estado: respuestas[e.id].estado,
      derrame: $('der' + e.id).checked, riesgo: $('rie' + e.id).value,
      ubicacion: $('ubi' + e.id).value, accion: $('acc' + e.id).value,
      responsable: $('res' + e.id).value, fechaCompromiso: $('fc' + e.id).value,
      foto: respuestas[e.id].foto || ''
    }))
  };
  await guardarLocal(insp);
  alert('Inspección guardada en el teléfono');
  mostrarFormulario();
  sincronizar();
};

// ---------- Sincronización ----------
let sincronizando = false;
async function sincronizar() {
  if (!navigator.onLine || sincronizando || !sesion) return estado();
  sincronizando = true;
  for (const insp of await pendientes()) {
    try {
      const r = await post({ accion: 'guardar', usuario: sesion.usuario, pin: sesion.pin, inspeccion: insp });
      if (r.ok) await borrarLocal(insp.id);
    } catch (e) { break; }
  }
  sincronizando = false;
  estado();
}
$('btnSync').onclick = sincronizar;
window.addEventListener('online', sincronizar);
window.addEventListener('offline', estado);
setInterval(sincronizar, 60000);

if (sesion && equipos.length) { mostrarFormulario(); sincronizar(); }
estado();
