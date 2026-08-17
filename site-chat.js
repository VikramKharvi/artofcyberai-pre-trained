const PAGE_URLS = [
  "https://pre-trained.artofcyberai.com/tech-llm-system-map.html",
  "https://pre-trained.artofcyberai.com/pre-training-llm.html",
  "https://pre-trained.artofcyberai.com/tech-transformer-architecture.html",
  "https://pre-trained.artofcyberai.com/tech-mixture-of-experts.html",
  "https://trainrl.com/post-training-stack.html",
  "https://trainrl.com/post-evals-rl-environments.html",
  "https://trainrl.com/post-edge-of-capability.html",
  "https://trainrl.com/post-graders-shape-models.html",
  "https://trainrl.com/post-real-users-high-entropy.html",
  "https://trainrl.com/post-long-horizon-context.html",
  "https://trainrl.com/post-continual-learning.html",
  "https://trainrl.com/post-taste-bottleneck.html",
  "https://trainrl.com/post-ai-software-engineering.html",
  "https://trainrl.com/post-good-agent-trajectory.html",
  "https://inference.artofcyberai.com/inference-service-contract.html",
  "https://inference.artofcyberai.com/inference-request-path.html",
  "https://inference.artofcyberai.com/inference-prefill-decode.html",
  "https://inference.artofcyberai.com/inference-kv-cache.html",
  "https://inference.artofcyberai.com/inference-continuous-batching.html",
  "https://inference.artofcyberai.com/inference-parallelism.html",
  "https://inference.artofcyberai.com/inference-quantization.html",
  "https://inference.artofcyberai.com/inference-speculative-decoding.html",
  "https://inference.artofcyberai.com/inference-capacity-reliability.html",
  "https://inference.artofcyberai.com/inference-load-testing.html"
];

const STOP_WORDS = new Set([
  "about", "after", "also", "an", "and", "are", "as", "at", "because", "been", "before", "being",
  "between", "both", "but", "can", "does", "each", "for", "from", "have", "how",
  "if", "in", "into", "is", "it", "its", "more", "most", "not", "of", "on", "only", "or", "other", "our", "should", "than", "to",
  "that", "the", "their", "then", "there", "these", "they", "this", "through", "use",
  "using", "was", "what", "when", "where", "which", "while", "with", "would", "you"
]);

const state = {
  chunksPromise: null,
  enginePromise: null,
  panel: null,
  messages: null,
  status: null,
  form: null,
  input: null,
  download: null,
  launcher: null,
  ready: false,
  searchOnly: false,
  engineError: null
};

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function tokens(text) {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+.-]{1,}/g) || [])
    .filter((token) => !STOP_WORDS.has(token));
}

function chunkDocument(html, url) {
  const documentCopy = new DOMParser().parseFromString(html, "text/html");
  const title = normalize(documentCopy.querySelector("h1")?.textContent || documentCopy.title || url);
  const main = documentCopy.querySelector("main");
  if (!main) return [];

  const chunks = [];
  let heading = title;
  let buffer = [];
  let length = 0;

  const flush = () => {
    const text = normalize(buffer.join(" "));
    if (text.length >= 80) chunks.push({ url, title, heading, text });
    buffer = [];
    length = 0;
  };

  main.querySelectorAll("h1, h2, h3, p, li, [role='listitem'], blockquote, figcaption").forEach((node) => {
    const text = normalize(node.textContent || "");
    if (!text) return;
    if (/^H[1-3]$/.test(node.tagName)) {
      flush();
      heading = text;
      return;
    }
    if (node.matches("p") && node.closest("li, [role='listitem'], blockquote, figcaption")) return;
    if (buffer.includes(text)) return;
    if (length + text.length > 1050) flush();
    buffer.push(text);
    length += text.length + 1;
  });
  flush();
  return chunks;
}

async function buildIndex() {
  if (state.chunksPromise) return state.chunksPromise;
  state.chunksPromise = Promise.all(PAGE_URLS.map(async (url, index) => {
    setStatus(`Indexing field notes ${index + 1}/${PAGE_URLS.length}...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read ${url}`);
    return chunkDocument(await response.text(), url);
  })).then((documents) => documents.flat());
  return state.chunksPromise;
}

function countMatches(text, token) {
  let count = 0;
  let position = text.indexOf(token);
  while (position !== -1) {
    count += 1;
    position = text.indexOf(token, position + token.length);
  }
  return count;
}

function retrieve(chunks, question) {
  const query = question.toLowerCase();
  const queryTokens = [...new Set(tokens(question))];
  const scored = chunks.map((chunk) => {
    const heading = `${chunk.title} ${chunk.heading}`.toLowerCase();
    const body = chunk.text.toLowerCase();
    let score = query.length > 5 && body.includes(query) ? 18 : 0;
    queryTokens.forEach((token) => {
      score += countMatches(heading, token) * 5;
      score += Math.min(4, countMatches(body, token));
    });
    return { ...chunk, score };
  }).filter((chunk) => chunk.score >= 4).sort((a, b) => b.score - a.score);

  const selected = [];
  const pageCounts = new Map();
  for (const chunk of scored) {
    const count = pageCounts.get(chunk.url) || 0;
    if (count >= 2) continue;
    selected.push(chunk);
    pageCounts.set(chunk.url, count + 1);
    if (selected.length === 6) break;
  }
  const matchedQueryTokens = queryTokens.filter((token) => selected.some((chunk) =>
    `${chunk.title} ${chunk.heading} ${chunk.text}`.toLowerCase().includes(token)
  ));
  if (queryTokens.length > 1 && matchedQueryTokens.length < 2) return [];
  return selected;
}

function setStatus(text) {
  if (state.status) state.status.textContent = text;
}

function addMessage(role, text) {
  const message = document.createElement("div");
  message.className = `site-chat-message is-${role}`;
  const label = document.createElement("span");
  label.className = "site-chat-message-role";
  label.textContent = role === "user" ? "Question" : "Answer";
  const body = document.createElement("div");
  body.className = "site-chat-message-body";
  body.textContent = text;
  message.append(label, body);
  state.messages.append(message);
  state.messages.scrollTop = state.messages.scrollHeight;
  return body;
}

function groupSources(results) {
  const sources = new Map();
  results.forEach((result) => {
    if (!sources.has(result.url)) sources.set(result.url, { ...result, excerpts: [] });
    sources.get(result.url).excerpts.push({ heading: result.heading, text: result.text });
  });
  return [...sources.values()];
}

function appendInlineText(container, text, sources) {
  const pattern = /\[(\d+)\]/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(position, match.index)));
    const source = sources[Number(match[1]) - 1];
    if (source) {
      const citation = document.createElement("a");
      citation.className = "site-chat-citation";
      citation.href = source.url;
      citation.title = source.title;
      citation.textContent = match[0];
      container.append(citation);
    } else {
      container.append(document.createTextNode(match[0]));
    }
    position = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(position)));
}

function renderAnswer(container, text, sources = []) {
  container.replaceChildren();
  let list = null;
  let listType = "";
  text.split(/\n+/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      listType = "";
      return;
    }
    const bullet = line.match(/^[-*\u2022]\s+(.+)/);
    const numbered = line.match(/^\d+[.)]\s+(.+)/);
    if (bullet || numbered) {
      const nextType = numbered ? "ol" : "ul";
      if (!list || listType !== nextType) {
        list = document.createElement(nextType);
        listType = nextType;
        container.append(list);
      }
      const item = document.createElement("li");
      appendInlineText(item, (bullet || numbered)[1], sources);
      list.append(item);
      return;
    }
    list = null;
    listType = "";
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, line, sources);
    container.append(paragraph);
  });
}

function polishAnswer(text, sources) {
  const refusal = "I can only answer questions supported by Vikram Kharvi's published field notes.";
  if (text.includes(refusal)) return refusal;

  const cleaned = text.replace(/(?:\s*\(repeated for multiple steps\)){2,}/gi, " (repeated across multiple steps)");
  const seen = new Set();
  const lines = cleaned.split(/\n+/).map((line) => line.trim()).filter((line) => {
    if (!line) return false;
    const key = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);

  const hasList = lines.some((line) => /^[-*\u2022]\s+|^\d+[.)]\s+/.test(line));
  return lines.map((line, index) => {
    let formatted = line;
    if (!hasList && lines.length > 2 && index > 0) formatted = `- ${formatted}`;
    if (sources.length && !/\[\d+\]/.test(formatted)) formatted += " [1]";
    return formatted;
  }).join("\n");
}

function showSources(sources) {
  const sourceList = document.createElement("div");
  sourceList.className = "site-chat-sources";
  const label = document.createElement("span");
  label.textContent = "Sources from Vikram's field notes";
  sourceList.append(label);
  sources.forEach((result, index) => {
    const link = document.createElement("a");
    link.href = result.url;
    link.textContent = `${index + 1}. ${result.title}`;
    sourceList.append(link);
  });
  state.messages.append(sourceList);
}

async function createEngine() {
  if (state.enginePromise) return state.enginePromise;
  state.enginePromise = (async () => {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable in this browser.");
    setStatus("Connecting to the browser AI...");
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
    const supportsF16 = adapter.features.has("shader-f16");
    const model = supportsF16
      ? "SmolLM2-360M-Instruct-q4f16_1-MLC"
      : "SmolLM2-360M-Instruct-q4f32_1-MLC";
    const worker = new Worker(new URL("./site-chat-worker.js", import.meta.url), { type: "module" });
    return webllm.CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (progress) => setStatus(progress.text || "Loading the browser AI...")
    });
  })();
  return state.enginePromise;
}

function fallbackAnswer(results, error) {
  const introduction = error?.message?.includes("WebGPU")
    ? "This browser cannot run the browser AI, but these passages are the closest match:"
    : "The browser AI could not start. These passages are the closest match:";
  const text = results.length
    ? `${introduction}\n\n${results.slice(0, 3).map((result) => `${result.heading}: ${result.text.slice(0, 280)}...`).join("\n\n")}`
    : "I can only answer questions supported by Vikram Kharvi's published field notes. I could not find a relevant source for that question.";
  const answerNode = addMessage("assistant", "");
  renderAnswer(answerNode, text);
  if (results.length) showSources(groupSources(results));
  setStatus("Search mode");
}

async function answer(question) {
  if (!state.ready) return;
  state.form.querySelector("button").disabled = true;
  addMessage("user", question);
  try {
    const chunks = await buildIndex();
    const results = retrieve(chunks, question);
    if (!results.length) {
      fallbackAnswer([], null);
      return;
    }

    let engine;
    if (state.searchOnly) {
      fallbackAnswer(results, state.engineError);
      return;
    }
    try {
      engine = await createEngine();
    } catch (error) {
      state.searchOnly = true;
      state.engineError = error;
      fallbackAnswer(results, error);
      return;
    }

    setStatus("Answering locally with WebLLM...");
    const sources = groupSources(results);
    const context = sources.map((source, index) =>
      `[${index + 1}] ${source.title}\nURL: ${source.url}\n${source.excerpts.map((excerpt) => `${excerpt.heading}: ${excerpt.text}`).join("\n")}`
    ).join("\n\n");
    const responseNode = addMessage("assistant", "");
    const stream = await engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are the grounded assistant for Vikram Kharvi's field notes. The supplied excerpts are your only source of truth. Never use outside or general knowledge. If the question is not explicitly supported by the excerpts, reply only: 'I can only answer questions supported by Vikram Kharvi's published field notes.' For a supported answer, give 2 to 5 distinct bullets or short paragraphs, cite every factual point with the matching source number such as [1], and never invent or repeat a citation."
        },
        {
          role: "user",
          content: `Website excerpts:\n\n${context}\n\nQuestion: ${question}`
        }
      ],
      temperature: 0.2,
      max_tokens: 240,
      frequency_penalty: 0.7,
      stream: true
    });
    let answerText = "";
    for await (const chunk of stream) {
      answerText += chunk.choices[0]?.delta?.content || "";
      renderAnswer(responseNode, answerText, sources);
    }
    answerText = polishAnswer(answerText, sources);
    renderAnswer(responseNode, answerText, sources);
    showSources(sources);
    setStatus("Ready \u2014 model and pages stay in your browser");
  } catch (error) {
    addMessage("assistant", `I could not answer that question: ${error.message}`);
    setStatus("Something went wrong");
  } finally {
    state.form.querySelector("button").disabled = false;
    state.input.focus();
  }
}

async function prepareChat() {
  state.download.disabled = true;
  state.download.querySelector("strong").textContent = navigator.gpu ? "Preparing browser AI..." : "Preparing search mode...";
  try {
    await buildIndex();
  } catch (error) {
    state.chunksPromise = null;
    state.download.disabled = false;
    state.download.querySelector("strong").textContent = navigator.gpu ? "Try downloading again" : "Try search again";
    addMessage("assistant", `The field notes could not be indexed: ${error.message}`);
    setStatus("Something went wrong");
    return;
  }

  try {
    await createEngine();
    state.searchOnly = false;
    state.engineError = null;
    addMessage("assistant", "The browser AI is ready. Ask a question about any published blog.");
    setStatus("Ready \u2014 inference runs in your browser");
  } catch (error) {
    state.enginePromise = null;
    state.searchOnly = true;
    state.engineError = error;
    addMessage("assistant", "This browser cannot run the local model, so search mode is ready instead. Ask a question to retrieve the closest passages from the field notes.");
    setStatus("Search mode");
  }

  state.ready = true;
  state.download.remove();
  state.input.disabled = false;
  state.form.querySelector("button").disabled = false;
  state.input.focus();
}

function openPanel() {
  state.panel.hidden = false;
  requestAnimationFrame(() => state.panel.classList.add("is-open"));
  (state.input.disabled ? state.download : state.input).focus();
}

function closePanel() {
  state.panel.classList.remove("is-open");
  window.setTimeout(() => { state.panel.hidden = true; }, 180);
  state.launcher.focus();
}

function initializeChat() {
  const launcher = document.createElement("button");
  launcher.className = "site-chat-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Ask the field notes");
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.innerHTML = "<span>Ask the field notes</span><b aria-hidden=\"true\">AI</b>";

  const panel = document.createElement("aside");
  panel.className = "site-chat-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", "Ask the field notes");
  panel.innerHTML = `
    <header class="site-chat-header">
      <div><small>In-browser research assistant</small><h2>Ask the field notes</h2></div>
      <button type="button" aria-label="Close chat">&times;</button>
    </header>
    <div class="site-chat-messages" aria-live="polite">
      <div class="site-chat-message is-assistant">You need to download this browser AI to access the assistant. Afterward, ask about pre-training, post-training, RL environments, agent trajectories, or model serving.</div>
    </div>
    <button class="site-chat-download" type="button"><strong>Download browser AI</strong><span>Required for access &middot; first download approximately 400&ndash;600 MB</span></button>
    <form class="site-chat-form">
      <label for="site-chat-question">Your question</label>
      <div><input id="site-chat-question" name="question" autocomplete="off" placeholder="How should an RL trajectory be recorded?" required disabled><button type="submit" disabled>Ask</button></div>
    </form>
    <footer class="site-chat-meta"><span>Browser AI</span><span class="site-chat-status">Download required for access</span><a href="https://github.com/mlc-ai/web-llm" target="_blank" rel="noreferrer">Powered by WebLLM &nearr;</a></footer>`;

  document.body.append(launcher, panel);
  state.panel = panel;
  state.launcher = launcher;
  state.messages = panel.querySelector(".site-chat-messages");
  state.status = panel.querySelector(".site-chat-status");
  state.form = panel.querySelector(".site-chat-form");
  state.input = panel.querySelector("input");
  state.download = panel.querySelector(".site-chat-download");

  if (!navigator.gpu) {
    state.messages.firstElementChild.textContent = "This browser cannot run the local model. Enable search mode to retrieve passages from the published field notes without a model download.";
    state.download.querySelector("strong").textContent = "Enable search mode";
    state.download.querySelector("span").textContent = "No model download required";
    setStatus("Search mode available without WebGPU");
  }

  launcher.addEventListener("click", openPanel);
  state.download.addEventListener("click", prepareChat);
  panel.querySelector(".site-chat-header button").addEventListener("click", closePanel);
  state.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = normalize(state.input.value);
    if (!question) return;
    state.input.value = "";
    answer(question);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });
}

initializeChat();
