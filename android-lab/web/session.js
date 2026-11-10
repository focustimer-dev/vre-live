"use strict";

const panel = document.getElementById("session");
const status = document.getElementById("session-status");
const login = document.getElementById("session-login");
const password = document.getElementById("session-password");
const unlock = login.querySelector("button");
const retry = document.getElementById("session-retry");

let reloading = false;
window.vreFeed = async (url, options) => {
  const response = await fetch(url, { ...options, redirect: "error" });
  if (response.status === 401 && !reloading) {
    reloading = true;
    location.reload();
  }
  return response;
};

async function checkSession(message = "Enter your VRE Live Lab preview password.") {
  status.textContent = "Connecting to the VRE preview…";
  retry.hidden = true;
  login.hidden = true;
  try {
    const response = await fetch("/feed/history", { method: "HEAD", cache: "no-store", redirect: "error" });
    if (response.status === 401) {
      status.textContent = message;
      login.hidden = false;
      return;
    }
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
      throw new Error("Preview unavailable");
    }
    const app = document.createElement("script");
    app.src = "vre-app.js";
    app.onload = () => { panel.hidden = true; };
    app.onerror = showRetry;
    document.head.append(app);
  } catch {
    showRetry();
  }
}

function showRetry() {
  status.textContent = "Couldn’t reach the VRE preview. Check your connection and try again.";
  retry.hidden = false;
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  unlock.disabled = true;
  try {
    const body = new URLSearchParams({ password: password.value });
    password.value = "";
    const response = await fetch("/login", { method: "POST", body, redirect: "manual" });
    if (response.status !== 401 && response.type !== "opaqueredirect") {
      throw new Error("Unexpected login response");
    }
    await checkSession("That password didn’t unlock the preview. Try again.");
  } catch {
    login.hidden = true;
    showRetry();
  } finally {
    unlock.disabled = false;
  }
});

retry.addEventListener("click", () => checkSession());
checkSession();
