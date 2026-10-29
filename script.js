const START_DATE = "2022-06-14T18:30:00";

const langSelect = document.getElementById('language-select');
const currentLanguage = () => (langSelect ? langSelect.value : 'fr');

function getTranslationData() {
  return (window.LANGUAGES && window.LANGUAGES[currentLanguage()])
    ? window.LANGUAGES[currentLanguage()]
    : window.LANGUAGES.fr;
}

function updateLanguageLabels() {
  const data = getTranslationData();
  if (!data) return;

  const titleGroup = document.getElementById('girlfriend-name-display');
  const giftSubtitle = document.getElementById('gift-subtitle');
  if (titleGroup) titleGroup.textContent = data.girlfriendName;
  if (giftSubtitle) giftSubtitle.textContent = data.giftSubtitle;

  const heroTag = document.getElementById('hero-tag');
  const mainTitle = document.getElementById('main-title');
  const mainText = document.getElementById('main-text');
  const counterTitle = document.getElementById('counter-title');
  const musicLabel = document.getElementById('music-label');
  const languageLabel = document.getElementById('language-label');
  const museumTab = document.getElementById('museum-tab');
  const lettersTab = document.getElementById('letters-tab');

  if (heroTag) heroTag.textContent = data.heroTag;
  if (mainTitle) mainTitle.textContent = data.title;
  if (mainText) mainText.textContent = data.subtitle;
  if (counterTitle) counterTitle.textContent = data.counterTitle;
  if (musicLabel) musicLabel.textContent = data.musicLabel;
  if (languageLabel) languageLabel.textContent = data.languageLabel;
  if (museumTab) museumTab.textContent = data.tabMuseum;
  if (lettersTab) lettersTab.textContent = data.tabLetters;
}

function updateCounter() {
  const start = new Date(START_DATE).getTime();
  const now = new Date().getTime();
  const diff = Math.max(0, now - start);

  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const daysTotal = Math.floor(diff / (1000 * 60 * 60 * 24));

  const years = Math.floor(daysTotal / 365);
  const months = Math.floor((daysTotal % 365) / 30);
  const days = Math.floor((daysTotal % 365) % 30);

  document.getElementById('c-years').innerText = years;
  document.getElementById('c-months').innerText = months;
  document.getElementById('c-days').innerText = days;
  document.getElementById('c-hours').innerText = hours;
  document.getElementById('c-min').innerText = minutes;
  document.getElementById('c-sec').innerText = seconds;
}

setInterval(updateCounter, 1000);
updateCounter();

function renderPolaroids() {
  const container = document.getElementById('polaroid-grid-container');
  if (!container) return;
  container.innerHTML = '';

  const data = getTranslationData().polaroids;
  data.forEach((item, index) => {
    const rotation = index % 2 === 0 ? -2 : 2;
    const cardHTML = `
      <div class="polaroid-container" style="transform: rotate(${rotation}deg)" onclick="this.classList.toggle('flipped')">
        <div class="polaroid-card">
          <div class="polaroid-front">
            <div class="polaroid-image-wrapper">
              <img src="${item.photoUrl}" alt="${item.title}">
            </div>
            <div class="polaroid-caption">
              <h3>${item.title}</h3>
              <p>📍 ${item.location} • ${item.date}</p>
            </div>
          </div>
          <div class="polaroid-back">
            <div>
              <div style="font-size: 0.8rem; font-weight: bold; color: var(--primary-rose); border-bottom: 1px solid #fef08a; padding-bottom: 4px;">
                ${item.date}
              </div>
              <p class="polaroid-note">"${item.note}"</p>
            </div>
            <div class="polaroid-song-badge">
              🎵 ${item.song}
            </div>
          </div>
        </div>
      </div>
    `;
    container.innerHTML += cardHTML;
  });
}

function renderLetters() {
  const container = document.getElementById('letters-grid-container');
  if (!container) return;
  container.innerHTML = '';

  const data = getTranslationData().letters;
  data.forEach((letter, index) => {
    const letterHTML = `
      <div class="envelope-card" onclick="openModal(${index})">
        <div>
          <div class="envelope-icon">${letter.icon}</div>
          <div class="envelope-trigger">${letter.trigger}</div>
        </div>
        <div class="envelope-action">${letter.openLetter || 'Ouvrir la lettre ➔'}</div>
      </div>
    `;
    container.innerHTML += letterHTML;
  });
}

const audio = document.getElementById('bg-music');
const musicBtn = document.getElementById('music-toggle');

function toggleAudio() {
  if (audio.paused) {
    audio.play();
    musicBtn.innerText = '⏸';
  } else {
    audio.pause();
    musicBtn.innerText = '▶';
  }
}

function switchTab(tabName, btnElement) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  document.getElementById('tab-' + tabName).classList.add('active');
  btnElement.classList.add('active');
}

function openModal(index) {
  const data = getTranslationData().letters[index];
  document.getElementById('modal-title').innerText = data.title;
  document.getElementById('modal-body').innerText = data.message;
  document.getElementById('modal-gift').innerText = data.gift;
  document.getElementById('modal-overlay').classList.add('active');
  spawnHearts();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

function spawnHearts(e) {
  for (let i = 0; i < 12; i++) {
    const heart = document.createElement('div');
    heart.className = 'heart-particle';
    heart.innerText = i % 2 === 0 ? '💖' : '✨';
    heart.style.left = Math.random() * 100 + 'vw';
    heart.style.top = '100vh';
    heart.style.fontSize = (16 + Math.random() * 20) + 'px';
    heart.style.animationDuration = (2 + Math.random() * 2) + 's';
    document.body.appendChild(heart);

    setTimeout(() => heart.remove(), 3000);
  }
}

if (langSelect) {
  langSelect.addEventListener('change', () => {
    updateLanguageLabels();
    renderPolaroids();
    renderLetters();
  });
}

window.onload = () => {
  updateLanguageLabels();
  renderPolaroids();
  renderLetters();
};
