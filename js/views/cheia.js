// Amortecimento de cheia: decide se será preciso verter, quanto, e a partir
// de que hora a comporta precisa começar a abrir.
//
// A tela é organizada pela pergunta, não pelo modelo: o veredito vem antes
// dos números, e os dois quadros de cenário no fim respondem às duas
// incertezas reais da operação — quantas bombas estarão disponíveis, e de
// que cota vale a pena partir.

import * as db from '../db.js';
import { limitesCav, volumeDaCota } from '../cav.js';
import { amortecerCheia, hidrogramaCheia, cenariosDeBombeamento, cronogramaDeManobras, custoDoAtraso } from '../cheia.js';
import { graficoCheia } from '../charts.js';
import { $, $$, esc, num, toast, comBotao, valorNumerico, paraInputDateTime } from '../ui.js';
import { lerListaNumeros, baixarCsv } from '../planilha.js';

// As duas retiradas de Santana. Vigário bombeia para o sistema; Santa
// Cecília reverte para o Paraíba do Sul. Operações distintas, por isso o
// tipo — a tela não as soma num número só.
const PADRAO_CONJUNTOS = [
  { nome: 'Vigário', tipo: 'bombeamento', unidades: 4, capacidadeUnidade: 50, disponiveis: 4, nivelMinimo: 361.3 },
  { nome: 'Santa Cecília', tipo: 'reversao', unidades: 1, capacidadeUnidade: 30, disponiveis: 1, nivelMinimo: null },
];

const ROTULO_TIPO = { bombeamento: 'Bombeamento', reversao: 'Reversão' };

const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

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

            <label class="opcao-limites">
              <input type="checkbox" id="confAtivo" checked />
              <span>Limites de confiança da afluência
                <small>A previsão é a maior incerteza do problema. Com os limites, a onda e o que
                ela provoca vêm com a faixa em que podem cair.</small></span>
            </label>
            <div class="grade grade-3" id="caixa-confianca">
              <label>Incerteza da afluência (± %)
                <input type="number" id="confPercentual" value="5" step="1" min="0" max="90" />
                <small>Aplicada para cima e para baixo.</small></label>
            </div>
          </div>
          <label class="oculto" id="caixa-serie">Afluência de 15 em 15 min (m³/s)
            <textarea id="serieQaf" rows="4" placeholder="2,0&#10;5,5&#10;12,0"></textarea>
            <small id="info-serie"></small>
          </label>
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
            <label>A cada (passos de 15 min)
              <input type="number" id="vertPassos" value="2" step="1" min="1" />
              <small id="info-rampa"></small>
            </label>
          </div>
          <div class="grade grade-2" style="margin-top:14px">
            <label>Começar a verter a partir da cota (m)
              <input type="number" id="portaoInicio" step="0.01" placeholder="sem restrição" />
              <small>Abaixo dela a comporta fica fechada, mesmo que o cálculo peça abertura.</small>
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

  $('#dataInicial', container).value = paraInputDateTime(new Date());

  const estado = { cav, reservatorio, teto, piso };

  $$('input[name="fonte"]', container).forEach((el) => el.addEventListener('change', () => {
    const serie = $('input[name="fonte"]:checked', container).value === 'serie';
    $('#caixa-triangular', container).classList.toggle('oculto', serie);
    $('#caixa-serie', container).classList.toggle('oculto', !serie);
  }));

  $('#serieQaf', container).addEventListener('input', () => {
    const v = lerListaNumeros($('#serieQaf', container).value);
    $('#info-serie', container).textContent = v.length
      ? `${v.length} valores → ${(v.length / 4).toFixed(2)} h · pico ${num(Math.max(...v))} m³/s` : '';
  });

  const atualizarRampa = () => {
    const d = Number($('#vertDegrau', container).value) || 0;
    const p = Math.max(1, Number($('#vertPassos', container).value) || 1);
    $('#info-rampa', container).textContent =
      `${num(d)} m³/s a cada ${p * 15} min · equivale a ${num(d / p)} m³/s por passo`;
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
  $('#vertPassos', container).addEventListener('input', atualizarRampa);
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
      const resultado = amortecerCheia(cfg);
      const saida = $('#saida', container);
      saida.classList.remove('oculto');
      saida.innerHTML = htmlSaida(resultado, cfg);
      desenhar(resultado, cfg);
      saida.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 'Calculando…');
  });
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

function montarConfig(container, estado) {
  if (!estado.cav) throw new Error('Selecione um reservatório com tabela CAV.');

  const serieEscolhida = $('input[name="fonte"]:checked', container).value === 'serie';
  const hidrograma = serieEscolhida
    ? lerListaNumeros($('#serieQaf', container).value)
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

  const nivelInicial = valorNumerico($('#nivelInicial', container));
  if (nivelInicial == null) throw new Error('Informe o nível na partida.');
  // Teto e piso vêm do cadastro do reservatório, não do formulário.
  const { teto: nivelMaximo, piso: nivelMinimo } = estado;
  if (!Number.isFinite(nivelMaximo) || !Number.isFinite(nivelMinimo)) {
    throw new Error('Cadastre os níveis de emergência do reservatório antes de simular a cheia.');
  }

  return {
    cav: estado.cav,
    reservatorio: estado.reservatorio,
    hidrograma,
    nivelInicial,
    nivelMaximo,
    nivelMinimo,
    conjuntos: lerConjuntos(container),
    confianca: {
      ativo: $('#confAtivo', container).checked,
      percentual: Number($('#confPercentual', container).value) || 0,
    },
    vertedouro: {
      capacidadeMax: Number($('#vertMax', container).value) || 0,
      limiteSemDano: Number($('#vertSemDano', container).value),
      degrau: Number($('#vertDegrau', container).value) || 1,
      passosPorDegrau: Number($('#vertPassos', container).value) || 1,
      portoes: {
        inicio: valorNumerico($('#portaoInicio', container)),
        liberaAcima: valorNumerico($('#portaoLibera', container)),
      },
    },
    dataInicial: new Date($('#dataInicial', container).value || Date.now()),
  };
}

function htmlSaida({ resumo }, cfg) {
  const verdito = !resumo.precisaVerter
    ? ['Não é preciso verter', `pico afluente de ${num(resumo.qafPico)} m³/s absorvido por bombeamento e reservatório`]
    : resumo.dentroDoLimite
      ? [`${num(resumo.picoVert)} m³/s`, `vertimento máximo, dentro do limite de ${num(resumo.limiteSemDano)} m³/s que não alaga`]
      : [`${num(resumo.picoVert)} m³/s`, `vertimento máximo — acima do limite de ${num(resumo.limiteSemDano)} m³/s por ${num(resumo.horasAcimaDoLimite)} h`];

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
        <p class="hero-rotulo">${resumo.precisaVerter ? 'Vertimento necessário' : 'Veredito'}</p>
        <p class="hero-valor">${esc(inteiro)}<span>${esc(decimal || '')}</span></p>
        <p class="hero-apoio">${esc(verdito[1])}</p>
      </div>

      <div class="situacao situacao-${gravidade}">
        <div class="situacao-topo">
          <span class="badge badge-${gravidade === 'ok' ? 'ok' : gravidade}">${
  !resumo.precisaVerter ? 'Sem vertimento' : resumo.dentroDoLimite ? 'Vertimento sem alagar' : 'Alaga ribeirinhos'}</span>
          ${resumo.precisaVerter ? `<span class="situacao-contagem">abrir a comporta a partir de ${hora(resumo.inicioAbertura)}</span>` : ''}
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
  ])}
        ${grupo('Nível', [
    item('Início → máximo', `${num(resumo.cotaInicial)} → ${num(resumo.cotaMaxima)} m`,
      faixa(resumo.limites, 'cotaMaxima', 'm')),
    item('Mínimo no período', `${num(resumo.cotaMinima)} m`),
    item('Teto e piso', `${num(resumo.nivelMaximo)} / ${num(resumo.nivelMinimo)} m`),
  ])}
        ${grupo('Recursos e manobra', [
    item('Volume bombeado', `${num(resumo.volumeBombeado, 2)} hm³`),
    item('Volume revertido', `${num(resumo.volumeRevertido, 2)} hm³`),
    item('Retirada na cota', `${num(resumo.bombeamentoMinimo)} a ${num(resumo.bombeamentoMaximo)} m³/s`),
    item('Manobras', `${resumo.manobras} de ${num(resumo.degrau)} m³/s a cada ${resumo.minutosPorDegrau} min`),
    resumo.antecedenciaMin != null
      ? item('Abertura × bombas no limite',
        resumo.antecedenciaMin > 0
          ? `${num(resumo.antecedenciaMin / 60)} h antes`
          : resumo.antecedenciaMin < 0
            ? `${num(-resumo.antecedenciaMin / 60)} h depois`
            : 'no mesmo instante')
      : '',
  ].filter(Boolean))}
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
      <details class="serie-completa">
        <summary>Ver as manobras uma a uma</summary>
        <div id="cronograma"></div>
      </details>
    </section>

    <section class="painel">
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
    </section>`;
}

function grupo(titulo, itens) {
  return `<div class="metrica-grupo"><h3>${esc(titulo)}</h3>${itens.join('')}</div>`;
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

  $('#cenarios-bombas').innerHTML = tabelaBombas(cenariosDeBombeamento(cfg, 0), cfg);
  $('#cenarios-nivel').innerHTML = tabelaNivel(cfg);

  const cronograma = cronogramaDeManobras(resultado);
  $('#cronograma').innerHTML = tabelaCronograma(cronograma);
  $('#cronograma-resumo').innerHTML = cronograma.length
    ? `<strong>${cronograma.length} manobras</strong> de ${num(resumo.degrau)} m³/s a cada
       ${resumo.minutosPorDegrau} min. A primeira às <strong>${hora(cronograma[0].dataHora)}</strong>,
       levando a comporta a ${num(cronograma[0].abertura)} m³/s.`
    : 'A comporta permanece fechada durante todo o evento.';
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

  const nome = (cfg.reservatorio?.nome || 'cheia').replace(/\W+/g, '-').toLowerCase();
  $('#btn-exportar-cronograma').onclick = () => baixarCsv(`manobras-${nome}.csv`,
    ['Data/hora', 'Abertura alvo (m³/s)', 'Variação (m³/s)', 'Cota (m)', 'Afluência (m³/s)', 'Acima do limite'],
    cronograma.map((m) => [hora(m.dataHora), m.abertura.toFixed(1), m.variacao.toFixed(1),
      m.cota.toFixed(2), m.qaf.toFixed(1), m.acimaDoLimite ? 'sim' : 'não']));

  $('#btn-exportar-serie').onclick = () => baixarCsv(`cheia-${nome}.csv`,
    ['Passo', 'Data/hora', 'Afluente (m³/s)', 'Bombeado (m³/s)', 'Vertido (m³/s)',
      'Retirada total (m³/s)', 'Volume (hm³)', 'Cota (m)'],
    serie.map((p) => [p.passo, hora(p.dataHora), p.qaf.toFixed(2), p.qbomb.toFixed(2),
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
