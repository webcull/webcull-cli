import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

export class ApiClient {
  constructor({ apiUrl, tokenStore, client = 'cli', signal }) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.tokenStore = tokenStore;
    this.client = client;
    this.signal = signal;
  }

  async post(path, data = {}, { auth = false, authToken = null } = {}) {
    this.signal?.throwIfAborted();
    const url = new URL(path.replace(/^\/cli\//, '/' + this.client + '/'), this.apiUrl);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        body.set(key, String(value));
      }
    }
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'webcull-' + this.client
    };
    if (auth || authToken) {
      const token = authToken || await this.tokenStore.requireToken();
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
        signal: this.signal,
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(options.body)
        }
      }, res => {
        const chunks = [];
        let bytes = 0;
        res.on('error', reject);
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) {
            res.destroy(new Error('WebCull API response is too large.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          let buffer = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
          try {
            if (encoding.includes('gzip')) {
              buffer = zlib.gunzipSync(buffer, { maxOutputLength: 8 * 1024 * 1024 });
            } else if (encoding.includes('deflate')) {
              buffer = zlib.inflateSync(buffer, { maxOutputLength: 8 * 1024 * 1024 });
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
          const responseError = this.responseError(parsed, res.statusCode);
          if (responseError) {
            reject(responseError);
            return;
          }
          resolve(parsed);
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('WebCull API request timed out. A submitted write may have completed; check before retrying.')));
      req.write(options.body);
      req.end();
    });
  }

  safeMessage(message) {
    return String(message || '')
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
      .replace(/wco_cli_[A-Za-z0-9_-]+/g, '[redacted-cli-token]');
  }

  structuredError(response, fallbackMessage) {
    const safe = this.safeResponse(response, null);
    const error = new Error(this.safeMessage(safe.failure || safe.error || fallbackMessage));
    error.cliResponse = safe;
    return error;
  }

  responseError(parsed, statusCode) {
    if (parsed && ['request_busy', 'request_lock_unavailable'].includes(parsed.code)) {
      return this.structuredError(parsed, 'WebCull CLI request coordination failed.');
    }
    if (parsed && (parsed.code === 'throttled' || parsed.error === 'throttled')) {
      const retry = parsed.retry_after_seconds ? Number(parsed.retry_after_seconds) : 60;
      const throttle = parsed.throttle ? ' ' + parsed.throttle : '';
      const failure = 'WebCull CLI' + throttle + ' limit reached. Wait at least ' + retry + ' seconds, then retry with a narrower request.';
      return this.structuredError({
        ...parsed,
        success: 'false',
        failure,
        code: 'throttled',
        retry_after_seconds: retry
      }, failure);
    }
    if (statusCode < 200 || statusCode >= 300) {
      const failure = this.safeMessage(parsed?.failure || parsed?.error || 'WebCull API request failed.');
      return parsed && parsed.code
        ? this.structuredError(parsed, failure)
        : new Error(failure);
    }
    return null;
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
