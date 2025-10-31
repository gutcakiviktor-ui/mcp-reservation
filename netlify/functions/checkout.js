// netlify/functions/create-session.js
// Без SDK Stripe. Делаем REST-запрос через fetch.
const CORS = () => ({
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});
const EUR = v => Math.round(v * 100); // в центы

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      lodging,            // 'apartment' | 'house'
      nights,             // число ночей
      extraGuests = 0,    // доп. гости > 2
      cityTaxTotal = 0,   // taxe de séjour (в евро) на весь период
      payMode = 'deposit' // 'deposit' | 'balance' | 'full'
    } = JSON.parse(event.body || '{}');

    // Базовые ставки
    const base = lodging === 'house' ? 210 : 60;
    const cleaning = lodging === 'house' ? 50 : 0; // разово
    const extra = 15 * extraGuests * nights;

    const subtotal = base * nights + extra + cleaning;
    let toPay = subtotal;
    if (payMode === 'deposit') toPay = subtotal * 0.5;
    if (payMode === 'balance') toPay = subtotal * 0.5 + cityTaxTotal;
    if (payMode === 'full') toPay = subtotal + cityTaxTotal;

    const name =
      payMode === 'deposit' ? 'Acompte réservation'
      : payMode === 'balance' ? 'Solde + taxe de séjour'
      : 'Paiement total (hébergement + taxe)';

    // Формируем тело для Stripe (x-www-form-urlencoded)
    const p = new URLSearchParams();
    p.append('mode', 'payment');
    p.append('success_url', process.env.SUCCESS_URL);
    p.append('cancel_url', process.env.CANCEL_URL);
    p.append('line_items[0][quantity]', '1');
    p.append('line_items[0][price_data][currency]', 'eur');
    p.append('line_items[0][price_data][unit_amount]', String(EUR(toPay)));
    p.append('line_items[0][price_data][product_data][name]', name);

    // (необязательно) метаданные
    p.append('metadata[lodging]', String(lodging));
    p.append('metadata[nights]', String(nights));
    p.append('metadata[extra_guests]', String(extraGuests));
    p.append('metadata[city_tax_total]', String(cityTaxTotal));
    p.append('metadata[pay_mode]', String(payMode));

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: p.toString(),
    });

    const data = await resp.json();
    if (!resp.ok) {
      // Пробрасываем текст ошибки Stripe
      const err = data && data.error ? data.error.message : 'Stripe error';
      return { statusCode: 400, headers: CORS(), body: JSON.stringify({ error: err }) };
    }

    return { statusCode: 200, headers: CORS(), body: JSON.stringify({ url: data.url }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS(), body: JSON.stringify({ error: e.message || 'Internal error' }) };
  }
};



