const javaStatusEl = document.getElementById("java-status");
const statTotalServersEl = document.getElementById("stat-total-servers");
const statJavaVerEl = document.getElementById("stat-java-ver");
const statPublicIpEl = document.getElementById("stat-public-ip");
const serverListEl = document.getElementById("server-list");
const emptyStateEl = document.getElementById("empty-state");

const createModalEl = document.getElementById("create-modal");
const btnOpenCreate = document.getElementById("btn-open-create");
const btnEmptyCreate = document.getElementById("btn-empty-create");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnCancelCreate = document.getElementById("btn-cancel-create");
const createServerForm = document.getElementById("create-server-form");
const serverNameInput = document.getElementById("server-name");
const versionSelect = document.getElementById("version-select");
const loaderCards = document.querySelectorAll(".loader-card");
const themeToggleBtn = document.getElementById("btn-theme-toggle");

const progressOverlayEl = document.getElementById("progress-overlay");
const progressStepEl = document.getElementById("progress-step");
const progressBarFill = document.getElementById("progress-bar-fill");

let selectedLoader = "vanilla";
let versionsLoaded = false;
let serversList = [];

async function init() {
  initTheme();
  await updateJavaStatus();
  await updatePublicIp();
  await loadServers();
  setupEventListeners();
}

function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "dark";
  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
    themeToggleBtn.innerText = "Light";
  } else {
    document.body.classList.remove("light-theme");
    themeToggleBtn.innerText = "Dark";
  }
}

async function updatePublicIp() {
  try {
    const ip = await window.api.getPublicIp();
    statPublicIpEl.innerText = ip;
  } catch (e) {
    statPublicIpEl.innerText = "Unavailable";
  }
}

async function updateJavaStatus() {
  try {
    const status = await window.api.checkJava();
    if (status.installed) {
      javaStatusEl.className = "java-status-badge";
      javaStatusEl.innerHTML = `<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:#10b981; margin-right:6px;"></span> Java Installed`;
      statJavaVerEl.innerText = status.version.split("_")[0] || status.version;
    } else {
      javaStatusEl.className = "java-status-badge missing";
      javaStatusEl.innerHTML = `⚠️ Java Missing! <a href="https://adoptium.net/" target="_blank">Install Link</a>`;
      statJavaVerEl.innerText = "Missing";
    }
  } catch (e) {
    javaStatusEl.className = "java-status-badge missing";
    javaStatusEl.innerHTML = `⚠️ Java Status Unknown`;
    statJavaVerEl.innerText = "Unknown";
  }
}

async function loadServers() {
  try {
    serversList = await window.api.getServers();
    statTotalServersEl.innerText = serversList.length;

    if (serversList.length === 0) {
      emptyStateEl.style.display = "flex";
      serverListEl.style.display = "none";
    } else {
      emptyStateEl.style.display = "none";
      serverListEl.style.display = "flex";
      renderServers();
    }
  } catch (e) {
    console.error("Failed to load servers", e);
  }
}

function renderServers() {
  serverListEl.innerHTML = "";

  const sorted = [...serversList].sort((a, b) => b.created - a.created);

  sorted.forEach((server) => {
    const item = document.createElement("div");
    item.className = "server-item";

    const allocatedRam = server.ram || 2;
    const useAikar = server.useAikarFlags || false;
    const autoRestart = server.autoRestart || false;
    const guiEnabled = server.guiEnabled || false;

    item.innerHTML = `
      <div class="server-header">
        <div class="server-info">
          <div class="server-name">${server.name}</div>
          <div class="server-meta">
            <span class="loader-badge ${server.loader}">${server.loader}</span>
            <span>Minecraft ${server.version}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm btn-settings-toggle">Settings</button>
      </div>

      <div class="server-settings-panel">
        <div class="settings-row">
          <span class="settings-label">Allocated RAM</span>
          <div class="settings-ram-wrapper">
            <input type="range" class="ram-slider" min="1" max="16" value="${allocatedRam}">
            <span class="ram-value">${allocatedRam} GB</span>
          </div>
        </div>
        <div class="settings-row">
          <label class="settings-checkbox-label"><input type="checkbox" class="setting-checkbox use-aikar" ${useAikar ? "checked" : ""}> Enable Aikar's Flags</label>
        </div>
        <div class="settings-row">
          <label class="settings-checkbox-label"><input type="checkbox" class="setting-checkbox auto-restart" ${autoRestart ? "checked" : ""}> Auto restart</label>
        </div>
        <div class="settings-row">
          <label class="settings-checkbox-label"><input type="checkbox" class="setting-checkbox gui-enabled" ${guiEnabled ? "checked" : ""}> Enable GUI</label>
        </div>
      </div>

      <div class="server-actions">
        <button class="btn btn-secondary btn-sm btn-open-folder" title="Open server directory folder">Open Folder</button>
        <button class="btn btn-danger btn-sm btn-delete" title="Delete this server and all files">Delete</button>
        <button class="btn btn-primary btn-sm btn-start" title="Launch the server console">Start Server</button>
      </div>
    `;

    const settingsPanel = item.querySelector(".server-settings-panel");
    const settingsToggle = item.querySelector(".btn-settings-toggle");
    const slider = item.querySelector(".ram-slider");
    const ramValue = item.querySelector(".ram-value");
    const aikarCheckbox = item.querySelector(".use-aikar");
    const autoRestartCheckbox = item.querySelector(".auto-restart");
    const guiCheckbox = item.querySelector(".gui-enabled");

    let currentRam = allocatedRam;
    let currentUseAikar = useAikar;
    let currentAutoRestart = autoRestart;
    let currentGuiEnabled = guiEnabled;

    const saveServerSettings = async (settings) => {
      try {
        const updated = await window.api.updateServerSettings({
          folderName: server.folderName,
          settings,
        });
        Object.assign(server, updated);
      } catch (err) {
        alert(`Unable to update server settings: ${err.message}`);
      }
    };

    settingsToggle.addEventListener("click", () => {
      settingsPanel.classList.toggle("active");
    });

    slider.addEventListener("input", async (e) => {
      currentRam = parseInt(e.target.value, 10);
      ramValue.innerText = `${currentRam} GB`;
      await saveServerSettings({ ram: currentRam });
    });

    aikarCheckbox.addEventListener("change", async (e) => {
      currentUseAikar = e.target.checked;
      await saveServerSettings({ useAikarFlags: currentUseAikar });
    });

    autoRestartCheckbox.addEventListener("change", async (e) => {
      currentAutoRestart = e.target.checked;
      await saveServerSettings({ autoRestart: currentAutoRestart });
    });

    guiCheckbox.addEventListener("change", async (e) => {
      currentGuiEnabled = e.target.checked;
      await saveServerSettings({ guiEnabled: currentGuiEnabled });
    });

    const btnStart = item.querySelector(".btn-start");
    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      btnStart.innerText = "⏳ Starting...";

      try {
        const res = await window.api.startServer({
          folderName: server.folderName,
          ram: currentRam,
          useAikarFlags: currentUseAikar,
          autoRestart: currentAutoRestart,
          guiEnabled: currentGuiEnabled,
        });

        if (!res.success && res.error === "java_missing") {
          alert(
            "Java is not installed on this system. Please download and install it via the link in the top-right header.",
          );
          await updateJavaStatus();
        } else if (!res.success) {
          alert("Failed to start server: Unknown error.");
        }
      } catch (err) {
        alert(`Failed to launch server: ${err.message}`);
      } finally {
        btnStart.disabled = false;
        btnStart.innerText = "⚡ Start Server";
      }
    });

    const btnOpenFolder = item.querySelector(".btn-open-folder");
    btnOpenFolder.addEventListener("click", async () => {
      try {
        await window.api.openServerFolder(server.folderName);
      } catch (err) {
        alert(err.message);
      }
    });

    const btnDelete = item.querySelector(".btn-delete");
    btnDelete.addEventListener("click", async () => {
      const confirmDelete = confirm(
        `Are you sure you want to permanently delete the server "${server.name}"? This action will erase ALL server folders, maps, and configuration files.`,
      );
      if (confirmDelete) {
        try {
          await window.api.deleteServer(server.folderName);
          await loadServers();
        } catch (err) {
          alert(`Deletion failed: ${err.message}`);
        }
      }
    });

    serverListEl.appendChild(item);
  });
}

async function populateVersions() {
  if (versionsLoaded) return;

  try {
    const select = versionSelect;
    select.innerHTML =
      '<option value="" disabled selected>Select a version...</option>';

    const versions = await window.api.getVersions();

    versions.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.innerText = v.id;
      select.appendChild(opt);
    });

    versionsLoaded = true;
  } catch (e) {
    versionSelect.innerHTML =
      '<option value="" disabled>Failed to load versions</option>';
    console.error(e);
  }
}

function setupEventListeners() {
  themeToggleBtn.addEventListener("click", () => {
    if (document.body.classList.contains("light-theme")) {
      document.body.classList.remove("light-theme");
      localStorage.setItem("theme", "dark");
      themeToggleBtn.innerText = "Dark";
    } else {
      document.body.classList.add("light-theme");
      localStorage.setItem("theme", "light");
      themeToggleBtn.innerText = "Light";
    }
  });

  const openModal = async () => {
    createModalEl.classList.add("active");
    await populateVersions();
  };

  const closeModal = () => {
    createModalEl.classList.remove("active");
    createServerForm.reset();
    loaderCards.forEach((c) => c.classList.remove("selected"));
    document.querySelector('[data-loader="vanilla"]').classList.add("selected");
    selectedLoader = "vanilla";
  };

  btnOpenCreate.addEventListener("click", openModal);
  btnEmptyCreate.addEventListener("click", openModal);
  btnCloseModal.addEventListener("click", closeModal);
  btnCancelCreate.addEventListener("click", closeModal);

  createModalEl.addEventListener("click", (e) => {
    if (e.target === createModalEl) closeModal();
  });

  loaderCards.forEach((card) => {
    card.addEventListener("click", () => {
      loaderCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedLoader = card.getAttribute("data-loader");
    });
  });

  createServerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const serverName = serverNameInput.value.trim();
    const version = versionSelect.value;
    const loader = selectedLoader;

    if (!serverName || !version) {
      alert("Please fill out all fields.");
      return;
    }

    progressOverlayEl.classList.add("active");
    progressStepEl.innerText = "Initializing project space...";
    progressBarFill.style.width = "0%";

    const unsubscribe = window.api.onCreationProgress((progress) => {
      progressStepEl.innerText = progress.step;
      progressBarFill.style.width = `${progress.percent}%`;
    });

    try {
      const result = await window.api.createServer({
        name: serverName,
        loader: loader,
        version: version,
      });

      if (result.success) {
        closeModal();
        await loadServers();
      }
    } catch (err) {
      alert(`Server creation failed: ${err.message}`);
    } finally {
      unsubscribe();
      progressOverlayEl.classList.remove("active");
    }
  });
}

window.addEventListener("DOMContentLoaded", init);
