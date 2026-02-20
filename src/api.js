const API_KEY = '552a67bc467';
const API_BASE =
  import.meta.env.DEV
    ? window.location.origin
    : 'https://api.gto.ua';
const API_V3 = `${API_BASE}/api/v3`;
const API_PRIVATE = `${API_BASE}/api/private/`;

function buildUrl(base, path, params = {}) {
  const url = new URL(path, base.endsWith('/') ? base : base + '/');
  url.searchParams.set('apikey', API_KEY);
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
 * Orders Report API (PowerBI / Private) с пагинацией
 * @see https://docs.google.com/document/d/1lwxPBMRXlkH1akD9deAR98Px-Y0oe288
 */
export async function fetchOrdersReport({ dateFrom, dateTo, sortBy, status, onProgress }) {
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
  
  return { data: allData };
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
  const url = buildUrl(API_V3, 'currency_rates', { date });
  const res = await fetch(url);
  const json = await parseJsonResponse(res, url);
  if (!res.ok) throw new Error(`Currency rates API error: ${res.status}`);
  return json?.data || [];
}

export async function fetchCurrencies() {
  const url = buildUrl(API_V3, 'currencies', {});
  const res = await fetch(url);
  const json = await parseJsonResponse(res, url);
  if (!res.ok) throw new Error(`Currencies API error: ${res.status}`);
  return json?.data || [];
}
