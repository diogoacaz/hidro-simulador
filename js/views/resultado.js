// Exibição do resultado de uma simulação — compartilhada entre a tela de
// simulação e o detalhe do histórico.
//
// A leitura é hierárquica, não uma grade plana de doze cartões iguais:
//   1. a incógnita resolvida, em tamanho de manchete;
//   2. a situação — houve violação, de que tipo, e onde no tempo;
//   3. os números de apoio, agrupados por grandeza;
//   4. os gráficos;
//   5. a série completa, recolhida.

import { graficoNivel, graficoVolume, graficoVazoes, amostrar } from '../charts.js';
import { baixarCsv, baixarCanvas } from '../planilha.js';
import { ROTULOS_MODO } from '../simulation.js';
import { $, esc, num, dataHoraLocal, badgeSeveridade } from '../ui.js';

const MAX_LINHAS_TABELA = 400;

const NOMES_SEVERIDADE = {
  critico: 'Violação emergencial',
  restricao: 'Violação de restrição',
  atencao: 'Fora da faixa operacional',
};

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

      <div id="resultado-hero"></div>
      <div id="resultado-situacao"></div>
      <div id="resultado-alertas"></div>
      <div id="resultado-metricas"></div>

      <div class="graficos">
        <div class="grafico-caixa alta"><canvas id="grafico-nivel"></canvas></div>
        <div class="graficos-par">
          <div class="grafico-caixa"><canvas id="grafico-volume"></canvas></div>
          <div class="grafico-caixa"><canvas id="grafico-vazoes"></canvas></div>
        </div>
      </div>

      <details class="serie-completa">
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
  $('#resultado-hero', raiz).innerHTML = hero(incognita, resumo);
  $('#resultado-situacao', raiz).innerHTML = situacao(serie, resumo);
  $('#resultado-metricas', raiz).innerHTML = metricas(resumo);

  $('#resultado-alertas', raiz).innerHTML = (alertas || [])
    .map((a) => `<div class="alerta alerta-aviso">${esc(a)}</div>`)
    .join('');

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

/* ------------------------------------------------------------------ *
 * Blocos
 * ------------------------------------------------------------------ */

// A manchete: a incógnita que a simulação resolveu. Sem incógnita (modo de
// previsão direta), o nível final é o que o operador foi buscar.
function hero(incognita, resumo) {
  const [rotulo, valor, apoio] = incognita
    ? [
      `${ROTULOS_MODO[incognita.variavel]} — incógnita`,
      incognita.texto,
      `${num(resumo.cotaInicial)} m no início · ${esc(resumo.duracaoTexto)} simuladas`,
    ]
    : [
      'Nível final',
      `${num(resumo.cotaFinal)} m`,
      `${sinal(resumo.variacaoCota)} m em ${esc(resumo.duracaoTexto)}`,
    ];

  const [inteiro, decimal] = String(valor).split(/([,.]\d+.*)$/);
  return `
    <div class="hero">
      <p class="hero-rotulo">${esc(rotulo)}</p>
      <p class="hero-valor">${esc(inteiro)}<span>${esc(decimal || '')}</span></p>
      <p class="hero-apoio">${apoio}</p>
    </div>`;
}

// Situação: o veredito, mais onde no tempo as violações caem.
function situacao(serie, resumo) {
  const tipos = resumo.tiposViolacao && resumo.tiposViolacao.length
    ? `<p class="situacao-tipos">Limites violados: <strong>${esc(resumo.tiposViolacao.join(', '))}</strong>.</p>`
    : '';

  const total = resumo.passos + 1;
  const proporcao = total ? Math.round((resumo.passosComViolacao / total) * 100) : 0;
  const contagem = resumo.passosComViolacao
    ? `<span class="situacao-contagem">${resumo.passosComViolacao} de ${total} passos (${proporcao}%)</span>`
    : `<span class="situacao-contagem">${total} passos dentro dos limites</span>`;

  return `
    <div class="situacao ${resumo.severidadeMaxima ? `situacao-${resumo.severidadeMaxima}` : 'situacao-ok'}">
      <div class="situacao-topo">
        ${badgeSeveridade(resumo.severidadeMaxima)}
        ${contagem}
      </div>
      ${tipos}
      ${faixaTempo(serie)}
    </div>`;
}

// Barra proporcional ao tempo, marcando onde cada severidade ocorre. Trechos
// contíguos viram um segmento só, então a barra não depende do número de passos.
function faixaTempo(serie) {
  if (!serie || serie.length < 2) return '';
  const trechos = [];
  for (const passo of serie) {
    const sev = passo.severidade || null;
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo.sev === sev) ultimo.n += 1;
    else trechos.push({ sev, n: 1 });
  }
  if (trechos.length === 1 && !trechos[0].sev) {
    return `<div class="faixa-tempo" role="img" aria-label="Nenhuma violação ao longo do período">
              <span class="faixa-trecho faixa-ok" style="flex:1"></span>
            </div>`;
  }
  const descricao = trechos
    .filter((t) => t.sev)
    .map((t) => NOMES_SEVERIDADE[t.sev] || t.sev)
    .join('; ');
  const segmentos = trechos.map((t) => {
    const classe = t.sev ? `faixa-${t.sev}` : 'faixa-ok';
    const titulo = t.sev ? ` title="${esc(NOMES_SEVERIDADE[t.sev] || t.sev)}"` : '';
    return `<span class="faixa-trecho ${classe}" style="flex:${t.n}"${titulo}></span>`;
  }).join('');
  return `
    <div class="faixa-tempo" role="img" aria-label="Linha do tempo das violações: ${esc(descricao)}">
      ${segmentos}
    </div>
    <p class="faixa-legenda"><span>início</span><span>fim do período</span></p>`;
}

// Números de apoio, agrupados por grandeza. Início e fim aparecem como uma
// transição, não como dois cartões soltos que o leitor precisa subtrair.
function metricas(r) {
  return `
    <div class="metricas">
      ${grupo('Nível', [
    transicao(`${num(r.cotaInicial)} m`, `${num(r.cotaFinal)} m`, r.variacaoCota, 'm'),
    item('Mínimo no período', `${num(r.cotaMinima)} m`),
    item('Máximo no período', `${num(r.cotaMaxima)} m`),
  ])}
      ${grupo('Volume', [
    transicao(`${num(r.volumeInicial)} hm³`, `${num(r.volumeFinal)} hm³`, r.variacaoVolume, 'hm³'),
    item('Duração', esc(r.duracaoTexto)),
  ])}
      ${grupo('Vazões médias', r.passosContidos
    ? [
      item('Afluente', `${num(r.qafMedia)} m³/s`),
      item('Defluente informada', `${num(r.qdefInformadaMedia)} m³/s`),
      item('Defluente necessária', `${num(r.qdefMedia)} m³/s`),
    ]
    : [
      item('Afluente', `${num(r.qafMedia)} m³/s`),
      item('Defluente', `${num(r.qdefMedia)} m³/s`),
      item('Balanço', `${sinal(r.qafMedia - r.qdefMedia)} m³/s`),
    ])}
      ${r.passosContidos ? grupo('Contenção na emergência', [
    item('Passos contidos', `${r.passosContidos} de ${r.passos + 1}`),
    r.acrescimoMaxQdef > 0.005
      ? item('Defluir a mais, no pico', `+${num(r.acrescimoMaxQdef)} m³/s`)
      : '',
    r.reducaoMaxQdef > 0.005
      ? item('Defluir a menos, no pico', `−${num(r.reducaoMaxQdef)} m³/s`)
      : '',
  ].filter(Boolean)) : ''}
    </div>`;
}

function grupo(titulo, itens) {
  return `
    <div class="metrica-grupo">
      <h3>${esc(titulo)}</h3>
      ${itens.join('')}
    </div>`;
}

function item(rotulo, valor) {
  return `<div class="metrica"><span>${esc(rotulo)}</span><strong>${valor}</strong></div>`;
}

function transicao(de, para, delta, unidade) {
  const positivo = delta > 0.005;
  const negativo = delta < -0.005;
  const classe = positivo ? 'delta-sobe' : negativo ? 'delta-desce' : 'delta-igual';
  return `
    <div class="metrica metrica-transicao">
      <span>Início → fim</span>
      <strong>
        <span class="transicao-de">${de}</span>
        <span class="transicao-seta" aria-hidden="true">→</span>
        <span class="transicao-para">${para}</span>
      </strong>
      <em class="delta ${classe}">${sinal(delta)} ${esc(unidade)}</em>
    </div>`;
}

function sinal(valor) {
  if (!Number.isFinite(valor)) return '—';
  const texto = num(Math.abs(valor));
  if (Math.abs(valor) < 0.005) return '0,00';
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
