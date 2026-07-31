const api = {
  async register(email, password, name) {
    return request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name })
    });
  },
  async login(email, password) {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  async logout() {
    return request("/api/auth/logout", { method: "POST" });
  },
  async updateProfile(patch) {
    return request("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  },
  async me() {
    return request("/api/me");
  },
  async trending() {
    return request("/api/trending");
  },
  async recommendations() {
    return request("/api/recommendations");
  },
  async search(query) {
    return request(`/api/search?query=${encodeURIComponent(query)}`);
  },
  async media(mediaType, tmdbId) {
    return request(`/api/media/${mediaType}/${tmdbId}`);
  },
  async add(mediaType, tmdbId, status = "planned") {
    return request("/api/library", {
      method: "POST",
      body: JSON.stringify({ mediaType, tmdbId, status })
    });
  },
  async update(mediaType, tmdbId, patch) {
    return request(`/api/library/${mediaType}/${tmdbId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  },
  async remove(mediaType, tmdbId) {
    return request(`/api/library/${mediaType}/${tmdbId}`, { method: "DELETE" });
  },
  async seen(mediaType, tmdbId) {
    return request(`/api/library/${mediaType}/${tmdbId}/seen`, { method: "POST" });
  },
  async addFriend(friendId, name) {
    return request("/api/friends", {
      method: "POST",
      body: JSON.stringify({ friendId, name })
    });
  },
  async createList(name, description) {
    return request("/api/lists", {
      method: "POST",
      body: JSON.stringify({ name, description })
    });
  },
  async addToList(listId, mediaType, tmdbId) {
    return request(`/api/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({ mediaType, tmdbId })
    });
  }
};

const statusLabels = {
  watching: "En cours",
  planned: "A regarder",
  finished: "Terminee",
  paused: "En pause"
};

const app = document.querySelector("#app");
const dialog = document.querySelector("#series-dialog");
const dialogContent = document.querySelector("#dialog-content");

const state = {
  authToken: localStorage.getItem("suivi_session_token") || "",
  authMode: "login",
  route: "home",
  user: null,
  library: [],
  social: { friends: [], lists: [] },
  explore: [],
  recommendations: [],
  query: "",
  suggestions: [],
  searchTimer: null,
  calendarCursor: new Date(),
  loading: true,
  error: ""
};

init();

async function init() {
  bindShell();
  await refreshData();
  render();
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(state.authToken ? { "x-session-token": state.authToken } : {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.error || "Erreur API");
  }
  return data;
}

async function refreshData(retriedJwt = false) {
  state.loading = true;
  state.error = "";
  if (!state.authToken) {
    state.loading = false;
    return;
  }
  try {
    const [me, trending, recommendations] = await Promise.all([api.me(), api.trending(), api.recommendations()]);
    state.user = me.user;
    state.library = me.library;
    state.social = me.social || { friends: [], lists: [] };
    state.explore = mergeExplore(trending.items, me.library);
    state.recommendations = mergeExplore(recommendations.items, me.library);
  } catch (error) {
    if (isTransientJwtError(error) && !retriedJwt) {
      await wait(900);
      return refreshData(true);
    }
    if (isTransientJwtError(error)) {
      localStorage.removeItem("suivi_session_token");
      state.authToken = "";
      state.error = "";
      return;
    }
    if (error.message === "Connexion requise") {
      localStorage.removeItem("suivi_session_token");
      state.authToken = "";
      state.error = "";
      return;
    }
    state.error = error.message;
  } finally {
    state.loading = false;
  }
}

function isTransientJwtError(error) {
  return /JWT issued at future|PGRST303/i.test(error?.message || "");
}

function mergeExplore(items, library) {
  const libraryKeys = new Set(library.map(mediaKey));
  return items.map((item) => ({ ...item, inLibrary: libraryKeys.has(mediaKey(item)) }));
}

function bindShell() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      state.route = button.dataset.route;
      render();
    });
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".month-day.has-release")) {
      document.querySelectorAll(".month-day.is-open").forEach((day) => day.classList.remove("is-open"));
    }
  });
}

function render() {
  app.innerHTML = "";
  app.className = "app-view";

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === state.route);
  });
  const activeNav = Array.from(document.querySelectorAll(".nav-item")).findIndex((button) => button.dataset.route === state.route);
  document.querySelector(".bottom-nav")?.style.setProperty("--active-index", String(Math.max(activeNav, 0)));

  if (state.loading) {
    app.append(appSkeleton());
    return;
  }

  if (!state.authToken) {
    app.append(renderAuth());
    return;
  }

  if (state.error) {
    app.append(errorView(state.error));
    return;
  }

  const view = {
    home: renderHome,
    library: renderLibrary,
    explore: renderExplore,
    calendar: renderCalendar,
    profile: renderProfile
  }[state.route];

  app.append(view());
}

function renderHome() {
  const wrap = el("section", "stagger");
  const watching = libraryByStatus("watching");
  const planned = libraryByStatus("planned");
  const stale = state.library
    .filter((show) => show.user.status === "watching" && daysSince(show.user.updatedAt) >= 14)
    .sort((a, b) => new Date(a.user.updatedAt) - new Date(b.user.updatedAt));
  const carouselShows = [...watching].sort((a, b) => progressPercent(b) - progressPercent(a)).slice(0, 5);
  const focusShows = carouselShows.length ? carouselShows : state.library.slice(0, 5);

  wrap.append(topbar(`Bonsoir ${state.user?.name || "Alex"}`, "Ton suivi est sauvegarde et tes prochaines series restent a portee de main."));

  if (focusShows.length) {
    wrap.append(heroCarousel(focusShows));
  } else {
    wrap.append(emptyView("Ajoute une serie ou un film pour commencer ton suivi."));
  }

  const grid = el("div", "grid-two");
  grid.append(sectionList("Continuer", watching.slice(0, 4), true));
  grid.append(sectionList("Pas regarde depuis longtemps", stale.slice(0, 4), true));
  grid.append(sectionList("A commencer", planned.slice(0, 4), false));
  wrap.append(grid);
  wrap.append(upcomingPanel());
  return wrap;
}

function renderAuth() {
  const wrap = el("section", "auth-view");
  const panel = el("section", "auth-card");
  panel.append(el("div", "eyebrow", "Suivi TV"));
  panel.append(el("h1", "title", state.authMode === "login" ? "Connexion" : "Creer un compte"));
  panel.append(el("p", "subtitle", "Connecte-toi pour sauvegarder ton suivi, tes listes, tes coups de coeur et tes amis."));

  const form = el("form", "auth-form");
  const name = document.createElement("input");
  name.placeholder = "Nom affiche";
  name.autocomplete = "name";
  name.hidden = state.authMode === "login";
  const email = document.createElement("input");
  email.type = "email";
  email.placeholder = "Email";
  email.autocomplete = "email";
  email.required = true;
  const password = document.createElement("input");
  password.type = "password";
  password.placeholder = "Mot de passe";
  password.autocomplete = state.authMode === "login" ? "current-password" : "new-password";
  password.required = true;
  password.minLength = 8;
  const submit = el("button", "primary-button", state.authMode === "login" ? "Se connecter" : "Creer le compte");
  submit.type = "submit";
  form.append(name, email, password, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = state.authMode === "login"
        ? await api.login(email.value, password.value)
        : await api.register(email.value, password.value, name.value);
      state.authToken = result.token;
      localStorage.setItem("suivi_session_token", result.token);
      state.user = result.user;
      state.error = "";
      await refreshData();
      render();
    } catch (error) {
      state.error = error.message;
      render();
    }
  });
  panel.append(form);

  if (state.error) {
    panel.append(el("p", "auth-error", state.error));
  }

  const switchButton = el("button", "muted-link", state.authMode === "login" ? "Pas encore de compte ? Inscription" : "Deja un compte ? Connexion");
  switchButton.type = "button";
  switchButton.addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "register" : "login";
    state.error = "";
    render();
  });
  panel.append(switchButton);
  wrap.append(panel);
  return wrap;
}

function renderLibrary() {
  const wrap = el("section", "stagger");
  wrap.append(topbar("Bibliotheque", "Chaque coche est sauvegardee dans la base utilisateur."));

  ["watching", "planned", "paused", "finished"].forEach((status) => {
    wrap.append(sectionList(statusLabels[status], libraryByStatus(status), status === "watching"));
  });
  return wrap;
}

function renderExplore() {
  const wrap = el("section", "stagger explore-view");
  wrap.append(topbar("Explorer", ""));

  const searchWrap = el("div", "search-wrap");
  const search = el("form", "search-box");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Rechercher une serie ou un film...";
  input.value = state.query;
  const submit = el("button", "icon-button", ">");
  submit.type = "submit";
  submit.ariaLabel = "Rechercher";
  search.append(input, submit);
  search.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.query = input.value.trim();
    await runSearch();
  });
  input.addEventListener("input", async (event) => {
    state.query = event.target.value;
    if (!state.query.trim()) {
      state.suggestions = [];
      renderSuggestions(searchWrap);
      await runSearch();
      return;
    }
    scheduleSuggestions(searchWrap);
  });
  searchWrap.append(search);
  renderSuggestions(searchWrap);
  wrap.append(searchWrap);

  if (!state.query.trim() && state.recommendations.length) {
    const suggestions = posterGrid("Suggestions pour toi", state.recommendations.slice(0, 10));
    suggestions.classList.add("personal-picks");
    wrap.append(suggestions);
  }

  const results = posterGrid(state.query.trim() ? "Resultats" : "Tendances", state.explore);
  results.classList.add("explore-results");
  wrap.append(results);
  return wrap;
}

function scheduleSuggestions(container) {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(async () => {
    const term = state.query.trim();
    if (term.length < 3) {
      state.suggestions = [];
      renderSuggestions(container);
      return;
    }

    try {
      const data = await api.search(term);
      state.suggestions = mergeExplore(data.items.slice(0, 8), state.library);
      state.explore = mergeExplore(data.items, state.library);
      renderSuggestions(container);
      const results = posterGrid("Resultats", state.explore);
      results.classList.add("explore-results");
      document.querySelector(".explore-results")?.replaceWith(results);
    } catch {
      state.suggestions = [];
      renderSuggestions(container);
    }
  }, 220);
}

function renderSuggestions(container) {
  container.querySelector(".suggestion-list")?.remove();
  if (!state.query.trim() || !state.suggestions.length) {
    return;
  }

  const list = el("div", "suggestion-list");
  state.suggestions.forEach((item) => {
    const button = el("button", "suggestion-item");
    button.type = "button";
    const img = document.createElement("img");
    img.src = item.poster || "icons/icon.svg";
    img.alt = "";
    const text = el("span", "suggestion-copy");
    text.append(el("strong", "", item.title));
    text.append(el("small", "", `${mediaLabel(item)}${item.year ? ` · ${item.year}` : ""}`));
    button.append(text, img);
    button.addEventListener("click", () => openShow(item));
    list.append(button);
  });
  container.append(list);
}

function renderCalendar() {
  const wrap = el("section", "stagger");
  wrap.append(topbar("Calendrier", ""));
  wrap.append(calendarMonthPanel());
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", "A venir"));
  const list = el("div", "calendar-list");
  const shows = state.library.filter((item) => item.nextAirEpisode?.airDate || item.nextAir);
  if (!shows.length) {
    list.append(el("p", "empty", "TMDB ne renvoie pas encore de prochaine date pour ta bibliotheque."));
  }
  shows.sort(sortByAirDate).forEach((show) => list.append(calendarRow(show)));
  panel.append(list);
  wrap.append(panel);
  return wrap;
}

function calendarMonthPanel() {
  const panel = el("section", "panel calendar-month-panel");
  const today = new Date();
  const cursor = state.calendarCursor || today;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const releaseDays = upcomingDatesMap();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const head = el("div", "calendar-head");
  const prev = el("button", "calendar-nav-button", "‹");
  prev.type = "button";
  prev.ariaLabel = "Mois precedent";
  prev.addEventListener("click", () => {
    state.calendarCursor = new Date(year, month - 1, 1);
    render();
  });
  const next = el("button", "calendar-nav-button", "›");
  next.type = "button";
  next.ariaLabel = "Mois suivant";
  next.addEventListener("click", () => {
    state.calendarCursor = new Date(year, month + 1, 1);
    render();
  });
  const monthTitle = el("h2", "calendar-title", cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  head.append(prev, monthTitle, next);
  panel.append(head);
  const grid = el("div", "month-grid");
  ["L", "M", "M", "J", "V", "S", "D"].forEach((day) => grid.append(el("span", "month-weekday", day)));
  for (let index = 0; index < offset; index += 1) {
    grid.append(el("span", "month-day is-empty"));
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const releases = releaseDays.get(key) || [];
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const cell = el(releases.length ? "button" : "span", `month-day${releases.length ? " has-release" : ""}${isToday ? " is-today" : ""}`);
    if (releases.length) {
      cell.type = "button";
      cell.ariaLabel = `${releases.length} sortie${releases.length > 1 ? "s" : ""} le ${day}`;
      cell.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasOpen = cell.classList.contains("is-open");
        document.querySelectorAll(".month-day.is-open").forEach((entry) => entry.classList.remove("is-open"));
        cell.classList.toggle("is-open", !wasOpen);
      });
    }
    cell.append(el("strong", "", String(day)));
    if (releases.length) {
      cell.append(el("i", "release-dot", ""));
      cell.append(calendarDayPopover(releases));
    }
    grid.append(cell);
  }
  panel.append(grid);
  return panel;
}

function upcomingDatesMap() {
  return state.library.reduce((acc, show) => {
    const value = show.nextAirEpisode?.airDate || show.nextAir;
    if (!value) {
      return acc;
    }
    const key = value.slice(0, 10);
    const air = show.nextAirEpisode || { airDate: show.nextAir };
    const events = acc.get(key) || [];
    events.push({
      title: show.title,
      subtitle: airEpisodeLabel(air),
      poster: air.still || show.poster || show.backdrop || "icons/icon.svg",
      time: formatFrenchAirTime(value)
    });
    acc.set(key, events);
    return acc;
  }, new Map());
}

function calendarDayPopover(releases) {
  const popover = el("div", "calendar-popover");
  releases.forEach((release) => {
    const item = el("div", "calendar-popover-item");
    const image = document.createElement("img");
    image.src = release.poster;
    image.alt = "";
    const text = el("span", "");
    text.append(el("strong", "", release.title), el("small", "", release.subtitle));
    item.append(image, text, el("em", "", release.time));
    popover.append(item);
  });
  return popover;
}

function renderProfile() {
  const wrap = el("section", "stagger");
  wrap.append(topbar("Profil", "Tes infos publiques et tes preferences."));
  wrap.append(profileHeaderPanel());

  const watched = state.library.reduce((total, show) => total + watchedCount(show), 0);
  const finished = state.library.filter((show) => show.user.status === "finished").length;
  const hours = Math.round(watched * 45 / 60);
  const favoriteGenre = mostCommon(state.library.flatMap((show) => show.genres || [])) || "Aucun";
  const completion = state.library.length ? Math.round((finished / state.library.length) * 100) : 0;
  const active = libraryByStatus("watching").length;
  const planned = libraryByStatus("planned").length;

  const stats = el("section", "stats-grid profile-stats-compact");
  [
    [state.library.length, "Titres"],
    [watched, "Vus"],
    [`${hours}h`, "Temps"],
    [favoriteGenre, "Genre"]
  ].forEach(([value, label]) => {
    const card = el("article", "stat-card");
    card.append(el("strong", "", String(value)), el("span", "", label));
    stats.append(card);
  });
  wrap.append(stats);

  const recentPanel = el("section", "panel");
  recentPanel.append(el("h2", "section-title", "Dernieres activites"));
  const recent = [...state.library].sort((a, b) => new Date(b.user.updatedAt) - new Date(a.user.updatedAt)).slice(0, 4);
  const recentList = el("div", "show-list");
  if (!recent.length) {
    recentList.append(el("p", "empty", "Aucune activite pour le moment."));
  }
  recent.forEach((show) => recentList.append(showRow(show, false)));
  recentPanel.append(recentList);
  wrap.append(recentPanel);

  wrap.append(listsPanel());
  return wrap;
}

function profileHeaderPanel() {
  const panel = el("section", "profile-hero-panel");
  const avatar = el("div", "profile-avatar");
  if (state.user?.settings?.avatar) {
    const image = document.createElement("img");
    image.src = state.user.settings.avatar;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = initials(state.user?.name || "Utilisateur");
  }

  const copy = el("div", "profile-public-copy");
  copy.append(el("span", "eyebrow", state.user?.settings?.isPrivate ? "Profil prive" : "Profil public"));
  copy.append(el("h2", "", state.user?.name || "Utilisateur"));
  copy.append(el("p", "subtitle", state.user?.settings?.bio || "Aucune bio pour le moment."));
  copy.append(socialLinks(state.user?.settings?.links || {}));

  const actions = el("div", "profile-actions");
  const edit = el("button", "primary-button", "Modifier le profil");
  edit.type = "button";
  edit.addEventListener("click", () => openProfileEditor());
  const logout = el("button", "ghost-button", "Se deconnecter");
  logout.type = "button";
  logout.addEventListener("click", async () => {
    await api.logout();
    localStorage.removeItem("suivi_session_token");
    state.authToken = "";
    state.user = null;
    state.library = [];
    state.social = { friends: [], lists: [] };
    render();
  });
  actions.append(edit, logout);
  panel.append(avatar, copy, actions);
  return panel;
}

function openProfileEditor() {
  dialogContent.innerHTML = "";
  const panel = el("section", "profile-editor");
  panel.append(el("h2", "section-title", "Modifier le profil"));
  const preview = el("div", "profile-avatar profile-avatar--large");
  let avatarValue = state.user?.settings?.avatar || "";
  renderAvatarPreview(preview, avatarValue, state.user?.name);

  const form = el("form", "profile-form");
  const feedback = el("p", "auth-error");
  feedback.hidden = true;
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
  const crop = cropEditor();
  const name = document.createElement("input");
  name.placeholder = "Nom d'utilisateur";
  name.value = state.user?.name || "";
  name.required = true;
  const bio = document.createElement("textarea");
  bio.placeholder = "Bio publique";
  bio.maxLength = 220;
  bio.value = state.user?.settings?.bio || "";
  const privacyLabel = el("label", "check-line");
  const isPrivate = document.createElement("input");
  isPrivate.type = "checkbox";
  isPrivate.checked = Boolean(state.user?.settings?.isPrivate);
  privacyLabel.append(isPrivate, el("span", "", "Mettre mon profil en prive"));
  const showStatsLabel = el("label", "check-line");
  const showStats = document.createElement("input");
  showStats.type = "checkbox";
  showStats.checked = state.user?.settings?.showStats !== false;
  showStatsLabel.append(showStats, el("span", "", "Afficher mes statistiques sur mon profil"));
  const linksTitle = el("div", "section-title", "Reseaux");
  const instagram = socialInput("Instagram", state.user?.settings?.links?.instagram);
  const x = socialInput("X / Twitter", state.user?.settings?.links?.x);
  const tiktok = socialInput("TikTok", state.user?.settings?.links?.tiktok);
  const letterboxd = socialInput("Letterboxd", state.user?.settings?.links?.letterboxd);
  const website = socialInput("Site web", state.user?.settings?.links?.website);
  const submit = el("button", "primary-button", "Enregistrer");
  submit.type = "submit";

  file.addEventListener("change", async () => {
    const selected = file.files?.[0];
    if (!selected) {
      return;
    }
    try {
      const avatar = await prepareAvatarImport(selected, crop);
      avatarValue = avatar.value;
      renderAvatarPreview(preview, avatarValue, name.value);
      crop.root.hidden = avatar.animated;
      crop.zoom.oninput = () => {
        if (!crop.sourceImage) {
          return;
        }
        avatarValue = croppedDataUrl(crop.sourceImage, cropValues(crop));
        renderAvatarPreview(preview, avatarValue, name.value);
      };
      crop.offsetX.oninput = crop.zoom.oninput;
      crop.offsetY.oninput = crop.zoom.oninput;
      feedback.hidden = true;
    } catch (error) {
      feedback.textContent = error.message;
      feedback.hidden = false;
    }
  });

  form.append(preview, file, crop.root, feedback, name, bio, privacyLabel, showStatsLabel, linksTitle, instagram, x, tiktok, letterboxd, website, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api.updateProfile({
      name: name.value,
      settings: {
        bio: bio.value,
        avatar: avatarValue,
        showStats: showStats.checked,
        isPrivate: isPrivate.checked,
        links: {
          instagram: instagram.value,
          x: x.value,
          tiktok: tiktok.value,
          letterboxd: letterboxd.value,
          website: website.value
        }
      }
    });
    state.user = result.user;
    await refreshData();
    dialog.close();
    render();
  });
  panel.append(form);
  dialogContent.append(panel);
  dialog.showModal();
}

function socialInput(label, value) {
  const input = document.createElement("input");
  input.placeholder = label;
  input.value = value || "";
  return input;
}

function socialLinks(links) {
  const wrap = el("div", "profile-links");
  Object.entries({
    instagram: "Instagram",
    x: "X",
    tiktok: "TikTok",
    letterboxd: "Letterboxd",
    website: "Site"
  }).forEach(([key, label]) => {
    if (!links[key]) {
      return;
    }
    const link = el("a", "profile-link", label);
    link.href = linkHref(key, links[key]);
    link.target = "_blank";
    link.rel = "noreferrer";
    wrap.append(link);
  });
  return wrap;
}

function linkHref(key, value) {
  const clean = String(value || "").trim();
  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }
  const handle = clean.replace(/^@/, "");
  return {
    instagram: `https://instagram.com/${handle}`,
    x: `https://x.com/${handle}`,
    tiktok: `https://tiktok.com/@${handle}`,
    letterboxd: `https://letterboxd.com/${handle}`,
    website: `https://${clean}`
  }[key];
}

function renderAvatarPreview(container, value, name) {
  container.innerHTML = "";
  if (value) {
    const image = document.createElement("img");
    image.src = value;
    image.alt = "";
    container.append(image);
  } else {
    container.textContent = initials(name || "Utilisateur");
  }
}

function cropEditor() {
  const root = el("div", "crop-editor");
  root.hidden = true;
  const image = document.createElement("img");
  const label = el("label", "crop-control");
  label.append(el("span", "", "Zoom"));
  const zoom = document.createElement("input");
  zoom.type = "range";
  zoom.min = "1";
  zoom.max = "2.5";
  zoom.step = "0.05";
  zoom.value = "1";
  label.append(zoom);
  const xLabel = el("label", "crop-control");
  xLabel.append(el("span", "", "Position horizontale"));
  const offsetX = document.createElement("input");
  offsetX.type = "range";
  offsetX.min = "-50";
  offsetX.max = "50";
  offsetX.step = "1";
  offsetX.value = "0";
  xLabel.append(offsetX);
  const yLabel = el("label", "crop-control");
  yLabel.append(el("span", "", "Position verticale"));
  const offsetY = document.createElement("input");
  offsetY.type = "range";
  offsetY.min = "-50";
  offsetY.max = "50";
  offsetY.step = "1";
  offsetY.value = "0";
  yLabel.append(offsetY);
  root.append(image, label, xLabel, yLabel);
  return { root, image, zoom, offsetX, offsetY, sourceImage: null };
}

async function prepareAvatarImport(file, crop) {
  const isGif = file.type === "image/gif";
  if (isGif) {
    const value = await imageFileToDataUrl(file, 1800000, "GIF trop lourd. Choisis un GIF de moins de 1,8 Mo.");
    return { value, animated: true };
  }

  const value = await cropImageFile(file, crop);
  return { value, animated: false };
}

function cropImageFile(file, crop) {
  return new Promise((resolve, reject) => {
    if (file.size > 5000000) {
      reject(new Error("Image trop lourde. Choisis une image de moins de 5 Mo."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image illisible"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Format image non supporte"));
      image.onload = () => {
        crop.root.hidden = false;
        crop.image.src = reader.result;
        crop.zoom.value = "1";
        crop.offsetX.value = "0";
        crop.offsetY.value = "0";
        crop.sourceImage = image;
        resolve(croppedDataUrl(image, cropValues(crop)));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function cropValues(crop) {
  return {
    zoom: Number(crop.zoom.value),
    offsetX: Number(crop.offsetX.value),
    offsetY: Number(crop.offsetY.value)
  };
}

function croppedDataUrl(image, crop) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(size / image.width, size / image.height) * crop.zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  const maxOffsetX = Math.max(0, (width - size) / 2);
  const maxOffsetY = Math.max(0, (height - size) / 2);
  const x = (size - width) / 2 + (crop.offsetX / 50) * maxOffsetX;
  const y = (size - height) / 2 + (crop.offsetY / 50) * maxOffsetY;
  ctx.fillStyle = "#10151d";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, x, y, width, height);
  return canvas.toDataURL("image/webp", 0.86);
}

function imageFileToDataUrl(file, limit = 1800000, message = "Image trop lourde.") {
  return new Promise((resolve, reject) => {
    if (file.size > limit) {
      reject(new Error(message));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Image illisible"));
    reader.readAsDataURL(file);
  });
}

function profileInsight(label, value, helper) {
  const card = el("article", "profile-insight");
  card.append(el("span", "", label), el("strong", "", value), el("small", "", helper));
  return card;
}

function socialPanel() {
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", "Amis"));
  const share = el("div", "friend-code-card");
  share.append(el("span", "", "Code ami"));
  share.append(el("strong", "", shortFriendCode(state.user?.id || "local-user")));
  const copy = el("button", "ghost-button", "Copier");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(state.user?.id || "local-user");
    copy.textContent = "Copie";
    window.setTimeout(() => {
      copy.textContent = "Copier";
    }, 1400);
  });
  share.append(copy);
  panel.append(share);

  const form = el("form", "inline-form");
  const idInput = document.createElement("input");
  idInput.placeholder = "Identifiant ami";
  idInput.required = true;
  const nameInput = document.createElement("input");
  nameInput.placeholder = "Nom affiche";
  const submit = el("button", "primary-button", "Ajouter");
  submit.type = "submit";
  form.append(idInput, nameInput, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api.addFriend(idInput.value.trim(), nameInput.value.trim());
    idInput.value = "";
    nameInput.value = "";
    await refreshData();
    render();
  });
  panel.append(form);

  const list = el("div", "social-list");
  if (!state.social.friends.length) {
    list.append(el("p", "empty", "Aucun ami ajoute pour le moment."));
  }
  state.social.friends.forEach((entry) => {
    const row = el("article", "social-row");
    const progress = entry.friend.progress || {};
    row.append(
      el("strong", "", entry.friend.name),
      el("span", "", `${progress.watching || 0} en cours - ${progress.finished || 0} terminees`),
      el("small", "", friendActivityLabel(progress))
    );
    list.append(row);
  });
  panel.append(list);
  return panel;
}

function shortFriendCode(value) {
  const text = String(value || "");
  if (text.length <= 12) {
    return text;
  }
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function friendActivityLabel(progress = {}) {
  if (progress.currentTitle) {
    return `Regarde ${progress.currentTitle}`;
  }
  if (progress.favoriteTitle) {
    return `A aime ${progress.favoriteTitle}`;
  }
  return "Aucune activite partagee pour le moment";
}

function listsPanel() {
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", "Listes"));
  const form = el("form", "inline-form");
  const nameInput = document.createElement("input");
  nameInput.placeholder = "Nom de la liste";
  nameInput.required = true;
  const descriptionInput = document.createElement("input");
  descriptionInput.placeholder = "Description courte";
  const submit = el("button", "primary-button", "Creer");
  submit.type = "submit";
  form.append(nameInput, descriptionInput, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api.createList(nameInput.value.trim(), descriptionInput.value.trim());
    nameInput.value = "";
    descriptionInput.value = "";
    await refreshData();
    render();
  });
  panel.append(form);

  const list = el("div", "social-list");
  if (!state.social.lists.length) {
    list.append(el("p", "empty", "Cree une liste pour regrouper tes coups de coeur, animes, classiques ou envies du moment."));
  }
  state.social.lists.forEach((entry) => {
    const row = el("article", "list-card");
    row.append(el("strong", "", entry.name), el("span", "", `${entry.items.length} titre(s)`));
    if (entry.description) {
      row.append(el("small", "", entry.description));
    }
    list.append(row);
  });
  panel.append(list);
  return panel;
}

async function runSearch() {
  state.loading = true;
  render();
  try {
    const data = state.query.trim() ? await api.search(state.query) : await api.trending();
    state.explore = mergeExplore(data.items, state.library);
    state.error = "";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

function heroCard(show) {
  const next = nextEpisode(show);
  const card = el("article", "hero-card");
  const image = document.createElement("img");
  image.src = show.backdrop || show.poster || "icons/icon.svg";
  image.alt = "";

  const content = el("div", "hero-content");
  content.append(el("div", "eyebrow", show.mediaType === "movie" ? "Film a regarder" : "Continuer a regarder"));
  content.append(el("h2", "hero-title", show.title));
  content.append(metaRow([mediaLabel(show), firstGenre(show), `${progressPercent(show)}% vu`]));
  content.append(progressPanel(show, next));
  card.append(image, content);
  return card;
}

function heroCarousel(shows) {
  const shell = el("section", "hero-carousel");
  const rail = el("div", "hero-rail");
  shows.forEach((show) => rail.append(heroCard(show)));
  shell.append(rail);
  return shell;
}

function progressPanel(show, next) {
  const panel = el("div", "progress-panel");
  const header = el("div", "progress-header");
  const text = el("div");
  text.append(el("div", "progress-label", "Tu es ici"));
  text.append(el("div", "progress-title", progressTitle(show, next)));
  header.append(text, el("span", "progress-value", `${progressPercent(show)}%`));
  panel.append(header, bar(progressPercent(show)));

  const button = el("button", "primary-button", next ? "Marquer comme vu" : "Revoir la fiche");
  button.type = "button";
  button.addEventListener("click", () => (next ? markSeen(show) : openShow(show)));
  panel.append(button);
  return panel;
}

function sectionList(title, shows, canMark) {
  const panel = el("section", "panel");
  const head = el("div", "section-head");
  head.append(el("h2", "section-title", title));
  const link = el("button", "muted-link", "Voir tout");
  link.type = "button";
  link.addEventListener("click", () => {
    state.route = "library";
    render();
  });
  head.append(link);
  panel.append(head);

  const list = el("div", "show-list");
  if (!shows.length) {
    list.append(el("p", "empty", "Aucun titre ici pour le moment."));
  }
  shows.forEach((show) => list.append(showRow(show, canMark)));
  panel.append(list);
  return panel;
}

function showRow(show, canMark = false) {
  const row = el("article", "show-row");
  const thumb = el("div", "thumb");
  const img = document.createElement("img");
  img.src = show.poster || "icons/icon.svg";
  img.alt = "";
  thumb.append(img);

  const text = el("div");
  text.append(el("div", "row-title", show.title));
  const next = nextEpisode(show);
  text.append(el("div", "row-subtitle", next ? progressTitle(show, next) : statusLabels[show.user?.status] || mediaLabel(show)));
  text.append(bar(progressPercent(show), "small-bar"));

  const action = el("button", canMark ? "primary-button" : "ghost-button", canMark ? "Vu" : "Ouvrir");
  action.type = "button";
  action.addEventListener("click", () => (canMark ? markSeen(show) : openShow(show)));

  row.append(thumb, text, action);
  row.addEventListener("click", (event) => {
    if (!event.target.closest("button")) {
      openShow(show);
    }
  });
  return row;
}

function upcomingPanel() {
  const upcoming = state.library.filter((show) => show.nextAirEpisode?.airDate || show.nextAir).sort(sortByAirDate);
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", "Sorties a venir"));
  const list = el("div", "calendar-list");
  if (!upcoming.length) {
    list.append(el("p", "empty", "Aucune sortie connue pour le moment."));
  }
  upcoming.forEach((show) => list.append(calendarRow(show)));
  panel.append(list);
  return panel;
}

function posterGrid(title, items) {
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", title));
  const grid = el("div", "poster-grid");
  if (!items.length) {
    grid.append(el("p", "empty", "Aucun resultat."));
  }
  items.forEach((item) => {
    const card = el("button", `poster-card${item.inLibrary ? " is-added" : ""}`);
    card.type = "button";
    const img = document.createElement("img");
    img.src = item.poster || "icons/icon.svg";
    img.alt = "";
    card.append(img, el("strong", "", item.title), el("span", "", `${mediaLabel(item)} · ${item.rating ? item.rating.toFixed(1) : "N/A"}`));
    card.addEventListener("click", () => openShow(item));
    grid.append(card);
  });
  panel.append(grid);
  return panel;
}

function providerPanel(show) {
  const panel = el("section", "provider-panel");
  const head = el("div", "section-head");
  head.append(el("h3", "section-title", "Ou regarder"));
  if (show.providers?.link) {
    const link = el("a", "muted-link", "Voir l'offre");
    link.href = show.providers.link;
    link.target = "_blank";
    link.rel = "noreferrer";
    head.append(link);
  }
  panel.append(head);

  const groups = [
    ["Streaming", show.providers?.flatrate],
    ["Location", show.providers?.rent],
    ["Achat", show.providers?.buy]
  ].filter(([, providers]) => providers?.length);

  if (!groups.length) {
    panel.append(el("p", "empty", "Aucune plateforme connue pour ce titre dans ta region."));
    return panel;
  }

  groups.forEach(([label, providers]) => {
    const block = el("div", "provider-group");
    block.append(el("strong", "", label));
    const list = el("div", "provider-list");
    providers.slice(0, 6).forEach((provider) => {
      const chip = el("span", "provider-chip");
      if (provider.logo) {
        const logo = document.createElement("img");
        logo.src = provider.logo;
        logo.alt = "";
        chip.append(logo);
      }
      chip.append(el("span", "", provider.name));
      list.append(chip);
    });
    block.append(list);
    panel.append(block);
  });
  panel.append(el("small", "provider-credit", "Donnees de disponibilite fournies par TMDB / JustWatch."));
  return panel;
}

async function openShow(item) {
  dialogContent.innerHTML = "";
  dialogContent.append(detailSkeleton(item));
  dialog.showModal();

  try {
    const response = await withRetry(() => api.media(item.mediaType, item.tmdbId), 3);
    const libraryItem = state.library.find((entry) => mediaKey(entry) === mediaKey(response.media));
    const media = libraryItem ? { ...response.media, user: libraryItem.user } : response.media;
    await preloadDetailImages(media);
    renderDialog(media);
  } catch (error) {
    dialogContent.innerHTML = "";
    dialogContent.append(errorView(error.message));
  }
}

async function withRetry(action, attempts = 2) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await wait(450 * (index + 1));
    }
  }
  throw lastError;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function renderDialog(show) {
  const inLibrary = Boolean(show.user);
  const next = nextEpisode(show);
  dialogContent.innerHTML = "";

  const layout = el("section", "detail-layout");
  const hero = el("div", "detail-hero");
  const image = document.createElement("img");
  image.src = show.backdrop || show.poster || "icons/icon.svg";
  image.alt = "";
  hero.append(image);

  const body = el("div", "detail-body");
  body.append(el("div", "eyebrow", mediaLabel(show)));
  body.append(el("h2", "hero-title", show.title));
  body.append(metaRow([show.year ? String(show.year) : "Date inconnue", (show.genres || []).join(", ") || "Genres inconnus", show.rating ? `${show.rating.toFixed(1)}/5` : "Non note"]));
  body.append(el("p", "subtitle", show.synopsis || "Aucun synopsis disponible."));
  body.append(providerPanel(show));

  const controls = el("div", "progress-panel controls-panel");
  if (inLibrary) {
    controls.append(progressPanel(show, next));
  }

  const addButton = el("button", inLibrary ? "danger-button" : "primary-button", inLibrary ? "Retirer de ma bibliotheque" : "Ajouter a ma bibliotheque");
  addButton.type = "button";
  addButton.addEventListener("click", () => (inLibrary ? removeMedia(show) : addMedia(show, "planned")));
  const favoriteButton = el("button", show.user?.favorite ? "primary-button" : "ghost-button", show.user?.favorite ? "Coup de coeur" : "Marquer coup de coeur");
  favoriteButton.type = "button";
  favoriteButton.disabled = !inLibrary;
  favoriteButton.addEventListener("click", () => toggleFavorite(show));

  controls.append(addButton, favoriteButton, listPicker(show, inLibrary));
  body.append(controls);

  body.append(episodePanel(show));
  layout.append(hero, body);
  dialogContent.append(layout);
}

function episodePanel(show) {
  const episodes = el("section", "panel");
  const list = el("div", "episode-list");

  if (show.mediaType === "movie") {
    episodes.append(el("h3", "section-title", "Film"));
    const seen = Boolean(show.user?.watched?.complete);
    const item = el("article", `episode-item${seen ? " is-seen" : ""}`);
    item.append(episodeInfo(show, 1, 1, show.title), episodeCheckControl(show, 1, 1, seen));
    list.append(item);
  } else {
    const titleRow = el("div", "episode-panel-head");
    titleRow.append(el("h3", "section-title", "Episodes"));
    titleRow.append(el("span", "episode-count", `${watchedCount(show)} / ${totalEpisodes(show)}`));
    episodes.append(titleRow);

    (show.seasons || []).forEach((count, seasonIndex) => {
      const seasonNumber = seasonIndex + 1;
      const seasonHead = el("div", "season-head");
      const seasonText = el("div");
      const seasonSeen = watchedCount(show) >= show.seasons.slice(0, seasonIndex).reduce((a, b) => a + b, 0) + count;
      const seasonReleased = seasonIsReleased(show, seasonNumber, count);
      const releasedCount = releasedEpisodeCount(show, seasonNumber);
      seasonText.append(el("strong", "", `Saison ${seasonNumber}`));
      seasonText.append(el("span", "", `${count} episodes`));
      const seasonButton = el("button", seasonSeen ? "ghost-button season-button is-complete" : "ghost-button season-button", seasonSeen ? "Saison vue" : seasonReleased ? "Valider la saison" : "Valider sortis");
      seasonButton.type = "button";
      seasonButton.disabled = !show.user || seasonSeen || releasedCount === 0;
      if (releasedCount === 0 && !seasonSeen) {
        seasonButton.textContent = "Saison incomplete";
      }
      seasonButton.addEventListener("click", () => markSeasonSeen(show, seasonNumber));
      seasonHead.append(seasonText, seasonButton);
      list.append(seasonHead);

      for (let episode = 1; episode <= count; episode += 1) {
        const absolute = show.seasons.slice(0, seasonIndex).reduce((a, b) => a + b, 0) + episode;
        const seen = show.user && watchedCount(show) >= absolute;
        const released = episodeIsReleased(show, seasonNumber, episode);
        const item = el("article", `episode-item${seen ? " is-seen" : ""}${released ? "" : " is-locked"}`);
        item.append(episodeInfo(show, seasonNumber, episode), episodeCheckControl(show, seasonNumber, episode, seen));
        list.append(item);
      }
    });
  }
  episodes.append(list);
  return episodes;
}

async function addMedia(show, status) {
  const response = await api.add(show.mediaType, show.tmdbId, status);
  upsertLibraryItem(response.item);
  render();
  renderDialog(response.item);
  refreshData().then(render).catch(() => {});
}

async function removeMedia(show) {
  const key = mediaKey(show);
  const previous = state.library.find((entry) => mediaKey(entry) === key);
  state.library = state.library.filter((entry) => mediaKey(entry) !== key);
  state.explore = mergeExplore(state.explore, state.library);
  state.recommendations = mergeExplore(state.recommendations, state.library);
  render();
  renderDialog({ ...show, user: null });

  try {
    await api.remove(show.mediaType, show.tmdbId);
    refreshData().then(render).catch(() => {});
  } catch (error) {
    if (previous) {
      upsertLibraryItem(previous);
    }
    render();
    renderDialog(previous || show);
    throw error;
  }
}

function upsertLibraryItem(item) {
  const key = mediaKey(item);
  state.library = [item, ...state.library.filter((entry) => mediaKey(entry) !== key)];
  state.explore = mergeExplore(state.explore, state.library);
  state.recommendations = mergeExplore(state.recommendations, state.library);
}

function listPicker(show, inLibrary) {
  if (!inLibrary || !state.social.lists.length) {
    return document.createDocumentFragment();
  }
  const wrap = el("div", "list-picker");
  const select = document.createElement("select");
  select.className = "status-select";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Ajouter a une liste...";
  select.append(empty);
  state.social.lists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    select.append(option);
  });
  select.addEventListener("change", async (event) => {
    if (!event.target.value) {
      return;
    }
    await api.addToList(event.target.value, show.mediaType, show.tmdbId);
    await refreshData();
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)) || show);
  });
  wrap.append(select);
  return wrap;
}

async function toggleFavorite(show) {
  if (!show.user) {
    await addMedia(show, "planned");
    return;
  }

  const optimistic = {
    ...show,
    user: {
      ...show.user,
      favorite: !show.user.favorite
    }
  };
  upsertLibraryItem(optimistic);
  render();
  if (dialog.open) {
    renderDialog(optimistic);
  }

  const response = await api.update(show.mediaType, show.tmdbId, { favorite: optimistic.user.favorite });
  upsertLibraryItem(response.item);
  render();
  if (dialog.open) {
    renderDialog(response.item);
  }
  refreshData().then(render).catch(() => {});
}

async function markSeen(show) {
  const response = await api.seen(show.mediaType, show.tmdbId);
  upsertLibraryItem(response.item);
  render();
  if (dialog.open) {
    renderDialog(response.item);
  }
  refreshData().then(render).catch(() => {});
}

async function markSeasonSeen(show, season) {
  if (!show.user || show.mediaType !== "tv") {
    return;
  }

  const maxEpisode = releasedEpisodeCount(show, season);
  if (!maxEpisode) {
    return;
  }
  const watched = { season, episode: maxEpisode };
  const isLastSeason = season >= show.seasons.length && maxEpisode >= (show.seasons[season - 1] || 0);
  const response = await api.update(show.mediaType, show.tmdbId, {
    watched,
    status: isLastSeason ? "finished" : "watching"
  });
  upsertLibraryItem(response.item);
  render();
  if (dialog.open) {
    renderDialog(response.item);
  }
  refreshData().then(render).catch(() => {});
}

function releasedEpisodeCount(show, season) {
  const total = show.seasons[season - 1] || 0;
  let released = 0;
  for (let episode = 1; episode <= total; episode += 1) {
    if (episodeIsReleased(show, season, episode)) {
      released = episode;
    }
  }
  return released;
}

async function toggleEpisodeSeen(show, season, episode, isSeen) {
  if (!show.user) {
    await addMedia(show, "watching");
    return;
  }

  if (show.mediaType === "movie") {
    const response = await api.update(show.mediaType, show.tmdbId, {
      watched: { complete: !isSeen },
      status: isSeen ? "planned" : "finished"
    });
    upsertLibraryItem(response.item);
  } else {
    const target = isSeen ? progressBefore(show, season, episode) : { season, episode };
    const response = await api.update(show.mediaType, show.tmdbId, {
      watched: target,
      status: totalWatchedFromProgress(show, target) >= totalEpisodes(show) ? "finished" : "watching"
    });
    upsertLibraryItem(response.item);
  }

  render();
  if (dialog.open) {
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
  }
  refreshData().then(render).catch(() => {});
}

function episodeInfo(show, season, episode, fallbackTitle) {
  const data = show.episodes?.[`${season}:${episode}`] || {};
  const info = el("div", "episode-info");
  const thumb = el("div", "episode-thumb");
  if (data.still) {
    const image = document.createElement("img");
    image.src = data.still;
    image.alt = "";
    thumb.append(image);
  } else {
    thumb.classList.add("is-placeholder");
    thumb.textContent = `S${season}E${episode}`;
  }

  const text = el("div", "episode-text");
  text.append(el("strong", "", episodeTitle(show, season, episode, fallbackTitle)));
  const meta = show.mediaType === "movie" ? "Film" : `S${season}E${episode}${data.airDate ? ` · ${formatDate(data.airDate)}` : ""}`;
  text.append(el("span", "", meta));

  info.append(thumb, text);
  return info;
}

function episodeTitle(show, season, episode, fallbackTitle) {
  const title = fallbackTitle || show.episodes?.[`${season}:${episode}`]?.title;
  if (!title || /^episode\s*\d*$/i.test(title.trim())) {
    return show.mediaType === "movie" ? show.title : `S${season}E${episode}`;
  }
  return title;
}

function episodeCheckControl(show, season, episode, seen) {
  if (show.mediaType !== "movie" && !episodeIsReleased(show, season, episode)) {
    return el("span", "episode-countdown", timeUntilEpisode(show, season, episode));
  }

  const button = el("button", seen ? "episode-toggle is-on" : "episode-toggle", "✓");
  button.type = "button";
  button.ariaLabel = seen ? "Marquer comme non vu" : "Marquer comme vu";
  button.addEventListener("click", () => toggleEpisodeSeen(show, season, episode, seen));
  return button;
}

function episodeToggle(show, season, episode, seen) {
  if (show.mediaType === "movie") {
    const button = el("button", seen ? "episode-toggle is-on" : "episode-toggle", "✓");
    button.type = "button";
    button.ariaLabel = seen ? "Marquer comme non vu" : "Marquer comme vu";
    button.addEventListener("click", () => toggleEpisodeSeen(show, season, episode, seen));
    return button;
  }

  const released = episodeIsReleased(show, season, episode);
  if (!released) {
    return el("span", "episode-countdown", timeUntilEpisode(show, season, episode));
  }

  const button = el("button", seen ? "episode-toggle is-on" : "episode-toggle", "✓");
  button.type = "button";
  button.ariaLabel = seen ? "Marquer comme non vu" : "Marquer comme vu";
  button.addEventListener("click", () => toggleEpisodeSeen(show, season, episode, seen));
  return button;
}

function seasonIsReleased(show, season, count) {
  for (let episode = 1; episode <= count; episode += 1) {
    if (!episodeIsReleased(show, season, episode)) {
      return false;
    }
  }
  return true;
}

function episodeIsReleased(show, season, episode) {
  if (show.mediaType === "movie") {
    return true;
  }
  const data = show.episodes?.[`${season}:${episode}`];
  if (!data?.airDate) {
    return false;
  }
  const release = new Date(`${data.airDate}T00:00:00`);
  return release.getTime() <= Date.now();
}

function timeUntilEpisode(show, season, episode) {
  const data = show.episodes?.[`${season}:${episode}`];
  if (!data?.airDate) {
    return "Pas sorti";
  }
  const release = new Date(`${data.airDate}T00:00:00`);
  const diff = release.getTime() - Date.now();
  if (diff <= 0) {
    return "Disponible";
  }
  const days = Math.ceil(diff / 86400000);
  if (days <= 1) {
    return "Demain";
  }
  if (days < 30) {
    return `Dans ${days} j`;
  }
  const months = Math.ceil(days / 30);
  return `Dans ${months} mois`;
}

function progressBefore(show, season, episode) {
  const absolute = Math.max(0, show.seasons.slice(0, season - 1).reduce((total, count) => total + count, 0) + episode - 1);
  return progressFromAbsolute(show, absolute);
}

function progressFromAbsolute(show, absolute) {
  if (absolute <= 0) {
    return { season: 1, episode: 0 };
  }

  let remaining = absolute;
  for (let index = 0; index < show.seasons.length; index += 1) {
    if (remaining <= show.seasons[index]) {
      return { season: index + 1, episode: remaining };
    }
    remaining -= show.seasons[index];
  }

  return { season: show.seasons.length, episode: show.seasons.at(-1) || 0 };
}

function totalWatchedFromProgress(show, progress) {
  return show.seasons.slice(0, Math.max(progress.season - 1, 0)).reduce((total, count) => total + count, 0) + progress.episode;
}

function libraryByStatus(status) {
  return state.library.filter((item) => item.user.status === status);
}

function nextEpisode(show) {
  if (!show.user) {
    return show.mediaType === "movie" ? { complete: true } : { season: 1, episode: 1 };
  }
  if (show.mediaType === "movie") {
    return show.user.watched.complete ? null : { complete: true };
  }

  const watched = show.user.watched;
  const seasonTotal = show.seasons[watched.season - 1] || 0;
  if (watched.episode < seasonTotal) {
    return { season: watched.season, episode: watched.episode + 1 };
  }
  if (watched.season < show.seasons.length) {
    return { season: watched.season + 1, episode: 1 };
  }
  return null;
}

function watchedCount(show) {
  if (!show.user) {
    return 0;
  }
  if (show.mediaType === "movie") {
    return show.user.watched.complete ? 1 : 0;
  }
  const watched = show.user.watched;
  const previousSeasons = show.seasons.slice(0, Math.max(watched.season - 1, 0));
  return previousSeasons.reduce((total, episodes) => total + episodes, 0) + watched.episode;
}

function totalEpisodes(show) {
  return show.mediaType === "movie" ? 1 : Math.max(1, (show.seasons || []).reduce((total, episodes) => total + episodes, 0));
}

function progressPercent(show) {
  return Math.min(100, Math.round((watchedCount(show) / totalEpisodes(show)) * 100));
}

function progressTitle(show, next) {
  if (show.mediaType === "movie") {
    return next ? "Film non vu" : "Film vu";
  }
  return next ? `Saison ${next.season} · Episode ${next.episode}` : "Serie terminee";
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function calendarRow(show) {
  const row = el("article", "calendar-row");
  const air = show.nextAirEpisode || { airDate: show.nextAir };
  const thumb = el("div", "calendar-thumb");
  const image = document.createElement("img");
  image.src = air.still || show.backdrop || show.poster || "icons/icon.svg";
  image.alt = "";
  thumb.append(image);
  const text = el("div");
  text.append(el("div", "calendar-date", formatFrenchAirDate(air.airDate)));
  text.append(el("div", "row-title", show.title));
  text.append(el("div", "row-subtitle", airEpisodeLabel(air)));
  row.append(thumb, text, el("span", "metric", formatFrenchAirTime(air.airDate)));
  return row;
}

function sortByAirDate(a, b) {
  return airDateValue(a) - airDateValue(b);
}

function airDateValue(show) {
  const value = show.nextAirEpisode?.airDate || show.nextAir;
  return new Date(value.includes("T") ? value : `${value}T12:00:00`).getTime();
}

function airEpisodeLabel(air) {
  const number = air.season && air.episode ? `Saison ${air.season} · Episode ${air.episode}` : "Episode a venir";
  return air.title ? `${number} - ${air.title}` : number;
}

function formatFrenchAirDate(value) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Paris"
  });
}

function formatFrenchAirTime(value) {
  if (!value || !value.includes("T")) {
    return "FR";
  }
  return new Date(value).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris"
  });
}

function topbar(title, subtitle) {
  const bar = el("header", "topbar");
  const brand = el("button", "brand-button");
  brand.type = "button";
  brand.ariaLabel = "Accueil";
  const logo = document.createElement("img");
  logo.src = "icons/logo.png";
  logo.alt = "";
  brand.append(logo);
  brand.addEventListener("click", () => {
    state.route = "home";
    render();
  });
  const text = el("div");
  text.append(el("div", "eyebrow", "Suivi TV"));
  text.append(el("h1", "title", title));
  if (subtitle) {
    text.append(el("p", "subtitle", subtitle));
  }
  const profileButton = el("button", state.user?.settings?.avatar ? "icon-button top-avatar" : "icon-button", "");
  profileButton.type = "button";
  profileButton.ariaLabel = "Profil";
  if (state.user?.settings?.avatar) {
    const image = document.createElement("img");
    image.src = state.user.settings.avatar;
    image.alt = "";
    profileButton.append(image);
  } else {
    profileButton.textContent = initials(state.user?.name || "Utilisateur");
  }
  profileButton.addEventListener("click", () => {
    state.route = "profile";
    render();
  });
  bar.append(brand, text, profileButton);
  return bar;
}

function appSkeleton() {
  const wrap = el("section", "stagger skeleton-home");
  wrap.append(skeletonBlock("skeleton-title"));
  wrap.append(skeletonBlock("skeleton-hero"));
  const grid = el("div", "grid-two");
  grid.append(skeletonBlock("skeleton-panel"));
  grid.append(skeletonBlock("skeleton-panel"));
  wrap.append(grid);
  return wrap;
}

function detailSkeleton(item) {
  const layout = el("section", "detail-layout detail-loading");
  const hero = skeletonBlock("detail-skeleton-hero");
  const body = el("div", "detail-body");
  body.append(el("div", "eyebrow", item.mediaType === "movie" ? "Film" : "Serie"));
  body.append(skeletonBlock("detail-skeleton-title"));
  body.append(skeletonBlock("detail-skeleton-line"));
  body.append(skeletonBlock("detail-skeleton-copy"));
  body.append(skeletonBlock("detail-skeleton-panel"));
  body.append(el("p", "loading-copy", "Chargement de la fiche complete depuis TMDB..."));
  layout.append(hero, body);
  return layout;
}

function skeletonBlock(className) {
  return el("div", `skeleton ${className}`);
}

async function preloadDetailImages(media) {
  const urls = [
    media.backdrop,
    media.poster,
    ...Object.values(media.episodes || {}).slice(0, 8).map((episode) => episode.still),
    ...(media.providers?.flatrate || []).slice(0, 4).map((provider) => provider.logo)
  ].filter(Boolean);

  await Promise.allSettled(urls.map(preloadImage));
}

function preloadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
  });
}

function emptyView(message) {
  const panel = el("section", "panel");
  panel.append(el("p", "empty", message));
  return panel;
}

function errorView(message) {
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", "Erreur"));
  panel.append(el("p", "empty", message));
  return panel;
}

function metaRow(items) {
  const row = el("div", "meta-row");
  items.filter(Boolean).forEach((item) => row.append(el("span", "pill", item)));
  return row;
}

function bar(value, className = "") {
  const node = el("div", `bar ${className}`.trim());
  node.style.setProperty("--value", `${value}%`);
  node.append(el("span"));
  return node;
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (content !== undefined) {
    node.textContent = content;
  }
  return node;
}

function mediaKey(item) {
  return `${item.mediaType}:${item.tmdbId}`;
}

function mediaLabel(item) {
  return item.mediaType === "movie" ? "Film" : "Serie";
}

function initials(value) {
  return String(value || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function firstGenre(show) {
  return show.genres?.[0] || "Genre inconnu";
}

function mostCommon(items) {
  const counts = items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function daysSince(value) {
  if (!value) {
    return 999;
  }
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}
