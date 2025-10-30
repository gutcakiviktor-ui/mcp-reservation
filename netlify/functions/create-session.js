// netlify/functions/create-session.js (CommonJS)
const Stripe = require('stripe');

const CORS = () => ({
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

const EUR = v => Math.round(v * 100); // в центах

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const {
      lodging,            // 'apartment' | 'house'
      nights,             // число ночей
      extraGuests = 0,    // доп. гости > 2
      cityTaxTotal = 0,   // taxe de séjour ИТОГО за весь период
      payMode = 'deposit' // 'deposit' | 'balance' | 'full'
    } = body;

    // БАЗОВЫЕ ТАРИФЫ (€/ночь, 2 гостя)
    const base = lodging === 'house' ? 210 : 60;
    const cleaning = lodging === 'house' ? 50 : 0; // разово за stay
    const extra = 15 * extraGuests * nights;

    const subtotal = base * nights + extra + cleaning;
    let toPay = subtotal;

    if (payMode === 'deposit') toPay = subtotal * 0.5;
    if (payMode === 'balance') toPay = subtotal * 0.5 + cityTaxTotal; // солд + вся taxe
    if (payMode === 'full') toPay = subtotal + cityTaxTotal;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            product_data: {
              name:
                payMode === 'deposit'
                  ? 'Acompte réservation'
                  : payMode === 'balance'
                  ? 'Solde + taxe de séjour'
                  : 'Paiement total (hébergement + taxe)',
            },
            unit_amount: EUR(toPay),
          },
        },
      ],
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
      metadata: {
        lodging,
        nights: String(nights),
        extra_guests: String(extraGuests),
        city_tax_total: String(cityTaxTotal),
        pay_mode: payMode,
      },
    });

    return {
      statusCode: 200,
      headers: CORS(),
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS(),
      body: JSON.stringify({ error: err.message || 'Stripe error' }),
    };
  }
};

