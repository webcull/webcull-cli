const SUPPORTED_PROXY_FIELDS = ['title', 'icon', 'description'];

export function resolveProxyFields(fields, exclude) {
  const included = fields === undefined
    ? [...SUPPORTED_PROXY_FIELDS]
    : normalizeList(fields, '--fields');

  const excluded = exclude === undefined
    ? []
    : normalizeList(exclude, '--exclude');

  const resolved = included.filter(field => !excluded.includes(field));
  if (!resolved.length) {
    throw new Error('Proxy field selection cannot be empty.');
  }
  return resolved;
}

export function resolveCreateProxyFields(fields, exclude) {
  try {
    return resolveProxyFields(fields, exclude);
  } catch (error) {
    error.message = error.message
      .replace('--fields', '--proxy-fields')
      .replace('--exclude', '--proxy-exclude');
    throw error;
  }
}

function normalizeList(value, optionName) {
  const fields = String(value)
    .toLowerCase()
    .split(',')
    .map(field => field.trim())
    .filter(Boolean);

  if (!fields.length) {
    throw new Error(optionName + ' requires at least one field.');
  }
  if (fields.includes('all')) {
    if (fields.length !== 1) {
      throw new Error(optionName + ' cannot combine all with named fields.');
    }
    return [...SUPPORTED_PROXY_FIELDS];
  }

  const unique = [...new Set(fields)];
  for (const field of unique) {
    if (!SUPPORTED_PROXY_FIELDS.includes(field)) {
      throw new Error('Unknown proxy field: ' + field + '.');
    }
  }
  return unique;
}
