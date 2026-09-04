// Configuração do Firebase deste app.
// 1. Crie um projeto em https://console.firebase.google.com
// 2. Ative o Firestore Database (modo produção, com as regras de firestore.rules deste repo)
// 3. Em "Configurações do projeto" > "Seus apps" > Web, copie o objeto de config e cole abaixo.
// O firebaseConfig de apps web NÃO é secreto (fica visível no navegador) — a segurança
// vem das regras do Firestore (veja firestore.rules), não do sigilo destas chaves.
export const firebaseConfig = {
  apiKey: 'COLE_AQUI_SUA_API_KEY',
  authDomain: 'SEU_PROJETO.firebaseapp.com',
  projectId: 'SEU_PROJETO',
  storageBucket: 'SEU_PROJETO.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:xxxxxxxxxxxxxxxx',
};
