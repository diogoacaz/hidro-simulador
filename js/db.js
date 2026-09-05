// Camada de acesso ao Firestore.
//
// Coleções:
//   usinas/{id}              cadastro de usinas hidrelétricas
//   reservatorios/{id}       reservatórios, limites operacionais/emergenciais e restrições
//   cav/{reservatorioId}     tabela CAV (uma por reservatório)
//   registros/{id}           registros operacionais históricos
//   simulacoes/{id}          simulações executadas (rastreabilidade)
//   auditoria/{id}           log de alterações em limites e restrições

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc,
  deleteDoc, query, where, orderBy, limit, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let db = null;

function getDb() {
  if (!db) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

export function isConfigured() {
  return Boolean(firebaseConfig.apiKey) && firebaseConfig.apiKey !== 'COLE_AQUI_SUA_API_KEY';
}

// --- Usinas ---

export async function listarUsinas() {
  const snap = await getDocs(query(collection(getDb(), 'usinas'), orderBy('nome')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function salvarUsina(dados, id = null) {
  if (id) {
    await updateDoc(doc(getDb(), 'usinas', id), { ...dados, atualizadoEm: serverTimestamp() });
    return id;
  }
  const ref = await addDoc(collection(getDb(), 'usinas'), { ...dados, criadoEm: serverTimestamp() });
  return ref.id;
}

export async function excluirUsina(id) {
  const reservatorios = await listarReservatorios(id);
  if (reservatorios.length) {
    throw new Error(`Esta usina tem ${reservatorios.length} reservatório(s) vinculado(s). Exclua-os primeiro.`);
  }
  await deleteDoc(doc(getDb(), 'usinas', id));
}

// --- Reservatórios ---

export async function listarReservatorios(usinaId = null) {
  const col = collection(getDb(), 'reservatorios');
  const q = usinaId ? query(col, where('usinaId', '==', usinaId)) : query(col);
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
}

export async function obterReservatorio(id) {
  const snap = await getDoc(doc(getDb(), 'reservatorios', id));
  if (!snap.exists()) throw new Error('Reservatório não encontrado.');
  return { id: snap.id, ...snap.data() };
}

export async function salvarReservatorio(dados, id = null) {
  if (id) {
    await updateDoc(doc(getDb(), 'reservatorios', id), { ...dados, atualizadoEm: serverTimestamp() });
    return id;
  }
  const ref = await addDoc(collection(getDb(), 'reservatorios'), { ...dados, criadoEm: serverTimestamp() });
  return ref.id;
}

export async function excluirReservatorio(id) {
  await deleteDoc(doc(getDb(), 'reservatorios', id));
  await deleteDoc(doc(getDb(), 'cav', id)).catch(() => {});
}

// --- Tabela CAV ---

export async function salvarCav(reservatorioId, cav) {
  await setDoc(doc(getDb(), 'cav', reservatorioId), {
    reservatorioId,
    cotaInicial: cav.cotaInicial,
    passo: cav.passo,
    areas: cav.areas,
    volumes: cav.volumes,
    pontos: cav.pontos,
    atualizadoEm: serverTimestamp(),
  });
}

export async function obterCav(reservatorioId) {
  const snap = await getDoc(doc(getDb(), 'cav', reservatorioId));
  return snap.exists() ? snap.data() : null;
}

export async function excluirCav(reservatorioId) {
  await deleteDoc(doc(getDb(), 'cav', reservatorioId));
}

// --- Registros operacionais ---
// Consulta apenas por reservatorioId (índice automático); o filtro de período
// é aplicado no cliente para não exigir índice composto no Firestore.

export async function listarRegistros(reservatorioId, { inicio = null, fim = null } = {}) {
  const snap = await getDocs(
    query(collection(getDb(), 'registros'), where('reservatorioId', '==', reservatorioId), limit(5000))
  );
  let registros = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (inicio) registros = registros.filter((r) => r.dataHora >= inicio);
  if (fim) registros = registros.filter((r) => r.dataHora <= fim);
  return registros.sort((a, b) => a.dataHora.localeCompare(b.dataHora));
}

export async function salvarRegistro(dados, id = null) {
  if (id) {
    await updateDoc(doc(getDb(), 'registros', id), dados);
    return id;
  }
  const ref = await addDoc(collection(getDb(), 'registros'), { ...dados, criadoEm: serverTimestamp() });
  return ref.id;
}

export async function salvarRegistrosEmLote(registros) {
  const database = getDb();
  const MAX = 450; // limite do Firestore é 500 operações por lote
  let gravados = 0;
  for (let i = 0; i < registros.length; i += MAX) {
    const lote = writeBatch(database);
    for (const registro of registros.slice(i, i + MAX)) {
      lote.set(doc(collection(database, 'registros')), { ...registro, criadoEm: serverTimestamp() });
    }
    await lote.commit();
    gravados += Math.min(MAX, registros.length - i);
  }
  return gravados;
}

export async function excluirRegistro(id) {
  await deleteDoc(doc(getDb(), 'registros', id));
}

// --- Simulações ---

export async function salvarSimulacao(dados) {
  const ref = await addDoc(collection(getDb(), 'simulacoes'), { ...dados, criadoEm: serverTimestamp() });
  return ref.id;
}

export async function listarSimulacoes(reservatorioId = null) {
  const col = collection(getDb(), 'simulacoes');
  const snap = await getDocs(
    reservatorioId ? query(col, where('reservatorioId', '==', reservatorioId), limit(200))
                   : query(col, orderBy('criadoEm', 'desc'), limit(200))
  );
  const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return reservatorioId ? lista.sort((a, b) => msDe(b.criadoEm) - msDe(a.criadoEm)) : lista;
}

export async function obterSimulacao(id) {
  const snap = await getDoc(doc(getDb(), 'simulacoes', id));
  if (!snap.exists()) throw new Error('Simulação não encontrada.');
  return { id: snap.id, ...snap.data() };
}

export async function excluirSimulacao(id) {
  await deleteDoc(doc(getDb(), 'simulacoes', id));
}

// --- Auditoria (alterações em limites e restrições) ---

export async function registrarAuditoria(entrada) {
  await addDoc(collection(getDb(), 'auditoria'), { ...entrada, criadoEm: serverTimestamp() });
}

export async function listarAuditoria(reservatorioId) {
  const snap = await getDocs(
    query(collection(getDb(), 'auditoria'), where('reservatorioId', '==', reservatorioId), limit(200))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => msDe(b.criadoEm) - msDe(a.criadoEm));
}

export function msDe(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  return new Date(timestamp).getTime() || 0;
}

export function dataDe(timestamp) {
  const ms = msDe(timestamp);
  return ms ? new Date(ms).toLocaleString('pt-BR') : '—';
}
