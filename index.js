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
let db, users;

async function initDB() {
  await client.connect();
  const database = client.db('telegramBot');
  db = database.collection('files');
  users = database.collection('users');
  console.log('✅ MongoDB Connected');
}
initDB();

/* ========================
   👤 USER SYSTEM
======================== */
async function registerUser(ctx) {
  await users.updateOne(
    { userId: ctx.from.id },
    { $set: { userId: ctx.from.id, banned: false } },
    { upsert: true }
  );
}

async function isBanned(id) {
  const user = await users.findOne({ userId: id });
  return user?.banned;
}

/* ========================
   🎛️ MENU
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
  await registerUser(ctx);

  if (await isBanned(ctx.from.id))
    return ctx.reply('🚫 You are banned');

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
   🔐 PASSWORD FLOW
======================== */
bot.hears('Yes', (ctx) => {
  if (ctx.session.step === 'password') {
    ctx.session.step = 'set_password';
    return ctx.reply('🔐 Send password');
  }

  if (ctx.session.step === 'onetime') {
    ctx.session.oneTime = true;
    ctx.session.step = 'send';

    return ctx.reply(
      '📤 Now send your file (photo/video/document/text)',
      Markup.removeKeyboard()
    );
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

    return ctx.reply(
      '📤 Now send your file (photo/video/document/text)',
      Markup.removeKeyboard()
    );
  }
});

/* ========================
   📁 MY FILES
======================== */
bot.hears('📁 My Files', async (ctx) => {
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

  const totalUsers = await users.countDocuments();
  const totalFiles = await db.countDocuments();

  ctx.reply(`👑 Admin\n👤 Users: ${totalUsers}\n📁 Files: ${totalFiles}`);
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx, next) => {
  const s = ctx.session;

  if (await isBanned(ctx.from.id)) return;

  // PASSWORD INPUT
  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([
      ['Yes', 'No']
    ]).resize());
  }

  // STORE FILE
  if (s.step === 'send') {
    const id = Math.random().toString(36).substring(2, 10);

    await db.insertOne({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      messageId: ctx.message.message_id,
      uniqueParam: id,
      expiresAt: s.expiresAt,
      password: s.password,
      oneTime: s.oneTime,
      views: 0
    });

    ctx.session = {};

    return ctx.reply(
      `✅ Stored successfully!\n\nhttps://t.me/${ctx.botInfo.username}?start=${id}`,
      mainMenu()
    );
  }

  // SEARCH
  if (s.step === 'search') {
    const id = ctx.message.text.split('start=')[1] || ctx.message.text;

    const file = await db.findOne({ uniqueParam: id });

    if (!file) return ctx.reply('❌ Not found');

    ctx.session = {};
    return sendStored(ctx, file);
  }

  // PASSWORD CHECK
  if (s.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (ctx.message.text !== stored.password)
      return ctx.reply('❌ Wrong password');

    ctx.session = {};
    return sendStored(ctx, stored);
  }

  return next();
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
  const files = await db.find({ chatId: ctx.chat.id }).limit(5).toArray();

  if (!files.length) return ctx.reply('📭 No files');

  let text = '📁 Your Files\n\n';
  const btn = [];

  files.forEach(f => {
    text += `👁 ${f.views}\n`;

    btn.push([
      Markup.button.callback('📂 Open', `open_${f.uniqueParam}`),
      Markup.button.callback('❌ Delete', `del_${f.uniqueParam}`)
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

/* ======================== */
bot.launch();
console.log('🚀 FINAL UX FIX BOT RUNNING');
