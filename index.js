const { Telegraf, Markup, session } = require('telegraf');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const db = [];

/* ========================
   ⚡ HELPER
======================== */
const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function loading(ctx, text = "⏳ Processing...") {
  const msg = await ctx.reply(text);
  await wait(400);
  try { await ctx.deleteMessage(msg.message_id); } catch {}
}

const mainMenu = () =>
  Markup.keyboard([
    ['📦 Store Message'],
    ['📁 My Files']
  ]).resize();

const backMenu = () =>
  Markup.keyboard([['⬅️ Back']]).resize();

/* ========================
   🚀 START (WITH LINK SUPPORT)
======================== */
bot.start(async (ctx) => {
  const param = ctx.startPayload;

  // 🔗 If link clicked
  if (param) {
    const stored = db.find(d => d.uniqueParam === param);

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

  // 👋 Normal start
  ctx.session = { step: 'menu' };
  await loading(ctx, '🔄 Starting...');
  ctx.reply('👋 Welcome!', mainMenu());
});

/* ========================
   📦 STORE START
======================== */
bot.hears('📦 Store Message', async (ctx) => {

  // ⚠️ IMPORTANT FIX
  if (ctx.chat.type !== 'private') {
    return ctx.reply('❌ Please use bot in private chat only');
  }

  ctx.session = { step: 'expiry' };

  await loading(ctx);
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

  await loading(ctx);
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

  // 🔐 PASSWORD INPUT
  if (s?.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No'],
      ['⬅️ Back']
    ]).resize());
  }

  // 📦 STORE MESSAGE
  if (s?.step === 'send') {

    await loading(ctx, '📦 Storing...');

    const id = Math.random().toString(36).substring(2, 10);

    db.push({
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

  // 🔐 PASSWORD CHECK
  if (s?.check) {
    const stored = db.find(d => d.uniqueParam === s.check);

    if (!stored) return ctx.reply('🚫 File not found');

    if (ctx.message.text !== stored.password) {
      return ctx.reply('❌ Wrong password');
    }

    ctx.session = { step: 'menu' };
    return sendStored(ctx, stored);
  }
});

/* ========================
   📤 SEND FUNCTION (FIXED)
======================== */
async function sendStored(ctx, stored) {
  try {
    await loading(ctx, '📤 Sending file...');

    await ctx.telegram.copyMessage(
      ctx.chat.id,
      stored.chatId,
      stored.messageId
    );

    stored.views++;

    if (stored.oneTime) {
      const i = db.findIndex(d => d.uniqueParam === stored.uniqueParam);
      if (i !== -1) db.splice(i, 1);
    }

  } catch (err) {
    console.log(err);

    ctx.reply(
      '⚠️ Cannot retrieve file.\n\n' +
      'Make sure:\n' +
      '• Message is not deleted\n' +
      '• Stored in private chat\n' +
      '• Bot has access'
    );
  }
}

/* ========================
   📁 MY FILES
======================== */
bot.hears('📁 My Files', (ctx) => {
  const files = db.filter(d => d.chatId === ctx.chat.id);

  if (!files.length) return ctx.reply('📭 No files');

  let text = '📁 Your Files:\n\n';

  files.forEach(f => {
    text += `🔗 https://t.me/${ctx.botInfo.username}?start=${f.uniqueParam}\n👁 ${f.views}\n\n`;
  });

  ctx.reply(text);
});

/* ======================== */
bot.launch({ dropPendingUpdates: true });

console.log('🚀 BOT RUNNING PERFECTLY');
