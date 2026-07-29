const api = {
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
  route: "home",
  user: null,
  library: [],
  social: { friends: [], lists: [] },
  explore: [],
  recommendations: [],
  query: "",
  suggestions: [],
  searchTimer: null,
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
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Erreur API");
  }
  return data;
}

async function refreshData() {
  state.loading = true;
  state.error = "";
  try {
    const [me, trending, recommendations] = await Promise.all([api.me(), api.trending(), api.recommendations()]);
    state.user = me.user;
    state.library = me.library;
    state.social = me.social || { friends: [], lists: [] };
    state.explore = mergeExplore(trending.items, me.library);
    state.recommendations = mergeExplore(recommendations.items, me.library);
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
  }
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
  const focusShow = watching.sort((a, b) => progressPercent(b) - progressPercent(a))[0] || state.library[0];

  wrap.append(topbar(`Bonsoir ${state.user?.name || "Alex"}`, "Ton suivi est sauvegarde et tes prochaines series restent a portee de main."));

  if (focusShow) {
    wrap.append(heroCard(focusShow));
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
  wrap.append(topbar("Explorer", "Recherche dans TMDB pour ajouter series et films."));

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
    if (term.length < 2) {
      state.suggestions = [];
      renderSuggestions(container);
      return;
    }

    try {
      const data = await api.search(term);
      state.suggestions = mergeExplore(data.items.slice(0, 8), state.library);
      renderSuggestions(container);
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
  wrap.append(topbar("Calendrier", "Sorties connues pour les series suivies."));
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

function renderProfile() {
  const wrap = el("section", "stagger");
  wrap.append(topbar("Profil", "Ton historique, tes habitudes et tes priorites de visionnage."));

  const watched = state.library.reduce((total, show) => total + watchedCount(show), 0);
  const finished = state.library.filter((show) => show.user.status === "finished").length;
  const hours = Math.round(watched * 45 / 60);
  const favoriteGenre = mostCommon(state.library.flatMap((show) => show.genres || [])) || "Aucun";
  const completion = state.library.length ? Math.round((finished / state.library.length) * 100) : 0;
  const active = libraryByStatus("watching").length;
  const planned = libraryByStatus("planned").length;

  const stats = el("section", "stats-grid");
  [
    [state.library.length, "Titres suivis"],
    [watched, "Episodes / films vus"],
    [`${hours}h`, "Temps estime"],
    [`${completion}%`, "Liste terminee"]
  ].forEach(([value, label]) => {
    const card = el("article", "stat-card");
    card.append(el("strong", "", String(value)), el("span", "", label));
    stats.append(card);
  });
  wrap.append(stats);

  const summary = el("section", "profile-grid");
  summary.append(profileInsight("Genre dominant", favoriteGenre, "Base sur les titres de ta bibliotheque."));
  summary.append(profileInsight("En cours", String(active), "Titres ouverts a reprendre."));
  summary.append(profileInsight("A commencer", String(planned), "Titres ajoutes mais pas encore lances."));
  summary.append(profileInsight("Rythme", `${Math.max(1, Math.round(watched / Math.max(state.library.length, 1)))} vus/titre`, "Moyenne de progression actuelle."));
  wrap.append(summary);

  const statusPanel = el("section", "panel");
  statusPanel.append(el("h2", "section-title", "Repartition"));
  const statusList = el("div", "profile-bars");
  Object.entries(statusLabels).forEach(([status, label]) => {
    const count = libraryByStatus(status).length;
    const row = el("div", "profile-bar-row");
    row.append(el("span", "", label));
    row.append(bar(state.library.length ? Math.round((count / state.library.length) * 100) : 0, "profile-bar"));
    row.append(el("strong", "", String(count)));
    statusList.append(row);
  });
  statusPanel.append(statusList);
  wrap.append(statusPanel);

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

  wrap.append(socialPanel());
  wrap.append(listsPanel());
  return wrap;
}

function profileInsight(label, value, helper) {
  const card = el("article", "profile-insight");
  card.append(el("span", "", label), el("strong", "", value), el("small", "", helper));
  return card;
}

function socialPanel() {
  const panel = el("section", "panel");
  panel.append(el("h2", "section-title", "Amis"));
  panel.append(el("p", "subtitle", `Ton identifiant a partager : ${state.user?.id || "local-user"}`));

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
    row.append(el("strong", "", entry.friend.name), el("span", "", entry.friend.id));
    list.append(row);
  });
  panel.append(list);
  return panel;
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
    const response = await api.media(item.mediaType, item.tmdbId);
    const libraryItem = state.library.find((entry) => mediaKey(entry) === mediaKey(response.media));
    const media = libraryItem ? { ...response.media, user: libraryItem.user } : response.media;
    await preloadDetailImages(media);
    renderDialog(media);
  } catch (error) {
    dialogContent.innerHTML = "";
    dialogContent.append(errorView(error.message));
  }
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

  const select = document.createElement("select");
  select.className = "status-select";
  Object.entries(statusLabels).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = (show.user?.status || "planned") === value;
    select.append(option);
  });
  select.addEventListener("change", async (event) => {
    if (!show.user) {
      await addMedia(show, event.target.value);
      return;
    }
    await api.update(show.mediaType, show.tmdbId, { status: event.target.value });
    await refreshData();
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
    render();
  });

  const addButton = el("button", "ghost-button", inLibrary ? "Dans ta bibliotheque" : "Ajouter a ma liste");
  addButton.type = "button";
  addButton.disabled = inLibrary;
  addButton.addEventListener("click", () => addMedia(show, "planned"));
  const favoriteButton = el("button", show.user?.favorite ? "primary-button" : "ghost-button", show.user?.favorite ? "Coup de coeur" : "Marquer coup de coeur");
  favoriteButton.type = "button";
  favoriteButton.disabled = !inLibrary;
  favoriteButton.addEventListener("click", () => toggleFavorite(show));

  controls.append(select, addButton, favoriteButton, listPicker(show, inLibrary));
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
    item.append(episodeInfo(show, 1, 1, show.title), episodeToggle(show, 1, 1, seen));
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
      seasonText.append(el("strong", "", `Saison ${seasonNumber}`));
      seasonText.append(el("span", "", `${count} episodes`));
      const seasonButton = el("button", seasonSeen ? "ghost-button season-button is-complete" : "ghost-button season-button", seasonSeen ? "Saison vue" : "Valider la saison");
      seasonButton.type = "button";
      seasonButton.disabled = !show.user || seasonSeen;
      seasonButton.addEventListener("click", () => markSeasonSeen(show, seasonNumber));
      seasonHead.append(seasonText, seasonButton);
      list.append(seasonHead);

      for (let episode = 1; episode <= count; episode += 1) {
        const absolute = show.seasons.slice(0, seasonIndex).reduce((a, b) => a + b, 0) + episode;
        const seen = show.user && watchedCount(show) >= absolute;
        const item = el("article", `episode-item${seen ? " is-seen" : ""}`);
        item.append(episodeInfo(show, seasonNumber, episode), episodeToggle(show, seasonNumber, episode, seen));
        list.append(item);
      }
    });
  }
  episodes.append(list);
  return episodes;
}

async function addMedia(show, status) {
  await api.add(show.mediaType, show.tmdbId, status);
  await refreshData();
  render();
  renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
}

function listPicker(show, inLibrary) {
  const wrap = el("div", "list-picker");
  const select = document.createElement("select");
  select.className = "status-select";
  select.disabled = !inLibrary || !state.social.lists.length;
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = state.social.lists.length ? "Ajouter a une liste..." : "Cree une liste depuis Profil";
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
  await api.update(show.mediaType, show.tmdbId, { favorite: !show.user.favorite });
  await refreshData();
  render();
  if (dialog.open) {
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
  }
}

async function markSeen(show) {
  await api.seen(show.mediaType, show.tmdbId);
  await refreshData();
  render();
  if (dialog.open) {
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
  }
}

async function markSeasonSeen(show, season) {
  if (!show.user || show.mediaType !== "tv") {
    return;
  }

  const watched = { season, episode: show.seasons[season - 1] || 0 };
  const isLastSeason = season >= show.seasons.length;
  await api.update(show.mediaType, show.tmdbId, {
    watched,
    status: isLastSeason ? "finished" : "watching"
  });
  await refreshData();
  render();
  if (dialog.open) {
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
  }
}

async function toggleEpisodeSeen(show, season, episode, isSeen) {
  if (!show.user) {
    await addMedia(show, "watching");
    return;
  }

  if (show.mediaType === "movie") {
    await api.update(show.mediaType, show.tmdbId, {
      watched: { complete: !isSeen },
      status: isSeen ? "planned" : "finished"
    });
  } else {
    const target = isSeen ? progressBefore(show, season, episode) : { season, episode };
    await api.update(show.mediaType, show.tmdbId, {
      watched: target,
      status: totalWatchedFromProgress(show, target) >= totalEpisodes(show) ? "finished" : "watching"
    });
  }

  await refreshData();
  render();
  if (dialog.open) {
    renderDialog(state.library.find((entry) => mediaKey(entry) === mediaKey(show)));
  }
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

function episodeToggle(show, season, episode, seen) {
  const button = el("button", seen ? "episode-toggle is-on" : "episode-toggle", seen ? "Vu" : "A voir");
  button.type = "button";
  button.ariaLabel = seen ? "Marquer comme non vu" : "Marquer comme vu";
  button.addEventListener("click", () => toggleEpisodeSeen(show, season, episode, seen));
  return button;
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
  const text = el("div");
  text.append(el("div", "eyebrow", "Suivi TV"));
  text.append(el("h1", "title", title));
  if (subtitle) {
    text.append(el("p", "subtitle", subtitle));
  }
  const profileButton = el("button", "icon-button", "o");
  profileButton.type = "button";
  profileButton.ariaLabel = "Profil";
  profileButton.addEventListener("click", () => {
    state.route = "profile";
    render();
  });
  bar.append(text, profileButton);
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
