// Amortecimento de cheia: decide se será preciso verter, quanto, e a partir
// de que hora a comporta precisa começar a abrir.
//
// A tela é organizada pela pergunta, não pelo modelo: o veredito vem antes
// dos números, e os dois quadros de cenário no fim respondem às duas
// incertezas reais da operação — quantas bombas estarão disponíveis, e de
// que cota vale a pena partir.

import * as db from '../db.js';
import { limitesCav } from '../cav.js';
import { amortecerCheia, hidrogramaTriangular, cenariosDeBombeamento, cronogramaDeManobras, custoDoAtraso } from '../cheia.js';
import { graficoNivel, graficoNivelVertimento, graficoAfluenteVertimento, graficoVertimento, graficoAfluenteSaida, graficoBombeamento } from '../charts.js';
import { $, $$, esc, num, toast, comBotao, valorNumerico, paraInputDateTime } from '../ui.js';
import { lerListaNumeros, baixarCsv } from '../planilha.js';

const PADRAO_CONJUNTOS = [
  { nome: 'Vigário', unidades: 4, capacidadeUnidade: 50, disponiveis: 4, nivelMinimo: 361.3 },
  { nome: 'Santa Cecília', unidades: 1, capacidadeUnidade: 30, disponiveis: 1, nivelMinimo: null },
];

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
  const captacao = nivelDeCaptacao(reservatorio);
  const conjuntos = PADRAO_CONJUNTOS.map((c, i) => ({
    ...c,
    nivelMinimo: i === 0 && Number.isFinite(captacao) ? captacao : c.nivelMinimo,
  }));

  const inicialPadrao = Number.isFinite(reservatorio?.nivelMaxOperacional)
    ? reservatorio.nivelMaxOperacional
    : (Number.isFinite(teto) && Number.isFinite(piso) ? (teto + piso) / 2 : l ? (l.cotaMin + l.cotaMax) / 2 : 0);

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Amortecimento de cheia</h2>
          <p class="ajuda">${reservatorio
    ? `${esc(reservatorio.nome)}${reservatorio.usinaNome ? ` · ${esc(reservatorio.usinaNome)}` : ''} — calcula se será necessário verter, qual o pico e a partir de que hora a comporta precisa começar a abrir.`
    : 'Nenhum reservatório com tabela CAV importada.'}</p>
        </div>
      </div>

      ${pronto ? `
      <div class="referencias">
        <div class="referencia"><span>Teto — máx. emergencial</span><strong>${num(teto)} m</strong></div>
        <div class="referencia"><span>Piso — mín. emergencial</span><strong>${num(piso)} m</strong></div>
        <div class="referencia"><span>Faixa da CAV</span><strong>${num(l.cotaMin)} a ${num(l.cotaMax)} m</strong></div>
        <div class="referencia"><span>Volume útil</span><strong>${num(l.volumeMax - l.volumeMin, 3)} hm³</strong></div>
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
              <input type="radio" name="fonte" value="triangular" checked style="width:auto" /> Hidrograma triangular
            </label>
            <label style="flex-direction:row;align-items:center;gap:6px;flex:0 0 auto">
              <input type="radio" name="fonte" value="serie" style="width:auto" /> Série medida
            </label>
          </div>
          <div class="grade grade-3" id="caixa-triangular">
            <label>Vazão de base (m³/s)<input type="number" id="qBase" value="2" step="0.1" /></label>
            <label>Pico (m³/s)<input type="number" id="qPico" value="600" step="1" /></label>
            <label>Subida (h)<input type="number" id="hSubida" value="8" step="0.25" /></label>
            <label>Recessão (h)<input type="number" id="hRecessao" value="8" step="0.25" /></label>
            <label>Antes do evento (h)<input type="number" id="hAntes" value="1" step="0.25" /></label>
            <label>Depois (h)<input type="number" id="hDepois" value="4" step="0.25" /></label>
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
              <small>Entre o piso e o teto do cadastro. A tabela ao fim mostra o efeito de partir mais baixo.</small>
            </label>
            <label>Início do evento
              <input type="datetime-local" id="dataInicial" />
              <small>Usado para datar o cronograma de manobra.</small>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Bombeamento disponível agora</legend>
          <div id="conjuntos">${conjuntos.map(blocoConjunto).join('')}</div>
          <details class="ajuste-fino">
            <summary>Ajustar características dos conjuntos</summary>
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
      $('[data-resumo]', bloco).textContent =
        `${num(disp * cap)} m³/s` + (Number.isFinite(nivel) ? ` · capta acima de ${num(nivel)} m` : '');
    }
  };
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
    <div class="conjunto" data-conjunto="${i}">
      <span class="conjunto-nome">${esc(c.nome)}</span>
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
    };
  });
}

function montarConfig(container, estado) {
  if (!estado.cav) throw new Error('Selecione um reservatório com tabela CAV.');

  const serieEscolhida = $('input[name="fonte"]:checked', container).value === 'serie';
  const hidrograma = serieEscolhida
    ? lerListaNumeros($('#serieQaf', container).value)
    : hidrogramaTriangular({
      base: Number($('#qBase', container).value) || 0,
      pico: Number($('#qPico', container).value) || 0,
      horasSubida: Number($('#hSubida', container).value) || 1,
      horasRecessao: Number($('#hRecessao', container).value) || 1,
      horasAntes: Number($('#hAntes', container).value) || 0,
      horasDepois: Number($('#hDepois', container).value) || 0,
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
    vertedouro: {
      capacidadeMax: Number($('#vertMax', container).value) || 0,
      limiteSemDano: Number($('#vertSemDano', container).value),
      degrau: Number($('#vertDegrau', container).value) || 1,
      passosPorDegrau: Number($('#vertPassos', container).value) || 1,
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
        ${resumo.estourouTeto ? `<p class="situacao-tipos"><strong>O nível ultrapassa o teto de ${num(resumo.nivelMaximo)} m</strong> em ${num(resumo.excedenteSobreTeto, 3)} hm³: os recursos informados não seguram esta cheia.</p>` : ''}
        ${resumo.rampaInsuficiente ? '<p class="situacao-tipos"><strong>O degrau de manobra não acompanha.</strong> A comporta precisaria abrir mais rápido do que o informado para conter o nível.</p>' : ''}
        ${resumo.seguraOPiso ? '' : `<p class="situacao-tipos"><strong>O nível fura o mínimo de ${num(resumo.nivelMinimo)} m</strong> mesmo com a retirada zerada: a afluência não repõe o que sai.</p>`}
        ${resumo.precisaVerter ? `<p class="situacao-tipos">
          ${resumo.bombeamentoNoMaximoAoVerter
    ? 'O bombeamento fica no máximo que a cota permite durante todo o vertimento — a comporta é o último recurso.'
    : '<strong>Atenção:</strong> há passos vertendo com bombeamento abaixo do disponível.'}
          ${resumo.antecedenciaMin > 0
    ? ` A comporta começa a abrir <strong>${num(resumo.antecedenciaMin / 60)} h antes</strong> de a afluência superar o bombeamento — não por sobrar bomba, mas porque o degrau de ${num(resumo.degrau)} m³/s a cada ${resumo.minutosPorDegrau} min precisa desse tempo para chegar ao pico. Esperar faria o nível passar do teto.`
    : resumo.antecedenciaMin < 0
      ? ` A comporta só abre <strong>${num(-resumo.antecedenciaMin / 60)} h depois</strong> de a afluência superar o bombeamento: nesse intervalo o próprio reservatório absorveu o excedente.`
      : ''}
        </p>` : ''}
      </div>

      <div class="metricas">
        ${grupo('Vertimento', [
    item('Pico', `${num(resumo.picoVert)} m³/s`),
    item('No instante', hora(resumo.instantePico)),
    item('Volume vertido', `${num(resumo.volumeVertido, 2)} hm³`),
  ])}
        ${grupo(`Acima de ${num(resumo.limiteSemDano)} m³/s`, [
    item('Duração', resumo.horasAcimaDoLimite ? `${num(resumo.horasAcimaDoLimite)} h` : 'não ocorre'),
    item('A partir de', hora(resumo.inicioAcimaDoLimite)),
    item('Volume excedente', `${num(resumo.volumeAcimaDoLimite, 2)} hm³`),
  ])}
        ${grupo('Nível', [
    item('Início → máximo', `${num(resumo.cotaInicial)} → ${num(resumo.cotaMaxima)} m`),
    item('Teto', `${num(resumo.nivelMaximo)} m`),
    item('Mínimo no período', `${num(resumo.cotaMinima)} m`),
  ])}
        ${grupo('Bombeamento', [
    item('Volume bombeado', `${num(resumo.volumeBombeado, 2)} hm³`),
    item('Capacidade na cota', `${num(resumo.bombeamentoMinimo)} a ${num(resumo.bombeamentoMaximo)} m³/s`),
    resumo.passosComRetiradaReduzida
      ? item('Retirada reduzida', `${resumo.passosComRetiradaReduzida} passos, para não furar o mínimo`)
      : '',
  ].filter(Boolean))}
        ${grupo('Manobra da comporta', [
    item('Degrau', `${num(resumo.degrau)} m³/s a cada ${resumo.minutosPorDegrau} min`),
    item('Manobras no evento', `${resumo.manobras}`),
    resumo.antecedenciaMin != null
      ? item('Abertura × saturação das bombas',
        resumo.antecedenciaMin > 0
          ? `${num(resumo.antecedenciaMin / 60)} h antes`
          : resumo.antecedenciaMin < 0
            ? `${num(-resumo.antecedenciaMin / 60)} h depois`
            : 'no mesmo instante')
      : '',
  ].filter(Boolean))}
      </div>

      <div class="graficos">
        <div class="grafico-caixa alta"><canvas id="g-cheia-nivel"></canvas></div>
        <div class="grafico-caixa alta"><canvas id="g-cheia-amort"></canvas></div>
        <div class="grafico-caixa alta"><canvas id="g-cheia-nivelvert"></canvas></div>
        <div class="graficos-par">
          <div class="grafico-caixa"><canvas id="g-cheia-vert"></canvas></div>
          <div class="grafico-caixa"><canvas id="g-cheia-afl"></canvas></div>
        </div>
        <div class="graficos-par">
          <div class="grafico-caixa"><canvas id="g-cheia-bomb"></canvas></div>
        </div>
      </div>
    </section>

    <section class="painel">
      <h2>Cronograma de manobras</h2>
      <p class="ajuda">O que executar na comporta, manobra a manobra. Entre uma linha e outra a abertura
      fica parada.</p>
      <div id="cronograma"></div>
    </section>

    <section class="painel">
      <h2>Se a abertura atrasar</h2>
      <p class="ajuda">O cronograma acima executado tarde, como se a decisão demorasse. Mede a folga que
      existe depois da hora marcada — e onde ela acaba.</p>
      <div id="atraso"></div>
    </section>

    <section class="painel">
      <h2>Se faltarem bombas</h2>
      <p class="ajuda">A disponibilidade de ${esc(cfg.conjuntos[0]?.nome || 'bombeamento')} é a maior incerteza:
      grade entupida pelo lixo da cheia, unidade em manutenção. Abaixo, o mesmo evento com cada disponibilidade.</p>
      <div id="cenarios-bombas"></div>
    </section>

    <section class="painel">
      <h2>Se o reservatório partir mais baixo</h2>
      <p class="ajuda">Deplecionar antes cria volume de espera — mas abaixo do nível de captação a elevatória para
      de bombear, e o remédio pode virar veneno.</p>
      <div id="cenarios-nivel"></div>
    </section>`;
}

function grupo(titulo, itens) {
  return `<div class="metrica-grupo"><h3>${esc(titulo)}</h3>${itens.join('')}</div>`;
}
function item(rotulo, valor) {
  return `<div class="metrica"><span>${esc(rotulo)}</span><strong>${valor}</strong></div>`;
}

function desenhar(resultado, cfg) {
  const { serie, resumo } = resultado;
  graficoNivel('g-cheia-nivel', serie,
    { nivelMaxEmergencial: cfg.nivelMaximo, nivelMinEmergencial: cfg.nivelMinimo }, []);
  graficoAfluenteVertimento('g-cheia-amort', serie, resumo.limiteSemDano);
  graficoNivelVertimento('g-cheia-nivelvert', serie, {
    nivelMaximo: cfg.nivelMaximo, nivelMinimo: cfg.nivelMinimo, limiteSemDano: resumo.limiteSemDano,
  });
  graficoVertimento('g-cheia-vert', serie, resumo.limiteSemDano);
  graficoAfluenteSaida('g-cheia-afl', serie);
  graficoBombeamento('g-cheia-bomb', serie);

  $('#cenarios-bombas').innerHTML = tabelaBombas(cenariosDeBombeamento(cfg, 0), cfg);
  $('#cenarios-nivel').innerHTML = tabelaNivel(cfg);

  const cronograma = cronogramaDeManobras(resultado);
  $('#cronograma').innerHTML = tabelaCronograma(cronograma, resumo);
  $('#atraso').innerHTML = tabelaAtraso(custoDoAtraso(cfg), resumo);

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


function tabelaCronograma(linhas, resumo) {
  if (!linhas.length) return '<p class="vazio">Nenhuma manobra: a comporta permanece fechada.</p>';
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>Quando</th><th>Ação</th><th class="num">Abertura alvo</th>
      <th class="num">Variação</th><th class="num">Cota no instante</th><th class="num">Afluência</th></tr></thead>
    <tbody>${linhas.map((m) => `
      <tr class="${m.acimaDoLimite ? 'violacao-atencao' : ''}">
        <td><strong>${hora(m.dataHora)}</strong></td>
        <td>${m.variacao > 0 ? 'Abrir' : 'Fechar'}${m.acimaDoLimite ? ' · alaga' : ''}</td>
        <td class="num"><strong>${num(m.abertura)} m³/s</strong></td>
        <td class="num">${m.variacao > 0 ? '+' : '−'}${num(Math.abs(m.variacao))}</td>
        <td class="num">${num(m.cota)} m</td>
        <td class="num">${num(m.qaf)} m³/s</td>
      </tr>`).join('')}</tbody></table></div>
    <p class="ajuda" style="margin-top:12px">${linhas.length} manobras, de ${num(resumo.degrau)} m³/s
    a cada ${resumo.minutosPorDegrau} min.</p>`;
}

function tabelaAtraso(linhas, resumo) {
  const ultimaOk = [...linhas].reverse().find((l) => !l.estourouTeto);
  const folga = ultimaOk ? ultimaOk.atrasoMin : 0;
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>Atraso na abertura</th><th class="num">Pico vertido</th>
      <th class="num">Horas acima do limite</th><th class="num">Cota máx.</th><th>Situação</th></tr></thead>
    <tbody>${linhas.map((l) => `
      <tr class="${l.estourouTeto ? 'violacao-critico' : ''}">
        <td><strong>${l.atrasoMin ? `${l.atrasoMin} min` : 'no horário'}</strong></td>
        <td class="num">${num(l.picoVert)} m³/s</td>
        <td class="num">${l.horasAcimaDoLimite ? num(l.horasAcimaDoLimite) : '—'}</td>
        <td class="num">${num(l.cotaMaxima)} m</td>
        <td>${l.estourouTeto ? `passa do teto em ${num(l.excedenteSobreTeto, 2)} hm³` : 'ainda segura'}</td>
      </tr>`).join('')}</tbody></table></div>
    <p class="ajuda" style="margin-top:12px">${folga
    ? `Há cerca de <strong>${folga} min</strong> de folga depois da hora marcada (${hora(resumo.inicioAbertura)}) antes de o nível passar do teto.`
    : 'Não há folga: qualquer atraso na abertura faz o nível passar do teto.'}</p>`;
}

function tabelaBombas(cenarios, cfg) {
  if (!cenarios.length) return '<p class="vazio">Sem conjunto de bombeamento configurado.</p>';
  const nome = cfg.conjuntos[0].nome;
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>${esc(nome)}</th><th class="num">Retirada</th><th class="num">Pico vertido</th>
      <th class="num">Horas acima do limite</th><th class="num">Cota máx.</th><th>Situação</th></tr></thead>
    <tbody>${cenarios.map((c) => `
      <tr class="${c.estourouTeto ? 'violacao-critico' : c.dentroDoLimite ? '' : 'violacao-atencao'}">
        <td><strong>${c.disponiveis}</strong> de ${cfg.conjuntos[0].unidades}</td>
        <td class="num">${num(c.bombeamento)} m³/s</td>
        <td class="num">${num(c.picoVert)} m³/s</td>
        <td class="num">${c.horasAcimaDoLimite ? num(c.horasAcimaDoLimite) : '—'}</td>
        <td class="num">${num(c.cotaMaxima)} m</td>
        <td>${c.estourouTeto ? 'não segura' : c.dentroDoLimite ? 'sem alagar' : 'alaga'}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

function tabelaNivel(cfg) {
  const passo = 0.25;
  const linhas = [];
  for (let d = 0; d <= 8; d++) {
    const nivelInicial = +(cfg.nivelInicial - d * passo).toFixed(2);
    if (cfg.nivelMinimo != null && nivelInicial < cfg.nivelMinimo - 1e-9) break;
    const r = amortecerCheia({ ...cfg, nivelInicial });
    linhas.push({ nivelInicial, ...r.resumo });
  }
  return `<div class="tabela-scroll"><table>
    <thead><tr><th>Nível na partida</th><th class="num">Pico vertido</th><th class="num">Horas acima do limite</th>
      <th class="num">Cota máx.</th><th class="num">Bombeamento mín.</th><th>Situação</th></tr></thead>
    <tbody>${linhas.map((l) => `
      <tr class="${l.estourouTeto ? 'violacao-critico' : l.dentroDoLimite ? '' : 'violacao-atencao'}">
        <td><strong>${num(l.nivelInicial)} m</strong></td>
        <td class="num">${num(l.picoVert)} m³/s</td>
        <td class="num">${l.horasAcimaDoLimite ? num(l.horasAcimaDoLimite) : '—'}</td>
        <td class="num">${num(l.cotaMaxima)} m</td>
        <td class="num">${num(l.bombeamentoMinimo)} m³/s</td>
        <td>${l.estourouTeto ? 'não segura' : l.precisaVerter ? (l.dentroDoLimite ? 'sem alagar' : 'alaga') : 'sem verter'}</td>
      </tr>`).join('')}</tbody></table></div>`;
}
