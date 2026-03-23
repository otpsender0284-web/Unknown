const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');

if (global.botRunning) return;
global.botRunning = true;

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

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
   🛡️ DB CHECK
======================== */
function checkDB(ctx) {
  if (!db) {
    ctx.reply('⏳ Server starting...');
    return false;
  }
  return true;
}

/* ========================
   ⚡ ANIMATION
======================== */
const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function animate(ctx, steps) {
  try {
    let msg = await ctx.reply(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      await wait(400);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        steps[i]
      ).catch(() => {});
    }
    await ctx.deleteMessage(msg.message_id).catch(() => {});
  } catch {}
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
   🚀 START
======================== */
bot.start(async (ctx) => {
  if (!checkDB(ctx)) return;

  const param = ctx.startPayload;

  if (param) {
    const stored = await db.findOne({ uniqueParam: param });

    if (!stored) return ctx.reply('🚫 File not found');
    if (stored.expiresAt && Date.now() > stored.expiresAt)
      return ctx.reply('⏳ Expired');

    if (stored.password) {
      ctx.session = { check: param };
      return ctx.reply('🔐 Enter password');
    }

    return sendStored(ctx, stored);
  }

  ctx.session = { step: 'menu' };

  await animate(ctx, ['🔄 Starting...', '⚡ Loading...', '🚀 Ready']);

  ctx.reply('👋 Welcome!', mainMenu());
});

/* ========================
   👑 ADMIN COMMAND
======================== */
bot.command('userfiles', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('/userfiles <chatId>');

  ctx.session.adminUser = Number(id);
  ctx.session.page = 0;

  showAdminFiles(ctx);
});

/* ========================
   📁 USER FILES (BUTTON UI)
======================== */
bot.hears('📁 My Files', async (ctx) => {
  if (!checkDB(ctx)) return;

  ctx.session.page = 0;
  showUserFiles(ctx);
});

async function showUserFiles(ctx) {
  const page = ctx.session.page || 0;

  const files = await db.find({ chatId: ctx.chat.id })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  if (!files.length) return ctx.reply('📭 No files');

  let text = `📁 Your Files (Page ${page + 1})\n\n`;
  const btn = [];

  files.forEach(f => {
    text += `👁 ${f.views}\n\n`;

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

/* ========================
   👑 ADMIN VIEW FILES
======================== */
async function showAdminFiles(ctx) {
  const page = ctx.session.page || 0;

  const files = await db.find({ chatId: ctx.session.adminUser })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  if (!files.length) return ctx.reply('❌ No files');

  let text = `👤 User Files (Page ${page + 1})\n\n`;
  const btn = [];

  files.forEach(f => {
    text += `👁 ${f.views}\n\n`;

    btn.push([
      Markup.button.callback('📂 Open', `open_${f.uniqueParam}`),
      Markup.button.callback('❌ Delete', `del_${f.uniqueParam}`)
    ]);
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️', 'admin_back'));
  if (files.length === PAGE_SIZE) nav.push(Markup.button.callback('➡️', 'admin_next'));

  if (nav.length) btn.push(nav);

  ctx.reply(text, Markup.inlineKeyboard(btn));
}

/* ========================
   🔘 BUTTON ACTIONS
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

/* ========================
   🔁 PAGINATION
======================== */
bot.action('next', (ctx) => {
  ctx.session.page++;
  showUserFiles(ctx);
});

bot.action('back', (ctx) => {
  ctx.session.page = Math.max(0, ctx.session.page - 1);
  showUserFiles(ctx);
});

bot.action('admin_next', (ctx) => {
  ctx.session.page++;
  showAdminFiles(ctx);
});

bot.action('admin_back', (ctx) => {
  ctx.session.page = Math.max(0, ctx.session.page - 1);
  showAdminFiles(ctx);
});

/* ========================
   🧠 MESSAGE HANDLER
======================== */
bot.on('message', async (ctx) => {
  const s = ctx.session;

  if (s?.step === 'send') {
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

    const link = `https://t.me/${ctx.botInfo.username}?start=${id}`;
    ctx.session = null;

    return ctx.reply(`✅ Stored\n\n${link}`, mainMenu());
  }

  if (s?.check) {
    const stored = await db.findOne({ uniqueParam: s.check });

    if (ctx.message.text !== stored.password)
      return ctx.reply('❌ Wrong password');

    ctx.session = null;
    return sendStored(ctx, stored);
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

    if (stored.oneTime) {
      await db.deleteOne({ uniqueParam: stored.uniqueParam });
    }

  } catch (err) {
    console.log(err);
    ctx.reply('⚠️ Error sending file');
  }
}

/* ========================
   🧹 AUTO CLEAN
======================== */
setInterval(async () => {
  if (!db) return;

  await db.deleteMany({
    expiresAt: { $ne: null, $lt: Date.now() }
  });

  console.log('🧹 Cleaned expired files');
}, 3600000);

/* ======================== */
bot.launch();
console.log('🚀 LEVEL 2 BOT RUNNING');
