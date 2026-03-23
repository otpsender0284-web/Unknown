const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

/* ========================
   💾 DATABASE (PERSISTENT)
======================== */
const DB_FILE = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = loadDB();

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

  // 🔗 OPEN STORED FILE
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

  // 👋 NORMAL START
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

  // PASSWORD INPUT
  if (s?.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No'],
      ['⬅️ Back']
    ]).resize());
  }

  // STORE MESSAGE
  if (s?.step === 'send') {

    await animate(ctx, [
      '📦 Storing message...',
      '🔐 Encrypting...',
      '💾 Saving...'
    ]);

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

    saveDB(db);

    const link = `https://t.me/${ctx.botInfo.username}?start=${id}`;

    ctx.session = { step: 'menu' };

    return ctx.reply(`✅ Stored successfully!\n\n🔗 ${link}`, mainMenu());
  }

  // PASSWORD CHECK
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

    stored.views++;
    saveDB(db);

    if (stored.oneTime) {
      const i = db.findIndex(d => d.uniqueParam === stored.uniqueParam);
      if (i !== -1) {
        db.splice(i, 1);
        saveDB(db);
      }
    }

  } catch (err) {
    console.log(err);

    ctx.reply(
      '⚠️ Cannot retrieve file.\n\n' +
      '• Message deleted\n' +
      '• Bot has no access\n' +
      '• Not stored properly'
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

console.log('🚀 ANIMATED BOT RUNNING');
