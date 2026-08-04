const firebaseApp = firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebaseApp.auth();

const discordStatus = document.getElementById('discord-status');
const discordInfo = document.getElementById('discord-info');
const firebaseStatus = document.getElementById('firebase-status');
const firebaseInfo = document.getElementById('firebase-info');
const discordLogin = document.getElementById('discord-login');
const discordLogout = document.getElementById('discord-logout');
const firebaseSignin = document.getElementById('firebase-signin');
const firebaseSignout = document.getElementById('firebase-signout');
const identidadeField = document.getElementById('identidade');
const regrasField = document.getElementById('regras');
const memoriaField = document.getElementById('memoria_geral');
const importantesField = document.getElementById('importantes');
const saveIdentidade = document.getElementById('save-identidade');
const saveRegras = document.getElementById('save-regras');
const saveMemoria = document.getElementById('save-memoria');
const saveImportantes = document.getElementById('save-importantes');
const apiKeysList = document.getElementById('api-keys-list');
const addApiKey = document.getElementById('add-api-key');
const newApiKeyInput = document.getElementById('new-api-key');

let firebaseIdToken = null;

async function fetchAuth() {
  const response = await fetch('/api/auth');
  const data = await response.json();
  updateAuthUI(data);
  return data;
}

function updateAuthUI(data) {
  if (data.discord) {
    discordStatus.textContent = 'conectado';
    discordInfo.textContent = JSON.stringify(data.discord, null, 2);
  } else {
    discordStatus.textContent = 'não conectado';
    discordInfo.textContent = 'Use o botão "Entrar com Discord" para autenticar.';
  }

  if (data.firebase) {
    firebaseStatus.textContent = 'conectado';
    firebaseInfo.textContent = JSON.stringify(data.firebase, null, 2);
  } else {
    firebaseStatus.textContent = 'não conectado';
    firebaseInfo.textContent = 'Use o formulário de Firebase para autenticar.';
  }
}

async function refreshDashboard() {
  const response = await fetch('/api/dashboard', {
    headers: {
      Authorization: firebaseIdToken ? `Bearer ${firebaseIdToken}` : '',
    },
  });

  if (!response.ok) {
    console.warn('Falha ao carregar dashboard', response.status);
    return;
  }

  const payload = await response.json();
  if (payload.data) {
    identidadeField.value = payload.data.identidade || '';
    regrasField.value = payload.data.regras || '';
    memoriaField.value = payload.data.memoria_geral || '';
    importantesField.value = payload.data.importantes || '';
  }

  renderApiKeys(payload.keys || []);
}

function renderApiKeys(keys) {
  apiKeysList.innerHTML = '';
  if (!keys.length) {
    apiKeysList.innerHTML = '<p>Nenhuma chave cadastrada ainda.</p>';
    return;
  }
  keys.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <p><strong>${item.key}</strong> <span class="status-chip">${item.status}</span></p>
      <p class="small-note">Hash: ${item.hash}</p>
      <button data-hash="${item.hash}">Remover</button>
    `;
    card.querySelector('button').addEventListener('click', () => deleteApiKey(item.hash));
    apiKeysList.appendChild(card);
  });
}

async function postData(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: firebaseIdToken ? `Bearer ${firebaseIdToken}` : '',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Erro desconhecido');
  }
  return response.json();
}

async function deleteApiKey(hash) {
  const response = await fetch(`/api/keys/${hash}`, {
    method: 'DELETE',
    headers: {
      Authorization: firebaseIdToken ? `Bearer ${firebaseIdToken}` : '',
    },
  });
  if (response.ok) {
    refreshDashboard();
  }
}

discordLogin.addEventListener('click', () => {
  window.location.href = '/auth/discord';
});

discordLogout.addEventListener('click', async () => {
  await fetch('/logout');
  await fetchAuth();
});

firebaseSignin.addEventListener('click', async () => {
  const email = document.getElementById('firebase-email').value;
  const password = document.getElementById('firebase-password').value;
  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    firebaseIdToken = await userCredential.user.getIdToken();
    firebaseStatus.textContent = 'conectado';
    firebaseInfo.textContent = JSON.stringify({ uid: userCredential.user.uid, email: userCredential.user.email }, null, 2);
    await refreshDashboard();
  } catch (err) {
    alert('Erro Firebase: ' + err.message);
  }
});

firebaseSignout.addEventListener('click', async () => {
  await auth.signOut();
  firebaseIdToken = null;
  firebaseStatus.textContent = 'não conectado';
  firebaseInfo.textContent = 'Sessão Firebase encerrada.';
});

saveIdentidade.addEventListener('click', async () => {
  await postData('/api/data', { key: 'identidade', value: identidadeField.value });
  alert('Identidade salva.');
});

saveRegras.addEventListener('click', async () => {
  await postData('/api/data', { key: 'regras', value: regrasField.value });
  alert('Regras salvas.');
});

saveMemoria.addEventListener('click', async () => {
  await postData('/api/data', { key: 'memoria_geral', value: memoriaField.value });
  alert('Memória geral salva.');
});

saveImportantes.addEventListener('click', async () => {
  await postData('/api/data', { key: 'importantes', value: importantesField.value });
  alert('Avisos importantes salvos.');
});

addApiKey.addEventListener('click', async () => {
  const key = newApiKeyInput.value.trim();
  if (!key) {
    return alert('Digite uma chave Groq.');
  }
  await postData('/api/keys', { key });
  newApiKeyInput.value = '';
  await refreshDashboard();
});

window.addEventListener('load', async () => {
  await fetchAuth();
  await refreshDashboard();
});
