const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

const ADMIN_ID = 8065726393;
const ADMIN_USERNAME = "yourusername"; // 👈 change anytime
const FREE_LIMIT = 5;

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
    text += `🆔 ${u.userId}\n💎 ${u.premium}\n🚫 ${u.banned}\n\n`;
  });

  ctx.reply(text);
});

/* ========================
   🧠 MAIN MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session || {};
  const user = await getUser(ctx.from.id);

  if (user.banned) return;

  // 🔥 ADMIN ACTIONS
  if (isAdmin(ctx)) {

    if (s.step === 'broadcast') {
      const all = await users.find().toArray();
      let sent = 0;

      for (const u of all) {
        try {
          await ctx.telegram.copyMessage(u.userId, ctx.chat.id, ctx.message.message_id);
          sent++;
        } catch {}
      }

      ctx.session = {};
      return ctx.reply(`📢 Sent to ${sent}`);
    }

    if (s.step === 'ban') {
      await users.updateOne({ userId: Number(ctx.message.text) }, { $set: { banned: true } });
      ctx.session = {};
      return ctx.reply('🚫 Banned');
    }

    if (s.step === 'unban') {
      await users.updateOne({ userId: Number(ctx.message.text) }, { $set: { banned: false } });
      ctx.session = {};
      return ctx.reply('✅ Unbanned');
    }

    if (s.step === 'premium') {
      await users.updateOne({ userId: Number(ctx.message.text) }, { $set: { premium: true } });
      ctx.session = {};
      return ctx.reply('💎 Premium given');
    }

    if (s.step === 'viewfiles') {
      const files = await db.find({ chatId: Number(ctx.message.text) }).limit(10).toArray();

      let text = '';
      files.forEach(f => text += `${f.uniqueParam}\n`);

      ctx.session = {};
      return ctx.reply(text || 'No files');
    }
  }

  // 🔐 PASSWORD INPUT
  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';
    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes','No']]).resize());
  }

  // 📦 STORE
  if (s.step === 'send') {
    const count = await db.countDocuments({ chatId: ctx.chat.id });

    if (!user.premium && count >= FREE_LIMIT)
      return ctx.reply('⚠️ Upgrade to premium');

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

  // 🔐 PASSWORD CHECK
  if (s.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (ctx.message.text !== stored.password)
      return ctx.reply('❌ Wrong password');

    ctx.session = {};
    return sendStored(ctx, stored);
  }

  // 🔍 SEARCH
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

/* ========================
   ADMIN BUTTONS
======================== */
bot.hears('📢 Broadcast', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'broadcast';
  ctx.reply('Send message/media');
});

bot.hears('🚫 Ban', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'ban';
  ctx.reply('Send user ID');
});

bot.hears('✅ Unban', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'unban';
  ctx.reply('Send user ID');
});

bot.hears('💎 Give Premium', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'premium';
  ctx.reply('Send user ID');
});

bot.hears('📁 User Files', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'viewfiles';
  ctx.reply('Send user ID');
});

/* ========================
   PREMIUM BUTTON FIX
======================== */
bot.hears('💎 Premium', (ctx) => {
  ctx.reply(`💎 Contact: @${ADMIN_USERNAME}`);
});
