const { Telegraf, Markup } = require('telegraf');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);

/* ========================
   🔹 DB
======================== */
const db = [];

/* ========================
   🎛️ MAIN MENU
======================== */
function mainMenu() {
  return Markup.keyboard([
    ['📦 Store Message'],
    ['📁 My Files'],
    ['❌ Cancel']
  ]).resize();
}

/* ========================
   ⚙️ STORE MENU
======================== */
function storeMenu() {
  return Markup.keyboard([
    ['⏳ Expiry', '🔐 Password'],
    ['👁 One-Time'],
    ['✅ Continue'],
    ['⬅️ Back / Cancel']
  ]).resize();
}

/* ========================
   ⏳ EXPIRY MENU
======================== */
function expiryMenu() {
  return Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never'],
    ['⬅️ Back / Cancel']
  ]).resize();
}

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
  ctx.session = {
    expiresAt: null,
    password: null,
    oneTime: false,
    step: 'menu'
  };

  ctx.reply('⚙️ Choose options:', storeMenu());
});

/* ========================
   ⏳ EXPIRY
======================== */
bot.hears('⏳ Expiry', (ctx) => {
  ctx.reply('Select expiry:', expiryMenu());
});

bot.hears(['10 min', '1 hour', '1 day', 'Never'], (ctx) => {
  const map = {
    '10 min': 10 * 60 * 1000,
    '1 hour': 60 * 60 * 1000,
    '1 day': 24 * 60 * 60 * 1000
  };

  if (ctx.message.text === 'Never') {
    ctx.session.expiresAt = null;
  } else {
    ctx.session.expiresAt = Date.now() + map[ctx.message.text];
  }

  ctx.reply('✅ Expiry set', storeMenu());
});

/* ========================
   🔐 PASSWORD
======================== */
bot.hears('🔐 Password', (ctx) => {
  ctx.session.step = 'wait_pass';
  ctx.reply('Send password:');
});

/* ========================
   👁 ONE TIME
======================== */
bot.hears('👁 One-Time', (ctx) => {
  ctx.session.oneTime = true;
  ctx.reply('👁 One-time enabled', storeMenu());
});

/* ========================
   ▶️ CONTINUE
======================== */
bot.hears('✅ Continue', (ctx) => {
  ctx.session.step = 'send_msg';
  ctx.reply('📨 Send message to store');
});

/* ========================
   🔙 BACK / CANCEL
======================== */
bot.hears(['⬅️ Back / Cancel', '❌ Cancel'], (ctx) => {
  ctx.session = null;
  ctx.reply('❌ Cancelled', mainMenu());
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {

  // Password set
  if (ctx.session?.step === 'wait_pass') {
    ctx.session.password = ctx.message.text;
    ctx.session.step = 'menu';
    return ctx.reply('✅ Password saved', storeMenu());
  }

  // Store message
  if (ctx.session?.step === 'send_msg') {

    const uniqueParam = Math.random().toString(36).substring(2, 10);

    db.push({
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      uniqueParam,
      expiresAt: ctx.session.expiresAt,
      password: ctx.session.password,
      oneTime: ctx.session.oneTime,
      views: 0
    });

    const link = `https://t.me/${ctx.botInfo.username}?start=${uniqueParam}`;

    ctx.session = null;

    return ctx.reply(`✅ Stored!\n\n🔗 ${link}`, mainMenu());
  }
});

/* ======================== */
bot.launch({ dropPendingUpdates: true });

console.log('🚀 Bot running...');
