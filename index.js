const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

/* ========================
   💾 MONGODB (ONLY CHANGE)
======================== */
const client = new MongoClient(process.env.MONGO_URI);
let db;

async function initDB() {
  await client.connect();
  db = client.db('telegramBot').collection('files');
  console.log('✅ MongoDB Connected');
}
initDB();

/* ========================
   ⚡ ANIMATION SYSTEM
======================== */
const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function animate(ctx, steps) {
  let msg = await ctx.reply(steps[0]);
  for (let i = 1; i < steps.length; i++) {
    await wait(600);
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        steps[i]
      );
    } catch {}
  }
  await wait(300);
  try { await ctx.deleteMessage(msg.message_id); } catch {}
}

/* ========================
   🎛️ MENUS
======================== */
const mainMenu = () =>
  Markup.keyboard([
    ['📦 Store Message'],
    ['📁 My Files']
  ]).resize();

const backMenu = () =>
  Markup.keyboard([['⬅️ Back']]).resize();

/* ========================
   🚀 START + LINK
======================== */
bot.start(async (ctx) => {
  const param = ctx.startPayload;

  if (param) {
    const stored = await db.findOne({ uniqueParam: param });

    if (!stored) return ctx.reply('🚫 File not found');

    if (stored.expiresAt && Date.now() > stored.expiresAt) {
      return ctx.reply('⏳ Link expired');
    }

    if (stored.password) {
      ctx.session = { check: param };
      return ctx.reply('🔐 Enter password');
    }

    return sendStored(ctx, stored);
  }

  ctx.session = { step: 'menu' };

  await animate(ctx, [
    '🔄 Starting...',
    '⚡ Loading system...',
    '🚀 Almost ready...'
  ]);

  ctx.reply('👋 Welcome!', mainMenu());
});

/* ========================
   📦 STORE FLOW
======================== */
bot.hears('📦 Store Message', async (ctx) => {

  if (ctx.chat.type !== 'private') {
    return ctx.reply('❌ Use bot in private chat only');
  }

  ctx.session = { step: 'expiry' };

  await animate(ctx, [
    '⚙️ Opening settings...',
    '⏳ Preparing options...'
  ]);

  ctx.reply('⏳ Select expiry:', Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never'],
    ['⬅️ Back']
  ]).resize());
});

/* ========================
   ⏳ EXPIRY
======================== */
bot.hears(['10 min', '1 hour', '1 day', 'Never'], async (ctx) => {
  if (ctx.session?.step !== 'expiry') return;

  const map = {
    '10 min': 600000,
    '1 hour': 3600000,
    '1 day': 86400000
  };

  ctx.session.expiresAt =
    ctx.message.text === 'Never'
      ? null
      : Date.now() + map[ctx.message.text];

  ctx.session.step = 'password';

  await animate(ctx, [
    '🔐 Applying settings...',
    '🔒 Securing options...'
  ]);

  ctx.reply('🔐 Add password?', Markup.keyboard([
    ['Yes', 'No'],
    ['⬅️ Back']
  ]).resize());
});

/* ========================
   🔐 PASSWORD + ONE-TIME
======================== */
bot.hears('Yes', (ctx) => {
  const s = ctx.session;

  if (s?.step === 'password') {
    s.step = 'set_password';
    return ctx.reply('🔐 Send password:', backMenu());
  }

  if (s?.step === 'onetime') {
    s.oneTime = true;
    s.step = 'send';
    return ctx.reply('📨 Send message to store', backMenu());
  }
});

bot.hears('No', (ctx) => {
  const s = ctx.session;

  if (s?.step === 'password') {
    s.password = null;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No'],
      ['⬅️ Back']
    ]).resize());
  }

  if (s?.step === 'onetime') {
    s.oneTime = false;
    s.step = 'send';
    return ctx.reply('📨 Send message to store', backMenu());
  }
});

/* ========================
   🔙 BACK
======================== */
bot.hears('⬅️ Back', (ctx) => {
  ctx.session = { step: 'menu' };
  ctx.reply('🔙 Back to menu', mainMenu());
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session;

  if (s?.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No'],
      ['⬅️ Back']
    ]).resize());
  }

  if (s?.step === 'send') {

    await animate(ctx, [
      '📦 Storing message...',
      '🔐 Encrypting...',
      '💾 Saving...'
    ]);

    const id = Math.random().toString(36).substring(2, 10);

    await db.insertOne({
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      uniqueParam: id,
      expiresAt: s.expiresAt,
      password: s.password,
      oneTime: s.oneTime,
      views: 0
    });

    const link = `https://t.me/${ctx.botInfo.username}?start=${id}`;

    ctx.session = { step: 'menu' };

    return ctx.reply(`✅ Stored successfully!\n\n🔗 ${link}`, mainMenu());
  }

  if (s?.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (!stored) return ctx.reply('🚫 File not found');

    if (ctx.message.text !== stored.password) {
      return ctx.reply('❌ Wrong password');
    }

    ctx.session = { step: 'menu' };
    return sendStored(ctx, stored);
  }
});

/* ========================
   📤 SEND FILE
======================== */
async function sendStored(ctx, stored) {
  try {
    await animate(ctx, [
      '📤 Fetching file...',
      '⚡ Processing...',
      '🚀 Sending now...'
    ]);

    await ctx.telegram.copyMessage(
      ctx.chat.id,
      stored.chatId,
      stored.messageId
    );

    await db.updateOne(
      { uniqueParam: stored.uniqueParam },
      { $inc: { views: 1 } }
    );

    if (stored.oneTime) {
      await db.deleteOne({ uniqueParam: stored.uniqueParam });
    }

  } catch (err) {
    ctx.reply('⚠️ Cannot retrieve file');
  }
}

/* ========================
   📁 MY FILES
======================== */
bot.hears('📁 My Files', async (ctx) => {
  const files = await db.find({ chatId: ctx.chat.id }).toArray();

  if (!files.length) return ctx.reply('📭 No files');

  let text = '📁 Your Files:\n\n';

  files.forEach(f => {
    text += `🔗 https://t.me/${ctx.botInfo.username}?start=${f.uniqueParam}\n👁 ${f.views}\n\n`;
  });

  ctx.reply(text);
});

/* ======================== */
bot.launch({ dropPendingUpdates: true });

console.log('🚀 ANIMATED BOT WITH MONGO RUNNING');
