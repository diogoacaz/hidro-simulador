# Simulador Hidráulico de Reservatórios

Aplicativo web para **cadastro, consulta e simulação hidráulica de reservatórios
de usinas hidrelétricas**, voltado a operadores e engenheiros. Modela o
comportamento do nível do reservatório a partir do balanço hídrico
(vazão afluente × vazão defluente), respeitando limites operacionais,
emergenciais e restrições.

Site estático (HTML/CSS/JS puro, sem build) + Firebase Firestore.

## Funcionalidades

### Cadastros

- **Usinas**: nome, código, rio, bacia, localização. Cada usina aceita
  quantos reservatórios forem necessários.
- **Reservatórios**: níveis mínimo/máximo operacionais e emergenciais, além de
  **restrições** com nível, motivo e vigência (ambiental, obra, segurança de barragem).
- **Tabela CAV** (cota × área × volume), uma por reservatório, discretizada de
  **1 em 1 cm**. Importação por CSV/XLSX ou colagem de planilha; pontos esparsos
  são interpolados automaticamente para a grade de 1 cm.
- **Registros operacionais**: nível, vazão afluente e defluente por data/hora,
  com entrada manual, importação de planilha e consulta filtrada por período.
- **Auditoria**: toda alteração de limites, restrições e CAV fica registrada
  (append-only nas regras do Firestore).

### Simulação

Balanço hídrico puro, em passos fixos de **15 minutos**:

$$\Delta V = (Q_{af} - Q_{def}) \cdot \Delta t$$

A conversão volume ↔ nível usa interpolação linear na tabela CAV. A cada passo,
o simulador recalcula volume e cota e verifica violação de limites
operacionais, emergenciais e restrições vigentes naquela data.

**Modos de vazão** — escolhidos por simulação:

- **Constante**: um valor único para todo o período.
- **Variável**: hidrograma de 15 em 15 min, digitado, colado ou importado.

**Modos de cálculo** — o usuário informa quatro das cinco variáveis
(Q afluente, Q defluente, nível inicial, nível final, tempo) e o simulador resolve a quinta:

| Modo | Incógnita | Caso de uso |
| --- | --- | --- |
| 1 | Tempo | Tempo para rebaixamento/enchimento até uma cota alvo |
| 2 | Vazão afluente | Estimar afluência a partir da variação de nível observada |
| 3 | Nível final | Prever a cota após X horas com vazões conhecidas |
| 4 | Nível inicial | Reconstituir a condição inicial |
| 5 | Vazão defluente | Definir a defluência para atingir a cota alvo no prazo |

Nos modos 2 e 5 o resultado é a **vazão constante equivalente** do período.
Esses dois modos são resolvidos analiticamente, não por busca iterativa: como o
balanço de volume é linear nas vazões, a vazão média equivalente sai direto de
`Q = ΔV/Δt ± Q_conhecida`, com ΔV obtido da CAV nos dois níveis. O resultado é
exato e a trajetória é depois integrada passo a passo para verificar violações.

### Visualização e exportação

- Gráfico **nível × tempo** com linhas de referência de todos os limites e
  destaque colorido dos trechos violados.
- Gráficos **volume × tempo** e **vazões × tempo**.
- Tabela da série de 15 em 15 min, com linhas em violação destacadas.
- Exportação da série completa em CSV e do gráfico de nível em PNG.
- Histórico de simulações com reprocessamento e aviso de divergência caso a
  CAV ou os limites tenham mudado desde a execução original.

## Unidades

| Grandeza | Unidade |
| --- | --- |
| Cota | m (CAV de cm em cm) |
| Vazão | m³/s |
| Volume | hm³ |
| Área | km² |
| Tempo | passos de 15 min |

## Fora do escopo atual

- Perdas por evaporação, infiltração e uso consuntivo (balanço hídrico puro).
- Separação da defluência em turbinada + vertida (valor total único).
- Integração com telemetria/SCADA.
- Autenticação e perfis de usuário (consulta × edição) — hoje o app é aberto.

## Rodar localmente

Os módulos ES exigem um servidor HTTP (não funciona por `file://`):

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Depois abra `http://localhost:5173`. Se tiver Node ou Python instalados,
`npx serve .` ou `python -m http.server 5173` também servem.

## Configurar o Firebase

1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com).
2. Ative o **Firestore Database** (modo produção).
3. Em **Configurações do projeto → Seus apps → Web**, copie o `firebaseConfig`
   e cole em [`js/firebase-config.js`](js/firebase-config.js).
4. Em **Firestore → Regras**, publique o conteúdo de
   [`firestore.rules`](firestore.rules).

O `firebaseConfig` de apps web não é secreto (fica visível no navegador) — a
segurança vem das regras do Firestore.

### Coleções

```
usinas/{id}              cadastro de usinas
reservatorios/{id}       limites, restrições e resumo da CAV
cav/{reservatorioId}     tabela CAV compacta (grade regular de 1 cm)
registros/{id}           registros operacionais
simulacoes/{id}          simulações salvas
auditoria/{id}           log append-only de alterações
```

A CAV é gravada como dois vetores (`areas`, `volumes`) sobre uma grade regular:
a cota de cada nó é implícita (`cotaInicial + i × 0,01 m`), o que reduz bastante
o tamanho do documento e torna a busca cota → índice imediata.

## Publicar no GitHub Pages

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica
a cada push na `main`. Em **Settings → Pages → Source**, selecione **GitHub Actions**.

## Estrutura

```
index.html                 shell da aplicação
css/style.css              estilos (claro/escuro, responsivo)
js/app.js                  bootstrap e roteador por hash
js/cav.js                  tabela CAV: construção e interpolação
js/simulation.js           motor de balanço hídrico e os 5 modos de cálculo
js/db.js                   acesso ao Firestore
js/charts.js               gráficos (Chart.js)
js/planilha.js             leitura/escrita de CSV, XLSX e colagem
js/ui.js                   helpers de interface
js/views/                  telas: simular, usinas, reservatorios, registros, historico, resultado
firestore.rules            regras de segurança
```
