const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, clipboard, nativeImage, dialog, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;

// Native Win32 SetWindowDisplayAffinity for OS-level capture exclusion
let SetWindowDisplayAffinity = null;
let SetWindowPos = null;
let RedrawWindow = null;
let GetLastError = null;

try {
  if (process.platform === 'win32') {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    SetWindowDisplayAffinity = user32.func('int SetWindowDisplayAffinity(void *hWnd, uint32 dwAffinity)');
    SetWindowPos = user32.func('bool SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)');
    RedrawWindow = user32.func('bool RedrawWindow(void *hWnd, void *lprcUpdate, void *hrgnUpdate, uint32 flags)');
    GetLastError = kernel32.func('uint32 GetLastError()');
  }
} catch (err) {
  console.warn('Native Win32 Koffi API load warning:', err.message);
}

// Function to enforce Private Mode / Screen Capture Exclusion
function applyPrivateMode(enable) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Electron maps content protection to WDA_MONITOR on Windows, which leaves
  // a black rectangle in captures. Use WDA_EXCLUDEFROMCAPTURE below instead.
  if (process.platform !== 'win32') {
    try {
      mainWindow.setContentProtection(enable);
    } catch (err) {
      console.error('Error setting Electron content protection:', err);
    }
  }

  // 2. Direct Win32 API SetWindowDisplayAffinity
  // WDA_EXCLUDEFROMCAPTURE = 0x00000011 (17 decimal) makes the window completely INVISIBLE during screen share/recording
  // WDA_NONE = 0x00 makes the window IMMEDIATELY visible on screen share when turned off.
  if (process.platform === 'win32' && SetWindowDisplayAffinity) {
    try {
      const handle = mainWindow.getNativeWindowHandle();
      if (handle) {
        const koffi = require('koffi');
        const hwndPtr = koffi.decode(handle, 'void *');
        
        // 0x11 = WDA_EXCLUDEFROMCAPTURE (completely invisible in screen share)
        // 0x00 = WDA_NONE (normal visibility, instantly visible in screen share)
        const success = SetWindowDisplayAffinity(hwndPtr, enable ? 0x11 : 0x00);
        
        // Force Windows DWM to instantly re-composite the window frame & capture buffer
        if (SetWindowPos) {
          // SWP_NOMOVE(0x0002) | SWP_NOSIZE(0x0001) | SWP_NOZORDER(0x0004) | SWP_FRAMECHANGED(0x0020)
          SetWindowPos(hwndPtr, null, 0, 0, 0, 0, 0x0027);
        }
        if (RedrawWindow) {
          // RDW_INVALIDATE(1) | RDW_UPDATENOW(0x0100) | RDW_ALLCHILDREN(0x0080)
          RedrawWindow(hwndPtr, null, null, 0x0181);
        }

        if (!success) {
          const errorCode = GetLastError ? GetLastError() : 'unknown';
          console.error(`[S-Notes] SetWindowDisplayAffinity failed (${enable ? '0x11 Private' : '0x00 Visible'}), Win32 error: ${errorCode}`);
        } else {
          console.log(`[S-Notes] SetWindowDisplayAffinity applied (${enable ? '0x11 Private' : '0x00 Visible'}).`);
        }
      }
    } catch (err) {
      console.error('Error setting Win32 display affinity:', err);
    }
  }
}

// Paths for persistent data
const userDataPath = app.getPath('userData');
const notesFilePath = path.join(userDataPath, 's-notes-data.txt');
const configFilePath = path.join(userDataPath, 's-notes-config.json');

// Default config
let config = {
  x: undefined,
  y: undefined,
  width: 380,
  height: 480,
  alwaysOnTop: true,
  privateMode: true, // Default enabled for private screen sharing protection
  opacity: 1.0,
  fontSize: 14,
  fontFamily: 'sans-serif',
  apiProvider: 'groq',
  groqApiKey: '',
  groqModel: 'openai/gpt-oss-120b',
  geminiApiKey: '',
  geminiModel: 'gemini-3.6-flash',
  shortcut: 'CommandOrControl+M'
};

// Load saved config
function loadConfigData() {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = fs.readFileSync(configFilePath, 'utf8');
      const saved = JSON.parse(data);
      config = { ...config, ...saved };
      let configChanged = false;
      if (config.groqModel === 'llama-3.3-70b-versatile') {
        config.groqModel = 'openai/gpt-oss-120b';
        configChanged = true;
      }
      if (config.geminiModel === 'gemini-2.0-flash') {
        config.geminiModel = 'gemini-3.6-flash';
        configChanged = true;
      }
      if (configChanged) {
        fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
      }
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return config;
}

// Save config
function saveConfigData(newConfig) {
  try {
    config = { ...config, ...newConfig };
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// Load notes
function loadNotesData() {
  try {
    if (fs.existsSync(notesFilePath)) {
      return fs.readFileSync(notesFilePath, 'utf8');
    }
  } catch (err) {
    console.error('Error loading notes:', err);
  }
  return '';
}

// Save notes
function saveNotesData(content) {
  try {
    fs.writeFileSync(notesFilePath, content, 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving notes:', err);
    return false;
  }
}

async function extractScreenText(screenImage) {
  if (typeof screenImage !== 'string' || !screenImage.startsWith('data:image/')) return '';
  const imageData = screenImage.slice(screenImage.indexOf(',') + 1);
  const result = await Tesseract.recognize(Buffer.from(imageData, 'base64'), 'eng');
  return result.data.text.replace(/\s+\n/g, '\n').trim().slice(0, 30000);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isInterviewQuestion(question) {
  return /\b(resume|cv|experience|project|background|introduce|introduction|interview|job|role|position|career|skill|strength|weakness|achievement|hire me|fit)\b/i.test(question);
}

function createWindow() {
  loadConfigData();

  // Create main window
  mainWindow = new BrowserWindow({
    x: config.x,
    y: config.y,
    width: Math.max(config.width || 380, 280),
    height: Math.max(config.height || 480, 240),
    minWidth: 280,
    minHeight: 220,
    frame: false,
    transparent: false,
    backgroundColor: '#222328',
    alwaysOnTop: config.alwaysOnTop,
    opacity: Math.max(0.3, Math.min(1.0, config.opacity || 1.0)),
    skipTaskbar: true,
    resizable: true,
    show: false, // Show when ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  // Highest z-order level ('screen-saver') & visible across all virtual desktops / full-screen apps
  if (config.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  }
  if (mainWindow.setVisibleOnAllWorkspaces) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // Set Private Mode (Screen Capture Exclusion)
  if (config.privateMode) {
    applyPrivateMode(true);
  }

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (config.alwaysOnTop) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
    mainWindow.show();
    applyPrivateMode(config.privateMode);
    mainWindow.focus();
  });

  // Save window dimensions and position when moved/resized
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    saveConfigData({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  };

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create system tray icon
function createTray() {
  try {
    // Generate a simple SVG-based canvas tray icon if file icon missing
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    const trayIcon = nativeImage.createFromBuffer(Buffer.from(iconSvg));
    tray = new Tray(trayIcon);

    const updateTrayMenu = () => {
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'S-Notes',
          enabled: false
        },
        { type: 'separator' },
        {
          label: mainWindow && mainWindow.isVisible() ? 'Hide Window' : 'Show Window',
          click: () => toggleWindowVisibility()
        },
        {
          label: 'Private Mode (Screen Share Invisible)',
          type: 'checkbox',
          checked: config.privateMode,
          click: (item) => {
            config.privateMode = item.checked;
            applyPrivateMode(config.privateMode);
            if (mainWindow) {
              mainWindow.webContents.send('private-mode-changed', config.privateMode);
            }
            saveConfigData({ privateMode: config.privateMode });
          }
        },
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: config.alwaysOnTop,
          click: (item) => {
            config.alwaysOnTop = item.checked;
            if (mainWindow) {
              mainWindow.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver', 1);
              if (mainWindow.setVisibleOnAllWorkspaces) {
                mainWindow.setVisibleOnAllWorkspaces(config.alwaysOnTop, { visibleOnFullScreen: true });
              }
              mainWindow.webContents.send('always-on-top-changed', config.alwaysOnTop);
            }
            saveConfigData({ alwaysOnTop: config.alwaysOnTop });
          }
        },
        { type: 'separator' },
        {
          label: 'Quit S-Notes',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]);
      tray.setContextMenu(contextMenu);
    };

    tray.setToolTip('S-Notes - Private Floating Notes');
    tray.on('click', () => toggleWindowVisibility());

    updateTrayMenu();
  } catch (err) {
    console.error('Tray creation failed:', err);
  }
}

function showAndFocusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  if (config.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  }
  mainWindow.moveTop();
  mainWindow.focus();
}

function toggleWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showAndFocusWindow();
    if (mainWindow.webContents) {
      mainWindow.webContents.send('global-toggle-focus');
    }
  }
}

// Register Global Shortcuts
function registerGlobalShortcut() {
  try {
    globalShortcut.unregisterAll();
    const shortcuts = ['CommandOrControl+M'];

    shortcuts.forEach((sc) => {
      try {
        globalShortcut.register(sc, () => {
          toggleWindowVisibility();
        });
      } catch (e) {
        // Ignore individual shortcut register error
      }
    });
  } catch (err) {
    console.error('Error registering global shortcuts:', err);
  }
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcut();

  app.on('activate', () => {
    showAndFocusWindow();
  });
});

app.on('second-instance', () => {
  showAndFocusWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('save-notes', (event, content) => {
  return saveNotesData(content);
});

ipcMain.handle('load-notes', () => {
  return loadNotesData();
});

ipcMain.handle('save-config', (event, newConfig) => {
  saveConfigData(newConfig);
  return config;
});

ipcMain.handle('load-config', () => {
  return loadConfigData();
});

ipcMain.handle('toggle-private-mode', (event, enable) => {
  config.privateMode = enable;
  applyPrivateMode(enable);
  saveConfigData({ privateMode: enable });
  return config.privateMode;
});

ipcMain.handle('toggle-always-on-top', (event, enable) => {
  config.alwaysOnTop = enable;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(enable, 'screen-saver', 1);
    if (mainWindow.setVisibleOnAllWorkspaces) {
      mainWindow.setVisibleOnAllWorkspaces(enable, { visibleOnFullScreen: true });
    }
  }
  saveConfigData({ alwaysOnTop: enable });
  return config.alwaysOnTop;
});

ipcMain.handle('set-opacity', (event, opacityVal) => {
  const op = Math.max(0.3, Math.min(1.0, parseFloat(opacityVal) || 1.0));
  config.opacity = op;
  if (mainWindow) {
    mainWindow.setOpacity(op);
  }
  saveConfigData({ opacity: op });
  return config.opacity;
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('hide-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text || '');
  return true;
});

ipcMain.handle('select-resume', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your resume',
    properties: ['openFile'],
    filters: [
      { name: 'Resume files', extensions: ['pdf', 'docx', 'txt', 'md'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).toLowerCase();
  const fileBuffer = await fs.promises.readFile(filePath);
  let text = '';
  if (extension === '.pdf') {
    text = (await pdfParse(fileBuffer)).text;
  } else if (extension === '.docx') {
    text = (await mammoth.extractRawText({ buffer: fileBuffer })).value;
  } else if (extension === '.txt' || extension === '.md') {
    text = fileBuffer.toString('utf8');
  } else {
    throw new Error('Use a PDF, DOCX, TXT, or Markdown resume.');
  }

  const normalizedText = text.replace(/\u0000/g, '').trim();
  if (!normalizedText) throw new Error('No readable text was found in that resume.');
  return {
    name: path.basename(filePath),
    text: normalizedText.slice(0, 50000)
  };
});

ipcMain.handle('capture-screen', async () => {
  const primaryDisplayId = String(screen.getPrimaryDisplay().id);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 720 }
  });
  const source = sources.find((item) => item.display_id === primaryDisplayId) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Unable to capture the current screen.');
  }
  return source.thumbnail.toDataURL();
});

ipcMain.handle('ask-groq', async (event, question, history, interviewBrief = {}, screenImage = '', sessionMode = 'interview') => {
  const prompt = typeof question === 'string' ? question.trim() : '';
  const provider = config.apiProvider === 'gemini' ? 'gemini' : 'groq';
  const apiKey = provider === 'gemini' ? config.geminiApiKey : config.groqApiKey;
  const model = provider === 'gemini' ? config.geminiModel?.trim() : config.groqModel?.trim();
  if (!apiKey) {
    throw new Error(`Add your ${provider === 'gemini' ? 'Gemini' : 'Groq'} API key in settings first.`);
  }
  if (!prompt) {
    throw new Error('There is no question to send.');
  }
  const historyMessages = Array.isArray(history)
    ? history.slice(-10).flatMap((item) => {
      const messages = [];
      if (typeof item?.question === 'string' && item.question.trim()) {
        messages.push({ role: 'user', content: item.question.trim() });
      }
      const assistantResponse = [
        typeof item?.answer === 'string' ? item.answer.trim() : '',
        typeof item?.code === 'string' && item.code.trim() ? `CODE_BEGIN\n${item.code.trim()}\nCODE_END` : '',
        typeof item?.why === 'string' && item.why.trim() ? `WHY:\n${item.why.trim()}` : ''
      ].filter(Boolean).join('\n\n');
      if (assistantResponse) {
        messages.push({ role: 'assistant', content: assistantResponse });
      }
      return messages;
    })
    : [];
  const resumeText = typeof interviewBrief.resumeText === 'string' ? interviewBrief.resumeText.trim().slice(0, 50000) : '';
  const requirements = typeof interviewBrief.requirements === 'string' ? interviewBrief.requirements.trim().slice(0, 30000) : '';
  const screenText = await extractScreenText(screenImage);
  const useInterviewContext = !screenText && isInterviewQuestion(prompt);
  if (!model) {
    throw new Error(`Choose a ${provider === 'gemini' ? 'Gemini' : 'Groq'} model in settings before asking a question.`);
  }
  const interviewContext = [
    useInterviewContext && resumeText ? `RESUME:\n${resumeText}` : '',
    useInterviewContext && requirements ? `ROLE REQUIREMENTS / JOB DESCRIPTION:\n${requirements}` : '',
    screenText ? `SCREEN TEXT (extracted locally from the attached screenshot):\n${screenText}` : ''
  ].filter(Boolean).join('\n\n');
  const screenAnswerFormat = screenText
    ? `When SCREEN TEXT contains more than one visible multiple-choice question, fill-in-the-blank question, or direct question, answer every visible question in order. Number each answer and use exactly three lines per question:

1. Answer: <the answer>
Explanation: <one concise sentence explaining why>
<one concise sentence with the remaining key reason>

When SCREEN TEXT contains one visible multiple-choice question, fill-in-the-blank question, or direct question, answer it using exactly three lines:

Answer: <the answer>
Explanation: <one concise sentence explaining why>
<one concise sentence with the remaining key reason>
For multiple-choice questions, the answer line must include the option letter and the option text. For fill-in-the-blank questions, provide only the missing word or phrase on the answer line. Do not add Markdown, headings, bullets, introductions, or any other lines for these question types.

For code, explanations, summaries, or any other screen content, answer normally using the user's question and the screen text. Do not use the three-line format unless the user is asking about a multiple-choice, fill-in-the-blank, or direct question.`
    : '';
  const examInstruction = sessionMode === 'exam'
    ? `You are conducting a mock exam. The user starts by asking to start an exam for a topic. Respond with one clear question only, without its answer. For every later user response, evaluate it against the preceding exam question in the conversation history. State whether it is correct, give a concise correction or explanation, then ask exactly one next question. Gradually vary the topic and difficulty. When the user asks for a summary, list strong topics and topics needing practice based only on their answers.`
    : '';
  const systemPrompt = `Answer the user's actual question clearly and directly. Use the resume and role requirements only when the question asks about the candidate's background, projects, skills, experience, introduction, interview answers, job fit, or the role. In those cases, use the supplied material as the factual source and never invent an employer, project, metric, skill, or experience.

For every interview question, write the exact answer the candidate should say aloud: first person, natural, confident, and concise. Use one or two short paragraphs, usually 80 to 130 words. Mention only the two or three most relevant details. Do not reproduce the resume. Do not list every job or project. Never use Markdown, headings, bullets, a title, an introduction such as "Sure", or phrases such as "here is an overview". For questions such as "tell me about your experience" or "introduce yourself", answer from the resume even when no job description is provided. When role requirements are provided, connect the selected resume details to those requirements. Never ask for a job description when a resume is available; simply give the strongest general answer from the resume.

For unrelated general questions, answer from general knowledge without mentioning the resume, job description, candidate, or interview preparation. When SCREEN TEXT is supplied, use it only when the question is about the captured screen. If it lacks enough information, say exactly what is missing. ${examInstruction ? `\n\n${examInstruction}` : ''}${screenAnswerFormat ? `\n\n${screenAnswerFormat}` : ''}${interviewContext ? `\n\n${interviewContext}` : ''}`;

  if (provider === 'gemini') {
    const geminiContents = [...historyMessages, { role: 'user', content: prompt }].map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));
    const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiContents,
      generationConfig: { temperature: 0, maxOutputTokens: 1024 }
    });
    let response;
    let data = {};
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
      data = await response.json().catch(() => ({}));
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await wait(1000 * (2 ** attempt));
    }
    if (!response.ok) throw new Error(data.error?.message || `Gemini request failed (${response.status}).`);
    const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!answer) throw new Error('Gemini returned an empty response.');
    return answer;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        ...historyMessages,
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      max_completion_tokens: 400
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Groq request failed (${response.status}).`);
  }
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error('Groq returned an empty response.');
  }
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error('Groq reached its response limit before completing the code. Please ask again.');
  }
  return answer;
});

ipcMain.handle('transcribe-groq', async (event, audioData, mimeType) => {
  if (!config.groqApiKey) {
    throw new Error('Add your Groq API key in settings first.');
  }
  if (!audioData || !audioData.byteLength) {
    throw new Error('No microphone audio was captured.');
  }

  const audioBuffer = Buffer.from(audioData);
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: mimeType || 'audio/webm' }), 'speech.webm');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.groqApiKey}` },
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Groq transcription failed (${response.status}).`);
  }
  if (!data.text?.trim()) {
    throw new Error('Groq could not detect speech in that recording.');
  }
  return data.text.trim();
});
