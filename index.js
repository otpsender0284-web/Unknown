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
   👤 USER TRACKING
======================== */
async function registerUser(ctx) {
  await users.updateOne(
    { userId: ctx.from.id },
    {
      $set: {
        userId: ctx.from.id,
        banned: false
      }
    },
    { upsert: true }
  );
}

async function isBanned(userId) {
  const user = await users.findOne({ userId });
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
  if (!checkDB(ctx)) return;

  await registerUser(ctx);

  if (await isBanned(ctx.from.id))
    return ctx.reply('🚫 You are banned');

  const param = ctx.startPayload;

  if (param) {
    const stored = await db.findOne({ uniqueParam: param });

    if (!stored) return ctx.reply('🚫 File not found');

    if (stored.password) {
      ctx.session.check = param;
      return ctx.reply('🔐 Enter password');
    }

    return sendStored(ctx, stored);
  }

  ctx.session = {};
  ctx.reply('👋 Welcome LEVEL 5', mainMenu());
});

/* ========================
   📦 STORE FLOW
======================== */
bot.hears('📦 Store Message', async (ctx) => {
  if (await isBanned(ctx.from.id)) return;

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

  ctx.reply('🔐 Add password?', Markup.keyboard([['Yes', 'No']]));
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
    return ctx.reply('📨 Send message');
  }
});

bot.hears('No', (ctx) => {
  if (ctx.session.step === 'password') {
    ctx.session.password = null;
    ctx.session.step = 'onetime';
    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes', 'No']]));
  }

  if (ctx.session.step === 'onetime') {
    ctx.session.oneTime = false;
    ctx.session.step = 'send';
    return ctx.reply('📨 Send message');
  }
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session;

  if (await isBanned(ctx.from.id)) return;

  // PASSWORD INPUT
  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes', 'No']]));
  }

  // STORE
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
      `✅ Stored\n\nhttps://t.me/${ctx.botInfo.username}?start=${id}`,
      mainMenu()
    );
  }

  // SEARCH
  if (s.step === 'search') {
    const id = ctx.message.text.split('start=')[1];

    const file = await db.findOne({ uniqueParam: id });

    if (!file) return ctx.reply('❌ Not found');

    return sendStored(ctx, file);
  }
});

/* ========================
   📤 SEND FILE
======================== */
async function sendStored(ctx, stored) {
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
}

/* ========================
   👑 ADMIN
======================== */
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const totalUsers = await users.countDocuments();
  const totalFiles = await db.countDocuments();

  ctx.reply(`👑 Admin Panel\n👤 Users: ${totalUsers}\n📁 Files: ${totalFiles}`);
});

bot.command('ban', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const id = Number(ctx.message.text.split(' ')[1]);

  await users.updateOne({ userId: id }, { $set: { banned: true } });

  ctx.reply('🚫 User banned');
});

bot.command('unban', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const id = Number(ctx.message.text.split(' ')[1]);

  await users.updateOne({ userId: id }, { $set: { banned: false } });

  ctx.reply('✅ User unbanned');
});

/* ======================== */
bot.launch();
console.log('🚀 LEVEL 5 BOT RUNNING');
