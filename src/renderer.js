document.addEventListener('DOMContentLoaded', async () => {
  const conversationList = document.getElementById('conversation-list');
  const emptyState = document.getElementById('empty-state');
  const charCountEl = document.getElementById('char-count');
  const wordCountEl = document.getElementById('word-count');
  const fontSizeLabel = document.getElementById('font-size-label');
  const btnListen = document.getElementById('btn-listen');
  const btnSystemAudio = document.getElementById('btn-system-audio');
  const btnAnalyzeScreen = document.getElementById('btn-analyze-screen');
  const btnGroqSettings = document.getElementById('btn-groq-settings');
  const btnPrivateMode = document.getElementById('btn-private-mode');
  const btnAlwaysTop = document.getElementById('btn-always-top');
  const btnCopy = document.getElementById('btn-copy');
  const btnClear = document.getElementById('btn-clear');
  const btnMinimize = document.getElementById('btn-minimize');
  const btnClose = document.getElementById('btn-close');
  const btnFontDec = document.getElementById('btn-font-dec');
  const btnFontInc = document.getElementById('btn-font-inc');
  const privateBanner = document.getElementById('private-banner');
  const opacityRange = document.getElementById('opacity-range');
  const opacityValue = document.getElementById('opacity-value');
  const clearModal = document.getElementById('clear-modal');
  const btnConfirmClear = document.getElementById('btn-confirm-clear');
  const btnCancelClear = document.getElementById('btn-cancel-clear');
  const groqModal = document.getElementById('groq-modal');
  const apiProvider = document.getElementById('api-provider');
  const apiKeyLabel = document.getElementById('api-key-label');
  const groqApiKey = document.getElementById('groq-api-key');
  const modelLabel = document.getElementById('model-label');
  const groqModel = document.getElementById('groq-model');
  const btnSaveGroq = document.getElementById('btn-save-groq');
  const btnCancelGroq = document.getElementById('btn-cancel-groq');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const chatComposer = document.getElementById('chat-composer');
  const chatInput = document.getElementById('chat-input');
  const btnAttachResume = document.getElementById('btn-attach-resume');
  const btnRemoveResume = document.getElementById('btn-remove-resume');
  const resumeStatus = document.getElementById('resume-status');
  const resumeName = document.getElementById('resume-name');
  const requirementsInput = document.getElementById('requirements-input');
  const promptButtons = document.querySelectorAll('.prompt-chip');
  const setupScreen = document.getElementById('setup-screen');
  const answerScreen = document.getElementById('answer-screen');
  const btnStartInterview = document.getElementById('btn-start-interview');
  const btnStartExam = document.getElementById('btn-start-exam');
  const btnEditBrief = document.getElementById('btn-edit-brief');

  let conversations = [];
  let mediaStream = null;
  let displayStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isListening = false;
  let captureMode = '';
  let toastTimeout = null;
  let currentConfig = { alwaysOnTop: true, privateMode: true, opacity: 1, fontSize: 14, apiProvider: 'groq', groqApiKey: '', groqModel: 'openai/gpt-oss-120b', geminiApiKey: '', geminiModel: 'gemini-3.6-flash' };
  let interviewBrief = { resumeText: '', requirements: '' };
  let pendingScreenImage = '';
  let activeScreenImage = '';
  let sessionMode = 'interview';

  function showToast(message, duration = 2500) {
    clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function updateCounters() {
    const words = conversations.reduce((total, conversation) => total + conversation.question.trim().split(/\s+/).filter(Boolean).length, 0);
    charCountEl.textContent = `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`;
    wordCountEl.textContent = isListening ? 'Listening' : `${words} word${words === 1 ? '' : 's'}`;
    emptyState.classList.toggle('hidden', conversations.length > 0);
  }

  function setFontSize(size) {
    const clampedSize = Math.max(10, Math.min(32, size));
    currentConfig.fontSize = clampedSize;
    conversationList.style.fontSize = `${clampedSize}px`;
    fontSizeLabel.textContent = `${clampedSize}px`;
    window.sNotesAPI?.saveConfig({ fontSize: clampedSize });
  }

  function updatePrivateModeUI(enabled) {
    currentConfig.privateMode = enabled;
    btnPrivateMode.classList.toggle('active', enabled);
    privateBanner.classList.toggle('hidden', !enabled);
  }

  function updateAlwaysOnTopUI(enabled) {
    currentConfig.alwaysOnTop = enabled;
    btnAlwaysTop.classList.toggle('active', enabled);
  }

  function updateProviderFields() {
    const isGemini = apiProvider.value === 'gemini';
    apiKeyLabel.textContent = isGemini ? 'Gemini API key' : 'Groq API key';
    modelLabel.textContent = isGemini ? 'Gemini model' : 'Groq model';
    groqApiKey.placeholder = isGemini ? 'AIza...' : 'gsk_...';
    groqApiKey.value = isGemini ? (currentConfig.geminiApiKey || '') : (currentConfig.groqApiKey || '');
    groqModel.value = isGemini ? (currentConfig.geminiModel || 'gemini-3.6-flash') : (currentConfig.groqModel || 'openai/gpt-oss-120b');
  }

  function createSendIcon() {
    return '<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  }

  function parseAnswer(response) {
    const text = response
      .replace(/\\n/g, '\n')
      .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
      .trim();
    const codeMatch = text.match(/CODE_BEGIN\s*\n([\s\S]*?)\n?CODE_END\s*(?:\n|$)([\s\S]*)/);
    if (codeMatch) {
      return {
        answer: '',
        code: codeMatch[1].trim(),
        why: codeMatch[2].replace(/^WHY:\s*/i, '').trim()
      };
    }
    const [answer, why = ''] = text.split(/\n?WHY:\s*/i, 2);
    return { answer: answer.replace(/^ANSWER:\s*/i, '').trim(), code: '', why: why.trim() };
  }

  function renderConversations() {
    conversationList.replaceChildren();
    conversations.forEach((conversation, index) => {
      const card = document.createElement('article');
      card.className = 'conversation-card';
      const row = document.createElement('div');
      row.className = 'conversation-question-row';
      const question = document.createElement('div');
      question.className = 'conversation-question';
      question.textContent = conversation.question;
      const sendButton = document.createElement('button');
      sendButton.className = 'send-question-btn';
      sendButton.type = 'button';
      sendButton.title = 'Ask Groq';
      sendButton.setAttribute('aria-label', 'Ask Groq');
      sendButton.innerHTML = createSendIcon();
      sendButton.addEventListener('click', () => answerConversation(index, card, sendButton));
      row.append(question, sendButton);
      card.append(row);
      if (conversation.screenImage) {
        const attachment = document.createElement('div');
        attachment.className = 'screen-attachment';
        const image = document.createElement('img');
        image.src = conversation.screenImage;
        image.alt = 'Captured screen attached to this question';
        const label = document.createElement('span');
        label.textContent = 'Screen attached';
        attachment.append(image, label);
        card.append(attachment);
      }
      if (conversation.code) {
        const answer = document.createElement('div');
        answer.className = 'conversation-answer';
        const codeActions = document.createElement('div');
        codeActions.className = 'code-actions';
        const copyCodeButton = document.createElement('button');
        copyCodeButton.className = 'copy-code-btn';
        copyCodeButton.type = 'button';
        copyCodeButton.textContent = 'Copy code';
        copyCodeButton.addEventListener('click', async () => {
          await window.sNotesAPI?.copyToClipboard(conversation.code);
          showToast('Code copied');
        });
        const code = document.createElement('pre');
        code.className = 'conversation-code';
        code.textContent = conversation.code;
        const why = document.createElement('div');
        why.className = 'conversation-why';
        why.textContent = `Why:\n${conversation.why}`;
        codeActions.append(copyCodeButton);
        answer.append(codeActions, code, why);
        card.append(answer);
      } else if (conversation.answer) {
        const answer = document.createElement('div');
        answer.className = 'conversation-answer';
        answer.textContent = `${conversation.answer}${conversation.why ? `\n\nWhy:\n${conversation.why}` : ''}`;
        card.append(answer);
      }
      conversationList.append(card);
    });
    updateCounters();
  }

  async function answerConversation(index, card, sendButton) {
    if (!window.sNotesAPI) return;
    const answer = document.createElement('div');
    answer.className = 'conversation-answer';
    answer.textContent = 'Asking Groq...';
    card.append(answer);
    card.classList.add('is-answering');
    sendButton.disabled = true;
    try {
      const response = await window.sNotesAPI.askGroq(conversations[index].question, conversations.slice(0, index), interviewBrief, conversations[index].screenImage, sessionMode);
      Object.assign(conversations[index], parseAnswer(response));
      renderConversations();
    } catch (error) {
      answer.textContent = `Unable to answer: ${error.message || 'Unknown error'}`;
      showToast(error.message || 'Groq request failed');
    } finally {
      card.classList.remove('is-answering');
      sendButton.disabled = false;
    }
  }

  function addConversation(question, sendImmediately = false) {
    const text = question.trim();
    if (!text) return;
    const index = conversations.length;
    conversations.push({ question: text, answer: '', code: '', why: '', screenImage: pendingScreenImage || activeScreenImage });
    pendingScreenImage = '';
    btnAnalyzeScreen.classList.remove('active');
    renderConversations();
    conversationList.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    if (sendImmediately) {
      const card = conversationList.children[index];
      const sendButton = card?.querySelector('.send-question-btn');
      if (card && sendButton) answerConversation(index, card, sendButton);
    }
  }

  function submitChat(question) {
    const text = question.trim();
    if (!text) return;
    addConversation(text, true);
  }

  function copyConversations() {
    const text = conversations.map((item) => `${item.question}${item.answer ? `\n${item.answer}` : ''}`).join('\n\n');
    if (!text) return showToast('There are no conversations to copy');
    window.sNotesAPI?.copyToClipboard(text);
    showToast('Copied to clipboard');
  }

  function updateResumeUI(name = '') {
    const hasResume = Boolean(name);
    resumeStatus.classList.toggle('empty', !hasResume);
    resumeName.textContent = hasResume ? name : 'No resume attached';
    btnRemoveResume.classList.toggle('hidden', !hasResume);
  }

  function showAnswerScreen() {
    if (!interviewBrief.resumeText) {
      showToast('Attach your resume before starting.');
      return;
    }
    setupScreen.classList.add('hidden');
    answerScreen.classList.remove('hidden');
    chatInput.focus();
  }

  function startMockExam() {
    const topic = requirementsInput.value.trim();
    if (!topic) {
      showToast('Enter an exam topic before starting.');
      return;
    }
    sessionMode = 'exam';
    setupScreen.classList.add('hidden');
    answerScreen.classList.remove('hidden');
    emptyState.textContent = 'Your mock exam will appear here.';
    submitChat(`Start a mock exam on ${topic}. Ask question 1.`);
  }

  function showSetupScreen() {
    setListening(false);
    stopMicrophone();
    answerScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
  }

  async function attachResume() {
    try {
      const resume = await window.sNotesAPI?.selectResume();
      if (!resume) return;
      interviewBrief.resumeText = resume.text;
      updateResumeUI(resume.name);
      showToast('Resume attached for this session');
    } catch (error) {
      showToast(error.message || 'Unable to read that resume.');
    }
  }

  async function captureScreen() {
    try {
      btnAnalyzeScreen.disabled = true;
      pendingScreenImage = await window.sNotesAPI?.captureScreen() || '';
      if (!pendingScreenImage) throw new Error('Unable to capture the current screen.');
      activeScreenImage = pendingScreenImage;
      btnAnalyzeScreen.classList.add('active');
      chatInput.focus();
      showToast('Screen captured. It stays available for follow-up questions.');
    } catch (error) {
      showToast(error.message || 'Unable to capture the current screen.');
    } finally {
      btnAnalyzeScreen.disabled = false;
    }
  }

  function setListening(listening, mode = '') {
    isListening = listening;
    captureMode = listening ? mode : '';
    btnListen.classList.toggle('active', listening && mode === 'microphone');
    btnSystemAudio.classList.toggle('active', listening && mode === 'system');
    btnListen.title = listening && mode === 'microphone' ? 'End listening and ask Groq' : 'Start listening through your microphone';
    btnSystemAudio.title = listening && mode === 'system' ? 'End system audio capture and ask Groq' : 'Capture disclosed system audio';
    updateCounters();
  }

  function stopMicrophone() {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    else closeMicrophone();
  }

  function closeMicrophone() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    displayStream?.getTracks().forEach((track) => track.stop());
    displayStream = null;
  }

  function startAudioSegment() {
    if (!mediaStream || !isListening) return;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) audioChunks.push(event.data);
    };
    mediaRecorder.onstop = async () => {
      const audio = new Blob(audioChunks, { type: mimeType });
      if (audio.size && window.sNotesAPI) {
        try {
          const text = await window.sNotesAPI.transcribeGroq(new Uint8Array(await audio.arrayBuffer()), mimeType);
          addConversation(text, true);
        } catch (error) {
          showToast(error.message || 'Unable to transcribe microphone audio.');
        }
      }
      if (isListening) startAudioSegment();
      else closeMicrophone();
    };
    mediaRecorder.start();
  }

  async function startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('Microphone recording is not available in this Electron version.');
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startAudioSegment();
  }

  async function startSystemAudio() {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      throw new Error('System audio capture is not available in this Electron version.');
    }
    displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    const audioTracks = displayStream.getAudioTracks();
    if (!audioTracks.length) {
      displayStream.getTracks().forEach((track) => track.stop());
      displayStream = null;
      throw new Error('No system audio was selected. In the share dialog, select a source and enable Share system audio.');
    }
    mediaStream = new MediaStream(audioTracks);
    audioTracks[0].addEventListener('ended', () => {
      if (captureMode === 'system') {
        setListening(false);
        stopMicrophone();
      }
    });
    startAudioSegment();
  }

  async function init() {
    if (!window.sNotesAPI) return;
    const config = await window.sNotesAPI.loadConfig();
    currentConfig = { ...currentConfig, ...config };
    updatePrivateModeUI(Boolean(currentConfig.privateMode));
    updateAlwaysOnTopUI(Boolean(currentConfig.alwaysOnTop));
    setFontSize(currentConfig.fontSize);
    const opacity = Math.round((currentConfig.opacity ?? 1) * 100);
    opacityRange.value = opacity;
    opacityValue.textContent = `${opacity}%`;
    apiProvider.value = currentConfig.apiProvider === 'gemini' ? 'gemini' : 'groq';
    updateProviderFields();
    conversations = [];
    interviewBrief = { resumeText: '', requirements: '' };
    requirementsInput.value = '';
    updateResumeUI();
    await window.sNotesAPI.saveNotes('');
    renderConversations();
  }

  btnListen.addEventListener('click', async () => {
    if (isListening) {
      setListening(false);
      stopMicrophone();
    } else {
      try {
        setListening(true, 'microphone');
        await startMicrophone();
      } catch (error) {
        setListening(false);
        closeMicrophone();
        showToast(error.message || 'Unable to start the microphone.');
      }
    }
  });
  btnSystemAudio.addEventListener('click', async () => {
    if (isListening) {
      if (captureMode !== 'system') {
        showToast('End microphone listening before starting system audio.');
        return;
      }
      setListening(false);
      stopMicrophone();
    } else {
      try {
        setListening(true, 'system');
        await startSystemAudio();
      } catch (error) {
        setListening(false);
        closeMicrophone();
        showToast(error.message || 'Unable to start system audio capture.');
      }
    }
  });
  btnGroqSettings.addEventListener('click', () => {
    apiProvider.value = currentConfig.apiProvider === 'gemini' ? 'gemini' : 'groq';
    updateProviderFields();
    groqModal.classList.remove('hidden');
  });
  btnCancelGroq.addEventListener('click', () => groqModal.classList.add('hidden'));
  apiProvider.addEventListener('change', updateProviderFields);
  btnSaveGroq.addEventListener('click', async () => {
    const isGemini = apiProvider.value === 'gemini';
    currentConfig.apiProvider = apiProvider.value;
    if (isGemini) {
      currentConfig.geminiApiKey = groqApiKey.value.trim();
      currentConfig.geminiModel = groqModel.value.trim() || 'gemini-3.6-flash';
    } else {
      currentConfig.groqApiKey = groqApiKey.value.trim();
      currentConfig.groqModel = groqModel.value.trim() || 'openai/gpt-oss-120b';
    }
    await window.sNotesAPI?.saveConfig(currentConfig);
    groqModal.classList.add('hidden');
    showToast(`${isGemini ? 'Gemini' : 'Groq'} settings saved`);
  });
  chatComposer.addEventListener('submit', (event) => {
    event.preventDefault();
    submitChat(chatInput.value);
    chatInput.value = '';
    chatInput.focus();
  });
  btnAnalyzeScreen.addEventListener('click', captureScreen);
  btnAttachResume.addEventListener('click', attachResume);
  btnRemoveResume.addEventListener('click', () => {
    interviewBrief.resumeText = '';
    updateResumeUI();
    showToast('Resume removed');
  });
  requirementsInput.addEventListener('input', () => {
    interviewBrief.requirements = requirementsInput.value;
  });
  promptButtons.forEach((button) => {
    button.addEventListener('click', () => submitChat(button.dataset.question || ''));
  });
  btnStartInterview.addEventListener('click', showAnswerScreen);
  btnStartExam.addEventListener('click', startMockExam);
  btnEditBrief.addEventListener('click', showSetupScreen);
  opacityRange.addEventListener('input', (event) => {
    const opacity = Number(event.target.value) / 100;
    opacityValue.textContent = `${event.target.value}%`;
    window.sNotesAPI?.setOpacity(opacity);
  });
  btnPrivateMode.addEventListener('click', async () => updatePrivateModeUI(await window.sNotesAPI?.togglePrivateMode(!currentConfig.privateMode)));
  btnAlwaysTop.addEventListener('click', async () => updateAlwaysOnTopUI(await window.sNotesAPI?.toggleAlwaysOnTop(!currentConfig.alwaysOnTop)));
  btnCopy.addEventListener('click', copyConversations);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copyConversations();
    }
  });
  btnClear.addEventListener('click', () => conversations.length ? clearModal.classList.remove('hidden') : showToast('There are no conversations to clear'));
  btnConfirmClear.addEventListener('click', () => {
    conversations = [];
    renderConversations();
    clearModal.classList.add('hidden');
  });
  btnCancelClear.addEventListener('click', () => clearModal.classList.add('hidden'));
  btnFontDec.addEventListener('click', () => setFontSize(currentConfig.fontSize - 1));
  btnFontInc.addEventListener('click', () => setFontSize(currentConfig.fontSize + 1));
  btnMinimize.addEventListener('click', () => window.sNotesAPI?.minimizeWindow());
  btnClose.addEventListener('click', () => window.sNotesAPI?.closeWindow());
  window.sNotesAPI?.onPrivateModeChanged(updatePrivateModeUI);
  window.sNotesAPI?.onAlwaysOnTopChanged(updateAlwaysOnTopUI);
  window.sNotesAPI?.onGlobalToggle(() => btnListen.focus());
  init().catch((error) => showToast(`Unable to load notes: ${error.message}`));
});
