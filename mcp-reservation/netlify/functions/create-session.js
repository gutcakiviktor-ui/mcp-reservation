// netlify/functions/create-session.js
import Stripe from 'stripe';

export default async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).send('');
  }
  if (req.method !== 'POST') return res.status(404).json({ error: 'Not found' });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    const { lodgingType='apartment', startDate, endDate, adults=2, children=0, babies=0, customerEmail='', customerName='' } = req.body || {};

    const BASE_APT = 60, BASE_HOUSE = 210, EXTRA_GUEST_PER_NIGHT = 15, CLEANING_HOUSE = 50, TAXE_PER_PERSON_PER_NIGHT = 1.2;
    const SEASONS = []; // можно заполнить позже

    const parse = s => new Date(s+'T00:00:00'); const MS = 86400000;
    const d0 = parse(startDate), d1 = parse(endDate); const nights = Math.max(0, Math.round((d1-d0)/MS));
    if (nights<=0) return res.status(400).json({ error:'Invalid dates' });

    const today = new Date(); today.setHours(0,0,0,0);
    const daysUntil = Math.round((d0 - today)/MS); const isLastMinute = daysUntil <= 7;

    const rateFor = (date, type) => {
      const ymd = date.toISOString().slice(0,10);
      const s = SEASONS.find(x => ymd >= x.from && ymd <= x.to);
      return (type==='house' ? (s?.house ?? BASE_HOUSE) : (s?.apt ?? BASE_APT));
    };

    let lodgingTotal = 0;
    for (let i=0;i<nights;i++){ lodgingTotal += rateFor(new Date(d0.getTime()+i*MS), lodgingType); }

    const payingGuests = Math.max(0, adults + children); // bébés gratuits
    const extraGuests = Math.max(0, payingGuests - 2);
    const extraTotal = extraGuests * EXTRA_GUEST_PER_NIGHT * nights;
    const cleaning = lodgingType==='house' ? CLEANING_HOUSE : 0;
    const taxe = TAXE_PER_PERSON_PER_NIGHT * payingGuests * nights;
    const lodgingPlus = lodgingTotal + extraTotal + cleaning;

    let lineItems = [];
    if (isLastMinute) {
      lineItems = [
        { name:'Hébergement (100% last minute)', amount: Math.round((lodgingTotal + extraTotal + cleaning)*100) },
        { name:'Taxe de séjour', amount: Math.round(taxe*100) },
      ];
    } else {
      const acompte = 0.5 * lodgingPlus;
      lineItems = [{ name:'Acompte 50% (hébergement+ménage)', amount: Math.round(acompte*100) }];
    }

    const toItems = arr => arr.filter(x=>x.amount>0).map(x=>({
      price_data:{ currency:'eur', product_data:{ name:x.name }, unit_amount:x.amount }, quantity:1
    }));

    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      line_items: toItems(lineItems),
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
      customer_email: customerEmail || undefined,
      metadata:{
        lodgingType, startDate, endDate,
        adults:String(adults), children:String(children), babies:String(babies),
        nights:String(nights), lastMinute: isLastMinute?'yes':'no'
      }
    });

    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGINS || '*');
    res.json({ url: session.url });
  } catch(e){ res.status(500).json({ error: e.message || 'Server error' }); }
};
