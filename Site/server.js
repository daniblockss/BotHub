const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_URL || '';
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH || path.join(__dirname, '..', 'serviceAccountKey.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'please-change-this-secret';

if (!FIREBASE_DATABASE_URL) {
  console.error('Missing FIREBASE_DATABASE_URL in .env');
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Missing service account key at ${SERVICE_ACCOUNT_PATH}. Please provide SERVICE_ACCOUNT_PATH in .env.`);
  process.exit(1);
}

const serviceAccount = require(path.resolve(SERVICE_ACCOUNT_PATH));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: FIREBASE_DATABASE_URL,
});

const db = admin.database();

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'email'],
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

function verifyFirebaseIdToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const idToken = authHeader.split(' ')[1];
  return admin.auth().verifyIdToken(idToken).catch(() => null);
}

async function requireAuth(req, res, next) {
  const firebaseUser = await verifyFirebaseIdToken(req);
  if (req.isAuthenticated() || firebaseUser) {
    req.firebaseUser = firebaseUser;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

app.get('/config.js', (req, res) => {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
  };
  res.type('application/javascript');
  res.send(`window.FIREBASE_CONFIG = ${JSON.stringify(config)};`);
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.logout(() => {});
  res.redirect('/');
});

app.get('/api/auth', async (req, res) => {
  const firebaseUser = await verifyFirebaseIdToken(req);
  res.json({
    discord: req.user || null,
    firebase: firebaseUser || null,
  });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const configSnapshot = await db.ref('/config').once('value');
  const dataSnapshot = await db.ref('/data').once('value');
  const apisSnapshot = await db.ref('/apis/keys').once('value');

  const apis = apisSnapshot.val() || {};
  const keys = Object.entries(apis).map(([hash, node]) => ({
    hash,
    key: maskKey(node.key),
    status: node.status || 'UNKNOWN',
    cooldown_until: node.cooldown_until || null,
  }));

  res.json({
    config: configSnapshot.val() || {},
    data: dataSnapshot.val() || {},
    keys,
  });
});

app.post('/api/config', requireAuth, async (req, res) => {
  await db.ref('/config').update(req.body || {});
  res.json({ ok: true });
});

app.post('/api/data', requireAuth, async (req, res) => {
  const { key, value } = req.body;
  const allowed = ['identidade', 'regras', 'memoria_geral', 'importantes'];
  if (!allowed.includes(key)) {
    return res.status(400).json({ error: 'Invalid data key' });
  }
  await db.ref(`/data/${key}`).set(value || '');
  res.json({ ok: true });
});

app.get('/api/keys', requireAuth, async (req, res) => {
  const snapshot = await db.ref('/apis/keys').once('value');
  const apis = snapshot.val() || {};
  const keys = Object.entries(apis).map(([hash, node]) => ({
    hash,
    key: maskKey(node.key),
    status: node.status || 'UNKNOWN',
    cooldown_until: node.cooldown_until || null,
  }));
  res.json({ keys });
});

app.post('/api/keys', requireAuth, async (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing key' });
  }
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  await db.ref(`/apis/keys/${hash}`).set({
    key,
    status: 'ACTIVE',
    cooldown_until: null,
  });
  res.json({ ok: true });
});

app.delete('/api/keys/:hash', requireAuth, async (req, res) => {
  const hash = req.params.hash;
  await db.ref(`/apis/keys/${hash}`).remove();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BotHub Site is running on http://localhost:${PORT}`);
});
