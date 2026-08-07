(function () {
  "use strict";

  /* =========================================================
     Armazenamento (localStorage com fallback em memória)
     ========================================================= */

  const STORAGE_KEY = "peladex_state_v1";
  let memoryFallback = null;
  let storageAvailable = true;

  (function testStorage() {
    try {
      const testKey = "__peladex_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
    } catch (e) {
      storageAvailable = false;
    }
  })();

  function loadState() {
    const fallback = {
      players: [],
      numberOfTeams: 2,
      result: null,
      view: "configuring",
    };
    if (!storageAvailable) return memoryFallback || fallback;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        players: Array.isArray(parsed.players) ? parsed.players : [],
        numberOfTeams: [2, 3, 4].includes(parsed.numberOfTeams) ? parsed.numberOfTeams : 2,
        result: parsed.result || null,
        view: parsed.view === "result" ? "result" : "configuring",
      };
    } catch (e) {
      return fallback;
    }
  }

  function saveState() {
    if (!storageAvailable) {
      memoryFallback = state;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageAvailable = false;
      memoryFallback = state;
    }
  }

  /* =========================================================
     Estado
     ========================================================= */

  let state = loadState();
  let idCounter = state.players.reduce((max, p) => Math.max(max, p.id || 0), 0);
  let isDrawing = false;

  /* =========================================================
     Elementos
     ========================================================= */

  const el = {
    viewConfig: document.getElementById("view-config"),
    viewDrawing: document.getElementById("view-drawing"),
    viewResult: document.getElementById("view-result"),

    playerForm: document.getElementById("playerForm"),
    playerName: document.getElementById("playerName"),
    playerError: document.getElementById("playerError"),
    playerList: document.getElementById("playerList"),
    playerCount: document.getElementById("playerCount"),
    emptyHint: document.getElementById("emptyHint"),

    teamOptions: Array.from(document.querySelectorAll(".team-option")),
    summaryLine: document.getElementById("summaryLine"),

    drawBtn: document.getElementById("drawBtn"),
    drawError: document.getElementById("drawError"),

    drawingTitle: document.getElementById("drawingTitle"),
    drawingName: document.getElementById("drawingName"),

    teamsGrid: document.getElementById("teamsGrid"),
    redrawBtn: document.getElementById("redrawBtn"),
    copyBtn: document.getElementById("copyBtn"),

    newGameBtn: document.getElementById("newGameBtn"),
    confirmOverlay: document.getElementById("confirmOverlay"),
    confirmOk: document.getElementById("confirmOk"),
    confirmCancel: document.getElementById("confirmCancel"),

    toast: document.getElementById("toast"),
  };

  const TEAM_NAMES = [
    { label: "TIME 1", emoji: "🔵" },
    { label: "TIME 2", emoji: "🔴" },
    { label: "TIME 3", emoji: "🟡" },
    { label: "TIME 4", emoji: "🟢" },
  ];

  /* =========================================================
     Toast
     ========================================================= */

  let toastTimer = null;
  function showToast(message, isError) {
    el.toast.textContent = message;
    el.toast.classList.toggle("is-error", Boolean(isError));
    el.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, 2600);
  }

  /* =========================================================
     Aleatoriedade: Fisher-Yates com fonte segura quando disponível
     ========================================================= */

  function secureRandomInt(maxExclusive) {
    if (window.crypto && window.crypto.getRandomValues) {
      const range = maxExclusive;
      const maxUint32 = 0xffffffff;
      const limit = maxUint32 - (maxUint32 % range);
      let rand;
      const buf = new Uint32Array(1);
      do {
        window.crypto.getRandomValues(buf);
        rand = buf[0];
      } while (rand >= limit);
      return rand % range;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  function fisherYatesShuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Embaralha e distribui todos os jogadores em N times, round-robin,
   * garantindo que ninguém fica de fora e a diferença entre times é no máximo 1.
   */
  function distributeTeams(players, numberOfTeams) {
    const shuffled = fisherYatesShuffle(players);
    const teams = Array.from({ length: numberOfTeams }, () => []);
    shuffled.forEach((player, index) => {
      teams[index % numberOfTeams].push(player);
    });
    return { teams, order: shuffled };
  }

  /* =========================================================
     Render: jogadores
     ========================================================= */

  function renderPlayers() {
    el.playerList.innerHTML = "";
    state.players.forEach((player) => {
      const li = document.createElement("li");
      li.className = "player-item";
      li.dataset.id = player.id;

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = player.name;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.innerHTML = "&times;";
      removeBtn.setAttribute("aria-label", `Remover ${player.name}`);
      removeBtn.addEventListener("click", () => removePlayer(player.id));

      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(removeBtn);
      el.playerList.appendChild(li);
    });

    const count = state.players.length;
    el.playerCount.textContent = `${count} jogador${count === 1 ? "" : "es"}`;
    el.emptyHint.style.display = count === 0 ? "block" : "none";

    updateSummary();
    updateDrawButton();
  }

  function updateSummary() {
    const count = state.players.length;
    el.summaryLine.textContent = `${count} jogador${count === 1 ? "" : "es"} • ${state.numberOfTeams} time${state.numberOfTeams === 1 ? "" : "s"}`;
  }

  function updateDrawButton() {
    const enough = state.players.length >= state.numberOfTeams && state.players.length >= 2;
    el.drawBtn.disabled = !enough || isDrawing;
    el.drawError.textContent = "";
  }

  /* =========================================================
     Ações: jogadores
     ========================================================= */

  function addPlayer(rawName) {
    const name = rawName.trim().replace(/\s+/g, " ");
    el.playerError.textContent = "";

    if (!name) {
      el.playerError.textContent = "Digite o nome do jogador.";
      return false;
    }
    if (name.length > 24) {
      el.playerError.textContent = "Nome muito longo (máx. 24 caracteres).";
      return false;
    }
    const isDuplicate = state.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) {
      el.playerError.textContent = "Esse jogador já foi adicionado.";
      return false;
    }

    idCounter += 1;
    state.players.push({ id: idCounter, name });
    saveState();
    renderPlayers();
    return true;
  }

  function removePlayer(id) {
    const li = el.playerList.querySelector(`[data-id="${id}"]`);
    if (li) {
      li.classList.add("is-removing");
      setTimeout(() => {
        state.players = state.players.filter((p) => p.id !== id);
        saveState();
        renderPlayers();
      }, 180);
    } else {
      state.players = state.players.filter((p) => p.id !== id);
      saveState();
      renderPlayers();
    }
  }

  /* =========================================================
     Ações: seleção de times
     ========================================================= */

  function selectTeamCount(n) {
    state.numberOfTeams = n;
    el.teamOptions.forEach((btn) => {
      const selected = Number(btn.dataset.teams) === n;
      btn.classList.toggle("is-selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
    saveState();
    updateSummary();
    updateDrawButton();
  }

  /* =========================================================
     Views
     ========================================================= */

  function showView(view) {
    el.viewConfig.hidden = view !== "configuring";
    el.viewDrawing.hidden = view !== "drawing";
    el.viewResult.hidden = view !== "result";
  }

  /* =========================================================
     Sorteio + animação
     ========================================================= */

  function runDraw() {
    if (isDrawing) return;
    if (state.players.length < state.numberOfTeams || state.players.length < 2) {
      el.drawError.textContent = `São necessários pelo menos ${Math.max(state.numberOfTeams, 2)} jogadores.`;
      return;
    }

    isDrawing = true;
    updateDrawButton();
    el.redrawBtn.disabled = true;
    showView("drawing");

    const { teams, order } = distributeTeams(state.players, state.numberOfTeams);

    // Fase de "embaralhando": nomes passando rapidamente por ~1.6s
    el.drawingTitle.textContent = "EMBARALHANDO...";
    let flashCount = 0;
    const flashTotal = 16;
    const flashInterval = setInterval(() => {
      const random = order[secureRandomInt(order.length)];
      el.drawingName.textContent = random.name;
      flashCount += 1;
      if (flashCount >= flashTotal) {
        clearInterval(flashInterval);
      }
    }, 100);

    const totalDuration = 2600 + secureRandomInt(900); // 2.6s–3.5s

    setTimeout(() => {
      clearInterval(flashInterval);
      el.drawingTitle.textContent = "TIMES DEFINIDOS!";
      el.drawingName.textContent = "";

      setTimeout(() => {
        state.result = teams.map((teamPlayers) => teamPlayers.map((p) => p.name));
        state.view = "result";
        saveState();
        renderResult();
        showView("result");
        isDrawing = false;
        el.redrawBtn.disabled = false;
        updateDrawButton();
      }, 500);
    }, totalDuration);
  }

  function renderResult() {
    el.teamsGrid.innerHTML = "";
    const teams = state.result || [];
    el.teamsGrid.classList.toggle("cols-2", teams.length === 2);

    teams.forEach((teamPlayers, teamIndex) => {
      const info = TEAM_NAMES[teamIndex] || { label: `TIME ${teamIndex + 1}`, emoji: "⚪" };

      const card = document.createElement("div");
      card.className = `team-card team-${teamIndex % 4}`;

      const head = document.createElement("div");
      head.className = "team-card-head";

      const dot = document.createElement("span");
      dot.className = "team-card-dot";
      dot.setAttribute("aria-hidden", "true");

      const title = document.createElement("h3");
      title.className = "team-card-title";
      title.textContent = `${info.emoji} ${info.label}`;

      head.appendChild(dot);
      head.appendChild(title);

      const list = document.createElement("ul");
      list.className = "team-card-players";
      teamPlayers.forEach((name, i) => {
        const li = document.createElement("li");
        li.textContent = name;
        li.style.animationDelay = `${i * 0.05}s`;
        list.appendChild(li);
      });

      card.appendChild(head);
      card.appendChild(list);
      el.teamsGrid.appendChild(card);
    });
  }

  function buildResultText() {
    const teams = state.result || [];
    let text = "⚽ PELADEX\n\n";
    teams.forEach((teamPlayers, teamIndex) => {
      const info = TEAM_NAMES[teamIndex] || { label: `TIME ${teamIndex + 1}`, emoji: "⚪" };
      text += `${info.emoji} ${info.label}\n`;
      teamPlayers.forEach((name) => {
        text += `${name}\n`;
      });
      text += "\n";
    });
    return text.trim();
  }

  async function copyResult() {
    const text = buildResultText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("Resultado copiado!");
        return;
      }
      throw new Error("clipboard API indisponível");
    } catch (e) {
      // Fallback para navegadores sem Clipboard API
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
          showToast("Resultado copiado!");
        } else {
          throw new Error("execCommand falhou");
        }
      } catch (fallbackError) {
        showToast("Não foi possível copiar. Selecione e copie manualmente.", true);
      }
    }
  }

  /* =========================================================
     Novo jogo
     ========================================================= */

  function openConfirm() {
    el.confirmOverlay.hidden = false;
    el.confirmOk.focus();
  }

  function closeConfirm() {
    el.confirmOverlay.hidden = true;
  }

  function resetAll() {
    state = { players: [], numberOfTeams: 2, result: null, view: "configuring" };
    idCounter = 0;
    saveState();
    renderPlayers();
    selectTeamCount(2);
    showView("configuring");
    closeConfirm();
    showToast("Novo jogo iniciado!");
  }

  /* =========================================================
     Eventos
     ========================================================= */

  el.playerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const added = addPlayer(el.playerName.value);
    if (added) {
      el.playerName.value = "";
      el.playerName.focus();
    }
  });

  el.playerName.addEventListener("input", () => {
    el.playerError.textContent = "";
  });

  el.teamOptions.forEach((btn) => {
    btn.addEventListener("click", () => selectTeamCount(Number(btn.dataset.teams)));
  });

  el.drawBtn.addEventListener("click", runDraw);
  el.redrawBtn.addEventListener("click", runDraw);
  el.copyBtn.addEventListener("click", copyResult);

  el.newGameBtn.addEventListener("click", openConfirm);
  el.confirmCancel.addEventListener("click", closeConfirm);
  el.confirmOk.addEventListener("click", resetAll);
  el.confirmOverlay.addEventListener("click", (e) => {
    if (e.target === el.confirmOverlay) closeConfirm();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.confirmOverlay.hidden) closeConfirm();
  });

  /* =========================================================
     Inicialização
     ========================================================= */

  function init() {
    if (!storageAvailable) {
      showToast("Seu navegador bloqueou o armazenamento local. Os dados não serão salvos.", true);
    }
    renderPlayers();
    selectTeamCount(state.numberOfTeams);

    if (state.view === "result" && state.result) {
      renderResult();
      showView("result");
    } else {
      showView("configuring");
    }
  }

  init();
})();
