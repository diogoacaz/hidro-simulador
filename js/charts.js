// Gráficos dos resultados de simulação (Chart.js).
//
// Três decisões estruturam este módulo:
//
// 1. Limites não são séries. Antes cada limite entrava como dataset, o que
//    enchia a legenda de sete entradas tracejadas parecidas e fazia o tooltip
//    repetir o mesmo valor em todo passo. Agora são desenhados por plugin,
//    fora do fluxo de dados, com rótulo na borda direita.
// 2. A faixa operacional é o que o operador lê primeiro, então ela é uma
//    região sombreada — não duas linhas que ele precisa mentalmente ligar.
// 3. Nenhum gráfico tem eixo duplo. Volume e área da CAV viraram dois
//    gráficos de série única: dois eixos y num só plot inventam correlação.

import { dataHoraLocal } from './ui.js';
import { temaEscuroAtivo, aoMudarTema } from './tema.js';

const MAX_PONTOS_GRAFICO = 1200;
const graficos = new Map();

// As cores são lidas do CSS na criação do gráfico, então uma troca de tema do
// sistema deixaria a paleta antiga congelada. Guardamos como refazer cada
// gráfico para redesenhá-los quando o tema mudar.
const refazer = new Map();

// Vale tanto a troca do sistema quanto o botão de tema.
aoMudarTema(() => {
  for (const redesenhar of [...refazer.values()]) redesenhar();
});

const FONTE = { family: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' };

// O canvas mede o texto com a fonte que estiver carregada na hora do
// desenho. Se a Inter chega depois, os rótulos ficam medidos em outra fonte
// e desalinham; um redesenho quando ela termina de carregar resolve.
function quandoAFonteChegar(grafico) {
  if (!document.fonts || document.fonts.status === 'loaded') return;
  document.fonts.ready.then(() => {
    if (grafico.canvas && grafico.canvas.isConnected) grafico.update('none');
  });
}

// Lê uma variável de tema do CSS, para os gráficos acompanharem claro/escuro.
function varCss(nome, alternativa) {
  const valor = getComputedStyle(document.body).getPropertyValue(nome).trim();
  return valor || alternativa;
}

/*
 * Paleta das séries, conferida com o validador de paletas:
 *
 * - Nível, volume e área são série única no seu gráfico, então só precisam de
 *   contraste contra a superfície; o título nomeia a série e não há legenda.
 * - Afluente e defluente dividem um plot, então são o único par categórico de
 *   verdade. Azul × âmbar passa em separação para daltonismo (ΔE 23 protan) e
 *   para visão normal (ΔE 26), nos dois temas.
 * - No tema escuro o nível usa o lime da marca, que é como o template escreve
 *   sobre o verde-petróleo.
 */
function cores() {
  const escuro = temaEscuroAtivo();
  return {
    // Paleta categórica validada nos dois temas (ΔE normal e por daltonismo,
    // contraste >= 3:1 contra a superfície de cada um). A ordem é a dos painéis.
    nivel: escuro ? '#199e70' : '#15a06f',
    qaf: escuro ? '#3987e5' : '#2a78d6',
    qdef: escuro ? '#d95926' : '#eb6834',
    volume: escuro ? '#9085e9' : '#6250d6',
    area: escuro ? '#2bb3cc' : '#0e7490',
    reversao: escuro ? '#1f9aa8' : '#0e8f9e',

    operacional: varCss('--texto-suave', escuro ? '#8aa39c' : '#5a6e67'),
    emergencial: varCss('--critico', escuro ? '#f87171' : '#dc2626'),
    restricao: varCss('--restricao', escuro ? '#c084fc' : '#9333ea'),

    texto: varCss('--texto', escuro ? '#ffffff' : '#14332d'),
    medio: varCss('--texto-medio', escuro ? '#b9ccc6' : '#4a635b'),
    suave: varCss('--texto-suave', escuro ? '#8aa39c' : '#5a6e67'),
    grade: varCss('--linha', escuro ? '#245046' : '#dfe5dd'),
    superficie: varCss('--superficie', escuro ? '#14332d' : '#ffffff'),
    violacao: {
      critico: varCss('--critico', escuro ? '#f87171' : '#dc2626'),
      restricao: varCss('--restricao', escuro ? '#c084fc' : '#9333ea'),
      atencao: varCss('--atencao', escuro ? '#fbbf24' : '#b45309'),
    },
  };
}

// Canvas não entende color-mix nem currentColor: as cores de preenchimento
// precisam ser rgba() de verdade.
function rgba(hex, alfa) {
  const h = String(hex).trim().replace('#', '');
  if (h.length < 6) return hex;
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

// O eixo do tempo ganha o rótulo mais curto que ainda identifica o ponto: a
// data inteira em toda marca colide em gráfico estreito, e o tooltip já traz
// data e hora completas.
function rotuladorTempo(pontos) {
  if (!pontos.length) return (iso) => dataHoraLocal(iso);
  const horas = (new Date(pontos[pontos.length - 1].dataHora) - new Date(pontos[0].dataHora)) / 3600000;
  if (horas <= 36) {
    return (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (horas <= 24 * 20) {
    return (iso) => new Date(iso).toLocaleString('pt-BR',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  }
  return (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Passos de marcação, em horas. O eixo escolhe o menor que cabe na
// largura, e as marcas caem nas horas redondas do relógio (00, 06, 12, 18
// para 6 h), não em 13:47, 22:17… como saía ao pular pontos a esmo.
const PASSOS_DE_MARCA = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48, 72, 168, 336, 720];
const HORA_MS = 3600000;

const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtDiaSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });

// Instante "de parede": o relógio local transformado em ms, para as
// divisões por hora e dia caírem na hora local, não em UTC.
function msLocal(ms) {
  return ms - new Date(ms).getTimezoneOffset() * 60000;
}

function eixoDeTempo(pontos) {
  const tempos = pontos.map((p) => (p && p.dataHora != null ? new Date(p.dataHora).getTime() : NaN));
  if (tempos.length < 2 || !tempos.every(Number.isFinite)) return null;

  const meiaNoite = (i) => Number.isFinite(tempos[i]) && msLocal(tempos[i]) % (24 * HORA_MS) === 0;

  return {
    tempos,
    meiaNoite,
    afterBuildTicks(eixo) {
      const util = Math.max(120, eixo.width || eixo.chart.width - 70);
      const cabem = Math.max(2, Math.min(12, Math.floor(util / 78)));
      const horas = (tempos[tempos.length - 1] - tempos[0]) / HORA_MS;
      const passo = PASSOS_DE_MARCA.find((h) => horas / h <= cabem) || PASSOS_DE_MARCA[PASSOS_DE_MARCA.length - 1];
      const largura = passo * HORA_MS;
      const marcas = [];
      for (let i = 0; i < tempos.length; i++) {
        const balde = Math.floor(msLocal(tempos[i]) / largura);
        const anterior = i > 0 ? Math.floor(msLocal(tempos[i - 1]) / largura) : null;
        const emCheio = msLocal(tempos[i]) % largura === 0;
        if ((i === 0 && emCheio) || (i > 0 && balde !== anterior)) marcas.push({ value: i });
      }
      eixo.passoHoras = passo;
      if (marcas.length >= 2) eixo.ticks = marcas;
    },
    rotulo(valor, indice, marcas) {
      const passo = this.passoHoras || 1;
      const ms = tempos[valor];
      if (!Number.isFinite(ms)) return '';
      const d = new Date(ms);
      if (passo >= 24) {
        return passo >= 168 ? fmtDia.format(d) : [fmtDia.format(d), fmtDiaSemana.format(d).replace('.', '')];
      }
      // A data só aparece na primeira marca e quando o dia vira: repetir
      // "24/11" em toda marca é ruído.
      const anterior = indice > 0 ? new Date(tempos[marcas[indice - 1].value]) : null;
      const virou = !anterior || anterior.toDateString() !== d.toDateString();
      return virou ? [fmtHora.format(d), fmtDia.format(d)] : fmtHora.format(d);
    },
  };
}

// Aplica o rotulador escolhido a cada ponto da série.
function rotularPontos(pontos) {
  const rotular = rotuladorTempo(pontos);
  return pontos.map((p) => rotular(p.dataHora));
}

// Reduz a série para no máximo MAX_PONTOS_GRAFICO pontos, preservando o último.
export function amostrar(serie, max = MAX_PONTOS_GRAFICO) {
  if (serie.length <= max) return serie;
  const salto = Math.ceil(serie.length / max);
  const saida = serie.filter((_, i) => i % salto === 0);
  if (saida[saida.length - 1] !== serie[serie.length - 1]) saida.push(serie[serie.length - 1]);
  return saida;
}

function destruir(canvasId) {
  if (graficos.has(canvasId)) {
    graficos.get(canvasId).destroy();
    graficos.delete(canvasId);
  }
}

export function destruirTodos() {
  [...graficos.keys()].forEach(destruir);
  refazer.clear();
}

/* ------------------------------------------------------------------ *
 * Plugins de desenho
 * ------------------------------------------------------------------ */

// Faixas horizontais sombreadas: a região segura e as zonas de emergência.
const pluginFaixas = {
  id: 'faixas',
  beforeDatasetsDraw(chart, _args, opts) {
    const faixas = opts && opts.lista;
    if (!faixas || !faixas.length) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    ctx.save();
    for (const f of faixas) {
      const y = scales[f.eixo || 'y'];
      if (!y) continue;
      const limiteTopo = Math.max(chartArea.top, y.top + (f.reservaTopo || 0));
      const limiteBase = Math.min(chartArea.bottom, y.bottom);
      const de = Number.isFinite(f.de) ? y.getPixelForValue(f.de) : limiteBase;
      const ate = Number.isFinite(f.ate) ? y.getPixelForValue(f.ate) : limiteTopo;
      const topo = Math.max(limiteTopo, Math.min(de, ate));
      const base = Math.min(limiteBase, Math.max(de, ate));
      if (base <= topo) continue;
      ctx.fillStyle = f.cor;
      ctx.fillRect(chartArea.left, topo, chartArea.right - chartArea.left, base - topo);
    }
    ctx.restore();
  },
};

// Linhas de limite com rótulo na borda direita, fora da legenda e do tooltip.
const pluginLimites = {
  id: 'limites',
  afterDatasetsDraw(chart, _args, opts) {
    const linhas = opts && opts.lista;
    if (!linhas || !linhas.length) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    ctx.save();
    ctx.font = `500 10px ${FONTE.family}`;
    ctx.textBaseline = 'middle';

    // Limites fora da escala ganham um aviso na borda. Sem isto o gráfico não
    // explica uma violação que o painel de situação acusa — é o caso de uma
    // restrição distante da faixa em que o nível de fato andou.
    const foraDaEscala = { acima: 0, abaixo: 0 };

    for (const l of linhas) {
      if (!Number.isFinite(l.valor)) continue;
      const y = scales[l.eixo || 'y'];
      if (!y) continue;
      // Com painéis empilhados cada escala ocupa só a sua faixa do gráfico.
      const topoEixo = Math.max(chartArea.top, y.top);
      const baseEixo = Math.min(chartArea.bottom, y.bottom);
      const py = y.getPixelForValue(l.valor);

      const lado = py < topoEixo - 1 ? 'acima' : py > baseEixo + 1 ? 'abaixo' : null;
      if (lado) {
        const seta = lado === 'acima' ? '↑' : '↓';
        const valor = l.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const aviso = `${seta} ${l.rotulo} ${valor}`;
        const largura = ctx.measureText(aviso).width;
        const deslocamento = foraDaEscala[lado] * 15;
        const ly = lado === 'acima'
          ? topoEixo + 9 + deslocamento
          : baseEixo - 9 - deslocamento;
        foraDaEscala[lado] += 1;
        ctx.fillStyle = opts.superficie;
        ctx.globalAlpha = 0.88;
        ctx.fillRect(chartArea.right - largura - 6, ly - 8, largura + 8, 16);
        ctx.globalAlpha = 1;
        ctx.fillStyle = l.cor;
        ctx.fillText(aviso, chartArea.right - largura - 2, ly);
        continue;
      }

      // A linha para antes do rótulo, em vez de passar por baixo dele.
      const texto = l.rotulo;
      const larg = ctx.measureText(texto).width;
      const x = chartArea.right - larg;

      ctx.beginPath();
      ctx.setLineDash(l.tracejado || [5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = l.cor;
      ctx.moveTo(chartArea.left, py);
      ctx.lineTo(x - 7, py);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = opts.superficie;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - 3, py - 7, larg + 6, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = l.cor;
      ctx.fillText(texto, x, py);
    }
    ctx.restore();
  },
};

// Painéis empilhados, no arranjo que a HYDROGRID usa e que funciona bem:
// a unidade discreta no canto esquerdo, o título centralizado na cor da
// marca, a legenda centralizada logo abaixo dele, e o traçado começando
// embaixo de tudo isso — sem moldura, sem grade pesada, sem legenda geral
// que obrigue a decorar cinco cores de uma vez.
// Altura reservada no alto de cada painel. O título não encosta na divisa:
// entre ela e ele fica um vão, senão o título do painel de baixo se lê como
// rótulo do eixo do painel de cima.
const VAO_ANTES_DO_TITULO = 10;
const ALTURA_CABECALHO = 42;

const pluginPaineis = {
  id: 'paineis',
  beforeDatasetsDraw(chart, _args, opts) {
    const lista = opts && opts.lista;
    if (!lista || !lista.length) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    ctx.save();
    // A virada do dia, um fio pontilhado em cada painel. Desenhado aqui, e
    // não como grade do eixo x, para não atravessar os vãos entre painéis.
    const dias = opts.meiaNoite && scales.x
      ? scales.x.ticks.filter((t) => opts.meiaNoite(t.value)).map((t) => scales.x.getPixelForValue(t.value))
      : [];
    for (const painel of lista) {
      const y = scales[painel.eixo];
      if (!y) continue;
      if (painel.fundo) {
        ctx.fillStyle = painel.fundo;
        ctx.fillRect(chartArea.left, y.top, chartArea.right - chartArea.left, y.bottom - y.top);
      }
      if (dias.length) {
        ctx.strokeStyle = opts.divisor;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        for (const x of dias) {
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, y.top + ALTURA_CABECALHO);
          ctx.lineTo(Math.round(x) + 0.5, y.bottom);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opts) {
    const lista = opts && opts.lista;
    if (!lista || !lista.length) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    const meio = (chartArea.left + chartArea.right) / 2;
    ctx.save();
    ctx.textBaseline = 'middle';

    for (const painel of lista) {
      const y = scales[painel.eixo];
      if (!y) continue;

      const visiveis = painel.series.filter(
        (serie) => serie.indice == null || !chart.getDatasetMeta(serie.indice).hidden,
      );
      const comLegenda = visiveis.length > 1;
      const yTitulo = y.top + VAO_ANTES_DO_TITULO + (comLegenda ? 0 : 7);

      // Unidade à esquerda, fora do caminho do título.
      ctx.textAlign = 'left';
      ctx.font = `500 10px ${FONTE.family}`;
      ctx.fillStyle = opts.suave;
      ctx.fillText(painel.unidade, chartArea.left, yTitulo);

      ctx.textAlign = 'center';
      ctx.font = `600 12px ${FONTE.family}`;
      ctx.fillStyle = opts.titulo;
      ctx.fillText(painel.nome, meio, yTitulo);

      if (!comLegenda) continue;

      // A legenda é medida antes de ser desenhada, para ficar centrada como
      // um bloco só em vez de escorrer para a direita.
      ctx.font = `500 10px ${FONTE.family}`;
      const ESPACO = 18;
      const itens = visiveis.map((serie) => ({
        serie,
        largura: 14 + 5 + ctx.measureText(serie.nome).width,
      }));
      const total = itens.reduce((acc, i) => acc + i.largura, 0) + ESPACO * (itens.length - 1);
      let x = meio - total / 2;
      const yLegenda = yTitulo + 16;

      ctx.textAlign = 'left';
      for (const { serie, largura } of itens) {
        if (serie.faixa) {
          // A faixa de confiança é área, não traço: a amostra é um retângulo.
          ctx.fillStyle = serie.cor;
          ctx.fillRect(x, yLegenda - 4, 14, 8);
        } else {
          ctx.strokeStyle = serie.cor;
          ctx.lineWidth = 2;
          ctx.setLineDash(serie.tracejado || []);
          ctx.beginPath();
          ctx.moveTo(x, yLegenda);
          ctx.lineTo(x + 14, yLegenda);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = opts.medio;
        ctx.fillText(serie.nome, x + 19, yLegenda);
        x += largura + ESPACO;
      }
    }
    ctx.restore();
  },
};

// Linha vertical de leitura, acompanhando o ponto sob o cursor.
const pluginCruz = {
  id: 'cruz',
  afterDatasetsDraw(chart, _args, opts) {
    const ativos = chart.tooltip && chart.tooltip.getActiveElements
      ? chart.tooltip.getActiveElements()
      : [];
    if (!ativos.length) return;
    const { ctx, chartArea } = chart;
    const x = ativos[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = opts.cor;
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // A hora sob o cursor, numa pílula sobre o eixo: lê-se o instante sem
    // tirar o olho da linha.
    const texto = opts.rotulo ? opts.rotulo(ativos[0].index) : '';
    if (texto) {
      ctx.font = `600 10.5px ${FONTE.family}`;
      const larg = ctx.measureText(texto).width + 14;
      const alt = 18;
      const px = Math.min(Math.max(x - larg / 2, chartArea.left), chartArea.right - larg);
      const py = chartArea.bottom + 3;
      ctx.fillStyle = opts.fundo;
      ctx.beginPath();
      ctx.roundRect(px, py, larg, alt, 9);
      ctx.fill();
      ctx.fillStyle = opts.tinta;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(texto, px + larg / 2, py + alt / 2 + 0.5);
    }
    ctx.restore();
  },
};

// Os picos rotulados no próprio traço: o máximo do nível, da afluência e do
// vertimento são as três leituras que a operação procura primeiro. Num
// patamar o rótulo vai ao meio dele, não à primeira amostra.
const pluginPicos = {
  id: 'picos',
  afterDatasetsDraw(chart, _args, opts) {
    const lista = opts && opts.lista;
    if (!lista || !lista.length) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.font = `650 10.5px ${FONTE.family}`;
    ctx.textBaseline = 'middle';
    const ocupados = [];

    for (const pico of lista) {
      const meta = chart.getDatasetMeta(pico.indice);
      const dados = chart.data.datasets[pico.indice] && chart.data.datasets[pico.indice].data;
      if (!meta || meta.hidden || !dados || !dados.length) continue;
      let max = -Infinity;
      for (const v of dados) if (Number.isFinite(v) && v > max) max = v;
      if (!Number.isFinite(max) || (pico.minimo != null && max <= pico.minimo)) continue;
      const tol = Math.max(1e-9, Math.abs(max) * 1e-6);
      const inicio = dados.findIndex((v) => Number.isFinite(v) && v >= max - tol);
      let fim = inicio;
      while (fim + 1 < dados.length && dados[fim + 1] >= max - tol) fim += 1;
      const i = Math.round((inicio + fim) / 2);
      const ponto = meta.data[i];
      if (!ponto) continue;
      const escala = scales[chart.data.datasets[pico.indice].yAxisID || 'y'];
      const topo = Math.max(chartArea.top, escala.top + (pico.reservaTopo || 0));

      // Marca no ponto: anel na cor da série sobre a superfície.
      ctx.beginPath();
      ctx.arc(ponto.x, ponto.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = pico.cor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = opts.superficie;
      ctx.stroke();

      const texto = pico.texto(max);
      const larg = ctx.measureText(texto).width + 14;
      const alt = 20;
      let px = ponto.x - larg / 2;
      let py = ponto.y - alt - 9;
      // Sem espaço em cima, o rótulo vai para o lado do ponto.
      if (py < topo) {
        py = ponto.y - alt / 2;
        px = ponto.x + 10;
        if (px + larg > chartArea.right) px = ponto.x - 10 - larg;
      }
      px = Math.min(Math.max(px, chartArea.left + 2), chartArea.right - larg - 2);
      // Nunca sobe para o cabeçalho do painel (título e legenda).
      py = Math.max(py, topo);
      // Dois rótulos no mesmo lugar: o segundo desce para baixo do primeiro.
      for (const o of ocupados) {
        if (px < o.x + o.l && px + larg > o.x && py < o.y + o.a && py + alt > o.y) py = o.y + o.a + 4;
      }
      ocupados.push({ x: px, y: py, l: larg, a: alt });

      ctx.fillStyle = opts.superficie;
      ctx.strokeStyle = rgba(pico.cor, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(px, py, larg, alt, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pico.tinta || pico.cor;
      ctx.textAlign = 'center';
      ctx.fillText(texto, px + larg / 2, py + alt / 2 + 0.5);
    }
    ctx.restore();
  },
};

// Rótulo direto no fim de cada linha, para não depender só da legenda.
const pluginRotulosFim = {
  id: 'rotulosFim',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.ativo) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = `600 10px ${FONTE.family}`;
    ctx.textBaseline = 'middle';

    // Coleta primeiro e distribui depois: empurrar um rótulo por vez para
    // baixo encavala tudo quando as séries terminam juntas (duas linhas no
    // zero, por exemplo) e o último ainda é cortado na borda do gráfico.
    const rotulos = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden || !meta.data || !meta.data.length) return;
      // A linha de cenário (defluente informada) fica só na legenda.
      if (ds.semRotuloFim) return;
      const ponto = meta.data[meta.data.length - 1];
      if (!ponto) return;
      rotulos.push({
        texto: String(ds.label || '').replace(/\s*\(.*\)\s*$/, ''),
        cor: ds.borderColor,
        y: ponto.y,
      });
    });
    if (!rotulos.length) { ctx.restore(); return; }

    const ESPACO = 14;
    rotulos.sort((a, b) => a.y - b.y);
    // Separa para baixo…
    for (let i = 1; i < rotulos.length; i++) {
      rotulos[i].y = Math.max(rotulos[i].y, rotulos[i - 1].y + ESPACO);
    }
    // …e, se o conjunto passou da borda inferior, desloca tudo para cima.
    const excesso = rotulos[rotulos.length - 1].y - (chartArea.bottom - 7);
    if (excesso > 0) for (const r of rotulos) r.y -= excesso;
    for (const r of rotulos) r.y = Math.max(chartArea.top + 7, r.y);

    const x = chartArea.right + 7;
    for (const r of rotulos) {
      const larg = ctx.measureText(r.texto).width;
      ctx.fillStyle = opts.superficie;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x - 3, r.y - 8, larg + 6, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = r.cor;
      ctx.fillText(r.texto, x, r.y);
    }
    ctx.restore();
  },
};

/* ------------------------------------------------------------------ *
 * Opções comuns
 * ------------------------------------------------------------------ */

function opcoesBase({ titulo, tituloEixoY, pontos, legenda = false, unidade = '', casas = 2 }) {
  const c = cores();
  const tempo = eixoDeTempo(pontos);
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    // Com rótulo direto no fim da linha o plot cede espaço à direita.
    layout: { padding: { top: 2, right: legenda ? 74 : 14, bottom: 4, left: 0 } },
    plugins: {
      title: {
        display: true,
        text: titulo,
        align: 'start',
        color: c.texto,
        font: { ...FONTE, size: 12, weight: '700' },
        padding: { bottom: 16 },
      },
      // Série única não leva legenda: o título já a nomeia.
      legend: {
        display: legenda,
        position: 'bottom',
        align: 'start',
        labels: {
          boxWidth: 8, boxHeight: 8, padding: 16,
          usePointStyle: true, pointStyle: 'circle',
          color: c.medio, font: { ...FONTE, size: 11 },
        },
      },
      tooltip: {
        backgroundColor: rgba(c.superficie, 0.97),
        titleColor: c.texto,
        bodyColor: c.medio,
        borderColor: rgba(c.suave, 0.28),
        borderWidth: 1,
        titleFont: { ...FONTE, size: 11.5, weight: '700' },
        bodyFont: { ...FONTE, size: 12, weight: '500' },
        padding: { x: 13, y: 11 },
        titleMarginBottom: 8,
        bodySpacing: 6,
        cornerRadius: 12,
        caretSize: 0,
        caretPadding: 12,
        boxWidth: 8,
        boxHeight: 8,
        boxPadding: 6,
        usePointStyle: true,
        displayColors: true,
        callbacks: {
          // A amostra de cor é a do traço, cheia; antes vinha o degradê da
          // área, quase transparente.
          labelPointStyle: () => ({ pointStyle: 'circle', rotation: 0 }),
          labelColor: (item) => ({
            borderColor: item.dataset.borderColor,
            backgroundColor: item.dataset.borderColor,
            borderWidth: 0,
          }),
          title: (itens) => dataHoraLocal(pontos[itens[0].dataIndex].dataHora),
          label: (item) => {
            const v = item.parsed.y;
            const texto = Number.isFinite(v)
              ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
              : '—';
            return ` ${item.dataset.label.replace(/\s*\(.*\)\s*$/, '')}  ${texto}${unidade ? ` ${unidade}` : ''}`;
          },
        },
      },
      cruz: {
        cor: rgba(c.suave, 0.6),
        fundo: c.texto,
        tinta: c.superficie,
        rotulo: tempo
          ? (i) => {
            const d = new Date(tempo.tempos[i]);
            return `${fmtDia.format(d)} ${fmtHora.format(d)}`;
          }
          : null,
      },
      rotulosFim: { ativo: legenda, superficie: c.superficie },
    },
    scales: {
      x: tempo
        ? {
          border: { display: false, dash: [2, 4] },
          // Só a virada do dia ganha um fio vertical: é a referência que o
          // olho usa para contar "amanhã de madrugada".
          grid: {
            display: true,
            drawTicks: false,
            color: (ctx) => (ctx.tick && tempo.meiaNoite(ctx.tick.value) ? rgba(c.suave, 0.3) : 'transparent'),
          },
          afterBuildTicks: tempo.afterBuildTicks,
          ticks: {
            autoSkip: false, maxRotation: 0,
            color: c.suave, font: { ...FONTE, size: 10.5 }, padding: 8,
            callback: tempo.rotulo,
          },
        }
        : {
          border: { display: false },
          grid: { display: false },
          // `maxTicksLimit: 7` é demais num telefone: sete rótulos de
          // "08/11 03:23" pedem quase 500 px e se encavalam em 390. O limite
          // sai da largura real, sem rodar o texto.
          afterBuildTicks(eixo) {
            const util = Math.max(120, eixo.chart.width - 70);
            const cabem = Math.max(2, Math.min(7, Math.floor(util / 95)));
            if (eixo.ticks.length <= cabem) return;
            const salto = Math.ceil(eixo.ticks.length / cabem);
            eixo.ticks = eixo.ticks.filter((_, i) => i % salto === 0);
          },
          ticks: {
            maxTicksLimit: 7, autoSkip: true, maxRotation: 0,
            color: c.suave, font: { ...FONTE, size: 10.5 }, padding: 6,
          },
        },
      y: {
        border: { display: false },
        grid: { color: c.grade, drawTicks: false, lineWidth: 1 },
        ticks: {
          color: c.suave, font: { ...FONTE, size: 10.5 }, padding: 10, maxTicksLimit: 6,
          // Chart.js formata número no padrão da engine, não no do app.
          callback: (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }),
        },
        title: {
          display: !!tituloEixoY, text: tituloEixoY, color: c.suave,
          font: { ...FONTE, size: 10 }, padding: { bottom: 6 },
        },
      },
    },
  };
}

// Linha padrão: traço fino, sem pontos em repouso e alvo generoso no hover.
function serieLinha(label, dados, cor, { preencher = true } = {}) {
  let maior = -Infinity;
  for (const v of dados) if (Number.isFinite(v) && v > maior) maior = v;
  // O degradê guardado por geometria: recriá-lo a cada quadro do hover
  // custa, e a geometria só muda com o tamanho do gráfico.
  let cache = null;
  return {
    label,
    data: dados,
    borderColor: cor,
    borderWidth: 2.25,
    borderCapStyle: 'round',
    borderJoinStyle: 'round',
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2.5,
    pointHoverBackgroundColor: cor,
    pointHoverBorderColor: cores().superficie,
    pointHitRadius: 14,
    tension: 0.25,
    cubicInterpolationMode: 'monotone',
    fill: preencher
      ? {
        target: 'origin',
        // O degradê vai do pico da série ao pé do SEU painel. Antes ia do
        // alto ao pé do canvas inteiro, e nos painéis empilhados a área do
        // de baixo nascia quase transparente.
        above: (ctx) => {
          const { chart } = ctx;
          const area = chart.chartArea;
          if (!area) return 'transparent';
          const escala = chart.scales[ctx.dataset.yAxisID || 'y'];
          const base = escala ? Math.min(area.bottom, escala.bottom) : area.bottom;
          let topo = escala ? Math.max(area.top, escala.top) : area.top;
          if (escala && Number.isFinite(maior)) {
            const py = escala.getPixelForValue(maior);
            if (Number.isFinite(py)) topo = Math.min(Math.max(py, topo), base - 1);
          }
          const chave = `${topo}|${base}|${temaEscuroAtivo()}`;
          if (cache && cache.chave === chave) return cache.g;
          const g = chart.ctx.createLinearGradient(0, topo, 0, base);
          g.addColorStop(0, rgba(cor, temaEscuroAtivo() ? 0.26 : 0.24));
          g.addColorStop(0.6, rgba(cor, temaEscuroAtivo() ? 0.08 : 0.07));
          g.addColorStop(1, rgba(cor, 0));
          cache = { chave, g };
          return g;
        },
      }
      : false,
  };
}

function criarGrafico(canvasId, config) {
  destruir(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  config.plugins = [pluginFaixas, pluginPaineis, pluginLimites, pluginPicos, pluginCruz, pluginRotulosFim];
  const grafico = new Chart(canvas.getContext('2d'), config);
  graficos.set(canvasId, grafico);
  quandoAFonteChegar(grafico);
  return grafico;
}

/* ------------------------------------------------------------------ *
 * Gráficos
 * ------------------------------------------------------------------ */

/** Nível × tempo, com a faixa operacional sombreada e os limites rotulados. */
export function graficoNivel(canvasId, serie, limites = {}, restricoes = []) {
  refazer.set(canvasId, () => graficoNivel(canvasId, serie, limites, restricoes));
  const pontos = amostrar(serie);
  const c = cores();

  const dataset = serieLinha('Nível (m)', pontos.map((p) => p.cota), c.nivel);
  // Trechos em violação assumem a cor da severidade.
  dataset.segment = {
    borderColor: (ctx) => {
      const destino = pontos[ctx.p1DataIndex];
      return destino && destino.severidade ? c.violacao[destino.severidade] : c.nivel;
    },
  };

  const opcoes = opcoesBase({
    titulo: 'Nível × tempo', tituloEixoY: 'Cota (m)', pontos, unidade: 'm',
  });

  // A faixa segura é a região entre os limites operacionais; fora dos
  // emergenciais, zona crítica.
  const faixas = [];
  const { nivelMinOperacional: minOp, nivelMaxOperacional: maxOp } = limites;
  const { nivelMinEmergencial: minEm, nivelMaxEmergencial: maxEm } = limites;
  if (Number.isFinite(minOp) || Number.isFinite(maxOp)) {
    faixas.push({ de: minOp, ate: maxOp, cor: rgba(c.nivel, temaEscuroAtivo() ? 0.05 : 0.07) });
  }
  if (Number.isFinite(minEm)) faixas.push({ de: -Infinity, ate: minEm, cor: rgba(c.emergencial, 0.08) });
  if (Number.isFinite(maxEm)) faixas.push({ de: maxEm, ate: Infinity, cor: rgba(c.emergencial, 0.08) });
  opcoes.plugins.faixas = { lista: faixas };

  const linhas = [
    { rotulo: 'mín. oper.', valor: minOp, cor: c.operacional },
    { rotulo: 'máx. oper.', valor: maxOp, cor: c.operacional },
    { rotulo: 'mín. emerg.', valor: minEm, cor: c.emergencial },
    { rotulo: 'máx. emerg.', valor: maxEm, cor: c.emergencial },
  ];
  for (const r of restricoes) {
    if (Number.isFinite(r.nivel)) {
      linhas.push({
        rotulo: `restrição ${r.tipo === 'min' ? 'mín.' : 'máx.'}`,
        valor: r.nivel, cor: c.restricao, tracejado: [3, 3],
      });
    }
  }
  opcoes.plugins.limites = { lista: linhas, superficie: c.superficie };

  return criarGrafico(canvasId, {
    type: 'line',
    data: { labels: rotularPontos(pontos), datasets: [dataset] },
    options: opcoes,
  });
}

/** Volume × tempo. */
export function graficoVolume(canvasId, serie) {
  refazer.set(canvasId, () => graficoVolume(canvasId, serie));
  const pontos = amostrar(serie);
  const c = cores();
  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: rotularPontos(pontos),
      datasets: [serieLinha('Volume (hm³)', pontos.map((p) => p.volume), c.volume)],
    },
    options: opcoesBase({
      titulo: 'Volume × tempo', tituloEixoY: 'Volume (hm³)', pontos, unidade: 'hm³', casas: 3,
    }),
  });
}

/** Vazões afluente e defluente × tempo — o único gráfico com duas séries. */
export function graficoVazoes(canvasId, serie) {
  refazer.set(canvasId, () => graficoVazoes(canvasId, serie));
  const pontos = amostrar(serie);
  const c = cores();
  const datasets = [
    serieLinha('Afluente (m³/s)', pontos.map((p) => p.qaf), c.qaf, { preencher: false }),
    serieLinha('Defluente (m³/s)', pontos.map((p) => p.qdef), c.qdef, { preencher: false }),
  ];

  // Com contenção na emergência a defluente plotada é a NECESSÁRIA para
  // segurar o nível. A informada entra tracejada ao lado, na mesma cor: é a
  // mesma grandeza em outro cenário, não outra série.
  if (pontos.some((p) => Math.abs(p.manobra || 0) > 1e-9)) {
    const informada = serieLinha('Defluente informada (m³/s)',
      pontos.map((p) => p.qdefInformada), c.qdef, { preencher: false });
    informada.borderDash = [5, 4];
    informada.borderWidth = 1.5;
    informada.semRotuloFim = true;
    datasets.push(informada);
  }

  return criarGrafico(canvasId, {
    type: 'line',
    data: { labels: rotularPontos(pontos), datasets },
    options: opcoesBase({
      titulo: 'Vazões × tempo', tituloEixoY: 'Vazão (m³/s)', pontos,
      legenda: true, unidade: 'm³/s',
    }),
  });
}

/* --- Curva CAV: dois gráficos de série única, não um de eixo duplo --- */

function pontosCav(cav) {
  const passo = Math.max(1, Math.floor(cav.volumes.length / 400));
  const pontos = [];
  for (let i = 0; i < cav.volumes.length; i += passo) {
    pontos.push({
      cota: cav.cotaInicial + i * cav.passo,
      volume: cav.volumes[i],
      area: cav.areas[i],
    });
  }
  return pontos;
}

function opcoesCav({ titulo, tituloEixoY, pontos, unidade, casas }) {
  const c = cores();
  const o = opcoesBase({ titulo, tituloEixoY, pontos: [], unidade, casas });
  // O eixo x aqui é cota, não tempo: o tooltip precisa de outro título.
  o.plugins.tooltip.callbacks.title = (itens) => `Cota ${pontos[itens[0].dataIndex].cota.toFixed(2).replace('.', ',')} m`;
  o.scales.x.title = {
    display: true, text: 'Cota (m)', color: c.suave,
    font: { ...FONTE, size: 10 }, padding: { top: 6 },
  };
  return o;
}

/**
 * Curva cota × volume e cota × área, em dois gráficos.
 * @param {string} canvasVolumeId canvas do volume
 * @param {string} canvasAreaId canvas da área
 */
export function graficoCav(canvasVolumeId, canvasAreaId, cav) {
  refazer.set(canvasVolumeId, () => graficoCav(canvasVolumeId, canvasAreaId, cav));
  const pontos = pontosCav(cav);
  const c = cores();
  const labels = pontos.map((p) => p.cota.toFixed(2).replace('.', ','));

  criarGrafico(canvasVolumeId, {
    type: 'line',
    data: { labels, datasets: [serieLinha('Volume (hm³)', pontos.map((p) => p.volume), c.volume)] },
    options: opcoesCav({
      titulo: 'Volume × cota', tituloEixoY: 'Volume (hm³)', pontos, unidade: 'hm³', casas: 3,
    }),
  });

  if (canvasAreaId && document.getElementById(canvasAreaId)) {
    criarGrafico(canvasAreaId, {
      type: 'line',
      data: { labels, datasets: [serieLinha('Área (km²)', pontos.map((p) => p.area), c.area)] },
      options: opcoesCav({
        titulo: 'Área × cota', tituloEixoY: 'Área (km²)', pontos, unidade: 'km²', casas: 3,
      }),
    });
  }
}

/* ------------------------------------------------------------------ *
 * Amortecimento de cheia
 *
 * Três gráficos de papel claro em vez de um com três séries: afluente,
 * bombeado e vertido não passam na separação de cores num plot só (verde e
 * azul ficam a ΔE 14, abaixo do piso de 15 para visão normal). Separados,
 * cada um fica com uma ou duas séries e a leitura melhora.
 * ------------------------------------------------------------------ */


/**
 * A cheia inteira num gráfico: três painéis empilhados sobre o mesmo eixo de
 * tempo — nível, vazões e bombeamento.
 *
 * Substitui seis gráficos que repetiam os mesmos dados: o vertimento
 * aparecia em quatro deles, o nível em dois, a afluência em três. Empilhados
 * e alinhados, a leitura é vertical e responde de uma vez às três perguntas
 * da operação: o nível segurou, quanto precisei verter, e as bombas deram
 * conta.
 *
 * Painéis separados porque as unidades diferem (cota em metros, vazões em
 * m³/s) e porque dentro de cada um cabem no máximo duas séries, que é o
 * limite para as cores se distinguirem com segurança.
 */
export function graficoCheia(canvasId, serie, limites = {}) {
  refazer.set(canvasId, () => graficoCheia(canvasId, serie, limites));
  const rotuloLimites = limites.rotuloLimites || '';
  const pontos = amostrar(serie);
  const c = cores();
  const escuro = temaEscuroAtivo();
  const { nivelMaximo, nivelMinimo, limiteSemDano } = limites;

  const opcoes = opcoesBase({ titulo: '', tituloEixoY: '', pontos, legenda: false });
  opcoes.plugins.title.display = false;
  // A legenda de cada painel fica dentro dele; não há rótulo no fim da linha
  // nem legenda geral, que misturaria as três escalas numa fileira só.
  opcoes.plugins.rotulosFim = { ativo: false };
  opcoes.layout.padding = { top: 4, right: 16, bottom: 0, left: 0 };

  opcoes.plugins.tooltip.callbacks.label = (item) => {
    const eixo = item.dataset.yAxisID;
    const casas = eixo === 'yNivel' ? 2 : 1;
    const v = item.parsed.y;
    const texto = Number.isFinite(v)
      ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
      : '—';
    return ` ${item.dataset.label.replace(/\s*\(.*\)\s*$/, '')}  ${texto} ${eixo === 'yNivel' ? 'm' : 'm³/s'}`;
  };

  const linhas = [];
  if (Number.isFinite(nivelMaximo)) linhas.push({ rotulo: 'teto', valor: nivelMaximo, cor: c.emergencial, eixo: 'yNivel' });
  if (Number.isFinite(nivelMinimo)) linhas.push({ rotulo: 'piso', valor: nivelMinimo, cor: c.emergencial, eixo: 'yNivel' });
  if (Number.isFinite(limiteSemDano)) linhas.push({ rotulo: 'alaga', valor: limiteSemDano, cor: c.emergencial, eixo: 'yVazao' });
  opcoes.plugins.limites = { lista: linhas, superficie: c.superficie };

  // Acima do teto e abaixo do piso, um véu vermelho muito leve: a zona em
  // que o nível não pode entrar se lê como região, não só como linha.
  const faixasNivel = [];
  if (Number.isFinite(nivelMaximo)) faixasNivel.push({ eixo: 'yNivel', de: nivelMaximo, ate: Infinity, reservaTopo: ALTURA_CABECALHO, cor: rgba(c.emergencial, escuro ? 0.09 : 0.06) });
  if (Number.isFinite(nivelMinimo)) faixasNivel.push({ eixo: 'yNivel', de: -Infinity, ate: nivelMinimo, cor: rgba(c.emergencial, escuro ? 0.09 : 0.06) });
  opcoes.plugins.faixas = { lista: faixasNivel };
  // A ordem das chaves é a de baixo para cima: o nível, que é a restrição,
  // fica no topo; o bombeamento, que é o recurso, na base.
  const eixo = (peso, extras = {}) => ({
    ...(extras.faixa || {}),
    stack: 'cheia',
    stackWeight: peso,
    border: { display: false },
    grid: { color: rgba(c.suave, escuro ? 0.16 : 0.13), drawTicks: false, lineWidth: 1 },
    // Espaço no alto de cada painel para o título e a legenda. `grace` não
    // serve: ele afrouxa os dois extremos, e um eixo de vazão não desce
    // abaixo de zero. Aqui só o teto da escala sobe.
    afterDataLimits(escala) {
      const vao = escala.max - escala.min;
      if (vao > 0) escala.max += vao * (extras.folgaNoAlto || 0);
    },
    ticks: {
      color: c.suave, font: { ...FONTE, size: 10 }, padding: 10, maxTicksLimit: extras.marcas || 4,
      maxRotation: 0,
      callback(v) {
        // Na fronteira entre dois painéis o topo de um encosta no piso do
        // outro: um dos dois números sempre sai, ou a leitura troca de escala
        // sem avisar.
        if (extras.ocultarMinimo && v === this.min) return '';
        if (extras.ocultarMaximo && v === this.max) return '';
        return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
      },
    },
    title: { display: false },
    afterFit(escala) { escala.width = 52; },
  });

  // O teto e o piso de emergência são a razão do gráfico: a escala do nível
  // é forçada a contê-los, ainda que a cota simulada fique longe deles.
  const folga = Number.isFinite(nivelMaximo) && Number.isFinite(nivelMinimo)
    ? Math.max(0.08, (nivelMaximo - nivelMinimo) * 0.08) : 0;
  const faixaNivel = {};
  if (Number.isFinite(nivelMaximo)) faixaNivel.suggestedMax = nivelMaximo + folga;
  if (Number.isFinite(nivelMinimo)) faixaNivel.suggestedMin = nivelMinimo - folga;

  // Eixos vazios entre os painéis. O empilhamento do Chart.js não tem vão:
  // o pé de um painel é o topo do outro. Um eixo sem série, sem marcas e sem
  // grade ocupa o seu peso na pilha e não desenha nada — é o espaço em
  // branco que separa os três.
  const vao = () => ({
    // Sem série atrelada o Chart.js não deduz nem o tipo nem o lado.
    type: 'linear',
    position: 'left',
    axis: 'y',
    stack: 'cheia',
    stackWeight: 1,
    min: 0,
    max: 1,
    display: true,
    border: { display: false },
    grid: { display: false, drawTicks: false },
    ticks: { display: false },
    afterFit(escala) { escala.width = 52; },
  });

  opcoes.scales = {
    x: opcoes.scales.x,
    // A folga é maior onde o painel é mais baixo: o cabeçalho tem altura
    // fixa, a faixa do painel não.
    yBomba: eixo(2.4, { ocultarMaximo: true, marcas: 4, folgaNoAlto: 0.42 }),
    vaoB: vao(),
    yVazao: eixo(4, { ocultarMinimo: true, ocultarMaximo: true, marcas: 7, folgaNoAlto: 0.16 }),
    vaoA: vao(),
    // Mais marcas no nível: a faixa útil tem pouco mais de 2 m e, com poucas
    // marcas, o passo salta para 2 m e a escala sobe muito acima do teto.
    yNivel: eixo(3, { ocultarMinimo: true, ocultarMaximo: true, faixa: faixaNivel, marcas: 6, folgaNoAlto: 0.24 }),
  };

  // Faixas dos limites de confiança: duas séries cinzas por grandeza, a de
  // cima preenchida até a de baixo. Entram ANTES das linhas no array para
  // ficarem por baixo delas, e fora do tooltip e da legenda — são a mesma
  // grandeza, não outra série.
  const temLimites = pontos.some((p) => Number.isFinite(p.cotaMax));
  const cinza = rgba(c.suave, escuro ? 0.18 : 0.16);
  const faixa = (campo, eixo, cor) => {
    if (!temLimites) return [];
    const borda = rgba(cor, escuro ? 0.4 : 0.32);
    const alto = {
      label: `${campo} máx`,
      data: pontos.map((p) => p[`${campo}Max`]),
      borderColor: borda,
      borderWidth: 1,
      pointRadius: 0,
      pointHitRadius: 0,
      tension: 0.25,
      cubicInterpolationMode: 'monotone',
      yAxisID: eixo,
      backgroundColor: cinza,
      fill: '+1',
      semLegenda: true,
    };
    const baixo = {
      ...alto, label: `${campo} mín`, data: pontos.map((p) => p[`${campo}Min`]), fill: false,
    };
    return [alto, baixo];
  };

  const nivel = serieLinha('Nível (m)', pontos.map((p) => p.cota), c.nivel);
  nivel.yAxisID = 'yNivel';
  nivel.borderWidth = 2.5;

  const afluente = serieLinha('Afluente (m³/s)', pontos.map((p) => p.qaf), c.qaf, { preencher: false });
  afluente.yAxisID = 'yVazao';
  const vertido = serieLinha('Vertido (m³/s)', pontos.map((p) => p.qvert), c.qdef);
  vertido.yAxisID = 'yVazao';

  // Bombeado e revertido saem os dois de Santana, mas são operações
  // distintas. A linha de "disponível na cota" saiu: com máquina de
  // velocidade fixa, o bombeado já É o disponível, salvo quando a cota
  // tira Vigário de operação — e isso a própria linha mostra, caindo a zero.
  const bombeado = serieLinha('Bombeado (m³/s)', pontos.map((p) => p.qbomb), c.volume);
  bombeado.yAxisID = 'yBomba';
  const revertido = serieLinha('Revertido (m³/s)', pontos.map((p) => p.qrev), c.reversao,
    { preencher: false });
  revertido.yAxisID = 'yBomba';

  // Fios da virada do dia só dentro dos painéis (ver pluginPaineis).
  const tempo = eixoDeTempo(pontos);
  opcoes.scales.x.grid = { display: false };
  opcoes.plugins.paineis = {
    meiaNoite: tempo ? tempo.meiaNoite : null,
    divisor: rgba(c.suave, escuro ? 0.34 : 0.3),
    titulo: varCss('--acento-tinta', escuro ? '#c3ff24' : '#1f6b57'),
    medio: c.medio,
    suave: c.suave,
    lista: [
      { eixo: 'yNivel',
        nome: 'Nível do reservatório',
        unidade: 'm',
        series: [{ nome: 'Nível', cor: c.nivel, indice: 0 }] },
      { eixo: 'yVazao',
        nome: 'Afluência e vertimento',
        unidade: 'm³/s',
        series: [
          { nome: 'Afluente', cor: c.qaf, indice: 1 },
          { nome: 'Vertido', cor: c.qdef, indice: 2 },
        ] },
      { eixo: 'yBomba',
        nome: 'Bombeamento e reversão',
        unidade: 'm³/s',
        series: [
          { nome: 'Bombeado · Vigário', cor: c.volume, indice: 3 },
          { nome: 'Revertido · Santa Cecília', cor: c.reversao, indice: 4 },
        ] },
    ],
  };

  const bandas = [
    ...faixa('cota', 'yNivel', c.nivel),
    ...faixa('qaf', 'yVazao', c.qaf),
    ...faixa('qvert', 'yVazao', c.qdef),
  ];
  const datasets = [...bandas, nivel, afluente, vertido, bombeado, revertido];
  const base = bandas.length;
  const indices = { nivel: base, afluente: base + 1, vertido: base + 2, bombeado: base + 3, revertido: base + 4 };

  // As séries cinzas não entram na leitura ponto a ponto: a faixa se vê,
  // não se consulta.
  opcoes.plugins.tooltip.filter = (item) => !item.dataset.semLegenda;

  opcoes.plugins.paineis.lista[0].series[0].indice = indices.nivel;
  opcoes.plugins.paineis.lista[1].series[0].indice = indices.afluente;
  opcoes.plugins.paineis.lista[1].series[1].indice = indices.vertido;
  opcoes.plugins.paineis.lista[2].series[0].indice = indices.bombeado;
  opcoes.plugins.paineis.lista[2].series[1].indice = indices.revertido;

  const vazao = (v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m³/s`;
  opcoes.plugins.picos = {
    superficie: c.superficie,
    lista: [
      { indice: indices.nivel, cor: c.nivel, tinta: c.texto, reservaTopo: ALTURA_CABECALHO,
        texto: (v) => `máx. ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` },
      { indice: indices.afluente, cor: c.qaf, tinta: c.texto, reservaTopo: ALTURA_CABECALHO,
        texto: (v) => `pico ${vazao(v)}` },
      { indice: indices.vertido, cor: c.qdef, tinta: c.texto, reservaTopo: ALTURA_CABECALHO, minimo: 0.05,
        texto: (v) => `vertido ${vazao(v)}` },
    ],
  };
  if (temLimites) {
    opcoes.plugins.paineis.lista[0].series.push(
      { nome: `Limites ${rotuloLimites}`, cor: cinza, faixa: true });
    opcoes.plugins.paineis.lista[1].series.push(
      { nome: `Limites ${rotuloLimites}`, cor: cinza, faixa: true });
  }

  // Leitor de tela não enxerga canvas: o gráfico se descreve em uma frase,
  // com as mesmas três leituras que os rótulos de pico destacam.
  const canvas = document.getElementById(canvasId);
  if (canvas) {
    const maximo = (campo) => pontos.reduce((m, p) => (Number.isFinite(p[campo]) && p[campo] > m ? p[campo] : m), -Infinity);
    const f = (v, casas) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '—');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label',
      `Gráfico da cheia: nível máximo ${f(maximo('cota'), 2)} m, afluência de pico ${f(maximo('qaf'), 0)} m³/s, `
      + `vertimento máximo ${f(maximo('qvert'), 0)} m³/s e bombeamento máximo ${f(maximo('qbomb'), 0)} m³/s.`);
  }

  return criarGrafico(canvasId, {
    type: 'line',
    data: { labels: rotularPontos(pontos), datasets },
    options: opcoes,
  });
}
