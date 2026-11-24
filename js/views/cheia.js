// Amortecimento de cheia: decide se será preciso verter, quanto, e a partir
// de que hora a comporta precisa começar a abrir.
//
// A tela é organizada pela pergunta, não pelo modelo: o veredito vem antes
// dos números, e os dois quadros de cenário no fim respondem às duas
// incertezas reais da operação — quantas bombas estarão disponíveis, e de
// que cota vale a pena partir.

import * as db from '../db.js';
import { limitesCav, volumeDaCota } from '../cav.js';
import { amortecerCheia, propostaDePatamar, simularEditado, hidrogramaCheia, cenariosDeBombeamento, cronogramaDeManobras, custoDoAtraso } from '../cheia.js';
import { graficoCheia } from '../charts.js';
import { $, $$, esc, num, toast, comBotao, valorNumerico, paraInputDateTime, proximoQuartoDeHora } from '../ui.js';
import { baixarCsv, paraNumero } from '../planilha.js';

// As duas retiradas de Santana. Vigário bombeia para o sistema; Santa
// Cecília reverte para o Paraíba do Sul. Operações distintas, por isso o
// tipo — a tela não as soma num número só.
const PADRAO_CONJUNTOS = [
  { nome: 'Vigário', tipo: 'bombeamento', unidades: 4, capacidadeUnidade: 50, disponiveis: 4, nivelMinimo: 361.3 },
  { nome: 'Santa Cecília', tipo: 'reversao', unidades: 1, capacidadeUnidade: 30, disponiveis: 1, nivelMinimo: null },
];

const ROTULO_TIPO = { bombeamento: 'Bombeamento', reversao: 'Reversão' };

// O cálculo anda em passos de 15 min, mas isso é detalhe interno: o campo
// pede minutos, que é como a manobra é combinada na operação.
const passosDaManobra = (container) =>
  Math.max(1, Math.round((Number($('#vertMinutos', container).value) || 15) / 15));

const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const soHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeStyle: 'short' }) : '—');

// Quanto falta, em relação a agora. Numa cheia o operador não calcula a
// diferença de cabeça: ele precisa de "daqui a 3 h 20".
function daquiA(iso) {
  if (!iso) return '';
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const abs = Math.abs(min);
  const texto = abs < 60
    ? `${abs} min`
    : `${Math.floor(abs / 60)} h${abs % 60 ? ` ${String(abs % 60).padStart(2, '0')}` : ''}`;
  if (abs < 2) return 'agora';
  return min > 0 ? `daqui a ${texto}` : `há ${texto}`;
}

const RESERVATORIO_ALVO = 'santana';

// A aba é só para Santana. O seletor sai do caminho: o reservatório é
// escolhido por nome, e só vira pergunta se não for encontrado.
function escolherReservatorio(lista) {
  const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return lista.find((r) => normal(r.nome).includes(RESERVATORIO_ALVO))
    || lista.find((r) => normal(r.nome).includes('sanatana'))
    || lista[0];
}

// O nível mínimo de captação da elevatória já está no cadastro como
// restrição de mínimo; usá-lo evita um número repetido em dois lugares.
function nivelDeCaptacao(reservatorio) {
  const mins = (reservatorio?.restricoes || [])
    .filter((r) => r.tipo === 'min' && Number.isFinite(r.nivel))
    .map((r) => r.nivel);
  return mins.length ? Math.max(...mins) : null;
}

export async function render(container) {
  const reservatorios = (await db.listarReservatorios()).filter((r) => r.cavResumo);
  const reservatorio = escolherReservatorio(reservatorios);
  const cav = reservatorio ? await db.obterCav(reservatorio.id) : null;

  const teto = reservatorio?.nivelMaxEmergencial;
  const piso = reservatorio?.nivelMinEmergencial;
  const faltamLimites = !Number.isFinite(teto) || !Number.isFinite(piso);
  const pronto = !!cav && !faltamLimites;

  const l = cav ? limitesCav(cav) : null;
  // O volume que importa na cheia é o que cabe entre os dois níveis de
  // emergência, não o da tabela CAV inteira: abaixo do piso e acima do teto
  // não há manobra possível.
  const volumeUtil = cav && !faltamLimites
    ? volumeDaCota(cav, teto) - volumeDaCota(cav, piso) : null;
  const captacao = nivelDeCaptacao(reservatorio);
  const conjuntos = PADRAO_CONJUNTOS.map((c, i) => ({
    ...c,
    nivelMinimo: i === 0 && Number.isFinite(captacao) ? captacao : c.nivelMinimo,
  }));

  // Partir do piso de emergência é o cenário de maior preparo: todo o volume
  // entre os dois níveis fica disponível para amortecer a cheia.
  const inicialPadrao = Number.isFinite(piso)
    ? piso
    : (l ? l.cotaMin : 0);

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Amortecimento de cheia</h2>
          ${reservatorio ? '' : '<p class="ajuda">Nenhum reservatório com tabela CAV importada.</p>'}
        </div>
      </div>

      ${pronto ? `
      <div class="referencias">
        <div class="referencia"><span>Teto — máx. emergencial</span><strong>${num(teto)} m</strong></div>
        <div class="referencia"><span>Piso — mín. emergencial</span><strong>${num(piso)} m</strong></div>
        <div class="referencia"><span>Volume entre os dois</span><strong>${num(volumeUtil, 3)} hm³</strong></div>
        <p class="referencias-origem">Valores do cadastro do reservatório. <a href="#/reservatorios">Ajustar</a></p>
      </div>` : ''}

      ${!cav ? '<div class="alerta alerta-aviso">Importe a tabela CAV do reservatório antes de simular a cheia.</div>' : ''}
      ${cav && faltamLimites ? `<div class="alerta alerta-aviso">
        <strong>Faltam os níveis de emergência no cadastro.</strong> O amortecimento precisa de um teto e de um piso
        para calcular o vertimento, e eles vêm do cadastro do reservatório — não são informados aqui.
        <a href="#/reservatorios">Cadastrar agora</a>.</div>` : ''}

      <form id="form-cheia" novalidate>
        <fieldset>
          <legend>Cheia de projeto</legend>
          <div class="linha-inline" style="margin-bottom:12px">
            <label style="flex-direction:row;align-items:center;gap:6px;flex:0 0 auto">
              <input type="radio" name="fonte" value="triangular" checked style="width:auto" /> Cheia de projeto
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px;flex:0 0 auto">
              <input type="radio" name="fonte" value="serie" style="width:auto" /> Série medida
            </label>
          </div>
          <div id="caixa-triangular">
            <div class="grade grade-3">
              <label>Vazão de base (m³/s)<input type="number" id="qBase" value="3" step="0.1" /></label>
              <label>Pico (m³/s)<input type="number" id="qPico" value="650" step="1" /></label>
              <label>Subida até o pico (h)<input type="number" id="hSubida" value="9" step="0.25" /></label>
            </div>
            <details class="ajuste-fino">
              <summary>Forma da cauda e janela simulada</summary>
              <div class="grade grade-4">
                <label>Recessão: até a metade (h)<input type="number" id="hRecessao" value="7" step="0.25" /></label>
                <label>Recessão: até 10% (h)
                  <input type="number" id="hDecimo" value="17" step="0.5" />
                  <small id="info-cauda"></small>
                </label>
                <label>Antes do evento (h)<input type="number" id="hAntes" value="1" step="0.25" /></label>
                <label>Cauda simulada (h)<input type="number" id="hDepois" value="48" step="1" /></label>
              </div>
              <p class="ajuda">Medianas de 478 dias de afluência medida em Santana (16 cheias acima de
              80 m³/s, ajuste sobre as dez maiores). Quanto mais próximos os dois tempos, mais abrupto
              o corte da cauda.</p>
            </details>

          </div>
          <label class="oculto" id="caixa-serie">Afluência de 15 em 15 min (m³/s)
            <textarea id="serieQaf" rows="4" placeholder="2,0&#10;5,5&#10;12,0"></textarea>
            <small id="info-serie"></small>
          </label>

          <!-- Fora das duas caixas: a incerteza da previsão vale tanto para a
               cheia de projeto quanto para uma série medida. -->
          <label class="opcao-limites">
            <input type="checkbox" id="confAtivo" />
            <span>Limites de confiança da afluência
              <small>A previsão é a maior incerteza do problema. Com os limites, a onda e o que
              ela provoca vêm com a faixa em que podem cair.</small></span>
          </label>
          <div class="grade grade-3" id="caixa-confianca">
            <label>Incerteza da afluência (± %)
              <input type="number" id="confPercentual" value="5" step="1" min="0" max="90" />
              <small>Aplicada para cima e para baixo.</small></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Partida</legend>
          <div class="grade grade-2">
            <label>Cota ao início do evento (m)
              <input type="number" id="nivelInicial" step="0.01" value="${Number(inicialPadrao).toFixed(2)}" />
              <small>Entre o piso e o teto do cadastro. Sugerido no piso de emergência, que é o maior volume de espera possível.</small>
            </label>
            <label>Início do evento
              <input type="datetime-local" id="dataInicial" />
              <small>Usado para datar o cronograma de manobra.</small>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Retirada disponível agora</legend>
          <div id="conjuntos">${conjuntos.map(blocoConjunto).join('')}</div>
          <details class="ajuste-fino">
            <summary>Ajustar características das instalações</summary>
            <div id="conjuntos-fino">${conjuntos.map(blocoConjuntoFino).join('')}</div>
          </details>
        </fieldset>

        <fieldset>
          <legend>Manobra da comporta</legend>
          <div class="grade">
            <label>Degrau (m³/s)
              <input type="number" id="vertDegrau" value="10" step="any" min="0.1" />
              <small>Quanto a comporta abre ou fecha de uma vez.</small>
            </label>
            <label>A cada (min)
              <input type="number" id="vertMinutos" value="30" step="15" min="15" />
              <small id="info-rampa"></small>
            </label>
          </div>
          <div class="grade grade-2" style="margin-top:14px">
            <label>Começar a verter a partir da cota (m)
              <input type="number" id="portaoInicio" step="0.01" placeholder="sem restrição" />
              <small>Abaixo dela a comporta fica fechada, mesmo que o cálculo peça abertura.</small>
            </label>
            <label>Nível máximo desejado (m)
              <input type="number" id="nivelDesejado" step="0.01" value="${Number.isFinite(teto) ? Number(teto).toFixed(2) : ''}" />
              <small>Usado pelo vertimento de último recurso: guarda a água até este nível e,
              ao chegar nele, vai fechando a comporta para mantê-lo — sem esvaziar o reservatório.</small>
            </label>
            <label>Reserva abaixo do teto (m)
              <input type="number" id="reserva" value="0.10" step="0.05" min="0" max="2" />
              <small>Usada só pela proposta de menor pico: quanto do reservatório ela deixa
              intacto para o caso de a cheia vir maior.</small>
            </label>
            <label>Liberar acima do limite a partir da cota (m)
              <input type="number" id="portaoLibera" step="0.01" placeholder="sem restrição" />
              <small id="info-portao"></small>
            </label>
          </div>

          <details class="ajuste-fino">
            <summary>Características do vertedouro</summary>
            <div class="grade">
              <label>Capacidade máxima (m³/s)<input type="number" id="vertMax" value="1200" step="10" /></label>
              <label>Limite sem alagar (m³/s)
                <input type="number" id="vertSemDano" value="30" step="1" />
                <small>Acima disto começa a alagar residências ribeirinhas.</small>
              </label>
            </div>
          </details>
        </fieldset>

        <div class="acoes">
          <button type="submit" class="primario" ${pronto ? '' : 'disabled'}>Calcular amortecimento</button>
        </div>
      </form>
    </section>

    <div id="saida" class="oculto"></div>`;

  $('#dataInicial', container).value = paraInputDateTime(proximoQuartoDeHora());

  const estado = { cav, reservatorio, teto, piso };

  $$('input[name="fonte"]', container).forEach((el) => el.addEventListener('change', () => {
    const serie = $('input[name="fonte"]:checked', container).value === 'serie';
    $('#caixa-triangular', container).classList.toggle('oculto', serie);
    $('#caixa-serie', container).classList.toggle('oculto', !serie);
  }));

  $('#serieQaf', container).addEventListener('input', () => {
    // Mesma leitura estrita da simulação: o aviso aparece enquanto se digita.
    const info = $('#info-serie', container);
    try {
      const v = lerSerieEstrita($('#serieQaf', container).value);
      info.classList.remove('erro');
      info.textContent = v.length
        ? `${v.length} valores → ${(v.length / 4).toFixed(2)} h · pico ${num(Math.max(...v))} m³/s` : '';
    } catch (e) {
      info.classList.add('erro');
      info.textContent = e.message;
    }
  });

  const atualizarRampa = () => {
    const d = Number($('#vertDegrau', container).value) || 0;
    const p = passosDaManobra(container);
    $('#info-rampa', container).textContent =
      `${num(d)} m³/s a cada ${p * 15} min · equivale a ${num(d / p / 15 * 60)} m³/s por hora`;
  };
  const atualizarCauda = () => {
    const t50 = Number($('#hRecessao', container).value) || 0;
    const t10 = Number($('#hDecimo', container).value) || 0;
    const info = $('#info-cauda', container);
    if (!(t10 > t50 * 1.02)) { info.textContent = 'Precisa ser maior que o tempo até a metade.'; return; }
    const razao = t10 / t50;
    info.textContent = `Razão ${num(razao)} — ${razao > 3.0 ? 'cauda longa' : razao > 2.0 ? 'cauda típica de Santana' : 'corte abrupto'}.`;
  };
  $('#hRecessao', container).addEventListener('input', atualizarCauda);
  $('#hDecimo', container).addEventListener('input', atualizarCauda);
  atualizarCauda();

  const atualizarPortao = () => {
    const lim = Number($('#vertSemDano', container).value);
    $('#info-portao', container).textContent = Number.isFinite(lim)
      ? `Abaixo dela o vertimento fica limitado a ${num(lim)} m³/s, que não alaga.`
      : 'Abaixo dela o vertimento fica limitado ao que não alaga.';
  };
  $('#vertSemDano', container).addEventListener('input', atualizarPortao);
  atualizarPortao();

  $('#vertDegrau', container).addEventListener('input', atualizarRampa);
  $('#vertMinutos', container).addEventListener('input', atualizarRampa);
  atualizarRampa();

  // O resumo de cada conjunto acompanha tanto a disponibilidade quanto as
  // características, que moram no bloco recolhido.
  const atualizarConjuntos = () => {
    for (const bloco of $$('[data-conjunto]', container)) {
      const i = bloco.dataset.conjunto;
      const fino = $(`[data-conjunto-fino="${i}"]`, container);
      const disp = Number($('[data-campo="disponiveis"]', bloco).value) || 0;
      const cap = Number($('[data-campo="capacidadeUnidade"]', fino).value) || 0;
      const nivel = valorNumerico($('[data-campo="nivelMinimo"]', fino));
      // As máquinas são de velocidade fixa: o que se escolhe é QUANTAS
      // ligar, e cada uma entrega a capacidade inteira.
      $('[data-resumo]', bloco).textContent =
        `${num(disp * cap)} m³/s` + (disp ? ` · ${disp} × ${num(cap)}` : '')
        + (Number.isFinite(nivel) ? ` · capta acima de ${num(nivel)} m` : '');
    }
  };
  const alternarLimites = () => {
    $('#caixa-confianca', container).classList.toggle('oculto', !$('#confAtivo', container).checked);
  };
  $('#confAtivo', container).addEventListener('change', alternarLimites);
  alternarLimites();

  $('#conjuntos', container).addEventListener('change', atualizarConjuntos);
  $('#conjuntos-fino', container).addEventListener('input', atualizarConjuntos);
  atualizarConjuntos();

  $('#form-cheia', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao(e.submitter, async () => {
      const cfg = montarConfig(container, estado);
      const reserva = Number($('#reserva', container).value) || 0;
      // Duas propostas para a mesma cheia, com objetivos opostos. Quem decide
      // qual executar é o operador, não o algoritmo.
      estado.propostas = {
        recurso: amortecerCheia(cfg),
        patamar: propostaDePatamar(cfg, reserva),
      };
      estado.cfgAtual = cfg;
      estado.origem = null;
      // O menor pico é a proposta padrão: é a que serve ao objetivo do
      // simulador. A de último recurso fica ao lado, para comparar.
      estado.escolha = estado.propostas.patamar ? 'patamar' : 'recurso';
      const saida = $('#saida', container);
      saida.classList.remove('oculto');
      pintarEscolha(container, estado);
      saida.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 'Calculando…');
  });

  $('#saida', container).addEventListener('click', (e) => {
    if (e.target.closest('#btn-resimular')) { resimular(); return; }
    if (e.target.closest('#btn-desfazer')) {
      pintarEscolha(container, estado);
      return;
    }
    const botao = e.target.closest('[data-proposta]');
    if (!botao || botao.dataset.proposta === estado.escolha) return;
    estado.escolha = botao.dataset.proposta;
    pintarEscolha(container, estado);
    $('#saida', container).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Edição na tabela passo a passo.
  $('#saida', container).addEventListener('focusin', (e) => {
    if (!e.target.classList.contains('cel')) return;
    // A referência para "o que mudou" é a tabela como ela abriu.
    if (!estado.origem) {
      estado.origem = {
        qaf: [...estado.edicao.qaf], qbomb: [...estado.edicao.qbomb],
        qrev: [...estado.edicao.qrev], qvert: [...estado.edicao.qvert],
      };
    }
  });
  $('#saida', container).addEventListener('change', (e) => {
    if (!e.target.classList.contains('cel')) return;
    lerCelula(e.target, estado);
    atualizarBarraEdicao(container, estado);
  });
  // Colar uma coluna do Excel numa célula preenche os passos seguintes.
  $('#saida', container).addEventListener('paste', (e) => {
    const alvo = e.target;
    if (!alvo.classList || !alvo.classList.contains('cel')) return;
    const texto = (e.clipboardData || window.clipboardData).getData('text');
    const valores = texto.split(/\r?\n/).map((l) => l.split('\t')[0].trim()).filter((l) => l !== '');
    if (valores.length < 2) return;
    e.preventDefault();
    const campo = alvo.dataset.campo;
    let t = Number(alvo.dataset.t);
    for (const v of valores) {
      const cel = $(`#passo-a-passo .cel[data-t="${t}"][data-campo="${campo}"]`, container);
      if (!cel) break;
      if (!estado.origem) {
        estado.origem = {
          qaf: [...estado.edicao.qaf], qbomb: [...estado.edicao.qbomb],
          qrev: [...estado.edicao.qrev], qvert: [...estado.edicao.qvert],
        };
      }
      cel.value = v;
      lerCelula(cel, estado);
      t += 1;
    }
    atualizarBarraEdicao(container, estado);
    toast(`${valores.length} valores colados a partir desta linha.`);
  });

  function resimular() {
    if ($$('#passo-a-passo .cel.invalida', container).length) return;
    estado.propostas.editada = simularEditado(estado.cfgAtual, estado.edicao);
    estado.escolha = 'editada';
    estado.origem = null;
    pintarEscolha(container, estado);
    $('#saida', container).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Linha compacta: o que muda a cada evento é quantas unidades estão de pé.
function blocoConjunto(c, i) {
  const opcoes = Array.from({ length: c.unidades + 1 }, (_, n) =>
    `<option value="${n}"${n === c.disponiveis ? ' selected' : ''}>${n}</option>`).join('');
  return `
    <div class="conjunto" data-conjunto="${i}" data-tipo="${c.tipo}">
      <span class="conjunto-nome">${esc(c.nome)}<small>${ROTULO_TIPO[c.tipo] || 'Bombeamento'}</small></span>
      <label class="conjunto-disp">Disponíveis
        <select data-campo="disponiveis">${opcoes}</select>
      </label>
      <span class="conjunto-de">de ${c.unidades}</span>
      <span class="conjunto-resumo" data-resumo></span>
    </div>`;
}

// Características da instalação: mudam raramente, ficam recolhidas.
function blocoConjuntoFino(c, i) {
  return `
    <div class="grade" data-conjunto-fino="${i}" style="margin-bottom:10px">
      <label>Conjunto<input type="text" data-campo="nome" value="${esc(c.nome)}" /></label>
      <label>Unidades<input type="number" data-campo="unidades" value="${c.unidades}" min="0" step="1" /></label>
      <label>Vazão por unidade (m³/s)<input type="number" data-campo="capacidadeUnidade" value="${c.capacidadeUnidade}" min="0" step="1" /></label>
      <label>Nível mín. de captação (m)
        <input type="number" data-campo="nivelMinimo" value="${c.nivelMinimo ?? ''}" step="0.01" placeholder="sem limite" />
      </label>
    </div>`;
}

// A disponibilidade vem da linha compacta; o resto, do bloco recolhido.
function lerConjuntos(container) {
  return $$('[data-conjunto]', container).map((bloco) => {
    const fino = $(`[data-conjunto-fino="${bloco.dataset.conjunto}"]`, container);
    return {
      nome: $('[data-campo="nome"]', fino).value.trim() || 'Conjunto',
      unidades: Number($('[data-campo="unidades"]', fino).value) || 0,
      capacidadeUnidade: Number($('[data-campo="capacidadeUnidade"]', fino).value) || 0,
      disponiveis: Number($('[data-campo="disponiveis"]', bloco).value) || 0,
      nivelMinimo: valorNumerico($('[data-campo="nivelMinimo"]', fino)),
      tipo: bloco.dataset.tipo,
    };
  });
}

// Lê a série medida sem descartar nada em silêncio. A leitura tolerante
// pulava o que não fosse número, e cada valor pulado adiantava em 15 min
// toda a série seguinte — e com ela a hora de abrir a comporta.
function lerSerieEstrita(texto) {
  const valores = [];
  const invalidos = [];
  for (const token of String(texto ?? '').split(/[\s;]+/).filter(Boolean)) {
    const direto = paraNumero(token);
    if (Number.isFinite(direto)) { valores.push(direto); continue; }
    // "350,400,420": lista separada por vírgulas. Vírgula sobrando no fim
    // ("350,") não é valor.
    for (const parte of token.split(',').filter((p) => p.trim() !== '')) {
      const v = paraNumero(parte);
      if (Number.isFinite(v)) valores.push(v); else invalidos.push(parte);
    }
  }
  if (invalidos.length) {
    const exemplos = invalidos.slice(0, 3).map((v) => `"${v}"`).join(', ');
    throw new Error(`A série medida tem ${invalidos.length} valor${invalidos.length > 1 ? 'es' : ''} que não ${invalidos.length > 1 ? 'são números' : 'é número'} (${exemplos}). Corrija antes de simular: um valor pulado desloca toda a série em 15 min.`);
  }
  return valores;
}

function montarConfig(container, estado) {
  if (!estado.cav) throw new Error('Selecione um reservatório com tabela CAV.');

  const serieEscolhida = $('input[name="fonte"]:checked', container).value === 'serie';
  const hidrograma = serieEscolhida
    ? lerSerieEstrita($('#serieQaf', container).value)
    : hidrogramaCheia({
      base: Number($('#qBase', container).value) || 0,
      pico: Number($('#qPico', container).value) || 0,
      horasSubida: Number($('#hSubida', container).value) || 1,
      horasMeiaRecessao: Number($('#hRecessao', container).value) || 1,
      horasDecimoRecessao: Number($('#hDecimo', container).value) || null,
      horasAntes: Number($('#hAntes', container).value) || 0,
      horasDepois: Number($('#hDepois', container).value) || 1,
    });
  if (hidrograma.length < 2) throw new Error('Informe um hidrograma com pelo menos dois valores.');
  if (hidrograma.some((q) => q < 0)) throw new Error('A afluência não pode ser negativa.');

  const nivelInicial = valorNumerico($('#nivelInicial', container));
  if (nivelInicial == null) throw new Error('Informe o nível na partida.');
  // Teto e piso vêm do cadastro do reservatório, não do formulário.
  const { teto: nivelMaximo, piso: nivelMinimo } = estado;
  if (!Number.isFinite(nivelMaximo) || !Number.isFinite(nivelMinimo)) {
    throw new Error('Cadastre os níveis de emergência do reservatório antes de simular a cheia.');
  }
  if (nivelInicial > nivelMaximo + 1e-9) {
    throw new Error(`O nível na partida (${num(nivelInicial)} m) está acima do teto de ${num(nivelMaximo)} m.`);
  }
  const nivelDesejado = valorNumerico($('#nivelDesejado', container)) ?? nivelMaximo;
  if (nivelDesejado > nivelMaximo + 1e-9 || nivelDesejado <= nivelMinimo) {
    throw new Error(`O nível máximo desejado precisa ficar entre o piso (${num(nivelMinimo)} m) e o teto (${num(nivelMaximo)} m).`);
  }

  // Manobra: valores que o cálculo arredondaria ou ignoraria em silêncio
  // viram erro, porque mudam o cronograma de abertura sem ninguém ver.
  const degrau = Number($('#vertDegrau', container).value);
  if (!(degrau >= 1)) throw new Error('O degrau de manobra precisa ser de pelo menos 1 m³/s.');
  const minutos = Number($('#vertMinutos', container).value);
  if (!(minutos >= 15) || Math.abs(minutos / 15 - Math.round(minutos / 15)) > 1e-9) {
    throw new Error('O intervalo entre manobras precisa ser múltiplo de 15 min (15, 30, 45, 60…), o passo do cálculo.');
  }
  const capacidadeMax = Number($('#vertMax', container).value);
  if (!(capacidadeMax > 0)) throw new Error('Informe a capacidade máxima do vertedouro.');
  if (degrau > capacidadeMax) throw new Error('O degrau de manobra é maior que a capacidade do vertedouro.');
  const inicio = valorNumerico($('#portaoInicio', container));
  const liberaAcima = valorNumerico($('#portaoLibera', container));
  if (inicio != null && liberaAcima != null && liberaAcima < inicio) {
    throw new Error(`A cota para liberar acima do limite (${num(liberaAcima)} m) está abaixo da cota para começar a verter (${num(inicio)} m).`);
  }

  return {
    cav: estado.cav,
    reservatorio: estado.reservatorio,
    hidrograma,
    nivelInicial,
    nivelMaximo,
    nivelMinimo,
    nivelDesejado,
    conjuntos: lerConjuntos(container),
    confianca: {
      ativo: $('#confAtivo', container).checked,
      percentual: Number($('#confPercentual', container).value) || 0,
    },
    vertedouro: {
      capacidadeMax,
      limiteSemDano: Number($('#vertSemDano', container).value),
      degrau,
      passosPorDegrau: passosDaManobra(container),
      portoes: { inicio, liberaAcima },
    },
    dataInicial: new Date($('#dataInicial', container).value || Date.now()),
  };
}

// Redesenha a saída inteira para a proposta escolhida.
function pintarEscolha(container, estado) {
  const { propostas, escolha, cfgAtual } = estado;
  const r = propostas[escolha] || propostas.recurso;
  $('#saida', container).innerHTML = htmlPropostas(propostas, escolha) + htmlSaida(r, cfgAtual);
  desenhar(r, cfgAtual);
  // A tabela passo a passo parte do resultado que está na tela. Numa edição
  // já simulada, reabre com o que o usuário digitou — não com o que o piso
  // ou o teto deixaram passar.
  estado.edicao = r.edicao
    ? { qaf: [...r.edicao.qaf], qbomb: [...r.edicao.qbomb], qrev: [...r.edicao.qrev], qvert: [...r.edicao.qvert] }
    : edicaoDoResultado(r);
  estado.editados = new Set();
  // Referência do que mudou: a tabela como ela abriu.
  estado.origem = {
    qaf: [...estado.edicao.qaf], qbomb: [...estado.edicao.qbomb],
    qrev: [...estado.edicao.qrev], qvert: [...estado.edicao.qvert],
  };
  $('#passo-a-passo', container).innerHTML = tabelaPassoAPasso(r, estado.edicao);
  atualizarBarraEdicao(container, estado);
}

// Valores de entrada de cada passo, tirados de um resultado. O vertimento é o
// COMANDADO na comporta: é o que se reaplica para reproduzir a proposta.
function edicaoDoResultado(r) {
  const passos = r.serie.slice(0, -1);
  return {
    qaf: passos.map((p) => p.qaf),
    qbomb: passos.map((p) => p.qbomb),
    qrev: passos.map((p) => p.qrev),
    qvert: passos.map((p) => p.qvertProgramado),
  };
}

const PROPOSTAS = {
  recurso: {
    nome: 'Vertimento de último recurso',
    resumo: 'Guarda a água até o nível máximo desejado, abre só o necessário e, ao chegar nele, vai fechando a comporta para mantê-lo. Verte o menor volume — ao custo do maior pico.',
  },
  patamar: {
    nome: 'Menor pico possível',
    resumo: 'Abre cedo e mantém constante, usando o reservatório para achatar a onda. Verte mais volume e por mais tempo, com um pico bem menor.',
  },
  editada: {
    nome: 'Sua edição',
    resumo: 'Os valores que você digitou na tabela passo a passo, refeitos no balanço hídrico com os limites de piso e teto.',
  },
};

// As duas propostas lado a lado. A comparação vem antes do resultado porque
// a escolha é do operador: as duas são válidas e servem a objetivos opostos.
function htmlPropostas(propostas, escolha) {
  const cartao = (chave) => {
    const r = propostas[chave];
    if (!r) return '';
    const s = r.resumo;
    const meta = PROPOSTAS[chave];
    const ativo = chave === escolha;
    return `
      <button type="button" class="proposta${ativo ? ' ativa' : ''}" data-proposta="${chave}"
        aria-pressed="${ativo}">
        <span class="proposta-nome">${esc(meta.nome)}</span>
        <span class="proposta-pico">${num(s.picoVert)} <small>m³/s de pico</small></span>
        ${chave === 'patamar' && Number.isFinite(s.patamar)
    ? `<span class="proposta-linha">comporta mantida em ${num(s.patamar)} m³/s</span>` : ''}
        <span class="proposta-linha">${s.horasAcimaDoLimite
  ? `${num(s.horasAcimaDoLimite)} h acima de ${num(s.limiteSemDano)} m³/s`
  : `nunca passa de ${num(s.limiteSemDano)} m³/s`}</span>
        <span class="proposta-linha">cota máxima ${num(s.cotaMaxima)} m · ${s.manobras} manobras</span>
        <span class="proposta-nota">${esc(meta.resumo)}</span>
        ${chave === 'patamar' && s.reservaAlcancada === false
    ? `<span class="proposta-alerta">A reserva de ${num(s.reserva)} m não cabe nesta cheia.
       ${s.estourouTeto
    ? 'Nem o vertedouro inteiro segura o nível no teto; este é o que menos o ultrapassa.'
    : 'Este é o menor pico que ainda segura o nível abaixo do teto.'}</span>` : ''}
      </button>`;
  };
  return `
    <section class="painel">
      <div class="cabecalho-painel">
        <div><h2>${propostas.editada ? 'Propostas para esta cheia' : 'Duas propostas para esta cheia'}</h2>
          <p class="ajuda">Pico e duração se opõem: o volume a passar é quase o mesmo, então
          baixar o pico significa verter por mais tempo. Escolha e o resto da tela acompanha.</p>
        </div>
      </div>
      <div class="propostas${propostas.editada ? ' tres' : ''}">${cartao('patamar')}${cartao('recurso')}${cartao('editada')}</div>
    </section>`;
}

function htmlSaida({ resumo }, cfg) {
  // O destaque é o vertimento máximo — é o número que se comunica a jusante
  // e o que dimensiona o evento. A hora da primeira manobra, que é o que se
  // executa, fica na linha da situação logo abaixo.
  const verdito = !resumo.precisaVerter
    ? ['Não é preciso verter', `pico afluente de ${num(resumo.qafPico)} m³/s absorvido por bombeamento e reservatório`]
    : resumo.dentroDoLimite
      ? [`${num(resumo.picoVert)} m³/s`, `dentro do limite de ${num(resumo.limiteSemDano)} m³/s, que não alaga`]
      : [`${num(resumo.picoVert)} m³/s`,
        `acima do limite de ${num(resumo.limiteSemDano)} m³/s por ${num(resumo.horasAcimaDoLimite)} h · ${num(resumo.volumeVertido, 2)} hm³ vertidos`];

  const [inteiro, decimal] = String(verdito[0]).split(/([,.]\d+.*)$/);
  const gravidade = !resumo.precisaVerter ? 'ok' : resumo.dentroDoLimite ? 'atencao' : 'critico';

  return `
    <section class="painel">
      <div class="cabecalho-painel">
        <div><h2>Amortecimento</h2>
          <p class="ajuda">${esc(cfg.reservatorio?.nome || '')} · cheia de pico ${num(resumo.qafPico)} m³/s · ${num(resumo.volumeAfluente, 2)} hm³ afluentes</p>
        </div>
        <div class="acoes" style="margin:0">
          <button type="button" id="btn-exportar-cronograma">Exportar cronograma</button>
          <button type="button" id="btn-exportar-serie">Exportar série</button>
        </div>
      </div>

      <div class="hero">
        <p class="hero-rotulo">${resumo.precisaVerter ? 'Vertimento máximo' : 'Veredito'}</p>
        <p class="hero-valor">${esc(inteiro)}<span>${esc(decimal || '')}</span></p>
        <p class="hero-apoio">${esc(verdito[1])}</p>
      </div>

      <div class="situacao situacao-${gravidade}">
        <div class="situacao-topo">
          <span class="badge badge-${gravidade === 'ok' ? 'ok' : gravidade}">${
  !resumo.precisaVerter ? 'Sem vertimento' : resumo.dentroDoLimite ? 'Vertimento sem alagar' : 'Alaga ribeirinhos'}</span>
          ${resumo.precisaVerter ? `<span class="situacao-contagem">abrir a comporta às
            <strong>${esc(soHora(resumo.inicioAbertura))}</strong> de
            ${esc(hora(resumo.inicioAbertura).split(',')[0])} — ${esc(daquiA(resumo.inicioAbertura))}</span>` : ''}
        </div>
        ${!resumo.passosForcados && resumo.limites?.passosForcados ? `<p class="situacao-tipos">
          <strong>Com a afluência ${num(resumo.limites.percentual, 0)}% acima do previsto, o nível encosta no teto.</strong>
          Nesse caso a comporta teria de ser aberta de ${num(resumo.limites.saltoNoTeto)} m³/s de uma vez.
          Na afluência prevista isso não acontece.
        </p>` : ''}
        ${resumo.passosForcados ? `<p class="situacao-tipos">
          <strong>O nível encostou no teto de ${num(resumo.nivelMaximo)} m às ${hora(resumo.inicioForcado)}.</strong>
          Ali o reservatório não guarda mais nada e a defluência tem de igualar a afluência: a comporta é
          aberta de <strong>${num(resumo.saltoNoTeto)} m³/s de uma vez</strong>, contra os ${num(resumo.degrau)} m³/s
          de uma manobra normal. A regra do degrau não se aplica nesse ponto — não há escolha. A manobra está
          no cronograma, marcada. Abrir antes, ou com degrau maior, troca esse salto por uma rampa.
        </p>` : ''}
        ${!resumo.passosForcados && !resumo.estourouTeto && resumo.patamar == null && !resumo.manual
    && Number.isFinite(cfg.nivelDesejado) && resumo.cotaMaxima > cfg.nivelDesejado + 0.005
    ? `<p class="situacao-tipos"><strong>O nível passa do máximo desejado de ${num(cfg.nivelDesejado)} m e chega a ${num(resumo.cotaMaxima)} m.</strong>
          A comporta abrindo ${num(resumo.degrau)} m³/s a cada ${resumo.minutosPorDegrau} min não consegue segurá-lo ali.
          Um degrau maior, ou manobras mais frequentes, aproximam o nível do desejado.</p>` : ''}
        ${resumo.estourouTeto ? `<p class="situacao-tipos"><strong>Nem o vertedouro inteiro segura o nível no teto de ${num(resumo.nivelMaximo)} m:</strong>
          com a capacidade de ${num(resumo.capacidadeMax)} m³/s já toda aberta, sobram ${num(resumo.excedenteSobreTeto, 3)} hm³ que o
          reservatório não tem como passar adiante e acabam subindo acima do teto.</p>` : ''}
        ${resumo.seguraOPiso ? '' : `<p class="situacao-tipos"><strong>O nível fura o mínimo de ${num(resumo.nivelMinimo)} m</strong> mesmo com a retirada zerada: a afluência não repõe o que sai.</p>`}
        ${resumo.passosBarradosPeloPortao ? `<p class="situacao-tipos">
          <strong>Os gatilhos de nível seguraram a comporta em ${resumo.passosBarradosPeloPortao} passos</strong>
          em que o cálculo já pedia mais abertura${resumo.estourouTeto
    ? ' — e o nível passou do teto. Abrir antes, ou liberar o vertimento maior numa cota mais baixa, evitaria isso.'
    : ', e ainda assim o nível se manteve dentro do teto.'}
        </p>` : ''}
        ${resumo.precisaVerter && !resumo.bombeamentoNoMaximoAoVerter
    ? '<p class="situacao-tipos"><strong>Atenção:</strong> há passos vertendo com máquina parada que caberia na mesma defluência.</p>'
    : ''}
      </div>

      <div class="metricas">
        ${grupo('Vertimento', [
    item('Pico', `${num(resumo.picoVert)} m³/s`, faixa(resumo.limites, 'picoVert', 'm³/s')),
    item('No instante', hora(resumo.instantePico)),
    item('Volume vertido', `${num(resumo.volumeVertido, 2)} hm³`,
      faixa(resumo.limites, 'volumeVertido', 'hm³')),
    item(`Acima de ${num(resumo.limiteSemDano)} m³/s`,
      resumo.horasAcimaDoLimite
        ? `${num(resumo.horasAcimaDoLimite)} h · ${num(resumo.volumeAcimaDoLimite, 2)} hm³`
        : 'não ocorre',
      faixa(resumo.limites, 'horasAcimaDoLimite', 'h')),
    item('Manobra imposta pelo teto',
      resumo.passosForcados
        ? `+${num(resumo.saltoNoTeto)} m³/s de uma vez`
        : 'não ocorre'),
  ], 'vertido')}
        ${grupo('Nível', [
    item('Início → máximo', `${num(resumo.cotaInicial)} → ${num(resumo.cotaMaxima)} m`,
      faixa(resumo.limites, 'cotaMaxima', 'm')),
    item('Mínimo no período', `${num(resumo.cotaMinima)} m`),
    item('Teto e piso', `${num(resumo.nivelMaximo)} / ${num(resumo.nivelMinimo)} m`),
  ], 'nivel')}
        ${grupo('Recursos e manobra', [
    item('Volume bombeado', `${num(resumo.volumeBombeado, 2)} hm³`),
    item('Volume revertido', `${num(resumo.volumeRevertido, 2)} hm³`),
    item('Retirada na cota', Math.abs(resumo.bombeamentoMaximo - resumo.bombeamentoMinimo) < 0.005
      ? `${num(resumo.bombeamentoMaximo)} m³/s em toda a cheia`
      : `${num(resumo.bombeamentoMinimo)} a ${num(resumo.bombeamentoMaximo)} m³/s`),
    item('Manobras', resumo.manual
      ? `${resumo.manobras} definidas na edição`
      : `${resumo.manobras} de ${num(resumo.degrau)} m³/s a cada ${resumo.minutosPorDegrau} min`),
    resumo.antecedenciaMin != null
      ? item('Abertura × bombas no limite',
        resumo.antecedenciaMin > 0
          ? `${num(resumo.antecedenciaMin / 60)} h antes`
          : resumo.antecedenciaMin < 0
            ? `${num(-resumo.antecedenciaMin / 60)} h depois`
            : 'no mesmo instante')
      : '',
  ].filter(Boolean), 'bombeado')}
      </div>

      <div class="graficos">
        <h3 class="titulo-grafico">A cheia passo a passo
          <span>nível, vazões e bombeamento no mesmo eixo de tempo</span></h3>
        <div class="grafico-caixa cheia"><canvas id="g-cheia"></canvas></div>
      </div>
    </section>

    <section class="painel">
      <div class="cabecalho-painel">
        <div><h2>Cronograma de manobras</h2>
          <p class="ajuda" id="cronograma-resumo"></p>
        </div>
      </div>
      <div id="proximas"></div>
      <details class="serie-completa">
        <summary>Ver as manobras uma a uma</summary>
        <div id="cronograma"></div>
      </details>
    </section>

    <section class="painel passo-a-passo-painel">
      <div class="cabecalho-painel">
        <div><h2>Passo a passo</h2>
          <p class="ajuda">Cada variável de 15 em 15 min. Edite afluência, bombeamento, reversão ou
          vertimento e simule de novo: nível e volume são recalculados. O piso e o teto de
          emergência continuam valendo — se a edição pedir água que não existe ou deixar o nível
          passar do teto, o balanço corrige e a linha fica marcada. Para preencher vários passos de
          uma vez, cole uma coluna do Excel numa célula.</p>
        </div>
      </div>
      <div class="barra-edicao">
        <button type="button" class="primario" id="btn-resimular" disabled>Simular novamente</button>
        <button type="button" id="btn-desfazer" disabled>Desfazer edições</button>
        <span class="barra-edicao-status" id="status-edicao">Nenhuma edição.</span>
      </div>
      <div id="passo-a-passo"></div>
    </section>

    ${resumo.manual ? '' : `<section class="painel">
      <h2>E se…</h2>
      <p class="ajuda">As três incertezas reais da operação, medidas sobre esta mesma cheia.</p>
      <div class="cenarios">
        <details class="cenario">
          <summary>A abertura atrasar<span id="folga-resumo">quanta folga existe depois da hora marcada</span></summary>
          <div id="atraso"></div>
        </details>
        <details class="cenario">
          <summary>Faltarem bombas<span>grade entupida, unidade em manutenção</span></summary>
          <div id="cenarios-bombas"></div>
        </details>
        <details class="cenario">
          <summary>Partir de outra cota<span>mais cheio reduz a espera; mais vazio pode parar a elevatória</span></summary>
          <div id="cenarios-nivel"></div>
        </details>
      </div>
    </section>`}`;
}

// A tabela editável. Hora, as quatro vazões que o operador controla ou
// prevê, e o que resulta delas — cota e volume, só leitura.
const CAMPOS_EDITAVEIS = ['qaf', 'qbomb', 'qrev', 'qvert'];
const fmtCelula = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '');

function tabelaPassoAPasso(r, edicao) {
  const linhas = r.serie.slice(0, -1).map((p, t) => {
    const marcas = [
      p.qvertForcado > 1e-9 ? '<span class="marca-teto">teto</span>' : '',
      // Nas propostas automáticas "retirada reduzida" é operação normal no
      // piso (bomba parada por falta de água); só numa edição ela quer dizer
      // que o valor digitado foi cortado.
      r.resumo.manual && p.retiradaReduzida ? '<span class="marca-piso">piso</span>' : '',
    ].join('');
    const cel = (campo) => `<td><input type="text" inputmode="decimal" class="cel" data-t="${t}"
      data-campo="${campo}" value="${fmtCelula(edicao[campo][t])}" aria-label="${campo} no passo ${t + 1}" /></td>`;
    return `<tr${marcas ? ' class="corrigida"' : ''}>
      <td class="passo-hora">${esc(hora(p.dataHora))}</td>
      ${CAMPOS_EDITAVEIS.map(cel).join('')}
      <td class="num">${num(r.serie[t + 1].cota)}</td>
      <td class="num">${num(r.serie[t + 1].volume, 3)}</td>
      <td class="passo-marcas">${marcas}</td>
    </tr>`;
  }).join('');
  return `<div class="tabela-scroll passo-a-passo"><table>
    <thead><tr><th>Quando</th>
      <th class="num">Afluência<small>m³/s</small></th><th class="num">Bombeado<small>m³/s</small></th>
      <th class="num">Revertido<small>m³/s</small></th><th class="num">Vertido<small>m³/s</small></th>
      <th class="num">Cota ao fim<small>m</small></th><th class="num">Volume ao fim<small>hm³</small></th>
      <th></th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function atualizarBarraEdicao(container, estado) {
  const n = estado.editados ? estado.editados.size : 0;
  const invalidas = $$('#passo-a-passo .cel.invalida', container).length;
  $('#btn-resimular', container).disabled = n === 0 || invalidas > 0;
  $('#btn-desfazer', container).disabled = n === 0;
  $('#status-edicao', container).textContent = invalidas
    ? `${invalidas} ${invalidas === 1 ? 'célula inválida' : 'células inválidas'} — corrija antes de simular.`
    : n ? `${n} ${n === 1 ? 'valor editado' : 'valores editados'}.` : 'Nenhuma edição.';
}

// Lê uma célula. Vazio ou negativo não serve: a tabela é de vazões.
function lerCelula(input, estado) {
  const v = paraNumero(input.value);
  const t = Number(input.dataset.t);
  const campo = input.dataset.campo;
  const valido = Number.isFinite(v) && v >= 0;
  input.classList.toggle('invalida', !valido);
  if (!valido) return;
  const original = estado.origem ? estado.origem[campo][t] : null;
  estado.edicao[campo][t] = v;
  const chave = `${campo}:${t}`;
  const mudou = original == null || Math.abs(v - original) > 1e-9;
  input.classList.toggle('editada', mudou);
  if (mudou) estado.editados.add(chave); else estado.editados.delete(chave);
}

function grupo(titulo, itens, serie = '') {
  const marca = serie ? ` data-serie="${esc(serie)}"` : '';
  return `<div class="metrica-grupo"${marca}><h3>${esc(titulo)}</h3>${itens.join('')}</div>`;
}
function item(rotulo, valor, nota = '') {
  return `<div class="metrica"><span>${esc(rotulo)}</span><strong>${valor}</strong>${
    nota ? `<em>${nota}</em>` : ''}</div>`;
}

// A faixa que os limites de confiança abrem em torno de um número.
function faixa(limites, campo, unidade, casas = 2) {
  if (!limites || !limites[campo]) return '';
  // Mais água entrando nem sempre dá o maior valor: com a cheia maior a
  // comporta abre antes e o tempo acima do limite pode encurtar. Os dois
  // extremos vêm ordenados, não na ordem em que foram calculados.
  const [baixo, alto] = [...limites[campo]].sort((x, y) => x - y);
  if (Math.abs(alto - baixo) < 1e-9) return '';
  return `${num(baixo, casas)} a ${num(alto, casas)} ${unidade} com os limites`;
}

function desenhar(resultado, cfg) {
  const { serie, resumo } = resultado;
  graficoCheia('g-cheia', serie, {
    nivelMaximo: cfg.nivelMaximo, nivelMinimo: cfg.nivelMinimo, limiteSemDano: resumo.limiteSemDano,
    rotuloLimites: resumo.limites ? `± ${num(resumo.limites.percentual, 0)}%` : '',
  });

  // Os cenários medem as propostas automáticas; numa edição manual eles
  // descreveriam outra operação, então o painel nem é desenhado.
  if (!resumo.manual) {
    $('#cenarios-bombas').innerHTML = tabelaBombas(cenariosDeBombeamento(cfg, 0), cfg);
    $('#cenarios-nivel').innerHTML = tabelaNivel(cfg);
  }

  const cronograma = cronogramaDeManobras(resultado);
  $('#cronograma').innerHTML = tabelaCronograma(cronograma);
  // As três primeiras manobras ficam fora do detalhe recolhido: é o que se
  // executa nas próximas horas, e era a única coisa da tela que exigia um
  // clique para aparecer.
  $('#proximas').innerHTML = cronograma.length
    ? `<ol class="proximas">${cronograma.slice(0, 3).map((m) => `
        <li${m.imposta ? ' class="imposta"' : ''}>
          <span class="proximas-hora">${esc(soHora(m.dataHora))}</span>
          <span class="proximas-acao">${m.variacao > 0 ? 'Abrir' : 'Fechar'} para
            <strong>${num(m.abertura)} m³/s</strong>
            <em>${m.variacao > 0 ? '+' : '−'}${num(Math.abs(m.variacao))}</em>${
  m.imposta ? ' <b>imposta pelo teto</b>' : ''}</span>
          <span class="proximas-quando">${esc(daquiA(m.dataHora))}</span>
        </li>`).join('')}</ol>
      ${cronograma.length > 3 ? `<p class="ajuda">…e mais ${cronograma.length - 3} manobras.</p>` : ''}`
    : '';
  // A primeira manobra saiu daqui: ela agora é a primeira linha da lista
  // logo abaixo, e repetir só empurrava a lista para baixo.
  $('#cronograma-resumo').innerHTML = !cronograma.length
    ? 'A comporta permanece fechada durante todo o evento.'
    : resumo.manual
      ? `<strong>${cronograma.length} manobras</strong> definidas na sua edição, entre
         ${hora(cronograma[0].dataHora)} e ${hora(cronograma[cronograma.length - 1].dataHora)}.`
      : `<strong>${cronograma.length} manobras</strong> de ${num(resumo.degrau)} m³/s a cada
         ${resumo.minutosPorDegrau} min, entre ${hora(cronograma[0].dataHora)} e
         ${hora(cronograma[cronograma.length - 1].dataHora)}.`;
  if (resumo.manual) { exportar(cfg, serie, cronograma); return; }
  const atraso = custoDoAtraso(cfg);
  $('#atraso').innerHTML = tabelaAtraso(atraso, resumo);
  // Mesmo critério da tabela: a folga acaba quando o nível encosta no teto e
  // a comporta deixa de ser quem manda no vertimento.
  const ultimaSobComando = [...atraso].reverse().find((l) => !l.estourouTeto && !l.passosForcados);
  $('#folga-resumo').textContent = ultimaSobComando && ultimaSobComando.atrasoMin
    ? `cerca de ${ultimaSobComando.atrasoMin} min de folga depois da hora marcada`
    : ultimaSobComando
      ? 'qualquer atraso leva o nível ao teto'
      : 'nem no horário a comporta fica dentro do degrau';

  exportar(cfg, serie, cronograma);
}

function exportar(cfg, serie, cronograma) {
  const nome = (cfg.reservatorio?.nome || 'cheia').replace(/\W+/g, '-').toLowerCase();
  $('#btn-exportar-cronograma').onclick = () => baixarCsv(`manobras-${nome}.csv`,
    ['Data/hora', 'Abertura alvo (m³/s)', 'Variação (m³/s)', 'Cota (m)', 'Afluência (m³/s)', 'Acima do limite'],
    cronograma.map((m) => [hora(m.dataHora), m.abertura.toFixed(1), m.variacao.toFixed(1),
      m.cota.toFixed(2), m.qaf.toFixed(1), m.acimaDoLimite ? 'sim' : 'não']));

  $('#btn-exportar-serie').onclick = () => baixarCsv(`cheia-${nome}.csv`,
    ['Passo', 'Data/hora', 'Afluente (m³/s)', 'Bombeado (m³/s)', 'Revertido (m³/s)', 'Vertido (m³/s)',
      'Defluência total (m³/s)', 'Volume (hm³)', 'Cota (m)'],
    serie.map((p) => [p.passo, hora(p.dataHora), p.qaf.toFixed(2), p.qbomb.toFixed(2), p.qrev.toFixed(2),
      p.qvert.toFixed(2), p.qsaida.toFixed(2), p.volume.toFixed(4), p.cota.toFixed(3)]));
}


function tabelaCronograma(linhas) {
  if (!linhas.length) return '<p class="vazio">Nenhuma manobra: a comporta permanece fechada.</p>';
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>Quando</th><th>Ação</th><th class="num">Abertura alvo</th>
      <th class="num">Variação</th><th class="num">Cota no instante</th><th class="num">Afluência</th></tr></thead>
    <tbody>${linhas.map((m) => `
      <tr class="${m.imposta ? 'violacao-critico' : m.acimaDoLimite ? 'violacao-atencao' : ''}">
        <td><strong>${hora(m.dataHora)}</strong></td>
        <td>${m.variacao > 0 ? 'Abrir' : 'Fechar'}${m.imposta ? ' · <strong>imposta pelo teto</strong>' : ''}${m.acimaDoLimite ? ' · alaga' : ''}</td>
        <td class="num"><strong>${num(m.abertura)} m³/s</strong></td>
        <td class="num">${m.variacao > 0 ? '+' : '−'}${num(Math.abs(m.variacao))}</td>
        <td class="num">${num(m.cota)} m</td>
        <td class="num">${num(m.qaf)} m³/s</td>
      </tr>`).join('')}</tbody></table></div>`;
}

// Com a defluência igualando a afluência no teto, "passar do teto" virou caso
// de falta de vertedouro. O que o atraso, a falta de bomba ou uma partida mais
// alta produzem é vertimento forçado — e é isso que estas tabelas medem.
function situacao(l) {
  if (l.estourouTeto) return 'vertedouro não dá conta';
  if (l.passosForcados) return `teto: abrir ${num(l.saltoNoTeto)} m³/s de uma vez`;
  if (l.dentroDoLimite === false) return 'alaga, mas dentro do degrau';
  return 'dentro do degrau';
}

function classe(l) {
  if (l.estourouTeto || l.passosForcados) return 'violacao-critico';
  return l.dentroDoLimite === false ? 'violacao-atencao' : '';
}

function tabelaAtraso(linhas, resumo) {
  // Folga = até quando a comporta ainda manda. Depois disso é o teto que
  // manda, e o vertimento vira um degrau só.
  const ultimaOk = [...linhas].reverse().find((l) => !l.estourouTeto && !l.passosForcados);
  const folga = ultimaOk ? ultimaOk.atrasoMin : 0;
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>Atraso na abertura</th><th class="num">Pico vertido</th>
      <th class="num">Horas acima do limite</th><th class="num">Cota máx.</th><th>Situação</th></tr></thead>
    <tbody>${linhas.map((l) => `
      <tr class="${classe(l)}">
        <td><strong>${l.atrasoMin ? `${l.atrasoMin} min` : 'no horário'}</strong></td>
        <td class="num">${num(l.picoVert)} m³/s</td>
        <td class="num">${l.horasAcimaDoLimite ? num(l.horasAcimaDoLimite) : '—'}</td>
        <td class="num">${num(l.cotaMaxima)} m</td>
        <td>${situacao(l)}</td>
      </tr>`).join('')}</tbody></table></div>
    <p class="ajuda" style="margin-top:12px">${folga
    ? `Há cerca de <strong>${folga} min</strong> de folga depois da hora marcada (${hora(resumo.inicioAbertura)}) antes de o nível encostar no teto e a comporta ter de ser aberta de uma vez.`
    : 'Não há folga: qualquer atraso leva o nível ao teto, e aí a comporta tem de ser aberta de uma vez.'}</p>`;
}

function tabelaBombas(cenarios, cfg) {
  if (!cenarios.length) return '<p class="vazio">Sem conjunto de bombeamento configurado.</p>';
  const nome = cfg.conjuntos[0].nome;
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>${esc(nome)}</th><th class="num">Retirada</th><th class="num">Pico vertido</th>
      <th class="num">Horas acima do limite</th><th class="num">Cota máx.</th><th>Situação</th></tr></thead>
    <tbody>${cenarios.map((c) => `
      <tr class="${classe(c)}">
        <td><strong>${c.disponiveis}</strong> de ${cfg.conjuntos[0].unidades}</td>
        <td class="num">${num(c.bombeamento)} m³/s</td>
        <td class="num">${num(c.picoVert)} m³/s</td>
        <td class="num">${c.horasAcimaDoLimite ? num(c.horasAcimaDoLimite) : '—'}</td>
        <td class="num">${num(c.cotaMaxima)} m</td>
        <td>${situacao(c)}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

function tabelaNivel(cfg) {
  // Varre nos dois sentidos: partindo do piso de emergência não há como
  // descer, e a pergunta vira "e se a cheia chegar com o reservatório mais
  // cheio do que o planejado?".
  const passo = 0.25;
  const dentro = (v) => (cfg.nivelMinimo == null || v >= cfg.nivelMinimo - 1e-9)
    && (cfg.nivelMaximo == null || v <= cfg.nivelMaximo + 1e-9);
  const cotas = [];
  for (let d = -4; d <= 4; d++) {
    const v = +(cfg.nivelInicial + d * passo).toFixed(2);
    if (dentro(v) && !cotas.includes(v)) cotas.push(v);
  }
  cotas.sort((x, y) => y - x);
  const linhas = cotas.map((nivelInicial) => ({
    nivelInicial, ...amortecerCheia({ ...cfg, nivelInicial, confianca: null }).resumo,
  }));
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>Nível na partida</th><th class="num">Pico vertido</th><th class="num">Horas acima do limite</th>
      <th class="num">Cota máx.</th><th class="num">Bombeamento mín.</th><th>Situação</th></tr></thead>
    <tbody>${linhas.map((l) => `
      <tr class="${classe(l)}">
        <td><strong>${num(l.nivelInicial)} m</strong></td>
        <td class="num">${num(l.picoVert)} m³/s</td>
        <td class="num">${l.horasAcimaDoLimite ? num(l.horasAcimaDoLimite) : '—'}</td>
        <td class="num">${num(l.cotaMaxima)} m</td>
        <td class="num">${num(l.bombeamentoMinimo)} m³/s</td>
        <td>${l.precisaVerter ? situacao(l) : 'sem verter'}</td>
      </tr>`).join('')}</tbody></table></div>`;
}
