const PROFILE_ROLES = new Set(['admin', 'partner']);

export function normalizePushMessage({ title, body, url, recipients }) {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedBody = typeof body === 'string' ? body.trim() : '';
  const normalizedUrl = typeof url === 'string' ? url.trim() : '';

  if (!normalizedTitle || normalizedTitle.length > 60) {
    throw new Error('Le titre doit contenir entre 1 et 60 caractères.');
  }
  if (!normalizedBody || normalizedBody.length > 240) {
    throw new Error('Le message doit contenir entre 1 et 240 caractères.');
  }
  if (!isSafeNotificationUrl(normalizedUrl)) {
    throw new Error('Le lien doit être un chemin interne de la capsule, par exemple /.');
  }
  if (!Array.isArray(recipients)) {
    throw new Error('Choisis au moins un destinataire.');
  }

  const normalizedRecipients = [...new Set(recipients)];
  if (!normalizedRecipients.length ||
      normalizedRecipients.some(profile => !PROFILE_ROLES.has(profile))) {
    throw new Error('Choisis au moins un destinataire valide.');
  }

  return {
    title: normalizedTitle,
    body: normalizedBody,
    url: normalizedUrl,
    recipients: normalizedRecipients,
  };
}

export function isSafeNotificationUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
      value.includes('\\') || /[\u0000-\u001f]/.test(value)) {
    return false;
  }

  try {
    return new URL(value, 'https://amo-te.invalid').origin === 'https://amo-te.invalid';
  } catch {
    return false;
  }
}
