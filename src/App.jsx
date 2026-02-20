import { useState, useCallback } from 'react';
import { fetchOrdersReport, fetchCurrencyRates, fetchCurrencies } from './api';
import { getDateRange, getToday, addMonths } from './utils/dateUtils';
import './App.css';

const TARGET_CURRENCY = 'EUR';
const SUPPORTED_CURRENCIES = ['UAH', 'USD', 'EUR', 'KZT'];
const AUTH_PASSWORD = 'd638d071a20';
const AUTH_KEY = 'gto_dashboard_auth';

function formatNumber(num, decimals = 0) {
  const rounded = Number(num).toFixed(decimals);
  const [intPart, decPart] = rounded.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart ? `${formatted},${decPart}` : formatted;
}

function buildCurrencyIdMap(currencies) {
  const idToCode = {};
  const codeToId = {};
  
  currencies.forEach((c) => {
    const id = String(c.id);
    const code = c.code?.toUpperCase();
    if (id && code) {
      idToCode[id] = code;
      codeToId[code] = id;
    }
  });
  
  return { idToCode, codeToId };
}

function buildRatesMap(rates, idToCode) {
  const map = { EUR: 1 };
  
  // Храним все пары для расчёта кросс-курсов
  const pairsToUah = {}; // X → UAH (сколько UAH за 1 X)
  
  console.log('ID → Code mapping:', idToCode);
  
  rates.forEach((r) => {
    const fromId = String(r.currency_from);
    const toId = String(r.currency_to);
    const fromCode = idToCode[fromId];
    const toCode = idToCode[toId];
    
    if (!fromCode || !toCode) return;
    
    // Прямая пара X → EUR
    if (toCode === TARGET_CURRENCY) {
      map[fromCode] = r.value_to / r.value_from;
      console.log(`${fromCode} → EUR: ${r.value_from} ${fromCode} = ${r.value_to} EUR → rate = ${map[fromCode]}`);
    } else if (fromCode === TARGET_CURRENCY) {
      map[toCode] = r.value_from / r.value_to;
      console.log(`EUR → ${toCode}: ${r.value_from} EUR = ${r.value_to} ${toCode} → rate = ${map[toCode]}`);
    }
    
    // Сохраняем пары к UAH для кросс-курсов
    if (toCode === 'UAH') {
      // X → UAH: 100 X = Y UAH → 1 X = Y/100 UAH
      pairsToUah[fromCode] = r.value_to / r.value_from;
    }
  });
  
  // Рассчитываем кросс-курсы через UAH
  const eurToUah = pairsToUah['EUR'];
  if (eurToUah) {
    console.log(`EUR → UAH rate: 1 EUR = ${eurToUah} UAH`);
    
    SUPPORTED_CURRENCIES.forEach((curr) => {
      if (!map[curr] && pairsToUah[curr]) {
        // X → UAH → EUR
        // 1 X = pairsToUah[X] UAH
        // 1 EUR = eurToUah UAH
        // 1 X = pairsToUah[X] / eurToUah EUR
        map[curr] = pairsToUah[curr] / eurToUah;
        console.log(`${curr} → EUR (через UAH): 1 ${curr} = ${pairsToUah[curr]} UAH = ${map[curr]} EUR`);
      }
    });
  }
  
  // Проверяем наличие всех валют
  SUPPORTED_CURRENCIES.forEach((curr) => {
    if (!map[curr]) {
      console.warn(`Курс для ${curr} не найден в API`);
    }
  });
  
  return map;
}

function convertToEur(amount, currency, ratesMap) {
  if (!amount || !currency) return amount || 0;
  if (currency === TARGET_CURRENCY || currency === 'EUR') return amount;
  const rate = ratesMap[currency] ?? ratesMap[currency?.toUpperCase()];
  if (!rate) {
    console.warn(`No rate for currency: ${currency}`);
    return amount;
  }
  return amount * rate;
}

function getGroupKey(dateStr, groupBy) {
  if (!dateStr) return 'unknown';
  const [year, month] = dateStr.split('-');
  switch (groupBy) {
    case 'day':
      return dateStr;
    case 'month':
      return `${year}-${month}`;
    case 'quarter': {
      const q = Math.ceil(parseInt(month) / 3);
      return `${year}-Q${q}`;
    }
    case 'year':
      return year;
    default:
      return dateStr;
  }
}

function regroupData(rawData, groupBy) {
  const grouped = {};
  
  rawData.forEach((row) => {
    const key = getGroupKey(row.date, groupBy);
    if (!grouped[key]) {
      grouped[key] = { pax: 0, sales: 0, cost: 0, orders: 0 };
    }
    grouped[key].pax += row.pax;
    grouped[key].sales += row.sales;
    grouped[key].cost += row.cost;
    grouped[key].orders += row.orders;
  });
  
  return Object.entries(grouped)
    .map(([date, vals]) => ({
      date,
      pax: vals.pax,
      sales: vals.sales,
      cost: vals.cost,
      profit: vals.sales - vals.cost,
      profitPerPax: vals.pax > 0 ? (vals.sales - vals.cost) / vals.pax : 0,
      orders: vals.orders
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseOrdersReportResponse(json, ratesMap, dateField) {
  const data = json.data ?? json;
  
  if (!data) return null;

  if (Array.isArray(data) && data.length > 0) {
    let pax = 0;
    let totalSales = 0;
    let totalCost = 0;
    
    // Группировка по датам
    const byDate = {};
    
    data.forEach((row) => {
      const currency = row.balance_currency || 'EUR';
      const sell = parseFloat(row.sell) || 0;
      const buy = parseFloat(row.buy) || 0;
      const rowPax = parseFloat(row.number_of_pax) || 0;
      
      const sellEur = convertToEur(sell, currency, ratesMap);
      const buyEur = convertToEur(buy, currency, ratesMap);
      
      pax += rowPax;
      totalSales += sellEur;
      totalCost += buyEur;
      
      // Группировка по дате
      const date = dateField === 'date_start' 
        ? row.date_start 
        : (row.created_date || (row.created_at || '').split(' ')[0]);
      
      if (date) {
        if (!byDate[date]) {
          byDate[date] = { pax: 0, sales: 0, cost: 0, orders: 0 };
        }
        byDate[date].pax += rowPax;
        byDate[date].sales += sellEur;
        byDate[date].cost += buyEur;
        byDate[date].orders += 1;
      }
    });
    
    // Преобразуем в массив и сортируем по дате
    const byDateArray = Object.entries(byDate)
      .map(([date, vals]) => ({
        date,
        pax: vals.pax,
        sales: vals.sales,
        cost: vals.cost,
        profit: vals.sales - vals.cost,
        profitPerPax: vals.pax > 0 ? (vals.sales - vals.cost) / vals.pax : 0,
        orders: vals.orders
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    const totalProfit = totalSales - totalCost;
    
    return {
      pax,
      totalSales,
      totalCost,
      totalProfit,
      profitPerPax: pax > 0 ? totalProfit / pax : 0,
      ordersCount: data.length,
      byDate: byDateArray
    };
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    const currency = data.balance_currency || 'EUR';
    const sales = convertToEur(parseFloat(data.sell) || 0, currency, ratesMap);
    const cost = convertToEur(parseFloat(data.buy) || 0, currency, ratesMap);
    const rowPax = parseFloat(data.number_of_pax) || 0;
    const profit = sales - cost;
    return {
      pax: rowPax,
      totalSales: sales,
      totalCost: cost,
      totalProfit: profit,
      profitPerPax: rowPax > 0 ? profit / rowPax : 0,
      ordersCount: 1,
      byDate: []
    };
  }

  return null;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem(AUTH_KEY) === 'true';
  });
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [mode, setMode] = useState('date_start');
  const [periodType, setPeriodType] = useState('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(getToday());
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState(null);
  const [ordersCount, setOrdersCount] = useState(0);
  const [byDate, setByDate] = useState([]);
  const [rawByDate, setRawByDate] = useState([]);
  const [groupBy, setGroupBy] = useState('day');
  const [ratesInfo, setRatesInfo] = useState(null);

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === AUTH_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, 'true');
      setIsAuthenticated(true);
      setAuthError('');
    } else {
      setAuthError('Неверный пароль');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
    setPassword('');
  };

  const handleGroupByChange = (newGroupBy) => {
    setGroupBy(newGroupBy);
    if (rawByDate.length > 0) {
      setByDate(regroupData(rawByDate, newGroupBy));
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadingStep('');
    setError(null);
    setTotals(null);
    setByDate([]);
    setRatesInfo(null);

    try {
      const { dateFrom, dateTo } = getDateRange(mode, periodType, customFrom, customTo);
      const sortBy = mode === 'date_start' ? 'date_start' : 'created_at';
      const status = mode === 'date_start' ? 'CNF' : 'actual';

      // ШАГ 1: Загружаем справочник валют
      setLoadingStep('Шаг 1/3: Загрузка справочника валют...');
      let idToCode = {};
      
      try {
        const currencies = await fetchCurrencies();
        console.log('=== СПРАВОЧНИК ВАЛЮТ ===');
        console.log('Все валюты:', JSON.stringify(currencies, null, 2));
        
        const maps = buildCurrencyIdMap(currencies);
        idToCode = maps.idToCode;
        
        console.log('ID → Code:', idToCode);
      } catch (e) {
        console.error('Ошибка загрузки справочника валют:', e);
      }

      // ШАГ 2: Загружаем курсы валют на сегодня
      setLoadingStep('Шаг 2/3: Загрузка курсов валют (UAH, USD, EUR, KZT)...');
      let ratesMap = { EUR: 1 };
      const today = getToday();
      
      try {
        const rates = await fetchCurrencyRates(today);
        
        console.log('=== КУРСЫ ВАЛЮТ: RAW API RESPONSE ===');
        console.log('Дата запроса:', today);
        console.log('Всего записей:', rates.length);
        console.log('Все курсы из API:', JSON.stringify(rates, null, 2));
        
        ratesMap = buildRatesMap(rates, idToCode);
        
        console.log('=== ИТОГОВАЯ КАРТА КУРСОВ (к EUR) ===');
        console.log('UAH → EUR:', ratesMap.UAH || 'НЕ НАЙДЕН');
        console.log('USD → EUR:', ratesMap.USD || 'НЕ НАЙДЕН');
        console.log('KZT → EUR:', ratesMap.KZT || 'НЕ НАЙДЕН');
        console.log('EUR → EUR:', ratesMap.EUR);
        console.log('Полная карта:', ratesMap);
        
        // Сохраняем информацию о курсах для отображения
        setRatesInfo({
          date: today,
          rates: {
            UAH: ratesMap.UAH || null,
            USD: ratesMap.USD || null,
            KZT: ratesMap.KZT || null,
            EUR: 1
          }
        });
      } catch (e) {
        console.error('=== ОШИБКА ЗАГРУЗКИ КУРСОВ ===');
        console.error('Ошибка:', e.message);
        console.error('Полная ошибка:', e);
        setRatesInfo({ date: today, rates: { EUR: 1 }, error: true });
      }

      // ШАГ 3: Загружаем заказы
      setLoadingStep('Шаг 3/3: Загрузка заказов...');
      console.log(`Шаг 2: Загрузка заказов за период ${dateFrom} — ${dateTo}`);
      
      const json = await fetchOrdersReport({
        dateFrom,
        dateTo,
        sortBy,
        status
      });

      if (mode === 'date_created') {
        const rows = json.data ?? json;
        if (Array.isArray(rows)) {
          const filtered = rows.filter((o) => (o.status || '').toUpperCase() !== 'CNX');
          json.data = filtered;
        }
      }

      const dateField = mode === 'date_start' ? 'date_start' : 'created_at';
      const parsed = parseOrdersReportResponse(json, ratesMap, dateField);

      if (!parsed) {
        setTotals({ pax: 0, totalSales: 0, totalCost: 0, totalProfit: 0, profitPerPax: 0 });
        setOrdersCount(0);
        setByDate([]);
        setLoading(false);
        return;
      }

      setTotals({
        pax: parsed.pax,
        totalSales: parsed.totalSales,
        totalCost: parsed.totalCost,
        totalProfit: parsed.totalProfit,
        profitPerPax: parsed.profitPerPax
      });
      setOrdersCount(parsed.ordersCount || 0);
      const raw = parsed.byDate || [];
      setRawByDate(raw);
      setByDate(regroupData(raw, groupBy));
    } catch (err) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [mode, periodType, customFrom, customTo]);

  const { dateFrom, dateTo } = getDateRange(mode, periodType, customFrom, customTo);

  if (!isAuthenticated) {
    return (
      <div className="app">
        <div className="login-container">
          <div className="login-box">
            <h1>GTO Sales Dashboard</h1>
            <p className="subtitle">Введите пароль для доступа</p>
            <form onSubmit={handleLogin}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                className="login-input"
                autoFocus
              />
              <button type="submit" className="login-btn">Войти</button>
              {authError && <p className="login-error">{authError}</p>}
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>GTO Sales Dashboard</h1>
        <p className="subtitle">Аналитика продаж за выбранный период</p>
        <button onClick={handleLogout} className="logout-btn">Выйти</button>
      </header>

      <section className="controls">
        <div className="control-group">
          <span className="label">Базис даты:</span>
          <div className="switch-row">
            <button
              className={`switch-btn ${mode === 'date_start' ? 'active' : ''}`}
              onClick={() => setMode('date_start')}
            >
              Date Start
            </button>
            <button
              className={`switch-btn ${mode === 'date_created' ? 'active' : ''}`}
              onClick={() => setMode('date_created')}
            >
              Date Created
            </button>
          </div>
          <small>
            {mode === 'date_start' && 'Только confirmed'}
            {mode === 'date_created' && 'Все статусы кроме cancelled'}
          </small>
        </div>

        <div className="control-group">
          <span className="label">Период:</span>
          <div className="period-buttons">
            <button
              className={periodType === 'week' ? 'active' : ''}
              onClick={() => setPeriodType('week')}
            >
              Week
            </button>
            <button
              className={periodType === 'month' ? 'active' : ''}
              onClick={() => setPeriodType('month')}
            >
              Month
            </button>
            <button
              className={periodType === 'year' ? 'active' : ''}
              onClick={() => setPeriodType('year')}
            >
              Year
            </button>
            <button
              className={periodType === 'custom' ? 'active' : ''}
              onClick={() => setPeriodType('custom')}
            >
              Свой период
            </button>
          </div>
        </div>

        {periodType === 'custom' && (
          <div className="control-group date-range">
            <label>
              <span>От:</span>
              <input
                type="date"
                value={customFrom || addMonths(getToday(), -12)}
                onChange={(e) => setCustomFrom(e.target.value)}
                onClick={(e) => e.target.showPicker?.()}
              />
            </label>
            <label>
              <span>До:</span>
              <input
                type="date"
                value={customTo || getToday()}
                onChange={(e) => setCustomTo(e.target.value)}
                onClick={(e) => e.target.showPicker?.()}
              />
            </label>
          </div>
        )}

        <div className="range-info">
          Период: {dateFrom} — {dateTo}
        </div>

        <button
          className="load-btn"
          onClick={loadData}
          disabled={
            loading ||
            (periodType === 'custom' && (!customFrom || !customTo))
          }
        >
          {loading ? 'Загрузка…' : 'Загрузить данные'}
        </button>
        
        {loading && loadingStep && (
          <div className="loading-step">{loadingStep}</div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      {ratesInfo && (
        <section className="rates-info">
          <h3>Курсы валют на {ratesInfo.date}</h3>
          {ratesInfo.error ? (
            <p className="rates-error">Не удалось загрузить курсы, используется EUR = 1</p>
          ) : (
            <div className="rates-grid">
              <div className="rate-item">
                <span className="rate-currency">UAH → EUR</span>
                <span className="rate-value">{ratesInfo.rates.UAH ? ratesInfo.rates.UAH.toFixed(6) : 'н/д'}</span>
              </div>
              <div className="rate-item">
                <span className="rate-currency">USD → EUR</span>
                <span className="rate-value">{ratesInfo.rates.USD ? ratesInfo.rates.USD.toFixed(6) : 'н/д'}</span>
              </div>
              <div className="rate-item">
                <span className="rate-currency">KZT → EUR</span>
                <span className="rate-value">{ratesInfo.rates.KZT ? ratesInfo.rates.KZT.toFixed(6) : 'н/д'}</span>
              </div>
              <div className="rate-item">
                <span className="rate-currency">EUR</span>
                <span className="rate-value">1.000000</span>
              </div>
            </div>
          )}
        </section>
      )}

      {totals && (
        <section className="results">
          <h2>Итоги{ordersCount > 0 ? ` (${ordersCount} заказов)` : ''}</h2>
          <div className="cards">
            <div className="card">
              <span className="card-label">PAX</span>
              <span className="card-value">{totals.pax}</span>
            </div>
            <div className="card">
              <span className="card-label">Total Sales (EUR)</span>
              <span className="card-value">{formatNumber(totals.totalSales)}</span>
            </div>
            <div className="card">
              <span className="card-label">Total Cost (EUR)</span>
              <span className="card-value">{formatNumber(totals.totalCost)}</span>
            </div>
            <div className="card">
              <span className="card-label">Total Profit (EUR)</span>
              <span className={`card-value ${totals.totalProfit >= 0 ? 'positive' : 'negative'}`}>
                {formatNumber(totals.totalProfit)}
              </span>
            </div>
            <div className="card">
              <span className="card-label">Profit per PAX (EUR)</span>
              <span className={`card-value ${totals.profitPerPax >= 0 ? 'positive' : 'negative'}`}>
                {formatNumber(totals.profitPerPax, 2)}
              </span>
            </div>
          </div>
        </section>
      )}

      {byDate.length > 0 && (
        <section className="results">
          <div className="table-header">
            <h2>По периодам</h2>
            <div className="group-buttons">
              <button
                className={groupBy === 'day' ? 'active' : ''}
                onClick={() => handleGroupByChange('day')}
              >
                День
              </button>
              <button
                className={groupBy === 'month' ? 'active' : ''}
                onClick={() => handleGroupByChange('month')}
              >
                Месяц
              </button>
              <button
                className={groupBy === 'quarter' ? 'active' : ''}
                onClick={() => handleGroupByChange('quarter')}
              >
                Квартал
              </button>
              <button
                className={groupBy === 'year' ? 'active' : ''}
                onClick={() => handleGroupByChange('year')}
              >
                Год
              </button>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Период</th>
                  <th>Заказов</th>
                  <th>PAX</th>
                  <th>Sales (EUR)</th>
                  <th>Cost (EUR)</th>
                  <th>Profit (EUR)</th>
                  <th>Profit/PAX</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{row.orders}</td>
                    <td>{row.pax}</td>
                    <td>{formatNumber(row.sales)}</td>
                    <td>{formatNumber(row.cost)}</td>
                    <td className={row.profit >= 0 ? 'positive' : 'negative'}>
                      {formatNumber(row.profit)}
                    </td>
                    <td className={row.profitPerPax >= 0 ? 'positive' : 'negative'}>
                      {formatNumber(row.profitPerPax, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
