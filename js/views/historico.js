// Histórico de simulações salvas, com reprocessamento para rastreabilidade.

import * as db from '../db.js';
import { simular, ROTULOS_MODO } from '../simulation.js';
import { $, esc, num, toast, confirmar, comBotao, badgeSeveridade, dataHoraLocal } from '../ui.js';
import * as resultadoView from './resultado.js';

export async function render(container, id) {
  if (id) return renderDetalhe(container, id);
  return renderLista(container);
}

async function renderLista(container) {
  const simulacoes = await db.listarSimulacoes();

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Histórico de simulações</h2>
          <p class="ajuda">Cada simulação guarda seus parâmetros de entrada e o resultado obtido.</p>
        </div>
      </div>
      ${simulacoes.length ? tabela(simulacoes) : '<div class="vazio">Nenhuma simulação salva ainda.</div>'}
    </section>`;

  $('.painel', container).addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-excluir]');
    if (!botao) return;
    if (!confirmar('Excluir esta simulação do histórico?')) return;
    await comBotao(botao, async () => {
      await db.excluirSimulacao(botao.dataset.excluir);
      toast('Simulação excluída.', 'ok');
      await renderLista(container);
    }, '…');
  });
}

function tabela(simulacoes) {
  return `
    <div class="tabela-scroll">
      <table>
        <thead>
          <tr>
            <th>Executada em</th><th>Reservatório</th><th>Modo</th><th>Resultado</th>
            <th class="num">Duração</th><th>Situação</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${simulacoes.map((s) => `
            <tr>
              <td>${db.dataDe(s.criadoEm)}</td>
              <td><strong>${esc(s.reservatorioNome)}</strong>${s.usinaNome ? `<br /><small style="color:var(--suave)">${esc(s.usinaNome)}</small>` : ''}</td>
              <td>${esc(ROTULOS_MODO[s.modo] || s.modo)}</td>
              <td>${s.incognita ? esc(s.incognita.texto) : '—'}</td>
              <td class="num">${esc(s.resumo?.duracaoTexto || '—')}</td>
              <td>${badgeSeveridade(s.resumo?.severidadeMaxima)}</td>
              <td>
                <a href="#/historico/${s.id}"><button type="button" class="discreto">Abrir</button></a>
                <button type="button" class="discreto" data-excluir="${s.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderDetalhe(container, id) {
  const simulacao = await db.obterSimulacao(id);
  const cav = await db.obterCav(simulacao.reservatorioId);

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>${esc(simulacao.reservatorioNome)}</h2>
          <p class="ajuda">
            ${esc(ROTULOS_MODO[simulacao.modo] || simulacao.modo)} · executada em ${db.dataDe(simulacao.criadoEm)}
          </p>
        </div>
        <a href="#/historico"><button type="button">Voltar ao histórico</button></a>
      </div>
      ${entradasHtml(simulacao)}
    </section>
    <div id="area-resultado">${cav ? resultadoView.html() : ''}</div>`;

  if (!cav) {
    $('#area-resultado', container).innerHTML = `
      <section class="painel">
        <div class="alerta alerta-aviso">
          A tabela CAV deste reservatório não está mais disponível, então o resultado não pôde ser reprocessado.
          Os valores registrados na execução original estão acima.
        </div>
      </section>`;
    return;
  }

  const entradas = simulacao.entradas || {};
  const cfg = {
    cav,
    modo: simulacao.modo,
    dataInicial: new Date(entradas.dataInicial),
    passos: entradas.passos ?? undefined,
    nivelInicial: entradas.nivelInicial ?? undefined,
    nivelFinal: entradas.nivelFinal ?? undefined,
    qaf: entradas.qaf,
    qdef: entradas.qdef,
    limites: simulacao.limites || {},
    restricoes: simulacao.restricoes || [],
  };

  let resultado;
  try {
    resultado = simular(cfg);
  } catch (err) {
    $('#area-resultado', container).innerHTML =
      `<section class="painel"><p class="erro">Não foi possível reprocessar: ${esc(err.message)}</p></section>`;
    return;
  }

  const area = $('#area-resultado', container);
  resultadoView.preencher(area, {
    resultado,
    reservatorio: { nome: simulacao.reservatorioNome },
    limites: cfg.limites,
    restricoes: cfg.restricoes,
    contexto: `Reprocessada a partir dos parâmetros salvos · início ${new Date(entradas.dataInicial).toLocaleString('pt-BR')}`,
  });

  // Rastreabilidade: sinaliza divergência entre o resultado salvo e o reprocessado.
  const salvo = simulacao.resumo || {};
  const divergencias = [];
  const comparar = (rotulo, a, b, casas = 2) => {
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 10 ** -casas) {
      divergencias.push(`${rotulo}: salvo ${num(a, casas)} × reprocessado ${num(b, casas)}`);
    }
  };
  comparar('Nível final', salvo.cotaFinal, resultado.resumo.cotaFinal);
  comparar('Volume final', salvo.volumeFinal, resultado.resumo.volumeFinal, 3);

  if (divergencias.length) {
    $('#resultado-alertas', area).insertAdjacentHTML('afterbegin',
      `<div class="alerta alerta-aviso"><strong>Divergência em relação à execução original</strong> — a tabela CAV ou os
       limites do reservatório podem ter mudado desde então. ${esc(divergencias.join(' · '))}</div>`);
  }
}

function entradasHtml(simulacao) {
  const e = simulacao.entradas || {};
  const vazao = (spec) => {
    if (!spec) return '—';
    return spec.tipo === 'serie'
      ? `hidrograma com ${spec.serie?.length || 0} valores`
      : `${num(spec.valor)} m³/s (constante)`;
  };
  return `
    <div class="cartoes">
      <div class="cartao"><span>Início</span><strong>${dataHoraLocal(e.dataInicial)}</strong></div>
      <div class="cartao"><span>Nível inicial</span><strong>${e.nivelInicial == null ? 'incógnita' : `${num(e.nivelInicial)} m`}</strong></div>
      <div class="cartao"><span>Nível final</span><strong>${e.nivelFinal == null ? 'incógnita' : `${num(e.nivelFinal)} m`}</strong></div>
      <div class="cartao"><span>Duração</span><strong>${e.passos == null ? 'incógnita' : esc(simulacao.resumo?.duracaoTexto || `${e.passos} passos`)}</strong></div>
      <div class="cartao"><span>Q afluente</span><strong style="font-size:0.92rem">${esc(vazao(e.qaf))}</strong></div>
      <div class="cartao"><span>Q defluente</span><strong style="font-size:0.92rem">${esc(vazao(e.qdef))}</strong></div>
    </div>`;
}
