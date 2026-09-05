// Bootstrap e roteador por hash.

import * as db from './db.js';
import { $, $$, erroNaTela, carregando } from './ui.js';
import * as viewSimular from './views/simular.js';
import * as viewUsinas from './views/usinas.js';
import * as viewReservatorios from './views/reservatorios.js';
import * as viewRegistros from './views/registros.js';
import * as viewHistorico from './views/historico.js';
import { destruirTodos } from './charts.js';

const ROTAS = {
  simular: viewSimular,
  usinas: viewUsinas,
  reservatorios: viewReservatorios,
  registros: viewRegistros,
  historico: viewHistorico,
};

const ROTA_PADRAO = 'simular';

function rotaAtual() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [nome, param] = hash.split('/');
  return { nome: ROTAS[nome] ? nome : ROTA_PADRAO, param: param || null };
}

async function navegar() {
  const { nome, param } = rotaAtual();
  const container = $('#conteudo');

  destruirTodos();
  $$('#navegacao a').forEach((a) => a.classList.toggle('ativa', a.dataset.rota === nome));
  carregando(container);

  try {
    await ROTAS[nome].render(container, param);
  } catch (err) {
    console.error(err);
    erroNaTela(container, err);
  }
}

function avisoSemFirebase() {
  $('#conteudo').innerHTML = `
    <div class="painel">
      <h2>Firebase não configurado</h2>
      <p>Preencha <code>js/firebase-config.js</code> com as credenciais do seu projeto Firebase
      para habilitar o cadastro e a consulta de dados. Veja o README do repositório.</p>
    </div>`;
}

window.addEventListener('hashchange', navegar);

if (!db.isConfigured()) {
  avisoSemFirebase();
} else {
  if (!location.hash) location.hash = `#/${ROTA_PADRAO}`;
  navegar();
}
