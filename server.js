const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

loadEnv();

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = process.env.VERCEL ? path.join("/tmp", "suivi-tv-data") : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "database.json");
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/";
const LOCAL_USER_ID = process.env.APP_USER_ID || "local-user";
const LOCAL_USER_NAME = process.env.APP_USER_NAME || "Alex";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const TRENDING_CACHE_TTL_MS = 1000 * 60 * 10;
const UPCOMING_REFRESH_TTL_MS = 1000 * 60 * 60 * 6;
const memoryCache = new Map();
const upcomingRefreshCache = new Map();

const fallbackCatalog = [
  { mediaType: "tv", tmdbId: 100088, title: "The Last of Us", year: 2023 },
  { mediaType: "tv", tmdbId: 1396, title: "Breaking Bad", year: 2008 },
  { mediaType: "tv", tmdbId: 70523, title: "Dark", year: 2017 },
  { mediaType: "tv", tmdbId: 76479, title: "The Boys", year: 2019 },
  { mediaType: "tv", tmdbId: 94605, title: "Arcane", year: 2021 },
  { mediaType: "tv", tmdbId: 106379, title: "Fallout", year: 2024 },
  { mediaType: "tv", tmdbId: 95396, title: "Severance", year: 2022 },
  { mediaType: "tv", tmdbId: 95557, title: "Invincible", year: 2021 },
  { mediaType: "movie", tmdbId: 550, title: "Fight Club", year: 1999 },
  { mediaType: "movie", tmdbId: 603, title: "The Matrix", year: 1999 }
];

const fallbackDetails = {
  "tv:100088": {
    mediaType: "tv",
    tmdbId: 100088,
    title: "The Last of Us",
    year: 2023,
    genres: ["Drame", "Science-fiction"],
    rating: 4.8,
    poster: "https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/900tHlUYUkp7Ol04XFSoAaEIXcT.jpg",
    synopsis: "Joel et Ellie traversent un monde brutal apres l'effondrement de la civilisation moderne.",
    seasons: [9, 7],
    nextAir: null
  },
  "tv:1396": {
    mediaType: "tv",
    tmdbId: 1396,
    title: "Breaking Bad",
    year: 2008,
    genres: ["Drame", "Crime"],
    rating: 4.9,
    poster: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
    synopsis: "Un professeur de chimie transforme sa vie et son entourage apres un diagnostic brutal.",
    seasons: [7, 13, 13, 13, 16],
    nextAir: null
  },
  "tv:70523": {
    mediaType: "tv",
    tmdbId: 70523,
    title: "Dark",
    year: 2017,
    genres: ["Mystere", "Science-fiction"],
    rating: 4.8,
    poster: "https://image.tmdb.org/t/p/w500/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/3lBDg3i6nn5R2NKFCJ6oKyUo2j5.jpg",
    synopsis: "La disparition d'un enfant expose les fractures temporelles d'une ville allemande.",
    seasons: [10, 8, 8],
    nextAir: null
  }
};

ensureLocalDb();

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, error.statusCode || 500, normalizeServerError(error));
  }
}

if (require.main === module) {
  const server = http.createServer(requestHandler);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Le port ${PORT} est deja utilise. Ferme l'autre serveur ou lance avec: $env:PORT=4174; npm start`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(PORT, () => {
    const storage = hasSupabaseConfig() ? "Supabase" : "base locale";
    console.log(`Suivi TV disponible sur http://localhost:${PORT} (${storage})`);
  });
}

module.exports = requestHandler;

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      storage: hasSupabaseConfig() ? "supabase" : "local",
      tmdb: hasTmdbAuth()
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readBody(req);
    const session = await registerAccount(body.email, body.password, body.name);
    sendJson(res, 201, session);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const session = await loginAccount(body.email, body.password);
    sendJson(res, 200, session);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    const user = await getSessionUser(req);
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await logoutSession(req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/profile") {
    const sessionUser = await requireSession(req);
    const body = await readBody(req);
    const user = await updateProfile(sessionUser.id, body);
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const sessionUser = await requireSession(req);
    const db = await readDb(sessionUser.id);
    await ensureUser(db, sessionUser);
    scheduleUpcomingAirRefresh(sessionUser.id, db);
    sendJson(res, 200, { user: sessionUser, library: enrichLibrary(db), social: enrichSocial(db, sessionUser.id) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/trending") {
    const items = await getTrending();
    sendJson(res, 200, { items });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/recommendations") {
    const sessionUser = await requireSession(req);
    const db = await readDb(sessionUser.id);
    const items = await getRecommendations(db);
    sendJson(res, 200, { items });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = url.searchParams.get("query") || "";
    const items = await searchMedia(query);
    sendJson(res, 200, { items });
    return;
  }

  const mediaMatch = url.pathname.match(/^\/api\/media\/(tv|movie)\/(\d+)$/);
  if (req.method === "GET" && mediaMatch) {
    const media = await getMediaDetails(mediaMatch[1], Number(mediaMatch[2]));
    sendJson(res, 200, { media });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/library") {
    const sessionUser = await requireSession(req);
    const body = await readBody(req);
    const item = await addLibraryItem(sessionUser.id, body.mediaType, Number(body.tmdbId), body.status || "planned");
    sendJson(res, 201, { item });
    return;
  }

  const libraryMatch = url.pathname.match(/^\/api\/library\/(tv|movie)\/(\d+)$/);
  if (libraryMatch && req.method === "DELETE") {
    const sessionUser = await requireSession(req);
    await removeLibraryItem(sessionUser.id, libraryMatch[1], Number(libraryMatch[2]));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (libraryMatch && req.method === "PATCH") {
    const sessionUser = await requireSession(req);
    const body = await readBody(req);
    const item = await updateLibraryItem(sessionUser.id, libraryMatch[1], Number(libraryMatch[2]), body);
    sendJson(res, 200, { item });
    return;
  }

  const seenMatch = url.pathname.match(/^\/api\/library\/(tv|movie)\/(\d+)\/seen$/);
  if (seenMatch && req.method === "POST") {
    const sessionUser = await requireSession(req);
    const item = await markNextSeen(sessionUser.id, seenMatch[1], Number(seenMatch[2]));
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/friends") {
    const sessionUser = await requireSession(req);
    const body = await readBody(req);
    const social = await addFriend(sessionUser.id, String(body.friendId || "").trim(), String(body.name || "").trim());
    sendJson(res, 201, { social });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lists") {
    const sessionUser = await requireSession(req);
    const body = await readBody(req);
    const list = await createList(sessionUser.id, String(body.name || "").trim(), String(body.description || "").trim());
    sendJson(res, 201, { list });
    return;
  }

  const listItemMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/items$/);
  if (req.method === "POST" && listItemMatch) {
    const sessionUser = await requireSession(req);
    const body = await readBody(req);
    const list = await addListItem(sessionUser.id, listItemMatch[1], body.mediaType, Number(body.tmdbId), String(body.note || "").trim());
    sendJson(res, 201, { list });
    return;
  }

  sendJson(res, 404, { error: "Route introuvable" });
}

async function getTrending() {
  if (hasTmdbAuth()) {
    return cached("trending:all:week:fr-FR", TRENDING_CACHE_TTL_MS, async () => {
      const data = await tmdb("/trending/all/week", { language: "fr-FR" });
      return data.results.filter(isSupportedMedia).slice(0, 18).map(normalizeSearchResult);
    });
  }

  return fallbackCatalog.map((item) => normalizeFallback(item));
}

async function cached(key, ttlMs, producer) {
  const now = Date.now();
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const value = await producer();
  memoryCache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

async function searchMedia(query) {
  if (!query.trim()) {
    return getTrending();
  }

  if (hasTmdbAuth()) {
    const data = await tmdb("/search/multi", {
      query,
      language: "fr-FR",
      include_adult: "false"
    });
    return data.results.filter(isSupportedMedia).slice(0, 20).map(normalizeSearchResult);
  }

  return fallbackCatalog
    .filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
    .map((item) => normalizeFallback(item));
}

async function getRecommendations(db) {
  const libraryKeys = new Set(Object.keys(db.library));
  const seeds = Object.values(db.library)
    .filter((item) => ["watching", "finished"].includes(item.status))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 8);
  const seedWeights = Object.fromEntries(seeds.map((seed) => [dbKey(seed.mediaType, seed.tmdbId), recommendationSeedWeight(seed)]));
  const preferredGenres = genreWeights(db, seeds);

  if (!hasTmdbAuth() || !seeds.length) {
    const fallback = await getTrending();
    return fallback.filter((item) => !libraryKeys.has(dbKey(item.mediaType, item.tmdbId))).slice(0, 10);
  }

  const responses = await Promise.allSettled(
    seeds.flatMap((seed) => [
      tmdb(`/${seed.mediaType}/${seed.tmdbId}/recommendations`, { language: "fr-FR" }).then((data) => ({ seed, data })),
      tmdb(`/${seed.mediaType}/${seed.tmdbId}/similar`, { language: "fr-FR" }).then((data) => ({ seed, data }))
    ])
  );

  const seen = new Set(libraryKeys);
  const scored = new Map();
  responses.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }
    const seedWeight = seedWeights[dbKey(result.value.seed.mediaType, result.value.seed.tmdbId)] || 1;
    result.value.data.results.forEach((item) => {
      const source = { ...item, media_type: item.media_type || result.value.seed.mediaType };
      if (!isSupportedMedia(source)) {
        return;
      }
      const normalized = normalizeSearchResult(source);
      const key = dbKey(normalized.mediaType, normalized.tmdbId);
      if (!seen.has(key)) {
        const current = scored.get(key) || { item: normalized, score: 0 };
        current.score += seedWeight + (normalized.rating || 0) * 0.15 + genreScore(normalized, preferredGenres);
        scored.set(key, current);
      }
    });
  });

  const items = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
    .slice(0, 12);

  if (items.length < 8) {
    const trending = await getTrending();
    trending.forEach((item) => {
      const key = dbKey(item.mediaType, item.tmdbId);
      if (!libraryKeys.has(key) && !items.some((existing) => mediaSame(existing, item))) {
        items.push(item);
      }
    });
  }

  return items.slice(0, 12);
}

function recommendationSeedWeight(item) {
  let weight = 1;
  if (item.favorite) {
    weight += 5;
  }
  if (item.status === "finished") {
    weight += 2;
  }
  if (item.status === "watching") {
    weight += 1;
  }
  return weight;
}

function genreWeights(db, seeds) {
  return seeds.reduce((acc, seed) => {
    const media = db.media[dbKey(seed.mediaType, seed.tmdbId)];
    const weight = recommendationSeedWeight(seed);
    (media?.genres || []).forEach((genre) => {
      acc[genre] = (acc[genre] || 0) + weight;
    });
    return acc;
  }, {});
}

function genreScore(item, weights) {
  return (item.genres || []).reduce((total, genre) => total + (weights[genre] || 0) * 0.2, 0);
}

function mediaSame(a, b) {
  return a.mediaType === b.mediaType && a.tmdbId === b.tmdbId;
}

async function registerAccount(email, password, name) {
  ensureAuthStorage();
  const normalizedEmail = normalizeEmail(email);
  validatePassword(password);
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error("Un compte existe deja avec cet email");
  }

  const user = {
    id: `user-${crypto.randomUUID()}`,
    email: normalizedEmail,
    name: String(name || normalizedEmail.split("@")[0]).trim(),
    passwordHash: hashPassword(password),
    settings: defaultSettings(),
    createdAt: new Date().toISOString()
  };

  await supabaseRequest("/suivi_users?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([toUserRow(user)])
  });

  return createSession(user);
}

async function loginAccount(email, password) {
  ensureAuthStorage();
  const user = await findUserByEmail(normalizeEmail(email));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Email ou mot de passe incorrect");
  }
  return createSession(user);
}

async function updateProfile(userId, patch) {
  const users = await supabaseRequest("/suivi_users?select=*&id=eq." + encodeURIComponent(userId));
  const current = users[0] ? fromUserRow(users[0]) : null;
  if (!current) {
    throw new Error("Utilisateur introuvable");
  }

  const settings = sanitizeProfileSettings({
    ...defaultSettings(),
    ...(current.settings || {}),
    ...(patch.settings || {})
  });
  const next = {
    ...current,
    name: sanitizePublicText(patch.name || current.name, 40) || current.name,
    settings
  };

  await supabaseRequest("/suivi_users?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([toUserRow(next)])
  });

  return publicUser(next);
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };

  await supabaseRequest("/suivi_sessions?on_conflict=token", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([toSessionRow(session)])
  });

  return { token, user: publicUser(user) };
}

async function getSessionUser(req) {
  ensureAuthStorage();
  const token = getAuthToken(req);
  if (!token) {
    return null;
  }

  const rows = await supabaseOptional("/suivi_sessions?select=*&token=eq." + encodeURIComponent(token));
  const session = rows[0] ? fromSessionRow(rows[0]) : null;
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    return null;
  }

  const users = await supabaseRequest("/suivi_users?select=*&id=eq." + encodeURIComponent(session.userId));
  return users[0] ? publicUser(fromUserRow(users[0])) : null;
}

async function requireSession(req) {
  const user = await getSessionUser(req);
  if (!user) {
    const error = new Error("Session expiree ou absente");
    error.statusCode = 401;
    throw error;
  }
  return user;
}

async function logoutSession(req) {
  ensureAuthStorage();
  const token = getAuthToken(req);
  if (!token) {
    return;
  }
  await supabaseOptional("/suivi_sessions?token=eq." + encodeURIComponent(token), { method: "DELETE" });
}

async function findUserByEmail(email) {
  const users = await supabaseRequest("/suivi_users?select=*&email=eq." + encodeURIComponent(email));
  return users[0] ? fromUserRow(users[0]) : null;
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("Email invalide");
  }
  return value;
}

function validatePassword(password) {
  if (String(password || "").length < 8) {
    throw new Error("Le mot de passe doit faire au moins 8 caracteres");
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || "").split("$");
  if (!salt || !hash) {
    return false;
  }
  const current = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(current, "hex"));
}

function getAuthToken(req) {
  return req.headers["x-session-token"] || "";
}

function publicUser(user) {
  const safeUser = ensureFriendCode(user);
  return {
    id: safeUser.id,
    name: safeUser.name,
    settings: normalizeSettings(safeUser.settings),
    createdAt: safeUser.createdAt
  };
}

function defaultSettings() {
  return {
    locale: "fr-FR",
    region: "FR",
    adultContent: false,
    notifications: false,
    friendCode: "",
    bio: "",
    avatar: "",
    accentColor: "#8df071",
    showStats: true,
    isPrivate: false,
    links: {
      instagram: "",
      x: "",
      tiktok: "",
      letterboxd: "",
      website: ""
    }
  };
}

function sanitizeProfileSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    locale: "fr-FR",
    region: sanitizePublicText(normalized.region || "FR", 8) || "FR",
    adultContent: Boolean(normalized.adultContent),
    notifications: Boolean(normalized.notifications),
    friendCode: sanitizeFriendCode(normalized.friendCode || ""),
    bio: sanitizePublicText(normalized.bio || "", 220),
    avatar: sanitizeAvatar(normalized.avatar || ""),
    accentColor: sanitizeAccentColor(normalized.accentColor || "#8df071"),
    showStats: normalized.showStats !== false,
    isPrivate: Boolean(normalized.isPrivate),
    links: sanitizeLinks(normalized.links || {})
  };
}

function normalizeSettings(settings) {
  let parsed = settings;
  if (typeof settings === "string") {
    try {
      parsed = JSON.parse(settings);
    } catch {
      parsed = {};
    }
  }
  return {
    ...defaultSettings(),
    ...(parsed || {}),
    links: {
      ...defaultSettings().links,
      ...((parsed || {}).links || {})
    }
  };
}

function ensureFriendCode(user) {
  const settings = normalizeSettings(user.settings);
  if (settings.friendCode) {
    return { ...user, settings };
  }
  const hash = crypto.createHash("sha1").update(user.id).digest("hex").slice(0, 6).toUpperCase();
  return {
    ...user,
    settings: {
      ...settings,
      friendCode: `TV-${hash}`
    }
  };
}

function sanitizeFriendCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 14);
}

function sanitizeAccentColor(value) {
  const clean = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toLowerCase() : "#8df071";
}

function sanitizeLinks(links) {
  return {
    instagram: sanitizeHandleOrUrl(links.instagram),
    x: sanitizeHandleOrUrl(links.x),
    tiktok: sanitizeHandleOrUrl(links.tiktok),
    letterboxd: sanitizeHandleOrUrl(links.letterboxd),
    website: sanitizeUrl(links.website)
  };
}

function sanitizeHandleOrUrl(value) {
  return sanitizePublicText(value, 80);
}

function sanitizeUrl(value) {
  const text = sanitizePublicText(value, 160);
  if (!text) {
    return "";
  }
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function sanitizePublicText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeAvatar(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (!text.startsWith("data:image/")) {
    return "";
  }
  return text.length <= 2600000 ? text : "";
}

function ensureAuthStorage() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase est requis pour les comptes utilisateurs");
  }
}

async function getMediaDetails(mediaType, tmdbId) {
  const key = dbKey(mediaType, tmdbId);
  const db = await readDb();
  const stored = db.media[key];
  if (shouldUseStoredMedia(stored, mediaType)) {
    return stored;
  }

  const normalized = hasTmdbAuth()
    ? await normalizeDetails(mediaType, await tmdbRetry(`/${mediaType}/${tmdbId}`, { language: "fr-FR" }))
    : normalizeFallback(fallbackCatalog.find((item) => dbKey(item.mediaType, item.tmdbId) === key));

  db.media[key] = normalized;
  await writeDb(db);
  return normalized;
}

async function addLibraryItem(userId, mediaType, tmdbId, status) {
  const db = await readDb(userId);
  const media = await getMediaDetails(mediaType, tmdbId);
  const key = dbKey(mediaType, tmdbId);

  db.media[key] = media;
  db.library[key] = db.library[key] || {
    userId,
    mediaType,
    tmdbId,
    status,
    watched: mediaType === "movie" ? { complete: false } : { season: 1, episode: 0 },
    favorite: false,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.library[key].status = status;
  db.library[key].updatedAt = new Date().toISOString();
  await writeDb(db);
  return enrichItem(db.library[key], media);
}

async function updateLibraryItem(userId, mediaType, tmdbId, patch) {
  const db = await readDb(userId);
  const key = dbKey(mediaType, tmdbId);
  const item = db.library[key];
  const media = db.media[key];
  if (!item) {
    throw new Error("Element absent de la bibliotheque");
  }

  if (patch.status) {
    item.status = patch.status;
  }
  if (patch.watched) {
    item.watched = patch.watched;
  }
  if (typeof patch.favorite === "boolean") {
    item.favorite = patch.favorite;
  }
  item.status = normalizedLibraryStatus(item, media);
  item.updatedAt = new Date().toISOString();
  await writeDb(db);
  return enrichItem(item, db.media[key]);
}

function normalizedLibraryStatus(item, media) {
  if (!media) {
    return item.status;
  }
  if (item.mediaType === "movie") {
    return item.watched?.complete ? "finished" : item.status;
  }
  const watched = watchedEpisodeCount(media, item.watched);
  const total = (media.seasons || []).reduce((sum, count) => sum + count, 0);
  if (total > 0 && watched >= total) {
    return "finished";
  }
  if (watched > 0 && item.status === "planned") {
    return "watching";
  }
  return item.status;
}

function watchedEpisodeCount(media, watched = {}) {
  if (!watched.season || !watched.episode) {
    return 0;
  }
  return (media.seasons || []).slice(0, watched.season - 1).reduce((sum, count) => sum + count, 0) + watched.episode;
}

async function removeLibraryItem(userId, mediaType, tmdbId) {
  const db = await readDb(userId);
  const key = dbKey(mediaType, tmdbId);
  delete db.library[key];

  if (hasSupabaseConfig()) {
    await supabaseRequest(
      `/suivi_library?user_id=eq.${encodeURIComponent(userId)}&media_type=eq.${encodeURIComponent(mediaType)}&tmdb_id=eq.${encodeURIComponent(tmdbId)}`,
      { method: "DELETE" }
    );
    return;
  }

  await writeDb(db);
}

async function markNextSeen(userId, mediaType, tmdbId) {
  const db = await readDb(userId);
  const key = dbKey(mediaType, tmdbId);
  const item = db.library[key];
  const media = db.media[key];
  if (!item || !media) {
    throw new Error("Element absent de la bibliotheque");
  }

  if (mediaType === "movie") {
    item.watched = { complete: true };
    item.status = "finished";
  } else {
    const next = nextEpisode(media, item.watched);
    if (next) {
      item.watched = next;
      if (!nextEpisode(media, item.watched)) {
        item.status = "finished";
      } else if (item.status === "planned") {
        item.status = "watching";
      }
    } else {
      item.status = "finished";
    }
  }

  item.updatedAt = new Date().toISOString();
  await writeDb(db);
  return enrichItem(item, media);
}

function enrichLibrary(db) {
  return Object.values(db.library).map((item) => enrichItem(item, db.media[dbKey(item.mediaType, item.tmdbId)]));
}

function enrichItem(item, media) {
  return {
    ...media,
    user: {
      status: item.status,
      watched: item.watched,
      favorite: Boolean(item.favorite),
      addedAt: item.addedAt,
      updatedAt: item.updatedAt
    }
  };
}

function enrichSocial(db, userId = LOCAL_USER_ID) {
  const usersById = Object.fromEntries(db.users.map(ensureFriendCode).map((user) => [user.id, user]));
  const friendLibrary = db.friendLibrary || db.library || {};
  const lists = Object.values(db.lists || {})
    .filter((list) => list.userId === userId)
    .map((list) => ({
      ...list,
      items: Object.values(db.listItems || {})
        .filter((item) => item.listId === list.id)
        .map((item) => enrichListItem(item, db.media[dbKey(item.mediaType, item.tmdbId)]))
    }));

  return {
    friends: Object.values(db.friendships || {})
      .filter((friendship) => friendship.userId === userId)
      .map((friendship) => ({
        ...friendship,
        friend: {
          ...(usersById[friendship.friendId] || { id: friendship.friendId, name: friendship.friendId }),
          progress: friendProgress(friendship.friendId, friendLibrary, db.media)
        }
      })),
    lists
  };
}

function friendProgress(friendId, library, media) {
  const items = Object.values(library || {}).filter((item) => item.userId === friendId);
  const enriched = items
    .map((item) => ({
      ...item,
      media: media[dbKey(item.mediaType, item.tmdbId)]
    }))
    .filter((item) => item.media)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const current = items
    .filter((item) => item.status === "watching")
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  const favorite = items
    .filter((item) => item.favorite)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  return {
    total: items.length,
    watching: items.filter((item) => item.status === "watching").length,
    planned: items.filter((item) => item.status === "planned").length,
    finished: items.filter((item) => item.status === "finished").length,
    favorites: items.filter((item) => item.favorite).length,
    currentTitle: current ? media[dbKey(current.mediaType, current.tmdbId)]?.title || "" : "",
    favoriteTitle: favorite ? media[dbKey(favorite.mediaType, favorite.tmdbId)]?.title || "" : "",
    recent: enriched.slice(0, 4).map(friendMediaSummary),
    library: enriched.slice(0, 12).map(friendMediaSummary)
  };
}

function friendMediaSummary(item) {
  return {
    mediaType: item.mediaType,
    tmdbId: item.tmdbId,
    title: item.media.title,
    poster: item.media.poster || item.media.backdrop || "",
    status: item.status,
    favorite: Boolean(item.favorite),
    updatedAt: item.updatedAt
  };
}

function enrichListItem(item, media) {
  return { ...item, media };
}

async function refreshUpcomingAirData(db) {
  if (!hasTmdbAuth()) {
    return;
  }

  const items = Object.values(db.library)
    .filter((item) => item.mediaType === "tv")
    .slice(0, 12);
  let changed = false;

  const results = await Promise.allSettled(
    items.map((item) => tmdb(`/tv/${item.tmdbId}`, { language: "fr-FR" }))
  );

  results.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      return;
    }
    const item = items[index];
    const key = dbKey(item.mediaType, item.tmdbId);
    const media = db.media[key];
    if (!media) {
      return;
    }
    const nextAirEpisode = normalizeAirEpisode(result.value.next_episode_to_air);
    media.nextAir = nextAirEpisode?.airDate || null;
    media.nextAirEpisode = nextAirEpisode;
    changed = true;
  });

  if (changed) {
    await writeMediaCache(db);
  }
}

function scheduleUpcomingAirRefresh(userId, db) {
  if (!hasTmdbAuth()) {
    return;
  }

  const now = Date.now();
  const nextAllowedAt = upcomingRefreshCache.get(userId) || 0;
  if (nextAllowedAt > now) {
    return;
  }

  upcomingRefreshCache.set(userId, now + UPCOMING_REFRESH_TTL_MS);
  refreshUpcomingAirData(db).catch((error) => {
    upcomingRefreshCache.delete(userId);
    console.warn("Refresh sorties ignore:", error.message);
  });
}

async function writeMediaCache(db) {
  if (!hasSupabaseConfig()) {
    await writeDb(db);
    return;
  }

  const mediaRows = Object.values(db.media).map(toMediaRow);
  if (mediaRows.length) {
    await supabaseRequest("/suivi_media?on_conflict=media_type,tmdb_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(mediaRows)
    });
  }
}

async function addFriend(userId, friendId, name) {
  const friendLookup = sanitizeFriendCode(friendId) || String(friendId || "").trim();
  if (!friendLookup) {
    throw new Error("Code ami manquant");
  }

  const db = await readDb(userId);
  const friend = db.users.map(ensureFriendCode).find((user) => user.id === friendLookup || user.settings?.friendCode === friendLookup);
  if (!friend) {
    throw new Error("Aucun utilisateur ne correspond a ce code ami");
  }
  if (friend.id === userId) {
    throw new Error("Tu ne peux pas t'ajouter toi-meme");
  }
  db.friendships = db.friendships || {};
  const createdAt = new Date().toISOString();
  db.friendships[`${userId}:${friend.id}`] = { userId, friendId: friend.id, createdAt };
  db.friendships[`${friend.id}:${userId}`] = { userId: friend.id, friendId: userId, createdAt };
  await writeDb(db);
  return enrichSocial(db, userId);
}

async function createList(userId, name, description) {
  if (!name) {
    throw new Error("Nom de liste manquant");
  }
  const db = await readDb(userId);
  db.lists = db.lists || {};
  const id = `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  db.lists[id] = {
    id,
    userId,
    name,
    description,
    isPublic: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return enrichSocial(db, userId).lists.find((list) => list.id === id);
}

async function addListItem(userId, listId, mediaType, tmdbId, note) {
  const db = await readDb(userId);
  const list = db.lists?.[listId];
  if (!list || list.userId !== userId) {
    throw new Error("Liste introuvable");
  }
  const media = await getMediaDetails(mediaType, tmdbId);
  db.media[dbKey(mediaType, tmdbId)] = media;
  db.listItems = db.listItems || {};
  db.listItems[`${listId}:${mediaType}:${tmdbId}`] = { listId, mediaType, tmdbId, note, addedAt: new Date().toISOString() };
  list.updatedAt = new Date().toISOString();
  await writeDb(db);
  return enrichSocial(db, userId).lists.find((entry) => entry.id === listId);
}

function nextEpisode(media, watched) {
  const seasonTotal = media.seasons[watched.season - 1] || 0;
  if (watched.episode < seasonTotal) {
    return { season: watched.season, episode: watched.episode + 1 };
  }
  if (watched.season < media.seasons.length) {
    return { season: watched.season + 1, episode: 1 };
  }
  return null;
}

async function readDb(userId = LOCAL_USER_ID) {
  if (hasSupabaseConfig()) {
    return readSupabaseDb(userId);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

async function writeDb(db) {
  if (hasSupabaseConfig()) {
    await writeSupabaseDb(db);
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

async function readSupabaseDb(userId = LOCAL_USER_ID) {
  const [users, mediaRows, libraryRows, friendshipRows, listRows, listItemRows] = await Promise.all([
    supabaseRequest("/suivi_users?select=*"),
    supabaseRequest("/suivi_media?select=*"),
    supabaseRequest("/suivi_library?select=*&user_id=eq." + encodeURIComponent(userId)),
    supabaseOptional("/suivi_friendships?select=*&user_id=eq." + encodeURIComponent(userId)),
    supabaseOptional("/suivi_lists?select=*&user_id=eq." + encodeURIComponent(userId)),
    supabaseOptional("/suivi_list_items?select=*")
  ]);
  const friendIds = friendshipRows.map((row) => row.friend_id).filter(Boolean);
  const friendLibraryRows = friendIds.length
    ? await supabaseOptional("/suivi_library?select=*&user_id=in.(" + friendIds.map(encodeURIComponent).join(",") + ")")
    : [];

  const media = {};
  mediaRows.forEach((row) => {
    media[dbKey(row.media_type, row.tmdb_id)] = fromMediaRow(row);
  });

  const library = {};
  libraryRows.forEach((row) => {
    library[dbKey(row.media_type, row.tmdb_id)] = fromLibraryRow(row);
  });
  const friendLibrary = {};
  friendLibraryRows.forEach((row) => {
    friendLibrary[`${row.user_id}:${row.media_type}:${row.tmdb_id}`] = fromLibraryRow(row);
  });

  const friendships = {};
  friendshipRows.forEach((row) => {
    friendships[`${row.user_id}:${row.friend_id}`] = fromFriendshipRow(row);
  });

  const lists = {};
  listRows.forEach((row) => {
    lists[row.id] = fromListRow(row);
  });

  const listIds = new Set(Object.keys(lists));
  const listItems = {};
  listItemRows
    .filter((row) => listIds.has(row.list_id))
    .forEach((row) => {
      listItems[`${row.list_id}:${row.media_type}:${row.tmdb_id}`] = fromListItemRow(row);
    });

  return {
    users: users.length ? users.map(fromUserRow) : [],
    media,
    library,
    friendLibrary,
    friendships,
    lists,
    listItems
  };
}

async function writeSupabaseDb(db) {
  await ensureUser(db);

  const mediaRows = Object.values(db.media).map(toMediaRow);
  const libraryRows = Object.values(db.library).map(toLibraryRow);
  const userRows = Object.values(db.users).map(toUserRow);
  const friendshipRows = Object.values(db.friendships || {}).map(toFriendshipRow);
  const listRows = Object.values(db.lists || {}).map(toListRow);
  const listItemRows = Object.values(db.listItems || {}).map(toListItemRow);

  if (userRows.length) {
    await supabaseRequest("/suivi_users?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(userRows)
    });
  }

  if (mediaRows.length) {
    await supabaseRequest("/suivi_media?on_conflict=media_type,tmdb_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(mediaRows)
    });
  }

  if (libraryRows.length) {
    await supabaseRequest("/suivi_library?on_conflict=user_id,media_type,tmdb_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(libraryRows)
    });
  }

  if (friendshipRows.length) {
    await supabaseRequest("/suivi_friendships?on_conflict=user_id,friend_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(friendshipRows)
    });
  }

  if (listRows.length) {
    await supabaseRequest("/suivi_lists?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(listRows)
    });
  }

  if (listItemRows.length) {
    await supabaseRequest("/suivi_list_items?on_conflict=list_id,media_type,tmdb_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(listItemRows)
    });
  }
}

async function ensureUser(db, user = null) {
  if (!db.users.length) {
    db.users.push({
      id: user?.id || LOCAL_USER_ID,
      email: user?.email || "",
      name: user?.name || LOCAL_USER_NAME,
      settings: user?.settings || defaultSettings(),
      createdAt: new Date().toISOString()
    });
  }

  if (hasSupabaseConfig()) {
    await supabaseRequest("/suivi_users?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([toUserRow(db.users[0])])
    });
  }
}

async function supabaseRequest(pathname, options = {}) {
  const key = getSupabaseKey();
  const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...options.headers
    },
    body: options.body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseOptional(pathname, options = {}) {
  try {
    return await supabaseRequest(pathname, options);
  } catch (error) {
    if (error.message.includes("PGRST205") || error.message.includes("Could not find the table")) {
      return [];
    }
    throw error;
  }
}

function toUserRow(user) {
  const safeUser = ensureFriendCode(user);
  return {
    id: safeUser.id,
    email: safeUser.email || null,
    name: safeUser.name,
    password_hash: safeUser.passwordHash || null,
    settings: safeUser.settings || defaultSettings(),
    created_at: safeUser.createdAt
  };
}

function fromUserRow(row) {
  return ensureFriendCode({
    id: row.id,
    email: row.email || "",
    name: row.name,
    passwordHash: row.password_hash || "",
    settings: row.settings || defaultSettings(),
    createdAt: row.created_at
  });
}

function toMediaRow(media) {
  return {
    media_type: media.mediaType,
    tmdb_id: media.tmdbId,
    title: media.title,
    release_year: media.year,
    genres: media.genres || [],
    rating: media.rating,
    poster: media.poster || "",
    backdrop: media.backdrop || "",
    synopsis: media.synopsis || "",
    seasons: media.seasons || [1],
    episodes: media.episodes || {},
    next_air: media.nextAirEpisode ? JSON.stringify(media.nextAirEpisode) : media.nextAir
  };
}

function fromMediaRow(row) {
  return {
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    title: row.title,
    year: row.release_year,
    genres: row.genres || [],
    rating: row.rating,
    poster: row.poster || "",
    backdrop: row.backdrop || "",
    synopsis: row.synopsis || "",
    seasons: row.seasons || [1],
    episodes: row.episodes || {},
    nextAir: parseNextAir(row.next_air)?.airDate || row.next_air,
    nextAirEpisode: parseNextAir(row.next_air)
  };
}

function toLibraryRow(item) {
  return {
    user_id: item.userId,
    media_type: item.mediaType,
    tmdb_id: item.tmdbId,
    status: item.status,
    watched: item.watched,
    favorite: Boolean(item.favorite),
    added_at: item.addedAt,
    updated_at: item.updatedAt
  };
}

function fromLibraryRow(row) {
  return {
    userId: row.user_id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    status: row.status,
    watched: row.watched,
    favorite: Boolean(row.favorite),
    addedAt: row.added_at,
    updatedAt: row.updated_at
  };
}

function toFriendshipRow(item) {
  return {
    user_id: item.userId,
    friend_id: item.friendId,
    created_at: item.createdAt
  };
}

function fromFriendshipRow(row) {
  return {
    userId: row.user_id,
    friendId: row.friend_id,
    createdAt: row.created_at
  };
}

function toListRow(list) {
  return {
    id: list.id,
    user_id: list.userId,
    name: list.name,
    description: list.description || "",
    is_public: list.isPublic !== false,
    created_at: list.createdAt,
    updated_at: list.updatedAt
  };
}

function fromListRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || "",
    isPublic: row.is_public !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toListItemRow(item) {
  return {
    list_id: item.listId,
    media_type: item.mediaType,
    tmdb_id: item.tmdbId,
    note: item.note || "",
    added_at: item.addedAt
  };
}

function fromListItemRow(row) {
  return {
    listId: row.list_id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    note: row.note || "",
    addedAt: row.added_at
  };
}

function toSessionRow(session) {
  return {
    token: session.token,
    user_id: session.userId,
    created_at: session.createdAt,
    expires_at: session.expiresAt
  };
}

function fromSessionRow(row) {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

async function tmdb(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const headers = { accept: "application/json" };
  if (process.env.TMDB_READ_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`;
  } else if (process.env.TMDB_API_KEY) {
    url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`TMDB ${response.status}`);
  }
  return response.json();
}

async function tmdbRetry(endpoint, params = {}, attempts = 3) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await tmdb(endpoint, params);
    } catch (error) {
      lastError = error;
      await delay(350 * (index + 1));
    }
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSearchResult(item) {
  const mediaType = item.media_type;
  const title = mediaType === "movie" ? item.title : item.name;
  const date = mediaType === "movie" ? item.release_date : item.first_air_date;
  return {
    mediaType,
    tmdbId: item.id,
    title,
    year: date ? Number(date.slice(0, 4)) : null,
    rating: item.vote_average ? Number((item.vote_average / 2).toFixed(1)) : null,
    poster: imageUrl(item.poster_path, "w500"),
    backdrop: imageUrl(item.backdrop_path, "original"),
    synopsis: item.overview || "Aucun synopsis disponible."
  };
}

async function normalizeDetails(mediaType, data) {
  const title = mediaType === "movie" ? data.title : data.name;
  const date = mediaType === "movie" ? data.release_date : data.first_air_date;
  const seasons = mediaType === "movie" ? [1] : (data.seasons || []).filter((season) => season.season_number > 0).map((season) => season.episode_count || 0);
  const [episodes, providers] = await Promise.all([
    mediaType === "tv" ? getEpisodeMap(data.id, seasons) : Promise.resolve({}),
    getWatchProviders(mediaType, data.id)
  ]);

  return {
    mediaType,
    tmdbId: data.id,
    title,
    year: date ? Number(date.slice(0, 4)) : null,
    genres: (data.genres || []).map((genre) => genre.name),
    rating: data.vote_average ? Number((data.vote_average / 2).toFixed(1)) : null,
    poster: imageUrl(data.poster_path, "w500"),
    backdrop: imageUrl(data.backdrop_path, "original") || imageUrl(data.poster_path, "w500"),
    synopsis: data.overview || "Aucun synopsis disponible.",
    seasons,
    episodes,
    providers,
    nextAir: normalizeAirEpisode(data.next_episode_to_air)?.airDate || null,
    nextAirEpisode: normalizeAirEpisode(data.next_episode_to_air)
  };
}

function normalizeAirEpisode(episode) {
  if (!episode?.air_date) {
    return null;
  }
  return {
    airDate: episode.air_date,
    season: episode.season_number || null,
    episode: episode.episode_number || null,
    title: chooseEpisodeTitle("", episode.name, episode.season_number || 0, episode.episode_number || 0),
    overview: episode.overview || "",
    still: imageUrl(episode.still_path, "w300")
  };
}

function parseNextAir(value) {
  if (!value || typeof value !== "string" || !value.trim().startsWith("{")) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getWatchProviders(mediaType, tmdbId) {
  if (!hasTmdbAuth()) {
    return null;
  }

  try {
    const data = await tmdb(`/${mediaType}/${tmdbId}/watch/providers`);
    const region = data.results?.FR || data.results?.US || null;
    if (!region) {
      return null;
    }
    return {
      link: region.link || "",
      flatrate: normalizeProviders(region.flatrate),
      rent: normalizeProviders(region.rent),
      buy: normalizeProviders(region.buy)
    };
  } catch {
    return null;
  }
}

function normalizeProviders(providers = []) {
  return providers.map((provider) => ({
    id: provider.provider_id,
    name: provider.provider_name,
    logo: imageUrl(provider.logo_path, "w92")
  }));
}

async function getEpisodeMap(tmdbId, seasons) {
  const requests = seasons.flatMap((_, index) => [
    { season: index + 1, language: "fr-FR" },
    { season: index + 1, language: "en-US" }
  ]);
  const results = await Promise.allSettled(
    requests.map((request) => tmdb(`/tv/${tmdbId}/season/${request.season}`, { language: request.language }))
  );

  return results.reduce((acc, result, index) => {
    if (result.status !== "fulfilled") {
      return acc;
    }

    const request = requests[index];
    result.value.episodes.forEach((episode) => {
      const key = `${request.season}:${episode.episode_number}`;
      const existing = acc[key] || {};
      const title = chooseEpisodeTitle(existing.title, episode.name, request.season, episode.episode_number);
      acc[key] = {
        title,
        still: existing.still || imageUrl(episode.still_path, "w300"),
        airDate: episode.air_date || null
      };
    });
    return acc;
  }, {});
}

function shouldUseStoredMedia(stored, mediaType) {
  if (!stored) {
    return false;
  }
  if (!hasTmdbAuth()) {
    return true;
  }
  if (!stored.providers) {
    return false;
  }
  if (mediaType === "tv" && stored.nextAir && !stored.nextAirEpisode) {
    return false;
  }
  if (mediaType !== "tv") {
    return true;
  }
  return hasUsefulEpisodeData(stored);
}

function hasUsefulEpisodeData(media) {
  const episodes = Object.values(media.episodes || {});
  if (!episodes.length) {
    return false;
  }
  const realTitles = episodes.filter((episode) => !isGenericEpisodeTitle(episode.title)).length;
  const uniqueStills = new Set(episodes.map((episode) => episode.still).filter(Boolean));
  return realTitles >= Math.min(3, episodes.length) || uniqueStills.size > 1;
}

function chooseEpisodeTitle(current, incoming, season, episode) {
  const fallback = `S${season}E${episode}`;
  if (current && !isGenericEpisodeTitle(current)) {
    return current;
  }
  if (incoming && !isGenericEpisodeTitle(incoming)) {
    return incoming;
  }
  return current || incoming || fallback;
}

function isGenericEpisodeTitle(title) {
  if (!title) {
    return true;
  }
  return /^episode\s*\d*$/i.test(title.trim());
}

function normalizeFallback(item) {
  const detail = item ? fallbackDetails[dbKey(item.mediaType, item.tmdbId)] : null;
  return detail || {
    ...item,
    genres: [],
    rating: null,
    poster: "",
    backdrop: "",
    synopsis: "Configure TMDB pour charger les details complets.",
    seasons: item?.mediaType === "movie" ? [1] : [1],
    nextAir: null
  };
}

function imageUrl(pathname, size) {
  return pathname ? `${IMAGE_BASE}${size}${pathname}` : "";
}

function isSupportedMedia(item) {
  return ["tv", "movie"].includes(item.media_type) && !item.adult;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(content);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function normalizeServerError(error) {
  if (error.statusCode === 401) {
    return { error: "Connexion requise", detail: error.message };
  }

  if (error.message.includes("PGRST205") || error.message.includes("Could not find the table")) {
    return {
      error: "Schema Supabase manquant",
      detail: "Les tables Supabase ne sont pas a jour. Execute le fichier supabase/schema.sql dans le SQL Editor Supabase, puis relance npm start."
    };
  }

  if (error.message.includes("PGRST204") || error.message.includes("Could not find")) {
    return {
      error: "Schema Supabase a mettre a jour",
      detail: "La colonne ou table demandee n'existe pas encore. Execute le fichier supabase/schema.sql dans Supabase pour activer amis, listes et coups de coeur."
    };
  }

  return { error: "Erreur serveur", detail: error.message };
}

function ensureLocalDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const now = new Date().toISOString();
    const media = {};
    const library = {};
    ["tv:100088", "tv:1396", "tv:70523"].forEach((key) => {
      const item = fallbackDetails[key];
      media[key] = item;
      library[key] = {
        userId: LOCAL_USER_ID,
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
        status: "watching",
        watched: { season: 1, episode: 0 },
        favorite: false,
        addedAt: now,
        updatedAt: now
      };
    });
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({
        users: [{ id: LOCAL_USER_ID, name: LOCAL_USER_NAME, createdAt: now }],
        media,
        library,
        friendships: {},
        lists: {},
        listItems: {}
      }, null, 2)
    );
  }
}

function dbKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

function hasTmdbAuth() {
  return Boolean(process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_API_KEY);
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && getSupabaseKey());
}

function getSupabaseKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY
  );
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const index = trimmed.indexOf("=");
      if (index === -1) {
        return;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      process.env[key] = process.env[key] || value;
    });
}
