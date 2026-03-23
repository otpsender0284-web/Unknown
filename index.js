const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

const ADMIN_ID = 8065726393;
const ADMIN_USERNAME = "yourusername";

/* ========================
   💾 DB INIT
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

const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

/* ========================
   🎛️ MENUS
======================== */
const userMenu = () =>
  Markup.keyboard([
    ['📦 Store Message', '📁 My Files'],
    ['🔍 Search', '👥 Refer & Earn'],
    ['💎 Premium', '🗑 Delete All']
  ]).resize();

const adminMenu = () =>
  Markup.keyboard([
    ['📊 Stats', '👥 Users'],
    ['📢 Broadcast', '🚫 Ban'],
    ['✅ Unban', '💎 Give Premium'],
    ['📁 User Files'],
    ['⬅️ Exit Admin']
  ]).resize();

/* ========================
   🚀 START
======================== */
bot.start(async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user.banned) return ctx.reply('🚫 You are banned');

  const param = ctx.startPayload;

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
  ctx.reply('👋 Welcome!', userMenu());
});

/* ========================
   👑 ADMIN PANEL
======================== */
bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.admin = true;
  ctx.reply('👑 Admin Panel', adminMenu());
});

bot.hears('⬅️ Exit Admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.admin = false;
  ctx.reply('Exited admin', userMenu());
});

/* ========================
   📊 STATS
======================== */
bot.hears('📊 Stats', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const totalFiles = await db.countDocuments();
  const allUsers = await users.find().toArray();

  let totalSize = 0;
  const files = await db.find().toArray();
  files.forEach(f => totalSize += f.fileSize || 0);

  ctx.reply(
    `📊 Stats\n\n👤 Users: ${allUsers.length}\n📁 Files: ${totalFiles}\n💾 ${(totalSize/1024/1024).toFixed(2)} MB`
  );
});

/* ========================
   👥 USERS
======================== */
bot.hears('👥 Users', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const list = await users.find().limit(20).toArray();

  let text = '👥 Users:\n\n';

  list.forEach(u => {
    text += `🆔 ${u.userId}\n🚫 ${u.banned}\n\n`;
  });

  ctx.reply(text);
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

  ctx.reply('🔐 Add password?', Markup.keyboard([['Yes','No']]).resize());
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
    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes','No']]).resize());
  }

  if (ctx.session?.step === 'onetime') {
    ctx.session.oneTime = false;
    ctx.session.step = 'send';
    return ctx.reply('📤 Send file (photo/video/document/text)', Markup.removeKeyboard());
  }
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session || {};
  const user = await getUser(ctx.from.id);

  if (user.banned) return;

  // PASSWORD INPUT
  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';
    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes','No']]).resize());
  }

  // STORE (FREE FOR ALL)
  if (s.step === 'send') {
    const id = Math.random().toString(36).substring(2, 10);

    const size =
      ctx.message?.document?.file_size ||
      ctx.message?.video?.file_size ||
      ctx.message?.photo?.slice(-1)[0]?.file_size ||
      0;

    await db.insertOne({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      messageId: ctx.message.message_id,
      uniqueParam: id,
      expiresAt: s.expiresAt,
      password: s.password,
      oneTime: s.oneTime,
      views: 0,
      fileSize: size
    });

    console.log(`📥 Stored by ${ctx.from.id}`);

    ctx.session = {};

    return ctx.reply(
      `✅ Stored\n\nhttps://t.me/${ctx.botInfo.username}?start=${id}`,
      userMenu()
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
});

/* ========================
   📤 SEND FILE
======================== */
async function sendStored(ctx, stored) {
  try {
    await ctx.telegram.copyMessage(ctx.chat.id, stored.chatId, stored.messageId);

    await db.updateOne(
      { uniqueParam: stored.uniqueParam },
      { $inc: { views: 1 } }
    );

    console.log(`📤 Viewed ${stored.uniqueParam}`);

    if (stored.oneTime) {
      await db.deleteOne({ uniqueParam: stored.uniqueParam });
    }

  } catch {
    ctx.reply('⚠️ Cannot retrieve file');
  }
              }
