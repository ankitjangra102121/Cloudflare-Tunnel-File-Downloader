document.addEventListener("DOMContentLoaded", function () {
  // DOM Elements
  const cloudflareUrlsInput = document.getElementById("cloudflareUrls");
  const fetchFilesBtn = document.getElementById("fetchFilesBtn");
  const fileListBody = document.getElementById("fileListBody");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const globalProgress = document.getElementById("globalProgress");
  const progressStatus = document.getElementById("progressStatus");
  const progressStats = document.getElementById("progressStats");
  const downloadSpeed = document.getElementById("downloadSpeed");
  const timeRemaining = document.getElementById("timeRemaining");
  const individualProgress = document.getElementById("individualProgress");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const closeModalBtns = document.querySelectorAll(".close-modal");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const maxFileSizeInput = document.getElementById("maxFileSize");

  // State
  let currentFiles = [];
  let downloadQueue = [];
  let activeDownloads = 0;
  let completedDownloads = 0;
  let totalFilesToDownload = 0;
  let downloadStartTime = null;
  let downloadedBytes = 0;
  let lastBytesUpdate = 0;
  let lastUpdateTime = 0;
  let downloadSpeedValue = 0;
  let maxParallelDownloads = 4;
  let maxFileSizeMB = 500;
  let lastDownloadDate = null;

  // Initialize settings
  function loadSettings() {
    const settings =
      JSON.parse(localStorage.getItem("cfDownloaderSettings")) || {};

    maxParallelDownloads = settings.maxParallelDownloads || 4;
    maxFileSizeMB = settings.maxFileSizeMB || 500;
    cloudflareUrlsInput.value = settings.cloudflareUrls || "";

    // Update UI elements
    maxFileSizeInput.value = maxFileSizeMB;
  }

  function saveSettings() {
    const settings = {
      maxParallelDownloads: maxParallelDownloads,
      maxFileSizeMB: parseInt(maxFileSizeInput.value) || 500,
      cloudflareUrls: cloudflareUrlsInput.value.trim(),
    };

    localStorage.setItem("cfDownloaderSettings", JSON.stringify(settings));
    loadSettings();
  }
  setTimeout(() => {
    location.reload();
  }, 24 * 60 * 60 * 1000); // Reload after every 24 hours

  function toggleModal(show) {
    settingsModal.style.display = show ? "flex" : "none";
  }

  // Event Listeners
  settingsBtn.addEventListener("click", () => toggleModal(true));
  closeModalBtns.forEach((btn) =>
    btn.addEventListener("click", () => toggleModal(false))
  );
  saveSettingsBtn.addEventListener("click", () => {
    saveSettings();
    toggleModal(false);
  });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      toggleModal(false);
    }
  });

  // Load settings when page loads
  loadSettings();

  // If URLs are already saved, fetch files immediately
  if (cloudflareUrlsInput.value.trim()) {
    fetchFiles();
  }

  // Fetch files from server
  fetchFilesBtn.addEventListener("click", fetchFiles);
  refreshBtn.addEventListener("click", fetchFiles);

  // Select all checkbox
  selectAllCheckbox.addEventListener("change", function () {
    const checkboxes = document.querySelectorAll(".file-checkbox");
    checkboxes.forEach((checkbox) => {
      checkbox.checked = this.checked;
    });
    downloadAllBtn.disabled = !this.checked;
  });

  // Download all selected files
  downloadAllBtn.addEventListener("click", function () {
    const selectedFiles = [];
    const checkboxes = document.querySelectorAll(".file-checkbox:checked");

    checkboxes.forEach((checkbox) => {
      const fileId = checkbox.dataset.fileId;
      const file = currentFiles.find((f) => f.id === fileId);
      if (file) selectedFiles.push(file);
    });

    if (selectedFiles.length > 0) {
      startDownload(selectedFiles);
    }
  });

  // Handle Enter key in URL textarea
  cloudflareUrlsInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      fetchFiles();
    }
  });

  // Fetch files from multiple Cloudflare URLs
  async function fetchFiles() {
    const urls = cloudflareUrlsInput.value
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u && u.includes("trycloudflare.com"));

    if (urls.length === 0) {
      showError("Please enter at least one valid Cloudflare tunnel URL.");
      return;
    }

    try {
      fetchFilesBtn.disabled = true;
      fetchFilesBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Connecting...';

      const response = await fetch("/api/process-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloudflareUrls: urls }),
      });

      // Check response type before parsing
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(`Server returned: ${text.substring(0, 50)}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      // Show all files in the UI, with source info
      currentFiles = data.files.map((file, index) => ({
        ...file,
        id: `file-${index}`,
        status: file.status || "queued",
        progress: 0,
      }));

      renderFileList();
      downloadAllBtn.disabled = currentFiles.length === 0;

      // Save the URLs to settings
      saveSettings();

      // --- Only yesterday's .nc files ---
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const year = String(yesterday.getFullYear()).slice(-1);
      const month = String(yesterday.getMonth() + 1).padStart(2, "0");
      const day = String(yesterday.getDate()).padStart(2, "0");
      const pattern = `A${year}${month}${day}`; // e.g., "A250701" for July 1, 2025

      const filteredFiles = currentFiles.filter((file) => {
        const isNC = file.name.toLowerCase().endsWith(".nc");
        const isYesterday = file.name.includes(pattern);
        const sizeMatch = file.size && file.size.match(/(\d+\.?\d*)\s*MB/i);
        const sizeMB = sizeMatch ? parseFloat(sizeMatch[1]) : null;
        return (
          isNC && isYesterday && (sizeMB === null || sizeMB <= maxFileSizeMB)
        );
      });

      if (filteredFiles.length > 0) {
        startDownload(filteredFiles);
      } else {
        showError("No previous day's .nc files found.");
      }
    } catch (error) {
      showError(
        error.message.includes("<")
          ? "Server returned HTML instead of JSON. Check your URL and server configuration."
          : error.message
      );
      // Clear the saved URLs and input if fetch fails
      cloudflareUrlsInput.value = "";
      const settings =
        JSON.parse(localStorage.getItem("cfDownloaderSettings")) || {};
      settings.cloudflareUrls = "";
      localStorage.setItem("cfDownloaderSettings", JSON.stringify(settings));
    } finally {
      fetchFilesBtn.disabled = false;
      fetchFilesBtn.innerHTML = '<i class="fas fa-search"></i> Connect';
    }
  }

  function showError(msg) {
    alert(msg);
  }

  function formatFileSizeKB(size) {
    if (size === undefined || size === null || size === "") {
      return "Unknown";
    }
    if (typeof size === "number" && !isNaN(size)) {
      return `${Math.round(size / 1024)} KB`;
    }
    if (typeof size === "string") {
      const s = size.trim();
      if (!s) return "Unknown";
      const kbMatch = s.match(/([\d.]+)\s*kb/i);
      if (kbMatch) return `${Math.round(parseFloat(kbMatch[1]))} KB`;
      const mbMatch = s.match(/([\d.]+)\s*mb/i);
      if (mbMatch) return `${Math.round(parseFloat(mbMatch[1]) * 1024)} KB`;
      const bytesMatch = s.match(/([\d.]+)\s*b/i);
      if (bytesMatch)
        return `${Math.round(parseFloat(bytesMatch[1]) / 1024)} KB`;
      const numMatch = s.match(/^[\d.]+$/);
      if (numMatch) return `${Math.round(parseFloat(s) / 1024)} KB`;
    }
    return "Unknown";
  }

  function formatFileStatus(status) {
    if (!status || typeof status !== "string" || !status.trim()) {
      return "Queued";
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  // Render file list table
  function renderFileList() {
    if (currentFiles.length === 0) {
      fileListBody.innerHTML = `
      <tr class="empty-state">
        <td colspan="5">
          <i class="fas fa-folder-open"></i>
          <p>No files found matching your filters</p>
        </td>
      </tr>
    `;
      return;
    }

    fileListBody.innerHTML = "";
    currentFiles.forEach((file) => {
      const row = document.createElement("tr");
      row.dataset.fileId = file.id;

      const sizeDisplay = formatFileSizeKB(file.size);
      const statusDisplay = formatFileStatus(file.status);

      row.innerHTML = `
      <td><input type="checkbox" class="file-checkbox" data-file-id="${file.id}" checked></td>
      <td><i class="fas ${getFileIcon(file.name)}"></i> ${file.name}</td>
      <td>${sizeDisplay}</td>
      <td>
        <span class="status-badge status-${file.status || "unknown"}">
          ${statusDisplay}
        </span>
      </td>
    `;

      fileListBody.appendChild(row);
    });

    // Add event listeners to checkboxes
    document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", function () {
        const anyChecked =
          document.querySelectorAll(".file-checkbox:checked").length > 0;
        downloadAllBtn.disabled = !anyChecked;
      });
    });
  }

  // Get appropriate file icon
  function getFileIcon(filename) {
    const extension = filename.split(".").pop().toLowerCase();
    const icons = {
      pdf: "fa-file-pdf",
      jpg: "fa-file-image",
      jpeg: "fa-file-image",
      png: "fa-file-image",
      gif: "fa-file-image",
      zip: "fa-file-archive",
      rar: "fa-file-archive",
      mp3: "fa-file-audio",
      wav: "fa-file-audio",
      mp4: "fa-file-video",
      mov: "fa-file-video",
      xls: "fa-file-excel",
      xlsx: "fa-file-excel",
      doc: "fa-file-word",
      docx: "fa-file-word",
      ppt: "fa-file-powerpoint",
      pptx: "fa-file-powerpoint",
      txt: "fa-file-alt",
      csv: "fa-file-csv",
      html: "fa-file-code",
      css: "fa-file-code",
      js: "fa-file-code",
      json: "fa-file-code",
      nc: "fa-file-code",
    };

    return icons[extension] || "fa-file";
  }

  // Start downloading files
  function startDownload(files) {
    downloadQueue = [...files];
    activeDownloads = 0;
    completedDownloads = 0;
    totalFilesToDownload = files.length;
    downloadedBytes = 0;
    lastBytesUpdate = 0;
    lastUpdateTime = 0;
    downloadStartTime = Date.now();

    // Update UI
    progressStatus.textContent = "Starting download...";
    progressStats.textContent = `0/${totalFilesToDownload} files`;
    globalProgress.style.width = "0%";
    individualProgress.innerHTML = "";

    // Create individual progress bars
    files.forEach((file) => {
      file.status = "queued";
      file.progress = 0;

      const progressItem = document.createElement("div");
      progressItem.className = "individual-progress-item";
      progressItem.id = `progress-${file.id}`;
      progressItem.innerHTML = `
        <div class="individual-progress-header">
          <span>${file.name}</span>
          <span class="file-progress-status">Queued</span>
        </div>
        <div class="individual-progress-bar">
          <div class="individual-progress-fill" style="width: 0%"></div>
        </div>
      `;
      individualProgress.appendChild(progressItem);
    });

    renderFileList();
    processDownloadQueue();
  }

  // Process download queue with parallel downloads
  function processDownloadQueue() {
    while (downloadQueue.length > 0 && activeDownloads < maxParallelDownloads) {
      const file = downloadQueue.shift();
      downloadFile(file);
      activeDownloads++;
    }

    if (downloadQueue.length === 0 && activeDownloads === 0) {
      progressStatus.textContent = "Download complete!";
      progressStatus.style.color = "var(--success-color)";
    }
  }

  // Download a single file
  async function downloadFile(file) {
    try {
      const response = await fetch(`/api/download-file?fileUrl=${encodeURIComponent(file.url)}`);
      if (!response.ok) throw new Error("Failed to download file");

      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const reader = response.body.getReader();
      let received = 0;
      let chunks = [];
      let lastTime = Date.now();
      let lastReceived = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        // Calculate progress
        let progress = total ? (received / total) * 100 : 0;

        // Calculate speed and time remaining
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000; // seconds
        if (timeDiff > 0.5) {
          const speed = (received - lastReceived) / timeDiff; // bytes/sec
          downloadSpeed.innerHTML = `<i class="fas fa-tachometer-alt"></i> ${(speed / 1024).toFixed(2)} KB/s`;

          // Calculate time remaining for this file
          if (speed > 0 && total > 0) {
            const remainingBytes = total - received;
            const safeSpeed = speed > 0 ? speed : 1;
            const remainingSeconds = remainingBytes / safeSpeed;
            timeRemaining.innerHTML = `<i class="fas fa-clock"></i> ${Math.ceil(remainingSeconds)}s remaining`;
          } else {
            timeRemaining.innerHTML = `<i class="fas fa-clock"></i> Calculating...`;
          }

          lastTime = now;
          lastReceived = received;
        }

        updateFileProgress(file.id, progress, value.length);
      }

      // Combine chunks into a blob
      const blob = new Blob(chunks);
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 100);

      updateFileStatus(file.id, "completed");
    } catch (error) {
      updateFileStatus(file.id, "error", error.message);
    } finally {
      activeDownloads--;
      completedDownloads++;
      updateGlobalProgress();
      processDownloadQueue();
    }
  }

  function downloadFileDirect(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  }

  // Update file status in UI
  function updateFileStatus(fileId, status, errorMessage = "") {
    const file = currentFiles.find((f) => f.id === fileId);
    if (file) {
      file.status = status;

      // Update file list row
      const row = document.querySelector(`tr[data-file-id="${fileId}"]`);
      if (row) {
        const statusCell = row.querySelector(".status-badge");
        if (statusCell) {
          statusCell.className = `status-badge status-${status}`;
          statusCell.textContent =
            status.charAt(0).toUpperCase() + status.slice(1);
        }
      }

      // Update individual progress
      const progressItem = document.getElementById(`progress-${fileId}`);
      if (progressItem) {
        const statusElement = progressItem.querySelector(
          ".file-progress-status"
        );
        if (statusElement) {
          statusElement.textContent =
            errorMessage ||
            (status === "completed"
              ? "Downloaded"
              : status.charAt(0).toUpperCase() + status.slice(1));
          statusElement.style.color =
            status === "completed"
              ? "var(--success-color)"
              : status === "error"
              ? "var(--danger-color)"
              : status === "downloading"
              ? "var(--info-color)"
              : "inherit";
        }
      }
    }
  }

  // Update file progress in UI
  function updateFileProgress(fileId, progress, bytesDownloaded) {
    const file = currentFiles.find((f) => f.id === fileId);
    if (file) {
      file.progress = progress;

      // Update individual progress bar
      const progressFill = document.querySelector(
        `#progress-${fileId} .individual-progress-fill`
      );
      if (progressFill) {
        progressFill.style.width = `${progress || 0}%`;
      }
    }
  }

  // Update global progress
  function updateGlobalProgress() {
    const progress = Math.round(
      (completedDownloads / totalFilesToDownload) * 100
    );
    globalProgress.style.width = `${progress}%`;
    progressStats.textContent = `${completedDownloads}/${totalFilesToDownload} files`;

    if (completedDownloads === totalFilesToDownload) {
      progressStatus.textContent = "Download complete!";
      progressStatus.style.color = "var(--success-color)";
      downloadSpeed.innerHTML = '<i class="fas fa-tachometer-alt"></i> 0 MB/s';

      const totalTime = (Date.now() - downloadStartTime) / 1000;
      let timeText =
        totalTime < 60
          ? `${totalTime.toFixed(1)} seconds`
          : `${Math.floor(totalTime / 60)}m ${Math.floor(totalTime % 60)}s`;

      timeRemaining.innerHTML = `<i class="fas fa-check-circle"></i> Completed in ${timeText}`;
    } else {
      progressStatus.textContent = "Downloading...";
      progressStatus.style.color = "inherit";
    }
  }
});
