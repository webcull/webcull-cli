export class WriteCommandValidation {
  constructor(allowedOptions) {
    this.allowedOptions = new Set(allowedOptions);
  }

  validateCommon(parsed) {
    for (const key of Object.keys(parsed.options)) {
      if (!this.allowedOptions.has(key)) {
        throw new Error('Unknown option for write command: --' + this.dashKey(key));
      }
      if ((parsed.optionCounts && parsed.optionCounts[key] > 1)) {
        throw new Error('Duplicate option for write command: --' + this.dashKey(key));
      }
    }
    if (parsed.options.format && parsed.options.format !== 'json') {
      throw new Error('Write commands support --format json only.');
    }
    if (parsed.options.parentId !== undefined && parsed.options.parentPath !== undefined) {
      throw new Error('Use either --parent-id or --parent-path, not both.');
    }
  }

  positiveInteger(value, label) {
    if (!/^[0-9]+$/.test(String(value || '')) || Number(value) <= 0) {
      throw new Error(label + ' must be a positive integer.');
    }
    return Number(value);
  }

  rejectControlCharacters(value, label) {
    if (value !== undefined && /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(String(value))) {
      throw new Error(label + ' contains control characters.');
    }
  }

  requireMax(value, max, label) {
    if (value !== undefined && String(value).length > max) {
      throw new Error(label + ' is too long.');
    }
  }

  normalizeTags(value) {
    if (value === undefined) {
      return undefined;
    }
    return String(value)
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .join(',');
  }

  validateTextLimits(values) {
    this.rejectControlCharacters(values.title, 'Title');
    this.rejectControlCharacters(values.url, 'URL');
    this.rejectControlCharacters(values.notes, 'Notes');
    this.rejectControlCharacters(values.tags, 'Tags');
    this.rejectControlCharacters(values.parentPath, 'Parent path');
    this.requireMax(values.title, 500, 'Title');
    this.requireMax(values.url, 3500, 'URL');
    this.requireMax(values.notes, 8000, 'Notes');
    this.requireMax(values.tags, 2000, 'Tags');
    this.requireMax(values.parentPath, 1000, 'Parent path');
    if (values.tags) {
      for (const tag of String(values.tags).split(',')) {
        this.requireMax(tag.trim(), 120, 'Tag');
      }
    }
  }

  dashKey(key) {
    return key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  }
}
