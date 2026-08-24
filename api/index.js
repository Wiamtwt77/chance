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
        model: MODEL, temperature: 0.85, max_tokens: maxTokens,
        messages: [
          { 
            role: 'system', 
            content: 'أنت راوي ورئيس محكمة جنائية غامضة. مهمتك صياغة تقرير استخباري درامي يربط الأحداث الفعلية للجولة ويصوب التهم والشكوك نحو المستهدفين بتشويه السمعة بدقة. أعد JSON صالحاً فقط بلا Markdown.' 
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
  if (Math.random() > 0.40) return null; // رفع نسبة حدوث الحدث العشوائي لتظهر بانتظام

  const activePlayers = players.filter(active);
  if (activePlayers.length === 0) return null;

  const sorted = [...activePlayers].sort((a, b) => b.reputation - a.reputation);
  const topPlayer = sorted[0];

  const events = [
    {
      title: 'ضريبة النفوذ العالية',
      desc: `تم فرض ضريبة استثنائية قاسية على المتصدر لموازنة القوى! خصم 3 نقاط سمعة من ${topPlayer.name}.`,
      apply: () => { topPlayer.reputation = Math.max(0, topPlayer.reputation - 3); }
    },
    {
      title: 'مرسوم براءة عامة',
      desc: 'صدر مرسوم ملكي مفاجئ بمنح جميع اللاعبين النشطين 1 نقطة سمعة إضافية.',
      apply: () => { activePlayers.forEach(p => p.reputation += 1); }
    },
    {
      title: 'كارثة اقتصادية للبلاط',
      desc: 'تراجع الاستقرار المالي في القصر بشكل مرعب! خصم 1 نقطة سمعة من كافة اللاعبين.',
      apply: () => { activePlayers.forEach(p => p.reputation = Math.max(0, p.reputation - 1)); }
    },
    {
      title: 'حملة تفتيش مفاجئة',
      desc: 'عثر الحراس على أدلة خفية؛ خصم 2 نقطة سمعة من عشوائي من الحاضرين.',
      apply: () => {
        const victim = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        victim.reputation = Math.max(0, victim.reputation - 2);
      }
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
        roundEventLogs.push(`تم تفعيل درع عكس الضرر لحماية أحد اللاعبين.`);
      }
    }

    for (const act of actions) {
      const actor = byId.get(idOf(act.playerId));
      const card = act.generatedCard;
      const target = act.targetId ? byId.get(idOf(act.targetId)) : null;

      if (!active(actor) || !card) continue;
      if (card.targetRequired && (!target || target.id === actor.id || !active(target))) continue;

      switch (card.effectType) {
        case 'ATTACK': {
          const power = card.power;
          if (reflectSet.has(target.id)) {
            actor.reputation = Math.max(0, actor.reputation - power);
            roundEventLogs.push(`محاولة هجوم من ${actor.name} على ${target.name} وانعكس الضرر على المهاجم.`);
          } else {
            target.reputation = Math.max(0, target.reputation - power);
            roundEventLogs.push(`قام ${actor.name} بتوجيه ضربة استنزاف ضد ${target.name}.`);
          }
          crimes.push({ culpritId: actor.id, targetId: target.id });
          break;
        }
        case 'STEAL': {
          if (reflectSet.has(target.id)) {
            const amount = Math.min(card.power, actor.reputation);
            actor.reputation -= amount;
            target.reputation += amount;
            roundEventLogs.push(`محاولة سرقة من ${actor.name} ضد ${target.name} وانعكست على المهاجم.`);
          } else {
            const amount = Math.min(card.power, target.reputation);
            target.reputation -= amount;
            actor.reputation += amount;
            roundEventLogs.push(`قام ${actor.name} بسرقة نقاط سمعة من ${target.name}.`);
          }
          crimes.push({ culpritId: actor.id, targetId: target.id });
          break;
        }
        case 'DEFAME': {
          defamedTargets.push(target.name);
          roundEventLogs.push(`حملة تشويه سمعة موجهة خصيصاً لتلفيق الشبهات ضد ${target.name}.`);
          crimes.push({ culpritId: actor.id, targetId: target.id });
          break;
        }
        case 'DESTROY_ALLIANCE': {
          if (target.allyId) {
            const partner = byId.get(target.allyId);
            if (partner) { partner.allyId = null; partner.allyRoundsLeft = 0; }
            target.allyId = null; target.allyRoundsLeft = 0;
            roundEventLogs.push(`قام ${actor.name} بتدمير وإنهاء تحالف ${target.name}.`);
          }
          break;
        }
        case 'ALLIANCE_OFFER': {
          if (!target.allyId && !actor.allyId) {
            if (!messages[target.id]) messages[target.id] = [];
            messages[target.id].push({
              id: uniqueId('msg'), kind: 'alliance_offer',
              fromId: actor.id, fromName: actor.name,
              text: `عرض تحالف سري من ${actor.name} لمدة 3 جولات.`
            });
            roundEventLogs.push(`قدم ${actor.name} عرض تحالف سري إلى ${target.name}.`);
          }
          break;
        }
        case 'MESSAGE': {
          if (!messages[target.id]) messages[target.id] = [];
          messages[target.id].push({
            id: uniqueId('msg'), kind: 'private_msg',
            fromName: actor.name,
            text: String(act.text || 'رسالة سرية غامضة').slice(0, 300)
          });
          roundEventLogs.push(`تم تسليم رسالة سرية مباشرة إلى ${target.name}.`);
          break;
        }
        case 'BOOST': {
          actor.reputation += card.power;
          roundEventLogs.push(`قام ${actor.name} بتعزيز نفوذه وتدعيم سمعته.`);
          break;
        }
        case 'REVEAL': {
          if (!messages[actor.id]) messages[actor.id] = [];
          messages[actor.id].push({
            id: uniqueId('msg'), kind: 'private_msg',
            fromName: 'تسريب استخباري',
            text: `معلومات مسربة: السمعة الحالية لـ ${target.name} هي ${target.reputation}.`
          });
          roundEventLogs.push(`تم رصد عملية تجسس واستعلام استخباري.`);
          break;
        }
      }
    }

    processAllianceShare(players, before);
    ageAlliances(players);
    const globalEvent = triggerGlobalEvent(players);

    const trueCulprit = crimes.length ? crimes[Math.floor(Math.random() * crimes.length)].culpritId : null;
    let courtCase = {
      title: 'تقرير المحكمة الاستخباري',
      trueCulpritId: trueCulprit,
      clue: '',
      confidence: Math.floor(Math.random() * 40) + 55,
      globalEvent
    };

    // تقرير ذكاء اصطناعي ديناميكي متطور يتفاعل مع تشويه السمعة وأحداث الجولة الفعليّة
    const prompt = `أحداث هذه الجولة الفعلية في المحكمة السرية:
${roundEventLogs.length ? roundEventLogs.map(e => `- ${e}`).join('\n') : '- جولة هادئة بتمريرات سرية.'}

الأسماء المستهدفة بحملات تشويه السمعة وتلفيق التهم (ركز عليها تماماً في التقرير): [${defamedTargets.join('، ') || 'لا يوجد مستهدف مباشر'}]

اكتب تقريراً جنائياً درامياً ومثيراً باللغة العربية يربط الأحداث المذكورة، ويصوب الشبهات والاتهامات نحو الشخصيات المستهدفة بتشويه السمعة بطريقة غامضة وذكية.
أعد JSON صالحاً بالشكل التالي فقط:
{"clue": "نص التقرير المحبوك المشوق", "confidence": 75}`;

    const raw = await openRouter(prompt, 300);
    let parsedAi = null;
    try {
      parsedAi = raw ? JSON.parse(raw.replace(/```json|```/g, '').trim()) : null;
    } catch {}

    if (parsedAi?.clue) {
      courtCase.clue = String(parsedAi.clue).slice(0, 450);
      courtCase.confidence = Math.max(30, Math.min(98, Number(parsedAi.confidence) || 70));
    } else {
      // مولد محلي ديناميكي في حال انقطاع الـ API لضمان عدم ثبات التقرير نهائياً
      const culpritName = trueCulprit ? players.find(p => p.id === trueCulprit)?.name : 'مجهول';
      let defameText = defamedTargets.length ? ` وتشير الأدلة المتطابقة إلى تورط محتمل للمشتبه بهم: [${defamedTargets.join(' و ')}] بناءً على حملات التشويه الممنهجة.` : ' والتحقيقات تشير لتحركات مريبة في الكواليس.';
      let eventText = globalEvent ? ` بالتزامن مع وقوع حدث "${globalEvent.title}".` : '';
      courtCase.clue = `تشير التقارير السرية لهذه الجولة إلى تصاعد التوتر في البلاط${eventText}.${defameText} إن أصابع الاتهام تبدو مشتتة بين الكواليس المظلمة.`;
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
      verdictMsg = 'الحكم الجماعي أصاب المتهم الحقيقي وتم خصم 4 نقاط سمعة من رصيده بنجاح!';
    } else {
      const wrong = byId.get(winner);
      if (winner !== 'NONE' && wrong) {
        wrong.reputation += 2;
        verdictMsg = `الحكم الجماعي كان خاطئاً! لم يكن المتهم (${wrong.name}) هو الجاني الحقيقي؛ فحصل على تعويض سمعة قدره (+2 نقطة).`;
      } else {
        verdictMsg = 'انتهى التصويت بالامتناع ولم يتم إدانة أحد في هذه الجولة.';
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
