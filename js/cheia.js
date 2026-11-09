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

// Crista da cheia de projeto, medida no histórico de Santana: a vazão fica
// acima de 94% do pico por cerca de duas horas, antes e depois do máximo.
// A subida arredonda nas últimas HORAS_CRISTA; depois do pico o máximo se
// sustenta por HORAS_PATAMAR antes de a recessão começar. O patamar saiu de
// varredura contra os dez maiores eventos — 0,5 h é onde o erro é mínimo.
const HORAS_CRISTA = 1.5;
const HORAS_PATAMAR = 0.5;
// Por quantos passos a retirada escolhida tem de se sustentar. Ver a regra de
// sustentação em repartirSaida.
const PASSOS_SUSTENTACAO = 4;   // 1 h
// De quantos em quantos passos uma máquina pode ser DESLIGADA. Ligar não
// espera: numa cheia a bomba entra assim que for útil.
const PASSOS_POR_DESLIGAMENTO = 4;   // 1 h

/**
 * Capacidade de bombeamento disponível numa dada cota.
 * Cada conjunto só bombeia acima do seu nível mínimo de captação.
 */
// O que cada conjunto pode retirar na cota, já em passos de máquina: as
// bombas são de velocidade fixa, então a vazão de um conjunto só assume os
// múltiplos da capacidade de uma unidade.
function conjuntosNaCota(conjuntos, cota) {
  const prontos = [];
  (conjuntos || []).forEach((c, indice) => {
    const unidades = Math.max(0, Number(c.disponiveis) || 0);
    const capacidade = Math.max(0, Number(c.capacidadeUnidade) || 0);
    if (!unidades || !capacidade) return;
    if (Number.isFinite(c.nivelMinimo) && cota < c.nivelMinimo) return;
    prontos.push({
      indice, nome: c.nome, unidades, capacidade,
      tipo: c.tipo === 'reversao' ? 'reversao' : 'bombeamento',
    });
  });
  return prontos;
}

export function bombeamentoNaCota(conjuntos, cota) {
  return conjuntosNaCota(conjuntos, cota).reduce((t, c) => t + c.unidades * c.capacidade, 0);
}

/**
 * A maior retirada possível sem passar de `limite`.
 *
 * As bombas de Vigário e a elevatória de Santa Cecília não têm ajuste de
 * vazão: ligada, a máquina entrega a capacidade dela inteira. Então a
 * retirada não é um número contínuo que se corta no limite — é uma soma de
 * máquinas ligadas, e reduzir significa DESLIGAR uma. Perto do piso de
 * emergência isso muda o resultado: com 3 m³/s afluentes não se bombeia
 * 3 m³/s, bombeia-se zero, porque a menor máquina já tira 30.
 *
 * Os conjuntos são poucos e pequenos (4 unidades e 1), então vale enumerar:
 * é exato, e não há heurística para explicar depois.
 */
function retiradaPossivel(conjuntos, cota, limite, minimos = null) {
  const prontos = conjuntosNaCota(conjuntos, cota);
  const piso = prontos.map((c) => Math.min(c.unidades, minimos ? minimos[c.indice] || 0 : 0));
  let melhor = null;
  const buscar = (i, total, ligadas) => {
    if (i === prontos.length) {
      if (!melhor || total > melhor.total + 1e-9) melhor = { total, ligadas: [...ligadas] };
      return;
    }
    const c = prontos[i];
    for (let n = c.unidades; n >= piso[i]; n--) {
      const soma = total + n * c.capacidade;
      if (soma > limite + 1e-9) continue;
      ligadas[i] = n;
      buscar(i + 1, soma, ligadas);
    }
    ligadas[i] = piso[i];
  };
  buscar(0, 0, prontos.map(() => 0));
  if (!melhor) return null;   // nem o mínimo pedido cabe

  let bombeamento = 0;
  let reversao = 0;
  const unidades = (conjuntos || []).map(() => 0);
  prontos.forEach((c, i) => {
    unidades[c.indice] = melhor.ligadas[i];
    const q = melhor.ligadas[i] * c.capacidade;
    if (c.tipo === 'reversao') reversao += q; else bombeamento += q;
  });
  return { total: melhor.total, bombeamento, reversao, unidades };
}

/**
 * Hidrograma de projeto na forma que a cheia do Piraí realmente tem.
 *
 * A forma saiu de 478 dias de afluência de 15 em 15 min a Santana
 * (dez/2021 a abr/2023, 16 eventos acima de 80 m³/s), ajustando candidatas
 * aos dez maiores por mínimos quadrados.
 *
 * SUBIDA — reta no corpo, com a crista arredondada. Chegamos a usar uma
 * curva em S, por leitura apressada de um evento só; medindo os dez maiores
 * com o mesmo critério de início, a forma varia muito (três quase retas,
 * quatro côncavas, duas convexas) e a reta é a que menos erra na média
 * ponderada pelo pico. O parâmetro que importa é a DURAÇÃO, não a curvatura.
 *
 * Mas a reta chega ao pico com inclinação cheia e encontra a recessão num
 * canto — um bico que não existe no dado. A vazão real se sustenta perto do
 * máximo por uma a duas horas: no evento de 656 m³/s ainda estava em 99% uma
 * hora depois do pico e 94% duas horas depois. Por isso a última hora e meia
 * da subida vira uma parábola que chega ao pico com inclinação zero, colada
 * à reta em valor e inclinação. O custo no ajuste global é de 3%, e o topo
 * melhora bastante: a 80% do tempo de subida a reta dava 0,80 contra 0,91
 * medido, e com a crista dá 0,87.
 *
 * A recessão já saía do pico com inclinação zero, porque o expoente é maior
 * que 1 — então agora as duas se encontram suaves. Do lado da descida o
 * máximo ainda se sustenta meia hora antes de a recessão começar, que é
 * onde o erro contra os dez maiores eventos fica mínimo.
 *
 * RECESSÃO — exponencial de expoente ajustável:
 *
 *     q(t) = base + (pico − base) · exp(−(t/k)^p)
 *
 * A exponencial pura (p = 1) erra de dois jeitos ao mesmo tempo: desce cedo
 * demais logo após o pico, onde a vazão real ainda se sustenta por uma ou
 * duas horas, e sustenta cauda demais entre 8 e 32 h, onde a real já caiu.
 * Com p > 1 a crista fica achatada e a queda, mais íngreme — 71% menos erro
 * contra a forma média medida.
 *
 * O expoente não é um número mágico: sai dos dois tempos que se leem num
 * hidrograma real, a meia-vida e o tempo até 10% do pico. A razão entre eles
 * determina p — numa exponencial pura seria sempre ln10/ln2 = 3,32, e nos
 * eventos de Santana a mediana é 2,52, daí p ≈ 1,3. Eventos de cauda gorda
 * (razão 5,1) e de corte abrupto (1,25) também aparecem, e ficam
 * representáveis pelos mesmos dois campos.
 *
 * Medianas medidas, que são os padrões da tela: subida 9 h, t½ 7 h,
 * t10% 17 h.
 */
export function hidrogramaCheia({
  base = 0, pico, horasSubida, horasMeiaRecessao, horasDecimoRecessao,
  horasAntes = 0, horasDepois = 0,
}) {
  const porHora = 3600 / PASSO_SEGUNDOS;
  const antes = Math.round(horasAntes * porHora);
  const subida = Math.max(1, Math.round(horasSubida * porHora));
  const depois = Math.max(1, Math.round(horasDepois * porHora));

  const t50 = Math.max(1e-6, Number(horasMeiaRecessao) || 1);
  const t10 = Number(horasDecimoRecessao);
  // Sem o segundo tempo, ou com um valor incoerente, cai na exponencial pura.
  const expoente = Number.isFinite(t10) && t10 > t50 * 1.02
    ? Math.log(Math.log(10) / Math.log(2)) / Math.log(t10 / t50)
    : 1;
  const k = (t50 * porHora) / Math.log(2) ** (1 / expoente);

  // Crista: fração da subida ocupada pela parábola de topo. Fixa em tempo
  // (1,5 h), não em proporção, porque é isso que o dado mostra — o patamar
  // perto do pico dura o mesmo tanto, suba a cheia em 5 h ou em 30 h.
  const w = Math.min(0.5, (HORAS_CRISTA * porHora) / subida);
  const escala = 1 / (1 - w / 2);

  const serie = [];
  for (let i = 0; i < antes; i++) serie.push(base);
  for (let i = 1; i <= subida; i++) {
    const u = i / subida;
    const forma = u <= 1 - w
      ? escala * u
      : 1 - (escala / (2 * w)) * (1 - u) ** 2;
    serie.push(base + (pico - base) * forma);
  }
  const patamar = Math.round(HORAS_PATAMAR * porHora);
  for (let i = 0; i < patamar; i++) serie.push(pico);
  for (let i = 1; i <= depois - patamar; i++) {
    serie.push(base + (pico - base) * Math.exp(-((i / k) ** expoente)));
  }
  return serie;
}

/** Forma antiga, simétrica. Mantida para comparação. */
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
/**
 * Quanto a comporta pode verter nesta cota, pelos gatilhos de nível.
 *
 * Verter é decisão política, não só hidráulica: abaixo do primeiro gatilho
 * não se abre; entre ele e o segundo só se verte o que não alaga; acima do
 * segundo, libera-se o que for preciso. A ferramenta respeita a regra e
 * mostra se respeitá-la ainda segura o reservatório.
 */
function portaoVertimento(cota, portoes, limiteSemDano, capacidadeMax) {
  const { inicio, liberaAcima } = portoes || {};
  if (Number.isFinite(liberaAcima) && cota >= liberaAcima) return capacidadeMax;
  if (Number.isFinite(inicio) && cota < inicio) return 0;
  if (Number.isFinite(liberaAcima) && Number.isFinite(limiteSemDano)) return limiteSemDano;
  return capacidadeMax;
}

// Reparte a saída de um passo entre bombeamento e vertimento, respeitando os
// dois níveis de emergência.
//
// No PISO a retirada cede: não se tira mais do que a água que existe acima
// dele. No TETO acontece o contrário e não é escolha de ninguém — com o
// reservatório no máximo não há mais onde guardar, e a defluência iguala a
// afluência no mesmo passo. A comporta deixa de ser o que limita: o que a
// rampa não tiver aberto até ali passa assim mesmo, e esse excedente é
// devolvido em `forcado` para que a tela não o confunda com manobra.
// A melhor configuração que não desliga nada do que já está rodando.
function retirada0(conjuntos, cota, limite, previa) {
  return retiradaPossivel(conjuntos, cota, limite, previa ? previa.unidades : null);
}

function repartirSaida({
  conjuntos, cota, vertProgramado, volume, qaf,
  volumePiso, volumeTeto, capacidadeMax, retiradaPrevia = null, podeDesligar = true,
}) {
  const saidaMax = Math.max(0, (volume - volumePiso) / HM3_POR_M3S + qaf);
  const disponivelBomba = bombeamentoNaCota(conjuntos, cota);
  // Regra de sustentação. Não basta a combinação caber NESTE passo: ela tem
  // de se sustentar por PASSOS_SUSTENTACAO. Sem isso a máquina de velocidade
  // fixa vira pulso — com o reservatório no mínimo e 3 m³/s afluentes, ligava
  // no máximo que cabia num passo, esvaziava o que havia acumulado e
  // desligava, repetidamente. Ninguém parte uma bomba de 50 m³/s assim.
  //
  // Na cheia a regra não aperta nada: com 600 m³/s afluentes e o nível alto,
  // o limite passa de qualquer combinação e tudo o que há roda.
  const sustentavel = Math.max(0, qaf + (volume - volumePiso) / (HM3_POR_M3S * PASSOS_SUSTENTACAO));

  // Ligar é imediato; desligar espera a grade. A assimetria é o que mata o
  // liga-desliga sem atrasar a resposta à cheia: a elevatória de 30 m³/s
  // entrava e saía a cada passo só porque o limite sustentável cruzava o
  // degrau dela para um lado e para o outro. Mantida ligada por uma hora, ela
  // atravessa a oscilação. E como o vertimento nunca precisa esperar uma
  // máquina que podia ter ligado, a ordem dos recursos continua garantida.
  const teto = Math.min(saidaMax, sustentavel);
  // Subir mantendo o que já roda: parar a elevatória de 30 para ligar mais
  // uma bomba de 50 aumenta o total no papel, mas não é manobra que alguém
  // faça. Só na grade de desligamento o conjunto pode ser rearranjado.
  const subindo = retirada0(conjuntos, cota, teto, retiradaPrevia);
  let retirada = retiradaPrevia;
  if (!retirada || (subindo && subindo.total > retirada.total + 1e-9)) {
    retirada = subindo || retiradaPossivel(conjuntos, cota, teto);
  } else if (retirada.total > saidaMax + 1e-9) {
    // O piso de emergência não espera grade nenhuma.
    retirada = retiradaPossivel(conjuntos, cota, saidaMax);
  } else if (podeDesligar) {
    const melhor = retiradaPossivel(conjuntos, cota, teto);
    if (melhor && melhor.total < retirada.total - 1e-9) retirada = melhor;
  }
  const qb = retirada.total;
  let qv = Math.min(vertProgramado, Math.max(0, saidaMax - qb));
  const contido = qb < disponivelBomba - 1e-9 || qv < vertProgramado - 1e-9;

  let forcado = 0;
  if (Number.isFinite(volumeTeto)) {
    const saidaMin = (volume - volumeTeto) / HM3_POR_M3S + qaf;
    const alvo = Math.min(Math.max(saidaMin - qb, 0), saidaMax, capacidadeMax);
    if (alvo > qv + 1e-9) {
      forcado = alvo - qv;
      qv = alvo;
    }
  }
  // O vertimento é o último recurso: nenhuma máquina que pudesse ter sido
  // ligada neste passo, pelas regras de operação, ficou parada enquanto a
  // comporta passava água. Registrado aqui, onde as regras estão, e não
  // recalculado depois contra uma combinação ideal que a operação não faria.
  const maquinaOciosa = qv > 1e-9 && !!subindo && subindo.total > qb + 1e-9;
  return {
    qb, qv, contido, forcado, retirada, maquinaOciosa,
    bombeamento: retirada.bombeamento, reversao: retirada.reversao,
  };
}

// Simula o reservatório com um cronograma de vertimento já definido.
function simularCom(cav, hidrograma, volumeInicial, conjuntos, vertimento, volumePiso, volumeTeto, capacidadeMax, manobra = null) {
  const n = hidrograma.length;
  const volumes = new Array(n + 1);
  const bombeado = new Array(n);
  const revertido = new Array(n);
  const vertido = new Array(n);
  const comandado = new Array(n);
  const reduzido = new Array(n);
  const forcado = new Array(n).fill(0);
  const barrado = new Array(n).fill(false);
  const ociosa = new Array(n).fill(false);
  volumes[0] = volumeInicial;

  const porBloco = Math.max(1, manobra?.porBloco || 1);
  const degrau = manobra?.degrau || Infinity;
  let alvoAtual = 0;
  let retiradaPrevia = null;
  // Depois do pico a comporta fecha acompanhando a recessão, e para isso
  // precisa saber onde o pico está.
  let passoPico = 0;
  for (let t = 1; t < n; t++) if (hidrograma[t] > hidrograma[passoPico]) passoPico = t;

  for (let t = 0; t < n; t++) {
    const cota = cotaDoVolume(cav, volumes[t]);

    // O comando da comporta só muda na grade da manobra, e nunca mais que um
    // degrau de cada vez — inclusive quando um gatilho de nível acaba de
    // liberar uma abertura maior.
    if (manobra) {
      if (t % porBloco === 0) {
        const permitido = portaoVertimento(cota, manobra.portoes, manobra.limiteSemDano, manobra.capacidadeMax);
        // Nem se comanda uma abertura que o reservatório não tem como
        // sustentar: com o nível no piso e o bombeamento já levando tudo, não
        // sobra água para verter. Sem este corte a antecipação mandava abrir
        // a comporta antes da cheia, com o reservatório deplecionado.
        const saidaMax = Math.max(0, (volumes[t] - volumePiso) / HM3_POR_M3S + hidrograma[t]);
        const bruta = Math.max(0, saidaMax - Math.min(bombeamentoNaCota(conjuntos, cota), saidaMax));
        // Arredondada para baixo no degrau: a folga é contínua e, entrando
        // crua, tirava o comando da grade de manobra.
        const folga = Number.isFinite(degrau) ? Math.floor(bruta / degrau + 1e-9) * degrau : bruta;

        // A folga manda ABRIR com cautela, não FECHAR. Ela existe para não
        // mandar abrir a comporta antes da cheia, com o reservatório
        // deplecionado — mas ela oscila com o nível e com as bombas, e
        // enquanto também governava a descida produzia abre-fecha-abre: a
        // comporta ia a 30 m³/s, o piso cortava a água por um passo, o
        // comando caía a zero e subia de novo meia hora depois. Ninguém
        // fecha e reabre uma comporta no meio da subida de uma cheia.
        //
        // Fechar passa a depender só do plano e dos gatilhos de nível. Se
        // faltar água, a comporta fica aberta e passa o que houver — que é
        // o que uma comporta faz.
        let paraSubir = Math.min(vertimento[t], permitido, folga);
        let paraDescer = Math.min(vertimento[t], permitido);
        let fechaDireto = false;

        // Passado o pico, a comporta fecha para MANTER O NÍVEL, não para
        // baixar o reservatório. O envelope desce um degrau por bloco — 20
        // m³/s por hora com o degrau padrão — e a cheia recua umas duas
        // vezes mais rápido que isso. A comporta não acompanhava e seguia
        // vertendo o que as bombas já davam conta de tirar: só para esvaziar
        // o lago, e acima do limite que alaga. Quem recupera o volume de
        // espera é o bombeamento, que não machuca ninguém a jusante.
        //
        // Por isso o limite de um degrau vale para ABRIR, que é onde está o
        // risco da onda a jusante. Fechar segue o balanço: o alvo é o que
        // falta escoar além da retirada, arredondado para cima no degrau.
        if (t >= passoPico) {
          const retiradaAgora = retiradaPrevia ? retiradaPrevia.total : 0;
          const manterNivel = Math.max(0, hidrograma[t] - retiradaAgora);
          const alvoFecho = Number.isFinite(degrau)
            ? Math.ceil(manterNivel / degrau - 1e-9) * degrau : manterNivel;
          if (alvoFecho < paraDescer) { paraDescer = alvoFecho; fechaDireto = true; }
          // O teto também vale para a abertura: sem ele o envelope, que
          // desce devagar, reabria a comporta no passo seguinte e o comando
          // virava serra — fechava de 250 para 180 e voltava a 190, 200, 210.
          // Não é um alvo, é um limite: enquanto a rampa pedir menos que
          // isso, ela continua mandando, e a subida segue presa ao degrau.
          paraSubir = Math.min(paraSubir, alvoFecho);
        }

        if (paraSubir > alvoAtual) alvoAtual = Math.min(paraSubir, alvoAtual + degrau);
        else if (paraDescer < alvoAtual) {
          alvoAtual = fechaDireto ? paraDescer : Math.max(paraDescer, alvoAtual - degrau);
        }
        barrado[t] = vertimento[t] > permitido + 1e-9;
      }
    } else {
      alvoAtual = vertimento[t];
    }
    const r = repartirSaida({
      conjuntos, cota, vertProgramado: alvoAtual, volume: volumes[t], qaf: hidrograma[t],
      volumePiso, volumeTeto, capacidadeMax,
      retiradaPrevia, podeDesligar: t % PASSOS_POR_DESLIGAMENTO === 0,
    });
    retiradaPrevia = r.retirada;
    ociosa[t] = r.maquinaOciosa;
    bombeado[t] = r.bombeamento;
    revertido[t] = r.reversao;
    vertido[t] = r.qv;
    reduzido[t] = r.contido;
    forcado[t] = r.forcado;
    // Com o nível no teto o operador não tem escolha: ele comanda na comporta
    // o que for preciso para igualar a afluência, fora da grade e fora do
    // degrau. O comando acompanha — se ficasse para trás, o cronograma
    // mandaria abrir 5 m³/s enquanto a barragem precisa de 350.
    if (r.forcado > 1e-9) alvoAtual = r.qv;
    comandado[t] = alvoAtual;
    // O nível só passa do teto quando nem o vertedouro inteiro dá conta: aí
    // a ultrapassagem é real e precisa aparecer, não ser saturada em
    // silêncio.
    volumes[t + 1] = volumes[t] + (hidrograma[t] - r.qb - r.qv) * HM3_POR_M3S;
  }
  return { volumes, bombeado, revertido, vertido, comandado, reduzido, barrado, forcado, ociosa };
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
  let retiradaPrevia = null;
  for (let t = 0; t < n; t++) {
    const cota = cotaDoVolume(cav, volume);
    const necessario = Math.max(
      0,
      (volume - volumeTeto) / HM3_POR_M3S + hidrograma[t] - bombeamentoNaCota(conjuntos, cota),
    );
    const { qb, qv, retirada } = repartirSaida({
      conjuntos, cota, vertProgramado: Math.min(necessario, capacidadeMax),
      volume, qaf: hidrograma[t], volumePiso, volumeTeto, capacidadeMax,
      retiradaPrevia, podeDesligar: t % PASSOS_POR_DESLIGAMENTO === 0,
    });
    retiradaPrevia = retirada;
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

  // Aberturas em múltiplos do degrau: ninguém comanda uma comporta em
  // 9,69 m³/s. Arredondar para cima é o lado seguro (verte um pouco mais,
  // nível um pouco mais baixo) e preserva a restrição — valores brutos que
  // diferem no máximo de um degrau continuam assim depois de quantizados.
  for (let b = 0; b < nBlocos; b++) {
    bloco[b] = Math.min(Math.ceil(bloco[b] / degrau - 1e-9) * degrau, capacidadeMax);
  }

  const envelope = new Array(n);
  for (let t = 0; t < n; t++) envelope[t] = bloco[Math.floor(t / porBloco)];
  return { envelope, rampaInsuficiente, degraus: bloco, porBloco };
}

/**
 * O mesmo amortecimento rodado três vezes: com a afluência prevista e com
 * ela errada para mais e para menos.
 *
 * A previsão de afluência é a maior incerteza do problema, e um número único
 * esconde isso. Com os limites, cada ponto da série ganha um mínimo e um
 * máximo — que não são o caso alto e o caso baixo ponto a ponto, mas o
 * envelope dos três: com mais água entrando o nível sobe mais, mas o
 * vertimento também começa antes, e nem sempre o extremo de uma grandeza
 * vem do extremo da outra.
 *
 * O resultado principal continua sendo o central. Os limites acompanham.
 */
export function amortecerCheia(cfg) {
  const central = amortecerUm(cfg);
  const c = cfg.confianca;
  if (!c || !c.ativo) return central;

  const p = Math.min(0.9, Math.max(0, Number(c.percentual) || 0) / 100);
  if (!p) return central;

  const escalar = (f) => cfg.hidrograma.map((q) => q * f);
  const alta = amortecerUm({ ...cfg, hidrograma: escalar(1 + p) });
  const baixa = amortecerUm({ ...cfg, hidrograma: escalar(1 - p) });

  for (const campo of ['cota', 'qaf', 'qvert']) {
    central.serie.forEach((ponto, t) => {
      const vs = [ponto[campo], alta.serie[t][campo], baixa.serie[t][campo]];
      ponto[`${campo}Min`] = Math.min(...vs);
      ponto[`${campo}Max`] = Math.max(...vs);
    });
  }

  // O envelope inclui o caso central. Nem toda grandeza é monótona na
  // afluência: com a cheia maior a comporta abre antes e o tempo acima do
  // limite pode ficar MENOR que no caso previsto. Sem o central dentro, a
  // faixa mostrada excluía o número que estava logo acima dela.
  const envelope = (campo) => {
    const vs = [central.resumo[campo], baixa.resumo[campo], alta.resumo[campo]]
      .filter((v) => Number.isFinite(v));
    return vs.length ? [Math.min(...vs), Math.max(...vs)] : null;
  };

  central.resumo.limites = {
    percentual: p * 100,
    picoVert: envelope('picoVert'),
    cotaMaxima: envelope('cotaMaxima'),
    volumeVertido: envelope('volumeVertido'),
    horasAcimaDoLimite: envelope('horasAcimaDoLimite'),
    estourouTeto: alta.resumo.estourouTeto,
    passosForcados: alta.resumo.passosForcados,
    saltoNoTeto: alta.resumo.saltoNoTeto,
  };
  return central;
}

/**
 * A outra proposta: o menor patamar constante de vertimento que segura o
 * nível abaixo do teto, guardada uma reserva.
 *
 * A política padrão do app é de último recurso — não verte nada enquanto o
 * nível estiver abaixo do teto e, ao encostar, acompanha a afluência. Ela
 * minimiza o VOLUME vertido e adia a abertura, mas por isso mesmo é a que
 * produz o MAIOR pico: guarda a água até o fim e solta tudo de uma vez.
 *
 * Esta aqui faz o contrário: abre cedo, baixo e constante, usando o
 * reservatório para achatar a onda. É a solução minimax clássica do
 * roteamento de cheia — o menor pico possível é um patamar, não uma ponta.
 * Na cheia de projeto de Santana, 155 m³/s contra os 250 da política
 * padrão, com as mesmas horas de alagamento.
 *
 * A reserva abaixo do teto é o que torna isso operável: o patamar mínimo
 * absoluto gasta o reservatório inteiro e, se a afluência vier acima do
 * previsto, não sobra nada — o plano de 115 m³/s vira 429 m³/s com 15% mais
 * água. Cada centímetro guardado custa pico e compra robustez.
 *
 * A busca é força bruta sobre os múltiplos do degrau: são poucas dezenas de
 * candidatos, o resultado é exato e não há heurística para justificar.
 */
export function propostaDePatamar(cfg, reservaM = 0.1) {
  const { cav, hidrograma, nivelMaximo, vertedouro = {} } = cfg;
  const degrau = Math.max(0.0001, Number(vertedouro.degrau) || 0.0001);
  const capacidadeMax = Math.max(0, Number(vertedouro.capacidadeMax) || 0);
  const reserva = Math.max(0, Number(reservaM) || 0);
  const limiteCota = nivelMaximo - reserva;

  // Entre os candidatos que cabem, o de menor pico; empate, o que alaga menos
  // tempo. Três níveis de exigência, do melhor para o aceitável: com a
  // reserva pedida, sem ela, e — se nem o teto se segura — o que menos o
  // ultrapassa. Sem essa escada, uma cheia em que a reserva não coubesse caía
  // direto no critério de menor cota, que ignora o pico e podia devolver uma
  // proposta PIOR que a de último recurso.
  const melhorQue = (a, b) => !a
    || b.resumo.picoVert < a.resumo.picoVert - 1e-9
    || (Math.abs(b.resumo.picoVert - a.resumo.picoVert) < 1e-9
      && b.resumo.horasAcimaDoLimite < a.resumo.horasAcimaDoLimite);

  let comReserva = null;
  let semReserva = null;
  let menorCota = null;
  const passos = Math.min(400, Math.ceil(capacidadeMax / degrau));
  for (let k = 0; k <= passos; k++) {
    const patamar = Math.min(k * degrau, capacidadeMax);
    const r = amortecerUm({ ...cfg, patamarFixo: patamar, confianca: null });
    r.resumo.patamar = patamar;
    if (!menorCota || r.resumo.cotaMaxima < menorCota.resumo.cotaMaxima) menorCota = r;
    if (!r.resumo.estourouTeto && melhorQue(semReserva, r)) semReserva = r;
    if (r.resumo.cotaMaxima <= limiteCota + 1e-9 && melhorQue(comReserva, r)) comReserva = r;
  }

  const alcancou = !!comReserva;
  const base = comReserva || semReserva || menorCota;
  if (!base) return null;

  // Refeita com os limites de confiança do usuário, se houver: mesmo plano de
  // comporta, afluência variando. A busca roda sem eles para não triplicar.
  const r = amortecerCheia({ ...cfg, patamarFixo: base.resumo.patamar });
  r.resumo.patamar = base.resumo.patamar;
  r.resumo.reserva = reserva;
  r.resumo.limiteCota = limiteCota;
  r.resumo.reservaAlcancada = alcancou;
  return r;
}

function amortecerUm(cfg) {
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

  // Com patamarFixo o cronograma não vem do envelope: é o patamar pedido,
  // que simularCom alcança no degrau configurado.
  const patamarFixo = Number(cfg.patamarFixo);
  const necessario = requisitoSemRampa(
    cav, hidrograma, volumeInicial, conjuntos, volumeTeto, volumePiso, capacidadeMax,
  );
  const { envelope, rampaInsuficiente } =
    envelopeDeRampa(necessario, degrau, passosPorDegrau, capacidadeMax);
  const vertimento = Number.isFinite(patamarFixo)
    ? hidrograma.map(() => patamarFixo)
    : envelope;

  // O envelope é o ideal hidráulico. Os gatilhos de nível são a regra de
  // operação, e é na simulação que ela se impõe — inclusive impedindo a
  // antecipação da abertura, se o nível ainda não autorizar.
  const manobra = {
    degrau, porBloco: passosPorDegrau, limiteSemDano, capacidadeMax,
    portoes: vertedouro.portoes || {},
  };
  const estado = simularCom(
    cav, hidrograma, volumeInicial, conjuntos, vertimento,
    volumePiso, volumeTeto, capacidadeMax, manobra,
  );

  return montar({
    cav, hidrograma, vertimento: estado.vertido, programado: estado.comandado, estado, dataInicial,
    necessario, rampaInsuficiente: Number.isFinite(patamarFixo) ? false : rampaInsuficiente,
    portoes: manobra.portoes,
    nivelMaximo, nivelMinimo, limiteSemDano, capacidadeMax, degrau, passosPorDegrau, conjuntos,
  });
}

/**
 * Os instantes em que a comporta se move, que são o cronograma do operador.
 *
 * Normalmente a comporta só se mexe na grade da manobra — de `passo` em
 * `passo` passos de 15 min. Mas com o nível no teto a regra do degrau cai:
 * ali a abertura tem de acompanhar a afluência a cada passo, e cada ajuste é
 * uma manobra que alguém executa. Por isso a varredura é passo a passo e a
 * grade só filtra o que NÃO é forçado.
 *
 * Uma função só, usada pela contagem e pela tabela, para as duas nunca mais
 * divergirem.
 */
function instantesDeManobra(programado, forcado, passosPorDegrau) {
  const passo = Math.max(1, passosPorDegrau);
  const fora = [];
  let anterior = 0;
  for (let t = 0; t < programado.length; t++) {
    const imposta = forcado ? forcado[t] > 1e-9 : false;
    if (!imposta && t % passo !== 0) continue;
    if (Math.abs(programado[t] - anterior) <= 1e-9) { anterior = programado[t]; continue; }
    fora.push({ t, abertura: programado[t], variacao: programado[t] - anterior, imposta });
    anterior = programado[t];
  }
  return fora;
}

function montar({ cav, hidrograma, vertimento, programado, estado, dataInicial, necessario, rampaInsuficiente, portoes, nivelMaximo, nivelMinimo, limiteSemDano, capacidadeMax, degrau, passosPorDegrau, conjuntos }) {
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
      // Vigário bombeia; Santa Cecília reverte para o Paraíba. As duas são
      // defluência de Santana, mas são operações distintas e aparecem
      // separadas em toda a tela.
      qbomb: estado.bombeado[i],
      qrev: estado.revertido[i],
      qretirada: estado.bombeado[i] + estado.revertido[i],
      qvert: vertimento[i],
      // O valor comandado na comporta. O efetivo pode ficar abaixo dele
      // quando o piso de emergência corta a retirada — é o programado que
      // vai para o cronograma, porque é o que o operador executa.
      qvertProgramado: programado[i],
      // A parte do vertimento que o teto impôs, acima do que a comporta
      // comandada entregava.
      qvertForcado: estado.forcado[i],
      qsaida: estado.bombeado[i] + estado.revertido[i] + vertimento[i],
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

  // Ordem dos recursos: o vertimento é o último a entrar. A marcação vem da
  // própria simulação, passo a passo — ver maquinaOciosa em repartirSaida.
  const bombeamentoNoMaximoAoVerter = !estado.ociosa.some(Boolean);

  // A comporta abre antes de a afluência superar o bombeamento — não porque
  // sobre bomba, mas porque o degrau de manobra exige antecedência. Medir
  // essa folga explica a hora de abertura, que de outro modo parece cedo
  // demais.
  const instanteExcesso = serie.findIndex((s) => s.qaf > s.bombeamentoDisponivel + 1e-9);
  const instanteAbertura = serie.findIndex((s) => s.qvert > 1e-9);
  const antecedenciaMin = instanteAbertura >= 0 && instanteExcesso >= 0
    ? ((instanteExcesso - instanteAbertura) * PASSO_SEGUNDOS) / 60
    : null;

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
  // Com a defluência igualando a afluência no teto, o nível só o ultrapassa
  // se nem o vertedouro inteiro der conta. Quando isso acontece é falta de
  // capacidade, não de manobra.
  const estouro = volumeMaximo > volumeTeto + 1e-9;

  // Vertimento forçado pelo teto: o que passou sem ter sido comandado porque
  // o reservatório encheu antes de a rampa chegar lá. É o salto a jusante
  // que a antecipação da abertura existe para evitar.
  const passosForcados = estado.forcado.filter((v) => v > 1e-9).length;
  const primeiroForcado = estado.forcado.findIndex((v) => v > 1e-9);
  const saltoNoTeto = primeiroForcado >= 0
    ? vertimento[primeiroForcado] - (primeiroForcado > 0 ? vertimento[primeiroForcado - 1] : 0)
    : 0;
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
      passosForcados,
      inicioForcado: primeiroForcado >= 0 ? serie[primeiroForcado].dataHora : null,
      // A abertura que o teto impõe de uma vez — a manobra que o operador
      // executa fora do degrau.
      saltoNoTeto,
      volumeMaximo,
      volumeTeto,
      excedenteSobreTeto: Math.max(0, volumeMaximo - volumeTeto),
      naCapacidadeMaxima: naCapacidade,
      capacidadeMax,
      degrau,
      passosPorDegrau,
      minutosPorDegrau: (passosPorDegrau * PASSO_SEGUNDOS) / 60,
      rampaPorPasso: degrau / passosPorDegrau,
      manobras: instantesDeManobra(programado, estado.forcado, passosPorDegrau).length,
      rampaInsuficiente,
      portoes,
      // Onde a regra de nível impediu uma abertura que o cálculo pedia.
      passosBarradosPeloPortao: estado.barrado.filter(Boolean).length,
      bombeamentoNoMaximoAoVerter,
      antecedenciaMin,
      instanteExcesso: instanteExcesso >= 0 ? serie[instanteExcesso].dataHora : null,
      passosComRetiradaReduzida: estado.reduzido.filter(Boolean).length,
      seguraOPiso: Number.isFinite(nivelMinimo)
        ? Math.min(...estado.volumes) >= volumeDaCota(cav, nivelMinimo) - 1e-9
        : true,
      picoSemRampa: Math.max(0, ...necessario),
      qafPico: Math.max(...hidrograma),
      volumeAfluente: hidrograma.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      volumeBombeado: estado.bombeado.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      volumeRevertido: estado.revertido.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      bombeamentoMaquina: Math.max(0, ...estado.bombeado),
      reversaoMaquina: Math.max(0, ...estado.revertido),
      volumeVertido: vertimento.reduce((s, q) => s + q * HM3_POR_M3S, 0),
      bombeamentoMinimo: Math.min(...serie.map((s) => s.bombeamentoDisponivel)),
      bombeamentoMaximo: Math.max(...serie.map((s) => s.bombeamentoDisponivel)),
    },
  };
}

/**
 * O cronograma que vai para a mão do operador: a cada manobra, a hora e a
 * abertura alvo. O resultado do cálculo é uma série de 15 em 15 min, mas a
 * comporta só se move nos degraus — o que se executa são estas linhas.
 */
export function cronogramaDeManobras({ serie, resumo }) {
  const passos = serie.slice(0, -1);
  return instantesDeManobra(
    passos.map((s) => s.qvertProgramado),
    passos.map((s) => s.qvertForcado),
    resumo.passosPorDegrau,
  ).map(({ t, abertura, variacao, imposta }) => ({
    dataHora: serie[t].dataHora,
    abertura,
    variacao,
    // Manobra que o teto impôs: fora da grade e, quase sempre, maior que um
    // degrau. Não é opção do operador.
    imposta,
    cota: serie[t].cota,
    qaf: serie[t].qaf,
    acimaDoLimite: Number.isFinite(resumo.limiteSemDano) && abertura > resumo.limiteSemDano + 1e-9,
  }));
}

/**
 * O que custa hesitar. Pega o cronograma calculado e o executa atrasado em N
 * passos, como se o operador tivesse demorado a abrir. Mede o que a demora
 * cobra: pico maior, mais tempo alagando, e se o nível passa do teto.
 *
 * A pergunta "e se eu começar tarde?" é a mais consequente da operação, e
 * não tinha resposta na ferramenta.
 */
export function custoDoAtraso(cfg, atrasosEmPassos = [2, 4, 8, 12]) {
  // Os cenários comparam entre si, sempre com a afluência central.
  const base = amortecerUm(cfg);
  const n = cfg.hidrograma.length;
  const { volumeMin: volumeMinCav } = limitesCav(cfg.cav);
  const volumeInicial = volumeDaCota(cfg.cav, cfg.nivelInicial);
  const volumePiso = Number.isFinite(cfg.nivelMinimo)
    ? Math.max(volumeDaCota(cfg.cav, cfg.nivelMinimo), volumeMinCav)
    : volumeMinCav;
  const volumeTeto = volumeDaCota(cfg.cav, cfg.nivelMaximo);
  const limite = Number(cfg.vertedouro?.limiteSemDano);

  const avaliar = (atraso) => {
    const atrasado = new Array(n).fill(0);
    for (let t = 0; t < n; t++) atrasado[t] = t < atraso ? 0 : base.serie[t - atraso].qvert;
    const capacidadeMax = Number(cfg.vertedouro?.capacidadeMax) || 0;
    const e = simularCom(
      cfg.cav, cfg.hidrograma, volumeInicial, cfg.conjuntos || [], atrasado,
      volumePiso, volumeTeto, capacidadeMax,
      {
        degrau: Number(cfg.vertedouro?.degrau) || Infinity,
        porBloco: Math.max(1, Math.round(Number(cfg.vertedouro?.passosPorDegrau) || 1)),
        limiteSemDano: limite,
        capacidadeMax,
        portoes: cfg.vertedouro?.portoes || {},
      },
    );
    const picoVert = Math.max(0, ...e.vertido);
    const acima = Number.isFinite(limite) ? e.vertido.filter((v) => v > limite + 1e-9).length : 0;
    const volumeMaximo = Math.max(...e.volumes);
    const primeiroForcado = e.forcado.findIndex((v) => v > 1e-9);
    return {
      atrasoMin: (atraso * PASSO_SEGUNDOS) / 60,
      picoVert,
      horasAcimaDoLimite: (acima * PASSO_SEGUNDOS) / 3600,
      cotaMaxima: cotaDoVolume(cfg.cav, volumeMaximo),
      excedenteSobreTeto: Math.max(0, volumeMaximo - volumeTeto),
      estourouTeto: volumeMaximo > volumeTeto + 1e-9,
      dentroDoLimite: Number.isFinite(limite) ? picoVert <= limite + 1e-9 : null,
      passosForcados: e.forcado.filter((v) => v > 1e-9).length,
      saltoNoTeto: primeiroForcado >= 0
        ? e.vertido[primeiroForcado] - (primeiroForcado > 0 ? e.vertido[primeiroForcado - 1] : 0)
        : 0,
    };
  };

  return [0, ...atrasosEmPassos].map(avaliar);
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
    const r = amortecerUm({ ...cfg, conjuntos });
    saida.push({
      disponiveis: d,
      bombeamento: d * alvo.capacidadeUnidade,
      picoVert: r.resumo.picoVert,
      dentroDoLimite: r.resumo.dentroDoLimite,
      horasAcimaDoLimite: r.resumo.horasAcimaDoLimite,
      cotaMaxima: r.resumo.cotaMaxima,
      estourouTeto: r.resumo.estourouTeto,
      passosForcados: r.resumo.passosForcados,
      saltoNoTeto: r.resumo.saltoNoTeto,
    });
  }
  return saida;
}
