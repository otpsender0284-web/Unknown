const { Telegraf, Markup } = require('telegraf');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);

const db = [];

/* ========================
   🎛️ MENUS
======================== */
const mainMenu = () =>
  Markup.keyboard([
    ['📦 Store Message'],
    ['📁 My Files']
  ]).resize();

const backBtn = () =>
  Markup.keyboard([['⬅️ Back']]).resize();

/* ========================
   🚀 START
======================== */
bot.start((ctx) => {
  ctx.session = null;
  ctx.reply('👋 Welcome!', mainMenu());
});

/* ========================
   📦 STORE START
======================== */
bot.hears('📦 Store Message', (ctx) => {
  ctx.session = { step: 'ask_expiry' };

  ctx.reply('⏳ Select expiry:', Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never'],
    ['⬅️ Back']
  ]).resize());
});

/* ========================
   ⏳ EXPIRY
======================== */
bot.hears(['10 min', '1 hour', '1 day', 'Never'], (ctx) => {
  if (!ctx.session) return;

  const map = {
    '10 min': 10 * 60 * 1000,
    '1 hour': 60 * 60 * 1000,
    '1 day': 24 * 60 * 60 * 1000
  };

  ctx.session.expiresAt =
    ctx.message.text === 'Never'
      ? null
      : Date.now() + map[ctx.message.text];

  ctx.session.step = 'ask_password';

  ctx.reply('🔐 Add password?', Markup.keyboard([
    ['Yes', 'No'],
    ['⬅️ Back']
  ]).resize());
});

/* ========================
   🔐 PASSWORD STEP
======================== */
bot.hears('Yes', (ctx) => {
  if (!ctx.session) return;

  ctx.session.step = 'set_password';
  ctx.reply('🔐 Send password:', backBtn());
});

bot.hears('No', (ctx) => {
  if (!ctx.session) return;

  ctx.session.password = null;
  ctx.session.step = 'ask_onetime';

  ctx.reply('👁 One-time view?', Markup.keyboard([
    ['Yes', 'No'],
    ['⬅️ Back']
  ]).resize());
});

/* ========================
   👁 ONE TIME
======================== */
bot.hears('Yes', (ctx) => {
  if (!ctx.session) return;

  if (ctx.session.step === 'ask_onetime') {
    ctx.session.oneTime = true;
    ctx.session.step = 'send_msg';
    return ctx.reply('📨 Send message to store', backBtn());
  }
});

bot.hears('No', (ctx) => {
  if (!ctx.session) return;

  if (ctx.session.step === 'ask_onetime') {
    ctx.session.oneTime = false;
    ctx.session.step = 'send_msg';
    return ctx.reply('📨 Send message to store', backBtn());
  }
});

/* ========================
   🔙 BACK
======================== */
bot.hears('⬅️ Back', (ctx) => {
  ctx.session = null;
  ctx.reply('🔙 Back to menu', mainMenu());
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session;

  // PASSWORD INPUT
  if (s?.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'ask_onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No'],
      ['⬅️ Back']
    ]).resize());
  }

  // STORE MESSAGE
  if (s?.step === 'send_msg') {

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

    ctx.session = null;

    return ctx.reply(`✅ Stored!\n\n🔗 ${link}`, mainMenu());
  }
});

/* ========================
   🔗 RETRIEVE
======================== */
bot.start(async (ctx) => {
  const param = ctx.startPayload;

  if (!param) return;

  const stored = db.find(d => d.uniqueParam === param);

  if (!stored) return ctx.reply('🚫 Not found');

  if (stored.expiresAt && Date.now() > stored.expiresAt) {
    return ctx.reply('⏳ Expired');
  }

  if (stored.password) {
    ctx.session = { checkPass: param };
    return ctx.reply('🔐 Enter password');
  }

  return sendStored(ctx, stored);
});

/* ========================
   🔐 PASSWORD CHECK
======================== */
bot.on('message', async (ctx) => {
  if (ctx.session?.checkPass) {
    const stored = db.find(d => d.uniqueParam === ctx.session.checkPass);

    if (ctx.message.text !== stored.password) {
      return ctx.reply('❌ Wrong password');
    }

    ctx.session = null;
    return sendStored(ctx, stored);
  }
});

/* ========================
   📤 SEND
======================== */
async function sendStored(ctx, stored) {
  await ctx.telegram.copyMessage(ctx.chat.id, stored.chatId, stored.messageId);

  stored.views++;

  if (stored.oneTime) {
    const i = db.findIndex(d => d.uniqueParam === stored.uniqueParam);
    if (i !== -1) db.splice(i, 1);
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

console.log('🚀 Bot running...');
