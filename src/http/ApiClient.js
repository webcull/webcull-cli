import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

export class ApiClient {
  constructor({ apiUrl, tokenStore }) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.tokenStore = tokenStore;
  }

  async post(path, data = {}, { auth = false } = {}) {
    const url = new URL(path, this.apiUrl);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        body.set(key, String(value));
      }
    }
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'webcull-cli/0.1.0'
    };
    if (auth) {
      const token = await this.tokenStore.requireToken();
      headers.Authorization = 'Bearer ' + token;
    }
    return await this.request(url, {
      method: 'POST',
      headers,
      body: body.toString()
    });
  }

  request(url, options) {
    const transport = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = transport.request(url, {
        method: options.method,
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(options.body)
        }
      }, res => {
        const chunks = [];
        res.on('data', chunk => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          let buffer = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
          try {
            if (encoding.includes('gzip')) {
              buffer = zlib.gunzipSync(buffer);
            } else if (encoding.includes('deflate')) {
              buffer = zlib.inflateSync(buffer);
            }
          } catch (error) {
            reject(new Error('Could not decode WebCull API response.'));
            return;
          }
          const text = buffer.toString('utf8');
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch (error) {
            error.message = 'Invalid JSON response from WebCull CLI API.';
            reject(error);
            return;
          }
          parsed = this.safeResponse(parsed, null);
          if (parsed && parsed.error === 'throttled') {
            const retry = parsed.retry_after_seconds ? Number(parsed.retry_after_seconds) : 60;
            const throttle = parsed.throttle ? ' ' + parsed.throttle : '';
            reject(new Error('WebCull CLI' + throttle + ' limit reached. Wait at least ' + retry + ' seconds, then retry with a narrower request.'));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(this.safeMessage(parsed.failure || parsed.error || 'WebCull API request failed.')));
            return;
          }
          resolve(parsed);
        });
      });
      req.on('error', reject);
      req.write(options.body);
      req.end();
    });
  }

  safeMessage(message) {
    return String(message || '')
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
      .replace(/wco_cli_[A-Za-z0-9_-]+/g, '[redacted-cli-token]');
  }

  safeResponse(value, key = null) {
    if (typeof value === 'string') {
      return this.isErrorField(key) ? this.safeMessage(value) : value;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.safeResponse(item, key));
    }
    if (value && typeof value === 'object') {
      const copy = {};
      for (const [key, item] of Object.entries(value)) {
        copy[key] = this.safeResponse(item, key);
      }
      return copy;
    }
    return value;
  }

  isErrorField(key) {
    return ['error', 'failure', 'message', 'details'].includes(key);
  }
}
