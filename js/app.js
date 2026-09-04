import { runSimulation, gerarSerieAleatoria, resumoSimulacao, validateParams } from './simulation.js';
import * as fb from './firebase.js';

const $ = (id) => document.getElementById(id);

const campos = [
  'nome', 'volMin', 'volMax', 'volInicial', 'cotaMin', 'cotaMax',
  'cotaJusante', 'perdas', 'engolimentoMaximo', 'potenciaInstalada',
  'rendimento', 'vazaoTurbinadaAlvo',
];
const camposNumericos = new Set(campos.filter((c) => c !== 'nome'));

let ultimaSimulacao = null; // { params, inflowSeries, resultados, resumo }
let charts = {};

function lerParams() {
  const params = {};
  for (const campo of campos) {
    const el = $(campo);
    params[campo] = camposNumericos.has(campo) ? Number(el.value) : el.value;
  }
  return params;
}

function preencherParams(params) {
  for (const campo of campos) {
    if (params[campo] !== undefined && $(campo)) {
      $(campo).value = params[campo];
    }
  }
}

function lerSerieAfluencia() {
  const texto = $('serie-afluencia').value.trim();
  if (!texto) return [];
  return texto
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map(Number)
    .filter((v) => !Number.isNaN(v));
}

function mostrarErro(msg) {
  $('erros-reservatorio').textContent = msg;
}

// --- Ações: reservatório ---

$('btn-salvar-reservatorio').addEventListener('click', async () => {
  mostrarErro('');
  const params = lerParams();
  const erros = validateParams(params);
  if (erros.length) {
    mostrarErro(erros.join(' '));
    return;
  }
  if (!fb.isConfigured()) {
    mostrarErro('Firebase não configurado — edite js/firebase-config.js (o reservatório não foi salvo, mas a simulação local funciona normalmente).');
    return;
  }
  try {
    const id = await fb.salvarReservatorio(params);
    mostrarErro('');
    await atualizarListaReservatorios();
    $('select-reservatorio').value = id;
  } catch (err) {
    mostrarErro('Erro ao salvar: ' + err.message);
  }
});

async function atualizarListaReservatorios() {
  const select = $('select-reservatorio');
  if (!fb.isConfigured()) return;
  try {
    const lista = await fb.listarReservatorios();
    select.innerHTML = '<option value="">— novo / não salvo —</option>';
    for (const r of lista) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.nome || r.id;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error(err);
  }
}

$('btn-atualizar-reservatorios').addEventListener('click', atualizarListaReservatorios);

$('select-reservatorio').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  try {
    const params = await fb.carregarReservatorio(id);
    preencherParams(params);
  } catch (err) {
    mostrarErro('Erro ao carregar: ' + err.message);
  }
});

// --- Ações: série de afluências ---

$('btn-gerar-serie').addEventListener('click', () => {
  const dias = Number($('dias-aleatorio').value) || 90;
  const base = Number($('base-aleatorio').value) || 150;
  const variacao = Number($('variacao-aleatoria').value) || 25;
  const serie = gerarSerieAleatoria(dias, base, variacao);
  $('serie-afluencia').value = serie.join('\n');
});

$('input-csv').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const valores = String(reader.result)
      .split(/\r?\n|,/)
      .map((v) => v.trim())
      .filter((v) => v && !Number.isNaN(Number(v)));
    $('serie-afluencia').value = valores.join('\n');
  };
  reader.readAsText(file);
});

// --- Ação: simular ---

$('btn-simular').addEventListener('click', () => {
  mostrarErro('');
  const params = lerParams();
  const erros = validateParams(params);
  if (erros.length) {
    mostrarErro(erros.join(' '));
    return;
  }
  const inflowSeries = lerSerieAfluencia();
  if (inflowSeries.length === 0) {
    mostrarErro('Informe ao menos um valor de vazão afluente (ou gere uma série aleatória).');
    return;
  }

  const resultados = runSimulation(params, inflowSeries);
  const resumo = resumoSimulacao(resultados);
  ultimaSimulacao = { params, inflowSeries, resultados, resumo };

  exibirResultados(resultados, resumo);
  $('painel-resultados').hidden = false;
  $('btn-salvar-simulacao').disabled = false;
});

function exibirResultados(resultados, resumo) {
  $('resumo').innerHTML = `
    <div class="cartao"><span>Energia total</span><strong>${resumo.energiaTotalMWh.toFixed(0)} MWh</strong></div>
    <div class="cartao"><span>Potência média</span><strong>${resumo.potenciaMediaMW.toFixed(2)} MW</strong></div>
    <div class="cartao"><span>Volume mín. atingido</span><strong>${resumo.volumeMinimo.toFixed(1)} hm³</strong></div>
    <div class="cartao"><span>Volume máx. atingido</span><strong>${resumo.volumeMaximo.toFixed(1)} hm³</strong></div>
    <div class="cartao"><span>Dias com vertimento</span><strong>${resumo.diasComVertimento} / ${resumo.dias}</strong></div>
    <div class="cartao"><span>Dias com déficit</span><strong>${resumo.diasComDeficit} / ${resumo.dias}</strong></div>
  `;

  const labels = resultados.map((r) => r.dia);
  desenharGrafico('grafico-volume', 'Volume (hm³)', labels, [
    { label: 'Volume', data: resultados.map((r) => r.volume), color: '#2563eb' },
  ]);
  desenharGrafico('grafico-vazoes', 'Vazões (m³/s)', labels, [
    { label: 'Afluente', data: resultados.map((r) => r.afluente), color: '#0ea5e9' },
    { label: 'Turbinada', data: resultados.map((r) => r.turbinada), color: '#16a34a' },
    { label: 'Vertida', data: resultados.map((r) => r.vertida), color: '#dc2626' },
  ]);
  desenharGrafico('grafico-potencia', 'Potência (MW)', labels, [
    { label: 'Potência', data: resultados.map((r) => r.potencia), color: '#7c3aed' },
  ]);

  const tbody = $('tabela-resultados').querySelector('tbody');
  tbody.innerHTML = resultados
    .map((r) => `<tr>
      <td>${r.dia}</td><td>${r.afluente.toFixed(1)}</td><td>${r.turbinada.toFixed(1)}</td>
      <td>${r.vertida.toFixed(1)}</td><td>${r.deficit.toFixed(1)}</td>
      <td>${r.volume.toFixed(1)}</td><td>${r.cota.toFixed(2)}</td><td>${r.potencia.toFixed(2)}</td>
    </tr>`)
    .join('');
}

function desenharGrafico(canvasId, titulo, labels, series) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const ctx = $(canvasId).getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.15,
      })),
    },
    options: {
      responsive: true,
      animation: false,
      plugins: { title: { display: true, text: titulo }, legend: { display: series.length > 1 } },
      scales: { x: { title: { display: true, text: 'Dia' } } },
    },
  });
}

// --- Ação: salvar/carregar simulação ---

$('btn-salvar-simulacao').addEventListener('click', async () => {
  if (!ultimaSimulacao) return;
  if (!fb.isConfigured()) {
    mostrarErro('Firebase não configurado — edite js/firebase-config.js para salvar simulações.');
    return;
  }
  try {
    const select = $('select-reservatorio');
    await fb.salvarSimulacao({
      reservatorioId: select.value || null,
      reservatorioNome: ultimaSimulacao.params.nome,
      params: ultimaSimulacao.params,
      inflowSeries: ultimaSimulacao.inflowSeries,
      resumo: ultimaSimulacao.resumo,
    });
    await atualizarListaSimulacoes();
    mostrarErro('');
  } catch (err) {
    mostrarErro('Erro ao salvar simulação: ' + err.message);
  }
});

async function atualizarListaSimulacoes() {
  const select = $('select-simulacao');
  if (!fb.isConfigured()) return;
  try {
    const lista = await fb.listarSimulacoes();
    select.innerHTML = '<option value="">— carregar simulação salva —</option>';
    for (const s of lista) {
      const opt = document.createElement('option');
      opt.value = s.id;
      const quando = s.criadoEm && s.criadoEm.toDate ? s.criadoEm.toDate().toLocaleString('pt-BR') : '';
      opt.textContent = `${s.reservatorioNome || 'sem nome'} — ${quando}`;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error(err);
  }
}

$('select-simulacao').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  try {
    const sim = await fb.carregarSimulacao(id);
    preencherParams(sim.params);
    $('serie-afluencia').value = sim.inflowSeries.join('\n');
    const resultados = runSimulation(sim.params, sim.inflowSeries);
    const resumo = resumoSimulacao(resultados);
    ultimaSimulacao = { params: sim.params, inflowSeries: sim.inflowSeries, resultados, resumo };
    exibirResultados(resultados, resumo);
    $('painel-resultados').hidden = false;
    $('btn-salvar-simulacao').disabled = false;
  } catch (err) {
    mostrarErro('Erro ao carregar simulação: ' + err.message);
  }
});

// --- Inicialização ---

(function init() {
  const statusEl = $('firebase-status');
  if (!fb.isConfigured()) {
    statusEl.hidden = false;
    statusEl.textContent = 'Firebase não configurado: a simulação funciona localmente, mas salvar/carregar está desativado até você preencher js/firebase-config.js (veja o README).';
  } else {
    atualizarListaReservatorios();
    atualizarListaSimulacoes();
  }
})();
