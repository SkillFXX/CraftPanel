const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const { exec } = require("node:child_process");

const HTTP_OPTIONS = {
  headers: {
    "User-Agent": "CraftPanel/1.0.0",
  },
};

const AIKAR_FLAGS = [
  "-XX:+UseG1GC",
  "-XX:+ParallelRefProcEnabled",
  "-XX:MaxGCPauseMillis=200",
  "-XX:+UnlockExperimentalVMOptions",
  "-XX:+DisableExplicitGC",
  "-XX:+AlwaysPreTouch",
  "-XX:G1NewSizePercent=30",
  "-XX:G1MaxNewSizePercent=40",
  "-XX:G1HeapRegionSize=8M",
  "-XX:G1ReservePercent=20",
  "-XX:InitiatingHeapOccupancyPercent=15",
  "-XX:G1MixedGCCountTarget=4",
  "-XX:G1MixedGCLiveThresholdPercent=90",
  "-XX:+PerfDisableSharedMem",
  "-XX:MaxTenuringThreshold=1",
  "-Dusing.aikars.flags=https://mcflags.emc.gs",
  "-Daikars.new.flags=true",
];

const appDataPath = path.join(
  process.env.APPDATA || app.getPath("appData"),
  "CraftPanel",
);
const serversPath = path.join(appDataPath, "servers");
const configFilePath = path.join(appDataPath, "servers.json");

let mainWindow;

function initDirectories() {
  if (!fs.existsSync(appDataPath))
    fs.mkdirSync(appDataPath, { recursive: true });
  if (!fs.existsSync(serversPath))
    fs.mkdirSync(serversPath, { recursive: true });
  if (!fs.existsSync(configFilePath))
    fs.writeFileSync(configFilePath, JSON.stringify([]), "utf8");
}

function getJvmFlags(ram, useAikarFlags) {
  const flags = [`-Xms${ram}G`, `-Xmx${ram}G`];
  if (useAikarFlags) flags.push(...AIKAR_FLAGS);
  return flags;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, HTTP_OPTIONS, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`Failed to fetch JSON: HTTP ${res.statusCode}`),
          );
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON format: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, HTTP_OPTIONS, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`Failed to fetch text: HTTP ${res.statusCode}`),
          );
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const handleError = (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    };

    function request(targetUrl) {
      https
        .get(targetUrl, HTTP_OPTIONS, (res) => {
          if (
            [301, 302, 307, 308].includes(res.statusCode) &&
            res.headers.location
          ) {
            return request(res.headers.location);
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return handleError(
              new Error(`Download failed: HTTP ${res.statusCode}`),
            );
          }

          const totalBytes = parseInt(res.headers["content-length"], 10) || 0;
          let downloadedBytes = 0;

          res.on("data", (chunk) => {
            downloadedBytes += chunk.length;
            file.write(chunk);
            if (onProgress && totalBytes > 0) {
              onProgress({
                downloaded: downloadedBytes,
                total: totalBytes,
                percent: Math.round((downloadedBytes / totalBytes) * 100),
              });
            }
          });
          res.on("end", () => {
            file.end();
            resolve();
          });
          res.on("error", handleError);
        })
        .on("error", handleError);
    }
    request(url);
  });
}

function validateDownloadUrl(url) {
  return new Promise((resolve, reject) => {
    const options = { ...HTTP_OPTIONS, method: "HEAD" };

    function request(targetUrl) {
      const req = https.request(targetUrl, options, (res) => {
        if (
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          return request(res.headers.location);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
        reject(new Error(`Download URL not available: HTTP ${res.statusCode}`));
      });
      req.on("error", reject);
      req.end();
    }
    request(url);
  });
}

function checkJavaInstalled() {
  return new Promise((resolve) => {
    exec("java -version", (error, stdout, stderr) => {
      const output = stderr || stdout;
      if (error || !output) {
        resolve({ installed: false, version: null });
      } else {
        const match = output.match(
          /version "([^"]+)"|openjdk version "([^"]+)"/,
        );
        resolve({
          installed: true,
          version: match ? match[1] || match[2] : "Unknown",
        });
      }
    });
  });
}

function generateLaunchBatch(serverDir, jarName, ram, options) {
  const batchPath = path.join(serverDir, "craftpanel-start.bat");
  const flags = getJvmFlags(ram, options.useAikarFlags);
  if (!options.guiEnabled) flags.push("nogui");

  const javaCommand = `java ${flags.join(" ")} -jar "${jarName}"`;
  const lines = [
    "@echo off",
    `cd /d "${serverDir}"`,
    ":craftpanel_server_restart",
    "echo Starting CraftPanel server...",
    javaCommand,
    "echo.",
    "echo Server stopped. Restarting in 5 seconds...",
    "timeout /t 5 /nobreak >nul",
    "goto craftpanel_server_restart",
  ];
  fs.writeFileSync(batchPath, lines.join("\r\n"), "utf8");
  return batchPath;
}

function findLaunchJar(serverDir, loader) {
  if (loader === "fabric") return "fabric-server-launch.jar";

  if (loader === "forge" || loader === "neoforge") {
    const files = fs
      .readdirSync(serverDir)
      .filter((file) => file.endsWith(".jar"));
    const candidates = files
      .filter(
        (file) =>
          !file.includes("installer") &&
          !file.includes("fabric-server-launch") &&
          !file.includes("minecraft_server") &&
          !file.includes("forge-installer") &&
          !file.includes("neoforge-installer"),
      )
      .sort();

    const launchJar = candidates.find((file) => file.startsWith(`${loader}-`));
    if (launchJar) return launchJar;
    if (files.includes("server.jar")) return "server.jar";
    if (files.length > 0) return files[0];
    return "server.jar";
  }

  return "server.jar";
}

function launchServer(serverDir, ram, loader, options = {}) {
  return new Promise((resolve, reject) => {
    const jarName = findLaunchJar(serverDir, loader);
    const serverJar = path.join(serverDir, jarName);

    if (!fs.existsSync(serverJar)) {
      return reject(new Error(`${jarName} file not found in directory`));
    }

    const jvmFlags = getJvmFlags(ram, options.useAikarFlags);
    const mcArgs = !options.guiEnabled ? ["nogui"] : [];
    let launchCommand = `java ${jvmFlags.join(" ")} -jar "${jarName}" ${mcArgs.join(" ")}`;

    if (options.autoRestart) {
      generateLaunchBatch(serverDir, jarName, ram, options);
      launchCommand = "call craftpanel-start.bat";
    }

    const cmd = `start "" /d "${serverDir}" cmd.exe /k "title CraftPanel Server - ${path.basename(serverDir)} && ${launchCommand}"`;
    exec(cmd, (error) => (error ? reject(error) : resolve()));
  });
}

function readConfig() {
  try {
    if (!fs.existsSync(configFilePath)) return [];
    return JSON.parse(fs.readFileSync(configFilePath, "utf8"));
  } catch {
    return [];
  }
}

function writeConfig(data) {
  fs.writeFileSync(configFilePath, JSON.stringify(data, null, 2), "utf8");
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "CraftPanel",
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("index.html");
};

function setupUserTasks() {
  if (process.platform === "win32") {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: "--action=new-server",
        iconPath: process.execPath,
        iconIndex: 0,
        title: "Create a server",
        description: "Opens the CraftPanel server creation wizard",
      },
    ]);
  }
}

app.whenReady().then(() => {
  initDirectories();
  setupUserTasks();

  ipcMain.handle("check-java", async () => await checkJavaInstalled());

  ipcMain.handle("get-theme", () => nativeTheme.shouldUseDarkColors);

  ipcMain.handle("get-versions", async (event, loader = "vanilla") => {
    try {
      if (loader === "velocity") {
        const project = await fetchJson(
          "https://api.papermc.io/v2/projects/velocity",
        );
        return project.versions.map((v) => ({ id: v, label: v }));
      }

      const manifest = await fetchJson(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      );
      return manifest.versions
        .filter((v) => v.type === "release")
        .map((v) => ({ id: v.id, label: v.id }));
    } catch (e) {
      throw new Error(`Failed to fetch versions: ${e.message}`);
    }
  });

  ipcMain.handle("get-servers", () => readConfig());

  ipcMain.handle("create-server", async (event, { name, loader, version }) => {
    const sanitizedName = name.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const targetDir = path.join(serversPath, sanitizedName);

    if (fs.existsSync(targetDir))
      throw new Error("A server folder with this name already exists.");

    const config = readConfig();
    if (config.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A server with this name already exists.");
    }

    const sendProgress = (step, percent) => {
      if (mainWindow)
        mainWindow.webContents.send("server-creation-progress", {
          step,
          percent,
        });
    };

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      let downloadUrl = "";

      if (loader === "vanilla") {
        sendProgress("Fetching Minecraft release details...", 10);
        const versions = await fetchJson(
          "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
        );
        const versionObj = versions.versions.find((v) => v.id === version);
        if (!versionObj) throw new Error(`Version ${version} not found.`);

        const details = await fetchJson(versionObj.url);
        if (!details.downloads || !details.downloads.server)
          throw new Error("No vanilla server package available.");
        downloadUrl = details.downloads.server.url;
      } else if (loader === "purpur") {
        sendProgress("Verifying Purpur compatibility...", 15);
        downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
      } else if (loader === "paper") {
        sendProgress("Fetching PaperMC builds list...", 10);
        const response = await fetchJson(
          `https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`,
        );
        const stableBuilds = response.filter((b) => b.channel === "STABLE");
        const latestBuild =
          stableBuilds.length > 0 ? stableBuilds[0] : response[0];
        if (!latestBuild?.downloads?.["server:default"])
          throw new Error(`No Paper builds found.`);
        downloadUrl = latestBuild.downloads["server:default"].url;
      } else if (loader === "velocity" || loader === "folia") {
        sendProgress(`Fetching ${loader} builds...`, 15);
        const response = await fetchJson(
          `https://api.papermc.io/v2/projects/${loader}/versions/${version}/builds`,
        );
        if (
          !response ||
          !Array.isArray(response.builds) ||
          response.builds.length === 0
        )
          throw new Error(`${loader} version ${version} not found.`);

        const selectedBuild =
          response.builds.find((b) => b.promoted) ||
          response.builds.find((b) => b.channel === "STABLE") ||
          response.builds[0];

        const fileInfo =
          selectedBuild.downloads.application ||
          Object.values(selectedBuild.downloads)[0];
        if (!fileInfo || !fileInfo.name)
          throw new Error(`Failed to resolve ${loader} download file.`);

        downloadUrl = `https://api.papermc.io/v2/projects/${loader}/versions/${version}/builds/${selectedBuild.build}/downloads/${fileInfo.name}`;
      } else if (loader === "fabric") {
        sendProgress("Resolving Fabric Loader version...", 10);
        const loaderList = await fetchJson(
          `https://meta.fabricmc.net/v2/versions/loader/${version}`,
        );
        if (!loaderList || loaderList.length === 0)
          throw new Error("Fabric not available.");

        sendProgress("Resolving Fabric Installer version...", 15);
        const installerList = await fetchJson(
          "https://meta.fabricmc.net/v2/versions/installer",
        );
        const stableInstaller =
          installerList.find((i) => i.stable) || installerList[0];

        downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderList[0].loader.version}/${stableInstaller.version}/server/jar`;
      } else if (loader === "quilt") {
        sendProgress("Fetching Quilt loader metadata...", 10);
        const loaderVersions = await fetchJson(
          `https://meta.quiltmc.org/v3/versions/loader/${version}`,
        );
        if (!loaderVersions || loaderVersions.length === 0)
          throw new Error("Quilt loader not available for this version.");

        const loaderVersion = loaderVersions[0].loader.version;
        sendProgress("Resolving Quilt installer...", 15);
        const installers = await fetchJson(
          "https://meta.quiltmc.org/v3/versions/installer",
        );
        if (!installers || installers.length === 0)
          throw new Error("Quilt installer metadata unavailable.");

        const installerVersion = installers[0].version;
        downloadUrl = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installerVersion}/quilt-installer-${installerVersion}.jar`;
      } else if (loader === "forge") {
        sendProgress("Finding Forge installer for selected version...", 10);
        const metadataXml = await fetchText(
          "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
        );
        const versionMatches = [
          ...metadataXml.matchAll(/<version>([^<]+)<\/version>/g),
        ]
          .map((match) => match[1])
          .filter((v) => v.startsWith(`${version}-`));

        if (!versionMatches.length)
          throw new Error(`No Forge installer found for Minecraft ${version}.`);

        const forgeVersion = versionMatches
          .sort((a, b) =>
            a.localeCompare(b, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          )
          .pop();

        downloadUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
      } else if (loader === "neoforge") {
        sendProgress("Finding NeoForge installer for selected version...", 10);
        const metadataXml = await fetchText(
          "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
        );

        let neoPrefix = "";
        const parts = version.split(".");
        if (version === "1.20.1") {
          neoPrefix = "47.1.";
        } else if (parts.length === 2) {
          neoPrefix = `${parts[1]}.0.`;
        } else {
          neoPrefix = `${parts[1]}.${parts[2]}.`;
        }

        const versionMatches = [
          ...metadataXml.matchAll(/<version>([^<]+)<\/version>/g),
        ]
          .map((match) => match[1])
          .filter((v) => v.startsWith(neoPrefix));

        if (!versionMatches.length)
          throw new Error(
            `No NeoForge installer found for Minecraft ${version}.`,
          );

        const neoforgeVersion = versionMatches
          .sort((a, b) =>
            a.localeCompare(b, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          )
          .pop();

        downloadUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoforgeVersion}/neoforge-${neoforgeVersion}-installer.jar`;
      } else {
        throw new Error("Invalid loader.");
      }

      const isInstallerJar =
        loader === "quilt" || loader === "forge" || loader === "neoforge";
      const jarName = isInstallerJar
        ? loader === "quilt"
          ? "quilt-installer.jar"
          : loader === "neoforge"
            ? "neoforge-installer.jar"
            : "forge-installer.jar"
        : loader === "fabric"
          ? "fabric-server-launch.jar"
          : `server.jar`;
      const jarDest = path.join(targetDir, jarName);

      sendProgress("Validating server package availability...", 22);
      await validateDownloadUrl(downloadUrl);
      sendProgress("Downloading server jar file...", 25);

      await downloadFile(downloadUrl, jarDest, (progress) => {
        const overallPercent = 25 + Math.round(progress.percent * 0.65);
        sendProgress(
          `Downloading server jar... (${progress.percent}%)`,
          overallPercent,
        );

        if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
      });

      if (mainWindow) mainWindow.setProgressBar(-1);

      if (loader === "forge") {
        sendProgress("Installing Forge server...", 70);
        await new Promise((resolve, reject) => {
          exec(
            `java -jar "${jarDest}" --installServer`,
            { cwd: targetDir },
            (error, stdout, stderr) => {
              if (error)
                return reject(new Error(stderr || stdout || error.message));
              resolve();
            },
          );
        });
      } else if (loader === "neoforge") {
        sendProgress("Installing NeoForge server...", 70);
        await new Promise((resolve, reject) => {
          exec(
            `java -jar "${jarDest}" --installServer`,
            { cwd: targetDir },
            (error, stdout, stderr) => {
              if (error)
                return reject(new Error(stderr || stdout || error.message));
              resolve();
            },
          );
        });
      } else if (loader === "quilt") {
        sendProgress("Installing Quilt server...", 70);
        const loaderVersions = await fetchJson(
          `https://meta.quiltmc.org/v3/versions/loader/${version}`,
        );
        const loaderVersion = loaderVersions[0].loader.version;
        await new Promise((resolve, reject) => {
          exec(
            `java -jar "${jarDest}" install server "${version}" "${loaderVersion}" --install-dir="${targetDir}" --download-server --create-scripts`,
            { cwd: targetDir },
            (error, stdout, stderr) => {
              if (error)
                return reject(new Error(stderr || stdout || error.message));
              resolve();
            },
          );
        });
      }

      if (mainWindow) mainWindow.setProgressBar(-1);

      sendProgress("Generating eula.txt file...", 95);
      fs.writeFileSync(
        path.join(targetDir, "eula.txt"),
        "# Generated by CraftPanel\neula=true\n",
        "utf8",
      );

      const newServer = {
        name,
        folderName: sanitizedName,
        loader,
        version,
        ram: 2,
        useAikarFlags: false,
        autoRestart: false,
        guiEnabled: false,
        created: Date.now(),
      };
      config.push(newServer);
      writeConfig(config);

      sendProgress("Server created successfully!", 100);
      return { success: true, server: newServer };
    } catch (err) {
      if (mainWindow) mainWindow.setProgressBar(-1);
      if (fs.existsSync(targetDir)) {
        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
        } catch (_) {}
      }
      throw new Error(
        `${err.message.includes("HTTP") ? "Version not found or API unavailable" : err.message}`,
      );
    }
  });

  ipcMain.handle(
    "start-server",
    async (
      event,
      { folderName, ram, useAikarFlags, autoRestart, guiEnabled } = {},
    ) => {
      const config = readConfig();
      const server = config.find((s) => s.folderName === folderName);
      if (!server) throw new Error("Server configuration not found.");

      const javaStatus = await checkJavaInstalled();
      if (!javaStatus.installed)
        return { success: false, error: "java_missing" };

      try {
        await launchServer(
          path.join(serversPath, folderName),
          ram || server.ram || 2,
          server.loader,
          {
            useAikarFlags:
              typeof useAikarFlags === "boolean"
                ? useAikarFlags
                : server.useAikarFlags || false,
            autoRestart:
              typeof autoRestart === "boolean"
                ? autoRestart
                : server.autoRestart || false,
            guiEnabled:
              typeof guiEnabled === "boolean"
                ? guiEnabled
                : server.guiEnabled || false,
          },
        );
        return { success: true };
      } catch (e) {
        throw new Error(`Failed to start server: ${e.message}`);
      }
    },
  );

  ipcMain.handle(
    "update-server-settings",
    (event, { folderName, settings }) => {
      const config = readConfig();
      const index = config.findIndex((s) => s.folderName === folderName);
      if (index === -1) throw new Error("Server not found.");

      config[index] = { ...config[index], ...settings };
      writeConfig(config);
      return config[index];
    },
  );

  ipcMain.handle("get-public-ip", async () => {
    try {
      const res = await fetchJson("https://api.ipify.org?format=json");
      return res.ip || "Unknown";
    } catch {
      return "Unavailable";
    }
  });

  ipcMain.handle("delete-server", (event, folderName) => {
    const targetDir = path.join(serversPath, folderName);
    if (fs.existsSync(targetDir))
      fs.rmSync(targetDir, { recursive: true, force: true });

    writeConfig(readConfig().filter((s) => s.folderName !== folderName));
    return { success: true };
  });

  ipcMain.handle("open-server-folder", async (event, folderName) => {
    const targetDir = path.join(serversPath, folderName);
    if (!fs.existsSync(targetDir))
      throw new Error("Server folder no longer exists.");
    await shell.openPath(targetDir);
    return { success: true };
  });

  ipcMain.on("window-minimize", () => {
    BrowserWindow.getFocusedWindow().minimize();
  });

  ipcMain.on("window-maximize", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on("window-close", () => {
    BrowserWindow.getFocusedWindow().close();
  });

  nativeTheme.on("updated", () => {
    if (mainWindow)
      mainWindow.webContents.send(
        "native-theme-updated",
        nativeTheme.shouldUseDarkColors,
      );
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
