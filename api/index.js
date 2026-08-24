const MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-4.6';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

const BASE_CARDS = [
  { baseId: 'c1', name: 'بطاقة سرقة', description: 'تسلب 2 نقطة سمعة من الهدف وتحولها إليك.', effectType: 'STEAL', power: 2, targetRequired: true, rarity: 'شائعة' },
  { baseId: 'c2', name: 'بطاقة خصم', description: 'تخصم 2 نقطة سمعة من الهدف مباشرة.', effectType: 'ATTACK', power: 2, targetRequired: true, rarity: 'شائعة' },
  { baseId: 'c3', name: 'بطاقة تشويه سمعة', description: 'توجه أنظار وشكوك الذكاء الاصطناعي في التقرير نحو الهدف لتلفيق التهمة له.', effectType: 'DEFAME', power: 0, targetRequired: true, rarity: 'شائعة' },
  { baseId: 'c4', name: 'بطاقة كشف البطاقات', description: 'تكشف بطاقات لاعب آخر فوراً في نفس اللحظة.', effectType: 'REVEAL_CARDS', power: 0, targetRequired: true, rarity: 'نادرة' },
  { baseId: 'c5', name: 'بطاقة قلب الضرر', description: 'تعكس أي هجوم أو سلب ممتلكات موجه إليك ويعود على المهاجم نفسه.', effectType: 'REFLECT', power: 0, targetRequired: false, rarity: 'نادرة' },
  { baseId: 'c6', name: 'بطاقة تدمير التحالف', description: 'تنهي وتدمر أي تحالف قائم للهدف فوراً.', effectType: 'DESTROY_ALLIANCE', power: 0, targetRequired: true, rarity: 'نادرة' },
  { baseId: 'c7', name: 'بطاقة تحالف', description: 'ترسل عرض تحالف سري لمدة 3 جولات تقاسمون فيه أرباح وخسائر السمعة.', effectType: 'ALLIANCE_OFFER', power: 0, targetRequired: true, rarity: 'شائعة' },
  { baseId: 'c8', name: 'بطاقة رسالة سرية', description: 'إرسال رسالة خاصة ومباشرة للاعب آخر دون كشفك.', effectType: 'MESSAGE', power: 0, targetRequired: true, rarity: 'شائعة' },
  { baseId: 'c9', name: 'بطاقة تعزيز نفوذ', description: 'تمنحك 2 نقطة سمعة إضافية فوراً.', effectType: 'BOOST', power: 2, targetRequired: false, rarity: 'شائعة' },
  { baseId: 'c10', name: 'بطاقة تسريب وكشف جرم', description: 'تكشف تحركات وأفعال الهدف السابقة بشكل سري.', effectType: 'REVEAL', power: 0, targetRequired: true, rarity: 'نادرة' }
];

const json = (res, code, value) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).json(value);
};

const active = p => p && Number(p.reputation) > 0;
const copy = value => JSON.parse(JSON.stringify(value ?? null));
const idOf = value => String(value ?? '');
const uniqueId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function normalizePlayers(input) {
  return (Array.isArray(input) ? input : []).map((raw, index) => ({
    id: idOf(raw?.id || `player-${index + 1}`),
    name: String(raw?.name || `لاعب ${index + 1}`).slice(0, 40),
    reputation: Math.max(0, Math.min(100, Number(raw?.reputation) || 0)),
    allyId: raw?.allyId ? idOf(raw.allyId) : null,
    allyRoundsLeft: Math.max(0, Number(raw?.allyRoundsLeft) || 0)
  }));
}

function playerMap(players) { return new Map(players.map(p => [p.id, p])); }

function getRandomCards(pool, count) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(c => ({ ...c, id: uniqueId('card') }));
}

async function openRouter(prompt, maxTokens = 300) {
  const key = process.env.OPENROUTER_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(OPENROUTER, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Secret Court' },
      body: JSON.stringify({
        model: MODEL, temperature: 0.8, max_tokens: maxTokens,
        messages: [
          { 
            role: 'system', 
            content: 'أنت راوي تقارير استخبارية مبسطة جداً وواضحة. اكتب تقريراً جنائياً بسيطاً وخالياً تماماً من أي تعقيد أو مصطلحات مثل تشويه سمعة. أعد JSON صالحاً فقط بلا Markdown.' 
          },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function processAllianceShare(players, before) {
  const byId = playerMap(players);
  const processed = new Set();

  for (const p of players) {
    if (!p.allyId || processed.has(p.id)) continue;
    const ally = byId.get(p.allyId);
    if (!ally || ally.allyId !== p.id || !active(p) || !active(ally)) continue;

    processed.add(p.id); processed.add(ally.id);

    const pChange = p.reputation - before[p.id];
    const aChange = ally.reputation - before[ally.id];
    const totalChange = pChange + aChange;

    if (totalChange !== 0) {
      const share = Math.floor(totalChange / 2);
      p.reputation = Math.max(0, before[p.id] + share);
      ally.reputation = Math.max(0, before[ally.id] + (totalChange - share));
    }
  }
}

function ageAlliances(players) {
  const byId = playerMap(players);
  for (const p of players) {
    if (!p.allyId) continue;
    p.allyRoundsLeft -= 1;
    const ally = byId.get(p.allyId);
    if (!ally || p.allyRoundsLeft <= 0 || !active(p) || !active(ally)) {
      if (ally) { ally.allyId = null; ally.allyRoundsLeft = 0; }
      p.allyId = null; p.allyRoundsLeft = 0;
    }
  }
}

function triggerGlobalEvent(players) {
  if (Math.random() > 0.40) return null;

  const activePlayers = players.filter(active);
  if (activePlayers.length === 0) return null;

  const sorted = [...activePlayers].sort((a, b) => b.reputation - a.reputation);
  const topPlayer = sorted[0];

  const events = [
    {
      title: 'انقلاب الجذور (قلب النقاط)',
      desc: 'حدث طارئ ومفاجئ! تم قلب وعكس نقاط جميع اللاعبين رأساً على عقب.',
      apply: () => {
        const reps = activePlayers.map(p => p.reputation);
        const maxRep = Math.max(...reps, 10);
        activePlayers.forEach(p => { p.reputation = Math.max(0, maxRep - p.reputation); });
      }
    },
    {
      title: 'زيادة نقاط محظوظة',
      desc: 'تم منح مكافأة غير متوقعة لتعزيز نقاط أحد اللاعبين عشوائياً.',
      apply: () => {
        const lucky = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        lucky.reputation += 3;
      }
    },
    {
      title: 'ضريبة المتصدر القاسية',
      desc: `تم رصد اللاعب الأكبر ${topPlayer.name} وخصم نقاط من رصيده مباشرة!`,
      apply: () => { topPlayer.reputation = Math.max(0, topPlayer.reputation - 3); }
    },
    {
      title: 'كشف الجرم العام',
      desc: 'تم تسريب وثيقة عامة تكشف تحركات بعض اللاعبين وتخصم نقطة من الجميع.',
      apply: () => { activePlayers.forEach(p => p.reputation = Math.max(0, p.reputation - 1)); }
    }
  ];

  const selectedEvent = events[Math.floor(Math.random() * events.length)];
  selectedEvent.apply();
  return { title: selectedEvent.title, description: selectedEvent.desc };
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const body = req.body || {};
  const action = body.action;

  if (action === 'generate_initial_cards') {
    const cards = getRandomCards(BASE_CARDS, 2);
    return json(res, 200, { cards });
  }

  if (action === 'buy_card') {
    const players = normalizePlayers(body.players);
    const buyer = players.find(p => p.id === idOf(body.playerId));
    if (!buyer || buyer.reputation <= 4) {
      return json(res, 400, { error: 'INSUFFICIENT_REPUTATION', message: 'شراء بطاقة جديدة يتطلب 4 نقاط سمعة كاملة.' });
    }
    buyer.reputation -= 4;
    const boughtCard = getRandomCards(BASE_CARDS, 1)[0];
    return json(res, 200, { players, boughtCard });
  }

  if (action === 'instant_reveal_cards') {
    const targetId = idOf(body.targetId);
    const hands = body.hands || {};
    const targetCards = hands[targetId] || [];
    return json(res, 200, { targetCards });
  }

  if (action === 'resolve_round') {
    const players = normalizePlayers(body.players);
    const byId = playerMap(players);
    const messages = copy(body.pendingMessages) || {};
    const actions = Array.isArray(body.actions) ? body.actions : [];
    const before = Object.fromEntries(players.map(p => [p.id, p.reputation]));

    const defamedTargets = [];
    const crimes = [];
    const reflectSet = new Set();
    const roundEventLogs = [];

    for (const act of actions) {
      const actor = byId.get(idOf(act.playerId));
      if (!active(actor) || !act.generatedCard) continue;
      if (act.generatedCard.effectType === 'REFLECT') {
        reflectSet.add(actor.id);
        roundEventLogs.push(`تفعيل درع حماية وعكس للضرر.`);
      }
    }

    for (const act of actions) {
      const actor = byId.get(idOf(act.playerId));
      const card = act.generatedCard;
      const target = act.targetId ? byId.get(idOf(act.targetId)) : null;

      if (!active(actor) || !card) continue;
      if (card.targetRequired && (!target || target.id === actor.id || !active(target))) continue;

      if (!messages[target?.id]) {
        // ضمان تهيئة صندوق رسائل الهدف إن لم يكن موجوداً
      }

      switch (card.effectType) {
        case 'ATTACK': {
          const power = card.power;
          if (reflectSet.has(target.id)) {
            actor.reputation = Math.max(0, actor.reputation - power);
            roundEventLogs.push(`هجوم من ${actor.name} على ${target.name} وانعكس على المهاجم.`);
          } else {
            target.reputation = Math.max(0, target.reputation - power);
            roundEventLogs.push(`استنزاف سمعة ضد ${target.name}.`);
          }
          crimes.push({ culpritId: actor.id, targetId: target.id });
          break;
        }
        case 'STEAL': {
          if (reflectSet.has(target.id)) {
            const amount = Math.min(card.power, actor.reputation);
            actor.reputation -= amount;
            target.reputation += amount;
            roundEventLogs.push(`محاولة سرقة من ${actor.name} وانعكست عليه.`);
          } else {
            const amount = Math.min(card.power, target.reputation);
            target.reputation -= amount;
            actor.reputation += amount;
            roundEventLogs.push(`تمت عملية سرقة بين اللاعبين.`);
          }
          crimes.push({ culpritId: actor.id, targetId: target.id });
          break;
        }
        case 'DEFAME': {
          defamedTargets.push(target.name);
          roundEventLogs.push(`تم توجيه الشكوك الخفية نحو ${target.name}.`);
          crimes.push({ culpritId: actor.id, targetId: target.id });
          break;
        }
        case 'DESTROY_ALLIANCE': {
          if (target.allyId) {
            const partner = byId.get(target.allyId);
            if (partner) { partner.allyId = null; partner.allyRoundsLeft = 0; }
            target.allyId = null; target.allyRoundsLeft = 0;
            roundEventLogs.push(`تم تدمير تحالف ${target.name}.`);
          }
          break;
        }
        case 'ALLIANCE_OFFER': {
          if (!target.allyId && !actor.allyId) {
            if (!messages[target.id]) messages[target.id] = [];
            messages[target.id].push({
              id: uniqueId('msg'), kind: 'alliance_offer',
              fromId: actor.id, fromName: actor.name,
              text: `طلب تحالف سري مقدم من ${actor.name} لمدة 3 جولات.`
            });
            roundEventLogs.push(`إرسال طلب تحالف سرّي إلى ${target.name}.`);
          }
          break;
        }
        case 'MESSAGE': {
          if (!messages[target.id]) messages[target.id] = [];
          messages[target.id].push({
            id: uniqueId('msg'), kind: 'private_msg',
            fromName: actor.name,
            text: String(act.text || 'رسالة سرية').slice(0, 300)
          });
          roundEventLogs.push(`تسليم رسالة خاصة إلى ${target.name}.`);
          break;
        }
        case 'BOOST': {
          actor.reputation += card.power;
          roundEventLogs.push(`تعزيز نفوذ شخصي.`);
          break;
        }
        case 'REVEAL': {
          if (!messages[actor.id]) messages[actor.id] = [];
          messages[actor.id].push({
            id: uniqueId('msg'), kind: 'private_msg',
            fromName: 'استخبارات',
            text: `معلومات مسربة: السمعة الحالية لـ ${target.name} هي ${target.reputation}.`
          });
          roundEventLogs.push(`عملية استطلاع واستعلام سري.`);
          break;
        }
      }
    }

    processAllianceShare(players, before);
    ageAlliances(players);
    const globalEvent = triggerGlobalEvent(players);

    const trueCulprit = crimes.length ? crimes[Math.floor(Math.random() * crimes.length)].culpritId : null;
    let courtCase = {
      title: 'تقرير المحكمة',
      trueCulpritId: trueCulprit,
      clue: '',
      confidence: Math.floor(Math.random() * 30) + 60,
      globalEvent
    };

    const prompt = `أحداث هذه الجولة:
${roundEventLogs.length ? roundEventLogs.map(e => `- ${e}`).join('\n') : '- هدوء تام في الجولة.'}
الشخصيات المرصودة بالشكوك: [${defamedTargets.join('، ') || 'لا أحد'}]

اكتب تقريراً استخبارياً بسيطاً ومباشراً جداً باللغة العربية، وبدون أي تعقيد أو ذكر لعبارة تشويه سمعة.
أعد JSON بالشكل التالي حصراً:
{"clue": "نص التقرير البسيط والواضح", "confidence": 75}`;

    const raw = await openRouter(prompt, 300);
    let parsedAi = null;
    try {
      parsedAi = raw ? JSON.parse(raw.replace(/```json|```/g, '').trim()) : null;
    } catch {}

    if (parsedAi?.clue) {
      courtCase.clue = String(parsedAi.clue).slice(0, 450);
      courtCase.confidence = Math.max(30, Math.min(98, Number(parsedAi.confidence) || 75));
    } else {
      let suspectText = defamedTargets.length ? ` وتشير المؤشرات نحو الشبهات حول: [${defamedTargets.join(' و ')}].` : '';
      let eventText = globalEvent ? ` مع رصد تأثير حدث "${globalEvent.title}".` : '';
      courtCase.clue = `تقرير الجولة بسيط: سادت تحركات خفية بين اللاعبين هذا الأسبوع${eventText}.${suspectText} تفحص الأدلة جيداً قبل التصويت.`;
    }

    return json(res, 200, { players, pendingMessages: messages, courtCase });
  }

  if (action === 'resolve_vote') {
    const players = normalizePlayers(body.players);
    const byId = playerMap(players);
    const culpritId = body.trueCulpritId == null ? null : idOf(body.trueCulpritId);
    const votes = Array.isArray(body.votes) ? body.votes : [];
    const tally = {};

    for (const vote of votes) {
      const voter = byId.get(idOf(vote.voterId));
      if (!active(voter)) continue;
      const accusedId = vote.accusedId == null ? 'NONE' : idOf(vote.accusedId);
      tally[accusedId] = (tally[accusedId] || 0) + 1;
    }

    const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NONE';
    let verdictMsg;

    if (winner === culpritId && culpritId !== null) {
      const culprit = byId.get(culpritId);
      if (culprit) culprit.reputation = Math.max(0, culprit.reputation - 4);
      verdictMsg = 'أصاب التصويت الجماعي الجاني الحقيقي! تم خصم 4 نقاط سمعة من رصيده[cite: 2].';
    } else {
      const wrong = byId.get(winner);
      if (winner !== 'NONE' && wrong) {
        wrong.reputation += 2;
        verdictMsg = `كان التصويت خاطئاً وتم اتهام شخص بريء (${wrong.name}); فحصل على تعويض سمعة (+2 نقطة)[cite: 2].`;
      } else {
        verdictMsg = 'انتهى التصويت بالامتناع ولم يتم إدانة أحد.';
      }
    }

    return json(res, 200, { players, verdictMsg });
  }

  return json(res, 400, { error: 'UNKNOWN_ACTION' });
}

export default async function api(req, res) {
  try { return await handler(req, res); }
  catch (error) {
    console.error(error);
    return json(res, 500, { error: 'SERVER_ERROR', message: 'حدث خطأ في معالجة طلب الخادم.' });
  }
}
