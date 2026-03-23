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
    ['📦 Store Message', '📁 My Files'],
    ['🔍 Search', '👥 Refer & Earn'],
    ['💎 Premium', '🗑 Delete All']
  ]).resize();

const adminMenu = () =>
  Markup.keyboard([
    ['📊 Stats', '👥 Users'],
    ['📢 Broadcast', '🚫 Ban'],
    ['✅ Unban', '📁 User Files'],
    ['⬅️ Exit Admin']
  ]).resize();

/* ================= START ================= */
bot.start(async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user.banned) return ctx.reply('🚫 You are banned');

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
  ctx.session.admin = false;
  ctx.reply('Exited admin', userMenu());
});

/* ================= BUTTON HANDLERS ================= */

// STORE START
bot.hears('📦 Store Message', (ctx) => {
  ctx.session = { step: 'expiry' };

  ctx.reply('⏳ Select expiry:', Markup.keyboard([
    ['10 min', '1 hour'],
    ['1 day', 'Never']
  ]));
});

// MY FILES
bot.hears('📁 My Files', async (ctx) => {
  const files = await db.find({ chatId: ctx.chat.id }).limit(10).toArray();

  if (!files.length) return ctx.reply('📭 No files');

  let text = '📁 Your Files:\n\n';

  files.forEach(f => {
    text += `🔗 https://t.me/${ctx.botInfo.username}?start=${f.uniqueParam}\n👁 ${f.views}\n\n`;
  });

  ctx.reply(text);
});

// SEARCH
bot.hears('🔍 Search', (ctx) => {
  ctx.session.step = 'search';
  ctx.reply('Send file link/code');
});

// DELETE ALL
bot.hears('🗑 Delete All', async (ctx) => {
  await db.deleteMany({ chatId: ctx.chat.id });
  ctx.reply('🗑 Deleted all files');
});

// PREMIUM (INFO ONLY)
bot.hears('💎 Premium', (ctx) => {
  ctx.reply(`💎 Contact: @${ADMIN_USERNAME}`);
});

// REFERRAL
bot.hears('👥 Refer & Earn', (ctx) => {
  ctx.reply('Invite feature active');
});

/* ================= ADMIN BUTTONS ================= */

bot.hears('📊 Stats', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const usersCount = await users.countDocuments();
  const files = await db.countDocuments();

  ctx.reply(`👤 Users: ${usersCount}\n📁 Files: ${files}`);
});

bot.hears('👥 Users', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const list = await users.find().limit(20).toArray();

  let text = 'Users:\n\n';
  list.forEach(u => text += `${u.userId}\n`);

  ctx.reply(text);
});

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

bot.hears('📁 User Files', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'viewfiles';
  ctx.reply('Send user ID');
});

/* ================= MESSAGE HANDLER ================= */

bot.on('message', async (ctx) => {
  const s = ctx.session || {};
  const user = await getUser(ctx.from.id);
  if (user.banned) return;

  // EXPIRY
  if (s.step === 'expiry') {
    const map = {
      '10 min': 600000,
      '1 hour': 3600000,
      '1 day': 86400000
    };

    s.expiresAt = ctx.message.text === 'Never' ? null : Date.now() + map[ctx.message.text];
    s.step = 'password';

    return ctx.reply('🔐 Add password?', Markup.keyboard([['Yes','No']]));
  }

  // PASSWORD
  if (s.step === 'password') {
    if (ctx.message.text === 'Yes') {
      s.step = 'set_password';
      return ctx.reply('Send password');
    } else {
      s.password = null;
      s.step = 'onetime';
      return ctx.reply('👁 One-time?', Markup.keyboard([['Yes','No']]));
    }
  }

  if (s.step === 'set_password') {
    s.password = ctx.message.text;
    s.step = 'onetime';
    return ctx.reply('👁 One-time?', Markup.keyboard([['Yes','No']]));
  }

  if (s.step === 'onetime') {
    s.oneTime = ctx.message.text === 'Yes';
    s.step = 'send';
    return ctx.reply('📤 Send file now', Markup.removeKeyboard());
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

    return ctx.reply(`Stored:\nhttps://t.me/${ctx.botInfo.username}?start=${id}`, userMenu());
  }

  // SEARCH
  if (s.step === 'search') {
    const id = ctx.message.text.split('start=')[1] || ctx.message.text;
    const file = await db.findOne({ uniqueParam: id });

    if (!file) return ctx.reply('Not found');

    return sendStored(ctx, file);
  }

  // ADMIN ACTIONS
  if (isAdmin(ctx)) {
    if (s.step === 'broadcast') {
      const all = await users.find().toArray();
      for (const u of all) {
        try {
          await ctx.telegram.copyMessage(u.userId, ctx.chat.id, ctx.message.message_id);
        } catch {}
      }
      ctx.session = {};
      return ctx.reply('Broadcast done');
    }

    if (s.step === 'ban') {
      await users.updateOne({ userId: Number(ctx.message.text) }, { $set: { banned: true } });
      ctx.session = {};
      return ctx.reply('Banned');
    }

    if (s.step === 'unban') {
      await users.updateOne({ userId: Number(ctx.message.text) }, { $set: { banned: false } });
      ctx.session = {};
      return ctx.reply('Unbanned');
    }

    if (s.step === 'viewfiles') {
      const files = await db.find({ chatId: Number(ctx.message.text) }).toArray();
      ctx.reply(files.map(f => f.uniqueParam).join('\n') || 'No files');
      ctx.session = {};
      return;
    }
  }
});

/* ================= SEND ================= */
async function sendStored(ctx, stored) {
  try {
    await ctx.telegram.copyMessage(ctx.chat.id, stored.chatId, stored.messageId);
  } catch {
    ctx.reply('Error sending');
  }
}
