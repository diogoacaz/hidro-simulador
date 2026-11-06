// Amortecimento de cheia: decide se será preciso verter, quanto, e a partir
// de que hora a comporta precisa começar a abrir.
//
// A tela é organizada pela pergunta, não pelo modelo: o veredito vem antes
// dos números, e os dois quadros de cenário no fim respondem às duas
// incertezas reais da operação — quantas bombas estarão disponíveis, e de
// que cota vale a pena partir.

import * as db from '../db.js';
import { limitesCav } from '../cav.js';
import { amortecerCheia, hidrogramaTriangular, cenariosDeBombeamento } from '../cheia.js';
import { graficoNivel, graficoVertimento, graficoAfluenteSaida, graficoBombeamento } from '../charts.js';
import { $, $$, esc, num, toast, comBotao, valorNumerico, paraInputDateTime } from '../ui.js';
import { lerListaNumeros } from '../planilha.js';

const PADRAO_CONJUNTOS = [
  { nome: 'Vigário', unidades: 4, capacidadeUnidade: 50, disponiveis: 4, nivelMinimo: 361.3 },
  { nome: 'Santa Cecília', unidades: 1, capacidadeUnidade: 30, disponiveis: 1, nivelMinimo: null },
];

const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export async function render(container) {
  const reservatorios = (await db.listarReservatorios()).filter((r) => r.cavResumo);

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Amortecimento de cheia</h2>
          <p class="ajuda">Calcula se será necessário verter, qual o pico e a partir de que hora a comporta
          precisa começar a abrir — respeitando a abertura gradual.</p>
        </div>
      </div>

      ${reservatorios.length ? '' : '<div class="alerta alerta-aviso">Nenhum reservatório com tabela CAV importada.</div>'}

      <!-- novalidate pela mesma razão do formulário de simulação: um campo
           inválido (inclusive escondido, ou fora da grade de step) cancela o
           submit sem o navegador conseguir mostrar a mensagem. A validação de
           montarConfig cobre os casos com mensagem melhor. -->
      <form id="form-cheia" novalidate>
        <div class="grade grade-2">
          <label>Reservatório
            <select id="reservatorio" ${reservatorios.length ? '' : 'disabled'}>
              ${reservatorios.map((r) => `<option value="${r.id}">${esc(r.nome)}${r.usinaNome ? ` — ${esc(r.usinaNome)}` : ''}</option>`).join('')}
            </select>
          </label>
          <label>Início do evento
            <input type="datetime-local" id="dataInicial" />
          </label>
        </div>
        <p class="ajuda" id="info-cav"></p>

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
          <div class="grade" id="caixa-triangular">
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
          <legend>Reservatório na partida</legend>
          <div class="grade">
            <label>Nível inicial (m)<input type="number" id="nivelInicial" step="0.01" /></label>
            <label>Nível máximo a respeitar (m)<input type="number" id="nivelMaximo" step="0.01" /></label>
            <label>Nível mínimo de referência (m)<input type="number" id="nivelMinimo" step="0.01" /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Bombeamento</legend>
          <div id="conjuntos"></div>
        </fieldset>

        <fieldset>
          <legend>Vertedouro</legend>
          <div class="grade">
            <label>Capacidade máxima (m³/s)<input type="number" id="vertMax" value="1200" step="10" /></label>
            <label>Limite sem alagar (m³/s)<input type="number" id="vertSemDano" value="30" step="1" /></label>
            <label>Abertura gradual (m³/s por 15 min)
              <input type="number" id="vertRampa" value="5" step="any" min="0.1" />
              <small>Quanto a comporta pode variar a cada passo, para não gerar onda.</small>
            </label>
          </div>
        </fieldset>

        <div class="acoes">
          <button type="submit" class="primario" ${reservatorios.length ? '' : 'disabled'}>Calcular amortecimento</button>
        </div>
      </form>
    </section>

    <div id="saida" class="oculto"></div>`;

  $('#dataInicial', container).value = paraInputDateTime(new Date());
  renderConjuntos(container);

  const estado = { cav: null, reservatorio: null };

  const carregar = async () => {
    const id = $('#reservatorio', container).value;
    if (!id) return;
    estado.reservatorio = reservatorios.find((r) => r.id === id);
    estado.cav = await db.obterCav(id);
    if (!estado.cav) { $('#info-cav', container).innerHTML = '<span class="erro">Sem tabela CAV.</span>'; return; }
    const l = limitesCav(estado.cav);
    $('#info-cav', container).innerHTML =
      `Faixa da CAV: <strong>${num(l.cotaMin)} m</strong> a <strong>${num(l.cotaMax)} m</strong> · volume útil <strong>${num(l.volumeMax - l.volumeMin, 3)} hm³</strong>`;
    const r = estado.reservatorio;
    defineSeVazio($('#nivelMaximo', container), r.nivelMaxEmergencial ?? l.cotaMax);
    defineSeVazio($('#nivelMinimo', container), r.nivelMinEmergencial ?? l.cotaMin);
    defineSeVazio($('#nivelInicial', container), ((l.cotaMin + l.cotaMax) / 2));
  };

  $('#reservatorio', container).addEventListener('change', carregar);
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

  await carregar();
}

function defineSeVazio(input, valor) {
  if (!input.value && Number.isFinite(Number(valor))) input.value = Number(valor).toFixed(2);
}

function renderConjuntos(container) {
  $('#conjuntos', container).innerHTML = PADRAO_CONJUNTOS.map((c, i) => `
    <div class="grade" data-conjunto="${i}" style="margin-bottom:10px">
      <label>Conjunto<input type="text" data-campo="nome" value="${esc(c.nome)}" /></label>
      <label>Unidades<input type="number" data-campo="unidades" value="${c.unidades}" min="0" step="1" /></label>
      <label>Vazão por unidade (m³/s)<input type="number" data-campo="capacidadeUnidade" value="${c.capacidadeUnidade}" min="0" step="1" /></label>
      <label>Disponíveis agora<input type="number" data-campo="disponiveis" value="${c.disponiveis}" min="0" step="1" /></label>
      <label>Nível mín. de captação (m)
        <input type="number" data-campo="nivelMinimo" value="${c.nivelMinimo ?? ''}" step="0.01" placeholder="sem limite" />
      </label>
    </div>`).join('');
}

function lerConjuntos(container) {
  return $$('[data-conjunto]', container).map((bloco) => ({
    nome: $('[data-campo="nome"]', bloco).value.trim() || 'Conjunto',
    unidades: Number($('[data-campo="unidades"]', bloco).value) || 0,
    capacidadeUnidade: Number($('[data-campo="capacidadeUnidade"]', bloco).value) || 0,
    disponiveis: Number($('[data-campo="disponiveis"]', bloco).value) || 0,
    nivelMinimo: valorNumerico($('[data-campo="nivelMinimo"]', bloco)),
  }));
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
  const nivelMaximo = valorNumerico($('#nivelMaximo', container));
  if (nivelInicial == null) throw new Error('Informe o nível inicial.');
  if (nivelMaximo == null) throw new Error('Informe o nível máximo a respeitar.');

  return {
    cav: estado.cav,
    reservatorio: estado.reservatorio,
    hidrograma,
    nivelInicial,
    nivelMaximo,
    nivelMinimo: valorNumerico($('#nivelMinimo', container)),
    conjuntos: lerConjuntos(container),
    vertedouro: {
      capacidadeMax: Number($('#vertMax', container).value) || 0,
      limiteSemDano: Number($('#vertSemDano', container).value),
      rampa: Number($('#vertRampa', container).value) || 1,
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
        ${resumo.rampaInsuficiente ? '<p class="situacao-tipos"><strong>A taxa de abertura não acompanha.</strong> A comporta precisaria abrir mais rápido do que o informado para conter o nível.</p>' : ''}
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
  ])}
      </div>

      <div class="graficos">
        <div class="grafico-caixa alta"><canvas id="g-cheia-nivel"></canvas></div>
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
  graficoVertimento('g-cheia-vert', serie, resumo.limiteSemDano);
  graficoAfluenteSaida('g-cheia-afl', serie);
  graficoBombeamento('g-cheia-bomb', serie);

  $('#cenarios-bombas').innerHTML = tabelaBombas(cenariosDeBombeamento(cfg, 0), cfg);
  $('#cenarios-nivel').innerHTML = tabelaNivel(cfg);
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
