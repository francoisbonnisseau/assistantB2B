export function validateUsername(value) {
  if (!value?.trim()) return 'Le username est obligatoire.'
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(value)) {
    return 'Le username doit contenir 3 a 40 caracteres (lettres, chiffres, ., _, -).'
  }
  return null
}

export function validateClientPassword(value, { required = true } = {}) {
  if (!required && !value) return null
  if (!value) return 'Le mot de passe est obligatoire.'
  return null
}

export function validateMeetingType({ code, label }) {
  if (!label?.trim()) return 'Le label est obligatoire.'
  if (!code?.trim()) return 'Le code est obligatoire.'
  if (!/^[a-z0-9_]{2,40}$/.test(code)) {
    return 'Le code doit etre en snake_case (2 a 40 caracteres).'
  }
  return null
}

export function cleanMetadata(metadata = {}) {
  return {
    company: metadata.company?.trim() || '',
    name: metadata.name?.trim() || '',
    description: metadata.description?.trim() || '',
  }
}
