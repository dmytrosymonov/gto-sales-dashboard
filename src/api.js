const API_KEY_ORDERS = '552a67bc467';
const API_KEY_CURRENCY = 'd638d071a20';
const API_BASE = window.location.origin;
const API_V3 = `${API_BASE}/api/v3`;
const API_PRIVATE = `${API_BASE}/api/private/`;

const CACHE_PREFIX = 'gto_cache_';
const CURRENCY_CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours in ms

function getCacheKey(params) {
  return CACHE_PREFIX + JSON.stringify(params);
}

function getFromCache(key, maxAge = null) {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      
      // Check TTL if maxAge is specified
      if (maxAge && parsed._cachedAt) {
        const age = Date.now() - parsed._cachedAt;
        if (age > maxAge) {
          console.log(`[Cache EXPIRED] ${key.replace(CACHE_PREFIX, '')} (age: ${Math.round(age/1000/60)}min)`);
          localStorage.removeItem(key);
          return null;
        }
      }
      
      console.log(`[Cache HIT] ${key.replace(CACHE_PREFIX, '')}`);
      return parsed;
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }
  return null;
}

function saveToCache(key, data, withTimestamp = false) {
  try {
    const toSave = withTimestamp ? { ...data, _cachedAt: Date.now() } : data;
    localStorage.setItem(key, JSON.stringify(toSave));
    console.log(`[Cache SAVE] ${key.replace(CACHE_PREFIX, '')}`);
  } catch (e) {
    console.warn('Cache write error (storage full?):', e);
    clearOldCache();
  }
}

function clearOldCache() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
  if (keys.length > 50) {
    keys.slice(0, 25).forEach(k => localStorage.removeItem(k));
    console.log('Cleared old cache entries');
  }
}

function isHistoricalDate(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  return dateStr < today;
}

function buildUrl(base, path, params = {}, apiKey = API_KEY_ORDERS) {
  const url = new URL(path, base.endsWith('/') ? base : base + '/');
  url.searchParams.set('apikey', apiKey);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

async function parseJsonResponse(res, url) {
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(
      `API вернул HTML вместо JSON (возможно endpoint не найден или ошибка). Ответ: ${preview}...`
    );
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Невалидный JSON от API. Ответ: ${text.slice(0, 150)}...`);
  }
}

/**
 * Orders Report API (PowerBI / Private) с пагинацией и кэшированием
 * @see https://docs.google.com/document/d/1lwxPBMRXlkH1akD9deAR98Px-Y0oe288
 */
export async function fetchOrdersReport({ dateFrom, dateTo, sortBy, status, onProgress }) {
  const cacheParams = { type: 'orders_report', dateFrom, dateTo, sortBy, status };
  const cacheKey = getCacheKey(cacheParams);
  
  // Проверяем кэш только для исторических данных (dateTo в прошлом)
  const canUseCache = isHistoricalDate(dateTo);
  
  if (canUseCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      if (onProgress) {
        onProgress({ page: 0, loaded: cached.data.length, pageSize: 0, fromCache: true });
      }
      return cached;
    }
  }

  const perPage = 1000;
  let page = 1;
  let allData = [];
  
  while (true) {
    const params = {
      date_from: dateFrom,
      date_to: dateTo,
      sort_by: sortBy,
      sort_by_type: 'asc',
      per_page: perPage,
      page: page
    };
    if (status) params.status = status;

    const url = buildUrl(API_PRIVATE, 'orders_report', params);
    const res = await fetch(url);
    const json = await parseJsonResponse(res, url);
    if (!res.ok) throw new Error(`Orders Report API: ${res.status} ${res.statusText}`);
    
    const data = json?.data || [];
    allData = allData.concat(data);
    
    console.log(`Загружена страница ${page}: ${data.length} записей (всего: ${allData.length})`);
    
    if (onProgress) {
      onProgress({ page, loaded: allData.length, pageSize: data.length });
    }
    
    // Если получили меньше чем per_page — это последняя страница
    if (data.length < perPage) {
      break;
    }
    
    page++;
    
    // Защита от бесконечного цикла (макс 100 страниц = 100000 записей)
    if (page > 100) {
      console.warn('Достигнут лимит страниц (100)');
      break;
    }
  }
  
  const result = { data: allData };
  
  // Сохраняем в кэш только исторические данные
  if (canUseCache && allData.length > 0) {
    saveToCache(cacheKey, result);
  }
  
  return result;
}

export async function fetchOrders({ dateFrom, dateTo, sortBy, status }) {
  const params = {
    date_from: dateFrom,
    date_to: dateTo,
    sort_by: sortBy,
    sort_by_type: 'asc',
    per_page: 1000
  };
  if (status) params.status = status;

  const url = buildUrl(API_V3, 'orders', params);
  const res = await fetch(url);
  const json = await parseJsonResponse(res, url);
  if (!res.ok) throw new Error(`Orders API error: ${res.status}`);
  return json?.data || [];
}

export async function fetchOrderInfo(orderId) {
  const url = buildUrl(API_V3, 'order_info', { order_id: orderId });
  const res = await fetch(url);
  const json = await parseJsonResponse(res, url);
  if (!res.ok) throw new Error(`Order info API error: ${res.status}`);
  return json?.data;
}

export async function fetchCurrencyRates(date) {
  const cacheKey = getCacheKey({ type: 'currency_rates', date });
  const cached = getFromCache(cacheKey, CURRENCY_CACHE_TTL);
  if (cached) {
    return cached.data;
  }
  
  const url = buildUrl(API_V3, 'currency_rates', { date }, API_KEY_CURRENCY);
  const res = await fetch(url);
  const json = await parseJsonResponse(res, url);
  if (!res.ok) throw new Error(`Currency rates API error: ${res.status}`);
  
  const data = json?.data || [];
  saveToCache(cacheKey, { data }, true);
  return data;
}

export async function fetchCurrencies() {
  const cacheKey = getCacheKey({ type: 'currencies' });
  const cached = getFromCache(cacheKey, CURRENCY_CACHE_TTL);
  if (cached) {
    return cached.data;
  }
  
  const url = buildUrl(API_V3, 'currencies', {}, API_KEY_CURRENCY);
  const res = await fetch(url);
  const json = await parseJsonResponse(res, url);
  if (!res.ok) throw new Error(`Currencies API error: ${res.status}`);
  
  const data = json?.data || [];
  saveToCache(cacheKey, { data }, true);
  return data;
}
