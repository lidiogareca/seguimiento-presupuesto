
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let MON = '$'; try { MON = localStorage.getItem('mon') || '$'; } catch (e) { }
const fmt = n => MON + ' ' + Math.round(n || 0).toLocaleString('es-AR');
const pct = n => (isFinite(n) ? n : 0).toFixed(0) + '%';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let budget = [], expenses = [], tab = 'resumen', charts = [], store = null, canImg = true;
const hoyMes = new Date().toISOString().slice(0, 7);

/* ---------- parseo de números, fechas y meses (acepta lo que pega Excel) ---------- */
const num = s => { s = String(s ?? '').trim().replace(/[^\d.,\-]/g, ''); if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, ''); else if (/\.\d{3}$/.test(s) && (s.match(/\./g) || []).length >= 1) s = s.replace(/\./g, ''); return +s || 0; };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaISO(s) { s = String(s ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // día/mes/año
  return ''; }
function mesISO(s) { s = String(s ?? '').trim().toLowerCase(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{4})$/))) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const f = fechaISO(s); if (f) return f.slice(0, 7);
  if ((m = s.match(/^([a-záéíóú]{3,})\.?[\s\-\/]*(\d{2,4})$/))) { const k = MESES.indexOf(m[1].slice(0, 3).replace('set', 'sep')); if (k >= 0) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${String(k + 1).padStart(2, '0')}`; }
  return ''; }
const mesTxt = m => { if (!m) return ''; const [y, mm] = m.split('-'); return MESES[+mm - 1] + ' ' + y; };

/* ---------- datos: Firebase (login + base de datos) ---------- */
import { firebaseConfig } from './config.js';
async function iniciarFirebase() {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [{ initializeApp }, A, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = initializeApp(firebaseConfig), auth = A.getAuth(app), db = F.getFirestore(app);
  return {
    onUser: cb => A.onAuthStateChanged(auth, u => cb(u ? { email: u.email } : null)),
    login: (m, p) => A.signInWithEmailAndPassword(auth, m, p),
    logout: () => A.signOut(auth),
    reset: m => A.sendPasswordResetEmail(auth, m),
    listen(f, onErr) {
      const a = F.onSnapshot(F.collection(db, 'budget'), s => { budget = s.docs.map(x => ({ ...x.data(), id: x.id })); f(); }, onErr);
      const b = F.onSnapshot(F.collection(db, 'expenses'), s => { expenses = s.docs.map(x => ({ ...x.data(), id: x.id })); f(); }, onErr);
      return () => { a(); b(); };
    },
    set: (col, o) => { const { id, ...r } = o; return F.setDoc(F.doc(db, col, id), r); },
    del: (col, id) => F.deleteDoc(F.doc(db, col, id)),
  };
}

/* ---------- cálculos ---------- */
const gastado = id => expenses.filter(e => e.itemId === id).reduce((s, e) => s + (+e.amount || 0), 0);
const cant = id => expenses.filter(e => e.itemId === id).length;
function estado(it) {
  const g = gastado(it.id), p = +it.amount || 0;
  if (p && g > p) return ['Excedido', 't-r'];
  if (p && g / p >= .9) return ['Cerca del límite', 't-w'];
  if (g === 0) return it.month && it.month < hoyMes ? ['Atrasado (sin gastos)', 't-w'] : ['Sin iniciar', 't-g'];
  return ['En curso', 't-ok'];
}
const rango = (a, b) => { const o = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { o.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } return o; };

/* ---------- pestañas ---------- */
const TABS = [['resumen', 'Resumen'], ['presupuesto', 'Presupuesto'], ['gastos', 'Gastos'], ['importar', 'Importar de Excel'], ['exportar', 'Exportar']];
function pintarTabs() { $('#tabs').innerHTML = TABS.map(([k, t]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join(''); }
$('#tabs').onclick = e => { if (e.target.dataset.t) { tab = e.target.dataset.t; vista(); } };
function vista() { pintarTabs(); charts.forEach(c => c.destroy()); charts = []; ({ resumen: vResumen, presupuesto: vPpto, gastos: vGastos, importar: vImportar, exportar: vExportar })[tab](); }
function refresco() { if (tab === 'resumen') vista(); else if (tab === 'presupuesto') tablaPpto(); else if (tab === 'gastos') { opcionesItems(); tablaGastos(); } }
const ordenItems = () => [...budget].sort((a, b) => String(a.nro).localeCompare(String(b.nro), 'es', { numeric: true }));

/* ---------- RESUMEN ---------- */
function vResumen() {
  const plan = budget.reduce((s, i) => s + (+i.amount || 0), 0), eje = expenses.reduce((s, e) => s + (+e.amount || 0), 0);
  const huerf = expenses.filter(e => !budget.some(i => i.id === e.itemId)).length;
  const [t, c] = !budget.length ? ['Sin datos', 't-g'] : eje > plan ? ['Excedido', 't-r'] : budget.some(i => estado(i)[1] === 't-r' || estado(i)[0].startsWith('Atras')) ? ['Con alertas', 't-w'] : ['En orden', 't-ok'];
  $('#vista').innerHTML = `<div class="kpis">
   <div class="kpi"><small>Presupuesto</small><b>${fmt(plan)}</b></div>
   <div class="kpi"><small>Ejecutado</small><b>${fmt(eje)}</b><small>${pct(plan ? eje / plan * 100 : 0)} del presupuesto</small></div>
   <div class="kpi"><small>Saldo</small><b>${fmt(plan - eje)}</b></div>
   <div class="kpi"><small>Comprobantes cargados</small><b>${expenses.length}</b></div>
   <div class="kpi"><small>Estado</small><span class="tag ${c}">${t}</span></div></div>
  ${budget.length ? '' : '<div class="card">Empezá por la pestaña <b>Presupuesto</b> (cargá ítems a mano) o <b>Importar de Excel</b>. Después cargá los gastos en <b>Gastos</b>.</div>'}
  ${huerf ? `<div class="card">⚠ Hay ${huerf} gasto(s) cuyo ítem ya no existe. Revisalos en la pestaña Gastos.</div>` : ''}
  <div class="g2"><div class="card"><h3>Curva S: plan vs ejecutado (acumulado)</h3><canvas id="g1"></canvas></div>
  <div class="card"><h3>Presupuesto vs ejecutado por ítem</h3><canvas id="g2"></canvas></div></div>
  <div class="card"><h3>Estado por ítem</h3><div class="tw"><table><tr><th>Nro</th><th>Descripción</th><th>Mes plan.</th><th class="n">Presupuesto</th><th class="n">Ejecutado</th><th class="n">%</th><th class="n">Comprob.</th><th>Estado</th></tr>
  ${ordenItems().map(i => { const g = gastado(i.id), [tt, cc] = estado(i); return `<tr><td>${esc(i.nro)}</td><td>${esc(i.desc)}</td><td>${mesTxt(i.month)}</td><td class="n">${fmt(i.amount)}</td><td class="n">${fmt(g)}</td><td class="n">${pct(i.amount ? g / i.amount * 100 : 0)}</td><td class="n">${cant(i.id)}</td><td><span class="tag ${cc}">${tt}</span></td></tr>`; }).join('') || '<tr><td colspan=8 class="soft">Sin ítems todavía.</td></tr>'}</table></div></div>`;
  if (!window.Chart || !budget.length) return;
  const txt = getComputedStyle(document.body).color; Chart.defaults.color = txt;
  const f = [...budget.map(i => i.month), ...expenses.map(e => (e.date || '').slice(0, 7))].filter(Boolean).sort();
  if (f.length) {
    const ms = rango(f[0], f[f.length - 1]), acum = a => a.reduce((o, v, i) => (o.push((o[i - 1] || 0) + v), o), []);
    const p = acum(ms.map(m => budget.filter(i => i.month === m).reduce((s, i) => s + (+i.amount || 0), 0)));
    const r = acum(ms.map(m => expenses.filter(e => (e.date || '').slice(0, 7) === m).reduce((s, e) => s + (+e.amount || 0), 0))).map((v, i) => ms[i] <= hoyMes ? v : null);
    charts.push(new Chart($('#g1'), { type: 'line', data: { labels: ms.map(mesTxt), datasets: [{ label: 'Plan', data: p, borderColor: '#a8742f', backgroundColor: '#a8742f', tension: .2 }, { label: 'Ejecutado', data: r, borderColor: '#2f8f46', backgroundColor: '#2f8f46', tension: .2 }] }, options: { scales: { y: { beginAtZero: true } } } }));
  }
  const its = ordenItems();
  charts.push(new Chart($('#g2'), { type: 'bar', data: { labels: its.map(i => i.nro), datasets: [{ label: 'Presupuesto', data: its.map(i => +i.amount || 0), backgroundColor: '#a8742f' }, { label: 'Ejecutado', data: its.map(i => gastado(i.id)), backgroundColor: '#2f8f46' }] }, options: { scales: { y: { beginAtZero: true } } } }));
}

/* ---------- PRESUPUESTO (a mano, fila por fila) ---------- */
function vPpto() {
  $('#vista').innerHTML = `<div class="card"><h3 id="ptit">Agregar un ítem del presupuesto</h3><div class="row">
   <div><label>Nro de ítem</label><input id="pn"></div><div><label>Descripción</label><input id="pd"></div>
   <div><label>Monto</label><input id="pm" type="number" min="0" step="any"></div><div><label>Mes planificado</label><input id="pf" type="month"></div>
   <div><label>Categoría (opcional)</label><input id="pc"></div></div>
   <button class="p" id="pok">Agregar ítem</button> <button class="s hide" id="pcan">Cancelar edición</button><div class="msg" id="pmsg"></div></div>
  <div class="card"><h3>Ítems del presupuesto</h3><div class="tw" id="ptab"></div></div>`;
  $('#pok').onclick = async () => {
    const m = num($('#pm').value); if (!$('#pd').value.trim()) return msg('#pmsg', 'Falta la descripción.', 1); if (!(m > 0)) return msg('#pmsg', 'Poné un monto mayor a 0.', 1);
    const nro = $('#pn').value.trim() || String(budget.length + 1);
    if (budget.some(i => String(i.nro) === nro && i.id !== editP)) return msg('#pmsg', 'Ya existe un ítem con ese número.', 1);
    await store.set('budget', { id: editP || uid(), nro, desc: $('#pd').value.trim(), amount: m, month: $('#pf').value, cat: $('#pc').value.trim() });
    const era = editP; salirEdicionP(); msg('#pmsg', era ? 'Cambios guardados.' : 'Ítem agregado.');
  };
  $('#pcan').onclick = () => { salirEdicionP(); msg('#pmsg', ''); };
  tablaPpto();
}
let editP = null, editG = null;
function seguro(btn, fn) { if (btn.dataset.arm) { fn(); return; } const t = btn.textContent; btn.dataset.arm = 1; btn.textContent = '¿Seguro? Tocá de nuevo'; setTimeout(() => { if (btn.isConnected) { btn.textContent = t; delete btn.dataset.arm; } }, 4000); }
const msg = (k, t, e) => { $(k).textContent = t; $(k).className = 'msg' + (e ? ' e' : ''); };
function salirEdicionP() { editP = null; ['#pn', '#pd', '#pm', '#pf', '#pc'].forEach(k => $(k).value = ''); $('#pok').textContent = 'Agregar ítem'; $('#pcan').classList.add('hide'); $('#ptit').textContent = 'Agregar un ítem del presupuesto'; }
function tablaPpto() {
  $('#ptab').innerHTML = `<table><tr><th>Nro</th><th>Descripción</th><th>Categoría</th><th>Mes plan.</th><th class="n">Monto</th><th></th></tr>
  ${ordenItems().map(i => `<tr><td>${esc(i.nro)}</td><td>${esc(i.desc)}</td><td>${esc(i.cat)}</td><td>${mesTxt(i.month)}</td><td class="n">${fmt(i.amount)}</td>
  <td class="n"><button class="s" data-ed="${i.id}">Editar</button> <button class="s" data-del="${i.id}">Borrar</button></td></tr>`).join('') || '<tr><td colspan=6 class="soft">Sin ítems.</td></tr>'}</table>`;
  $('#ptab').onclick = async e => {
    const id = e.target.dataset.del || e.target.dataset.ed, it = budget.find(i => i.id === id); if (!it) return;
    if (e.target.dataset.del) return seguro(e.target, () => store.del('budget', id));
    editP = id; $('#pn').value = it.nro; $('#pd').value = it.desc; $('#pm').value = it.amount; $('#pf').value = it.month || ''; $('#pc').value = it.cat || '';
    $('#pok').textContent = 'Guardar cambios'; $('#pcan').classList.remove('hide'); $('#ptit').textContent = 'Editando el ítem ' + it.nro; msg('#pmsg', ''); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

/* ---------- GASTOS + lectura de foto ---------- */
function opcionesItems() {
  const s = $('#gi'); if (!s) return; const v = s.value;
  s.innerHTML = `<option value="">${budget.length ? '— Elegí un ítem —' : '(primero cargá el presupuesto)'}</option>` + ordenItems().map(i => `<option value="${i.id}">${esc(i.nro)} · ${esc(i.desc)}</option>`).join(''); s.value = v;
}
function vGastos() {
  $('#vista').innerHTML = `<div class="card"><h3>Cargar un gasto</h3>
  <div id="fotoBox" ${canImg ? '' : 'class="hide"'}><label>1. Subí la foto de la factura o recibo (opcional): Claude lee los datos y vos los revisás</label>
   <input id="gimg" type="file" accept="image/*"><img id="prev" class="prev hide"><div class="msg" id="lect"></div></div>
  <label>2. Revisá y completá los datos (lo que leyó la IA queda marcado en amarillo)</label>
  <div class="row"><div><label>Fecha</label><input id="gf" type="date"></div>
   <div><label>Descripción</label><input id="gd"></div>
   <div><label>Ítem del presupuesto</label><select id="gi"></select></div>
   <div><label>Monto</label><input id="gm" type="number" min="0" step="any"></div>
   <div><label>Proveedor</label><input id="gp"></div><div><label>Nro de comprobante</label><input id="gn"></div></div>
  <button class="p" id="gok">Guardar gasto</button> <button class="s hide" id="gcan">Cancelar edición</button><div class="msg" id="gmsg"></div></div>
  <div class="card"><h3>Gastos cargados</h3><div class="tw" id="gtab"></div></div>`;
  opcionesItems(); tablaGastos();
  ['#gf', '#gd', '#gi', '#gm', '#gp', '#gn'].forEach(k => $(k).addEventListener('input', () => $(k).classList.remove('hl')));
  $('#gimg').onchange = leerFoto;
  $('#gok').onclick = async () => {
    const m = num($('#gm').value);
    if (!budget.length) return msg('#gmsg', 'Primero cargá o importá el presupuesto.', 1);
    if (!$('#gf').value) return msg('#gmsg', 'Falta la fecha.', 1); if (!$('#gi').value) return msg('#gmsg', 'Elegí a qué ítem del presupuesto corresponde.', 1);
    if (!(m > 0)) return msg('#gmsg', 'Poné un monto mayor a 0.', 1);
    const prev = expenses.find(e => e.id === editG), nro = prev ? prev.nro : Math.max(0, ...expenses.map(e => +e.nro || 0)) + 1;
    await store.set('expenses', { id: editG || uid(), nro, date: $('#gf').value, desc: $('#gd').value.trim(), itemId: $('#gi').value, amount: m, vendor: $('#gp').value.trim(), voucher: $('#gn').value.trim() });
    const era = editG; salirEdicionG(); msg('#gmsg', era ? 'Cambios guardados.' : 'Gasto guardado. Podés cargar otro del mismo ítem.');
  };
  $('#gcan').onclick = () => { salirEdicionG(); msg('#gmsg', ''); };
}
function salirEdicionG() { editG = null; ['#gf', '#gd', '#gm', '#gp', '#gn'].forEach(k => { $(k).value = ''; $(k).classList.remove('hl'); }); $('#gi').value = ''; $('#gimg').value = ''; $('#prev').classList.add('hide'); msg('#lect', ''); $('#gok').textContent = 'Guardar gasto'; $('#gcan').classList.add('hide'); }
function tablaGastos() {
  const nom = id => { const i = budget.find(x => x.id === id); return i ? `${esc(i.nro)} · ${esc(i.desc)}` : '<span class="soft">(ítem borrado)</span>'; };
  $('#gtab').innerHTML = `<table><tr><th>Nro</th><th>Fecha</th><th>Descripción</th><th>Ítem</th><th>Proveedor</th><th>Comprob.</th><th class="n">Monto</th><th></th></tr>
  ${[...expenses].sort((a, b) => (+b.nro || 0) - (+a.nro || 0)).map(e => `<tr><td>${e.nro}</td><td>${esc(e.date)}</td><td>${esc(e.desc)}</td><td>${nom(e.itemId)}</td><td>${esc(e.vendor)}</td><td>${esc(e.voucher)}</td><td class="n">${fmt(e.amount)}</td><td class="n"><button class="s" data-ed="${e.id}">Editar</button> <button class="s" data-d="${e.id}">Borrar</button></td></tr>`).join('') || '<tr><td colspan=8 class="soft">Sin gastos.</td></tr>'}</table>`;
  $('#gtab').onclick = e => {
    const d = e.target.dataset; if (d.d) return seguro(e.target, () => store.del('expenses', d.d));
    const x = expenses.find(q => q.id === d.ed); if (!x) return; editG = x.id;
    $('#gf').value = x.date || ''; $('#gd').value = x.desc || ''; $('#gi').value = x.itemId || ''; $('#gm').value = x.amount; $('#gp').value = x.vendor || ''; $('#gn').value = x.voucher || '';
    $('#gok').textContent = 'Guardar cambios'; $('#gcan').classList.remove('hide'); msg('#gmsg', 'Editando el gasto ' + x.nro); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}
async function reducir(file) { // achica la foto para que viaje rápido (máx. 1600 px)
  const bmp = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .85));
}
function cargarScript(u) { return new Promise((ok, no) => { const t = document.createElement('script'); t.src = u; t.onload = ok; t.onerror = no; document.head.appendChild(t); }); }
function interpretar(txt) { // saca fecha, monto, proveedor y nro de un texto leído (se puede cambiar por una IA más adelante)
  const L = txt.split('\n').map(l => l.trim()).filter(Boolean), o = {};
  const m = txt.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) o.fecha = fechaISO(`${m[1]}/${m[2]}/${m[3]}`);
  const n = txt.match(/(?:n[°º]|nro\.?|n[úu]mero|recibo|factura)\s*[:.]?\s*(\d{3,})/i); if (n) o.nro = n[1];
  const nums = l => (l.match(/\d[\d.,]*\d|\d/g) || []).map(num).filter(v => v > 0 && v < 1e8);
  let t = L.filter(l => /total|importe|monto|son\b/i.test(l)).flatMap(nums); if (!t.length) t = L.flatMap(nums); if (t.length) o.monto = Math.max(...t);
  const v = L.find(l => (l.match(/[A-Za-zÁÉÍÓÚáéíóúñÑ]/g) || []).length >= 4); if (v) o.proveedor = v.slice(0, 60);
  return o;
}
async function leerFoto(e) {
  const f = e.target.files[0]; if (!f) return;
  $('#prev').src = URL.createObjectURL(f); $('#prev').classList.remove('hide'); msg('#lect', 'Leyendo la foto… la primera vez tarda (descarga el lector de texto).');
  try {
    if (!window.Tesseract) await cargarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const r = await Promise.race([window.Tesseract.recognize(f, 'spa'), new Promise((_, no) => setTimeout(() => no(new Error('t')), 90000))]);
    const d = interpretar(r.data.text);
    const put = (k, v) => { if (v) { $(k).value = v; $(k).classList.add('hl'); return 1; } return 0; };
    const n = put('#gf', d.fecha) + put('#gm', d.monto) + put('#gp', d.proveedor) + put('#gn', d.nro);
    msg('#lect', `Lectura básica: completé ${n} campos (en amarillo). Revisá todo: con letra manuscrita se equivoca seguido. Falta elegir el ítem.`);
  } catch (err) { msg('#lect', 'No pude leer la foto. Cargá los datos a mano.', 1); }
}

/* ---------- IMPORTAR de Excel ---------- */
const filas = t => t.replace(/^\ufeff/, '').split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).map(l => l.split(/\t|;/).map(x => x.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"')));
function vImportar() {
  $('#vista').innerHTML = `<div class="card"><h3>1. Importar el presupuesto</h3>
  <p>En Excel, seleccioná las filas con estas columnas, en este orden: <b>Nro de ítem · Descripción · Monto · Mes planificado · Categoría (opcional)</b>. Copiá y pegá acá. La fila de títulos se ignora sola. El mes puede ser 2026-11, 11/2026 o "nov 2026". Si el Nro ya existe, se actualiza.</p>
  <textarea id="ip" rows="6"></textarea><button class="p" id="ipb">Importar presupuesto</button><div class="msg" id="ipm"></div></div>
  <div class="card"><h3>2. Importar gastos</h3>
  <p>Columnas: <b>Fecha · Descripción · Nro de ítem del presupuesto · Monto · Proveedor · Nro de comprobante</b>. El gasto se asigna al ítem por su número; puede haber varios gastos para el mismo ítem.</p>
  <textarea id="ig" rows="6"></textarea><button class="p" id="igb">Importar gastos</button><div class="msg" id="igm"></div></div>`;
  $('#ipb').onclick = async () => { let n = 0;
    for (const c of filas($('#ip').value)) { const monto = num(c[2]); if (c.length < 3 || !(monto > 0)) continue;
      const ex = budget.find(i => String(i.nro) === c[0]); await store.set('budget', { id: ex ? ex.id : uid(), nro: c[0], desc: c[1], amount: monto, month: mesISO(c[3]), cat: c[4] || '' }); n++; }
    if (!n) return msg('#ipm', 'No encontré filas válidas (necesito al menos Nro, Descripción y Monto).', 1); tab = 'presupuesto'; vista(); };
  $('#igb').onclick = async () => { let n = 0, sin = 0; const vistos = new Set(expenses.map(e => [e.date, e.itemId, +e.amount, e.voucher].join('|')));
    for (const c of filas($('#ig').value)) { const monto = num(c[3]), fecha = fechaISO(c[0]); if (!fecha || !(monto > 0)) continue;
      const it = budget.find(i => String(i.nro) === c[2]); if (!it) { sin++; continue; }
      const k = [fecha, it.id, monto, c[5] || ''].join('|'); if (vistos.has(k)) continue; vistos.add(k);
      await store.set('expenses', { id: uid(), nro: Math.max(0, ...expenses.map(e => +e.nro || 0)) + 1 + n, date: fecha, desc: c[1], itemId: it.id, amount: monto, vendor: c[4] || '', voucher: c[5] || '' }); n++; }
    if (!n) return msg('#igm', 'No importé gastos nuevos.' + (sin ? ` ${sin} fila(s) con un Nro de ítem que no existe en el presupuesto.` : ''), 1);
    tab = 'gastos'; vista(); };
}

/* ---------- EXPORTAR ---------- */
function vExportar() {
  $('#vista').innerHTML = `<div class="card"><h3>Exportar a Excel (CSV)</h3><p>Se abre directo en Excel. Útil para seguir en paralelo con tu planilla.</p>
  <button class="p" id="e1">Descargar presupuesto</button> <button class="p" id="e2">Descargar gastos</button><div class="msg" id="em"></div></div>`;
  const csv = r => '﻿' + r.map(f => f.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const bajar = (n, t) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = n; a.click(); };
  $('#e1').onclick = () => bajar('presupuesto.csv', csv([['Nro', 'Descripción', 'Monto', 'Mes planificado', 'Categoría', 'Ejecutado']].concat(ordenItems().map(i => [i.nro, i.desc, i.amount, i.month, i.cat, gastado(i.id)]))));
  $('#e2').onclick = () => bajar('gastos.csv', csv([['Fecha', 'Descripción', 'Nro ítem', 'Monto', 'Proveedor', 'Nro comprobante', 'Nro de gasto']].concat([...expenses].sort((a, b) => a.nro - b.nro).map(e => [e.date, e.desc, (budget.find(i => i.id === e.itemId) || {}).nro || '', e.amount, e.vendor, e.voucher, e.nro]))));
}

/* ---------- ARRANQUE + LOGIN ---------- */
(async () => {
  $('#mon').value = MON; $('#mon').oninput = () => { MON = $('#mon').value; try { localStorage.setItem('mon', MON); } catch (e) { } refresco(); };
  if (firebaseConfig.apiKey === 'REEMPLAZAR') { $('#login').classList.remove('hide'); $('#lerr').textContent = 'Falta conectar Firebase: pegá tus datos en config.js (Paso 3 de la guía).'; return; }
  let fb; try { fb = await iniciarFirebase(); } catch (e) { $('#login').classList.remove('hide'); $('#lerr').textContent = 'No pude conectar con Firebase. Revisá tu internet y config.js.'; return; }
  let stop = () => { };
  fb.onUser(u => {
    $('#login').classList.toggle('hide', !!u); $('#app').classList.toggle('hide', !u);
    if (u) { store = fb; $('#quien').textContent = u.email; vista(); stop = fb.listen(refresco, () => { $('#aviso').textContent = 'Tu correo no tiene permiso para ver los datos. Pedile acceso al administrador.'; $('#aviso').classList.remove('hide'); }); }
    else { stop(); budget = []; expenses = []; store = null; }
  });
  const entrar = async () => {
    $('#lerr').textContent = '';
    try { await fb.login($('#mail').value.trim(), $('#pass').value); } catch (e) { $('#lerr').textContent = 'Correo o contraseña incorrectos.'; }
  };
  $('#entrar').onclick = entrar; $('#pass').onkeydown = e => e.key === 'Enter' && entrar();
  $('#olvide').onclick = async () => { const m = $('#mail').value.trim(); if (!m) return $('#lerr').textContent = 'Escribí tu correo arriba y volvé a tocar.'; try { await fb.reset(m); $('#lerr').textContent = 'Si el correo existe, te enviamos un mensaje para crear una clave nueva.'; } catch (e) { $('#lerr').textContent = 'No pude enviarlo.'; } };
  $('#salir').onclick = () => fb.logout();
})();
