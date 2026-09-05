// Cadastro de reservatórios: limites operacionais/emergenciais, restrições,
// tabela CAV e log de auditoria.

import * as db from '../db.js';
import { construirCav, limitesCav, avisoTamanho } from '../cav.js';
import { lerArquivo, textoParaMatriz, removerCabecalho, paraNumero, baixarCsv } from '../planilha.js';
import { graficoCav } from '../charts.js';
import { $, $$, esc, num, toast, confirmar, comBotao, valorNumerico } from '../ui.js';

const LIMITES = [
  ['nivelMinOperacional', 'Mínimo operacional (m)'],
  ['nivelMaxOperacional', 'Máximo operacional (m)'],
  ['nivelMinEmergencial', 'Mínimo emergencial (m)'],
  ['nivelMaxEmergencial', 'Máximo emergencial (m)'],
];

export async function render(container, id) {
  if (id) return renderDetalhe(container, id);
  return renderLista(container);
}

// --- Lista ---

async function renderLista(container) {
  const [reservatorios, usinas] = await Promise.all([db.listarReservatorios(), db.listarUsinas()]);
  const nomeUsina = new Map(usinas.map((u) => [u.id, u.nome]));

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Reservatórios</h2>
          <p class="ajuda">Cada reservatório tem seus limites, restrições e uma tabela CAV própria.</p>
        </div>
        <button type="button" id="btn-novo" class="primario" ${usinas.length ? '' : 'disabled'}>Novo reservatório</button>
      </div>

      ${usinas.length ? '' : '<div class="alerta alerta-aviso">Cadastre uma usina antes de criar reservatórios.</div>'}

      <form id="form-novo" class="oculto">
        <fieldset>
          <legend>Novo reservatório</legend>
          <div class="grade">
            <label>Usina <span class="erro">*</span>
              <select id="usinaId" required>
                ${usinas.map((u) => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}
              </select>
            </label>
            <label>Nome do reservatório <span class="erro">*</span>
              <input type="text" id="nome" required maxlength="120" />
            </label>
          </div>
          <div class="acoes">
            <button type="submit" class="primario" id="btn-criar">Criar e configurar</button>
            <button type="button" id="btn-cancelar">Cancelar</button>
          </div>
        </fieldset>
      </form>

      ${tabelaReservatorios(reservatorios, nomeUsina)}
    </section>`;

  const form = $('#form-novo', container);
  $('#btn-novo', container).addEventListener('click', () => {
    form.classList.remove('oculto');
    $('#nome', container).focus();
  });
  $('#btn-cancelar', container).addEventListener('click', () => form.classList.add('oculto'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usinaId = $('#usinaId', container).value;
    const nome = $('#nome', container).value.trim();
    if (!usinaId || !nome) return toast('Informe a usina e o nome do reservatório.', 'erro');

    await comBotao($('#btn-criar', container), async () => {
      const novoId = await db.salvarReservatorio({
        usinaId, nome, usinaNome: nomeUsina.get(usinaId) || '', restricoes: [],
      });
      toast('Reservatório criado. Configure os limites e a tabela CAV.', 'ok');
      location.hash = `#/reservatorios/${novoId}`;
    }, 'Criando…');
  });

  $('.painel', container).addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-acao="excluir"]');
    if (!botao) return;
    const reservatorio = reservatorios.find((r) => r.id === botao.dataset.id);
    if (!confirmar(`Excluir "${reservatorio.nome}"? A tabela CAV também será removida.`)) return;
    await comBotao(botao, async () => {
      await db.excluirReservatorio(botao.dataset.id);
      toast('Reservatório excluído.', 'ok');
      await renderLista(container);
    }, '…');
  });
}

function tabelaReservatorios(reservatorios, nomeUsina) {
  if (!reservatorios.length) {
    return '<div class="vazio">Nenhum reservatório cadastrado.</div>';
  }
  return `
    <div class="tabela-scroll">
      <table>
        <thead>
          <tr>
            <th>Reservatório</th><th>Usina</th>
            <th class="num">Faixa operacional</th><th class="num">Faixa emergencial</th>
            <th class="num">Restrições</th><th>Tabela CAV</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${reservatorios.map((r) => `
            <tr>
              <td><strong>${esc(r.nome)}</strong></td>
              <td>${esc(nomeUsina.get(r.usinaId) || r.usinaNome || '—')}</td>
              <td class="num">${faixa(r.nivelMinOperacional, r.nivelMaxOperacional)}</td>
              <td class="num">${faixa(r.nivelMinEmergencial, r.nivelMaxEmergencial)}</td>
              <td class="num">${(r.restricoes || []).length}</td>
              <td>${r.cavResumo
                ? `<span class="badge badge-ok">${r.cavResumo.pontos} pontos</span>`
                : '<span class="badge badge-atencao">Não importada</span>'}</td>
              <td>
                <a href="#/reservatorios/${r.id}"><button type="button" class="discreto">Abrir</button></a>
                <button type="button" class="discreto" data-acao="excluir" data-id="${r.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function faixa(min, max) {
  if (!Number.isFinite(min) && !Number.isFinite(max)) return '—';
  return `${Number.isFinite(min) ? num(min) : '—'} a ${Number.isFinite(max) ? num(max) : '—'} m`;
}

// --- Detalhe ---

async function renderDetalhe(container, id) {
  const reservatorio = await db.obterReservatorio(id);
  const [cav, auditoria] = await Promise.all([db.obterCav(id), db.listarAuditoria(id)]);
  let restricoes = [...(reservatorio.restricoes || [])];
  let cavAtual = cav;

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>${esc(reservatorio.nome)}</h2>
          <p class="ajuda">${esc(reservatorio.usinaNome || '')}</p>
        </div>
        <a href="#/reservatorios"><button type="button">Voltar à lista</button></a>
      </div>

      <form id="form-limites">
        <fieldset>
          <legend>Níveis operacionais e emergenciais</legend>
          <div class="grade">
            ${LIMITES.map(([campo, rotulo]) => `
              <label>${rotulo}
                <input type="number" id="${campo}" step="0.01"
                       value="${Number.isFinite(reservatorio[campo]) ? reservatorio[campo] : ''}" />
              </label>`).join('')}
          </div>
          <p class="ajuda" id="aviso-limites"></p>
          <div class="acoes">
            <button type="submit" class="primario" id="btn-salvar-limites">Salvar limites</button>
          </div>
        </fieldset>
      </form>
    </section>

    <section class="painel">
      <h2>Restrições</h2>
      <p class="ajuda">Níveis restritivos com motivo e vigência (ambiental, obra, segurança de barragem).</p>
      <form id="form-restricao">
        <div class="linha-inline">
          <label>Tipo
            <select id="r-tipo">
              <option value="min">Nível mínimo</option>
              <option value="max">Nível máximo</option>
            </select>
          </label>
          <label>Nível (m) <span class="erro">*</span>
            <input type="number" id="r-nivel" step="0.01" required />
          </label>
          <label>Motivo
            <input type="text" id="r-motivo" maxlength="120" placeholder="ex.: restrição ambiental" />
          </label>
          <label>Início da vigência
            <input type="date" id="r-inicio" />
          </label>
          <label>Fim da vigência
            <input type="date" id="r-fim" />
          </label>
          <button type="submit" class="primario">Adicionar</button>
        </div>
      </form>
      <div class="lista-restricoes" id="lista-restricoes"></div>
    </section>

    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Tabela CAV</h2>
          <p class="ajuda">Cota × área × volume, reamostrada de 1 em 1 cm por interpolação linear.</p>
        </div>
        <div class="acoes" style="margin:0">
          <button type="button" id="btn-exportar-cav" ${cavAtual ? '' : 'disabled'}>Exportar CSV</button>
          <button type="button" id="btn-excluir-cav" class="perigo" ${cavAtual ? '' : 'disabled'}>Excluir</button>
        </div>
      </div>

      <div id="resumo-cav">${resumoCav(cavAtual)}</div>

      <details ${cavAtual ? '' : 'open'} id="det-importar">
        <summary>Importar / substituir tabela CAV</summary>
        <p class="ajuda">
          Três colunas na ordem <strong>cota (m) · área (km²) · volume (hm³)</strong>. Aceita CSV, XLSX
          ou colagem direta da planilha. Pontos esparsos são interpolados automaticamente para a grade de 1 cm.
        </p>
        <div class="grade-2 grade">
          <label>Arquivo (CSV ou Excel)
            <input type="file" id="arquivo-cav" accept=".csv,.xlsx,.xls,text/csv" />
          </label>
          <label>Ou cole aqui
            <textarea id="colar-cav" rows="5" placeholder="380,00	12,50	300,00&#10;380,50	12,80	306,30&#10;..."></textarea>
          </label>
        </div>
        <div class="acoes">
          <button type="button" class="primario" id="btn-processar-cav">Processar e salvar</button>
        </div>
      </details>

      <div class="grafico-caixa ${cavAtual ? '' : 'oculto'}" id="caixa-grafico-cav">
        <canvas id="grafico-cav"></canvas>
      </div>
    </section>

    <section class="painel">
      <h2>Auditoria</h2>
      <p class="ajuda">Histórico de alterações em limites e restrições.</p>
      <div id="lista-auditoria">${tabelaAuditoria(auditoria)}</div>
    </section>`;

  const desenharCav = () => {
    if (cavAtual) {
      $('#caixa-grafico-cav', container).classList.remove('oculto');
      graficoCav('grafico-cav', cavAtual);
    } else {
      $('#caixa-grafico-cav', container).classList.add('oculto');
    }
  };
  desenharCav();

  // --- Limites ---

  const validarLimites = () => {
    const v = {};
    for (const [campo] of LIMITES) v[campo] = valorNumerico($(`#${campo}`, container));
    const avisos = [];
    if (v.nivelMinOperacional != null && v.nivelMaxOperacional != null && v.nivelMinOperacional >= v.nivelMaxOperacional) {
      avisos.push('O mínimo operacional deve ser menor que o máximo operacional.');
    }
    if (v.nivelMinEmergencial != null && v.nivelMinOperacional != null && v.nivelMinEmergencial > v.nivelMinOperacional) {
      avisos.push('O mínimo emergencial normalmente é menor ou igual ao mínimo operacional.');
    }
    if (v.nivelMaxEmergencial != null && v.nivelMaxOperacional != null && v.nivelMaxEmergencial < v.nivelMaxOperacional) {
      avisos.push('O máximo emergencial normalmente é maior ou igual ao máximo operacional.');
    }
    $('#aviso-limites', container).textContent = avisos.join(' ');
    return { valores: v, bloqueante: avisos.length && avisos[0].includes('deve ser menor') };
  };

  $$('#form-limites input', container).forEach((i) => i.addEventListener('input', validarLimites));
  validarLimites();

  $('#form-limites', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    const { valores, bloqueante } = validarLimites();
    if (bloqueante) return toast('Corrija os limites antes de salvar.', 'erro');

    await comBotao($('#btn-salvar-limites', container), async () => {
      const mudancas = LIMITES
        .filter(([campo]) => (reservatorio[campo] ?? null) !== valores[campo])
        .map(([campo, rotulo]) => `${rotulo}: ${fmtLimite(reservatorio[campo])} → ${fmtLimite(valores[campo])}`);

      await db.salvarReservatorio(valores, id);
      if (mudancas.length) {
        await db.registrarAuditoria({
          reservatorioId: id, reservatorioNome: reservatorio.nome,
          acao: 'Alteração de limites', detalhes: mudancas.join(' | '),
        });
      }
      toast('Limites salvos.', 'ok');
      await renderDetalhe(container, id);
    }, 'Salvando…');
  });

  // --- Restrições ---

  const desenharRestricoes = () => {
    $('#lista-restricoes', container).innerHTML = restricoes.length
      ? restricoes.map((r, i) => `
          <div class="item-restricao">
            <span>
              <strong>${r.tipo === 'min' ? 'Mínimo' : 'Máximo'} ${num(r.nivel)} m</strong>
              ${r.motivo ? ` — ${esc(r.motivo)}` : ''}
              <br /><small style="color:var(--suave)">Vigência: ${r.inicio || 'sem início'} até ${r.fim || 'indeterminado'}</small>
            </span>
            <button type="button" class="discreto" data-remover="${i}">Remover</button>
          </div>`).join('')
      : '<div class="vazio">Nenhuma restrição cadastrada.</div>';
  };
  desenharRestricoes();

  const persistirRestricoes = async (descricao) => {
    await db.salvarReservatorio({ restricoes }, id);
    await db.registrarAuditoria({
      reservatorioId: id, reservatorioNome: reservatorio.nome,
      acao: 'Alteração de restrições', detalhes: descricao,
    });
  };

  $('#form-restricao', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    const nivel = valorNumerico($('#r-nivel', container));
    if (nivel == null) return toast('Informe o nível da restrição.', 'erro');
    const nova = {
      tipo: $('#r-tipo', container).value,
      nivel,
      motivo: $('#r-motivo', container).value.trim(),
      inicio: $('#r-inicio', container).value || null,
      fim: $('#r-fim', container).value || null,
    };
    restricoes.push(nova);
    await persistirRestricoes(`Incluída restrição ${nova.tipo} ${nivel} m (${nova.motivo || 'sem motivo'})`);
    toast('Restrição adicionada.', 'ok');
    await renderDetalhe(container, id);
  });

  $('#lista-restricoes', container).addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-remover]');
    if (!botao) return;
    const i = Number(botao.dataset.remover);
    const removida = restricoes[i];
    if (!confirmar('Remover esta restrição?')) return;
    restricoes.splice(i, 1);
    await persistirRestricoes(`Removida restrição ${removida.tipo} ${removida.nivel} m (${removida.motivo || 'sem motivo'})`);
    toast('Restrição removida.', 'ok');
    await renderDetalhe(container, id);
  });

  // --- CAV ---

  $('#btn-processar-cav', container).addEventListener('click', async (e) => {
    await comBotao(e.target, async () => {
      const arquivo = $('#arquivo-cav', container).files[0];
      const colado = $('#colar-cav', container).value.trim();
      let matriz;

      if (arquivo) matriz = await lerArquivo(arquivo);
      else if (colado) matriz = textoParaMatriz(colado);
      else throw new Error('Selecione um arquivo ou cole os dados da tabela.');

      const pontos = removerCabecalho(matriz)
        .map((linha) => ({
          cota: paraNumero(linha[0]),
          area: paraNumero(linha[1]),
          volume: paraNumero(linha[2]),
        }))
        .filter((p) => Number.isFinite(p.cota) && Number.isFinite(p.volume));

      if (pontos.length < 2) throw new Error('Não foi possível ler ao menos 2 pontos válidos. Confira a ordem das colunas: cota, área, volume.');

      const nova = construirCav(pontos);
      await db.salvarCav(id, nova);
      await db.salvarReservatorio({ cavResumo: { ...limitesCav(nova) } }, id);
      await db.registrarAuditoria({
        reservatorioId: id, reservatorioNome: reservatorio.nome,
        acao: 'Importação de tabela CAV',
        detalhes: `${pontos.length} pontos lidos → ${nova.pontos} pontos de 1 cm (${limitesCav(nova).cotaMin.toFixed(2)} m a ${limitesCav(nova).cotaMax.toFixed(2)} m)`,
      });

      const aviso = avisoTamanho(nova.pontos);
      toast(aviso || `Tabela CAV salva: ${nova.pontos} pontos de 1 cm.`, aviso ? 'info' : 'ok');
      await renderDetalhe(container, id);
    }, 'Processando…');
  });

  $('#btn-excluir-cav', container).addEventListener('click', async (e) => {
    if (!confirmar('Excluir a tabela CAV deste reservatório? As simulações dependem dela.')) return;
    await comBotao(e.target, async () => {
      await db.excluirCav(id);
      await db.salvarReservatorio({ cavResumo: null }, id);
      toast('Tabela CAV excluída.', 'ok');
      await renderDetalhe(container, id);
    }, '…');
  });

  $('#btn-exportar-cav', container).addEventListener('click', () => {
    if (!cavAtual) return;
    const linhas = cavAtual.volumes.map((v, i) => [
      (cavAtual.cotaInicial + i * cavAtual.passo).toFixed(2),
      cavAtual.areas[i].toFixed(4),
      v.toFixed(4),
    ]);
    baixarCsv(`cav-${reservatorio.nome.replace(/\W+/g, '-').toLowerCase()}.csv`,
      ['Cota (m)', 'Área (km²)', 'Volume (hm³)'], linhas);
  });
}

function fmtLimite(valor) {
  return Number.isFinite(valor) ? `${valor} m` : 'vazio';
}

function resumoCav(cav) {
  if (!cav) {
    return '<div class="alerta alerta-aviso">Nenhuma tabela CAV importada. A simulação exige esta tabela para converter volume em nível.</div>';
  }
  const l = limitesCav(cav);
  return `
    <div class="cartoes">
      <div class="cartao"><span>Cota mínima</span><strong>${num(l.cotaMin)} m</strong></div>
      <div class="cartao"><span>Cota máxima</span><strong>${num(l.cotaMax)} m</strong></div>
      <div class="cartao"><span>Volume mínimo</span><strong>${num(l.volumeMin)} hm³</strong></div>
      <div class="cartao"><span>Volume máximo</span><strong>${num(l.volumeMax)} hm³</strong></div>
      <div class="cartao"><span>Volume útil</span><strong>${num(l.volumeMax - l.volumeMin)} hm³</strong></div>
      <div class="cartao"><span>Pontos (1 cm)</span><strong>${l.pontos}</strong></div>
    </div>`;
}

function tabelaAuditoria(registros) {
  if (!registros.length) return '<div class="vazio">Nenhuma alteração registrada ainda.</div>';
  return `
    <div class="tabela-scroll">
      <table>
        <thead><tr><th>Quando</th><th>Ação</th><th>Detalhes</th></tr></thead>
        <tbody>
          ${registros.map((r) => `
            <tr>
              <td>${db.dataDe(r.criadoEm)}</td>
              <td>${esc(r.acao)}</td>
              <td style="white-space:normal">${esc(r.detalhes)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
