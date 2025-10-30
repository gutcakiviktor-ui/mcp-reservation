// netlify/functions/create-session.js
import Stripe from 'stripe';

const CORS = () => ({
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

const EUR = v => Math.round(v * 100); // cents

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    const body = JSON.parse(event.body || '{}');

    const {
      lodgingType = 'apartment',
      startDate, endDate,
      adults = 2, children = 0, babies = 0,
      customerEmail = '', customerName = ''
    } = body;

    // --- тарифы (как мы договаривались) ---
    const BASE_APT = 60;
    const BASE_HOUSE = 210;
    const EXTRA_GUEST_PER_NIGHT = 15;
    const CLEANING_HOUSE = 50;
    const TAXE_PER_PERSON_PER_NIGHT = 1.2;

    // (сезоны можно добавить позже)
    const SEASONS = []; // [{from:'2025-06-01', to:'2025-08-31', apt:80, house:260}]

    const parse = s => new Date(s + 'T00:00:00');
    const MS = 86400000;
    const d0 = parse(startDate);
    const d1 = parse(endDate);
    const nights = Math.max(0, Math.round((d1 - d0) / MS));
    if (!startDate || !endDate || nights <= 0) {
      return { statusCode: 400, headers: CORS(), body: JSON.stringify({ error: 'Invalid dates' }) };
    }

    const today = new Date(); today.setHours(0,0,0,0);
    const daysUntil = Math.round((d0 - today) / MS);
    const isLastMinute = daysUntil <= 7;

    const rateFor = (date, type) => {
      const ymd = date.toISOString().slice(0,10);
      const s = SEASONS.find(x => ymd >= x.from && ymd <= x.to);
      return (type === 'house' ? (s?.house ?? BASE_HOUSE) : (s?.apt ?? BASE_APT));
    };

    let lodgingTotal = 0;
    for (let i = 0; i < nights; i++) {
      lodgingTotal += rateFor(new Date(d0.getTime() + i * MS), lodgingType);
    }

    const payingGuests = Math.max(0, adults + children); // bébés gratuits
    const extraGuests = Math.max(0, payingGuests - 2);
    const extraTotal = extraGuests * EXTRA_GUEST_PER_NIGHT * nights;
    const cleaning = lodgingType === 'house' ? CLEANING_HOUSE : 0;
    const taxe = TAXE_PER_PERSON_PER_NIGHT * payingGuests * nights;
    const lodgingPlus = lodgingTotal + extraTotal + cleaning;

    let lineItems = [];
    if (isLastMinute) {
      lineItems = [
        { name: 'Hébergement (100% last minute)', amount: EUR(lodgingPlus) },
        { name: 'Taxe de séjour', amount: EUR(taxe) },
      ];
    } else {
      const acompte = 0.5 * lodgingPlus;
      lineItems = [{ name: 'Acompte 50% (hébergement+ménage)', amount: EUR(acompte) }];
    }

    const toStripeItems = arr => arr
      .filter(x => x.amount > 0)
      .map(x => ({
        price_data: {
          currency: 'eur',
          product_data: { name: x.name },
          unit_amount: x.amount
        },
        quantity: 1
      }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: toStripeItems(lineItems),
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
      customer_email: customerEmail || undefined,
      metadata: {
        lodgingType,
        startDate, endDate,
        adults: String(adults),
        children: String(children),
        babies: String(babies),
        nights: String(nights),
        lastMinute: isLastMinute ? 'yes' : 'no'
      }
    });

    return { statusCode: 200, headers: CORS(), body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS(), body: JSON.stringify({ error: e.message || 'Server error' }) };
  }
}

