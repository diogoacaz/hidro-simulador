// Gráficos dos resultados de simulação (Chart.js), com linhas de referência
// dos limites e destaque das faixas violadas.

import { dataHoraLocal } from './ui.js';

const MAX_PONTOS_GRAFICO = 1200;
const graficos = new Map();

const CORES = {
  nivel: '#2563eb',
  volume: '#0891b2',
  qaf: '#0ea5e9',
  qdef: '#f59e0b',
  operacional: '#64748b',
  emergencial: '#dc2626',
  restricao: '#a855f7',
  violacao: { critico: '#dc2626', restricao: '#a855f7', atencao: '#f59e0b' },
};

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
}

function opcoesBase(titulo, tituloEixoY, pontos) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: { display: true, text: titulo, font: { size: 14, weight: '600' } },
      legend: { display: true, position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
      tooltip: {
        callbacks: {
          title: (itens) => dataHoraLocal(pontos[itens[0].dataIndex].dataHora),
        },
      },
    },
    scales: {
      x: { ticks: { maxTicksLimit: 12, autoSkip: true }, title: { display: true, text: 'Tempo' } },
      y: { title: { display: true, text: tituloEixoY } },
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
  const pontos = amostrar(serie);
  const labels = pontos.map((p) => dataHoraLocal(p.dataHora));

  const datasets = [{
    label: 'Nível (m)',
    data: pontos.map((p) => p.cota),
    borderColor: CORES.nivel,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.1,
    fill: true,
    // Destaca em vermelho/roxo/laranja os trechos em violação.
    segment: {
      borderColor: (ctx) => {
        const destino = pontos[ctx.p1DataIndex];
        return destino && destino.severidade ? CORES.violacao[destino.severidade] : CORES.nivel;
      },
    },
  }];

  const referencias = [
    ['Mín. operacional', limites.nivelMinOperacional, CORES.operacional],
    ['Máx. operacional', limites.nivelMaxOperacional, CORES.operacional],
    ['Mín. emergencial', limites.nivelMinEmergencial, CORES.emergencial],
    ['Máx. emergencial', limites.nivelMaxEmergencial, CORES.emergencial],
  ];
  for (const [label, valor, cor] of referencias) {
    if (Number.isFinite(valor)) {
      datasets.push({ ...linhaLimite(label, cor), data: pontos.map(() => valor) });
    }
  }
  for (const r of restricoes) {
    if (Number.isFinite(r.nivel)) {
      const label = `Restrição ${r.tipo === 'min' ? 'mín.' : 'máx.'}${r.motivo ? ` — ${r.motivo}` : ''}`;
      datasets.push({ ...linhaLimite(label, CORES.restricao, [3, 3]), data: pontos.map(() => r.nivel) });
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
  const pontos = amostrar(serie);
  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: pontos.map((p) => dataHoraLocal(p.dataHora)),
      datasets: [{
        label: 'Volume (hm³)',
        data: pontos.map((p) => p.volume),
        borderColor: CORES.volume,
        backgroundColor: 'rgba(8, 145, 178, 0.08)',
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
  const pontos = amostrar(serie);
  return criarGrafico(canvasId, {
    type: 'line',
    data: {
      labels: pontos.map((p) => dataHoraLocal(p.dataHora)),
      datasets: [
        {
          label: 'Afluente (m³/s)',
          data: pontos.map((p) => p.qaf),
          borderColor: CORES.qaf,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: 'Defluente (m³/s)',
          data: pontos.map((p) => p.qdef),
          borderColor: CORES.qdef,
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
  const passo = Math.max(1, Math.floor(cav.volumes.length / 400));
  const pontos = [];
  for (let i = 0; i < cav.volumes.length; i += passo) {
    pontos.push({
      cota: cav.cotaInicial + i * cav.passo,
      volume: cav.volumes[i],
      area: cav.areas[i],
    });
  }
  destruir(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const grafico = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: pontos.map((p) => p.cota.toFixed(2)),
      datasets: [
        {
          label: 'Volume (hm³)',
          data: pontos.map((p) => p.volume),
          borderColor: CORES.volume,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: 'Área (km²)',
          data: pontos.map((p) => p.area),
          borderColor: CORES.qaf,
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
      plugins: {
        title: { display: true, text: 'Curva cota × área × volume', font: { size: 14, weight: '600' } },
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12 }, title: { display: true, text: 'Cota (m)' } },
        y: { position: 'left', title: { display: true, text: 'Volume (hm³)' } },
        y2: { position: 'right', title: { display: true, text: 'Área (km²)' }, grid: { drawOnChartArea: false } },
      },
    },
  });
  graficos.set(canvasId, grafico);
  return grafico;
}
