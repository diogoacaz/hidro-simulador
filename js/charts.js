// Gráficos dos resultados de simulação (Chart.js), com linhas de referência
// dos limites e destaque das faixas violadas.

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

// Lê uma variável de tema do CSS, para os gráficos acompanharem claro/escuro.
function varCss(nome, alternativa) {
  const valor = getComputedStyle(document.body).getPropertyValue(nome).trim();
  return valor || alternativa;
}

function cores() {
  const escuro = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    nivel: varCss('--acento', '#2563eb'),
    volume: escuro ? '#2dd4bf' : '#0d9488',
    qaf: escuro ? '#60a5fa' : '#0284c7',
    qdef: varCss('--atencao', '#d97706'),
    operacional: varCss('--texto-suave', '#8b8b93'),
    emergencial: varCss('--critico', '#dc2626'),
    restricao: varCss('--restricao', '#9333ea'),
    texto: varCss('--texto-medio', '#52525b'),
    suave: varCss('--texto-suave', '#8b8b93'),
    grade: varCss('--linha', '#e8e8ea'),
    superficie: varCss('--superficie', '#ffffff'),
    violacao: {
      critico: varCss('--critico', '#dc2626'),
      restricao: varCss('--restricao', '#9333ea'),
      atencao: varCss('--atencao', '#d97706'),
    },
  };
}

// Transparência para o preenchimento sob a linha.
function comAlfa(cor, alfa) {
  return `color-mix(in srgb, ${cor} ${Math.round(alfa * 100)}%, transparent)`;
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

function opcoesBase(titulo, tituloEixoY, pontos) {
  const c = cores();
  const fonte = { family: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: {
        display: true,
        text: titulo,
        align: 'start',
        color: c.texto,
        font: { ...fonte, size: 13, weight: '600' },
        padding: { bottom: 14 },
      },
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 6,
          boxHeight: 6,
          padding: 14,
          usePointStyle: true,
          pointStyle: 'circle',
          color: c.suave,
          font: { ...fonte, size: 11 },
        },
      },
      tooltip: {
        backgroundColor: c.texto,
        titleFont: { ...fonte, size: 12 },
        bodyFont: { ...fonte, size: 12 },
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
        displayColors: true,
        callbacks: {
          title: (itens) => dataHoraLocal(pontos[itens[0].dataIndex].dataHora),
        },
      },
    },
    scales: {
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: { maxTicksLimit: 8, autoSkip: true, color: c.suave, font: { ...fonte, size: 11 } },
      },
      y: {
        border: { display: false },
        grid: { color: c.grade, drawTicks: false },
        ticks: { color: c.suave, font: { ...fonte, size: 11 }, padding: 8 },
        title: { display: true, text: tituloEixoY, color: c.suave, font: { ...fonte, size: 11 } },
      },
    },
  };
}

// Linha de referência horizontal; o chamador preenche `data` com o valor repetido.
function linhaLimite(label, cor, tracejado = [6, 4]) {
  return {
    label,
    borderColor: cor,
    borderDash: tracejado,
    borderWidth: 1.5,
    pointRadius: 0,
    fill: false,
  };
}

function criarGrafico(canvasId, config) {
  destruir(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const grafico = new Chart(canvas.getContext('2d'), config);
  graficos.set(canvasId, grafico);
  return grafico;
}

/** Gráfico nível × tempo com limites operacionais, emergenciais e restrições. */
export function graficoNivel(canvasId, serie, limites = {}, restricoes = []) {
  refazer.set(canvasId, () => graficoNivel(canvasId, serie, limites, restricoes));
  const pontos = amostrar(serie);
  const labels = pontos.map((p) => dataHoraLocal(p.dataHora));
  const c = cores();

  const datasets = [{
    label: 'Nível (m)',
    data: pontos.map((p) => p.cota),
    borderColor: c.nivel,
    backgroundColor: comAlfa(c.nivel, 0.07),
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.1,
    fill: true,
    // Destaca os trechos em violação com a cor da severidade.
    segment: {
      borderColor: (ctx) => {
        const destino = pontos[ctx.p1DataIndex];
        return destino && destino.severidade ? c.violacao[destino.severidade] : c.nivel;
      },
    },
  }];

  const referencias = [
    ['Mín. operacional', limites.nivelMinOperacional, c.operacional],
    ['Máx. operacional', limites.nivelMaxOperacional, c.operacional],
    ['Mín. emergencial', limites.nivelMinEmergencial, c.emergencial],
    ['Máx. emergencial', limites.nivelMaxEmergencial, c.emergencial],
  ];
  for (const [label, valor, cor] of referencias) {
    if (Number.isFinite(valor)) {
      datasets.push({ ...linhaLimite(label, cor), data: pontos.map(() => valor) });
    }
  }
  for (const r of restricoes) {
    if (Number.isFinite(r.nivel)) {
      const label = `Restrição ${r.tipo === 'min' ? 'mín.' : 'máx.'}${r.motivo ? ` — ${r.motivo}` : ''}`;
      datasets.push({ ...linhaLimite(label, c.restricao, [3, 3]), data: pontos.map(() => r.nivel) });
    }
  }

  return criarGrafico(canvasId, {
    type: 'line',
    data: { labels, datasets },
    options: opcoesBase('Nível × tempo', 'Cota (m)', pontos),
  });
}

/** Gráfico volume × tempo. */
export function graficoVolume(canvasId, serie) {
  refazer.set(canvasId, () => graficoVolume(canvasId, serie));
  const pontos = amostrar(serie);
  const c = cores();
  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: pontos.map((p) => dataHoraLocal(p.dataHora)),
      datasets: [{
        label: 'Volume (hm³)',
        data: pontos.map((p) => p.volume),
        borderColor: c.volume,
        backgroundColor: comAlfa(c.volume, 0.07),
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        fill: true,
      }],
    },
    options: opcoesBase('Volume × tempo', 'Volume (hm³)', pontos),
  });
}

/** Gráfico vazões afluente e defluente × tempo. */
export function graficoVazoes(canvasId, serie) {
  refazer.set(canvasId, () => graficoVazoes(canvasId, serie));
  const pontos = amostrar(serie);
  const c = cores();
  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: pontos.map((p) => dataHoraLocal(p.dataHora)),
      datasets: [
        {
          label: 'Afluente (m³/s)',
          data: pontos.map((p) => p.qaf),
          borderColor: c.qaf,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: 'Defluente (m³/s)',
          data: pontos.map((p) => p.qdef),
          borderColor: c.qdef,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
      ],
    },
    options: opcoesBase('Vazões × tempo', 'Vazão (m³/s)', pontos),
  });
}

/** Gráfico da curva CAV (cota × volume e cota × área). */
export function graficoCav(canvasId, cav) {
  refazer.set(canvasId, () => graficoCav(canvasId, cav));
  const passo = Math.max(1, Math.floor(cav.volumes.length / 400));
  const pontos = [];
  for (let i = 0; i < cav.volumes.length; i += passo) {
    pontos.push({
      cota: cav.cotaInicial + i * cav.passo,
      volume: cav.volumes[i],
      area: cav.areas[i],
    });
  }
  const c = cores();
  const fonte = { family: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };
  const eixo = (texto, posicao, extras = {}) => ({
    position: posicao,
    border: { display: false },
    ticks: { color: c.suave, font: { ...fonte, size: 11 }, padding: 8 },
    title: { display: true, text: texto, color: c.suave, font: { ...fonte, size: 11 } },
    ...extras,
  });

  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: pontos.map((p) => p.cota.toFixed(2)),
      datasets: [
        {
          label: 'Volume (hm³)',
          data: pontos.map((p) => p.volume),
          borderColor: c.volume,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'Área (km²)',
          data: pontos.map((p) => p.area),
          borderColor: c.qaf,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        title: {
          display: true,
          text: 'Curva cota × área × volume',
          align: 'start',
          color: c.texto,
          font: { ...fonte, size: 13, weight: '600' },
          padding: { bottom: 14 },
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 6, boxHeight: 6, padding: 14,
            usePointStyle: true, pointStyle: 'circle',
            color: c.suave, font: { ...fonte, size: 11 },
          },
        },
        tooltip: {
          backgroundColor: c.texto,
          titleFont: { ...fonte, size: 12 },
          bodyFont: { ...fonte, size: 12 },
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: { maxTicksLimit: 8, color: c.suave, font: { ...fonte, size: 11 } },
          title: { display: true, text: 'Cota (m)', color: c.suave, font: { ...fonte, size: 11 } },
        },
        y: eixo('Volume (hm³)', 'left', { grid: { color: c.grade, drawTicks: false } }),
        y2: eixo('Área (km²)', 'right', { grid: { drawOnChartArea: false } }),
      },
    },
  });
}
