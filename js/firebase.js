// Camada de acesso ao Firestore: salvar/carregar reservatórios e simulações.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

let db = null;
let initError = null;

function getDb() {
  if (db || initError) return db;
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (err) {
    initError = err;
    console.error('Falha ao inicializar Firebase:', err);
  }
  return db;
}

function isConfigured() {
  return firebaseConfig.apiKey && firebaseConfig.apiKey !== 'COLE_AQUI_SUA_API_KEY';
}

async function salvarReservatorio(params) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado.');
  const ref = await addDoc(collection(database, 'reservatorios'), {
    ...params,
    criadoEm: serverTimestamp(),
  });
  return ref.id;
}

async function listarReservatorios() {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado.');
  const q = query(collection(database, 'reservatorios'), orderBy('criadoEm', 'desc'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function carregarReservatorio(id) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado.');
  const snap = await getDoc(doc(database, 'reservatorios', id));
  if (!snap.exists()) throw new Error('Reservatório não encontrado.');
  return { id: snap.id, ...snap.data() };
}

async function salvarSimulacao({ reservatorioId, reservatorioNome, params, inflowSeries, resumo }) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado.');
  const ref = await addDoc(collection(database, 'simulacoes'), {
    reservatorioId: reservatorioId || null,
    reservatorioNome,
    params,
    inflowSeries,
    resumo,
    criadoEm: serverTimestamp(),
  });
  return ref.id;
}

async function listarSimulacoes() {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado.');
  const q = query(collection(database, 'simulacoes'), orderBy('criadoEm', 'desc'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function carregarSimulacao(id) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado.');
  const snap = await getDoc(doc(database, 'simulacoes', id));
  if (!snap.exists()) throw new Error('Simulação não encontrada.');
  return { id: snap.id, ...snap.data() };
}

export {
  isConfigured,
  salvarReservatorio,
  listarReservatorios,
  carregarReservatorio,
  salvarSimulacao,
  listarSimulacoes,
  carregarSimulacao,
};
