"use strict";

const STORAGE_KEY = "progresso-leitura-v1";
const MAX_PAGES = 2000;
const TZ_OFFSET = "-03:00";

const STATUS_LABEL = {
  unread: "Não lida",
  session: "Em sessão",
  done: "Lida"
};

const el = {
  select: document.getElementById("book-select"),
  newBook: document.getElementById("new-book"),
  stats: document.getElementById("stats"),
  listView: document.getElementById("list-view"),
  pageView: document.getElementById("page-view"),
  primary: document.getElementById("primary-action"),
  name: document.getElementById("book-name"),
  start: document.getElementById("start-page"),
  end: document.getElementById("end-page"),
  meta: document.getElementById("meta-pages"),
  minutes: document.getElementById("minutes-per-page"),
  deadline: document.getElementById("deadline"),
  hint: document.getElementById("range-hint"),
  message: document.getElementById("form-message"),
  exportBtn: document.getElementById("export-notes"),
  deleteBtn: document.getElementById("delete-book"),
  list: document.getElementById("page-list"),
  listHeading: document.getElementById("list-heading"),
  listSub: document.getElementById("list-sub"),
  back: document.getElementById("back"),
  session: document.getElementById("session")
};

let state = load();
let pendingFocus = null;
let statsKey = "";
let messageText = "";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function createFirstBook() {
  return {
    id: uid(),
    name: "Livro 1",
    startPage: 17,
    endPage: 116,
    pendingMeta: null,
    minutesPerPage: 7,
    deadline: "2026-11-21T23:59",
    pages: {},
    openPage: null
  };
}

function createBlankBook() {
  return {
    id: uid(),
    name: "",
    startPage: null,
    endPage: null,
    pendingMeta: null,
    minutesPerPage: null,
    deadline: "",
    pages: {},
    openPage: null
  };
}

function seed() {
  const book = createFirstBook();
  return { version: 1, activeBookId: book.id, books: [book] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.books) || data.books.length === 0) return seed();
    for (const book of data.books) {
      if (!book.id) book.id = uid();
      if (typeof book.name !== "string") book.name = "";
      if (!book.pages || typeof book.pages !== "object") book.pages = {};
    }
    if (!data.books.some((book) => book.id === data.activeBookId)) data.activeBookId = data.books[0].id;
    return data;
  } catch {
    return seed();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    setMessage("Não foi possível guardar neste navegador.");
  }
}

function active() {
  return state.books.find((book) => book.id === state.activeBookId) || state.books[0];
}

function metaOf(book) {
  if (book.startPage == null || book.endPage == null) return null;
  if (book.endPage < book.startPage) return null;
  return book.endPage - book.startPage + 1;
}

function range(book) {
  const meta = metaOf(book);
  if (meta == null || meta > MAX_PAGES) return [];
  const pages = [];
  for (let n = book.startPage; n <= book.endPage; n += 1) pages.push(n);
  return pages;
}

function pageRecord(book, n) {
  return book.pages[String(n)] || null;
}

function ensurePage(book, n) {
  const key = String(n);
  if (!book.pages[key]) {
    book.pages[key] = { done: false, comment: "", elapsedMs: 0, timer: null };
  }
  return book.pages[key];
}

function statusOf(book, n) {
  const page = pageRecord(book, n);
  if (page && page.done) return "done";
  if (page && page.timer && (page.timer.status === "running" || page.timer.status === "paused" || page.timer.status === "awaiting")) {
    return "session";
  }
  return "unread";
}

function counts(book) {
  const pages = range(book);
  let done = 0;
  for (const n of pages) {
    const page = pageRecord(book, n);
    if (page && page.done) done += 1;
  }
  return { total: pages.length, done, unread: pages.length - done };
}

function nextUnread(book) {
  for (const n of range(book)) {
    const page = pageRecord(book, n);
    if (!page || !page.done) return n;
  }
  return null;
}

function deadlineMs(value) {
  if (!value) return null;
  const stamp = value.length === 16 ? `${value}:00${TZ_OFFSET}` : `${value}${TZ_OFFSET}`;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : ms;
}

function formatDeadline(value) {
  const ms = deadlineMs(value);
  if (ms == null) return "";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(ms));
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("day")}/${pick("month")}/${pick("year")} ${pick("hour")}:${pick("minute")}`;
}

function formatHM(totalMinutes) {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return "—";
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${minutes} min`;
}

function formatPrecise(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours} h ${minutes} min ${seconds} s`;
  if (minutes) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function formatClock(ms) {
  if (ms == null) return "––:––";
  const clamped = Math.max(0, ms);
  const totalSeconds = clamped === 0 ? 0 : Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPace(pagesPerHour) {
  if (!Number.isFinite(pagesPerHour)) return "—";
  return pagesPerHour.toLocaleString("pt-BR", {
    minimumFractionDigits: pagesPerHour < 10 ? 1 : 0,
    maximumFractionDigits: 1
  });
}

function formatPercent(done, total) {
  if (!total) return "—";
  const value = Math.round((done / total) * 1000) / 10;
  return `${Number.isInteger(value) ? value : value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
}

function elapsedOf(timer, now = Date.now()) {
  if (!timer) return 0;
  let ms = timer.baseElapsedMs || 0;
  if (timer.status === "running" && timer.runningSince) ms += now - timer.runningSince;
  return Math.max(0, ms);
}

function remainingOf(timer, now = Date.now()) {
  if (!timer) return null;
  return Math.max(0, timer.durationMs - elapsedOf(timer, now));
}

function displayRemaining(book, n, now = Date.now()) {
  const page = pageRecord(book, n);
  if (page && page.done) return null;
  if (page && page.timer) return remainingOf(page.timer, now);
  if (book.minutesPerPage == null) return null;
  return book.minutesPerPage * 60 * 1000;
}

function catchupAll() {
  let changed = false;
  const now = Date.now();
  for (const book of state.books) {
    for (const page of Object.values(book.pages)) {
      if (!page.timer || page.timer.status !== "running") continue;
      if (elapsedOf(page.timer, now) >= page.timer.durationMs) {
        page.timer.baseElapsedMs = page.timer.durationMs;
        page.timer.runningSince = null;
        page.timer.status = "awaiting";
        page.timer.concludeOpen = true;
        changed = true;
      }
    }
  }
  if (changed) save();
  return changed;
}

function pauseBook(book) {
  const now = Date.now();
  for (const page of Object.values(book.pages)) {
    if (!page.timer || page.timer.status !== "running") continue;
    page.timer.baseElapsedMs = Math.min(elapsedOf(page.timer, now), page.timer.durationMs);
    page.timer.runningSince = null;
    page.timer.status = "paused";
  }
}

function parsePage(raw) {
  const text = String(raw).trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  if (n < 1 || n > 100000) return undefined;
  return n;
}

function setMessage(text) {
  messageText = text || "";
  el.message.textContent = messageText;
}

function setField(node, value, force) {
  if (!force && document.activeElement === node) return;
  const next = value == null ? "" : String(value);
  if (node.value !== next) node.value = next;
}

function blurSettings() {
  const form = document.getElementById("settings");
  if (form && document.activeElement && form.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

function applyStart(raw) {
  const n = parsePage(raw);
  if (n === undefined) {
    setMessage("Use um número de página a partir de 1.");
    return;
  }
  const book = active();
  book.startPage = n;
  if (n != null && book.pendingMeta && book.endPage == null) {
    const end = n + book.pendingMeta - 1;
    if (end - n + 1 > MAX_PAGES) {
      setMessage(`Use uma meta de até ${MAX_PAGES} páginas.`);
      book.startPage = n;
      save();
      renderAll();
      return;
    }
    book.endPage = end;
    book.pendingMeta = null;
  } else if (n != null && book.endPage != null && book.endPage < n) {
    book.endPage = n;
  }
  if (book.startPage != null && book.endPage != null) book.pendingMeta = null;
  if (book.openPage != null && !range(book).includes(book.openPage)) book.openPage = null;
  setMessage("");
  save();
  renderAll();
}

function applyEnd(raw) {
  const n = parsePage(raw);
  if (n === undefined) {
    setMessage("Use um número de página a partir de 1.");
    return;
  }
  const book = active();
  if (n != null && book.startPage != null && n < book.startPage) {
    setMessage("A página final precisa ser maior ou igual à inicial.");
    return;
  }
  if (n != null && book.startPage != null && n - book.startPage + 1 > MAX_PAGES) {
    setMessage(`Use uma meta de até ${MAX_PAGES} páginas.`);
    return;
  }
  book.endPage = n;
  if (n != null && book.startPage == null && book.pendingMeta) {
    const start = n - book.pendingMeta + 1;
    if (start >= 1 && book.pendingMeta <= MAX_PAGES) {
      book.startPage = start;
      book.pendingMeta = null;
    }
  }
  if (book.startPage != null && book.endPage != null) book.pendingMeta = null;
  if (book.openPage != null && !range(book).includes(book.openPage)) book.openPage = null;
  setMessage("");
  save();
  renderAll();
}

function applyMeta(raw) {
  const book = active();
  const text = String(raw).trim();
  if (text === "") {
    if (book.startPage == null || book.endPage == null) book.pendingMeta = null;
    setMessage("");
    save();
    renderAll();
    return;
  }
  if (!/^\d+$/.test(text)) {
    setMessage("A meta é um número de páginas.");
    return;
  }
  const meta = Number(text);
  if (meta < 1) return;
  if (meta > MAX_PAGES) {
    setMessage(`Use uma meta de até ${MAX_PAGES} páginas.`);
    return;
  }
  if (book.startPage != null) {
    book.endPage = book.startPage + meta - 1;
    book.pendingMeta = null;
  } else if (book.endPage != null) {
    const start = book.endPage - meta + 1;
    if (start < 1) {
      setMessage("Essa meta não cabe antes da página final.");
      return;
    }
    book.startPage = start;
    book.pendingMeta = null;
  } else {
    book.pendingMeta = meta;
  }
  if (book.openPage != null && !range(book).includes(book.openPage)) book.openPage = null;
  setMessage("");
  save();
  renderAll();
}

function applyMinutes(raw) {
  const book = active();
  const text = String(raw).trim();
  if (text === "") {
    book.minutesPerPage = null;
    setMessage("");
    save();
    renderAll();
    return;
  }
  if (!/^\d+$/.test(text)) {
    setMessage("Os minutos precisam ser um número inteiro.");
    return;
  }
  const n = Number(text);
  if (n < 1 || n > 600) {
    setMessage("Use entre 1 e 600 minutos por página.");
    return;
  }
  book.minutesPerPage = n;
  setMessage("");
  save();
  renderAll();
}

function openPage(n) {
  const book = active();
  if (!range(book).includes(n)) return;
  book.openPage = n;
  save();
  renderAll();
}

function startTimer(book, n) {
  if (book.minutesPerPage == null) {
    setMessage("Defina os minutos por página deste livro.");
    return;
  }
  const now = Date.now();
  for (const [key, other] of Object.entries(book.pages)) {
    if (Number(key) === n || !other.timer || other.timer.status !== "running") continue;
    other.timer.baseElapsedMs = Math.min(elapsedOf(other.timer, now), other.timer.durationMs);
    other.timer.runningSince = null;
    other.timer.status = "paused";
  }
  const page = ensurePage(book, n);
  if (page.done) return;
  if (page.timer && (page.timer.status === "running" || page.timer.status === "awaiting")) return;
  if (!page.timer) {
    page.timer = {
      status: "paused",
      durationMs: book.minutesPerPage * 60 * 1000,
      baseElapsedMs: 0,
      runningSince: null,
      concludeOpen: false
    };
  }
  if (!page.timer.baseElapsedMs) page.timer.durationMs = book.minutesPerPage * 60 * 1000;
  page.timer.status = "running";
  page.timer.runningSince = Date.now();
  page.timer.concludeOpen = false;
  save();
  renderAll();
}

function pauseTimer(book, n) {
  const page = pageRecord(book, n);
  if (!page || !page.timer || page.timer.status !== "running") return;
  page.timer.baseElapsedMs = Math.min(elapsedOf(page.timer), page.timer.durationMs);
  page.timer.runningSince = null;
  page.timer.status = "paused";
  save();
  renderAll();
}

function zeroTimer(book, n) {
  const page = ensurePage(book, n);
  if (page.done) return;
  page.timer = null;
  page.elapsedMs = 0;
  save();
  renderAll();
}

function openConclude(book, n) {
  if (book.minutesPerPage == null) {
    setMessage("Defina os minutos por página deste livro.");
    return;
  }
  const page = ensurePage(book, n);
  if (page.done) return;
  if (!page.timer) {
    page.timer = {
      status: "paused",
      durationMs: book.minutesPerPage * 60 * 1000,
      baseElapsedMs: 0,
      runningSince: null,
      concludeOpen: true
    };
  } else if (page.timer.status === "running") {
    page.timer.baseElapsedMs = Math.min(elapsedOf(page.timer), page.timer.durationMs);
    page.timer.runningSince = null;
    page.timer.status = "paused";
    page.timer.concludeOpen = true;
  } else {
    page.timer.concludeOpen = true;
  }
  save();
  renderAll();
  const quote = document.getElementById("quote");
  if (quote) quote.focus();
}

function resumeReading(book, n) {
  const page = pageRecord(book, n);
  if (!page || !page.timer || page.timer.status === "awaiting") return;
  page.timer.concludeOpen = false;
  save();
  renderAll();
}

function conclude(book, n, comment) {
  const page = ensurePage(book, n);
  const elapsed = page.timer ? Math.min(elapsedOf(page.timer), page.timer.durationMs) : page.elapsedMs || 0;
  page.done = true;
  page.comment = String(comment || "").trim();
  page.elapsedMs = elapsed;
  page.timer = null;
  save();
  renderAll();
}

function paceInfo(book, done, total) {
  if (!total) {
    return { text: "Defina a página inicial e a final para calcular o ritmo.", kind: "neutral" };
  }
  if (book.minutesPerPage == null) {
    return { text: "Defina os minutos por página para estimar o tempo.", kind: "neutral" };
  }
  const unread = total - done;
  if (unread === 0) return { text: "A meta deste livro está concluída.", kind: "ok" };
  const deadline = deadlineMs(book.deadline);
  if (deadline == null) {
    return { text: "Defina o prazo deste livro para comparar com o tempo de leitura.", kind: "neutral" };
  }
  const readMin = unread * book.minutesPerPage;
  const untilMin = (deadline - Date.now()) / 60000;
  if (untilMin <= 0) {
    return {
      text: `O prazo já passou há ${formatHM(-untilMin)}. A leitura que falta leva ${formatHM(readMin)}.`,
      kind: "over"
    };
  }
  const paceLabel = formatPace(unread / (untilMin / 60));
  if (readMin <= untilMin) {
    return {
      text: `Cabe no prazo, com ${formatHM(untilMin - readMin)} de folga. Ritmo necessário: ${paceLabel} páginas por hora.`,
      kind: "ok"
    };
  }
  return {
    text: `Não cabe no prazo: passa ${formatHM(readMin - untilMin)}. Para terminar a tempo, seriam ${paceLabel} páginas por hora.`,
    kind: "over"
  };
}

function renderSwitcher() {
  const book = active();
  el.select.replaceChildren();
  for (const item of state.books) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name.trim() || "Sem título";
    el.select.append(option);
  }
  el.select.value = book.id;
}

function renderSettings(force) {
  const book = active();
  setField(el.name, book.name, force);
  setField(el.start, book.startPage, force);
  setField(el.end, book.endPage, force);
  const meta = metaOf(book);
  setField(el.meta, meta == null ? book.pendingMeta : meta, force);
  setField(el.minutes, book.minutesPerPage, force);
  setField(el.deadline, book.deadline || "", force);
  el.deleteBtn.hidden = state.books.length < 2;
  el.hint.textContent = meta
    ? `Meta de ${meta} páginas, da ${book.startPage} à ${book.endPage}.`
    : "A meta acompanha a página final: meta = final − inicial + 1.";
  el.message.textContent = messageText;
}

function renderStats() {
  const book = active();
  const { total, done, unread } = counts(book);
  const meta = metaOf(book);
  const percent = formatPercent(done, total);
  const read = total ? `${done} de ${total}` : "—";
  const remaining = book.minutesPerPage == null || !total ? "—" : formatHM(unread * book.minutesPerPage);
  const expected = book.minutesPerPage == null || !total ? "—" : formatHM(total * book.minutesPerPage);
  const deadline = formatDeadline(book.deadline) || "não definido";
  const pace = paceInfo(book, done, total);
  const rangeLine = meta
    ? `Páginas ${book.startPage}–${book.endPage} · ${book.minutesPerPage == null ? "minutos não definidos" : `${book.minutesPerPage} min por página`}`
    : "Intervalo não definido";
  const name = book.name.trim() || "Sem título";
  const key = [name, rangeLine, percent, read, remaining, expected, deadline, pace.text].join("|");
  if (key === statsKey && el.stats.childElementCount) return;
  statsKey = key;

  const percentValue = total ? Math.round((done / total) * 1000) / 10 : 0;
  el.stats.replaceChildren();

  const nameEl = document.createElement("p");
  nameEl.id = "stat-name";
  nameEl.className = "stat-name";
  nameEl.textContent = name;

  const rangeEl = document.createElement("p");
  rangeEl.id = "stat-range";
  rangeEl.className = "stat-range";
  rangeEl.textContent = rangeLine;

  const percentEl = document.createElement("p");
  percentEl.id = "stat-percent";
  percentEl.className = "percent";
  percentEl.textContent = percent;

  const caption = document.createElement("p");
  caption.className = "percent-caption";
  caption.textContent = "da meta lida";

  const track = document.createElement("div");
  track.className = "track";
  track.id = "stat-bar";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(Math.round(percentValue)));
  track.setAttribute("aria-label", "Percentual da meta lida");

  const fill = document.createElement("div");
  fill.className = "fill";
  fill.id = "stat-fill";
  fill.style.width = `${Math.min(100, percentValue)}%`;

  const ribbon = document.createElement("div");
  ribbon.className = "ribbon";
  ribbon.id = "stat-ribbon";
  ribbon.style.left = `${Math.min(100, Math.max(percentValue, 1.5))}%`;

  track.append(fill, ribbon);

  const facts = document.createElement("dl");
  facts.className = "facts";
  facts.append(
    fact("Páginas lidas", read, "stat-read"),
    fact("Horas de leitura restantes", remaining, "stat-remaining"),
    fact("Tempo total previsto", expected, "stat-expected"),
    fact("Prazo", deadline, "stat-deadline")
  );

  const paceEl = document.createElement("p");
  paceEl.id = "stat-pace";
  paceEl.className = `pace pace-${pace.kind}`;
  paceEl.textContent = pace.text;

  el.stats.append(nameEl, rangeEl, percentEl, caption, track, facts, paceEl);
}

function fact(label, value, id) {
  const wrap = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.id = id;
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

function renderPrimary() {
  const book = active();
  const next = nextUnread(book);
  if (next == null) {
    el.primary.disabled = true;
    el.primary.textContent = range(book).length === 0 ? "Defina o intervalo de páginas" : "Meta concluída";
    return;
  }
  el.primary.disabled = false;
  const verb = statusOf(book, next) === "session" ? "Continuar" : "Ler";
  el.primary.textContent = `${verb} página ${next}`;
}

function renderList() {
  const book = active();
  const pages = range(book);
  el.list.replaceChildren();
  el.listHeading.textContent = "Páginas";
  el.listSub.textContent = pages.length ? `${pages.length} neste livro, da ${pages[0]} à ${pages[pages.length - 1]}.` : "Nenhuma página até o intervalo ser definido.";
  if (!pages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "Nenhuma página ainda. Informe a inicial e a final deste livro.";
    el.list.append(empty);
    return;
  }
  for (const n of pages) {
    const page = pageRecord(book, n);
    const status = statusOf(book, n);
    const button = document.createElement("div");
    button.className = `page-row ${status}`;
    button.dataset.page = String(n);
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.setAttribute("aria-label", `Página ${n}, ${STATUS_LABEL[status]}`);

    const number = document.createElement("span");
    number.className = "page-no";
    number.textContent = String(n);

    const pill = document.createElement("span");
    pill.className = `status ${status}`;
    pill.textContent = STATUS_LABEL[status];

    button.append(number, pill);

    if (page && page.timer && page.timer.status === "running") {
      const live = document.createElement("span");
      live.className = "row-time";
      live.dataset.liveClock = String(n);
      live.textContent = formatClock(remainingOf(page.timer));
      button.append(live);
    } else if (page && page.done && page.elapsedMs) {
      const time = document.createElement("span");
      time.className = "row-time";
      time.textContent = formatPrecise(page.elapsedMs);
      button.append(time);
    }

    const note = excerpt(page && page.comment);
    if (note) {
      const quote = document.createElement("span");
      quote.className = "excerpt";
      quote.textContent = note;
      button.append(quote);
    }

    const open = () => openPage(n);
    button.addEventListener("click", open);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
    el.list.append(button);
  }
}

function renderSession() {
  const book = active();
  const n = book.openPage;
  const page = pageRecord(book, n);
  const done = !!(page && page.done);
  const timer = page && page.timer;
  const showPanel = !!(timer && (timer.concludeOpen || timer.status === "awaiting"));
  el.session.replaceChildren();

  const kicker = document.createElement("p");
  kicker.className = "session-kicker";
  kicker.textContent = "Página";

  const title = document.createElement("h2");
  title.className = "session-title";
  title.textContent = String(n);

  const pill = document.createElement("p");
  pill.className = `status ${done ? "done" : timer ? "session" : "unread"}`;
  pill.textContent = STATUS_LABEL[done ? "done" : timer ? "session" : "unread"];
  pill.style.display = "inline-block";

  el.session.append(kicker, title, pill);

  if (done) {
    const card = document.createElement("div");
    card.className = "done-card";
    card.id = "done-card";

    const time = document.createElement("p");
    time.id = "done-time";
    time.textContent = `Tempo desta página: ${formatPrecise(page.elapsedMs || 0)}.`;

    const quote = document.createElement("blockquote");
    quote.className = "quote-block";
    quote.textContent = page.comment || "Sem citação ou comentário.";

    card.append(time, quote);

    const next = nextUnread(book);
    const actions = document.createElement("div");
    actions.className = "done-actions stack";
    if (next != null) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "next-unread";
      button.className = "btn btn-primary";
      button.textContent = `Ler página ${next}`;
      button.addEventListener("click", () => openPage(next));
      actions.append(button);
    } else {
      const all = document.createElement("p");
      all.textContent = "Você concluiu todas as páginas deste livro.";
      actions.append(all);
    }
    card.append(actions);
    el.session.append(card);
    return;
  }

  const clock = document.createElement("p");
  clock.id = "clock";
  clock.className = "clock";
  clock.setAttribute("aria-label", "Tempo restante");
  clock.textContent = formatClock(displayRemaining(book, n));

  const elapsed = document.createElement("p");
  elapsed.id = "elapsed-line";
  elapsed.className = "elapsed";
  elapsed.textContent = timer ? `Decorrido: ${formatPrecise(elapsedOf(timer))}` : "";

  const controls = document.createElement("div");
  controls.className = "controls";

  const start = button("btn-start", "Iniciar", "btn btn-primary", () => startTimer(book, n));
  const pause = button("btn-pause", "Pausar", "btn btn-secondary", () => pauseTimer(book, n));
  const zero = button("btn-zero", "Zerar", "btn btn-secondary", () => zeroTimer(book, n));
  start.disabled = book.minutesPerPage == null || (timer && (timer.status === "running" || timer.status === "awaiting"));
  pause.disabled = !(timer && timer.status === "running");
  zero.disabled = !timer;
  controls.append(start, pause, zero);

  const stack = document.createElement("div");
  stack.className = "stack";
  if (!showPanel) {
    const early = button("btn-early", "Concluir agora", "btn btn-secondary", () => openConclude(book, n));
    early.disabled = book.minutesPerPage == null;
    stack.append(early);
  }

  el.session.append(clock, elapsed, controls, stack);

  if (book.minutesPerPage == null) {
    const note = document.createElement("p");
    note.className = "session-note";
    note.textContent = "Defina os minutos por página deste livro para cronometrar.";
    el.session.append(note);
  }

  if (showPanel) {
    const panel = document.createElement("form");
    panel.className = "panel stack";
    panel.id = "conclude-panel";
    panel.addEventListener("submit", (event) => event.preventDefault());

    const label = document.createElement("label");
    label.htmlFor = "quote";
    label.textContent = "Citação ou comentário";

    const area = document.createElement("textarea");
    area.id = "quote";
    area.placeholder = "Pode ficar em branco.";
    area.value = page && page.comment ? page.comment : "";

    const ok = button("btn-ok", "Concluir página", "btn btn-primary", () => conclude(book, n, area.value));
    label.append(area);
    panel.append(label, ok);

    if (timer.status !== "awaiting") {
      const back = button("btn-resume", "Continuar lendo", "btn btn-ghost", () => resumeReading(book, n));
      panel.append(back);
    } else {
      const note = document.createElement("p");
      note.className = "session-note";
      note.textContent = "O tempo acabou. A página só fica lida quando você confirmar.";
      panel.append(note);
    }
    el.session.append(panel);
  }
}

function button(id, text, className, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.id = id;
  node.className = className;
  node.textContent = text;
  node.addEventListener("click", onClick);
  return node;
}

function renderView() {
  const book = active();
  const pages = range(book);
  if (book.openPage != null && !pages.includes(book.openPage)) {
    book.openPage = null;
    save();
  }
  const onPage = book.openPage != null;
  el.listView.hidden = onPage;
  el.pageView.hidden = !onPage;
  const page = onPage ? pageRecord(book, book.openPage) : null;
  const running = !!(page && page.timer && page.timer.status === "running");
  document.body.classList.toggle("focus", running);
  if (onPage) renderSession();
}

function renderAll(options = {}) {
  catchupAll();
  statsKey = "";
  renderSwitcher();
  renderSettings(options.forceSettings === true);
  renderStats();
  renderPrimary();
  renderList();
  renderView();
  if (pendingFocus === "name") {
    pendingFocus = null;
    el.name.focus();
  }
}

function updateClocks() {
  const book = active();
  const clock = document.getElementById("clock");
  if (clock && book.openPage != null) clock.textContent = formatClock(displayRemaining(book, book.openPage));
  const elapsed = document.getElementById("elapsed-line");
  if (elapsed && book.openPage != null) {
    const page = pageRecord(book, book.openPage);
    elapsed.textContent = page && page.timer ? `Decorrido: ${formatPrecise(elapsedOf(page.timer))}` : "";
  }
  document.querySelectorAll("[data-live-clock]").forEach((node) => {
    const page = pageRecord(book, Number(node.dataset.liveClock));
    if (page && page.timer && page.timer.status === "running") {
      node.textContent = formatClock(remainingOf(page.timer));
    }
  });
}

function slug(text) {
  const clean = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return clean || "livro";
}

function exportNotes() {
  const book = active();
  const title = book.name.trim() || "Sem título";
  const lines = [`# ${title}`, ""];
  const meta = metaOf(book);
  if (meta) lines.push(`Páginas ${book.startPage}–${book.endPage} (${meta} páginas).`, "");
  if (book.deadline) lines.push(`Prazo: ${formatDeadline(book.deadline)} (horário de Brasília).`, "");
  lines.push("Anotações só deste livro.", "");
  let any = false;
  for (const n of range(book)) {
    const page = pageRecord(book, n);
    if (!page || (!page.done && !page.comment)) continue;
    any = true;
    lines.push(`## Página ${n}`, "");
    if (page.elapsedMs) lines.push(`Tempo de leitura: ${formatPrecise(page.elapsedMs)}.`, "");
    if (page.comment) lines.push(page.comment.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"), "");
    else lines.push("_Sem citação ou comentário._", "");
  }
  if (!any) lines.push("_Nenhuma anotação ainda._", "");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `anotacoes-${slug(title)}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function deleteActive() {
  if (state.books.length < 2) return;
  const book = active();
  const label = book.name.trim() || "Sem título";
  if (!window.confirm(`Excluir "${label}"? As páginas e anotações deste livro serão apagadas deste navegador.`)) return;
  state.books = state.books.filter((item) => item.id !== book.id);
  state.activeBookId = state.books[0].id;
  save();
  renderAll();
}

function bind() {
  el.select.addEventListener("change", () => {
    if (el.select.value === active().id) return;
    blurSettings();
    pauseBook(active());
    state.activeBookId = el.select.value;
    messageText = "";
    save();
    renderAll({ forceSettings: true });
  });

  el.newBook.addEventListener("click", () => {
    pauseBook(active());
    const book = createBlankBook();
    state.books.push(book);
    state.activeBookId = book.id;
    messageText = "";
    pendingFocus = "name";
    save();
    renderAll({ forceSettings: true });
  });

  el.name.addEventListener("input", () => {
    active().name = el.name.value;
    save();
    renderSwitcher();
    statsKey = "";
    renderStats();
  });

  el.start.addEventListener("input", () => applyStart(el.start.value));
  el.end.addEventListener("input", () => applyEnd(el.end.value));
  el.meta.addEventListener("input", () => applyMeta(el.meta.value));
  el.minutes.addEventListener("input", () => applyMinutes(el.minutes.value));
  el.deadline.addEventListener("input", () => {
    active().deadline = el.deadline.value;
    save();
    statsKey = "";
    renderStats();
  });

  el.start.addEventListener("blur", () => {
    if (parsePage(el.start.value) === undefined) {
      setMessage("");
      renderSettings();
    }
  });
  el.end.addEventListener("blur", () => {
    const book = active();
    const n = parsePage(el.end.value);
    if (n === undefined) {
      setMessage("");
      renderSettings();
      return;
    }
    if (n != null && book.startPage != null && n < book.startPage) {
      book.endPage = book.startPage;
      book.pendingMeta = null;
      setMessage("A página final foi ajustada para não ficar antes da inicial.");
      save();
      renderAll();
    }
  });
  el.meta.addEventListener("blur", () => {
    const text = el.meta.value.trim();
    if (text === "" || !/^\d+$/.test(text) || Number(text) < 1 || Number(text) > MAX_PAGES) {
      if (Number(text) > MAX_PAGES) setMessage(`Use uma meta de até ${MAX_PAGES} páginas.`);
      renderSettings();
    }
  });
  el.minutes.addEventListener("blur", () => {
    const text = el.minutes.value.trim();
    if (text !== "" && (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 600)) renderSettings();
  });

  document.getElementById("settings").addEventListener("submit", (event) => event.preventDefault());
  el.exportBtn.addEventListener("click", exportNotes);
  el.deleteBtn.addEventListener("click", deleteActive);
  el.primary.addEventListener("click", () => {
    const next = nextUnread(active());
    if (next != null) openPage(next);
  });
  el.back.addEventListener("click", () => {
    active().openPage = null;
    save();
    renderAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || active().openPage == null) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    active().openPage = null;
    save();
    renderAll();
  });
}

bind();
renderAll();

let lastPace = 0;
window.setInterval(() => {
  const changed = catchupAll();
  updateClocks();
  if (changed) renderAll();
  else if (Date.now() - lastPace > 1000) {
    lastPace = Date.now();
    renderStats();
  }
}, 250);
