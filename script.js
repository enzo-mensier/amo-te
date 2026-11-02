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
let coupleMembers = [];
let countdownTimer;
let toastTimer;
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
  document.querySelector('#open-capsule-button').addEventListener('click', openCurrentCapsule);
  document.querySelector('#download-capsule-button').addEventListener('click', () => downloadCapsule(capsule.id));
  document.querySelector('#start-next-capsule-button').addEventListener('click', startNextCapsule);
  memoryForm.addEventListener('submit', addMemory);
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  document.querySelector('#enable-push-button').addEventListener('click', enablePush);
  document.querySelector('#push-message-form').addEventListener('submit', sendReminder);
  document.querySelector('#archive-list').addEventListener('click', openArchive);
  document.querySelector('#archive-content').addEventListener('click', event => {
    const button = event.target.closest('[data-download-capsule]');
    if (button) void downloadCapsule(button.dataset.downloadCapsule);
  });
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

  document.querySelector('#hero-title').textContent = couple.name;
  document.querySelector('#hero-description').textContent =
    capsule.opened_at
      ? 'La lettre est ouverte : retrouvez vos souvenirs du mois, réunis dans leur ordre de dépôt.'
      : 'Gardons nos photos et nos mots doux ici. Le 25, la lettre sera prête à être ouverte.';
  document.querySelector('#account-name').textContent = member.display_name;
  document.querySelector('#admin-tab').hidden = member.role !== 'admin';
  document.querySelector('#current-month-title').textContent = formatMonth(capsule.month);
  await renderCurrentMemories();
  await renderArchives();
  if (member.role === 'admin') await renderProgress();
  clearInterval(countdownTimer);
  countdownTimer = undefined;
  updateCountdown();
  if (!capsule.opened_at && new Date(capsule.opens_at) > new Date()) {
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }
  await updatePushButton();
}

async function renderCurrentMemories() {
  const { data, error } = await supabase
    .from('memories')
    .select('id, capsule_id, author_id, note, photo_path, created_at')
    .eq('capsule_id', capsule.id)
    .order('created_at', { ascending: true });
  if (error) {
    showToast(`Impossible de charger les souvenirs : ${error.message}`, 'error');
    return;
  }

  const opened = Boolean(capsule.opened_at);
  const ready = new Date(capsule.opens_at) <= new Date();
  document.querySelector('#visibility-note').textContent = opened
    ? 'Tous vos souvenirs sont réunis dans l’ordre où vous les avez déposés.'
    : ready
      ? 'La lettre est prête. Ouvrez-la ensemble pour découvrir les souvenirs du mois.'
      : 'Tes dépôts restent cachés jusqu’au 25. Les souvenirs de l’autre apparaîtront après l’ouverture.';
  document.querySelector('#capsule-status').textContent = opened
    ? 'La capsule du mois est ouverte.'
    : ready
      ? 'La lettre est prête à être ouverte.'
      : `Cette lettre est scellée jusqu’au ${formatDate(capsule.opens_at)}.`;
  document.querySelector('#envelope-seal').textContent = opened ? '♡' : '⌑';
  document.querySelector('#add-memory-button').hidden = opened;
  document.querySelector('#current-memories').hidden = !opened;
  if (opened) {
    await renderMemoryCards(document.querySelector('#current-memories'), data);
  } else {
    document.querySelector('#current-memories').replaceChildren();
  }
  updateCountdown();
}

async function renderArchives() {
  const { data, error } = await supabase
    .from('capsules')
    .select('id, month, opened_at, memories(count)')
    .eq('couple_id', member.couple_id)
    .not('opened_at', 'is', null)
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
    archiveList.append(createEmptyState('Les capsules des mois précédents apparaîtront ici après leur ouverture.'));
    return;
  }
  for (const archive of filledArchives) {
    const button = document.createElement('button');
    button.className = 'archive-item';
    button.type = 'button';
    button.dataset.capsuleId = archive.id;
    const icon = document.createElement('span');
    icon.className = 'archive-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '♡';
    const label = document.createElement('span');
    label.textContent = formatMonth(archive.month);
    const arrow = document.createElement('span');
    arrow.className = 'archive-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    button.append(icon, label, arrow);
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
    .order('created_at', { ascending: true });
  if (error) {
    showToast(`Impossible d’ouvrir cette archive : ${error.message}`, 'error');
    return;
  }
  const monthLabel = button.querySelector('span:nth-child(2)').textContent;
  archiveContent.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = monthLabel;
  const downloadButton = document.createElement('button');
  downloadButton.className = 'button button-secondary archive-download';
  downloadButton.type = 'button';
  downloadButton.dataset.downloadCapsule = button.dataset.capsuleId;
  downloadButton.textContent = 'Télécharger ce récapitulatif';
  const memoriesGrid = document.createElement('div');
  memoriesGrid.className = 'memory-grid';
  archiveContent.append(heading, downloadButton, memoriesGrid);
  await renderMemoryCards(memoriesGrid, data);
}

async function renderMemoryCards(container, memories) {
  container.replaceChildren();
  if (!memories.length) {
    container.append(createEmptyState('Cette capsule ne contient aucun souvenir.'));
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

    async function openCurrentCapsule() {
      const button = document.querySelector('#open-capsule-button');
      button.disabled = true;
      try {
        const { error } = await supabase.rpc('open_capsule', {
          p_capsule_id: capsule.id,
        });
        if (error) throw error;
        await loadWorkspace();
        showToast('La lettre est ouverte. Vos souvenirs sont réunis.');
      } catch (error) {
        showToast(`Impossible d’ouvrir la capsule : ${error.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    }

    async function startNextCapsule() {
      const button = document.querySelector('#start-next-capsule-button');
      button.disabled = true;
      try {
        const { error } = await supabase.rpc('start_next_capsule', {
          p_capsule_id: capsule.id,
        });
        if (error) throw error;
        await loadWorkspace();
        showToast('La prochaine capsule est prête à accueillir vos souvenirs.');
      } catch (error) {
        showToast(`Impossible de relancer la capsule : ${error.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    }

    async function downloadCapsule(capsuleId) {
      try {
        const { data: capsuleRow, error: capsuleError } = await supabase
          .from('capsules')
          .select('month, opened_at')
          .eq('id', capsuleId)
          .single();
        if (capsuleError) throw capsuleError;
        if (!capsuleRow.opened_at) throw new Error('Cette capsule doit être ouverte avant son téléchargement.');

        const { data: memories, error: memoriesError } = await supabase
          .from('memories')
          .select('author_id, note, photo_path, created_at')
          .eq('capsule_id', capsuleId)
          .order('created_at', { ascending: true });
        if (memoriesError) throw memoriesError;

        const authorCounts = new Map(coupleMembers.map(person => [person.user_id, 0]));
        let photoCount = 0;
        const entries = [];
        for (const memory of memories) {
          authorCounts.set(memory.author_id, (authorCounts.get(memory.author_id) || 0) + 1);
          let photo = '';
          if (memory.photo_path) {
            const { data: signedUrl, error: urlError } = await supabase.storage
              .from('capsule-photos')
              .createSignedUrl(memory.photo_path, 3600);
            if (urlError) throw urlError;
            const response = await fetch(signedUrl.signedUrl);
            if (!response.ok) throw new Error(`Impossible de télécharger une photo (${response.status}).`);
            photo = await blobToDataUrl(await response.blob());
            photoCount += 1;
          }

          const author = coupleMembers.find(person => person.user_id === memory.author_id);
          entries.push(`<article class="memory">
            ${photo ? `<img src="${photo}" alt="Photo déposée par ${escapeHtml(author?.display_name || 'Nous deux')}">` : ''}
            <p class="meta">${escapeHtml(author?.display_name || 'Nous deux')} · ${escapeHtml(formatDate(memory.created_at))}</p>
            ${memory.note ? `<p class="note">${escapeHtml(memory.note)}</p>` : ''}
          </article>`);
        }

        const recap = [...authorCounts]
          .map(([userId, count]) => {
            const author = coupleMembers.find(person => person.user_id === userId);
            return `${author?.display_name || 'Membre'} : ${count}`;
          })
          .join(' · ');
        const html = `<!doctype html>
    <html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>Amo-te — ${escapeHtml(formatMonth(capsuleRow.month))}</title>
    <style>
    body{max-width:760px;margin:40px auto;padding:0 20px;background:#fdfbf7;color:#39332e;font:16px/1.6 "Segoe UI",sans-serif}
    h1,h2{font-family:Georgia,serif;font-weight:500}h1{text-transform:capitalize}
    .recap{padding:18px;border:1px solid #e9ded1;border-radius:14px;background:#fffefa}
    .memory{margin:24px 0;padding:12px 12px 2px;border:1px solid #e9e3da;background:#fffefa}
    .memory img{width:100%;max-height:620px;object-fit:contain;background:#f2ebe2}
    .meta{color:#82776e;font-size:13px}.note{font-family:cursive;font-size:22px;white-space:pre-wrap}
    </style></head><body><h1>Notre capsule — ${escapeHtml(formatMonth(capsuleRow.month))}</h1>
    <section class="recap"><h2>Notre petit récapitulatif</h2>
    <p>${memories.length} souvenir${memories.length === 1 ? '' : 's'} · ${photoCount} photo${photoCount === 1 ? '' : 's'}</p>
    <p>${escapeHtml(recap)}</p></section>
    ${entries.join('\n')}
    </body></html>`;

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `amo-te-${capsuleRow.month}.html`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Le récapitulatif de la capsule est téléchargé.');
      } catch (error) {
        showToast(`Impossible de télécharger la capsule : ${error.message}`, 'error');
      }
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(new Error('Impossible de préparer une photo pour le téléchargement.')));
        reader.readAsDataURL(blob);
      });
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
    }

async function addMemory(event) {
  event.preventDefault();
  setFormMessage(memoryMessage, '');
  const button = memoryForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Dépôt en cours…';

  let photoPath = null;
  try {
    if (capsule.opened_at || getCurrentMonthKey(couple.timezone) !== capsule.month) {
      throw new Error('Cette capsule n’accepte plus de nouveaux souvenirs.');
    }

    const note = String(new FormData(memoryForm).get('note') || '').trim();
    const cameraPhoto = document.querySelector('#camera-photo').files[0];
    const galleryPhoto = document.querySelector('#gallery-photo').files[0];
    const photo = cameraPhoto || galleryPhoto;

    if (!note && !photo) throw new Error('Ajoute une note, une photo, ou les deux.');
    if (cameraPhoto && galleryPhoto) throw new Error('Choisis une seule photo à déposer.');
    if (photo && !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
      throw new Error('Le format doit être JPEG, PNG ou WebP.');
    }
    if (photo && photo.size > 10 * 1024 * 1024) {
      throw new Error('La photo dépasse la limite de 10 Mo.');
    }

    if (photo) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[photo.type];
      photoPath = `${member.couple_id}/${capsule.id}/${member.user_id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from('capsule-photos').upload(photoPath, photo, {
        contentType: photo.type,
        upsert: false,
      });
      if (error) throw new Error(`La photo n’a pas pu être téléversée : ${error.message}`);
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
      throw new Error(message);
    }

    memoryForm.reset();
    memoryDialog.close();
    showToast('Ton souvenir est bien déposé. Il restera caché jusqu’à l’ouverture.');
    await renderCurrentMemories();
    if (member.role === 'admin') await renderProgress();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFormMessage(memoryMessage, message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Déposer dans la capsule';
  }
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
  const opened = Boolean(capsule.opened_at);
  const target = new Date(capsule.opens_at).getTime();
  const remaining = Math.max(0, target - Date.now());
  const ready = remaining === 0;
  document.querySelector('#countdown-card').hidden = opened || ready;
  document.querySelector('#letter-opening-card').hidden = opened || !ready;
  document.querySelector('#capsule-actions').hidden = !opened;
  if (opened || ready) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
    return;
  }

  document.querySelector('#count-days').textContent = String(Math.floor(remaining / 86400000)).padStart(2, '0');
  document.querySelector('#count-hours').textContent = String(Math.floor(remaining / 3600000) % 24).padStart(2, '0');
  document.querySelector('#count-minutes').textContent = String(Math.floor(remaining / 60000) % 60).padStart(2, '0');
  document.querySelector('#count-seconds').textContent = String(Math.floor(remaining / 1000) % 60).padStart(2, '0');
  document.querySelector('#countdown-label').textContent = 'Notre lettre s’ouvre dans';
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
  switchView('current');
  document.querySelector('#current-memories').replaceChildren();
  document.querySelector('#current-memories').hidden = false;
  document.querySelector('#archive-list').replaceChildren();
  document.querySelector('#archive-content').replaceChildren();
  document.querySelector('#archive-content').hidden = true;
  document.querySelector('#capsule-progress').replaceChildren();
  document.querySelector('#hero-description').textContent = '';
  document.querySelector('#visibility-note').textContent = '';
  document.querySelector('#countdown-card').hidden = false;
  document.querySelector('#letter-opening-card').hidden = true;
  document.querySelector('#capsule-actions').hidden = true;
}
