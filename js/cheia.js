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

/**
 * Retirada possível num passo sem furar o piso de operação.
 *
 * O mínimo de emergência é limite, não referência: a retirada é reduzida
 * para o nível parar nele. O bombeamento tem prioridade sobre o vertimento,
 * porque é o vertimento que se quer evitar — se algo precisa ceder, cede o
 * que alaga.
 */
function repartirSaida(disponivelBomba, vertProgramado, volume, qaf, volumePiso) {
  const saidaMax = Math.max(0, (volume - volumePiso) / HM3_POR_M3S + qaf);
  const qb = Math.min(disponivelBomba, saidaMax);
  const qv = Math.min(vertProgramado, Math.max(0, saidaMax - qb));
  return { qb, qv, contido: qb < disponivelBomba - 1e-9 || qv < vertProgramado - 1e-9 };
}

// Simula o reservatório com um cronograma de vertimento já definido.
function simularCom(cav, hidrograma, volumeInicial, conjuntos, vertimento, volumePiso) {
  const n = hidrograma.length;
  const volumes = new Array(n + 1);
  const bombeado = new Array(n);
  const vertido = new Array(n);
  const reduzido = new Array(n);
  volumes[0] = volumeInicial;

  for (let t = 0; t < n; t++) {
    const cota = cotaDoVolume(cav, volumes[t]);
    const { qb, qv, contido } = repartirSaida(
      bombeamentoNaCota(conjuntos, cota), vertimento[t], volumes[t], hidrograma[t], volumePiso,
    );
    bombeado[t] = qb;
    vertido[t] = qv;
    reduzido[t] = contido;
    // Sem saturar no topo: é justamente a ultrapassagem que precisa ficar
    // visível, porque é ela que determina quanto verter. Saturar aqui faria
    // o excesso ser descartado em silêncio e o algoritmo concluiria que não
    // havia o que verter.
    volumes[t + 1] = volumes[t] + (hidrograma[t] - qb - qv) * HM3_POR_M3S;
  }
  return { volumes, bombeado, vertido, reduzido };
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
function requisitoSemRampa(cav, hidrograma, volumeInicial, conjuntos, volumeTeto, volumePiso, capacidadeMax) {
  const n = hidrograma.length;
  const q = new Array(n).fill(0);
  let volume = volumeInicial;
  for (let t = 0; t < n; t++) {
    const cota = cotaDoVolume(cav, volume);
    const necessario = Math.max(
      0,
      (volume - volumeTeto) / HM3_POR_M3S + hidrograma[t] - bombeamentoNaCota(conjuntos, cota),
    );
    const { qb, qv } = repartirSaida(
      bombeamentoNaCota(conjuntos, cota), Math.min(necessario, capacidadeMax),
      volume, hidrograma[t], volumePiso,
    );
    q[t] = qv;
    volume += (hidrograma[t] - qb - qv) * HM3_POR_M3S;
  }
  return q;
}

/**
 * A manobra é um degrau: a comporta varia `degrau` m³/s e fica parada por
 * `passosPorDegrau` passos de 15 min. É assim que a abertura é comandada na
 * prática — "abro 10 m³/s a cada meia hora" —, e é o tamanho do degrau, não
 * uma taxa média, que determina a onda a jusante.
 *
 * Por isso o envelope é calculado na grade grossa dos degraus: o necessário
 * de cada bloco é o maior do bloco, a antecipação recua um degrau por bloco,
 * e o resultado é expandido de volta para a grade de 15 min como patamares.
 */
function envelopeDeRampa(necessario, degrau, passosPorDegrau, capacidadeMax) {
  const n = necessario.length;
  const porBloco = Math.max(1, Math.round(passosPorDegrau));
  const nBlocos = Math.ceil(n / porBloco);

  const bloco = new Array(nBlocos).fill(0);
  for (let t = 0; t < n; t++) {
    const b = Math.floor(t / porBloco);
    bloco[b] = Math.max(bloco[b], necessario[t]);
  }

  // Antecipação: para estar em Q num bloco, é preciso já estar em Q − degrau
  // no bloco anterior.
  for (let b = nBlocos - 2; b >= 0; b--) bloco[b] = Math.max(bloco[b], bloco[b + 1] - degrau);

  // Abertura e fechamento, partindo da comporta fechada.
  let anterior = 0;
  let rampaInsuficiente = false;
  for (let b = 0; b < nBlocos; b++) {
    const pedido = bloco[b];
    bloco[b] = Math.min(Math.max(pedido, anterior - degrau), anterior + degrau);
    bloco[b] = Math.min(Math.max(bloco[b], 0), capacidadeMax);
    if (pedido > bloco[b] + 1e-9) rampaInsuficiente = true;
    anterior = bloco[b];
  }

  const envelope = new Array(n);
  for (let t = 0; t < n; t++) envelope[t] = bloco[Math.floor(t / porBloco)];
  return { envelope, rampaInsuficiente, degraus: bloco, porBloco };
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

  const degrau = Math.max(0.0001, Number(vertedouro.degrau) || 0.0001);           // m³/s por manobra
  const passosPorDegrau = Math.max(1, Math.round(Number(vertedouro.passosPorDegrau) || 1));
  const capacidadeMax = Math.max(0, Number(vertedouro.capacidadeMax) || 0);
  const limiteSemDano = Number(vertedouro.limiteSemDano);

  const { volumeMin: volumeMinCav, volumeMax: volumeMaxCav } = limitesCav(cav);
  const volumeInicial = volumeDaCota(cav, nivelInicial);
  const volumeTeto = Math.min(volumeDaCota(cav, nivelMaximo), volumeMaxCav);
  // O mínimo de emergência é piso de operação: a retirada cede para o nível
  // parar nele, em vez de atravessá-lo.
  const volumePiso = Number.isFinite(nivelMinimo)
    ? Math.max(volumeDaCota(cav, nivelMinimo), volumeMinCav)
    : volumeMinCav;

  const necessario = requisitoSemRampa(
    cav, hidrograma, volumeInicial, conjuntos, volumeTeto, volumePiso, capacidadeMax,
  );
  const { envelope: vertimento, rampaInsuficiente, degraus } =
    envelopeDeRampa(necessario, degrau, passosPorDegrau, capacidadeMax);
  const estado = simularCom(cav, hidrograma, volumeInicial, conjuntos, vertimento, volumePiso);

  return montar({
    cav, hidrograma, vertimento: estado.vertido, estado, dataInicial, necessario, rampaInsuficiente,
    nivelMaximo, nivelMinimo, limiteSemDano, capacidadeMax, degrau, passosPorDegrau, degraus, conjuntos,
  });
}

// Quantas vezes a comporta precisa ser efetivamente manobrada.
function contarManobras(degraus) {
  if (!degraus || !degraus.length) return 0;
  let n = 0;
  let anterior = 0;
  for (const v of degraus) {
    if (Math.abs(v - anterior) > 1e-9) n += 1;
    anterior = v;
  }
  return n;
}

function montar({ cav, hidrograma, vertimento, estado, dataInicial, necessario, rampaInsuficiente, nivelMaximo, nivelMinimo, limiteSemDano, capacidadeMax, degrau, passosPorDegrau, degraus, conjuntos }) {
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
      retiradaReduzida: !!estado.reduzido[i],
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
      degrau,
      passosPorDegrau,
      minutosPorDegrau: (passosPorDegrau * PASSO_SEGUNDOS) / 60,
      rampaPorPasso: degrau / passosPorDegrau,
      manobras: contarManobras(degraus),
      rampaInsuficiente,
      passosComRetiradaReduzida: estado.reduzido.filter(Boolean).length,
      seguraOPiso: Number.isFinite(nivelMinimo)
        ? Math.min(...estado.volumes) >= volumeDaCota(cav, nivelMinimo) - 1e-9
        : true,
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
