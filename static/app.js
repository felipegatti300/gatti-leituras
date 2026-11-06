// Gatti Leituras - Motor de Reprodução Fluida Sem Pausas
let currentBook = null;
let currentParagraphIndex = 0;
let isPlaying = false;
let currentSpeed = 1.0;
let currentVoice = 'pt-BR-AntonioNeural';
let fontSize = 18;

// Buffer de Áudio Pré-carregado (Zero Delay / Latência Zero)
const audioCache = new Map();
const fetchingSet = new Set();

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

// 1. Inicialização
window.addEventListener('DOMContentLoaded', () => {
  carregarConfiguracoes();
  carregarUltimoLivro();
  configurarEventos();
});

function carregarConfiguracoes() {
  const salvo = JSON.parse(localStorage.getItem('gatti_config') || '{}');
  if (salvo.voice) currentVoice = salvo.voice;
  if (salvo.speed) currentSpeed = parseFloat(salvo.speed);
  if (salvo.fontSize) {
    fontSize = parseInt(salvo.fontSize);
    textContainer.style.fontSize = `${fontSize}px`;
    document.getElementById('fontSizeDisplay').textContent = `${fontSize}px`;
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

// 2. Parser de Arquivos
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  let textoFinal = "";

  if (ext === 'txt' || ext === 'md') {
    textoFinal = await file.text();
  } else if (ext === 'pdf') {
    textoFinal = await extrairTextoPDF(file);
  } else if (ext === 'epub') {
    textoFinal = await extrairTextoEPUB(file);
  } else {
    alert("Formato não suportado diretamente. Use PDF, EPUB, TXT ou MD.");
    return;
  }

  processarTextoLivro(file.name.replace(/\.[^/.]+$/, ""), textoFinal);
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
  const book = ePub(await file.arrayBuffer());
  await book.ready;
  let fullText = "";
  for (const item of book.spine.spineItems) {
    const doc = await item.load(book.load.bind(book));
    fullText += doc.body.innerText + "\n\n";
  }
  return fullText;
}

// 3. Agrupamento Natural de Texto (Sem picotar em excesso)
function processarTextoLivro(titulo, texto) {
  const paragrafosBrutos = texto.split(/\n\s*\n+/);
  const blocos = [];

  for (let p of paragrafosBrutos) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p || p.length < 3) continue;

    // Se o parágrafo for de tamanho normal (até 450 caracteres), mantém inteiro
    if (p.length <= 450) {
      blocos.push(p);
    } else {
      // Se for parágrafo longo, agrupa frases até ~380 caracteres
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
      if (acumulador.trim()) {
        blocos.push(acumulador.trim());
      }
    }
  }

  if (blocos.length === 0) {
    alert("Não foi possível extrair texto legível deste documento.");
    return;
  }

  limparCacheAudio();

  const bookId = 'book_' + Date.now();
  currentBook = {
    id: bookId,
    title: titulo,
    sentences: blocos,
    total: blocos.length
  };

  currentParagraphIndex = 0;
  salvarLivroNaBiblioteca(currentBook);
  renderizarLivro();
  atualizarPlayerBar();
}

// 4. Renderização do Livro
function renderizarLivro() {
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
}

function pularParaBloco(idx) {
  currentParagraphIndex = Math.max(0, Math.min(idx, currentBook.sentences.length - 1));
  limparCacheAudio();
  atualizarDestaque();
  atualizarProgresso();
  salvarProgressoAtual();
  if (isPlaying) {
    tocarBlocoAtual();
  }
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
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function atualizarProgresso() {
  if (!currentBook) return;
  const pct = Math.round(((currentParagraphIndex + 1) / currentBook.total) * 100);
  currentStatus.textContent = `Bloco ${currentParagraphIndex + 1} de ${currentBook.total}`;
  progressPercent.textContent = `${pct}% lido`;
  progressFill.style.width = `${pct}%`;
  playerSubtitle.textContent = `${pct}% concluído • Trecho ${currentParagraphIndex + 1}`;
}

// 5. Motor de Áudio com Buffer Pré-carregado (Sem silêncio entre blocos)
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

    if (!res.ok) throw new Error("Erro na resposta do TTS");
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
    console.warn("Falha no download do áudio:", err);
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

  // Dispara o pré-carregamento dos próximos imediatamente
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
    console.warn("Tentando voz nativa por contingência:", err);
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
  if (isPlaying) {
    proximoBloco();
  }
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

// 6. Controles de Reprodução e Eventos
function alternarPlayPause() {
  if (!currentBook) return;
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

function configurarEventos() {
  btnPlay.onclick = alternarPlayPause;
  btnNext.onclick = proximoBloco;
  btnPrev.onclick = anteriorBloco;

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

  // Modal Biblioteca
  const btnBib = document.getElementById('btnBiblioteca');
  const modalBib = document.getElementById('modalBiblioteca');
  const closeBib = document.getElementById('closeBib');
  if (btnBib && modalBib && closeBib) {
    btnBib.onclick = () => {
      abrirBiblioteca();
      modalBib.classList.remove('hidden');
    };
    closeBib.onclick = () => modalBib.classList.add('hidden');
  }

  // Modal Configurações
  const btnCfg = document.getElementById('btnConfig');
  const modalCfg = document.getElementById('modalConfig');
  const closeCfg = document.getElementById('closeConfig');
  if (btnCfg && modalCfg && closeCfg) {
    btnCfg.onclick = () => modalCfg.classList.remove('hidden');
    closeCfg.onclick = () => modalCfg.classList.add('hidden');
  }

  // Alternador de Voz Rápido
  btnVoiceSelector.onclick = () => {
    currentVoice = currentVoice.includes('Antonio') ? 'pt-BR-FranciscaNeural' : 'pt-BR-AntonioNeural';
    btnVoiceSelector.textContent = currentVoice.includes('Antonio') ? 'Antônio' : 'Francisca';
    limparCacheAudio();
    salvarConfiguracoes();
    if (isPlaying) tocarBlocoAtual();
  };

  // Alternador de Velocidade Rápido
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
        fontSizeDisplay.textContent = `${fontSize}px`;
        salvarConfiguracoes();
      }
    };
    btnFontMinus.onclick = () => {
      if (fontSize > 12) {
        fontSize -= 2;
        textContainer.style.fontSize = `${fontSize}px`;
        fontSizeDisplay.textContent = `${fontSize}px`;
        salvarConfiguracoes();
      }
    };
  }

  const btnColar = document.getElementById('btnColarTexto');
  if (btnColar) {
    btnColar.onclick = () => {
      const texto = prompt("Cole ou digite o texto ou capítulo que deseja ouvir:");
      if (texto && texto.trim().length > 0) {
        processarTextoLivro("Texto Colado", texto.trim());
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
}

// 7. Biblioteca e Persistência
function salvarLivroNaBiblioteca(book) {
  let bib = JSON.parse(localStorage.getItem('gatti_biblioteca') || '[]');
  bib = bib.filter(b => b.title !== book.title);
  bib.unshift({
    id: book.id,
    title: book.title,
    sentences: book.sentences,
    total: book.total,
    savedIndex: currentParagraphIndex,
    updatedAt: Date.now()
  });
  if (bib.length > 20) bib.pop();
  localStorage.setItem('gatti_biblioteca', JSON.stringify(bib));
  localStorage.setItem('gatti_ultimo_livro_id', book.id);
}

function salvarProgressoAtual() {
  if (!currentBook) return;
  let bib = JSON.parse(localStorage.getItem('gatti_biblioteca') || '[]');
  const item = bib.find(b => b.id === currentBook.id);
  if (item) {
    item.savedIndex = currentParagraphIndex;
    item.updatedAt = Date.now();
    localStorage.setItem('gatti_biblioteca', JSON.stringify(bib));
  }
}

function carregarUltimoLivro() {
  const lastId = localStorage.getItem('gatti_ultimo_livro_id');
  if (!lastId) return;
  const bib = JSON.parse(localStorage.getItem('gatti_biblioteca') || '[]');
  const book = bib.find(b => b.id === lastId);
  if (book) {
    currentBook = book;
    currentParagraphIndex = book.savedIndex || 0;
    renderizarLivro();
    atualizarPlayerBar();
  }
}

function atualizarPlayerBar() {
  if (!currentBook) return;
  playerBookName.textContent = currentBook.title;
  atualizarProgresso();
}

function abrirBiblioteca() {
  const list = document.getElementById('libraryList');
  if (!list) return;
  const bib = JSON.parse(localStorage.getItem('gatti_biblioteca') || '[]');
  list.innerHTML = '';
  if (bib.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Nenhum livro salvo ainda.</p>';
    return;
  }
  bib.forEach(b => {
    const item = document.createElement('div');
    item.className = 'library-item';
    const pct = Math.round((((b.savedIndex || 0) + 1) / b.total) * 100);
    item.innerHTML = `
      <div>
        <div style="font-weight:700; margin-bottom:4px;">${b.title}</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">${pct}% concluído • ${b.total} trechos</div>
      </div>
      <button class="btn-primary" style="padding:6px 14px; font-size:0.85rem;">Continuar</button>
    `;
    item.onclick = () => {
      currentBook = b;
      currentParagraphIndex = b.savedIndex || 0;
      limparCacheAudio();
      renderizarLivro();
      atualizarPlayerBar();
      document.getElementById('modalBiblioteca').classList.add('hidden');
    };
    list.appendChild(item);
  });
}
