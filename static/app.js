// Gatti Leituras - Motor de Reprodução Fluida e Gerenciador de Biblioteca
let currentBook = null;
let currentParagraphIndex = 0;
let isPlaying = false;
let currentSpeed = 1.0;
let currentVoice = 'pt-BR-AntonioNeural';
let fontSize = 18;

// Buffer de Áudio Pré-carregado (Zero Delay / Sem Pausas)
const audioCache = new Map();
const fetchingSet = new Set();

// Elementos DOM
const audioElement = document.getElementById('audioElement');
const textContainer = document.getElementById('textContainer');
const bookTitle = document.getElementById('bookTitle');
const currentStatus = document.getElementById('currentStatus');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const playerBookName = document.getElementById('playerBookName');
const playerSubtitle = document.getElementById('playerSubtitle');
const btnPlay = document.getElementById('btnPlay');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnSpeed = document.getElementById('btnSpeed');
const btnVoiceSelector = document.getElementById('btnVoiceSelector');
const fileInput = document.getElementById('fileInput');
const modalFileInput = document.getElementById('modalFileInput');

// ==========================================
// 1. BANCO DE DADOS INDEXEDDB (Armazena Múltiplos Livros Grandes)
// ==========================================
const DB_NAME = 'GattiLeiturasDB';
const DB_VERSION = 1;
const STORE_NAME = 'books';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSalvarLivro(livro) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(livro);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbListarLivros() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const lista = req.result || [];
      lista.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(lista);
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbObterLivro(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRemoverLivro(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// 2. INICIALIZAÇÃO
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  carregarConfiguracoes();
  configurarEventos();
  await carregarUltimoLivro();
  atualizarContadorBiblioteca();
});

function carregarConfiguracoes() {
  const salvo = JSON.parse(localStorage.getItem('gatti_config') || '{}');
  if (salvo.voice) currentVoice = salvo.voice;
  if (salvo.speed) currentSpeed = parseFloat(salvo.speed);
  if (salvo.fontSize) {
    fontSize = parseInt(salvo.fontSize);
    textContainer.style.fontSize = `${fontSize}px`;
    const fDisp = document.getElementById('fontSizeDisplay');
    if (fDisp) fDisp.textContent = `${fontSize}px`;
  }
  btnSpeed.textContent = `${currentSpeed}x`;
  btnVoiceSelector.textContent = currentVoice.includes('Antonio') ? 'Antônio' : 'Francisca';
  const selVoz = document.getElementById('selectVoz');
  if (selVoz) selVoz.value = currentVoice;
}

function salvarConfiguracoes() {
  localStorage.setItem('gatti_config', JSON.stringify({
    voice: currentVoice,
    speed: currentSpeed,
    fontSize: fontSize
  }));
}

// ==========================================
// 3. PARSERS DE ARQUIVOS (EPUB, PDF, TXT)
// ==========================================
async function tratarArquivoCarregado(file) {
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  let textoFinal = "";

  try {
    if (ext === 'txt' || ext === 'md') {
      textoFinal = await file.text();
    } else if (ext === 'pdf') {
      textoFinal = await extrairTextoPDF(file);
    } else if (ext === 'epub') {
      textoFinal = await extrairTextoEPUB(file);
    } else {
      alert("Formato não suportado. Por favor, envie arquivos EPUB, PDF, TXT ou MD.");
      return;
    }

    if (!textoFinal || textoFinal.trim().length === 0) {
      alert("Não foi possível extrair texto deste arquivo. Verifique se o documento não é apenas uma imagem digitalizada.");
      return;
    }

    await processarEArmazenarLivro(file.name.replace(/\.[^/.]+$/, ""), textoFinal, ext.toUpperCase());
  } catch (err) {
    console.error("Erro no processamento do arquivo:", err);
    alert("Ocorreu um erro ao abrir este arquivo: " + err.message);
  }
}

if (fileInput) fileInput.addEventListener('change', (e) => tratarArquivoCarregado(e.target.files[0]));
if (modalFileInput) modalFileInput.addEventListener('change', (e) => {
  tratarArquivoCarregado(e.target.files[0]);
  document.getElementById('modalBiblioteca').classList.add('hidden');
});

async function extrairTextoPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += strings.join(" ") + "\n\n";
  }
  return fullText;
}

async function extrairTextoEPUB(file) {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer);
  await book.ready;
  let fullText = "";
  for (const item of book.spine.spineItems) {
    try {
      const doc = await item.load(book.load.bind(book));
      if (doc) {
        const textoCapitulo = doc.body ? (doc.body.innerText || doc.body.textContent || "") : (doc.textContent || "");
        if (textoCapitulo.trim().length > 0) {
          fullText += textoCapitulo.trim() + "\n\n";
        }
      }
    } catch (eSec) {
      console.warn("Aviso ao carregar seção do EPUB:", eSec);
    }
  }
  return fullText;
}

// ==========================================
// 4. PROCESSAMENTO E ESTANTE
// ==========================================
async function processarEArmazenarLivro(titulo, texto, formato = "DOC") {
  const paragrafosBrutos = texto.split(/\n\s*\n+/);
  const blocos = [];

  for (let p of paragrafosBrutos) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p || p.length < 3) continue;

    if (p.length <= 450) {
      blocos.push(p);
    } else {
      const frases = p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [p];
      let acumulador = "";
      for (let f of frases) {
        f = f.trim();
        if (!f) continue;
        if ((acumulador + " " + f).length > 380 && acumulador.length > 50) {
          blocos.push(acumulador.trim());
          acumulador = f;
        } else {
          acumulador = acumulador ? (acumulador + " " + f) : f;
        }
      }
      if (acumulador.trim()) blocos.push(acumulador.trim());
    }
  }

  if (blocos.length === 0) {
    alert("Nenhum texto legível encontrado.");
    return;
  }

  const bookId = 'book_' + Date.now();
  const novoLivro = {
    id: bookId,
    title: titulo,
    format: formato,
    sentences: blocos,
    total: blocos.length,
    currentIndex: 0,
    dateAdded: Date.now(),
    updatedAt: Date.now()
  };

  await dbSalvarLivro(novoLivro);
  localStorage.setItem('gatti_ultimo_livro_id', bookId);
  await abrirLivro(novoLivro);
  await atualizarContadorBiblioteca();
}

async function abrirLivro(livro) {
  pararReproducao();
  limparCacheAudio();
  currentBook = livro;
  currentParagraphIndex = livro.currentIndex || 0;
  localStorage.setItem('gatti_ultimo_livro_id', livro.id);

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('readerContent').classList.remove('hidden');

  bookTitle.textContent = currentBook.title;
  textContainer.innerHTML = '';

  currentBook.sentences.forEach((bloco, idx) => {
    const div = document.createElement('div');
    div.className = 'sentence-block' + (idx === currentParagraphIndex ? ' active' : '');
    div.id = `sent_${idx}`;
    div.textContent = bloco;
    div.onclick = () => pularParaBloco(idx);
    textContainer.appendChild(div);
  });

  atualizarProgresso();
  rolarParaAtivo();
  atualizarPlayerBar();
}

function fecharLivroEVoltarEstante() {
  pararReproducao();
  limparCacheAudio();
  salvarProgressoAtual();
  currentBook = null;
  localStorage.removeItem('gatti_ultimo_livro_id');

  document.getElementById('readerContent').classList.add('hidden');
  document.getElementById('emptyState').classList.remove('hidden');
  playerBookName.textContent = "Nenhum livro aberto";
  playerSubtitle.textContent = "Selecione um livro na biblioteca";
  progressFill.style.width = "0%";

  abrirModalBiblioteca();
}

// ==========================================
// 5. MOTOR DE REPRODUÇÃO SEM PAUSAS
// ==========================================
function limparCacheAudio() {
  audioCache.forEach(url => URL.revokeObjectURL(url));
  audioCache.clear();
  fetchingSet.clear();
}

async function obterAudioUrl(idx) {
  if (!currentBook || idx < 0 || idx >= currentBook.sentences.length) return null;
  if (audioCache.has(idx)) return audioCache.get(idx);

  const texto = currentBook.sentences[idx];
  const taxaPercentual = Math.round((currentSpeed - 1.0) * 100);
  const rateStr = (taxaPercentual >= 0 ? '+' : '') + `${taxaPercentual}%`;

  fetchingSet.add(idx);
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: texto,
        voice: currentVoice,
        rate: rateStr
      })
    });

    if (!res.ok) throw new Error("Erro na síntese de voz");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCache.set(idx, url);
    fetchingSet.delete(idx);

    if (audioCache.size > 15) {
      const primeiroIndice = audioCache.keys().next().value;
      URL.revokeObjectURL(audioCache.get(primeiroIndice));
      audioCache.delete(primeiroIndice);
    }

    return url;
  } catch (err) {
    fetchingSet.delete(idx);
    console.warn("Falha ao obter áudio TTS:", err);
    return null;
  }
}

function anteciparProximosAudios(idxAtual) {
  const proximos = [idxAtual + 1, idxAtual + 2];
  for (let idx of proximos) {
    if (idx < currentBook.sentences.length && !audioCache.has(idx) && !fetchingSet.has(idx)) {
      obterAudioUrl(idx);
    }
  }
}

async function tocarBlocoAtual() {
  if (!currentBook || currentParagraphIndex >= currentBook.sentences.length) {
    pararReproducao();
    return;
  }

  atualizarDestaque();
  atualizarProgresso();
  salvarProgressoAtual();

  anteciparProximosAudios(currentParagraphIndex);

  try {
    let url = audioCache.get(currentParagraphIndex);
    if (!url) {
      url = await obterAudioUrl(currentParagraphIndex);
    }

    if (!url) throw new Error("Áudio indisponível");

    audioElement.src = url;
    await audioElement.play();

    anteciparProximosAudios(currentParagraphIndex);
  } catch (err) {
    console.warn("Tentando voz nativa de contingência:", err);
    usarVozNativa(currentBook.sentences[currentParagraphIndex]);
  }
}

function usarVozNativa(texto) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = 'pt-BR';
  utter.rate = currentSpeed;
  utter.onend = () => proximoBloco();
  window.speechSynthesis.speak(utter);
}

audioElement.onended = () => {
  if (isPlaying) proximoBloco();
};

function proximoBloco() {
  if (!currentBook) return;
  if (currentParagraphIndex < currentBook.sentences.length - 1) {
    currentParagraphIndex++;
    tocarBlocoAtual();
  } else {
    pararReproducao();
    alert("Parabéns! Leitura concluída.");
  }
}

function anteriorBloco() {
  if (!currentBook) return;
  if (currentParagraphIndex > 0) {
    currentParagraphIndex--;
    tocarBlocoAtual();
  }
}

function pularParaBloco(idx) {
  currentParagraphIndex = Math.max(0, Math.min(idx, currentBook.sentences.length - 1));
  limparCacheAudio();
  atualizarDestaque();
  atualizarProgresso();
  salvarProgressoAtual();
  if (isPlaying) tocarBlocoAtual();
}

function atualizarDestaque() {
  document.querySelectorAll('.sentence-block').forEach((el, idx) => {
    if (idx === currentParagraphIndex) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  rolarParaAtivo();
}

function rolarParaAtivo() {
  const el = document.getElementById(`sent_${currentParagraphIndex}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function atualizarProgresso() {
  if (!currentBook) return;
  const pct = Math.round(((currentParagraphIndex + 1) / currentBook.total) * 100);
  currentStatus.textContent = `Trecho ${currentParagraphIndex + 1} de ${currentBook.total}`;
  progressPercent.textContent = `${pct}% lido`;
  progressFill.style.width = `${pct}%`;
  playerSubtitle.textContent = `${pct}% concluído • Trecho ${currentParagraphIndex + 1}`;
}

async function salvarProgressoAtual() {
  if (!currentBook) return;
  currentBook.currentIndex = currentParagraphIndex;
  currentBook.updatedAt = Date.now();
  await dbSalvarLivro(currentBook);
}

function alternarPlayPause() {
  if (!currentBook) {
    abrirModalBiblioteca();
    return;
  }
  if (isPlaying) {
    pararReproducao();
  } else {
    iniciarReproducao();
  }
}

function iniciarReproducao() {
  isPlaying = true;
  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');
  tocarBlocoAtual();
}

function pararReproducao() {
  isPlaying = false;
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
  audioElement.pause();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function atualizarPlayerBar() {
  if (!currentBook) return;
  playerBookName.textContent = currentBook.title;
  atualizarProgresso();
}

// ==========================================
// 6. GERENCIAMENTO DA BIBLIOTECA (Listar / Excluir / Salvar)
// ==========================================
async function atualizarContadorBiblioteca() {
  const livros = await dbListarLivros();
  const badge = document.getElementById('badgeTotalLivros');
  if (badge) badge.textContent = `${livros.length} livro${livros.length === 1 ? '' : 's'}`;
}

async function abrirModalBiblioteca() {
  await renderizarListaBiblioteca();
  document.getElementById('modalBiblioteca').classList.remove('hidden');
}

async function renderizarListaBiblioteca() {
  const list = document.getElementById('libraryList');
  if (!list) return;

  const livros = await dbListarLivros();
  atualizarContadorBiblioteca();
  list.innerHTML = '';

  if (livros.length === 0) {
    list.innerHTML = `
      <div style="text-align:center; padding:32px 16px; color:var(--text-muted);">
        <p style="font-size:1.1rem; margin-bottom:8px;">Nenhum livro salvo na biblioteca.</p>
        <p style="font-size:0.85rem;">Carregue arquivos EPUB, PDF ou TXT pelo botão acima para começar a ouvir.</p>
      </div>
    `;
    return;
  }

  livros.forEach(b => {
    const item = document.createElement('div');
    item.className = 'library-item-card';

    const pct = Math.round((((b.currentIndex || 0) + 1) / b.total) * 100);
    const dataFormatada = new Date(b.updatedAt || b.dateAdded).toLocaleDateString('pt-BR');

    item.innerHTML = `
      <div class="library-card-info">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span class="badge" style="background:#2563eb; color:#fff; font-size:0.7rem;">${b.format || 'LIVRO'}</span>
          <span style="font-size:0.75rem; color:var(--text-muted);">${dataFormatada}</span>
        </div>
        <h4 style="margin:0 0 8px 0; font-size:1.05rem; line-height:1.3; font-weight:700;">${b.title}</h4>
        <div class="lib-progress-wrap">
          <div class="lib-progress-bar" style="width: ${pct}%;"></div>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
          ${pct}% lido • Trecho ${(b.currentIndex || 0) + 1} de ${b.total}
        </div>
      </div>
      <div class="library-card-actions">
        <button class="btn-primary btn-abrir-livro" style="padding:8px 16px; font-size:0.85rem;">
          ${b.currentIndex > 0 ? 'Continuar' : 'Iniciar'}
        </button>
        <button class="btn-danger btn-excluir-livro" title="Excluir da Biblioteca" style="padding:8px 12px; font-size:0.85rem;">
          🗑️
        </button>
      </div>
    `;

    item.querySelector('.btn-abrir-livro').onclick = async (e) => {
      e.stopPropagation();
      await abrirLivro(b);
      document.getElementById('modalBiblioteca').classList.add('hidden');
    };

    item.querySelector('.btn-excluir-livro').onclick = async (e) => {
      e.stopPropagation();
      const confirma = confirm(`Tem certeza que deseja apagar o livro "${b.title}" da sua estante?`);
      if (confirma) {
        await dbRemoverLivro(b.id);
        if (currentBook && currentBook.id === b.id) {
          fecharLivroEVoltarEstante();
        } else {
          await renderizarListaBiblioteca();
        }
      }
    };

    list.appendChild(item);
  });
}

async function carregarUltimoLivro() {
  const lastId = localStorage.getItem('gatti_ultimo_livro_id');
  if (!lastId) return;
  const livro = await dbObterLivro(lastId);
  if (livro) {
    await abrirLivro(livro);
  }
}

// ==========================================
// 7. EVENTOS E CONTROLES DE INTERFACE
// ==========================================
function configurarEventos() {
  btnPlay.onclick = alternarPlayPause;
  btnNext.onclick = proximoBloco;
  btnPrev.onclick = anteriorBloco;

  const btnFechar = document.getElementById('btnFecharLivro');
  if (btnFechar) btnFechar.onclick = fecharLivroEVoltarEstante;

  const btnEstanteVazia = document.getElementById('btnAbrirEstanteVazia');
  if (btnEstanteVazia) btnEstanteVazia.onclick = abrirModalBiblioteca;

  const btnBib = document.getElementById('btnBiblioteca');
  const modalBib = document.getElementById('modalBiblioteca');
  const closeBib = document.getElementById('closeBib');
  if (btnBib && modalBib && closeBib) {
    btnBib.onclick = abrirModalBiblioteca;
    closeBib.onclick = () => modalBib.classList.add('hidden');
  }

  const btnCfg = document.getElementById('btnConfig');
  const modalCfg = document.getElementById('modalConfig');
  const closeCfg = document.getElementById('closeConfig');
  if (btnCfg && modalCfg && closeCfg) {
    btnCfg.onclick = () => modalCfg.classList.remove('hidden');
    closeCfg.onclick = () => modalCfg.classList.add('hidden');
  }

  btnVoiceSelector.onclick = () => {
    currentVoice = currentVoice.includes('Antonio') ? 'pt-BR-FranciscaNeural' : 'pt-BR-AntonioNeural';
    btnVoiceSelector.textContent = currentVoice.includes('Antonio') ? 'Antônio' : 'Francisca';
    limparCacheAudio();
    salvarConfiguracoes();
    if (isPlaying) tocarBlocoAtual();
  };

  btnSpeed.onclick = () => {
    const velocidades = [1.0, 1.2, 1.5, 1.75, 2.0];
    let idx = velocidades.indexOf(currentSpeed);
    idx = (idx + 1) % velocidades.length;
    currentSpeed = velocidades[idx];
    btnSpeed.textContent = `${currentSpeed}x`;
    limparCacheAudio();
    salvarConfiguracoes();
    if (isPlaying) tocarBlocoAtual();
  };

  document.querySelectorAll('#speedOptions .opt-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#speedOptions .opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = parseFloat(btn.dataset.speed);
      btnSpeed.textContent = `${currentSpeed}x`;
      limparCacheAudio();
      salvarConfiguracoes();
      if (isPlaying) tocarBlocoAtual();
    };
  });

  const selVoz = document.getElementById('selectVoz');
  if (selVoz) {
    selVoz.onchange = (e) => {
      currentVoice = e.target.value;
      btnVoiceSelector.textContent = currentVoice.includes('Antonio') ? 'Antônio' : 'Francisca';
      limparCacheAudio();
      salvarConfiguracoes();
      if (isPlaying) tocarBlocoAtual();
    };
  }

  const btnFontPlus = document.getElementById('btnFontPlus');
  const btnFontMinus = document.getElementById('btnFontMinus');
  const fontSizeDisplay = document.getElementById('fontSizeDisplay');
  if (btnFontPlus && btnFontMinus) {
    btnFontPlus.onclick = () => {
      if (fontSize < 32) {
        fontSize += 2;
        textContainer.style.fontSize = `${fontSize}px`;
        if (fontSizeDisplay) fontSizeDisplay.textContent = `${fontSize}px`;
        salvarConfiguracoes();
      }
    };
    btnFontMinus.onclick = () => {
      if (fontSize > 12) {
        fontSize -= 2;
        textContainer.style.fontSize = `${fontSize}px`;
        if (fontSizeDisplay) fontSizeDisplay.textContent = `${fontSize}px`;
        salvarConfiguracoes();
      }
    };
  }

  const btnColar = document.getElementById('btnColarTexto');
  if (btnColar) {
    btnColar.onclick = () => {
      const titulo = prompt("Dê um título para este texto:") || "Texto Colado";
      const texto = prompt("Cole ou digite o texto ou capítulo:");
      if (texto && texto.trim().length > 0) {
        processarEArmazenarLivro(titulo.trim(), texto.trim(), "NOTA");
      }
    };
  }

  const progressTrack = document.getElementById('progressTrack');
  if (progressTrack) {
    progressTrack.onclick = (e) => {
      if (!currentBook) return;
      const rect = progressTrack.getBoundingClientRect();
      const clickRatio = (e.clientX - rect.left) / rect.width;
      const targetIdx = Math.floor(clickRatio * currentBook.total);
      pularParaBloco(targetIdx);
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      alternarPlayPause();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      proximoBloco();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      anteriorBloco();
    }
  });
}
