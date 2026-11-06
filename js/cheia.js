// Amortecimento de cheia em reservatório de pequena capacidade.
//
// A pergunta que este módulo responde não é "qual será o nível" — é a
// pergunta operacional: vou precisar verter, quanto, e A PARTIR DE QUE HORA
// preciso começar a abrir a comporta para não passar disso.
//
// O que torna o problema difícil não é o balanço hídrico, é a rampa. A
// comporta não pode abrir de uma vez, sob pena de onda instantânea a
// jusante. Então abrir no instante em que a água chega já é tarde: a
// abertura precisa ser ANTECIPADA, e o quanto antes depende da taxa de
// abertura admissível. É isso que o envelope de rampa calcula.
//
// Também há um acoplamento que inverte a intuição: baixar o reservatório
// antes da cheia cria volume de espera, mas abaixo do nível mínimo de
// captação a usina elevatória para de bombear — e o bombeamento costuma ser
// a maior parcela de retirada. Deplecionar demais pode piorar o vertimento.

import { volumeDaCota, cotaDoVolume, areaDaCota, limitesCav } from './cav.js';
import { PASSO_SEGUNDOS } from './simulation.js';

const HM3_POR_M3S = PASSO_SEGUNDOS / 1e6;
const ITERACOES = 14;

/**
 * Capacidade de bombeamento disponível numa dada cota.
 * Cada conjunto só bombeia acima do seu nível mínimo de captação.
 */
export function bombeamentoNaCota(conjuntos, cota) {
  let total = 0;
  for (const c of conjuntos || []) {
    const unidades = Math.max(0, Number(c.disponiveis) || 0);
    const capacidade = Math.max(0, Number(c.capacidadeUnidade) || 0);
    if (!unidades || !capacidade) continue;
    if (Number.isFinite(c.nivelMinimo) && cota < c.nivelMinimo) continue;
    total += unidades * capacidade;
  }
  return total;
}

/**
 * Hidrograma triangular: sobe de `base` até `pico` em `horasSubida` e volta
 * a `base` em `horasRecessao`. É a forma da cheia do Piraí — subida abrupta
 * e recessão de duração parecida.
 */
export function hidrogramaTriangular({ base = 0, pico, horasSubida, horasRecessao, horasAntes = 0, horasDepois = 0 }) {
  const porHora = 3600 / PASSO_SEGUNDOS;
  const antes = Math.round(horasAntes * porHora);
  const subida = Math.max(1, Math.round(horasSubida * porHora));
  const recessao = Math.max(1, Math.round(horasRecessao * porHora));
  const depois = Math.round(horasDepois * porHora);

  const serie = [];
  for (let i = 0; i < antes; i++) serie.push(base);
  for (let i = 0; i < subida; i++) serie.push(base + (pico - base) * ((i + 1) / subida));
  for (let i = 0; i < recessao; i++) serie.push(pico - (pico - base) * ((i + 1) / recessao));
  for (let i = 0; i < depois; i++) serie.push(base);
  return serie;
}

// Simula o reservatório com um cronograma de vertimento já definido.
function simularCom(cav, hidrograma, volumeInicial, conjuntos, vertimento, volumeMinCav, volumeMaxCav) {
  const n = hidrograma.length;
  const volumes = new Array(n + 1);
  const bombeado = new Array(n);
  volumes[0] = volumeInicial;

  for (let t = 0; t < n; t++) {
    const cota = cotaDoVolume(cav, volumes[t]);
    const qb = Math.min(
      bombeamentoNaCota(conjuntos, cota),
      // Não se bombeia mais água do que existe acima do fundo da CAV.
      Math.max(0, (volumes[t] - volumeMinCav) / HM3_POR_M3S + hidrograma[t]),
    );
    bombeado[t] = qb;
    // Sem saturar no topo: é justamente a ultrapassagem que precisa ficar
    // visível, porque é ela que determina quanto verter. Saturar aqui faria
    // o excesso ser descartado em silêncio e o algoritmo concluiria que não
    // havia o que verter.
    volumes[t + 1] = Math.max(volumes[t] + (hidrograma[t] - qb - vertimento[t]) * HM3_POR_M3S, volumeMinCav);
  }
  return { volumes, bombeado };
}

/**
 * Menor cronograma de vertimento que respeita a rampa da comporta.
 *
 * Em duas etapas, nenhuma delas realimentada — uma versão anterior disto
 * iterava entre "quanto falta verter" e "quanto já estou vertendo" e
 * oscilava: sem vertimento o nível estourava e o algoritmo pedia muito; com
 * aquele vertimento o nível despencava e ele zerava tudo, indefinidamente.
 *
 *  1. Roteamento sem rampa, numa passada só: a cada passo verte EXATAMENTE o
 *     que falta para o volume parar no teto. Enquanto o nível está abaixo do
 *     teto não verte nada; ao encostar, acompanha a afluência menos o
 *     bombeamento. É o vertimento mínimo se a comporta fosse instantânea.
 *
 *  2. Envelope de rampa. De trás para frente: para estar em Q no instante t,
 *     é preciso já estar em Q − rampa no instante anterior. Isso ANTECIPA a
 *     abertura, que é o ponto do problema — abrir quando a água chega é
 *     tarde. Depois, uma passada para a frente, partindo da comporta
 *     fechada, impõe a mesma gradualidade na abertura e no fechamento.
 *
 * Verter antes só abaixa o nível, então o envelope nunca estoura o teto por
 * excesso de zelo. Se a passada para a frente não conseguir acompanhar o que
 * a de trás pediu, a rampa é insuficiente para esta cheia — e isso é dito.
 */
function requisitoSemRampa(cav, hidrograma, volumeInicial, conjuntos, volumeTeto, volumeMinCav, capacidadeMax) {
  const n = hidrograma.length;
  const q = new Array(n).fill(0);
  let volume = volumeInicial;
  for (let t = 0; t < n; t++) {
    const cota = cotaDoVolume(cav, volume);
    const qb = Math.min(
      bombeamentoNaCota(conjuntos, cota),
      Math.max(0, (volume - volumeMinCav) / HM3_POR_M3S + hidrograma[t]),
    );
    const necessario = Math.max(0, (volume - volumeTeto) / HM3_POR_M3S + hidrograma[t] - qb);
    q[t] = Math.min(necessario, capacidadeMax);
    volume = Math.max(volume + (hidrograma[t] - qb - q[t]) * HM3_POR_M3S, volumeMinCav);
  }
  return q;
}

function envelopeDeRampa(necessario, rampa, capacidadeMax) {
  const n = necessario.length;
  const env = necessario.slice();
  for (let t = n - 2; t >= 0; t--) env[t] = Math.max(env[t], env[t + 1] - rampa);

  let anterior = 0;
  let rampaInsuficiente = false;
  for (let t = 0; t < n; t++) {
    const pedido = env[t];
    env[t] = Math.min(Math.max(pedido, anterior - rampa), anterior + rampa);
    env[t] = Math.min(Math.max(env[t], 0), capacidadeMax);
    if (pedido > env[t] + 1e-9) rampaInsuficiente = true;
    anterior = env[t];
  }
  return { envelope: env, rampaInsuficiente };
}

export function amortecerCheia(cfg) {
  const {
    cav,
    hidrograma,
    nivelInicial,
    nivelMaximo,
    nivelMinimo = null,
    conjuntos = [],
    vertedouro = {},
    dataInicial = new Date(),
  } = cfg;

  const rampa = Math.max(0.0001, Number(vertedouro.rampa) || 0.0001);      // m³/s por passo
  const capacidadeMax = Math.max(0, Number(vertedouro.capacidadeMax) || 0);
  const limiteSemDano = Number(vertedouro.limiteSemDano);

  const { volumeMin: volumeMinCav, volumeMax: volumeMaxCav } = limitesCav(cav);
  const volumeInicial = volumeDaCota(cav, nivelInicial);
  const volumeTeto = Math.min(volumeDaCota(cav, nivelMaximo), volumeMaxCav);

  const necessario = requisitoSemRampa(
    cav, hidrograma, volumeInicial, conjuntos, volumeTeto, volumeMinCav, capacidadeMax,
  );
  const { envelope: vertimento, rampaInsuficiente } = envelopeDeRampa(necessario, rampa, capacidadeMax);
  const estado = simularCom(cav, hidrograma, volumeInicial, conjuntos, vertimento, volumeMinCav, volumeMaxCav);

  return montar({
    cav, hidrograma, vertimento, estado, dataInicial, necessario, rampaInsuficiente,
    nivelMaximo, nivelMinimo, limiteSemDano, capacidadeMax, rampa, conjuntos,
  });
}

function montar({ cav, hidrograma, vertimento, estado, dataInicial, necessario, rampaInsuficiente, nivelMaximo, nivelMinimo, limiteSemDano, capacidadeMax, rampa, conjuntos }) {
  const n = hidrograma.length;
  const serie = [];
  for (let t = 0; t <= n; t++) {
    const volume = estado.volumes[t];
    const cota = cotaDoVolume(cav, volume);
    const i = Math.min(t, n - 1);
    serie.push({
      passo: t,
      dataHora: new Date(dataInicial.getTime() + t * PASSO_SEGUNDOS * 1000).toISOString(),
      qaf: hidrograma[i],
      qbomb: estado.bombeado[i],
      qvert: vertimento[i],
      qsaida: estado.bombeado[i] + vertimento[i],
      volume,
      cota,
      area: areaDaCota(cav, cota),
      bombeamentoDisponivel: bombeamentoNaCota(conjuntos, cota),
      // Campos que os gráficos de nível esperam; aqui não há classificação de
      // violação por limite operacional, só o teto que a cheia não pode furar.
      violacoes: [],
      severidade: null,
    });
  }

  const cotas = serie.map((s) => s.cota);
  const cotaMaxima = Math.max(...cotas);
  const picoVert = Math.max(0, ...vertimento);
  const picoIndice = vertimento.indexOf(picoVert);
  const abertura = vertimento.findIndex((v) => v > 1e-6);

  const acima = Number.isFinite(limiteSemDano)
    ? vertimento.map((v, t) => ({ v, t })).filter(({ v }) => v > limiteSemDano + 1e-9)
    : [];
  const volumeAcima = acima.reduce((s, { v }) => s + (v - limiteSemDano) * HM3_POR_M3S, 0);

  // Comparar COTAS não serve: cotaDoVolume satura no topo da tabela, então um
  // teto igual ao topo da CAV nunca apareceria como ultrapassado. A conta é
  // feita em volume, que o simulador deixa passar de propósito.
  const volumeTeto = volumeDaCota(cav, nivelMaximo);
  const volumeMaximo = Math.max(...estado.volumes);
  const estouro = volumeMaximo > volumeTeto + 1e-9;
  const naCapacidade = vertimento.some((v) => v >= capacidadeMax - 1e-9);

  return {
    serie,
    resumo: {
      passos: n,
      precisaVerter: picoVert > 1e-6,
      picoVert,
      instantePico: picoVert > 1e-6 ? serie[picoIndice].dataHora : null,
      inicioAbertura: abertura >= 0 ? serie[abertura].dataHora : null,
      horasAteAbertura: abertura >= 0 ? (abertura * PASSO_SEGUNDOS) / 3600 : null,
      dentroDoLimite: Number.isFinite(limiteSemDano) ? picoVert <= limiteSemDano + 1e-9 : null,
      limiteSemDano,
      passosAcimaDoLimite: acima.length,
      horasAcimaDoLimite: (acima.length * PASSO_SEGUNDOS) / 3600,
      volumeAcimaDoLimite: volumeAcima,
      inicioAcimaDoLimite: acima.length ? serie[acima[0].t].dataHora : null,
      cotaInicial: serie[0].cota,
      cotaMaxima,
      cotaMinima: Math.min(...cotas),
      nivelMaximo,
      nivelMinimo,
      estourouTeto: estouro,
      volumeMaximo,
      volumeTeto,
      excedenteSobreTeto: Math.max(0, volumeMaximo - volumeTeto),
      naCapacidadeMaxima: naCapacidade,
      rampa,
      rampaInsuficiente,
      picoSemRampa: Math.max(0, ...necessario),
      qafPico: Math.max(...hidrograma),
      volumeAfluente: hidrograma.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      volumeBombeado: estado.bombeado.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      volumeVertido: vertimento.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      bombeamentoMinimo: Math.min(...serie.map((s) => s.bombeamentoDisponivel)),
      bombeamentoMaximo: Math.max(...serie.map((s) => s.bombeamentoDisponivel)),
    },
  };
}

/**
 * Varre a disponibilidade de bombeamento, que é justamente o que não se sabe
 * de antemão — grade entupida, bomba em manutenção. Responde "se eu tiver N
 * bombas, qual o vertimento de pico".
 */
export function cenariosDeBombeamento(cfg, conjuntoVariavel = 0) {
  const base = cfg.conjuntos || [];
  const alvo = base[conjuntoVariavel];
  if (!alvo) return [];
  const saida = [];
  for (let d = 0; d <= alvo.unidades; d++) {
    const conjuntos = base.map((c, i) => (i === conjuntoVariavel ? { ...c, disponiveis: d } : { ...c }));
    const r = amortecerCheia({ ...cfg, conjuntos });
    saida.push({
      disponiveis: d,
      bombeamento: d * alvo.capacidadeUnidade,
      picoVert: r.resumo.picoVert,
      dentroDoLimite: r.resumo.dentroDoLimite,
      horasAcimaDoLimite: r.resumo.horasAcimaDoLimite,
      cotaMaxima: r.resumo.cotaMaxima,
      estourouTeto: r.resumo.estourouTeto,
    });
  }
  return saida;
}
