const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = [...document.querySelectorAll(".reveal")];

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }),
    { threshold: 0.12 },
  );
  revealItems.forEach((item) => observer.observe(item));
}

const toast = document.querySelector(".toast");
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    showToast("Command copied");
  } catch {
    showToast("Select and copy the command manually");
  }
});

fetch("release-facts.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error("facts unavailable");
    return response.json();
  })
  .then((facts) => {
    document.querySelector('[data-fact="core"]').textContent = facts.servers.core.tools;
    document.querySelector('[data-fact="composite"]').textContent = facts.servers.composite.tools;
    document.querySelector('[data-fact="gates"]').textContent = facts.truthGates;
  })
  .catch(() => {});
