const OpenAI = require('openai');
const Performance = require('./performance');
const Attribution = require('./attribution');
const Incrementality = require('./incrementality');
const Activation = require('./activation');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const rangeProps = {
  from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 30 days ago)' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
};

const TOOLS = [
  {
    name: 'get_blended_metrics',
    description: 'Revenue, orders, ad spend, CAC, MER (blended ROAS), new-customer ROAS, POAS (profit on ad spend), AOV, with change vs the previous period and a time series.',
    parameters: { type: 'object', properties: { ...rangeProps, granularity: { type: 'string', enum: ['day', 'week', 'month'] } } },
    run: (storeId, a) => {
      const r = Performance.blended(storeId, a);
      return { range: r.range, totals: r.totals, deltas: r.deltas, data_quality: r.data_quality, series: r.series.slice(-60) };
    },
  },
  {
    name: 'get_channel_breakdown',
    description: 'Spend and platform-reported results per ad platform and per campaign.',
    parameters: { type: 'object', properties: { ...rangeProps } },
    run: (storeId, a) => Performance.channels(storeId, a),
  },
  {
    name: 'get_attribution',
    description: 'Pixel-based attributed orders/revenue/ROAS by channel and top conversion paths, under an attribution model.',
    parameters: { type: 'object', properties: { ...rangeProps, model: { type: 'string', enum: Attribution.MODELS } } },
    run: (storeId, a) => Attribution.attribution(storeId, a),
  },
  {
    name: 'get_cohorts_and_ltv',
    description: 'Monthly acquisition cohorts with retention and cumulative LTV per customer, plus repeat rate.',
    parameters: { type: 'object', properties: {} },
    run: (storeId) => Performance.cohorts(storeId),
  },
  {
    name: 'get_top_products',
    description: 'Best-selling products by revenue with margin and days of stock cover.',
    parameters: { type: 'object', properties: { ...rangeProps } },
    run: (storeId, a) => Performance.products(storeId, a),
  },
  {
    name: 'get_incrementality_experiments',
    description: 'List of incrementality experiments with their status.',
    parameters: { type: 'object', properties: {} },
    run: (storeId) => Incrementality.listExperiments(storeId),
  },
  {
    name: 'get_alerts',
    description: 'Anomalies detected in recent spend, ROAS, orders, CAC and revenue.',
    parameters: { type: 'object', properties: {} },
    run: (storeId) => Performance.alerts(storeId),
  },
  {
    name: 'get_audiences',
    description: 'Reachable marketing audiences (cart abandoners, lapsed customers, VIPs...) with size and estimated impact.',
    parameters: { type: 'object', properties: {} },
    run: (storeId) => Activation.listAudiences(storeId),
  },
];

async function ask(storeId, question, storeName = 'the store') {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server.');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const today = new Date().toISOString().slice(0, 10);

  const messages = [
    {
      role: 'system',
      content: `You are the marketing analyst for ${storeName}. Today is ${today}.
Answer ONLY from data returned by the tools. Call tools to get the numbers; never guess or use outside benchmarks as if they were this store's data.
If a tool shows the data is missing (no ad spend, no pixel events, no orders), say exactly what is missing and how to add it instead of answering.
Be concise: lead with the answer, then 2-4 supporting numbers, then one concrete next step. Mention the date range you used. Respond in the user's language (English, Urdu or Roman Urdu).
Definitions: MER = total revenue / total ad spend. CAC = ad spend / new customers. POAS = (revenue - COGS) / ad spend.`,
    },
    { role: 'user', content: question },
  ];

  const sources = [];
  for (let round = 0; round < 5; round++) {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      temperature: 0.1,
    });
    const msg = res.choices[0].message;
    if (!msg.tool_calls || msg.tool_calls.length === 0) return { answer: msg.content || '', sources };

    messages.push(msg);
    for (const call of msg.tool_calls) {
      const tool = TOOLS.find((t) => t.name === call.function.name);
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch (_) {}
      let out;
      try {
        out = tool ? tool.run(storeId, args) : { error: 'Unknown tool' };
      } catch (err) {
        out = { error: err.message };
      }
      sources.push({ tool: call.function.name, args });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 24000) });
    }
  }
  return { answer: 'I could not finish the analysis within the allowed steps. Try a narrower question.', sources };
}

module.exports = { ask };
