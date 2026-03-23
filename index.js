const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

const ADMIN_ID = 8065726393;
const PAGE_SIZE = 5;

/* ========================
   💾 MONGODB
======================== */
const client = new MongoClient(process.env.MONGO_URI);
let db;

async function initDB() {
  try {
    await client.connect();
    db = client.db('telegramBot').collection('files');
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.log('❌ MongoDB Error:', err);
  }
}
initDB();

/* ========================
   🛡️ CHECK DB
======================== */
function checkDB(ctx) {
  if (!db) {
    ctx.reply('⏳ Server starting...');
    return false;
  }
  return true;
}

/* ========================
   🎛️ MENUS
======================== */
const mainMenu = () =>
  Markup.keyboard([
    ['📦 Store Message'],
    ['📁 My Files'],
    ['🔍 Search File', '🗑 Delete All']
  ]).resize();

/* ========================
   🚀 START
======================== */
bot.start(async (ctx) => {
  if (!checkDB(ctx)) return;

  const param = ctx.startPayload;

  if (param) {
    const stored = await db.findOne({ uniqueParam: param });

    if (!stored) return ctx.reply('🚫 File not found');

    if (stored.expiresAt && Date.now() > stored.expiresAt)
      return ctx.reply('⏳ Link expired');

    if (stored.password) {
      ctx.session.check = param;
      return ctx.reply('🔐 Enter password');
    }

    return sendStored(ctx, stored);
  }

  ctx.session = {};
  ctx.reply('👋 Welcome!', mainMenu());
});

/* ========================
   📦 STORE FLOW
======================== */
bot.hears('📦 Store Message', (ctx) => {
  ctx.session.step = 'expiry';

  ctx.reply('⏳ Select expiry:', Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never']
  ]).resize());
});

/* ========================
   ⏳ EXPIRY
======================== */
bot.hears(['10 min', '1 hour', '1 day', 'Never'], (ctx) => {
  if (ctx.session.step !== 'expiry') return;

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

  ctx.reply('🔐 Add password?', Markup.keyboard([
    ['Yes', 'No']
  ]).resize());
});

/* ========================
   🔐 PASSWORD
======================== */
bot.hears('Yes', (ctx) => {
  if (ctx.session.step === 'password') {
    ctx.session.step = 'set_password';
    return ctx.reply('🔐 Send password');
  }

  if (ctx.session.step === 'onetime') {
    ctx.session.oneTime = true;
    ctx.session.step = 'send';
    return ctx.reply('📨 Send message to store');
  }
});

bot.hears('No', (ctx) => {
  if (ctx.session.step === 'password') {
    ctx.session.password = null;
    ctx.session.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No']
    ]).resize());
  }

  if (ctx.session.step === 'onetime') {
    ctx.session.oneTime = false;
    ctx.session.step = 'send';
    return ctx.reply('📨 Send message to store');
  }
});

/* ========================
   📁 FILES
======================== */
bot.hears('📁 My Files', (ctx) => {
  ctx.session.page = 0;
  showUserFiles(ctx);
});

/* ========================
   🔍 SEARCH
======================== */
bot.hears('🔍 Search File', (ctx) => {
  ctx.session.step = 'search';
  ctx.reply('🔍 Send file link or code');
});

/* ========================
   🗑 DELETE ALL
======================== */
bot.hears('🗑 Delete All', async (ctx) => {
  await db.deleteMany({ chatId: ctx.chat.id });
  ctx.reply('🗑 All files deleted');
});

/* ========================
   👑 ADMIN
======================== */
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const users = await db.distinct('chatId');
  const total = await db.countDocuments();

  ctx.reply(`👑 Admin\n👤 Users: ${users.length}\n📁 Files: ${total}`);
});

bot.command('userfiles', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('/userfiles <chatId>');

  ctx.session.adminUser = Number(id);
  ctx.session.page = 0;

  showAdminFiles(ctx);
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session;

  // SET PASSWORD
  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No']
    ]).resize());
  }

  // STORE
  if (s.step === 'send') {
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

    ctx.session = {};

    return ctx.reply(
      `✅ Stored!\n\nhttps://t.me/${ctx.botInfo.username}?start=${id}`,
      mainMenu()
    );
  }

  // PASSWORD CHECK
  if (s.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (ctx.message.text !== stored.password)
      return ctx.reply('❌ Wrong password');

    ctx.session = {};
    return sendStored(ctx, stored);
  }

  // SEARCH
  if (s.step === 'search') {
    const input = ctx.message.text;
    const id = input.split('start=')[1] || input;

    const file = await db.findOne({ uniqueParam: id });

    if (!file) return ctx.reply('❌ Not found');

    ctx.session = {};
    return sendStored(ctx, file);
  }
});

/* ========================
   📤 SEND FILE
======================== */
async function sendStored(ctx, stored) {
  try {
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

  } catch {
    ctx.reply('⚠️ Cannot retrieve file');
  }
}

/* ========================
   📁 PAGINATION
======================== */
async function showUserFiles(ctx) {
  const page = ctx.session.page || 0;

  const files = await db.find({ chatId: ctx.chat.id })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  if (!files.length) return ctx.reply('📭 No files');

  let text = `📁 Page ${page + 1}\n\n`;
  const btn = [];

  files.forEach(f => {
    text += `👁 ${f.views}\n`;

    btn.push([
      Markup.button.callback('📂 Open', `open_${f.uniqueParam}`),
      Markup.button.callback('❌ Delete', `del_${f.uniqueParam}`)
    ]);
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️', 'back'));
  if (files.length === PAGE_SIZE) nav.push(Markup.button.callback('➡️', 'next'));

  if (nav.length) btn.push(nav);

  ctx.reply(text, Markup.inlineKeyboard(btn));
}

async function showAdminFiles(ctx) {
  const page = ctx.session.page || 0;

  const files = await db.find({ chatId: ctx.session.adminUser })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  if (!files.length) return ctx.reply('❌ No files');

  let text = `👤 User Files\n\n`;
  const btn = [];

  files.forEach(f => {
    btn.push([
      Markup.button.callback('📂 Open', `open_${f.uniqueParam}`)
    ]);
  });

  ctx.reply(text, Markup.inlineKeyboard(btn));
}

/* ========================
   🔘 BUTTONS
======================== */
bot.action(/open_(.+)/, async (ctx) => {
  const file = await db.findOne({ uniqueParam: ctx.match[1] });
  if (!file) return ctx.answerCbQuery('Not found');

  await sendStored(ctx, file);
});

bot.action(/del_(.+)/, async (ctx) => {
  await db.deleteOne({ uniqueParam: ctx.match[1] });
  ctx.answerCbQuery('Deleted');
  ctx.editMessageText('❌ Deleted');
});

bot.action('next', (ctx) => {
  ctx.session.page++;
  showUserFiles(ctx);
});

bot.action('back', (ctx) => {
  ctx.session.page = Math.max(0, ctx.session.page - 1);
  showUserFiles(ctx);
});

/* ======================== */
bot.launch();
console.log('🚀 FINAL LEVEL 3 BOT RUNNING');
