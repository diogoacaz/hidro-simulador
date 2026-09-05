// Exibição do resultado de uma simulação — compartilhada entre a tela de
// simulação e o detalhe do histórico.

import { graficoNivel, graficoVolume, graficoVazoes, amostrar } from '../charts.js';
import { baixarCsv, baixarCanvas } from '../planilha.js';
import { ROTULOS_MODO } from '../simulation.js';
import { $, esc, num, dataHoraLocal, badgeSeveridade } from '../ui.js';

const MAX_LINHAS_TABELA = 400;

export function html() {
  return `
    <section class="painel" id="painel-resultado">
      <div class="cabecalho-painel">
        <div>
          <h2>Resultado</h2>
          <p class="ajuda" id="resultado-contexto"></p>
        </div>
        <div class="acoes" style="margin:0">
          <button type="button" id="btn-exportar-serie">Exportar CSV</button>
          <button type="button" id="btn-exportar-grafico">Exportar gráfico</button>
        </div>
      </div>

      <div id="resultado-alertas"></div>
      <div id="resultado-incognita"></div>
      <div class="cartoes" id="resultado-cartoes"></div>

      <div class="graficos" style="margin-top:22px">
        <div class="grafico-caixa alta"><canvas id="grafico-nivel"></canvas></div>
        <div class="grafico-caixa"><canvas id="grafico-volume"></canvas></div>
        <div class="grafico-caixa"><canvas id="grafico-vazoes"></canvas></div>
      </div>

      <details style="margin-top:16px">
        <summary>Ver série de 15 em 15 min</summary>
        <div id="resultado-tabela"></div>
      </details>
    </section>`;
}

/**
 * Preenche o painel de resultado.
 * @param {HTMLElement} raiz elemento que contém o markup de html()
 */
export function preencher(raiz, { resultado, reservatorio, limites, restricoes, contexto }) {
  const { serie, incognita, resumo, alertas } = resultado;

  $('#resultado-contexto', raiz).textContent = contexto || '';

  $('#resultado-alertas', raiz).innerHTML = (alertas || [])
    .map((a) => `<div class="alerta alerta-aviso">${esc(a)}</div>`)
    .join('');

  $('#resultado-incognita', raiz).innerHTML = incognita
    ? `<div class="cartoes" style="margin-bottom:12px">
         <div class="cartao destaque">
           <span>${esc(ROTULOS_MODO[incognita.variavel])} (incógnita)</span>
           <strong>${esc(incognita.texto)}</strong>
         </div>
       </div>`
    : '';

  $('#resultado-cartoes', raiz).innerHTML = `
    <div class="cartao"><span>Nível inicial</span><strong>${num(resumo.cotaInicial)} m</strong></div>
    <div class="cartao"><span>Nível final</span><strong>${num(resumo.cotaFinal)} m</strong></div>
    <div class="cartao"><span>Variação de nível</span><strong>${sinal(resumo.variacaoCota)} m</strong></div>
    <div class="cartao"><span>Volume inicial</span><strong>${num(resumo.volumeInicial)} hm³</strong></div>
    <div class="cartao"><span>Volume final</span><strong>${num(resumo.volumeFinal)} hm³</strong></div>
    <div class="cartao"><span>Variação de volume</span><strong>${sinal(resumo.variacaoVolume)} hm³</strong></div>
    <div class="cartao"><span>Duração</span><strong>${esc(resumo.duracaoTexto)}</strong></div>
    <div class="cartao"><span>Q afluente média</span><strong>${num(resumo.qafMedia)} m³/s</strong></div>
    <div class="cartao"><span>Q defluente média</span><strong>${num(resumo.qdefMedia)} m³/s</strong></div>
    <div class="cartao"><span>Nível mín. / máx.</span><strong>${num(resumo.cotaMinima)} / ${num(resumo.cotaMaxima)} m</strong></div>
    <div class="cartao"><span>Passos em violação</span><strong>${resumo.passosComViolacao} de ${resumo.passos + 1}</strong></div>
    <div class="cartao"><span>Situação</span><strong>${badgeSeveridade(resumo.severidadeMaxima)}</strong></div>`;

  if (resumo.tiposViolacao && resumo.tiposViolacao.length) {
    $('#resultado-alertas', raiz).insertAdjacentHTML('beforeend',
      `<div class="alerta alerta-aviso"><strong>Limites violados:</strong> ${esc(resumo.tiposViolacao.join(', '))}.</div>`);
  }

  const restricoesVigentes = (restricoes || []).filter((r) => Number.isFinite(r.nivel));
  graficoNivel('grafico-nivel', serie, limites || {}, restricoesVigentes);
  graficoVolume('grafico-volume', serie);
  graficoVazoes('grafico-vazoes', serie);

  $('#resultado-tabela', raiz).innerHTML = tabelaSerie(serie);

  $('#btn-exportar-serie', raiz).onclick = () => {
    const nome = (reservatorio?.nome || 'simulacao').replace(/\W+/g, '-').toLowerCase();
    baixarCsv(`simulacao-${nome}.csv`,
      ['Passo', 'Data/hora', 'Q afluente (m³/s)', 'Q defluente (m³/s)', 'Volume (hm³)', 'Cota (m)', 'Área (km²)', 'Violações'],
      serie.map((s) => [
        s.passo, dataHoraLocal(s.dataHora),
        s.qaf.toFixed(3), s.qdef.toFixed(3),
        s.volume.toFixed(4), s.cota.toFixed(3), s.area.toFixed(4),
        s.violacoes.map((v) => v.tipo).join(' / '),
      ]));
  };

  $('#btn-exportar-grafico', raiz).onclick = () => {
    const nome = (reservatorio?.nome || 'simulacao').replace(/\W+/g, '-').toLowerCase();
    baixarCanvas($('#grafico-nivel', raiz), `nivel-${nome}.png`);
  };
}

function sinal(valor) {
  const texto = num(Math.abs(valor));
  if (Math.abs(valor) < 0.005) return `0,00`;
  return `${valor > 0 ? '+' : '−'}${texto}`;
}

function tabelaSerie(serie) {
  const linhas = serie.length > MAX_LINHAS_TABELA ? amostrar(serie, MAX_LINHAS_TABELA) : serie;
  const aviso = serie.length > MAX_LINHAS_TABELA
    ? `<p class="ajuda">Exibindo ${linhas.length} de ${serie.length} passos (amostrado). O CSV exportado contém a série completa.</p>`
    : '';
  return `
    ${aviso}
    <div class="tabela-scroll">
      <table>
        <thead>
          <tr>
            <th>Data/hora</th><th class="num">Q afl. (m³/s)</th><th class="num">Q def. (m³/s)</th>
            <th class="num">Volume (hm³)</th><th class="num">Cota (m)</th><th class="num">Área (km²)</th><th>Violações</th>
          </tr>
        </thead>
        <tbody>
          ${linhas.map((s) => `
            <tr class="${s.severidade ? `violacao-${s.severidade}` : ''}">
              <td>${dataHoraLocal(s.dataHora)}</td>
              <td class="num">${num(s.qaf)}</td>
              <td class="num">${num(s.qdef)}</td>
              <td class="num">${num(s.volume, 3)}</td>
              <td class="num">${num(s.cota)}</td>
              <td class="num">${num(s.area, 3)}</td>
              <td>${s.violacoes.length ? esc(s.violacoes.map((v) => v.tipo).join(' / ')) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
