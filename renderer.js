const { ipcRenderer } = require('electron');

let userData = null;
let modsDownloaded = false;
let setupComplete = false;

const loginModal = document.getElementById('login-modal');
const registerModal = document.getElementById('register-modal');
const launcher = document.getElementById('launcher');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');

const playButton = document.getElementById('play-button');
const usernameDisplay = document.getElementById('username-display');
const modsStatus = document.getElementById('mods-status');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

function showLogin() {
  loginModal.classList.remove('hide');
  registerModal.classList.add('hide');
  launcher.classList.add('hide');
}

function showRegister() {
  loginModal.classList.add('hide');
  registerModal.classList.remove('hide');
  launcher.classList.add('hide');
}

function showLauncher() {
  loginModal.classList.add('hide');
  registerModal.classList.add('hide');
  launcher.classList.remove('hide');
}

function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}
window.togglePassword = togglePassword;
window.showLogin = showLogin;
window.showRegister = showRegister;

function showError(element, message) {
  element.textContent = message;
  element.style.display = 'block';
  setTimeout(() => {
    element.style.display = 'none';
  }, 5000);
}

// Setup initial
async function initialSetup() {
  progressContainer.style.display = 'block';
  modsStatus.textContent = 'Installation de Java et Forge...';
  
  const result = await ipcRenderer.invoke('initial-setup');
  
  if (result.success) {
    setupComplete = true;
    modsStatus.textContent = 'Installation terminée ✓';
    await downloadModsInBackground();
  } else {
    modsStatus.textContent = 'Erreur installation';
    alert('Erreur: ' + result.error);
  }
}

// Connexion
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  
  if (!username || !password) {
    showError(loginError, 'Tous les champs sont requis');
    return;
  }
  
  console.log('[LOGIN] Tentative:', username);
  
  const result = await ipcRenderer.invoke('login', { username, password });
  
  console.log('[LOGIN] Résultat:', result);
  
  if (result.success) {
    userData = result;
    usernameDisplay.textContent = result.username;
    showLauncher();
    
    const setupCheck = await ipcRenderer.invoke('check-setup');
    
    if (!setupCheck.setupComplete) {
      await initialSetup();
    } else {
      setupComplete = true;
      await downloadModsInBackground();
    }
  } else {
    showError(loginError, result.error);
  }
});

// Inscription
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  
  if (!username || !password) {
    showError(registerError, 'Tous les champs sont requis');
    return;
  }
  
  if (password.length < 6) {
    showError(registerError, 'Mot de passe trop court (min 6 caractères)');
    return;
  }
  
  console.log('[REGISTER] Tentative:', username);
  
  const result = await ipcRenderer.invoke('register', { username, password });
  
  console.log('[REGISTER] Résultat:', result);
  
  if (result.success) {
    userData = result;
    usernameDisplay.textContent = result.username;
    showLauncher();
    
    const setupCheck = await ipcRenderer.invoke('check-setup');
    
    if (!setupCheck.setupComplete) {
      await initialSetup();
    } else {
      setupComplete = true;
      await downloadModsInBackground();
    }
  } else {
    showError(registerError, result.error);
  }
});

async function init() {
  // Test Supabase au démarrage
  const testResult = await ipcRenderer.invoke('test-supabase');
  console.log('[INIT] Test Supabase:', testResult);
  
  const result = await ipcRenderer.invoke('auto-init');
  
  if (result.success && result.config.username) {
    userData = {
      username: result.config.username,
      uuid: result.config.username.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(32, '0').substring(0, 32),
      accessToken: 'offline'
    };
    
    usernameDisplay.textContent = result.config.username;
    showLauncher();
    
    const setupCheck = await ipcRenderer.invoke('check-setup');
    
    if (setupCheck.setupComplete) {
      setupComplete = true;
      await downloadModsInBackground();
    } else {
      await initialSetup();
    }
  } else {
    showRegister();
  }
}

async function downloadModsInBackground() {
  progressContainer.style.display = 'block';
  modsStatus.textContent = 'Téléchargement des mods...';
  
  const result = await ipcRenderer.invoke('download-mods');
  
  if (result.success) {
    modsDownloaded = true;
    modsStatus.textContent = `${result.count} mods installés ✓`;
    progressContainer.style.display = 'none';
    playButton.disabled = false;
  } else {
    modsStatus.textContent = 'Erreur mods';
  }
}

ipcRenderer.on('download-progress', (event, data) => {
  const percent = Math.round((data.current / data.total) * 100);
  progressFill.style.width = `${percent}%`;
  
  if (data.name && !data.cached) {
    progressText.textContent = `${data.name}`;
  }
});

ipcRenderer.on('game-log', (event, log) => {
  console.log('[GAME]', log);
});

ipcRenderer.on('game-closed', (event, code) => {
  playButton.disabled = false;
  playButton.textContent = 'JOUER';
});

playButton.addEventListener('click', async () => {
  if (!userData || !modsDownloaded) return;
  
  playButton.disabled = true;
  playButton.textContent = 'LANCEMENT...';
  
  const result = await ipcRenderer.invoke('launch-game', userData);
  
  if (!result.success) {
    playButton.disabled = false;
    playButton.textContent = 'JOUER';
    alert('Erreur: ' + result.error);
  }
});

init();
