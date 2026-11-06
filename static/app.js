// Aura Audiobooks - Motor de Reprodução Inteligente
let currentBook = null;
let currentParagraphIndex = 0;
let isPlaying = false;
let audioQueue = null;
let currentSpeed = 1.0;
let currentVoice = 'pt-BR-AntonioNeural';
let fontSize = 18;

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

// 1. Inicialização e Carregamento de Configurações
window.addEventListener('DOMContentLoaded', () => {
  carregarConfiguracoes();
  carregarUltimoLivro();
  configurarEventos();
});

function carregarConfiguracoes() {
  const salvo = JSON.parse(localStorage.getItem('aura_config') || '{}');
  if (salvo.voice) currentVoice = salvo.voice;
  if (salvo.speed) currentSpeed = parseFloat(salvo.speed);
  if (salvo.fontSize) {
    fontSize = parseInt(salvo.fontSize);
    textContainer.style.fontSize = `${fontSize}px`;
    document.getElementById('fontSizeDisplay').textContent = `${fontSize}px`;
  }
  btnSpeed.textContent = `${currentSpeed}x`;
  btnVoiceSelector.textContent = currentVoice.includes('Antonio') ? 'Antônio' : 'Francisca';
  document.getElementById('selectVoz').value = currentVoice;
}

function salvarConfiguracoes() {
  localStorage.setItem('aura_config', JSON.stringify({
    voice: currentVoice,
    speed: currentSpeed,
    fontSize: fontSize
  }));
}

// 2. Parser de Arquivos (TXT, Markdown, PDF, EPUB)
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

function processarTextoLivro(titulo, texto) {
  // Divisão inteligente em sentenças/parágrafos concisos para TTS
  const paragrafosBrutos = texto.split(/\n\s*\n/);
  const sentencas = [];

  for (let p of paragrafosBrutos) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    // Quebra por pontos finais, interrogações ou exclamações para síntese fluida
    const partes = p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [p];
    for (let f of partes) {
      f = f.trim();
      if (f.length > 5) sentencas.push(f);
    }
  }

  if (sentencas.length === 0) {
    alert("Não foi possível extrair texto legível deste documento.");
    return;
  }

  const bookId = 'book_' + Date.now();
  currentBook = {
    id: bookId,
    title: titulo,
    sentences: sentencas,
    total: sentencas.length
  };

  currentParagraphIndex = 0;
  salvarLivroNaBiblioteca(currentBook);
  renderizarLivro();
  atualizarPlayerBar();
}

// 3. Renderização e Controle de Leitura
function renderizarLivro() {
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('readerContent').classList.remove('hidden');

  bookTitle.textContent = currentBook.title;
  textContainer.innerHTML = '';

  currentBook.sentences.forEach((frase, idx) => {
    const span = document.createElement('div');
    span.className = 'sentence-block' + (idx === currentParagraphIndex ? ' active' : '');
    span.id = `sent_${idx}`;
    span.textContent = frase;
    span.onclick = () => {
      pularParaFrase(idx);
    };
    textContainer.appendChild(span);
  });

  atualizarProgresso();
  rolarParaAtivo();
}

function pularParaFrase(idx) {
  currentParagraphIndex = Math.max(0, Math.min(idx, currentBook.sentences.length - 1));
  atualizarDestaque();
  atualizarProgresso();
  salvarProgressoAtual();
  if (isPlaying) {
    tocarFraseAtual();
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
  currentStatus.textContent = `Frase ${currentParagraphIndex + 1} de ${currentBook.total}`;
  progressPercent.textContent = `${pct}% lido`;
  progressFill.style.width = `${pct}%`;
  playerSubtitle.textContent = `${pct}% concluído • Frase ${currentParagraphIndex + 1}`;
}

// 4. Mecanismo de Áudio Neural com Edge-TTS
async function tocarFraseAtual() {
  if (!currentBook || currentParagraphIndex >= currentBook.sentences.length) {
    pararReproducao();
    return;
  }

  const texto = currentBook.sentences[currentParagraphIndex];
  atualizarDestaque();
  atualizarProgresso();
  salvarProgressoAtual();

  // Calcula taxa de velocidade para o SSML do edge-tts
  const taxaPercentual = Math.round((currentSpeed - 1.0) * 100);
  const rateStr = (taxaPercentual >= 0 ? '+' : '') + `${taxaPercentual}%`;

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

    if (!res.ok) throw new Error("Erro no servidor TTS");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    audioElement.src = url;
    audioElement.playbackRate = 1.0; // taxa já sintetizada diretamente no servidor
    await audioElement.play();
  } catch (err) {
    console.warn("Falha no servidor TTS, tentando sintetizador nativo de contingência:", err);
    usarVozNativa(texto);
  }
}

// Fallback nativo caso o backend esteja temporariamente inacessível
function usarVozNativa(texto) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = 'pt-BR';
  utter.rate = currentSpeed;
  utter.onend = () => proximaFrase();
  window.speechSynthesis.speak(utter);
}

audioElement.onended = () => {
  proximaFrase();
};

function proximaFrase() {
  if (currentParagraphIndex + 1 < currentBook.sentences.length) {
    currentParagraphIndex++;
    if (isPlaying) {
      tocarFraseAtual();
    } else {
      atualizarDestaque();
      atualizarProgresso();
    }
  } else {
    pararReproducao();
    alert("Parabéns! Leitura do livro concluída.");
  }
}

function alternarReproducao() {
  if (!currentBook) {
    alert("Selecione um livro primeiro para começar a ouvir!");
    return;
  }

  isPlaying = !isPlaying;
  if (isPlaying) {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    tocarFraseAtual();
  } else {
    pararReproducao();
  }
}

function pararReproducao() {
  isPlaying = false;
  audioElement.pause();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
}

// 5. Biblioteca e Onde Parou (LocalStorage)
function salvarProgressoAtual() {
  if (!currentBook) return;
  const bib = JSON.parse(localStorage.getItem('aura_library') || '{}');
  if (bib[currentBook.id]) {
    bib[currentBook.id].lastIndex = currentParagraphIndex;
    bib[currentBook.id].lastRead = Date.now();
    localStorage.setItem('aura_library', JSON.stringify(bib));
  }
}

function salvarLivroNaBiblioteca(book) {
  const bib = JSON.parse(localStorage.getItem('aura_library') || '{}');
  bib[book.id] = {
    id: book.id,
    title: book.title,
    sentences: book.sentences,
    total: book.total,
    lastIndex: 0,
    lastRead: Date.now()
  };
  localStorage.setItem('aura_library', JSON.stringify(bib));
  localStorage.setItem('aura_last_active_id', book.id);
}

function carregarUltimoLivro() {
  const lastId = localStorage.getItem('aura_last_active_id');
  if (!lastId) return;

  const bib = JSON.parse(localStorage.getItem('aura_library') || '{}');
  const book = bib[lastId];
  if (book) {
    currentBook = book;
    currentParagraphIndex = book.lastIndex || 0;
    renderizarLivro();
    atualizarPlayerBar();
  }
}

function atualizarPlayerBar() {
  if (!currentBook) return;
  playerBookName.textContent = currentBook.title;
  atualizarProgresso();
}

// 6. Controles e Teclas de Atalho
function configurarEventos() {
  btnPlay.onclick = alternarReproducao;
  btnPrev.onclick = () => pularParaFrase(currentParagraphIndex - 1);
  btnNext.onclick = () => pularParaFrase(currentParagraphIndex + 1);

  // Atalhos de Teclado (Espaço e Setas)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      alternarReproducao();
    } else if (e.code === 'ArrowRight') {
      pularParaFrase(currentParagraphIndex + 1);
    } else if (e.code === 'ArrowLeft') {
      pularParaFrase(currentParagraphIndex - 1);
    }
  });

  // Modal Biblioteca
  document.getElementById('btnBiblioteca').onclick = abrirBibliotecaModal;
  document.getElementById('closeBib').onclick = () => document.getElementById('modalBiblioteca').classList.add('hidden');

  // Modal Configurações
  document.getElementById('btnConfig').onclick = () => document.getElementById('modalConfig').classList.remove('hidden');
  document.getElementById('closeConfig').onclick = () => document.getElementById('modalConfig').classList.add('hidden');
  btnSpeed.onclick = () => document.getElementById('modalConfig').classList.remove('hidden');
  btnVoiceSelector.onclick = () => document.getElementById('modalConfig').classList.remove('hidden');

  // Seletores de Config
  document.getElementById('selectVoz').onchange = (e) => {
    currentVoice = e.target.value;
    btnVoiceSelector.textContent = currentVoice.includes('Antonio') ? 'Antônio' : 'Francisca';
    salvarConfiguracoes();
  };

  document.querySelectorAll('#speedOptions .opt-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#speedOptions .opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = parseFloat(btn.dataset.speed);
      btnSpeed.textContent = `${currentSpeed}x`;
      salvarConfiguracoes();
      if (isPlaying) tocarFraseAtual();
    };
  });

  document.getElementById('btnFontMinus').onclick = () => {
    fontSize = Math.max(14, fontSize - 2);
    textContainer.style.fontSize = `${fontSize}px`;
    document.getElementById('fontSizeDisplay').textContent = `${fontSize}px`;
    salvarConfiguracoes();
  };

  document.getElementById('btnFontPlus').onclick = () => {
    fontSize = Math.min(32, fontSize + 2);
    textContainer.style.fontSize = `${fontSize}px`;
    document.getElementById('fontSizeDisplay').textContent = `${fontSize}px`;
    salvarConfiguracoes();
  };

  // Botão Colar Texto
  document.getElementById('btnColarTexto').onclick = () => {
    const texto = prompt("Cole aqui o texto ou capítulo que deseja ler:");
    if (texto && texto.trim().length > 10) {
      processarTextoLivro("Texto Colado - " + new Date().toLocaleDateString(), texto);
    }
  };
}

function abrirBibliotecaModal() {
  const bib = JSON.parse(localStorage.getItem('aura_library') || '{}');
  const container = document.getElementById('libraryList');
  container.innerHTML = '';

  const livros = Object.values(bib);
  if (livros.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Nenhum livro salvo ainda.</p>';
  } else {
    livros.forEach(b => {
      const pct = Math.round(((b.lastIndex || 0) / b.total) * 100);
      const div = document.createElement('div');
      div.className = 'library-item';
      div.innerHTML = `
        <div>
          <strong style="display:block; font-size:1rem; margin-bottom:4px;">${b.title}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">Frase ${(b.lastIndex || 0) + 1} de ${b.total}</span>
        </div>
        <span class="badge">${pct}% lido</span>
      `;
      div.onclick = () => {
        currentBook = b;
        currentParagraphIndex = b.lastIndex || 0;
        localStorage.setItem('aura_last_active_id', b.id);
        renderizarLivro();
        atualizarPlayerBar();
        document.getElementById('modalBiblioteca').classList.add('hidden');
      };
      container.appendChild(div);
    });
  }

  document.getElementById('modalBiblioteca').classList.remove('hidden');
}
