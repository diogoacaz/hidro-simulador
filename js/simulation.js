// Motor de simulação: balanço hídrico puro em passos fixos de 15 minutos.
//
//     ΔV = (Qaf - Qdef) · Δt
//
// A conversão volume ↔ cota é feita por interpolação na tabela CAV.
// Perdas (evaporação, infiltração, uso consuntivo) estão fora do escopo.

import { volumeDaCota, cotaDoVolume, areaDaCota, limitesCav } from './cav.js';


export const PASSO_SEGUNDOS = 900; // 15 min
// Fator para converter uma vazão (m³/s) mantida por um passo em volume (hm³).
const HM3_POR_M3S = PASSO_SEGUNDOS / 1e6;
const MAX_PASSOS_BUSCA = 35040; // 1 ano de passos de 15 min

export const MODOS = {
  TEMPO: 'tempo',
  QAF: 'qaf',
  NIVEL_FINAL: 'nivelFinal',
  NIVEL_INICIAL: 'nivelInicial',
  QDEF: 'qdef',
};

export const ROTULOS_MODO = {
  [MODOS.TEMPO]: 'Tempo',
  [MODOS.QAF]: 'Vazão afluente',
  [MODOS.NIVEL_FINAL]: 'Nível final',
  [MODOS.NIVEL_INICIAL]: 'Nível inicial',
  [MODOS.QDEF]: 'Vazão defluente',
};

// --- Vazões: constante ou série de 15 em 15 min ---

function vazaoNoPasso(spec, i) {
  if (!spec) return 0;
  if (spec.tipo === 'serie') {
    const serie = spec.serie || [];
    if (!serie.length) return 0;
    // Após o fim da série, mantém o último valor informado.
    return serie[Math.min(i, serie.length - 1)];
  }
  return spec.valor || 0;
}

function vazaoMedia(spec, passos) {
  if (!spec) return 0;
  if (spec.tipo !== 'serie') return spec.valor || 0;
  const serie = spec.serie || [];
  if (!serie.length) return 0;
  let soma = 0;
  for (let i = 0; i < passos; i++) soma += vazaoNoPasso(spec, i);
  return soma / passos;
}

function passosDisponiveis(spec) {
  return spec && spec.tipo === 'serie' && spec.serie ? spec.serie.length : Infinity;
}

// --- Restrições e violações ---

export function restricoesAtivas(restricoes, dataHora) {
  if (!restricoes || !restricoes.length) return [];
  const t = dataHora.getTime();
  return restricoes.filter((r) => {
    const inicio = r.inicio ? new Date(r.inicio).getTime() : -Infinity;
    const fim = r.fim ? new Date(r.fim + 'T23:59:59').getTime() : Infinity;
    return t >= inicio && t <= fim;
  });
}

// Classifica as violações de uma cota. Severidade: critico > restricao > atencao.
export function violacoesNaCota(cota, limites, restricoes) {
  const v = [];
  const tem = (x) => Number.isFinite(x);

  if (tem(limites.nivelMinEmergencial) && cota < limites.nivelMinEmergencial) {
    v.push({ severidade: 'critico', tipo: 'Emergencial mínimo', limite: limites.nivelMinEmergencial });
  }
  if (tem(limites.nivelMaxEmergencial) && cota > limites.nivelMaxEmergencial) {
    v.push({ severidade: 'critico', tipo: 'Emergencial máximo', limite: limites.nivelMaxEmergencial });
  }
  for (const r of restricoes) {
    if (r.tipo === 'min' && tem(r.nivel) && cota < r.nivel) {
      v.push({ severidade: 'restricao', tipo: `Restrição mínima (${r.motivo || 'sem motivo'})`, limite: r.nivel });
    }
    if (r.tipo === 'max' && tem(r.nivel) && cota > r.nivel) {
      v.push({ severidade: 'restricao', tipo: `Restrição máxima (${r.motivo || 'sem motivo'})`, limite: r.nivel });
    }
  }
  if (tem(limites.nivelMinOperacional) && cota < limites.nivelMinOperacional) {
    v.push({ severidade: 'atencao', tipo: 'Operacional mínimo', limite: limites.nivelMinOperacional });
  }
  if (tem(limites.nivelMaxOperacional) && cota > limites.nivelMaxOperacional) {
    v.push({ severidade: 'atencao', tipo: 'Operacional máximo', limite: limites.nivelMaxOperacional });
  }
  return v;
}

function severidadeMaxima(violacoes) {
  if (violacoes.some((v) => v.severidade === 'critico')) return 'critico';
  if (violacoes.some((v) => v.severidade === 'restricao')) return 'restricao';
  if (violacoes.some((v) => v.severidade === 'atencao')) return 'atencao';
  return null;
}

// --- Trajetória ---

/**
 * Integra o balanço hídrico a partir de um volume inicial.
 * Retorna a série completa de 15 em 15 min (inclui o instante t=0).
 */
function integrar({ cav, volumeInicial, qaf, qdef, passos, dataInicial, limites, restricoes }) {
  const serie = [];
  const { volumeMin, volumeMax, cotaMin, cotaMax } = limitesCav(cav);
  let volume = volumeInicial;
  let saiuDaCav = false;

  for (let i = 0; i <= passos; i++) {
    const dataHora = new Date(dataInicial.getTime() + i * PASSO_SEGUNDOS * 1000);
    const cota = cotaDoVolume(cav, volume);
    const ativas = restricoesAtivas(restricoes, dataHora);
    const violacoes = violacoesNaCota(cota, limites, ativas);

    // O volume inicial pode vir de fora da tabela (ex.: nível inicial reconstituído).
    if (i === 0 && (volume < volumeMin - 1e-9 || volume > volumeMax + 1e-9)) saiuDaCav = true;

    serie.push({
      passo: i,
      dataHora: dataHora.toISOString(),
      minutos: i * 15,
      qaf: i < passos ? vazaoNoPasso(qaf, i) : vazaoNoPasso(qaf, passos - 1),
      qdef: i < passos ? vazaoNoPasso(qdef, i) : vazaoNoPasso(qdef, passos - 1),
      volume,
      cota,
      area: areaDaCota(cav, cota),
      violacoes,
      severidade: severidadeMaxima(violacoes),
    });

    if (i < passos) {
      // Detecta a excursão antes de saturar: depois da saturação a informação se perde.
      const bruto = volume + (vazaoNoPasso(qaf, i) - vazaoNoPasso(qdef, i)) * HM3_POR_M3S;
      if (bruto < volumeMin - 1e-9 || bruto > volumeMax + 1e-9) saiuDaCav = true;
      volume = Math.min(Math.max(bruto, volumeMin), volumeMax);
    }
  }

  return { serie, saiuDaCav, cotaMin, cotaMax };
}

// Soma o volume acumulado (hm³) ao longo de `passos` passos.
function volumeAcumulado(qaf, qdef, passos) {
  let total = 0;
  for (let i = 0; i < passos; i++) {
    total += (vazaoNoPasso(qaf, i) - vazaoNoPasso(qdef, i)) * HM3_POR_M3S;
  }
  return total;
}

// --- Modo 1: tempo desconhecido ---

function resolverTempo(cfg) {
  const { cav, nivelInicial, nivelFinal, qaf, qdef } = cfg;
  const vAlvo = volumeDaCota(cav, nivelFinal);
  const { volumeMin, volumeMax } = limitesCav(cav);
  const maxPassos = Math.min(
    cfg.maxPassos || MAX_PASSOS_BUSCA,
    Math.max(passosDisponiveis(qaf), passosDisponiveis(qdef)) === Infinity
      ? MAX_PASSOS_BUSCA
      : Math.max(passosDisponiveis(qaf), passosDisponiveis(qdef))
  );

  let volume = volumeDaCota(cav, nivelInicial);
  const subindo = vAlvo > volume;
  let passosAteAlvo = null;
  let fracao = 0;

  for (let i = 0; i < maxPassos; i++) {
    const anterior = volume;
    volume += (vazaoNoPasso(qaf, i) - vazaoNoPasso(qdef, i)) * HM3_POR_M3S;
    volume = Math.min(Math.max(volume, volumeMin), volumeMax);

    const cruzou = subindo ? volume >= vAlvo : volume <= vAlvo;
    if (cruzou) {
      const delta = volume - anterior;
      fracao = delta === 0 ? 0 : (vAlvo - anterior) / delta;
      passosAteAlvo = i + fracao;
      break;
    }
  }

  if (passosAteAlvo === null) {
    return {
      alcancado: false,
      passos: maxPassos,
      alerta: `O nível alvo de ${nivelFinal.toFixed(2)} m não é atingido em até ${(maxPassos / 4).toFixed(0)} h com as vazões informadas.`,
    };
  }
  return { alcancado: true, passosFracionarios: passosAteAlvo, passos: Math.ceil(passosAteAlvo) };
}

// --- Entrada principal ---

/**
 * Executa a simulação resolvendo a incógnita escolhida.
 * @returns {{serie, incognita, resumo, alertas}}
 */
export function simular(cfg) {
  const {
    cav, modo, limites = {}, restricoes = [],
    dataInicial = new Date(),
  } = cfg;

  const alertas = [];
  const qaf = cfg.qaf;
  const qdef = cfg.qdef;
  let passos = cfg.passos;
  let nivelInicial = cfg.nivelInicial;
  let incognita = null;

  if (modo === MODOS.TEMPO) {
    const r = resolverTempo({ ...cfg, dataInicial });
    if (!r.alcancado) {
      alertas.push(r.alerta);
      // A busca varre até um ano, mas a trajetória exibida fica em 30 dias
      // para não gerar dezenas de milhares de pontos inúteis.
      passos = Math.min(r.passos, 2880);
    } else {
      passos = Math.max(1, r.passos);
      const minutos = r.passosFracionarios * 15;
      incognita = {
        variavel: MODOS.TEMPO,
        valor: minutos,
        unidade: 'min',
        texto: formatarDuracao(minutos),
      };
    }
  } else if (modo === MODOS.QAF) {
    const v0 = volumeDaCota(cav, cfg.nivelInicial);
    const vf = volumeDaCota(cav, cfg.nivelFinal);
    const segundos = passos * PASSO_SEGUNDOS;
    // Balanço de volume é linear nas vazões: a afluência média equivalente é exata.
    const qafEq = ((vf - v0) * 1e6) / segundos + vazaoMedia(qdef, passos);
    if (qafEq < 0) {
      alertas.push(`A afluência equivalente resultou negativa (${qafEq.toFixed(2)} m³/s): o cenário informado é fisicamente inviável.`);
    }
    incognita = { variavel: MODOS.QAF, valor: qafEq, unidade: 'm³/s', texto: `${qafEq.toFixed(2)} m³/s (constante equivalente)` };
    return montarResultado({ ...cfg, qaf: { tipo: 'constante', valor: qafEq }, passos, dataInicial }, incognita, alertas);
  } else if (modo === MODOS.QDEF) {
    const v0 = volumeDaCota(cav, cfg.nivelInicial);
    const vf = volumeDaCota(cav, cfg.nivelFinal);
    const segundos = passos * PASSO_SEGUNDOS;
    const qdefEq = vazaoMedia(qaf, passos) - ((vf - v0) * 1e6) / segundos;
    if (qdefEq < 0) {
      alertas.push(`A defluência equivalente resultou negativa (${qdefEq.toFixed(2)} m³/s): não é possível atingir o nível alvo apenas liberando água.`);
    }
    incognita = { variavel: MODOS.QDEF, valor: qdefEq, unidade: 'm³/s', texto: `${qdefEq.toFixed(2)} m³/s (constante equivalente)` };
    return montarResultado({ ...cfg, qdef: { tipo: 'constante', valor: qdefEq }, passos, dataInicial }, incognita, alertas);
  } else if (modo === MODOS.NIVEL_INICIAL) {
    const vf = volumeDaCota(cav, cfg.nivelFinal);
    const v0 = vf - volumeAcumulado(qaf, qdef, passos);
    const faixa = limitesCav(cav);
    if (v0 < faixa.volumeMin - 1e-9 || v0 > faixa.volumeMax + 1e-9) {
      alertas.push(
        `O volume inicial reconstituído (${v0.toFixed(2)} hm³) está fora da tabela CAV ` +
        `(${faixa.volumeMin.toFixed(2)} a ${faixa.volumeMax.toFixed(2)} hm³): o cenário informado não é compatível com este reservatório.`
      );
    }
    nivelInicial = cotaDoVolume(cav, v0);
    incognita = { variavel: MODOS.NIVEL_INICIAL, valor: nivelInicial, unidade: 'm', texto: `${nivelInicial.toFixed(2)} m` };
  }

  const resultado = montarResultado({ ...cfg, nivelInicial, passos, dataInicial }, incognita, alertas);

  if (modo === MODOS.NIVEL_FINAL) {
    const ultimo = resultado.serie[resultado.serie.length - 1];
    resultado.incognita = {
      variavel: MODOS.NIVEL_FINAL,
      valor: ultimo.cota,
      unidade: 'm',
      texto: `${ultimo.cota.toFixed(2)} m`,
    };
  }
  return resultado;
}

function montarResultado(cfg, incognita, alertas) {
  const { cav, limites = {}, restricoes = [], dataInicial, passos } = cfg;
  const volumeInicial = volumeDaCota(cav, cfg.nivelInicial);
  const { serie, saiuDaCav, cotaMin, cotaMax } = integrar({
    cav,
    volumeInicial,
    qaf: cfg.qaf,
    qdef: cfg.qdef,
    passos,
    dataInicial,
    limites,
    restricoes,
  });

  if (saiuDaCav) {
    alertas.push(`O nível saiu da faixa da tabela CAV (${cotaMin.toFixed(2)} m a ${cotaMax.toFixed(2)} m) e foi saturado no extremo.`);
  }

  const cotas = serie.map((s) => s.cota);
  const primeiro = serie[0];
  const ultimo = serie[serie.length - 1];
  const passosViolados = serie.filter((s) => s.violacoes.length);

  const resumo = {
    passos,
    duracaoMin: passos * 15,
    duracaoTexto: formatarDuracao(passos * 15),
    inicio: primeiro.dataHora,
    fim: ultimo.dataHora,
    cotaInicial: primeiro.cota,
    cotaFinal: ultimo.cota,
    variacaoCota: ultimo.cota - primeiro.cota,
    volumeInicial: primeiro.volume,
    volumeFinal: ultimo.volume,
    variacaoVolume: ultimo.volume - primeiro.volume,
    cotaMinima: Math.min(...cotas),
    cotaMaxima: Math.max(...cotas),
    qafMedia: media(serie.slice(0, passos).map((s) => s.qaf)),
    qdefMedia: media(serie.slice(0, passos).map((s) => s.qdef)),
    passosComViolacao: passosViolados.length,
    severidadeMaxima: severidadeMaxima(passosViolados.flatMap((s) => s.violacoes)),
    tiposViolacao: [...new Set(passosViolados.flatMap((s) => s.violacoes.map((v) => v.tipo)))],
  };

  return { serie, incognita, resumo, alertas };
}

function media(valores) {
  if (!valores.length) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

export function formatarDuracao(minutos) {
  const total = Math.round(minutos);
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const min = total % 60;
  const partes = [];
  if (dias) partes.push(`${dias} d`);
  if (horas) partes.push(`${horas} h`);
  if (min || !partes.length) partes.push(`${min} min`);
  return partes.join(' ');
}
