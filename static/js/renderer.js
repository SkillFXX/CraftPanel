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
const versionLabelEl = document.querySelector('label[for="version-select"]');
const loaderCards = document.querySelectorAll(".loader-card");

const progressOverlayEl = document.getElementById("progress-overlay");
const progressStepEl = document.getElementById("progress-step");
const progressBarFill = document.getElementById("progress-bar-fill");

document.getElementById("minimize").onclick = () => {
  window.api.windowMinimize();
};

document.getElementById("maximize").onclick = () => {
  window.api.windowMaximize();
};

document.getElementById("close").onclick = () => {
  window.api.windowClose();
};
let selectedLoader = "vanilla";
let versionsLoaded = false;
let serversList = [];

async function init() {
  await initTheme();
  await updateJavaStatus();
  await updatePublicIp();
  await loadServers();
  setupEventListeners();
}

async function initTheme() {
  try {
    const useDark = await window.api.getTheme();
    setTheme(useDark);
    window.api.onThemeUpdated((isDark) => setTheme(isDark));
  } catch (e) {
    console.error("Failed to initialize theme:", e);
  }
}

function setTheme(useDark) {
  if (useDark) {
    document.body.classList.remove("light-theme");
  } else {
    document.body.classList.add("light-theme");
  }
}

function toast(message, type) {
  Toastify({
    text: message,
    duration: 5000,
    close: true,
    className: type,
  }).showToast();
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
    <div class="server-info-wrapper">
      <img src="assets/${server.loader}.png" alt="${server.loader}" class="loader-logo" onerror="this.style.display='none'">
      
      <div class="server-info">
        <div class="server-name">${server.name}</div>
        <div class="server-meta">
          <span class="loader-badge loader-${server.loader}">${server.loader}</span>
          <span class="version-badge">Minecraft ${server.version}</span>
        </div>
      </div>
    </div>
    
    <button class="btn-icon btn-settings-toggle" title="Settings">
      <img src="assets/settings.svg" alt="Settings">
    </button>
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
      <label class="settings-checkbox-container">
        <input type="checkbox" class="setting-checkbox use-aikar" ${useAikar ? "checked" : ""}>
        <span class="custom-checkbox"></span>
        Enable Aikar's Flags
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-checkbox-container">
        <input type="checkbox" class="setting-checkbox auto-restart" ${autoRestart ? "checked" : ""}>
        <span class="custom-checkbox"></span>
        Auto restart
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-checkbox-container">
        <input type="checkbox" class="setting-checkbox gui-enabled" ${guiEnabled ? "checked" : ""}>
        <span class="custom-checkbox"></span>
        Enable GUI
      </label>
    </div>
  </div>

  <div class="server-actions">
    <div class="actions-left">
      <button class="btn btn-secondary btn-open-folder" title="Open server directory folder">
        <img src="assets/folder.svg" alt="" class="btn-icon-svg">
        <span>Open Folder</span>
      </button>
      <button class="btn btn-danger btn-delete" title="Delete this server and all files">
        <img src="assets/delete.svg" alt="" class="btn-icon-svg">
      </button>
    </div>
    
    <button class="btn btn-primary btn-start" title="Launch the server console">
      <img src="assets/power.svg" alt="" class="btn-icon-svg brightness-invert">
      <span>Start Server</span>
    </button>
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
        toast(`Unable to update server settings: ${err.message}`, "error");
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
      btnStart.innerHTML = `<img src="assets/started.svg" alt="" class="btn-icon-svg brightness-invert"><span>Started</span>`;

      try {
        const res = await window.api.startServer({
          folderName: server.folderName,
          ram: currentRam,
          useAikarFlags: currentUseAikar,
          autoRestart: currentAutoRestart,
          guiEnabled: currentGuiEnabled,
        });

        if (!res.success && res.error === "java_missing") {
          toast(
            "Java is not installed on this system. Please download and install it via the link in the top-right header.",
            "error",
          );
          await updateJavaStatus();
        } else if (!res.success) {
          toast("Failed to start server: Unknown error.", "error");
        }
      } catch (err) {
        toast(`Failed to launch server: ${err.message}`, "error");
      } finally {
        btnStart.disabled = false;
        btnStart.innerHTML = `<img src="assets/power.svg" alt="" class="btn-icon-svg brightness-invert"><span>Start Server</span>`;
      }
    });

    const btnOpenFolder = item.querySelector(".btn-open-folder");
    btnOpenFolder.addEventListener("click", async () => {
      try {
        await window.api.openServerFolder(server.folderName);
      } catch (err) {
        toast(`Failed to open server folder: ${err.message}`, "error");
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
          toast(`Deletion failed: ${err.message}`, "error");
        }
      }
    });

    serverListEl.appendChild(item);
  });
}

function getVersionLabel(loader) {
  if (loader === "velocity") return "Velocity Version";
  if (loader === "forge") return "Forge Version";
  if (loader === "neoforge") return "NeoForge Version";
  return "Minecraft Version";
}

async function populateVersions(loader = selectedLoader) {
  versionsLoaded = false;

  try {
    versionLabelEl.innerText = getVersionLabel(loader);
    versionSelect.innerHTML =
      '<option value="" disabled selected>Loading versions...</option>';

    const versions = await window.api.getVersions(loader);

    versionSelect.innerHTML =
      '<option value="" disabled selected>Select a version...</option>';

    versions.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.innerText = v.label;
      versionSelect.appendChild(opt);
    });

    versionsLoaded = true;
  } catch (e) {
    versionSelect.innerHTML =
      '<option value="" disabled>Failed to load versions</option>';
    console.error(e);
  }
}

function setupEventListeners() {
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
    card.addEventListener("click", async () => {
      loaderCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedLoader = card.getAttribute("data-loader");
      versionsLoaded = false;
      if (createModalEl.classList.contains("active")) {
        await populateVersions(selectedLoader);
      }
    });
  });

  createServerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const serverName = serverNameInput.value.trim();
    const version = versionSelect.value;
    const loader = selectedLoader;

    if (!serverName || !version) {
      toast("Please fill out all fields.", "error");
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
      toast(err, "error");
    } finally {
      unsubscribe();
      progressOverlayEl.classList.remove("active");
    }
  });
}

window.addEventListener("DOMContentLoaded", init);
