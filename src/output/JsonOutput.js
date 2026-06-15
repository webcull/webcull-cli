export class JsonOutput {
  print(data, options = {}) {
    const format = options.format || 'json';
    if (format === 'jsonl' && Array.isArray(data.items)) {
      for (const item of data.items) {
        console.log(JSON.stringify(item));
      }
      return;
    }
    console.log(JSON.stringify(data, null, 2));
  }
}
