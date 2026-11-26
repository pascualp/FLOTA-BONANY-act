// Pruebas automáticas de lo que más se rompe sin que se note: leer fechas escritas a mano, el estado de cada
// vencimiento, qué cuenta como «por mirar», quién puede entrar, importes de reparaciones y el planificador.
// Uso: npm test   (no toca la base ni Internet). Si algo falla, sale el caso y termina con error.
import assert from 'node:assert/strict';
import { getAlertStatus, getVehicleAlerts, noAplica, papelesCaducados, parseEsDate, problemasDe, aFechaInput, deFechaInput, normalizarMatricula, conCambio, nuevoCambio, HISTORIAL_MAX, fechaEnPantalla, fraseVencimiento, type AlertaVehiculo } from '../src/utils.ts';
import { tieneAcceso } from '../src/acceso.ts';
import { leerImporte, gastoPorAnio, diaDe, refReparacion, ultimaDe } from '../src/reparaciones.ts';
import { arregladaPor, queArregla } from '../src/incidencias.ts';
import { copiaDe, fechaCopiaMal, textoCopia } from '../src/copiaCamion.ts';
import { esFestivo, planificar, tareasPendientes } from '../src/planificador.ts';
import type { Vehicle } from '../src/types.ts';

let n = 0;
const prueba = (nombre: string, fn: () => void) => {
  try { fn(); n++; } catch (e: any) { console.error(`✗ ${nombre}\n  ${e.message}`); process.exitCode = 1; }
};
const f = (d: Date | null) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : null);
const HOY = new Date(2026, 10, 25, 11, 0);   // 25/11/2026
const v = (x: Partial<Vehicle>): Vehicle => ({ matricula: 'TEST', marca: '', tipo: 'CAMION', tipoCaja: '', capacidad: '', fechaMatriculacion: '', bastidor: '', chofer: '', aseguradora: '', poliza: '', proximaITV: '', vencimientoATP: '', revisionTacografo: '', ...x });

// ---------- Fechas escritas a mano (valores reales de la flota) ----------
prueba('fechas que se entienden', () => {
  const casos: [string, string][] = [
    ['23/03/27', '23/03/2027'], ['20/08/2026', '20/08/2026'], ['05/30', '31/05/2030'], ['03-2027', '31/03/2027'],
    ['sep/2026', '30/09/2026'], ['septiembre de 2026', '30/09/2026'], ['11/26', '30/11/2026'], ['02/28', '29/02/2028'],
    ['15 de mayo de 2027', '15/05/2027'], ['15.05.2027', '15/05/2027'], ['maig 2027', '31/05/2027'], ['nov/26', '30/11/2026'],
    ['15/05/27 (renovar)', '15/05/2027'],
  ];
  for (const [txt, esperado] of casos) assert.equal(f(parseEsDate(txt)), esperado, `«${txt}»`);
});
prueba('fechas que NO se entienden (no se adivina)', () => {
  for (const txt of ['00/00/00', '31/02/27', 'FALTA', 'N/A', 'ITV 23/03/27', '13/2026', '']) assert.equal(parseEsDate(txt), null, `«${txt}»`);
});
prueba('calendario del formulario', () => {
  assert.equal(aFechaInput('sep/2026'), '2026-09-30');
  assert.equal(deFechaInput('2027-03-23'), '23/03/2027');
  assert.equal(aFechaInput('FALTA'), '');
});

// ---------- Estado de cada vencimiento ----------
prueba('estado según la fecha', () => {
  assert.equal(getAlertStatus('24/11/2026', 'medium', HOY).status, 'danger');
  assert.equal(getAlertStatus('25/11/2026', 'medium', HOY).text, 'Vence HOY');
  assert.equal(getAlertStatus('11/26', 'medium', HOY).text, 'Vence en 5 días');   // «hasta noviembre» vale todo el mes
  assert.equal(getAlertStatus('26/12/2026', 'medium', HOY).status, 'success');
  assert.equal(getAlertStatus('26/12/2026', 'high', HOY).status, 'warning');     // prioridad alta: avisa 60 días antes
  assert.equal(getAlertStatus('FALTA', 'medium', HOY).text, 'Falta la fecha');
  assert.equal(getAlertStatus('00/00/00', 'medium', HOY).text, 'Fecha que no entiendo');
});
prueba('en pantalla: fechas siempre dd/mm/aaaa y dichas con una frase', () => {
  assert.equal(fechaEnPantalla('02/29'), '28/02/2029');
  assert.equal(fechaEnPantalla('23/10/24'), '23/10/2024');
  assert.equal(fechaEnPantalla('FALTA'), 'FALTA');
  const a = (date: string, extra: Partial<AlertaVehiculo> = {}): AlertaVehiculo =>
    ({ label: 'ITV', clave: 'itv', date, ...getAlertStatus(date, 'medium', HOY), ...extra });
  assert.equal(fraseVencimiento(a('18/04/2026'), HOY), 'Caducó el 18/04/2026, hace 7 meses');
  assert.equal(fraseVencimiento(a('29/11/2026'), HOY), 'Caduca el 29/11/2026, en 4 días');
  assert.equal(fraseVencimiento(a('25/11/2026'), HOY), 'Caduca HOY (25/11/2026)');
  assert.equal(fraseVencimiento(a('14/05/28'), HOY), 'En regla hasta el 14/05/2028');
  assert.equal(fraseVencimiento(a('sin fecha', { status: 'unknown', text: 'Falta la fecha' }), HOY), 'Falta apuntar la fecha');
  assert.equal(fraseVencimiento(a('18/04/2026', { cita: { fecha: '02/12/2026', hora: '16:30', lugar: 'Inca' } }), HOY),
    'Cita el 02/12/2026 a las 16:30 en Inca · caducó el 18/04/2026, hace 7 meses');
});
prueba('«N/A» = no le toca', () => {
  for (const s of ['N/A', 'n/a', 'No aplica', 'NO TIENE', '-']) assert.ok(noAplica(s), s);
  assert.ok(!noAplica('FALTA'));
});

// ---------- Qué cuenta como «por mirar» (el fallo de las «3 alertas» del 4666HWY) ----------
prueba('lo que está en regla NO es alerta', () => {
  const todoBien = v({ proximaITV: '23/03/30', vencimientoATP: '05/30', revisionTacografo: '15/05/30', tipoCaja: 'FRIGO', capacidad: '6.500 Kg', vencimientoSeguro: '30/04/2030' });
  assert.deepEqual(problemasDe(todoBien), { vencidos: 0, pronto: 0, revisar: 0, conCita: 0 });
});
prueba('falta la fecha que le toca → a revisar (no «Al día»)', () => {
  const coche = v({ tipo: 'COCHE' });   // sin ITV ni seguro
  const p = problemasDe(coche);
  assert.equal(p.revisar, 2);   // ITV y seguro (a un coche no le toca ATP ni tacógrafo)
  const iso = v({ tipoCaja: 'ISO', proximaITV: '01/01/2030', vencimientoSeguro: '01/01/2030', capacidad: '1.940 Kg' });
  assert.ok(getVehicleAlerts(iso).some((a) => a.clave === 'atp' && a.text === 'Falta la fecha'));   // isotermo → ATP
  assert.ok(!getVehicleAlerts(iso).some((a) => a.clave === 'tacografo'));                          // ≤ 3.500 kg → sin tacógrafo
});
prueba('ATP «sep/2026» vencida y su papel caducado', () => {
  const x = v({ matricula: '4666HWY', tipoCaja: 'FRIGO', capacidad: '6.500 Kg', proximaITV: '23/03/30', vencimientoATP: 'sep/2026', revisionTacografo: '15/05/30', vencimientoSeguro: '30/04/2030' });
  assert.equal(problemasDe(x).vencidos, 1);
  assert.deepEqual(papelesCaducados(x), ['ATP']);
});
prueba('con cita sacada no cuenta como vencido', () => {
  const x = v({ proximaITV: '01/01/2020', vencimientoSeguro: '01/01/2030', citas: { itv: { fecha: '02/12/2026' } } });
  const p = problemasDe(x);
  assert.equal(p.vencidos, 0);
  assert.equal(p.conCita, 1);
});

// ---------- Matrículas, historial y acceso ----------
prueba('matrículas iguales escritas distinto', () => {
  assert.equal(normalizarMatricula(' 9151-kwj '), '9151KWJ');
});
prueba('historial: lo nuevo delante y como mucho 15', () => {
  let h = undefined as any;
  for (let i = 0; i < 20; i++) h = conCambio(h, nuevoCambio('prueba', `cambio ${i}`));
  assert.equal(h.length, HISTORIAL_MAX);
  assert.equal(h[0].que, 'cambio 19');
});
prueba('solo entran las dos cuentas, con correo verificado', () => {
  assert.ok(tieneAcceso('porteousfacundo@gmail.com', true));
  assert.ok(tieneAcceso('FruitesBonany20@gmail.com', true));
  assert.ok(!tieneAcceso('otro@gmail.com', true));
  assert.ok(!tieneAcceso('porteousfacundo@gmail.com', false));
  assert.ok(!tieneAcceso(null, undefined));
});

// ---------- Reparaciones ----------
prueba('importes y gasto por año', () => {
  assert.equal(leerImporte('1.234,56 €'), 1234.56);
  assert.equal(leerImporte('1234.5'), 1234.5);
  assert.equal(leerImporte('abc'), null);
  assert.equal(diaDe('05/03/2026'), '2026-03-05');
  const g = gastoPorAnio([{ fecha: '', dia: '2026-02-01', que: 'a', importe: 100 }, { fecha: '', dia: '2026-03-01', que: 'b', importe: 23.5 }]);
  assert.deepEqual(g['2026'], { total: 123.5, n: 2 });
});
prueba('un aviso del taller que arregla una factura posterior NO queda como incidencia', () => {
  const reps = [
    { fecha: '28/09/2026', que: '2 neumáticos delanteros 195/75 R16 Falken, válvulas y equilibrado' },
    { fecha: '31/10/2026', que: 'Frenos: pérdida de líquido, discos, pastillas, sensores y pinza nuevos' },
  ];
  assert.equal(arregladaPor('Pastillas de freno delanteras para cambiar', '28/09/2026', reps)?.fecha, '31/10/2026');
  assert.equal(arregladaPor('Embrague patina', '28/09/2026', reps), undefined);          // nada que ver
  assert.equal(arregladaPor('Frenos', '01/11/2026', reps), undefined);                    // la reparación es ANTERIOR
});
prueba('una reparación nueva dice qué incidencia pendiente arregla (y no la suya propia)', () => {
  const incs = [
    { id: 'a', texto: 'Pastillas de freno delanteras para cambiar', fecha: '28/09/2026', origen: 'Neuretec', repId: 'r1' },
    { id: 'b', texto: 'Embrague patina', fecha: '01/10/2026', origen: 'Telegram' },
    { id: 'c', texto: 'Ruido en los frenos', fecha: '05/11/2026', origen: 'Telegram' },   // POSTERIOR a la reparación
  ];
  assert.deepEqual(queArregla({ fecha: '31/10/2026', que: 'Frenos: discos, pastillas y pinza nuevos' }, incs).map((i) => i.id), ['a']);
  assert.deepEqual(queArregla({ fecha: '28/09/2026', que: 'Pastillas', id: 'r1' }, incs), []);   // su propio aviso
});
prueba('la «última reparación» no retrocede al apuntar una factura vieja', () => {
  assert.equal(ultimaDe([{ fecha: '31/10/2026' }, { fecha: '25/09/2026' }]), '31/10/2026');
  assert.equal(ultimaDe([{ fecha: '22/10/2026' }, { fecha: '' }, { fecha: '31/10/2026' }]), '31/10/2026');
  assert.equal(ultimaDe([]), '');
});
prueba('la misma factura por Telegram y por el importador da la misma clave', () => {
  const bot = refReparacion('8031 MHJ', '25/09/2026', '#2026/002316');
  const limpio = (x: string) => String(x || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');   // la del importador (.cjs)
  const importador = ['8031MHJ', '25/09/2026', '2026/002316'].map(limpio).join('|');
  assert.equal(bot, importador);
});

// ---------- Copia de los papeles en el camión ----------
prueba('copia en el camión: fecha válida, que no sea futura, y el texto de cada caso', () => {
  assert.equal(fechaCopiaMal('25/11/2026', '26/11/2026'), null);
  assert.equal(fechaCopiaMal(' 26/11/2026 ', '26/11/2026'), null);              // hoy vale (con espacios)
  assert.match(fechaCopiaMal('27/11/2026', '26/11/2026')!, /posterior/);        // mañana, no
  assert.match(fechaCopiaMal('31/02/2026', '26/11/2026')!, /no existe/);
  assert.match(fechaCopiaMal('25/11/26', '26/11/2026')!, /así/);                // año con 4 cifras
  assert.match(fechaCopiaMal('ayer', '26/11/2026')!, /así/);
  assert.equal(fechaCopiaMal('31/12/2025', '01/01/2026'), null);                // cambio de año
  assert.equal(copiaDe(v({})), undefined);
  assert.equal(copiaDe(v({ copiaCamion: { fecha: '', por: 'x' } })), undefined);
  assert.equal(copiaDe(v({ copiaCamion: { fecha: '25/11/2026', por: 'x' } }))?.fecha, '25/11/2026');
  assert.match(textoCopia(v({ copiaCamion: { fecha: '25/11/2026', por: 'x' } })), /desde el 25\/11\/2026/);
  assert.match(textoCopia(v({})), /Todavía no/);
});

// ---------- Planificador de revisiones ----------
prueba('festivos y un vehículo al día, de lunes a viernes', () => {
  assert.ok(esFestivo(new Date(2026, 11, 25)));   // Navidad
  const flota = [
    v({ matricula: 'A', proximaITV: '01/11/2026' }) as Vehicle, v({ matricula: 'B', proximaITV: '10/12/2026' }) as Vehicle,
  ].map((x, i) => ({ ...x, id: 'id' + i }));
  const plan = planificar(tareasPendientes(flota, HOY), new Set(), HOY);
  assert.equal(plan.length, 2);
  for (const d of plan) {
    const dia = parseEsDate(d.fecha)!.getDay();   // en el plan la fecha va como texto dd/mm/aaaa
    assert.ok(dia >= 1 && dia <= 5, `${d.fecha} cae en fin de semana`);
  }
  assert.notEqual(plan[0].fecha, plan[1].fecha);
  assert.equal(plan[0].matricula, 'A');   // primero lo vencido
});

console.log(process.exitCode ? `\nHAY FALLOS (${n} pruebas bien)` : `✔ ${n} pruebas bien`);
