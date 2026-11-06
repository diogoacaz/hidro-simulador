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

// Números que chegam ao usuário seguem o formato pt-BR, como no resto do app:
// o motor não importa a camada de interface, então traz o seu próprio.
function fmt(valor, casas = 2) {
  if (!Number.isFinite(valor)) return '—';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

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

  // Os limites de emergência viram volume uma vez só: o balanço corre em
  // volume, e é nele que a contenção precisa agir.
  const vMaxEmerg = Number.isFinite(limites.nivelMaxEmergencial)
    ? volumeDaCota(cav, limites.nivelMaxEmergencial) : null;
  const vMinEmerg = Number.isFinite(limites.nivelMinEmergencial)
    ? volumeDaCota(cav, limites.nivelMinEmergencial) : null;

  let volume = volumeInicial;
  let saiuDaCav = false;
  let contido = null;   // marcação herdada do passo anterior
  let semFolgaMin = false;

  for (let i = 0; i <= passos; i++) {
    const dataHora = new Date(dataInicial.getTime() + i * PASSO_SEGUNDOS * 1000);
    const cota = cotaDoVolume(cav, volume);
    const ativas = restricoesAtivas(restricoes, dataHora);
    const violacoes = violacoesNaCota(cota, limites, ativas);

    // Contido significa cota EXATAMENTE no limite, e violacoesNaCota compara
    // com > e <: sem esta marcação a emergência deixaria de ser sinalizada
    // justamente quando ela determina a operação.
    if (contido) violacoes.push(contido);

    // O volume inicial pode vir de fora da tabela (ex.: nível inicial reconstituído).
    if (i === 0 && (volume < volumeMin - 1e-9 || volume > volumeMax + 1e-9)) saiuDaCav = true;

    const indice = i < passos ? i : passos - 1;
    const qafPasso = vazaoNoPasso(qaf, indice);
    const qdefInformada = vazaoNoPasso(qdef, indice);
    let qdefEfetiva = qdefInformada;
    let proximo = volume;
    contido = null;

    if (i < passos) {
      let bruto = volume + (qafPasso - qdefInformada) * HM3_POR_M3S;

      if (vMaxEmerg !== null && bruto > vMaxEmerg + 1e-12) {
        // Segurar o nível no máximo emergencial exige verter o excesso.
        qdefEfetiva = qdefInformada + (bruto - vMaxEmerg) / HM3_POR_M3S;
        bruto = vMaxEmerg;
      } else if (vMinEmerg !== null && bruto < vMinEmerg - 1e-12) {
        // Segurar o nível no mínimo exige liberar menos — e não existe
        // defluência negativa. Sem folga, o nível cai mesmo assim.
        const reducao = (vMinEmerg - bruto) / HM3_POR_M3S;
        qdefEfetiva = Math.max(0, qdefInformada - reducao);
        bruto = volume + (qafPasso - qdefEfetiva) * HM3_POR_M3S;
        // Zerar a defluência é o máximo que se pode fazer. Só há queda real se
        // o nível ainda ficar abaixo do limite depois disso — o que acontece
        // quando já se partiu de baixo dele.
        if (qdefEfetiva === 0 && bruto < vMinEmerg - 1e-9) semFolgaMin = true;
      }

      // Detecta a excursão antes de saturar: depois da saturação a informação se perde.
      if (bruto < volumeMin - 1e-9 || bruto > volumeMax + 1e-9) saiuDaCav = true;
      proximo = Math.min(Math.max(bruto, volumeMin), volumeMax);

      const manobra = qdefEfetiva - qdefInformada;
      if (Math.abs(manobra) > 1e-9) {
        contido = {
          severidade: 'critico',
          limite: manobra > 0 ? limites.nivelMaxEmergencial : limites.nivelMinEmergencial,
          tipo: manobra > 0 ? 'Emergencial máximo (contido)' : 'Emergencial mínimo (contido)',
        };
      }
    }

    serie.push({
      passo: i,
      dataHora: dataHora.toISOString(),
      minutos: i * 15,
      qaf: qafPasso,
      qdef: qdefEfetiva,
      qdefInformada,
      manobra: qdefEfetiva - qdefInformada,
      volume,
      cota,
      area: areaDaCota(cav, cota),
      violacoes,
      severidade: severidadeMaxima(violacoes),
    });

    if (i < passos) volume = proximo;
  }

  return { serie, saiuDaCav, cotaMin, cotaMax, semFolgaMin };
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
      alerta: `O nível alvo de ${fmt(nivelFinal)} m não é atingido em até ${fmt(maxPassos / 4, 0)} h com as vazões informadas.`,
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
      alertas.push(`A afluência equivalente resultou negativa (${fmt(qafEq)} m³/s): o cenário informado é fisicamente inviável.`);
    }
    incognita = { variavel: MODOS.QAF, valor: qafEq, unidade: 'm³/s', texto: `${fmt(qafEq)} m³/s (constante equivalente)` };
    return montarResultado({ ...cfg, qaf: { tipo: 'constante', valor: qafEq }, passos, dataInicial }, incognita, alertas);
  } else if (modo === MODOS.QDEF) {
    const v0 = volumeDaCota(cav, cfg.nivelInicial);
    const vf = volumeDaCota(cav, cfg.nivelFinal);
    const segundos = passos * PASSO_SEGUNDOS;
    const qdefEq = vazaoMedia(qaf, passos) - ((vf - v0) * 1e6) / segundos;
    if (qdefEq < 0) {
      alertas.push(`A defluência equivalente resultou negativa (${fmt(qdefEq)} m³/s): não é possível atingir o nível alvo apenas liberando água.`);
    }
    incognita = { variavel: MODOS.QDEF, valor: qdefEq, unidade: 'm³/s', texto: `${fmt(qdefEq)} m³/s (constante equivalente)` };
    return montarResultado({ ...cfg, qdef: { tipo: 'constante', valor: qdefEq }, passos, dataInicial }, incognita, alertas);
  } else if (modo === MODOS.NIVEL_INICIAL) {
    const vf = volumeDaCota(cav, cfg.nivelFinal);
    const v0 = vf - volumeAcumulado(qaf, qdef, passos);
    const faixa = limitesCav(cav);
    if (v0 < faixa.volumeMin - 1e-9 || v0 > faixa.volumeMax + 1e-9) {
      alertas.push(
        `O volume inicial reconstituído (${fmt(v0)} hm³) está fora da tabela CAV ` +
        `(${fmt(faixa.volumeMin)} a ${fmt(faixa.volumeMax)} hm³): o cenário informado não é compatível com este reservatório.`
      );
    }
    nivelInicial = cotaDoVolume(cav, v0);
    incognita = { variavel: MODOS.NIVEL_INICIAL, valor: nivelInicial, unidade: 'm', texto: `${fmt(nivelInicial)} m` };
  }

  const resultado = montarResultado({ ...cfg, nivelInicial, passos, dataInicial }, incognita, alertas);

  if (modo === MODOS.NIVEL_FINAL) {
    const ultimo = resultado.serie[resultado.serie.length - 1];
    resultado.incognita = {
      variavel: MODOS.NIVEL_FINAL,
      valor: ultimo.cota,
      unidade: 'm',
      texto: `${fmt(ultimo.cota)} m`,
    };
  }
  return resultado;
}

function montarResultado(cfg, incognita, alertas) {
  const { cav, limites = {}, restricoes = [], dataInicial, passos } = cfg;
  const volumeInicial = volumeDaCota(cav, cfg.nivelInicial);
  const { serie, saiuDaCav, cotaMin, cotaMax, semFolgaMin } = integrar({
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
    alertas.push(`O nível saiu da faixa da tabela CAV (${fmt(cotaMin)} m a ${fmt(cotaMax)} m) e foi saturado no extremo.`);
  }

  // Contenção nos limites de emergência: o nível para no limite e a diferença
  // aparece como manobra de defluência, em vez de sumir do balanço.
  const contidos = serie.filter((s) => Math.abs(s.manobra) > 1e-9);
  const acrescimoMaxQdef = contidos.reduce((m, s) => Math.max(m, s.manobra), 0);
  const reducaoMaxQdef = contidos.reduce((m, s) => Math.max(m, -s.manobra), 0);

  if (acrescimoMaxQdef > 1e-9) {
    alertas.push(
      `O nível atingiu o máximo emergencial (${fmt(limites.nivelMaxEmergencial)} m) e foi contido ali. `
      + `Segurá-lo exige defluir até ${fmt(acrescimoMaxQdef)} m³/s acima do informado.`
    );
  }
  if (reducaoMaxQdef > 1e-9) {
    alertas.push(
      `O nível atingiu o mínimo emergencial (${fmt(limites.nivelMinEmergencial)} m) e foi contido ali. `
      + `Segurá-lo exige defluir até ${fmt(reducaoMaxQdef)} m³/s abaixo do informado.`
    );
  }
  if (semFolgaMin) {
    alertas.push(
      'Em algum passo seria preciso defluência negativa para segurar o mínimo emergencial: '
      + 'ela foi zerada e, ainda assim, o nível permaneceu abaixo do limite.'
    );
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
    qdefInformadaMedia: media(serie.slice(0, passos).map((s) => s.qdefInformada)),
    passosContidos: contidos.length,
    acrescimoMaxQdef,
    reducaoMaxQdef,
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
