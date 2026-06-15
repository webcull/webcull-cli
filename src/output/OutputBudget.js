export class OutputBudget {
  static defaults(options, values = {}) {
    return {
      limit: options.limit || values.limit || 25,
      page: options.page || values.page || 1,
      max_chars: options.maxChars || values.maxChars || 12000,
      max_metadata_chars: options.maxMetadataChars || values.maxMetadataChars || 500,
      fields: options.fields || values.fields || ''
    };
  }
}
