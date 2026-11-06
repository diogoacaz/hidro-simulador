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

const MAX_PONTOS_GRAFICO = 1200;
const graficos = new Map();

// As cores são lidas do CSS na criação do gráfico, então uma troca de tema do
// sistema deixaria a paleta antiga congelada. Guardamos como refazer cada
// gráfico para redesenhá-los quando o tema mudar.
const refazer = new Map();

// A referência à MediaQueryList precisa ser mantida: uma MQL sem referência
// forte pode ser coletada e parar de notificar.
const temaEscuro = matchMedia('(prefers-color-scheme: dark)');
temaEscuro.addEventListener('change', () => {
  for (const redesenhar of [...refazer.values()]) redesenhar();
});

const FONTE = { family: '"Segoe UI", Arial, Helvetica, ui-sans-serif, system-ui, sans-serif' };

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
  const escuro = temaEscuro.matches;
  return {
    nivel: escuro ? '#c3ff24' : '#047857',
    volume: escuro ? '#22d3ee' : '#0891b2',
    area: escuro ? '#5eead4' : '#0b7285',
    qaf: escuro ? '#1f9ed6' : '#0369a1',
    qdef: escuro ? '#c08a08' : '#b45309',

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
    const y = scales.y;
    if (!y || !chartArea) return;

    ctx.save();
    for (const f of faixas) {
      const de = Number.isFinite(f.de) ? y.getPixelForValue(f.de) : chartArea.bottom;
      const ate = Number.isFinite(f.ate) ? y.getPixelForValue(f.ate) : chartArea.top;
      const topo = Math.max(chartArea.top, Math.min(de, ate));
      const base = Math.min(chartArea.bottom, Math.max(de, ate));
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
    const y = scales.y;
    if (!y || !chartArea) return;

    ctx.save();
    ctx.font = `500 10px ${FONTE.family}`;
    ctx.textBaseline = 'middle';

    // Limites fora da escala ganham um aviso na borda. Sem isto o gráfico não
    // explica uma violação que o painel de situação acusa — é o caso de uma
    // restrição distante da faixa em que o nível de fato andou.
    const foraDaEscala = { acima: 0, abaixo: 0 };

    for (const l of linhas) {
      if (!Number.isFinite(l.valor)) continue;
      const py = y.getPixelForValue(l.valor);

      const lado = py < chartArea.top - 1 ? 'acima' : py > chartArea.bottom + 1 ? 'abaixo' : null;
      if (lado) {
        const seta = lado === 'acima' ? '↑' : '↓';
        const valor = l.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const aviso = `${seta} ${l.rotulo} ${valor}`;
        const largura = ctx.measureText(aviso).width;
        const deslocamento = foraDaEscala[lado] * 15;
        const ly = lado === 'acima'
          ? chartArea.top + 9 + deslocamento
          : chartArea.bottom - 9 - deslocamento;
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

      ctx.fillStyle = l.cor;
      ctx.fillText(texto, x, py);
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
    ctx.strokeStyle = opts.cor;
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
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
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    // Com rótulo direto no fim da linha o plot cede espaço à direita.
    layout: { padding: { top: 2, right: legenda ? 74 : 14, bottom: 0, left: 0 } },
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
        backgroundColor: c.superficie,
        titleColor: c.texto,
        bodyColor: c.medio,
        borderColor: c.grade,
        borderWidth: 1,
        titleFont: { ...FONTE, size: 11, weight: '700' },
        bodyFont: { ...FONTE, size: 12 },
        padding: 11,
        cornerRadius: 10,
        boxPadding: 5,
        usePointStyle: true,
        displayColors: true,
        callbacks: {
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
      cruz: { cor: c.grade },
      rotulosFim: { ativo: legenda, superficie: c.superficie },
    },
    scales: {
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: {
          maxTicksLimit: 7, autoSkip: true, maxRotation: 0,
          color: c.suave, font: { ...FONTE, size: 10 }, padding: 6,
        },
      },
      y: {
        border: { display: false },
        grid: { color: c.grade, drawTicks: false, lineWidth: 1 },
        ticks: {
          color: c.suave, font: { ...FONTE, size: 10 }, padding: 10, maxTicksLimit: 6,
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
  return {
    label,
    data: dados,
    borderColor: cor,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBorderWidth: 2,
    pointHoverBackgroundColor: cor,
    pointHoverBorderColor: cores().superficie,
    pointHitRadius: 14,
    tension: 0.25,
    cubicInterpolationMode: 'monotone',
    fill: preencher
      ? {
        target: 'origin',
        above: (ctx) => {
          const { chart } = ctx;
          const area = chart.chartArea;
          if (!area) return 'transparent';
          const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          g.addColorStop(0, rgba(cor, temaEscuro.matches ? 0.14 : 0.22));
          g.addColorStop(1, rgba(cor, 0));
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
  config.plugins = [pluginFaixas, pluginLimites, pluginCruz, pluginRotulosFim];
  const grafico = new Chart(canvas.getContext('2d'), config);
  graficos.set(canvasId, grafico);
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
    faixas.push({ de: minOp, ate: maxOp, cor: rgba(c.nivel, temaEscuro.matches ? 0.05 : 0.07) });
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

/** Vertimento × tempo, com a linha do limite que começa a alagar. */
export function graficoVertimento(canvasId, serie, limiteSemDano) {
  refazer.set(canvasId, () => graficoVertimento(canvasId, serie, limiteSemDano));
  const pontos = amostrar(serie);
  const c = cores();

  const opcoes = opcoesBase({
    titulo: 'Vertimento × tempo', tituloEixoY: 'Vazão vertida (m³/s)', pontos, unidade: 'm³/s',
  });
  if (Number.isFinite(limiteSemDano)) {
    opcoes.plugins.limites = {
      lista: [{ rotulo: 'início do alagamento', valor: limiteSemDano, cor: c.emergencial }],
      superficie: c.superficie,
    };
    // A faixa sem dano fica sombreada: é nela que a operação quer ficar.
    opcoes.plugins.faixas = {
      lista: [{ de: 0, ate: limiteSemDano, cor: rgba(c.nivel, temaEscuro.matches ? 0.06 : 0.09) }],
    };
  }

  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: rotularPontos(pontos),
      datasets: [serieLinha('Vertido (m³/s)', pontos.map((p) => p.qvert), c.qdef)],
    },
    options: opcoes,
  });
}

/**
 * Afluência contra vertimento, no mesmo eixo de tempo e na mesma escala.
 *
 * É o gráfico do amortecimento: quanto entra, quanto sai pela comporta, e o
 * atraso entre os dois picos. Escala única de propósito — a diferença entre
 * as duas alturas É a informação. Azul × âmbar é o par validado para duas
 * séries, e a linha de alagamento entra como referência, não como série.
 */
export function graficoAfluenteVertimento(canvasId, serie, limiteSemDano) {
  refazer.set(canvasId, () => graficoAfluenteVertimento(canvasId, serie, limiteSemDano));
  const pontos = amostrar(serie);
  const c = cores();

  const opcoes = opcoesBase({
    titulo: 'Afluência × vertimento', tituloEixoY: 'Vazão (m³/s)', pontos,
    legenda: true, unidade: 'm³/s',
  });
  if (Number.isFinite(limiteSemDano)) {
    opcoes.plugins.limites = {
      lista: [{ rotulo: 'início do alagamento', valor: limiteSemDano, cor: c.emergencial }],
      superficie: c.superficie,
    };
  }

  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: rotularPontos(pontos),
      datasets: [
        serieLinha('Afluente (m³/s)', pontos.map((p) => p.qaf), c.qaf, { preencher: false }),
        serieLinha('Vertido (m³/s)', pontos.map((p) => p.qvert), c.qdef),
      ],
    },
    options: opcoes,
  });
}

/** Afluência contra retirada total (bombeamento + vertimento). */
export function graficoAfluenteSaida(canvasId, serie) {
  refazer.set(canvasId, () => graficoAfluenteSaida(canvasId, serie));
  const pontos = amostrar(serie);
  const c = cores();
  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: rotularPontos(pontos),
      datasets: [
        serieLinha('Afluente (m³/s)', pontos.map((p) => p.qaf), c.qaf, { preencher: false }),
        serieLinha('Retirada total (m³/s)', pontos.map((p) => p.qsaida), c.qdef, { preencher: false }),
      ],
    },
    options: opcoesBase({
      titulo: 'Afluência × retirada', tituloEixoY: 'Vazão (m³/s)', pontos,
      legenda: true, unidade: 'm³/s',
    }),
  });
}

/** Bombeamento efetivo contra o disponível na cota — mostra onde a captação para. */
export function graficoBombeamento(canvasId, serie) {
  refazer.set(canvasId, () => graficoBombeamento(canvasId, serie));
  const pontos = amostrar(serie);
  const c = cores();
  const disponivel = serieLinha('Disponível na cota (m³/s)',
    pontos.map((p) => p.bombeamentoDisponivel), c.nivel, { preencher: false });
  disponivel.borderDash = [5, 4];
  disponivel.borderWidth = 1.5;
  disponivel.semRotuloFim = true;

  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: rotularPontos(pontos),
      datasets: [serieLinha('Bombeado (m³/s)', pontos.map((p) => p.qbomb), c.nivel), disponivel],
    },
    options: opcoesBase({
      titulo: 'Bombeamento × tempo', tituloEixoY: 'Vazão bombeada (m³/s)', pontos,
      legenda: true, unidade: 'm³/s',
    }),
  });
}
