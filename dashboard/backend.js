(function attachBackendConfig() {
  const DEFAULT_REMOTE_API = 'https://kshana.onrender.com';

  function normalizeApiBase(value) {
    if (!value) return '';

    let trimmed = String(value).trim().replace(/\/+$/, '');
    if (!trimmed) return '';

    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = `http://${trimmed}`;
    }

    try {
      const url = new URL(trimmed);
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  function getSameOriginApi() {
    if (!window.location || !/^https?:$/i.test(window.location.protocol)) {
      return '';
    }

    return normalizeApiBase(window.location.origin);
  }

  function getStoredApiBase() {
    const params = new URLSearchParams(window.location.search);

    return normalizeApiBase(
      sessionStorage.getItem('apiBase') ||
      localStorage.getItem('apiBase') ||
      params.get('api')
    );
  }

  function unique(values) {
    const seen = new Set();

    return values.filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function getApiCandidates(preferredBase) {
    return unique([
      normalizeApiBase(preferredBase),
      getStoredApiBase(),
      getSameOriginApi(),
      normalizeApiBase(DEFAULT_REMOTE_API),
    ]);
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return { ok: res.ok, msg: text };
    }
  }

  async function fetchJson(base, path, opts) {
    const normalizedBase = normalizeApiBase(base);
    if (!normalizedBase) {
      return { ok: false, status: 0, data: null, error: new Error('Missing API base'), base: '' };
    }

    const options = opts || {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    try {
      const res = await fetch(`${normalizedBase}${path}`, {
        ...options,
        headers: { ...(options.headers || {}) },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await parseJsonResponse(res);
      return { ok: res.ok, status: res.status, data, base: normalizedBase };
    } catch (error) {
      clearTimeout(timeout);
      return { ok: false, status: 0, data: null, error, base: normalizedBase };
    }
  }

  function persistApiBase(base) {
    const normalizedBase = normalizeApiBase(base);
    if (!normalizedBase) return;

    sessionStorage.setItem('apiBase', normalizedBase);
    localStorage.setItem('apiBase', normalizedBase);
  }

  async function findWorkingApi(config) {
    const settings = config || {};
    const candidates = getApiCandidates(settings.preferredBase);

    for (const base of candidates) {
      const result = await fetchJson(base, settings.path || '/', settings.options);
      const isValid = typeof settings.validate === 'function' ? settings.validate(result) : result.ok;

      if (isValid) {
        persistApiBase(result.base);
        return result;
      }
    }

    return null;
  }

  window.BackendConfig = {
    defaultApi: getStoredApiBase() || getSameOriginApi() || normalizeApiBase(DEFAULT_REMOTE_API),
    fetchJson,
    findWorkingApi,
    getApiCandidates,
    normalizeApiBase,
    persistApiBase,
  };
})();
