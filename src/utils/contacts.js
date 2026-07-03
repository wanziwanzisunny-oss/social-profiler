const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}/g;

const GENERIC_EMAIL_PREFIXES = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
]);

export function extractContactsFromText(text = '', source = {}) {
  const sourceUrl = source.url || null;
  const sourceTitle = source.title || null;
  const scope = source.scope || 'unknown';
  const allowPhones = source.allowPhones !== false;

  const emails = [...new Set((String(text).match(EMAIL_RE) || [])
    .map(email => email.toLowerCase())
    .filter(email => !GENERIC_EMAIL_PREFIXES.has(email.split('@')[0])))]
    .map(value => ({
      type: 'email',
      value,
      sourceUrl,
      sourceTitle,
      scope,
      confidence: 'high',
      verified: true,
    }));

  const phones = allowPhones ? [...new Set((String(text).match(PHONE_RE) || [])
    .map(phone => phone.trim())
    .filter(phone => /\d{7,}/.test(phone.replace(/\D/g, ''))))]
    .map(value => ({
      type: 'phone',
      value,
      sourceUrl,
      sourceTitle,
      scope,
      confidence: 'high',
      verified: true,
    })) : [];

  return [...emails, ...phones];
}

export function mergeContacts(...contactGroups) {
  const byKey = new Map();
  const contacts = [];

  for (const group of contactGroups.flat()) {
    if (!group) continue;
    if (group.type === 'phone' && !_isTrustedPhoneContact(group)) continue;
    const normalized = _normalizeContact(group);
    const key = _contactKey(normalized);
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
      contacts.push(normalized);
      continue;
    }

    const existing = byKey.get(key);
    if (_isBetterContactSource(normalized, existing)) {
      byKey.set(key, normalized);
      const index = contacts.indexOf(existing);
      if (index >= 0) contacts[index] = normalized;
    }
  }

  return contacts;
}

function _normalizeContact(contact) {
  if (contact.type !== 'phone') return contact;

  const phone = _normalizePhone(contact.value);
  if (!phone) return contact;

  return {
    ...contact,
    value: phone.display,
    normalizedValue: phone.key,
  };
}

function _contactKey(contact) {
  if (contact.type === 'phone') {
    return `${contact.type}:${contact.normalizedValue || _phoneDigits(contact.value) || String(contact.value).toLowerCase()}`;
  }
  return `${contact.type}:${String(contact.value).toLowerCase()}`;
}

function _normalizePhone(value) {
  const raw = String(value || '').trim();
  const digits = _phoneDigits(raw);
  if (!digits || digits.length < 7) return null;

  if (digits.length === 10) {
    const key = `1${digits}`;
    return { key, display: `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` };
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return { key: digits, display: `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` };
  }

  if (raw.startsWith('+')) {
    const countryCode = digits.slice(0, Math.max(1, digits.length - 10));
    const rest = digits.slice(countryCode.length);
    return { key: digits, display: `+${countryCode} ${_groupPhoneRest(rest)}`.trim() };
  }

  return { key: digits, display: raw };
}

function _phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function _groupPhoneRest(rest) {
  if (rest.length === 10) return `${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  if (rest.length > 6) return `${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  return rest;
}

function _isBetterContactSource(candidate, existing) {
  const candidateUrl = String(candidate.sourceUrl || '').toLowerCase();
  const existingUrl = String(existing.sourceUrl || '').toLowerCase();
  if (candidateUrl.startsWith('tel:') && !existingUrl.startsWith('tel:')) return true;
  if (candidateUrl && !existingUrl) return true;
  return false;
}

function _isTrustedPhoneContact(contact) {
  const sourceUrl = String(contact.sourceUrl || '').toLowerCase();
  if (!sourceUrl) return true;
  if (sourceUrl.startsWith('tel:')) return true;

  const untrustedPhoneSources = [
    'podcasts.apple.com',
    'linkedin.com/posts/',
    'linkedin.com/feed/',
    'facebook.com/',
    'instagram.com/',
    'youtube.com/',
    'youtu.be/',
    'spotify.com/',
  ];

  return !untrustedPhoneSources.some(source => sourceUrl.includes(source));
}
