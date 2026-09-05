// Cadastro de usinas hidrelétricas.

import * as db from '../db.js';
import { $, esc, toast, confirmar, comBotao } from '../ui.js';

const CAMPOS = ['nome', 'codigo', 'rio', 'bacia', 'localizacao'];

export async function render(container) {
  const [usinas, reservatorios] = await Promise.all([db.listarUsinas(), db.listarReservatorios()]);
  const porUsina = new Map();
  for (const r of reservatorios) {
    porUsina.set(r.usinaId, (porUsina.get(r.usinaId) || 0) + 1);
  }

  container.innerHTML = `
    <section class="painel">
      <div class="cabecalho-painel">
        <div>
          <h2>Usinas hidrelétricas</h2>
          <p class="ajuda">Cada usina pode ter quantos reservatórios forem necessários.</p>
        </div>
        <button type="button" id="btn-nova" class="primario">Nova usina</button>
      </div>

      <form id="form-usina" class="oculto">
        <fieldset>
          <legend id="legenda-form">Nova usina</legend>
          <div class="grade">
            <label>Nome <span class="erro">*</span>
              <input type="text" id="nome" required maxlength="120" />
            </label>
            <label>Código
              <input type="text" id="codigo" maxlength="30" placeholder="ex.: UHE-001" />
            </label>
            <label>Rio
              <input type="text" id="rio" maxlength="80" />
            </label>
            <label>Bacia
              <input type="text" id="bacia" maxlength="80" />
            </label>
            <label>Localização
              <input type="text" id="localizacao" maxlength="120" placeholder="Município / UF" />
            </label>
          </div>
          <div class="acoes">
            <button type="submit" class="primario" id="btn-salvar">Salvar</button>
            <button type="button" id="btn-cancelar">Cancelar</button>
          </div>
        </fieldset>
      </form>

      <div id="lista">${tabela(usinas, porUsina)}</div>
    </section>`;

  let editandoId = null;

  const form = $('#form-usina', container);
  const abrirForm = (usina = null) => {
    editandoId = usina ? usina.id : null;
    $('#legenda-form', container).textContent = usina ? `Editando: ${usina.nome}` : 'Nova usina';
    for (const campo of CAMPOS) $(`#${campo}`, container).value = usina ? (usina[campo] || '') : '';
    form.classList.remove('oculto');
    $('#nome', container).focus();
  };

  $('#btn-nova', container).addEventListener('click', () => abrirForm());
  $('#btn-cancelar', container).addEventListener('click', () => form.classList.add('oculto'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = {};
    for (const campo of CAMPOS) dados[campo] = $(`#${campo}`, container).value.trim();
    if (!dados.nome) return toast('Informe o nome da usina.', 'erro');

    await comBotao($('#btn-salvar', container), async () => {
      await db.salvarUsina(dados, editandoId);
      toast(editandoId ? 'Usina atualizada.' : 'Usina cadastrada.', 'ok');
      await render(container);
    }, 'Salvando…');
  });

  // Delegação no painel (recriado a cada render) para não acumular listeners.
  $('.painel', container).addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const { acao, id } = botao.dataset;
    const usina = usinas.find((u) => u.id === id);
    if (!usina) return;

    if (acao === 'editar') {
      abrirForm(usina);
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (acao === 'excluir') {
      if (!confirmar(`Excluir a usina "${usina.nome}"? Esta ação não pode ser desfeita.`)) return;
      await comBotao(botao, async () => {
        await db.excluirUsina(id);
        toast('Usina excluída.', 'ok');
        await render(container);
      }, '…');
    }
  });
}

function tabela(usinas, porUsina) {
  if (!usinas.length) {
    return '<div class="vazio">Nenhuma usina cadastrada. Comece criando uma usina para depois vincular reservatórios a ela.</div>';
  }
  return `
    <div class="tabela-scroll">
      <table>
        <thead>
          <tr>
            <th>Nome</th><th>Código</th><th>Rio</th><th>Bacia</th>
            <th>Localização</th><th class="num">Reservatórios</th><th>Cadastro</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${usinas.map((u) => `
            <tr>
              <td><strong>${esc(u.nome)}</strong></td>
              <td>${esc(u.codigo) || '—'}</td>
              <td>${esc(u.rio) || '—'}</td>
              <td>${esc(u.bacia) || '—'}</td>
              <td>${esc(u.localizacao) || '—'}</td>
              <td class="num">${porUsina.get(u.id) || 0}</td>
              <td>${db.dataDe(u.criadoEm)}</td>
              <td>
                <button type="button" class="discreto" data-acao="editar" data-id="${u.id}">Editar</button>
                <button type="button" class="discreto" data-acao="excluir" data-id="${u.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
