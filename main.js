const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const { exec } = require("node:child_process");

const appDataPath = path.join(
  process.env.APPDATA || app.getPath("appData"),
  "CraftPanel",
);
const serversPath = path.join(appDataPath, "servers");
const configFilePath = path.join(appDataPath, "servers.json");

function initDirectories() {
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
  }
  if (!fs.existsSync(serversPath)) {
    fs.mkdirSync(serversPath, { recursive: true });
  }
  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, JSON.stringify([]), "utf8");
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "CraftPanel/1.0.0",
      },
    };
    https
      .get(url, options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(`Failed to fetch JSON: HTTP ${res.statusCode}`),
          );
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
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

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    function request(targetUrl) {
      const options = {
        headers: {
          "User-Agent": "CraftPanel/1.0.0",
        },
      };
      https
        .get(targetUrl, options, (res) => {
          if (
            [301, 302, 307, 308].includes(res.statusCode) &&
            res.headers.location
          ) {
            request(res.headers.location);
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            file.close();
            fs.unlink(destPath, () => {});
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
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

          res.on("error", (err) => {
            file.close();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        })
        .on("error", (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
    }

    request(url);
  });
}

function validateDownloadUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "CraftPanel/1.0.0",
      },
      method: "HEAD",
    };

    function request(targetUrl) {
      const req = https.request(targetUrl, options, (res) => {
        if (
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          request(res.headers.location);
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve();
        }

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
        const version = match ? match[1] || match[2] : "Unknown";
        resolve({ installed: true, version });
      }
    });
  });
}

function generateLaunchBatch(serverDir, jarName, ram, options) {
  const batchPath = path.join(serverDir, "craftpanel-start.bat");
  const flags = [`-Xms${ram}G`, `-Xmx${ram}G`];
  if (options.useAikarFlags) {
    flags.push(
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
    );
  }
  if (!options.guiEnabled) {
    flags.push("nogui");
  }

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

function launchServer(serverDir, ram, loader, options = {}) {
  return new Promise((resolve, reject) => {
    const jarName =
      loader === "fabric" ? "fabric-server-launch.jar" : "server.jar";

    const serverJar = path.join(serverDir, jarName);

    if (!fs.existsSync(serverJar)) {
      return reject(new Error(`${jarName} file not found in directory`));
    }

    const jvmFlags = [`-Xms${ram}G`, `-Xmx${ram}G`];

    if (options.useAikarFlags) {
      jvmFlags.push(
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
      );
    }

    const mcArgs = [];
    if (!options.guiEnabled) {
      mcArgs.push("nogui");
    }

    let launchCommand = `java ${jvmFlags.join(" ")} -jar ${jarName} ${mcArgs.join(" ")}`;

    if (options.autoRestart) {
      generateLaunchBatch(serverDir, jarName, ram, options);
      launchCommand = "call craftpanel-start.bat";
    }

    const cmd = `start "" /d "${serverDir}" cmd.exe /k "title CraftPanel Server - ${path.basename(serverDir)} && ${launchCommand}"`;

    exec(cmd, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readConfig() {
  try {
    if (!fs.existsSync(configFilePath)) return [];
    const raw = fs.readFileSync(configFilePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeConfig(data) {
  fs.writeFileSync(configFilePath, JSON.stringify(data, null, 2), "utf8");
}

let mainWindow;
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    minWidth: 800,
    minHeight: 600,
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

app.whenReady().then(() => {
  initDirectories();

  ipcMain.handle("check-java", async () => {
    return await checkJavaInstalled();
  });

  ipcMain.handle("get-versions", async () => {
    try {
      const manifest = await fetchJson(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      );
      return manifest.versions
        .filter((v) => v.type === "release")
        .map((v) => ({ id: v.id, url: v.url }));
    } catch (e) {
      throw new Error(`Failed to fetch Minecraft versions: ${e.message}`);
    }
  });

  ipcMain.handle("get-servers", () => {
    return readConfig();
  });

  ipcMain.handle("create-server", async (event, { name, loader, version }) => {
    const sanitizedName = name.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const targetDir = path.join(serversPath, sanitizedName);

    if (fs.existsSync(targetDir)) {
      throw new Error("A server folder with this name already exists.");
    }

    const config = readConfig();
    if (config.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A server with this name already exists.");
    }

    const sendProgress = (step, percent) => {
      if (mainWindow) {
        mainWindow.webContents.send("server-creation-progress", {
          step,
          percent,
        });
      }
    };

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      let downloadUrl = "";

      console.log(
        `Creating server "${name}" with loader "${loader}" for Minecraft version "${version}"`,
      );

      if (loader === "vanilla") {
        sendProgress("Fetching Minecraft release details...", 10);
        const versions = await fetchJson(
          "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
        );
        const versionObj = versions.versions.find((v) => v.id === version);
        if (!versionObj)
          throw new Error(`Version ${version} not found in Mojang database.`);

        const details = await fetchJson(versionObj.url);
        if (!details.downloads || !details.downloads.server) {
          throw new Error(
            `Vanilla Minecraft ${version} does not have a server package available.`,
          );
        }
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
        if (
          !latestBuild ||
          !latestBuild.downloads ||
          !latestBuild.downloads["server:default"]
        ) {
          throw new Error(
            `No stable Paper builds found for version ${version}.`,
          );
        }
        downloadUrl = latestBuild.downloads["server:default"].url;
      } else if (loader === "fabric") {
        sendProgress("Resolving Fabric Loader version...", 10);
        const loaderList = await fetchJson(
          `https://meta.fabricmc.net/v2/versions/loader/${version}`,
        );
        if (!loaderList || loaderList.length === 0) {
          throw new Error(
            `Fabric is not compatible or available for Minecraft ${version}.`,
          );
        }
        const loaderVersion = loaderList[0].loader.version;

        sendProgress("Resolving Fabric Installer version...", 15);
        const installerList = await fetchJson(
          "https://meta.fabricmc.net/v2/versions/installer",
        );
        const stableInstaller =
          installerList.find((i) => i.stable) || installerList[0];
        if (!stableInstaller) {
          throw new Error("No compatible Fabric Installers found.");
        }
        const installerVersion = stableInstaller.version;

        downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderVersion}/${installerVersion}/server/jar`;
      } else {
        throw new Error("Invalid server loader selected.");
      }

      const jarName =
        loader === "fabric" ? "fabric-server-launch.jar" : "server.jar";
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
      });

      sendProgress("Generating eula.txt file...", 95);
      const eulaPath = path.join(targetDir, "eula.txt");
      fs.writeFileSync(
        eulaPath,
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
      if (fs.existsSync(targetDir)) {
        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
        } catch (_) {}
      }
      throw new Error(err.message);
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
      if (!server) {
        throw new Error("Server configuration not found.");
      }
      const targetDir = path.join(serversPath, folderName);
      const javaStatus = await checkJavaInstalled();

      if (!javaStatus.installed) {
        return { success: false, error: "java_missing" };
      }

      try {
        await launchServer(targetDir, ram || server.ram || 2, server.loader, {
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
        });
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
      const serverIndex = config.findIndex((s) => s.folderName === folderName);
      if (serverIndex === -1) {
        throw new Error("Server configuration not found.");
      }

      const updatedServer = {
        ...config[serverIndex],
        ...settings,
      };
      config[serverIndex] = updatedServer;
      writeConfig(config);
      return updatedServer;
    },
  );

  ipcMain.handle("get-public-ip", async () => {
    try {
      const res = await fetchJson("https://api.ipify.org?format=json");
      return res.ip || "Unknown";
    } catch (e) {
      return "Unavailable";
    }
  });

  ipcMain.handle("delete-server", (event, folderName) => {
    const targetDir = path.join(serversPath, folderName);

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    const config = readConfig();
    const updated = config.filter((s) => s.folderName !== folderName);
    writeConfig(updated);

    return { success: true };
  });

  ipcMain.handle("open-server-folder", async (event, folderName) => {
    const targetDir = path.join(serversPath, folderName);
    if (fs.existsSync(targetDir)) {
      await shell.openPath(targetDir);
      return { success: true };
    } else {
      throw new Error("Server folder no longer exists.");
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
