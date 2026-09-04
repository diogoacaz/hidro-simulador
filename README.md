# Simulador de Reservatório de UHE

App estático (HTML/CSS/JS puro) para simular o balanço hídrico e a geração de
energia de um reservatório de usina hidrelétrica, com persistência de
reservatórios e simulações no Firebase Firestore.

## O que ele faz

- Configura os parâmetros de um reservatório: volumes mín/máx, curva
  cota-volume (linear), cota de jusante, perdas de carga, engolimento máximo,
  potência instalada e rendimento.
- Recebe uma série diária de vazões afluentes (digitada, gerada
  aleatoriamente para testes, ou importada de CSV).
- Simula dia a dia: volume armazenado, vazão turbinada, vertimento, déficit
  hídrico, cota, queda líquida, potência (MW) e energia (MWh).
- Mostra gráficos (Chart.js) e uma tabela diária com os resultados.
- Salva reservatórios e simulações no Firestore para consultar depois.

### Modelo de simulação (simplificado)

- Relação cota × volume: **linear** entre (volMin, cotaMin) e (volMax, cotaMax).
- Nível de jusante: **fixo** (não varia com a vazão defluente).
- Operação: vazão turbinada **alvo constante** (por padrão = engolimento
  máximo), reduzida automaticamente se o volume ameaçar ficar abaixo do
  mínimo; excedente acima do volume máximo é vertido.
- Potência: `P(MW) = rendimento × 9,81 × Q_turbinada × Queda_líquida × 1000 / 1e6`,
  limitada pela potência instalada.

Esses simplificações são propositais para um MVP. Para maior fidelidade,
seria necessário: curva cota-volume por tabela/polinômio, canal de fuga
variável com a vazão defluente, e regras de operação mais sofisticadas
(ex.: meta de nível, curva-guia, atendimento a múltiplos usos).

## Como rodar localmente

Basta servir os arquivos estáticos (não pode ser `file://` por causa dos
módulos ES e do CORS do Firebase):

```bash
npx serve .
# ou
python -m http.server 8080
```

Abra `http://localhost:8080` (ou a porta indicada).

## Configurar o Firebase

1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com).
2. Ative o **Firestore Database** (modo produção).
3. Em **Configurações do projeto → Seus apps → Web**, crie um app e copie o
   objeto `firebaseConfig`.
4. Cole os valores em [`js/firebase-config.js`](js/firebase-config.js).
5. Publique as regras deste repo (`firestore.rules`) no console do Firebase
   (Firestore → Regras) — elas liberam leitura/escrita nas coleções
   `reservatorios` e `simulacoes` sem autenticação, adequado só para uso
   interno/protótipo. Restrinja antes de usar com dados sensíveis.

Sem essa configuração, o app funciona normalmente para simular — só os
botões de salvar/carregar do Firebase ficam desativados.

## Publicar no GitHub Pages

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) já
publica o site automaticamente a cada push na branch `main`. Para ativar:

1. No GitHub, vá em **Settings → Pages → Source** e selecione **GitHub Actions**.
2. Faça push para `main` — o site fica disponível em
   `https://<usuario>.github.io/<repositorio>/`.

## Estrutura

```
index.html            interface
css/style.css          estilo
js/simulation.js       motor de simulação (funções puras, sem Firebase)
js/firebase.js         acesso ao Firestore (salvar/listar/carregar)
js/firebase-config.js  configuração do projeto Firebase (preencher)
js/app.js              lógica da interface (liga tudo)
firestore.rules         regras de segurança do Firestore
```
