const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const AdmZip = require('adm-zip');
const supabase = require('./supabase');

let mainWindow;
const GITHUB_REPO = 'TheAmazingArtixx/mod-Ouche-Nation';
const SERVER_IP = '185.44.80.33';
const SERVER_PORT = '25545';
const MC_VERSION = '1.20.1';
const FORGE_VERSION = '47.3.0';

const LAUNCHER_DIR = path.join(app.getPath('appData'), '.ouchenation');
const MINECRAFT_DIR = path.join(LAUNCHER_DIR, 'minecraft');
const MODS_DIR = path.join(MINECRAFT_DIR, 'mods');
const JAVA_DIR = path.join(LAUNCHER_DIR, 'runtime');
const FORGE_DIR = path.join(LAUNCHER_DIR, 'forge');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    resizable: true,
    backgroundColor: '#000000',
    icon: path.join(__dirname, 'icon.ico')
  });

  mainWindow.loadFile('index.html');
  
  // Ouvrir la console pour debug
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Test Supabase
ipcMain.handle('test-supabase', async () => {
  try {
    console.log('[TEST] Connexion à Supabase...');
    
    const { data, error } = await supabase
      .from('users')
      .select('*');
    
    console.log('[TEST] Résultat:', { data, error });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, data };
  } catch (error) {
    console.error('[TEST] Erreur:', error);
    return { success: false, error: error.message };
  }
});

// Inscription
ipcMain.handle('register', async (event, { username, password }) => {
  try {
    console.log('[REGISTER] Tentative inscription:', username);
    event.sender.send('game-log', `📝 Création du compte ${username}...`);
    
    // Vérifier si l'utilisateur existe
    const { data: existing, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .maybeSingle();
    
    console.log('[REGISTER] Vérification:', { existing, checkError });
    
    if (existing) {
      return { success: false, error: 'Ce pseudo est déjà pris' };
    }
    
    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('[REGISTER] Mot de passe hashé');
    
    // Insérer l'utilisateur
    const { data, error } = await supabase
      .from('users')
      .insert([{ username, password: hashedPassword }])
      .select();
    
    console.log('[REGISTER] Insertion:', { data, error });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    await saveConfig(username);
    event.sender.send('game-log', `✅ Compte créé !`);
    
    return {
      success: true,
      username: username,
      uuid: generateUUID(username),
      accessToken: 'offline'
    };
  } catch (error) {
    console.error('[REGISTER] Erreur:', error);
    return { success: false, error: error.message };
  }
});

// Connexion
ipcMain.handle('login', async (event, { username, password }) => {
  try {
    console.log('[LOGIN] Tentative connexion:', username);
    event.sender.send('game-log', `🔐 Connexion...`);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .maybeSingle();
    
    console.log('[LOGIN] Recherche utilisateur:', { user, error });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    if (!user) {
      return { success: false, error: 'Pseudo ou mot de passe incorrect' };
    }
    
    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('[LOGIN] Mot de passe valide:', validPassword);
    
    if (!validPassword) {
      return { success: false, error: 'Pseudo ou mot de passe incorrect' };
    }
    
    await saveConfig(username);
    event.sender.send('game-log', `✅ Connecté !`);
    
    return {
      success: true,
      username: username,
      uuid: generateUUID(username),
      accessToken: 'offline'
    };
  } catch (error) {
    console.error('[LOGIN] Erreur:', error);
    return { success: false, error: error.message };
  }
});

function generateUUID(username) {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(32, '0').substring(0, 32);
}

async function saveConfig(username) {
  const configFile = path.join(LAUNCHER_DIR, 'config.json');
  await fs.ensureDir(LAUNCHER_DIR);
  await fs.writeFile(configFile, JSON.stringify({ username, lastLogin: Date.now() }));
}

ipcMain.handle('auto-init', async (event) => {
  try {
    const configFile = path.join(LAUNCHER_DIR, 'config.json');
    let config = {};
    
    if (fs.existsSync(configFile)) {
      config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    }
    
    return { success: true, config };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Vérifier si le setup est terminé
ipcMain.handle('check-setup', async () => {
  const javaPath = path.join(JAVA_DIR, 'bin', 'java.exe');
  return { setupComplete: fs.existsSync(javaPath) };
});

// Installer Java
async function installJava(event) {
  try {
    const javaExe = path.join(JAVA_DIR, 'bin', 'java.exe');
    
    if (fs.existsSync(javaExe)) {
      event.sender.send('game-log', '✅ Java prêt');
      return javaExe;
    }
    
    event.sender.send('game-log', '☕ Téléchargement de Java 17 (100 MB)...');
    await fs.ensureDir(JAVA_DIR);
    
    const javaUrl = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.11%2B9/OpenJDK17U-jre_x64_windows_hotspot_17.0.11_9.zip';
    const javaZip = path.join(LAUNCHER_DIR, 'java.zip');
    
    const response = await fetch(javaUrl);
    const buffer = await response.buffer();
    await fs.writeFile(javaZip, buffer);
    
    event.sender.send('game-log', '📦 Extraction de Java...');
    
    const zip = new AdmZip(javaZip);
    zip.extractAllTo(JAVA_DIR, true);
    
    const files = await fs.readdir(JAVA_DIR);
    for (const file of files) {
      const fullPath = path.join(JAVA_DIR, file);
      if (fs.statSync(fullPath).isDirectory() && file.startsWith('jdk')) {
        const binPath = path.join(fullPath, 'bin', 'java.exe');
        if (fs.existsSync(binPath)) {
          const contents = await fs.readdir(fullPath);
          for (const item of contents) {
            await fs.move(path.join(fullPath, item), path.join(JAVA_DIR, item), { overwrite: true });
          }
          await fs.remove(fullPath);
          break;
        }
      }
    }
    
    await fs.remove(javaZip);
    event.sender.send('game-log', '✅ Java installé !');
    
    return javaExe;
  } catch (error) {
    event.sender.send('game-log', `❌ Erreur Java: ${error.message}`);
    throw error;
  }
}

// Installer Forge
async function setupForge(event, javaPath) {
  try {
    const forgeVersionName = `${MC_VERSION}-forge-${FORGE_VERSION}`;
    const forgeVersionDir = path.join(MINECRAFT_DIR, 'versions', forgeVersionName);
    const forgeJsonPath = path.join(forgeVersionDir, `${forgeVersionName}.json`);
    const forgeJarPath = path.join(forgeVersionDir, `${forgeVersionName}.jar`);
    
    if (fs.existsSync(forgeJsonPath) && fs.existsSync(forgeJarPath)) {
      event.sender.send('game-log', '✅ Forge déjà installé');
      return forgeVersionName;
    }
    
    event.sender.send('game-log', '🔧 Installation de Forge 1.20.1...');
    event.sender.send('game-log', '⏳ Cela peut prendre 3-5 minutes...');
    
    await fs.ensureDir(FORGE_DIR);
    await fs.ensureDir(MINECRAFT_DIR);
    await fs.ensureDir(forgeVersionDir);
    
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${MC_VERSION}-${FORGE_VERSION}/forge-${MC_VERSION}-${FORGE_VERSION}-installer.jar`;
    const installerPath = path.join(FORGE_DIR, 'installer.jar');
    
    event.sender.send('game-log', '📥 Téléchargement de Forge (50 MB)...');
    
    const response = await fetch(installerUrl);
    const buffer = await response.buffer();
    await fs.writeFile(installerPath, buffer);
    
    event.sender.send('game-log', '✅ Téléchargement terminé');
    event.sender.send('game-log', '⚙️ Installation de Forge...');
    event.sender.send('game-log', '⏳ Ne ferme pas le launcher...');
    
    return new Promise((resolve) => {
      const installer = spawn(javaPath, [
        '-jar',
        installerPath,
        '--installClient',
        MINECRAFT_DIR
      ], {
        cwd: FORGE_DIR,
        windowsHide: true
      });
      
      let lastLog = '';
      
      installer.stdout.on('data', (data) => {
        const log = data.toString().trim();
        if (log && log !== lastLog) {
          event.sender.send('game-log', log);
          lastLog = log;
        }
      });
      
      installer.stderr.on('data', (data) => {
        const log = data.toString().trim();
        if (log && log !== lastLog) {
          event.sender.send('game-log', log);
          lastLog = log;
        }
      });
      
      installer.on('close', async (code) => {
        const checkJson = fs.existsSync(forgeJsonPath);
        const checkJar = fs.existsSync(forgeJarPath);
        
        if (checkJson && checkJar) {
          event.sender.send('game-log', '✅ Forge installé avec succès !');
          resolve(forgeVersionName);
        } else {
          event.sender.send('game-log', '⚠️ Recherche de Forge...');
          
          try {
            const versionsDir = path.join(MINECRAFT_DIR, 'versions');
            if (fs.existsSync(versionsDir)) {
              const versionFolders = await fs.readdir(versionsDir);
              
              for (const folder of versionFolders) {
                if (folder.includes('forge') && folder.includes(MC_VERSION)) {
                  event.sender.send('game-log', `✅ Trouvé: ${folder}`);
                  resolve(folder);
                  return;
                }
              }
            }
          } catch (e) {
            event.sender.send('game-log', `❌ ${e.message}`);
          }
          
          event.sender.send('game-log', '❌ Échec installation Forge');
          resolve(null);
        }
      });
      
      installer.on('error', (err) => {
        event.sender.send('game-log', `❌ Erreur: ${err.message}`);
        resolve(null);
      });
    });
  } catch (error) {
    event.sender.send('game-log', `❌ Erreur Forge: ${error.message}`);
    return null;
  }
}

// Setup initial
ipcMain.handle('initial-setup', async (event) => {
  try {
    event.sender.send('game-log', '🚀 Configuration initiale...');
    
    const javaPath = await installJava(event);
    const forgeVersion = await setupForge(event, javaPath);
    
    if (!forgeVersion) {
      return { 
        success: false, 
        error: 'Installation de Forge échouée. Réessaye.' 
      };
    }
    
    event.sender.send('game-log', '✅ Configuration terminée !');
    
    return { 
      success: true, 
      javaPath,
      forgeVersion 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Télécharger les mods
ipcMain.handle('download-mods', async (event) => {
  try {
    await fs.ensureDir(MODS_DIR);
    
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
    const response = await fetch(apiUrl);
    const files = await response.json();
    
    if (!Array.isArray(files)) {
      throw new Error('Repo introuvable');
    }
    
    const modFiles = files.filter(f => f.name && f.name.endsWith('.jar'));
    
    if (modFiles.length === 0) {
      return { success: true, count: 0 };
    }
    
    event.sender.send('download-progress', { total: modFiles.length, current: 0 });
    
    for (let i = 0; i < modFiles.length; i++) {
      const mod = modFiles[i];
      const modPath = path.join(MODS_DIR, mod.name);
      
      if (fs.existsSync(modPath)) {
        event.sender.send('download-progress', {
          total: modFiles.length,
          current: i + 1,
          name: mod.name,
          cached: true
        });
        continue;
      }
      
      event.sender.send('download-progress', {
        total: modFiles.length,
        current: i + 1,
        name: mod.name
      });
      
      const modResponse = await fetch(mod.download_url);
      const buffer = await modResponse.buffer();
      await fs.writeFile(modPath, buffer);
    }
    
    return { success: true, count: modFiles.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Lancer Minecraft
ipcMain.handle('launch-game', async (event, userData) => {
  try {
    event.sender.send('game-log', '🎮 Préparation du lancement...');
    
    const javaExe = path.join(JAVA_DIR, 'bin', 'java.exe');
    if (!fs.existsSync(javaExe)) {
      return { success: false, error: 'Java non installé. Relance le launcher.' };
    }
    
    const versionsDir = path.join(MINECRAFT_DIR, 'versions');
    let forgeVersion = null;
    
    if (fs.existsSync(versionsDir)) {
      const folders = await fs.readdir(versionsDir);
      for (const folder of folders) {
        if (folder.includes('forge') && folder.includes(MC_VERSION)) {
          forgeVersion = folder;
          break;
        }
      }
    }
    
    if (!forgeVersion) {
      return { 
        success: false, 
        error: 'Forge non trouvé. Réinstalle le launcher.' 
      };
    }
    
    event.sender.send('game-log', `🚀 Lancement avec ${forgeVersion}...`);
    
    const launcher = new Client();
    
    const opts = {
      authorization: {
        access_token: userData.accessToken,
        client_token: userData.uuid,
        uuid: userData.uuid,
        name: userData.username,
        user_properties: '{}'
      },
      root: MINECRAFT_DIR,
      version: {
        number: MC_VERSION,
        type: "release",
        custom: forgeVersion
      },
      memory: {
        max: "4G",
        min: "2G"
      },
      javaPath: javaExe
    };

    launcher.on('debug', (e) => event.sender.send('game-log', e));
    launcher.on('data', (e) => event.sender.send('game-log', e));
    launcher.on('close', (code) => {
      event.sender.send('game-closed', code);
    });
    
    await launcher.launch(opts);
    
    setTimeout(() => {
      event.sender.send('game-log', '');
      event.sender.send('game-log', '══════════════════════════════');
      event.sender.send('game-log', '📌 REJOINDRE LE SERVEUR :');
      event.sender.send('game-log', '1. Multijoueur');
      event.sender.send('game-log', `2. Ajouter: ${SERVER_IP}:${SERVER_PORT}`);
      event.sender.send('game-log', '══════════════════════════════');
    }, 8000);
    
    return { success: true };
  } catch (error) {
    event.sender.send('game-log', `❌ ${error.message}`);
    return { success: false, error: error.message };
  }
});
