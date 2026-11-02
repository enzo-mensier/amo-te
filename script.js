import { createClient } from '@supabase/supabase-js';
import { getCurrentMonthKey } from './date-utils.js';
import { normalizePushMessage } from './push-utils.js';

const config = import.meta.env;
const vapidPublicKey = config.VITE_VAPID_PUBLIC_KEY ||
  'BMEVAjRTPk6w8sIV_Q_YF8y4zZRh0UGEjaxWk0p21EjcMNUMVFiBGULanPikOicZ7jtTrZV1se3X49gbKA41Nro';
const requiredConfig = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_COUPLE_ID'];
const missingConfig = requiredConfig.filter(key => !config[key]);
const setupScreen = document.querySelector('#setup-screen');
const authScreen = document.querySelector('#auth-screen');
const appScreen = document.querySelector('#app-screen');
const accountArea = document.querySelector('#account-area');
const loginForm = document.querySelector('#login-form');
const authMessage = document.querySelector('#auth-message');
const memoryDialog = document.querySelector('#memory-dialog');
const memoryForm = document.querySelector('#memory-form');
const memoryMessage = document.querySelector('#memory-message');
const toast = document.querySelector('#toast');

let supabase;
let session;
let member;
let couple;
let capsule;
let nextOpening;
let coupleMembers = [];
let countdownTimer;
let toastTimer;
let refreshingMonth = false;
let nextMonthRefreshAt = 0;
let loadedAuthUserId;
let serviceWorkerRegistration;

function initialize() {
  if (missingConfig.length) {
    setupScreen.hidden = false;
    setupScreen.querySelector('p').textContent =
      `Configuration manquante : ${missingConfig.join(', ')}. Consulte le README pour connecter le projet à Supabase.`;
    return;
  }

  supabase = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_ANON_KEY);
  void start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}

async function start() {
  loginForm.addEventListener('submit', signIn);
  document.querySelector('#sign-out-button').addEventListener('click', signOut);
  document.querySelector('#add-memory-button').addEventListener('click', () => memoryDialog.showModal());
  document.querySelector('#close-dialog-button').addEventListener('click', () => memoryDialog.close());
  memoryForm.addEventListener('submit', addMemory);
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  document.querySelector('#enable-push-button').addEventListener('click', enablePush);
  document.querySelector('#push-message-form').addEventListener('submit', sendReminder);
  document.querySelector('#archive-list').addEventListener('click', openArchive);
  serviceWorkerRegistration = await registerServiceWorker();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showToast(`Impossible de vérifier la session : ${error.message}`, 'error');
    showAuth();
  } else {
    await handleSession(data.session);
  }

  supabase.auth.onAuthStateChange((event, nextSession) => {
    queueMicrotask(() => {
      handleSession(nextSession);
    });
  });
}

async function signIn(event) {
  event.preventDefault();
  setFormMessage(authMessage, '');
  const formData = new FormData(loginForm);
  const profile = String(formData.get('profile') || '');
  const code = String(formData.get('code') || '');
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Connexion…';

  try {
    const { data, error } = await supabase.functions.invoke('login-with-code', {
      body: { profile, code },
    });
    if (error) {
      setFormMessage(authMessage, 'Connexion impossible. Vérifie ton code ou réessaie dans quelques minutes.', true);
      return;
    }
    if (!data?.access_token || !data?.refresh_token) {
      setFormMessage(authMessage, 'Le service de connexion a renvoyé une réponse invalide. Réessaie plus tard.', true);
      return;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (sessionError) {
      setFormMessage(authMessage, `Connexion impossible : ${sessionError.message}`, true);
    }
  } catch (error) {
    setFormMessage(authMessage, `Le service de connexion est momentanément indisponible : ${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Entrer dans notre capsule';
  }
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) showToast(`Déconnexion impossible : ${error.message}`, 'error');
}

async function handleSession(nextSession) {
  if (nextSession && loadedAuthUserId === nextSession.user.id) {
    session = nextSession;
    return;
  }
  session = nextSession;
  if (!session) {
    clearInterval(countdownTimer);
    member = undefined;
    couple = undefined;
    capsule = undefined;
    coupleMembers = [];
    loadedAuthUserId = undefined;
    clearPrivateContent();
    showAuth();
    return;
  }

  clearInterval(countdownTimer);
  member = undefined;
  couple = undefined;
  capsule = undefined;
  coupleMembers = [];
  clearPrivateContent();
  showAuth();
  document.querySelector('#account-name').textContent = 'Connexion…';

  const { data, error } = await supabase
    .from('memberships')
    .select('couple_id, user_id, role, display_name')
    .eq('user_id', session.user.id)
    .eq('couple_id', config.VITE_COUPLE_ID)
    .maybeSingle();

  if (error) {
    showToast(`Impossible de charger le compte : ${error.message}`, 'error');
    return;
  }
  loadedAuthUserId = session.user.id;
  if (!data) {
    document.querySelector('#account-name').textContent = 'Compte non associé';
    showApp();
    document.querySelector('#hero-title').textContent = 'Compte à associer.';
    document.querySelector('#hero-description').textContent =
      'Ce compte est connecté, mais il n’a pas encore été associé à cette capsule. Vérifie les adhésions dans Supabase.';
    document.querySelector('#current-view').hidden = true;
    document.querySelector('.tabs').hidden = true;
    return;
  }

  member = data;
  document.querySelector('#account-name').textContent = member.display_name;
  await loadWorkspace();
  showApp();
}

async function loadWorkspace() {
  if (!member) return;
  document.querySelector('#current-view').hidden = false;
  document.querySelector('.tabs').hidden = false;

  const [{ data: coupleRows, error: coupleError }, { data: membershipRows, error: membersError }] =
    await Promise.all([
      supabase.from('couples').select('id, name, timezone').eq('id', member.couple_id).single(),
      supabase.from('memberships').select('user_id, display_name, role').eq('couple_id', member.couple_id),
    ]);

  if (coupleError || membersError) {
    showToast(`Impossible de charger la capsule : ${(coupleError || membersError).message}`, 'error');
    return;
  }
  couple = coupleRows;
  coupleMembers = membershipRows;

  const { data: capsuleRows, error: capsuleError } = await supabase.rpc('get_current_capsule', {
    p_couple_id: member.couple_id,
  });
  if (capsuleError) {
    showToast(`Impossible d’ouvrir la capsule du mois : ${capsuleError.message}`, 'error');
    return;
  }
  capsule = Array.isArray(capsuleRows) ? capsuleRows[0] : capsuleRows;
  if (!capsule) {
    showToast('Supabase n’a pas retourné la capsule du mois.', 'error');
    return;
  }

  const { data: nextOpeningRow, error: nextOpeningError } = await supabase
    .from('capsules')
    .select('month, opens_at')
    .eq('couple_id', member.couple_id)
    .gt('opens_at', new Date().toISOString())
    .order('opens_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextOpeningError) {
    showToast(`Impossible de charger la prochaine ouverture : ${nextOpeningError.message}`, 'error');
    return;
  }
  nextOpening = nextOpeningRow || capsule;

  document.querySelector('#hero-title').textContent = couple.name;
  document.querySelector('#hero-description').textContent =
    'Dépose une image ou quelques mots : chacun découvrira les souvenirs de l’autre le 25.';
  document.querySelector('#account-name').textContent = member.display_name;
  document.querySelector('#admin-tab').hidden = member.role !== 'admin';
  document.querySelector('#current-month-title').textContent = formatMonth(capsule.month);
  await renderCurrentMemories();
  await renderArchives();
  if (member.role === 'admin') await renderProgress();
  updateCountdown();
  clearInterval(countdownTimer);
  countdownTimer = window.setInterval(updateCountdown, 1000);
  await updatePushButton();
}

async function renderCurrentMemories() {
  const { data, error } = await supabase
    .from('memories')
    .select('id, capsule_id, author_id, note, photo_path, created_at')
    .eq('capsule_id', capsule.id)
    .order('created_at', { ascending: false });
  if (error) {
    showToast(`Impossible de charger les souvenirs : ${error.message}`, 'error');
    return;
  }

  const unlocked = new Date(capsule.opens_at) <= new Date();
  document.querySelector('#visibility-note').textContent = unlocked
    ? 'La capsule est ouverte : vos souvenirs du mois sont réunis ici.'
    : 'Tes dépôts restent privés jusqu’au 25. Ceux de l’autre apparaîtront à l’ouverture.';
  document.querySelector('#capsule-status').textContent = unlocked
    ? 'La capsule du mois est ouverte.'
    : `Cette lettre est scellée jusqu’au ${formatDate(capsule.opens_at)}.`;
  document.querySelector('#envelope-seal').textContent = unlocked ? '♡' : '⌑';
  document.querySelector('#add-memory-button').hidden =
    getCurrentMonthKey(couple.timezone) !== capsule.month;
  await renderMemoryCards(document.querySelector('#current-memories'), data);
}

async function renderArchives() {
  const { data, error } = await supabase
    .from('capsules')
    .select('id, month, opens_at, memories(count)')
    .eq('couple_id', member.couple_id)
    .lt('opens_at', new Date().toISOString())
    .neq('id', capsule.id)
    .order('month', { ascending: false });
  if (error) {
    showToast(`Impossible de charger les archives : ${error.message}`, 'error');
    return;
  }

  const archiveList = document.querySelector('#archive-list');
  archiveList.replaceChildren();
  document.querySelector('#archive-content').hidden = true;
  const filledArchives = data.filter(archive => archive.memories?.[0]?.count > 0);
  if (!filledArchives.length) {
    archiveList.append(createEmptyState('Les capsules ouvertes des mois précédents apparaîtront ici.'));
    return;
  }
  for (const archive of filledArchives) {
    const button = document.createElement('button');
    button.className = 'archive-item';
    button.type = 'button';
    button.dataset.capsuleId = archive.id;
    button.innerHTML = `<span class="archive-icon" aria-hidden="true">♡</span><span>${formatMonth(archive.month)}</span><span class="archive-arrow" aria-hidden="true">↗</span>`;
    archiveList.append(button);
  }
}

async function openArchive(event) {
  const button = event.target.closest('[data-capsule-id]');
  if (!button) return;
  const archiveContent = document.querySelector('#archive-content');
  archiveContent.hidden = false;
  archiveContent.replaceChildren(createEmptyState('Ouverture de l’archive…'));
  const { data, error } = await supabase
    .from('memories')
    .select('id, capsule_id, author_id, note, photo_path, created_at')
    .eq('capsule_id', button.dataset.capsuleId)
    .order('created_at', { ascending: false });
  if (error) {
    showToast(`Impossible d’ouvrir cette archive : ${error.message}`, 'error');
    return;
  }
  const monthLabel = button.querySelector('span:nth-child(2)').textContent;
  archiveContent.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = monthLabel;
  archiveContent.append(heading);
  await renderMemoryCards(archiveContent, data);
}

async function renderMemoryCards(container, memories) {
  container.replaceChildren();
  if (!memories.length) {
    container.append(createEmptyState('Pas encore de souvenir ici. Le premier peut être à toi.'));
    return;
  }

  for (const memory of memories) {
    const card = document.createElement('article');
    card.className = 'memory-card';
    if (memory.photo_path) {
      const { data, error } = await supabase.storage
        .from('capsule-photos')
        .createSignedUrl(memory.photo_path, 3600);
      if (error) {
        showToast(`Impossible d’afficher une photo : ${error.message}`, 'error');
      } else {
        const image = document.createElement('img');
        image.className = 'memory-photo';
        image.src = data.signedUrl;
        image.alt = 'Photo déposée dans la capsule';
        image.loading = 'lazy';
        card.append(image);
      }
    }

    const caption = document.createElement('div');
    caption.className = 'memory-caption';
    const author = coupleMembers.find(person => person.user_id === memory.author_id);
    const byline = document.createElement('span');
    byline.className = 'memory-author';
    byline.textContent = `${author?.display_name || 'Nous deux'} · ${formatDate(memory.created_at)}`;
    caption.append(byline);
    if (memory.note) {
      const note = document.createElement('p');
      note.textContent = memory.note;
      caption.append(note);
    }
    card.append(caption);
    container.append(card);
  }
}

async function addMemory(event) {
  event.preventDefault();
  setFormMessage(memoryMessage, '');
  const button = memoryForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Dépôt en cours…';

  const note = String(new FormData(memoryForm).get('note') || '').trim();
  const cameraPhoto = document.querySelector('#camera-photo').files[0];
  const galleryPhoto = document.querySelector('#gallery-photo').files[0];
  const photo = cameraPhoto || galleryPhoto;

  if (!note && !photo) {
    setFormMessage(memoryMessage, 'Ajoute une note, une photo, ou les deux.', true);
    finishMemorySubmit(button);
    return;
  }
  if (cameraPhoto && galleryPhoto) {
    setFormMessage(memoryMessage, 'Choisis une seule photo à déposer.', true);
    finishMemorySubmit(button);
    return;
  }
  if (photo && !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
    setFormMessage(memoryMessage, 'Le format doit être JPEG, PNG ou WebP.', true);
    finishMemorySubmit(button);
    return;
  }
  if (photo && photo.size > 10 * 1024 * 1024) {
    setFormMessage(memoryMessage, 'La photo dépasse la limite de 10 Mo.', true);
    finishMemorySubmit(button);
    return;
  }

  let photoPath = null;
  if (photo) {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[photo.type];
    photoPath = `${member.couple_id}/${capsule.id}/${member.user_id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('capsule-photos').upload(photoPath, photo, {
      contentType: photo.type,
      upsert: false,
    });
    if (error) {
      setFormMessage(memoryMessage, `La photo n’a pas pu être téléversée : ${error.message}`, true);
      finishMemorySubmit(button);
      return;
    }
  }

  const { error } = await supabase.from('memories').insert({
    capsule_id: capsule.id,
    author_id: member.user_id,
    note,
    photo_path: photoPath,
  });
  if (error) {
    let message = `Le souvenir n’a pas pu être enregistré : ${error.message}`;
    if (photoPath) {
      const { error: cleanupError } = await supabase.storage.from('capsule-photos').remove([photoPath]);
      if (cleanupError) message += ` Le fichier temporaire n’a pas pu être supprimé : ${cleanupError.message}`;
    }
    setFormMessage(memoryMessage, message, true);
    finishMemorySubmit(button);
    return;
  }

  memoryForm.reset();
  memoryDialog.close();
  finishMemorySubmit(button);
  showToast('Ton souvenir est bien déposé. Il attendra le 25 pour être dévoilé.');
  await renderCurrentMemories();
  if (member.role === 'admin') await renderProgress();
}

function finishMemorySubmit(button) {
  button.disabled = false;
  button.textContent = 'Déposer dans la capsule';
}

async function renderProgress() {
  const { data, error } = await supabase.rpc('get_capsule_progress', {
    p_capsule_id: capsule.id,
  });
  if (error) {
    showToast(`Impossible de charger l’état de la capsule : ${error.message}`, 'error');
    return;
  }
  const progress = document.querySelector('#capsule-progress');
  progress.replaceChildren();
  for (const person of data) {
    const row = document.createElement('div');
    row.className = 'progress-row';
    const name = document.createElement('span');
    name.textContent = person.display_name;
    const count = document.createElement('strong');
    count.textContent = `${person.entry_count} souvenir${person.entry_count === 1 ? '' : 's'}`;
    row.append(name, count);
    progress.append(row);
  }
}

async function enablePush() {
  if (!serviceWorkerRegistration || !('PushManager' in window) || !('Notification' in window)) {
    showToast('Les notifications push ne sont pas disponibles dans ce navigateur.', 'error');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Autorise les notifications dans les réglages de ton navigateur.', 'error');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(vapidPublicKey),
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      showToast('Le navigateur n’a pas fourni une souscription push complète.', 'error');
      return;
    }

    const { error } = await supabase.from('push_subscriptions').upsert({
      couple_id: member.couple_id,
      user_id: member.user_id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: 'endpoint' });
    if (error) {
      showToast(`Impossible d’enregistrer cet appareil : ${error.message}`, 'error');
      return;
    }
    showToast('Les notifications sont activées sur cet appareil.');
    await updatePushButton();
  } catch (error) {
    showToast(`Impossible d’activer les notifications : ${error.message}`, 'error');
  }
}

async function updatePushButton() {
  const button = document.querySelector('#enable-push-button');
  if (!serviceWorkerRegistration || !('PushManager' in window)) {
    button.disabled = true;
    button.textContent = 'Notifications indisponibles';
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      button.textContent = 'Activer les rappels sur cet appareil';
      button.disabled = false;
      return;
    }

    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscription.endpoint)
      .maybeSingle();
    if (error) {
      showToast(`Impossible de vérifier l’inscription aux rappels : ${error.message}`, 'error');
    }
    button.textContent = data ? 'Notifications activées sur cet appareil' : 'Finaliser l’inscription aux rappels';
    button.disabled = Boolean(data);
  } catch (error) {
    button.disabled = true;
    button.textContent = 'Notifications indisponibles';
    showToast(`Impossible de vérifier les notifications : ${error.message}`, 'error');
  }
}

async function sendReminder(event) {
  event.preventDefault();
  const form = document.querySelector('#push-message-form');
  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector('#push-message-status');
  setFormMessage(status, '');
  const formData = new FormData(form);
  let notification;

  try {
    notification = normalizePushMessage({
      title: formData.get('title'),
      body: formData.get('body'),
      url: formData.get('url'),
      recipients: formData.getAll('recipients'),
    });
  } catch (error) {
    setFormMessage(status, error.message, true);
    return;
  }

  button.disabled = true;
  button.textContent = 'Envoi en cours…';
  try {
    const { data, error } = await supabase.functions.invoke('send-reminder', {
      body: notification,
    });
    if (error) {
      setFormMessage(status, `La notification n’a pas pu être envoyée : ${error.message}`, true);
      return;
    }

    const details = data.results
      .map(result => `${result.display_name} : ${result.sent} reçu${result.sent === 1 ? '' : 's'}${result.deviceCount === 0 ? ', aucun appareil inscrit' : ''}${result.failed ? `, ${result.failed} échec(s)` : ''}`)
      .join(' · ');
    const message = `${data.sent} notification(s) envoyée(s). ${details}`;
    setFormMessage(status, message, data.failed > 0 || data.sent === 0);
  } catch (error) {
    setFormMessage(status, `Le service de notification est indisponible : ${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Envoyer la notification';
  }
}

function switchView(view) {
  if (view === 'admin' && member?.role !== 'admin') return;
  document.querySelectorAll('.tab-button').forEach(button => {
    button.classList.toggle('is-active', button.dataset.view === view);
  });
  document.querySelector('#current-view').hidden = view !== 'current';
  document.querySelector('#history-view').hidden = view !== 'history';
  document.querySelector('#admin-view').hidden = view !== 'admin';
}

function updateCountdown() {
  if (!capsule || !couple) return;
  const now = Date.now();
  const target = new Date(nextOpening?.opens_at || capsule.opens_at);
  const remaining = Math.max(0, target.getTime() - now);
  document.querySelector('#count-days').textContent = String(Math.floor(remaining / 86400000)).padStart(2, '0');
  document.querySelector('#count-hours').textContent = String(Math.floor(remaining / 3600000) % 24).padStart(2, '0');
  document.querySelector('#count-minutes').textContent = String(Math.floor(remaining / 60000) % 60).padStart(2, '0');
  document.querySelector('#count-seconds').textContent = String(Math.floor(remaining / 1000) % 60).padStart(2, '0');
  document.querySelector('#countdown-label').textContent = 'Prochaine ouverture dans';

  if (!refreshingMonth && Date.now() >= nextMonthRefreshAt &&
      (getCurrentMonthKey(couple.timezone) !== capsule.month || remaining === 0)) {
    refreshingMonth = true;
    nextMonthRefreshAt = Date.now() + 30000;
    loadWorkspace().finally(() => { refreshingMonth = false; });
  }
}

function formatMonth(month) {
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: couple?.timezone || 'Europe/Paris',
  }).format(new Date(`${month}T12:00:00Z`));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeZone: couple?.timezone || 'Europe/Paris',
  }).format(new Date(value));
}

function decodeVapidKey(key) {
  const padding = '='.repeat((4 - key.length % 4) % 4);
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

function createEmptyState(message) {
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = message;
  return empty;
}

function setFormMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.classList.toggle('is-error', type === 'error');
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 5000);
}

function showAuth() {
  setupScreen.hidden = true;
  authScreen.hidden = false;
  appScreen.hidden = true;
  accountArea.hidden = true;
  loginForm.hidden = false;
}

function showApp() {
  setupScreen.hidden = true;
  authScreen.hidden = true;
  appScreen.hidden = false;
  accountArea.hidden = false;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.error('Service worker registration failed.', error);
    showToast('La capsule fonctionne, mais son mode installable n’a pas pu démarrer.', 'error');
    return null;
  }
}

function clearPrivateContent() {
  document.querySelector('#current-memories').replaceChildren();
  document.querySelector('#archive-list').replaceChildren();
  document.querySelector('#archive-content').replaceChildren();
  document.querySelector('#archive-content').hidden = true;
  document.querySelector('#capsule-progress').replaceChildren();
  document.querySelector('#hero-description').textContent = '';
  document.querySelector('#visibility-note').textContent = '';
}
