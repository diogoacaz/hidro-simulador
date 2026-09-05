// Tela de simulação: o usuário informa quatro das cinco variáveis
// (Q afluente, Q defluente, nível inicial, nível final, tempo) e o motor resolve a quinta.

import * as db from '../db.js';
import { limitesCav } from '../cav.js';
import { simular, MODOS, ROTULOS_MODO, formatarDuracao } from '../simulation.js';
import { lerArquivo, removerCabecalho, paraNumero } from '../planilha.js';
import { $, $$, esc, num, toast, comBotao, valorNumerico, paraInputDateTime } from '../ui.js';
import * as resultadoView from './resultado.js';

// Campos exigidos por modo (o campo ausente é a incógnita).
const NECESSARIOS = {
  [MODOS.TEMPO]: ['qaf', 'qdef', 'nivelInicial', 'nivelFinal'],
  [MODOS.QAF]: ['qdef', 'nivelInicial', 'nivelFinal', 'duracao'],
  [MODOS.NIVEL_FINAL]: ['qaf', 'qdef', 'nivelInicial', 'duracao'],
  [MODOS.NIVEL_INICIAL]: ['qaf', 'qdef', 'nivelFinal', 'duracao'],
  [MODOS.QDEF]: ['qaf', 'nivelInicial', 'nivelFinal', 'duracao'],
};

const DESCRICOES = {
  [MODOS.TEMPO]: 'Calcula quanto tempo leva para o nível sair da cota inicial e chegar à cota alvo com as vazões informadas.',
  [MODOS.QAF]: 'Estima a afluência média equivalente a partir da variação de nível observada no período.',
  [MODOS.NIVEL_FINAL]: 'Prevê a cota ao fim do período com as vazões e o nível inicial informados.',
  [MODOS.NIVEL_INICIAL]: 'Reconstitui a cota no início do período a partir da cota final e das vazões.',
  [MODOS.QDEF]: 'Define a defluência média necessária para atingir a cota alvo no prazo informado.',
};

const UNIDADES = { min: 1 / 15, h: 4, d: 96 }; // passos de 15 min por unidade

export async function render(container) {
  const reservatorios = await db.listarReservatorios();
  const comCav = reservatorios.filter((r) => r.cavResumo);

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Nova simulação</h2>
          <p class="ajuda">Balanço hídrico em passos de 15 minutos, com conversão volume ↔ nível pela tabela CAV.</p>
        </div>
      </div>

      ${reservatorios.length === 0
        ? '<div class="alerta alerta-aviso">Cadastre uma usina e um reservatório antes de simular.</div>'
        : comCav.length === 0
          ? '<div class="alerta alerta-aviso">Nenhum reservatório tem tabela CAV importada. Importe a CAV na aba Reservatórios.</div>'
          : ''}

      <form id="form-simulacao">
        <div class="grade grade-2">
          <label>Reservatório
            <select id="reservatorio" ${comCav.length ? '' : 'disabled'}>
              ${comCav.map((r) => `<option value="${r.id}">${esc(r.nome)}${r.usinaNome ? ` — ${esc(r.usinaNome)}` : ''}</option>`).join('')}
            </select>
          </label>
          <label>Modo de cálculo
            <select id="modo">
              <option value="${MODOS.NIVEL_FINAL}">Calcular nível final</option>
              <option value="${MODOS.TEMPO}">Calcular tempo</option>
              <option value="${MODOS.QAF}">Calcular vazão afluente</option>
              <option value="${MODOS.QDEF}">Calcular vazão defluente</option>
              <option value="${MODOS.NIVEL_INICIAL}">Calcular nível inicial</option>
            </select>
          </label>
        </div>
        <p class="ajuda" id="descricao-modo"></p>
        <div id="info-cav" class="ajuda"></div>

        <div class="grade grade-2" style="margin-top:6px">
          <label>Início da simulação
            <input type="datetime-local" id="dataInicial" />
            <small>Usado para verificar a vigência das restrições.</small>
          </label>
          <label data-campo="duracao">Duração
            <span class="linha-inline" style="gap:6px">
              <input type="number" id="duracao" value="24" min="0.25" step="0.25" style="flex:2" />
              <select id="duracao-unidade" style="flex:1">
                <option value="h" selected>horas</option>
                <option value="min">minutos</option>
                <option value="d">dias</option>
              </select>
            </span>
            <small id="info-passos"></small>
          </label>
          <label data-campo="nivelInicial">Nível inicial (m)
            <input type="number" id="nivelInicial" step="0.01" />
          </label>
          <label data-campo="nivelFinal">Nível final / alvo (m)
            <input type="number" id="nivelFinal" step="0.01" />
          </label>
        </div>

        ${blocoVazao('qaf', 'Vazão afluente')}
        ${blocoVazao('qdef', 'Vazão defluente')}

        <div class="acoes">
          <button type="submit" class="primario" id="btn-simular" ${comCav.length ? '' : 'disabled'}>Simular</button>
          <button type="button" id="btn-salvar" disabled>Salvar simulação</button>
        </div>
      </form>
    </section>

    <div id="area-resultado" class="oculto">${resultadoView.html()}</div>`;

  $('#dataInicial', container).value = paraInputDateTime(new Date());

  const estado = { cav: null, reservatorio: null, ultimo: null };

  // --- Carregamento do reservatório ---

  const carregarReservatorio = async () => {
    const id = $('#reservatorio', container).value;
    if (!id) return;
    estado.reservatorio = reservatorios.find((r) => r.id === id);
    estado.cav = await db.obterCav(id);
    const info = $('#info-cav', container);
    if (!estado.cav) {
      info.innerHTML = '<span class="erro">Este reservatório não tem tabela CAV.</span>';
      return;
    }
    const l = limitesCav(estado.cav);
    info.innerHTML = `Faixa da CAV: <strong>${num(l.cotaMin)} m</strong> a <strong>${num(l.cotaMax)} m</strong>
      (${num(l.volumeMin)} a ${num(l.volumeMax)} hm³) · limites operacionais:
      ${fmt(estado.reservatorio.nivelMinOperacional)} a ${fmt(estado.reservatorio.nivelMaxOperacional)} m`;
    for (const campo of ['nivelInicial', 'nivelFinal']) {
      const input = $(`#${campo}`, container);
      input.min = l.cotaMin;
      input.max = l.cotaMax;
      if (!input.value) input.value = ((l.cotaMin + l.cotaMax) / 2).toFixed(2);
    }
  };

  // --- Visibilidade por modo ---

  const aplicarModo = () => {
    const modo = $('#modo', container).value;
    const necessarios = NECESSARIOS[modo];
    $$('[data-campo]', container).forEach((el) => {
      el.classList.toggle('oculto', !necessarios.includes(el.dataset.campo));
    });
    $('#descricao-modo', container).textContent = DESCRICOES[modo];
    atualizarPassos();
  };

  const passosDaDuracao = () => {
    const valor = Number($('#duracao', container).value) || 0;
    const unidade = $('#duracao-unidade', container).value;
    return Math.max(1, Math.round(valor * UNIDADES[unidade]));
  };

  const atualizarPassos = () => {
    const modo = $('#modo', container).value;
    const info = $('#info-passos', container);
    if (!NECESSARIOS[modo].includes('duracao')) { info.textContent = ''; return; }
    const passos = passosDaDuracao();
    info.textContent = `${passos} passos de 15 min (${formatarDuracao(passos * 15)})`;
  };

  $('#modo', container).addEventListener('change', aplicarModo);
  $('#duracao', container).addEventListener('input', atualizarPassos);
  $('#duracao-unidade', container).addEventListener('change', atualizarPassos);
  $('#reservatorio', container).addEventListener('change', () => carregarReservatorio());

  // --- Vazões: constante × série ---

  for (const chave of ['qaf', 'qdef']) {
    const bloco = $(`[data-campo="${chave}"]`, container);
    bloco.addEventListener('change', (e) => {
      if (e.target.name === `${chave}-tipo`) {
        const serie = e.target.value === 'serie';
        $(`#${chave}-constante-caixa`, bloco).classList.toggle('oculto', serie);
        $(`#${chave}-serie-caixa`, bloco).classList.toggle('oculto', !serie);
      }
      if (e.target.id === `${chave}-arquivo`) {
        carregarSerieDeArquivo(chave, bloco, e.target.files[0]);
      }
    });
    $(`#${chave}-serie`, bloco).addEventListener('input', () => atualizarInfoSerie(chave, bloco));
  }

  const atualizarInfoSerie = (chave, bloco) => {
    const valores = lerSerie($(`#${chave}-serie`, bloco).value);
    const info = $(`#${chave}-info`, bloco);
    info.textContent = valores.length
      ? `${valores.length} valores → ${formatarDuracao(valores.length * 15)} de hidrograma`
      : '';
  };

  const carregarSerieDeArquivo = async (chave, bloco, arquivo) => {
    if (!arquivo) return;
    try {
      const matriz = removerCabecalho(await lerArquivo(arquivo));
      // Usa a última coluna numérica de cada linha (aceita "data;vazão" ou só "vazão").
      const valores = matriz
        .map((linha) => [...linha].reverse().map(paraNumero).find(Number.isFinite))
        .filter(Number.isFinite);
      if (!valores.length) throw new Error('Nenhum valor numérico encontrado no arquivo.');
      $(`#${chave}-serie`, bloco).value = valores.join('\n');
      atualizarInfoSerie(chave, bloco);
      toast(`${valores.length} valores carregados.`, 'ok');
    } catch (err) {
      toast(err.message, 'erro');
    }
  };

  // --- Execução ---

  $('#form-simulacao', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao($('#btn-simular', container), async () => {
      const cfg = montarConfig(container, estado);
      const resultado = simular(cfg);
      estado.ultimo = { cfg, resultado };

      const area = $('#area-resultado', container);
      area.classList.remove('oculto');
      resultadoView.preencher(area, {
        resultado,
        reservatorio: estado.reservatorio,
        limites: cfg.limites,
        restricoes: cfg.restricoes,
        contexto: `${estado.reservatorio.nome} · modo: calcular ${ROTULOS_MODO[cfg.modo].toLowerCase()} · início ${new Date(cfg.dataInicial).toLocaleString('pt-BR')}`,
      });
      $('#btn-salvar', container).disabled = false;
      area.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 'Simulando…');
  });

  $('#btn-salvar', container).addEventListener('click', async (e) => {
    if (!estado.ultimo) return;
    await comBotao(e.target, async () => {
      const { cfg, resultado } = estado.ultimo;
      await db.salvarSimulacao({
        reservatorioId: estado.reservatorio.id,
        reservatorioNome: estado.reservatorio.nome,
        usinaNome: estado.reservatorio.usinaNome || '',
        modo: cfg.modo,
        entradas: {
          dataInicial: cfg.dataInicial.toISOString(),
          passos: cfg.passos ?? null,
          nivelInicial: cfg.nivelInicial ?? null,
          nivelFinal: cfg.nivelFinal ?? null,
          qaf: cfg.qaf,
          qdef: cfg.qdef,
        },
        limites: cfg.limites,
        restricoes: cfg.restricoes,
        resumo: resultado.resumo,
        incognita: resultado.incognita,
        alertas: resultado.alertas,
      });
      toast('Simulação salva no histórico.', 'ok');
    }, 'Salvando…');
  });

  if (comCav.length) {
    await carregarReservatorio();
    aplicarModo();
  }
}

// --- Montagem da configuração ---

function montarConfig(container, estado) {
  if (!estado.cav) throw new Error('Selecione um reservatório com tabela CAV importada.');

  const modo = $('#modo', container).value;
  const necessarios = NECESSARIOS[modo];
  const l = limitesCav(estado.cav);

  const cfg = {
    cav: estado.cav,
    modo,
    dataInicial: new Date($('#dataInicial', container).value || Date.now()),
    limites: {
      nivelMinOperacional: estado.reservatorio.nivelMinOperacional,
      nivelMaxOperacional: estado.reservatorio.nivelMaxOperacional,
      nivelMinEmergencial: estado.reservatorio.nivelMinEmergencial,
      nivelMaxEmergencial: estado.reservatorio.nivelMaxEmergencial,
    },
    restricoes: estado.reservatorio.restricoes || [],
  };

  for (const campo of ['nivelInicial', 'nivelFinal']) {
    if (!necessarios.includes(campo)) continue;
    const valor = valorNumerico($(`#${campo}`, container));
    if (valor == null) throw new Error(`Informe o ${campo === 'nivelInicial' ? 'nível inicial' : 'nível final'}.`);
    if (valor < l.cotaMin - 1e-9 || valor > l.cotaMax + 1e-9) {
      throw new Error(`O ${campo === 'nivelInicial' ? 'nível inicial' : 'nível final'} (${valor} m) está fora da faixa da tabela CAV (${num(l.cotaMin)} a ${num(l.cotaMax)} m).`);
    }
    cfg[campo] = valor;
  }

  for (const chave of ['qaf', 'qdef']) {
    if (!necessarios.includes(chave)) continue;
    cfg[chave] = lerEspecificacaoVazao(container, chave);
  }

  if (necessarios.includes('duracao')) {
    const valor = Number($('#duracao', container).value);
    if (!Number.isFinite(valor) || valor <= 0) throw new Error('Informe uma duração positiva.');
    cfg.passos = Math.max(1, Math.round(valor * UNIDADES[$('#duracao-unidade', container).value]));
  }

  if (modo === MODOS.TEMPO && cfg.nivelInicial === cfg.nivelFinal) {
    throw new Error('O nível inicial e o nível alvo são iguais: não há tempo a calcular.');
  }

  return cfg;
}

function lerEspecificacaoVazao(container, chave) {
  const bloco = $(`[data-campo="${chave}"]`, container);
  const tipo = $(`input[name="${chave}-tipo"]:checked`, bloco).value;
  const rotulo = chave === 'qaf' ? 'afluente' : 'defluente';

  if (tipo === 'constante') {
    const valor = valorNumerico($(`#${chave}-constante`, bloco));
    if (valor == null) throw new Error(`Informe a vazão ${rotulo}.`);
    if (valor < 0) throw new Error(`A vazão ${rotulo} não pode ser negativa.`);
    return { tipo: 'constante', valor };
  }

  const serie = lerSerie($(`#${chave}-serie`, bloco).value);
  if (!serie.length) throw new Error(`Informe a série de vazão ${rotulo} (um valor a cada 15 min).`);
  if (serie.some((v) => v < 0)) throw new Error(`A série de vazão ${rotulo} tem valores negativos.`);
  return { tipo: 'serie', serie };
}

function lerSerie(texto) {
  return texto
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map(paraNumero)
    .filter(Number.isFinite);
}

function blocoVazao(chave, rotulo) {
  return `
    <fieldset data-campo="${chave}" style="margin-top:14px">
      <legend>${rotulo}</legend>
      <div class="linha-inline" style="gap:18px;margin-bottom:10px">
        <label style="flex-direction:row;align-items:center;gap:6px;flex:0 0 auto">
          <input type="radio" name="${chave}-tipo" value="constante" checked style="width:auto" /> Constante
        </label>
        <label style="flex-direction:row;align-items:center;gap:6px;flex:0 0 auto">
          <input type="radio" name="${chave}-tipo" value="serie" style="width:auto" /> Variável (hidrograma)
        </label>
      </div>

      <div id="${chave}-constante-caixa">
        <label>Vazão (m³/s)
          <input type="number" id="${chave}-constante" step="0.01" min="0" value="0" />
        </label>
      </div>

      <div id="${chave}-serie-caixa" class="oculto">
        <div class="grade grade-2">
          <label>Série de 15 em 15 min (m³/s)
            <textarea id="${chave}-serie" rows="4" placeholder="120,5&#10;121,0&#10;119,8&#10;..."></textarea>
            <small id="${chave}-info"></small>
          </label>
          <label>Ou importe de planilha
            <input type="file" id="${chave}-arquivo" accept=".csv,.xlsx,.xls,text/csv" />
            <small>Um valor por linha; se houver várias colunas, a última numérica é usada.</small>
          </label>
        </div>
      </div>
    </fieldset>`;
}

function fmt(valor) {
  return Number.isFinite(valor) ? num(valor) : '—';
}
