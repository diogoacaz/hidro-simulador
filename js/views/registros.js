// Registros operacionais: entrada manual, importação de planilha e consulta por período.

import * as db from '../db.js';
import { lerArquivo, textoParaMatriz, removerCabecalho, paraNumero, paraDataHora, baixarCsv } from '../planilha.js';
import { $, esc, num, toast, confirmar, comBotao, valorNumerico, dataHoraLocal, paraInputDateTime } from '../ui.js';

export async function render(container) {
  const reservatorios = await db.listarReservatorios();

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Registros operacionais</h2>
          <p class="ajuda">Base histórica de nível, vazão afluente e vazão defluente.</p>
        </div>
      </div>

      ${reservatorios.length ? '' : '<div class="alerta alerta-aviso">Cadastre um reservatório antes de lançar registros.</div>'}

      <div class="linha-inline">
        <label>Reservatório
          <select id="reservatorio">
            ${reservatorios.map((r) => `<option value="${r.id}">${esc(r.nome)}${r.usinaNome ? ` — ${esc(r.usinaNome)}` : ''}</option>`).join('')}
          </select>
        </label>
        <label>De
          <input type="date" id="filtro-inicio" />
        </label>
        <label>Até
          <input type="date" id="filtro-fim" />
        </label>
        <button type="button" id="btn-consultar" class="primario" ${reservatorios.length ? '' : 'disabled'}>Consultar</button>
        <button type="button" id="btn-exportar" disabled>Exportar CSV</button>
      </div>
    </section>

    <section class="painel">
      <h2>Lançar registro</h2>
      <form id="form-registro">
        <div class="linha-inline">
          <label>Data e hora <span class="erro">*</span>
            <input type="datetime-local" id="dataHora" required />
          </label>
          <label>Nível (m)
            <input type="number" id="nivel" step="0.01" />
          </label>
          <label>Vazão afluente (m³/s)
            <input type="number" id="qaf" step="0.01" />
          </label>
          <label>Vazão defluente (m³/s)
            <input type="number" id="qdef" step="0.01" />
          </label>
          <button type="submit" class="primario" id="btn-lancar" ${reservatorios.length ? '' : 'disabled'}>Lançar</button>
        </div>
      </form>

      <details>
        <summary>Importar planilha (facilitador opcional)</summary>
        <p class="ajuda">
          Quatro colunas na ordem <strong>data/hora · nível (m) · vazão afluente (m³/s) · vazão defluente (m³/s)</strong>.
          Aceita CSV, XLSX ou colagem. Datas em <code>dd/mm/aaaa hh:mm</code> ou <code>aaaa-mm-dd hh:mm</code>.
        </p>
        <div class="grade grade-2">
          <label>Arquivo
            <input type="file" id="arquivo" accept=".csv,.xlsx,.xls,text/csv" />
          </label>
          <label>Ou cole aqui
            <textarea id="colar" rows="4" placeholder="01/03/2026 08:00	415,20	120,5	95,0"></textarea>
          </label>
        </div>
        <div class="acoes">
          <button type="button" id="btn-importar">Importar</button>
        </div>
      </details>
    </section>

    <section class="painel">
      <div class="cabecalho-painel">
        <h2>Resultados</h2>
        <span id="contagem" class="ajuda" style="margin:0"></span>
      </div>
      <div id="lista"><div class="vazio">Selecione um reservatório e clique em Consultar.</div></div>
    </section>`;

  $('#dataHora', container).value = paraInputDateTime(new Date());

  let registrosAtuais = [];

  const consultar = async () => {
    const reservatorioId = $('#reservatorio', container).value;
    if (!reservatorioId) return;
    const inicio = $('#filtro-inicio', container).value || null;
    const fim = $('#filtro-fim', container).value || null;
    // O filtro de fim inclui o dia inteiro.
    registrosAtuais = await db.listarRegistros(reservatorioId, {
      inicio: inicio ? `${inicio}T00:00` : null,
      fim: fim ? `${fim}T23:59` : null,
    });
    $('#lista', container).innerHTML = tabela(registrosAtuais);
    $('#contagem', container).textContent = `${registrosAtuais.length} registro(s)`;
    $('#btn-exportar', container).disabled = !registrosAtuais.length;
  };

  $('#btn-consultar', container).addEventListener('click', (e) => comBotao(e.target, consultar, 'Consultando…'));

  $('#form-registro', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    const dataHora = $('#dataHora', container).value;
    if (!dataHora) return toast('Informe a data e hora.', 'erro');

    await comBotao($('#btn-lancar', container), async () => {
      await db.salvarRegistro({
        reservatorioId: $('#reservatorio', container).value,
        dataHora,
        nivel: valorNumerico($('#nivel', container)),
        qaf: valorNumerico($('#qaf', container)),
        qdef: valorNumerico($('#qdef', container)),
        origem: 'manual',
      });
      toast('Registro lançado.', 'ok');
      ['nivel', 'qaf', 'qdef'].forEach((c) => { $(`#${c}`, container).value = ''; });
      await consultar();
    }, 'Salvando…');
  });

  $('#btn-importar', container).addEventListener('click', async (e) => {
    await comBotao(e.target, async () => {
      const arquivo = $('#arquivo', container).files[0];
      const colado = $('#colar', container).value.trim();
      let matriz;
      if (arquivo) matriz = await lerArquivo(arquivo);
      else if (colado) matriz = textoParaMatriz(colado);
      else throw new Error('Selecione um arquivo ou cole os dados.');

      const reservatorioId = $('#reservatorio', container).value;
      const novos = [];
      let ignoradas = 0;

      for (const linha of removerCabecalho(matriz)) {
        const dataHora = paraDataHora(linha[0]);
        if (!dataHora) { ignoradas++; continue; }
        novos.push({
          reservatorioId,
          dataHora,
          nivel: valorOuNulo(linha[1]),
          qaf: valorOuNulo(linha[2]),
          qdef: valorOuNulo(linha[3]),
          origem: 'importacao',
        });
      }

      if (!novos.length) throw new Error('Nenhuma linha válida encontrada. Verifique o formato da data na primeira coluna.');
      if (novos.length > 5000) throw new Error(`A importação tem ${novos.length} linhas; o limite por vez é 5000.`);

      const gravados = await db.salvarRegistrosEmLote(novos);
      toast(`${gravados} registro(s) importado(s)${ignoradas ? `, ${ignoradas} linha(s) ignorada(s)` : ''}.`, 'ok');
      $('#colar', container).value = '';
      $('#arquivo', container).value = '';
      await consultar();
    }, 'Importando…');
  });

  $('#btn-exportar', container).addEventListener('click', () => {
    const nome = $('#reservatorio', container).selectedOptions[0].textContent.split('—')[0].trim();
    baixarCsv(`registros-${nome.replace(/\W+/g, '-').toLowerCase()}.csv`,
      ['Data/hora', 'Nível (m)', 'Vazão afluente (m³/s)', 'Vazão defluente (m³/s)', 'Origem'],
      registrosAtuais.map((r) => [
        dataHoraLocal(r.dataHora),
        r.nivel ?? '', r.qaf ?? '', r.qdef ?? '', r.origem || '',
      ]));
  });

  $('#lista', container).addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-excluir]');
    if (!botao) return;
    if (!confirmar('Excluir este registro?')) return;
    await comBotao(botao, async () => {
      await db.excluirRegistro(botao.dataset.excluir);
      toast('Registro excluído.', 'ok');
      await consultar();
    }, '…');
  });

  if (reservatorios.length) await consultar();
}

function valorOuNulo(celula) {
  const v = paraNumero(celula);
  return Number.isFinite(v) ? v : null;
}

function tabela(registros) {
  if (!registros.length) return '<div class="vazio">Nenhum registro no período selecionado.</div>';
  return `
    <div class="tabela-scroll">
      <table>
        <thead>
          <tr>
            <th>Data/hora</th><th class="num">Nível (m)</th>
            <th class="num">Q afluente (m³/s)</th><th class="num">Q defluente (m³/s)</th>
            <th>Origem</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${registros.map((r) => `
            <tr>
              <td>${dataHoraLocal(r.dataHora)}</td>
              <td class="num">${r.nivel == null ? '—' : num(r.nivel)}</td>
              <td class="num">${r.qaf == null ? '—' : num(r.qaf)}</td>
              <td class="num">${r.qdef == null ? '—' : num(r.qdef)}</td>
              <td>${r.origem === 'importacao' ? 'Importado' : 'Manual'}</td>
              <td><button type="button" class="discreto" data-excluir="${r.id}">Excluir</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
