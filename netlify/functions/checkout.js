// /.netlify/functions/checkout
const CORS = () => ({
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});
const EUR = v => Math.round(v * 100); // в центы

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const data = JSON.parse(event.body || '{}');
    const {
      amountToPay, description = 'Acompte réservation',
      successUrl = process.env.SUCCESS_URL,
      cancelUrl = process.env.CANCEL_URL,
    } = data;

    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
    if (!successUrl || !cancelUrl) throw new Error('Missing SUCCESS_URL or CANCEL_URL');
    if (!amountToPay || amountToPay <= 0) throw new Error('Bad amount');

    // создаём Checkout Session через REST API
    const form = new URLSearchParams();
    form.append('mode','payment');
    form.append('success_url', successUrl + '?session_id={CHECKOUT_SESSION_ID}');
    form.append('cancel_url', cancelUrl);
    form.append('line_items[0][price_data][currency]','eur');
    form.append('line_items[0][price_data][product_data][name]', description);
    form.append('line_items[0][price_data][unit_amount]', String(EUR(amountToPay)));
    form.append('line_items[0][quantity]','1');
    form.append('payment_method_types[]','card');

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });

    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error?.message || 'Stripe error');
    return { statusCode: 200, headers: { ...CORS(), 'Content-Type':'application/json' }, body: JSON.stringify({ url: json.url }) };
  } catch (e) {
    return { statusCode: 400, headers: { ...CORS(), 'Content-Type':'application/json' }, body: JSON.stringify({ error: String(e.message || e) }) };
  }
}




