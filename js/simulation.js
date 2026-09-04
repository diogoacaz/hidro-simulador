// Motor de simulação de reservatório único de UHE.
// Modelo simplificado: curva cota-volume linear, nível de jusante fixo,
// operação com vazão turbinada alvo constante (ou "engolimento máximo").

const SEGUNDOS_POR_DIA = 86400;
const HM3_POR_M3 = 1e-6;

// Converte uma vazão (m³/s) mantida por um dia inteiro em hm³.
function vazaoParaHm3PorDia(vazaoM3s) {
  return vazaoM3s * SEGUNDOS_POR_DIA * HM3_POR_M3;
}

// Converte um volume (hm³) acumulado em um dia de volta para vazão média (m³/s).
function hm3PorDiaParaVazao(volumeHm3) {
  return volumeHm3 / (SEGUNDOS_POR_DIA * HM3_POR_M3);
}

// Interpola a cota (m) a partir do volume armazenado (hm³), assumindo
// relação linear entre (volMin, cotaMin) e (volMax, cotaMax).
function cotaDoVolume(volumeHm3, params) {
  const { volMin, volMax, cotaMin, cotaMax } = params;
  if (volMax === volMin) return cotaMin;
  const fracao = (volumeHm3 - volMin) / (volMax - volMin);
  return cotaMin + fracao * (cotaMax - cotaMin);
}

// Potência instantânea (MW) a partir da vazão turbinada e queda líquida.
function potenciaMW(vazaoTurbinadaM3s, quedaLiquidaM, rendimento) {
  if (vazaoTurbinadaM3s <= 0 || quedaLiquidaM <= 0) return 0;
  // P(MW) = rendimento * g * Q * H * rho / 1e6, com rho=1000 kg/m³, g=9.81 m/s²
  return (rendimento * 9.81 * vazaoTurbinadaM3s * quedaLiquidaM * 1000) / 1e6;
}

/**
 * Roda a simulação dia a dia.
 * @param {object} params - parâmetros do reservatório (ver validateParams).
 * @param {number[]} inflowSeries - série de vazões afluentes (m³/s), uma por dia.
 * @returns {object[]} série de resultados diários.
 */
function runSimulation(params, inflowSeries) {
  const {
    volMin, volMax, volInicial,
    cotaJusante, perdas,
    engolimentoMaximo, potenciaInstalada, rendimento,
    vazaoTurbinadaAlvo,
  } = params;

  const qturbAlvo = Math.min(
    vazaoTurbinadaAlvo != null ? vazaoTurbinadaAlvo : engolimentoMaximo,
    engolimentoMaximo
  );

  let volume = Math.min(Math.max(volInicial, volMin), volMax);
  const resultados = [];

  for (let dia = 0; dia < inflowSeries.length; dia++) {
    const qafl = inflowSeries[dia];
    let qturb = qturbAlvo;
    let qvert = 0;
    let deficit = 0;

    let volTentativo = volume + vazaoParaHm3PorDia(qafl - qturb);

    if (volTentativo > volMax) {
      const excedenteHm3 = volTentativo - volMax;
      qvert = hm3PorDiaParaVazao(excedenteHm3);
      volTentativo = volMax;
    } else if (volTentativo < volMin) {
      const faltaHm3 = volMin - volTentativo;
      const reducaoQturb = hm3PorDiaParaVazao(faltaHm3);
      qturb = qturbAlvo - reducaoQturb;
      if (qturb < 0) {
        deficit = -qturb; // vazão que não pôde ser turbinada por falta d'água
        qturb = 0;
      }
      volTentativo = volume + vazaoParaHm3PorDia(qafl - qturb);
      // Proteção numérica: garante que não fique abaixo do mínimo por arredondamento.
      volTentativo = Math.max(volTentativo, volMin);
    }

    volume = volTentativo;

    const cotaMontante = cotaDoVolume(volume, params);
    const quedaLiquida = cotaMontante - cotaJusante - perdas;
    let potencia = potenciaMW(qturb, quedaLiquida, rendimento);
    potencia = Math.min(potencia, potenciaInstalada);
    const energiaMWh = potencia * 24;

    resultados.push({
      dia: dia + 1,
      afluente: qafl,
      turbinada: qturb,
      vertida: qvert,
      defluente: qturb + qvert,
      deficit,
      volume,
      cota: cotaMontante,
      quedaLiquida,
      potencia,
      energiaMWh,
    });
  }

  return resultados;
}

// Gera uma série sintética de afluências (passeio aleatório em torno de uma base).
function gerarSerieAleatoria(dias, base, variacaoPercentual) {
  const serie = [];
  let atual = base;
  for (let i = 0; i < dias; i++) {
    const variacao = (Math.random() * 2 - 1) * (variacaoPercentual / 100) * base;
    atual = Math.max(0, atual + variacao * 0.3 + (base - atual) * 0.1);
    serie.push(Number(atual.toFixed(2)));
  }
  return serie;
}

function resumoSimulacao(resultados) {
  if (!resultados.length) return null;
  const n = resultados.length;
  const somaEnergia = resultados.reduce((s, r) => s + r.energiaMWh, 0);
  const potenciaMedia = somaEnergia / (n * 24);
  const volumes = resultados.map((r) => r.volume);
  const diasComVertimento = resultados.filter((r) => r.vertida > 0).length;
  const diasComDeficit = resultados.filter((r) => r.deficit > 0).length;
  return {
    energiaTotalMWh: somaEnergia,
    potenciaMediaMW: potenciaMedia,
    volumeMinimo: Math.min(...volumes),
    volumeMaximo: Math.max(...volumes),
    diasComVertimento,
    diasComDeficit,
    dias: n,
  };
}

function validateParams(params) {
  const erros = [];
  if (!(params.volMax > params.volMin)) {
    erros.push('Volume máximo deve ser maior que o volume mínimo.');
  }
  if (params.volInicial < params.volMin || params.volInicial > params.volMax) {
    erros.push('Volume inicial deve estar entre o volume mínimo e o máximo.');
  }
  if (!(params.cotaMax > params.cotaMin)) {
    erros.push('Cota máxima deve ser maior que a cota mínima.');
  }
  if (!(params.cotaMin > params.cotaJusante + params.perdas)) {
    erros.push('Cota mínima de montante deve ser maior que a cota de jusante + perdas.');
  }
  if (!(params.engolimentoMaximo > 0)) {
    erros.push('Engolimento máximo deve ser positivo.');
  }
  if (!(params.potenciaInstalada > 0)) {
    erros.push('Potência instalada deve ser positiva.');
  }
  if (!(params.rendimento > 0 && params.rendimento <= 1)) {
    erros.push('Rendimento deve estar entre 0 e 1.');
  }
  return erros;
}

export {
  runSimulation,
  gerarSerieAleatoria,
  resumoSimulacao,
  validateParams,
  cotaDoVolume,
  potenciaMW,
};
