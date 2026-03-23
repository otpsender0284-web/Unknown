const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

const ADMIN_ID = 8065726393;
const ADMIN_USERNAME = "yourusername";

/* ================= DB ================= */
const client = new MongoClient(process.env.MONGO_URI);
let db, users;

(async () => {
  await client.connect();
  const database = client.db('telegramBot');
  db = database.collection('files');
  users = database.collection('users');

  console.log('✅ DB Connected');
  bot.launch();
})();

/* ================= USER ================= */
async function getUser(id) {
  let user = await users.findOne({ userId: id });

  if (!user) {
    user = {
      userId: id,
      banned: false,
      referrals: 0,
      joined: Date.now()
    };
    await users.insertOne(user);
  }

  return user;
}

const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

/* ================= MENUS ================= */
const userMenu = () =>
  Markup.keyboard([
    ['📦 Store', '📁 Files'],
    ['🔍 Search'],
    ['👥 Refer', '🗑 Clear']
  ]).resize();

const adminMenu = () =>
  Markup.keyboard([
    ['📊 Stats', '👥 Users'],
    ['📢 Broadcast', '🚫 Ban'],
    ['✅ Unban', '📁 User Files'],
    ['⬅️ Exit Admin']
  ]).resize();

/* ================= START (FIXED) ================= */
bot.start(async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user.banned) return ctx.reply('🚫 You are banned');

  const param = ctx.startPayload;

  // 🔗 OPEN STORED FILE (FIXED)
  if (param) {
    try {
      const stored = await db.findOne({ uniqueParam: param });

      if (!stored) return ctx.reply('🚫 File not found');

      if (stored.expiresAt && Date.now() > stored.expiresAt)
        return ctx.reply('⏳ Link expired');

      if (stored.password) {
        ctx.session.check = param;
        return ctx.reply('🔐 Enter password');
      }

      return sendStored(ctx, stored);

    } catch (err) {
      console.log(err);
      return ctx.reply('⚠️ Error opening file');
    }
  }

  ctx.session = {};
  ctx.reply('👋 Welcome!', userMenu());
});

/* ================= ADMIN ================= */
bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.admin = true;
  ctx.reply('👑 Admin Panel', adminMenu());
});

bot.hears('⬅️ Exit Admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session = {};
  ctx.reply('Exited admin', userMenu());
});

/* ================= STORE FLOW ================= */
bot.hears('📦 Store', (ctx) => {
  ctx.session = { step: 'expiry' };

  ctx.reply('⏳ Select expiry:', Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never']
  ]).resize());
});

/* ================= MAIN HANDLER ================= */
bot.on('message', async (ctx) => {
  const s = ctx.session || {};
  const user = await getUser(ctx.from.id);
  if (user.banned) return;

  /* ===== EXPIRY ===== */
  if (s.step === 'expiry') {
    const map = {
      '10 min': 600000,
      '1 hour': 3600000,
      '1 day': 86400000
    };

    s.expiresAt = ctx.message.text === 'Never'
      ? null
      : Date.now() + map[ctx.message.text];

    s.step = 'password';

    return ctx.reply('🔐 Add password?', Markup.keyboard([['Yes','No']]).resize());
  }

  /* ===== PASSWORD ===== */
  if (s.step === 'password') {
    if (ctx.message.text === 'Yes') {
      s.step = 'set_password';
      return ctx.reply('🔐 Send password');
    } else {
      s.password = null;
      s.step = 'onetime';
      return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes','No']]).resize());
    }
  }

  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';
    return ctx.reply('👁 One-time view?', Markup.keyboard([['Yes','No']]).resize());
  }

  if (s.step === 'onetime') {
    s.oneTime = ctx.message.text === 'Yes';
    s.step = 'send';

    return ctx.reply(
      '📤 Send your file (photo/video/document/text)',
      Markup.removeKeyboard()
    );
  }

  /* ===== STORE ===== */
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
      userMenu()
    );
  }

  /* ===== PASSWORD CHECK ===== */
  if (s.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (!stored) {
      ctx.session = {};
      return ctx.reply('🚫 File not found');
    }

    if (ctx.message.text !== stored.password)
      return ctx.reply('❌ Wrong password');

    ctx.session = {};
    return sendStored(ctx, stored);
  }

  /* ===== SEARCH ===== */
  if (ctx.message.text === '🔍 Search') {
    ctx.session.step = 'search';
    return ctx.reply('Send link/code');
  }

  if (s.step === 'search') {
    const id = ctx.message.text.split('start=')[1] || ctx.message.text;
    const file = await db.findOne({ uniqueParam: id });

    if (!file) return ctx.reply('❌ Not found');

    ctx.session = {};
    return sendStored(ctx, file);
  }

  /* ===== MY FILES ===== */
  if (ctx.message.text === '📁 Files') {
    const files = await db.find({ chatId: ctx.chat.id }).limit(10).toArray();

    if (!files.length) return ctx.reply('📭 No files');

    let text = '📁 Your Files:\n\n';
    files.forEach(f => {
      text += `🔗 https://t.me/${ctx.botInfo.username}?start=${f.uniqueParam}\n👁 ${f.views}\n\n`;
    });

    return ctx.reply(text);
  }

  /* ===== DELETE ALL ===== */
  if (ctx.message.text === '🗑 Clear') {
    await db.deleteMany({ chatId: ctx.chat.id });
    return ctx.reply('🗑 All files deleted');
  }

  /* ===== REF ===== */
  if (ctx.message.text === '👥 Refer') {
    return ctx.reply('Invite feature active');
  }

  /* ===== ADMIN ===== */
  if (isAdmin(ctx)) {
    if (ctx.message.text === '📊 Stats') {
      const u = await users.countDocuments();
      const f = await db.countDocuments();
      return ctx.reply(`👤 Users: ${u}\n📁 Files: ${f}`);
    }

    if (ctx.message.text === '👥 Users') {
      const list = await users.find().limit(20).toArray();
      return ctx.reply(list.map(u => u.userId).join('\n'));
    }

    if (ctx.message.text === '📢 Broadcast') {
      ctx.session.step = 'broadcast';
      return ctx.reply('Send message/media');
    }

    if (s.step === 'broadcast') {
      const all = await users.find().toArray();
      for (const u of all) {
        try {
          await ctx.telegram.copyMessage(u.userId, ctx.chat.id, ctx.message.message_id);
        } catch {}
      }
      ctx.session = {};
      return ctx.reply('✅ Broadcast done');
    }
  }
});

/* ================= SEND ================= */
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

  } catch (err) {
    console.log(err);
    ctx.reply('⚠️ Cannot send file');
  }
}
