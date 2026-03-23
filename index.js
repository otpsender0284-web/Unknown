const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

const ADMIN_ID = 8065726393;
const FREE_LIMIT = 5;

/* ========================
   💾 DB INIT (FIXED)
======================== */
const client = new MongoClient(process.env.MONGO_URI);
let db, users;

async function startBot() {
  await client.connect();

  const database = client.db('telegramBot');
  db = database.collection('files');
  users = database.collection('users');

  console.log('✅ DB Connected');

  bot.launch();
  console.log('🚀 BOT RUNNING');
}
startBot();

/* ========================
   👤 USER SYSTEM
======================== */
async function getUser(id) {
  let user = await users.findOne({ userId: id });

  if (!user) {
    user = {
      userId: id,
      premium: false,
      banned: false,
      referrals: 0,
      referredUsers: [],
      joined: Date.now()
    };
    await users.insertOne(user);
  }

  return user;
}

/* ========================
   🎛️ MENU
======================== */
const menu = () =>
  Markup.keyboard([
    ['📦 Store Message', '📁 My Files'],
    ['🔍 Search', '👥 Refer & Earn'],
    ['💎 Premium', '🗑 Delete All']
  ]).resize();

/* ========================
   🚀 START + LINK + REF
======================== */
bot.start(async (ctx) => {
  const user = await getUser(ctx.from.id);

  if (user.banned) return ctx.reply('🚫 You are banned');

  const param = ctx.startPayload;

  // 🔗 FILE OPEN
  if (param && !param.startsWith('ref_')) {
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

  // 👥 REFERRAL
  if (param && param.startsWith('ref_')) {
    const refId = Number(param.split('_')[1]);

    if (refId !== ctx.from.id) {
      await users.updateOne(
        { userId: refId, referredUsers: { $ne: ctx.from.id } },
        {
          $inc: { referrals: 1 },
          $push: { referredUsers: ctx.from.id }
        }
      );
    }
  }

  ctx.session = {};
  ctx.reply('👋 Welcome!', menu());
});

/* ========================
   📦 STORE FLOW
======================== */
bot.hears('📦 Store Message', (ctx) => {
  ctx.session = { step: 'expiry' };

  ctx.reply('⏳ Select expiry:', Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never']
  ]).resize());
});

/* ========================
   ⏳ EXPIRY
======================== */
bot.hears(['10 min', '1 hour', '1 day', 'Never'], (ctx) => {
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

  ctx.reply('🔐 Add password?', Markup.keyboard([['Yes', 'No']]).resize());
});

/* ========================
   🔐 PASSWORD FLOW
======================== */
bot.hears('Yes', (ctx) => {
  if (ctx.session?.step === 'password') {
    ctx.session.step = 'set_password';
    return ctx.reply('🔐 Send password');
  }

  if (ctx.session?.step === 'onetime') {
    ctx.session.oneTime = true;
    ctx.session.step = 'send';

    return ctx.reply('📤 Send file (photo/video/document/text)', Markup.removeKeyboard());
  }
});

bot.hears('No', (ctx) => {
  if (ctx.session?.step === 'password') {
    ctx.session.password = null;
    ctx.session.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes', 'No']]).resize());
  }

  if (ctx.session?.step === 'onetime') {
    ctx.session.oneTime = false;
    ctx.session.step = 'send';

    return ctx.reply('📤 Send file (photo/video/document/text)', Markup.removeKeyboard());
  }
});

/* ========================
   📁 MY FILES
======================== */
bot.hears('📁 My Files', async (ctx) => {
  const files = await db.find({ chatId: ctx.chat.id }).limit(10).toArray();

  if (!files.length) return ctx.reply('📭 No files');

  let text = '📁 Your Files:\n\n';

  files.forEach(f => {
    text += `🔗 https://t.me/${ctx.botInfo.username}?start=${f.uniqueParam}\n👁 ${f.views}\n\n`;
  });

  ctx.reply(text);
});

/* ========================
   🔍 SEARCH
======================== */
bot.hears('🔍 Search', (ctx) => {
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
   👥 REFERRAL
======================== */
bot.hears('👥 Refer & Earn', async (ctx) => {
  const link = `https://t.me/${ctx.botInfo.username}?start=ref_${ctx.from.id}`;
  ctx.reply(`👥 Invite & Earn:\n\n${link}`);
});

/* ========================
   💎 PREMIUM
======================== */
bot.hears('💎 Premium', (ctx) => {
  ctx.reply('💎 Contact admin to upgrade');
});

/* ========================
   🧠 MESSAGE HANDLER (FIXED)
======================== */
bot.on('message', async (ctx, next) => {
  const s = ctx.session || {};
  const user = await getUser(ctx.from.id);

  if (user.banned) return;

  // Anti-spam
  if (!s.last) s.last = 0;
  if (Date.now() - s.last < 800) return;
  s.last = Date.now();

  // PASSWORD INPUT
  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';

    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes', 'No']]).resize());
  }

  // STORE FILE
  if (s.step === 'send') {
    const count = await db.countDocuments({ chatId: ctx.chat.id });

    if (!user.premium && count >= FREE_LIMIT) {
      return ctx.reply('⚠️ Upgrade to premium');
    }

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
      `✅ Stored!\n\nhttps://t.me/${ctx.botInfo.username}?start=${id}`,
      menu()
    );
  }

  // PASSWORD CHECK
  if (s.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (!stored) return ctx.reply('🚫 File not found');

    if (ctx.message.text !== stored.password)
      return ctx.reply('❌ Wrong password');

    ctx.session = {};
    return sendStored(ctx, stored);
  }

  // SEARCH
  if (s.step === 'search') {
    const id = ctx.message.text.split('start=')[1] || ctx.message.text;

    const file = await db.findOne({ uniqueParam: id });

    if (!file) return ctx.reply('❌ Not found');

    ctx.session = {};
    return sendStored(ctx, file);
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
